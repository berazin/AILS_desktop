from __future__ import annotations

import contextlib
import html
import json
import logging
import re
import time
from typing import Mapping

from ai_request_limits import prepare_generation_request
import managed_direct
import openrouter_web_search

from common import (
    DEFAULT_RATE_LIMIT_WAIT_SCHEDULE,
    HTTP_ERROR_PREVIEW_LIMIT,
    OPENAI_COMPAT_MAX_RETRIES,
    append_status_log,
    build_openai_chat_endpoint,
    build_openai_compat_headers,
    contains_rate_limit_marker,
    emit_debug_trace,
    endpoint_supports_stream_usage,
    extract_openai_compat_usage,
    extract_usage_metadata,
    get_openai_compat_rate_limit_kind,
    get_retry_wait_seconds,
    is_debug_trace_enabled,
    is_openai_compat_rate_limit_error,
    should_retry_openai_compat_request,
)
from local_inference import GPU_SCHEDULER, GpuPriority
from pipeline_utils import sleep_with_cancel
from chat.stream_cancellation import cancellable_items, close_response

_logger = logging.getLogger(__name__)


class ProviderStreamError(RuntimeError):
    """A provider explicitly ended the stream with an error, not a lost reply."""

    def __init__(self, provider_label, payload, generation_id="", credentials=()):
        error = payload.get("error")
        details = error if isinstance(error, dict) else {"message": str(error)}
        self.provider_stream_error = True
        self.generation_id = generation_id if re.fullmatch(r"[\w-]{1,128}", str(generation_id)) else ""
        self.error_code = str(details.get("code") or details.get("type") or "unknown")
        if not re.fullmatch(r"[\w.-]{1,100}", self.error_code):
            self.error_code = "unknown"
        message = str(details.get("message") or "")
        for credential in credentials:
            if credential:
                message = message.replace(str(credential), "<redacted>")
        message = re.sub(r"(?i)Bearer\s+\S+|\bsk-[\w-]+", "<redacted>", message)
        self.detail = re.sub(r"\s+", " ", message)[:400]
        super().__init__(f"{provider_label} 스트리밍 응답 오류: {self.error_code} / {self.detail}"
                         + (f" / 요청 {self.generation_id}" if self.generation_id else ""))


class ProviderHttpError(RuntimeError):
    """An HTTP failure with provider diagnostics, without implying zero usage."""

    def __init__(self, provider_label, status_code, payload=None, cause=None, detail="", credentials=()):
        self.status_code = int(status_code or 0)
        error = (payload or {}).get("error") if isinstance(payload, dict) else None
        details = error if isinstance(error, dict) else {"message": str(error or "")}
        self.error_code = str(details.get("code") or (payload.get("code") if isinstance(payload, dict) else None) or details.get("type") or "unknown")
        if not re.fullmatch(r"[\w.-]{1,100}", self.error_code):
            self.error_code = "unknown"
        message = str(details.get("message") or cause or "")
        for credential in credentials:
            if credential:
                message = message.replace(str(credential), "<redacted>")
        message = re.sub(r"(?i)Bearer\s+\S+|\bsk-[\w-]+", "<redacted>", message)
        self.detail = re.sub(r"\s+", " ", message)[:400]
        suffix = f" ({detail})" if detail else ""
        super().__init__(f"{provider_label} 연결 실패: HTTP {self.status_code} / {self.error_code} / {self.detail}{suffix}")


class ProviderRejectedError(ProviderHttpError):
    """An explicit pre-generation rejection, distinct from an ambiguous 5xx."""

    pre_generation_rejection = True


def _strip_surrogates(text):
    """Remove lone Unicode surrogates (U+D800..U+DFFF) that cause JSON parse
    failures on strict servers like Cloudflare Gateway."""
    if not isinstance(text, str):
        return text
    return text.encode("utf-8", errors="surrogatepass").decode("utf-8", errors="ignore")


def _sanitize_messages(messages):
    """Deep-clean message content strings so they are safe for JSON serialization."""
    sanitized = []
    for message in messages:
        if not isinstance(message, dict):
            sanitized.append(message)
            continue
        msg = dict(message)
        content = msg.get("content")
        if isinstance(content, str):
            msg["content"] = _strip_surrogates(content)
        elif isinstance(content, list):
            cleaned_parts = []
            for part in content:
                if isinstance(part, dict):
                    part = dict(part)
                    if "text" in part and isinstance(part["text"], str):
                        part["text"] = _strip_surrogates(part["text"])
                cleaned_parts.append(part)
            msg["content"] = cleaned_parts
        sanitized.append(msg)
    return sanitized


def _debug_trace_messages(messages):
    traced = []
    for message in messages:
        if not isinstance(message, dict) or not isinstance(message.get("content"), list):
            traced.append(message)
            continue
        traced_message = dict(message)
        traced_parts = []
        for part in message["content"]:
            traced_part = dict(part) if isinstance(part, dict) else part
            if isinstance(traced_part, dict) and isinstance(traced_part.get("image_url"), dict):
                image_url = dict(traced_part["image_url"])
                if str(image_url.get("url") or "").startswith("data:image/"):
                    image_url["url"] = "<embedded image omitted>"
                traced_part["image_url"] = image_url
            traced_parts.append(traced_part)
        traced_message["content"] = traced_parts
        traced.append(traced_message)
    return json.dumps(traced, ensure_ascii=False)


def extract_response_body_preview(response, limit=HTTP_ERROR_PREVIEW_LIMIT):
    if response is None:
        return ""
    try:
        text = response.text or ""
    except Exception:
        return ""
    text = str(text).strip()
    if "text/html" in str(response.headers.get("Content-Type", "")).lower():
        text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
        text = re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", " ", text, flags=re.DOTALL | re.IGNORECASE)
        text = html.unescape(re.sub(r"<[^>]*>", " ", text))
    text = re.sub(r"\s+", " ", text)
    if not text:
        return ""
    return text[:limit]


def cloudflare_error_detail(response):
    """Keep edge error identity without including request credentials/content."""
    if response is None:
        return ""
    headers = response.headers
    ray = str(headers.get("CF-Ray") or "")
    ray = ray if re.fullmatch(r"[a-zA-Z0-9-]{1,96}", ray) else ""
    details = [f"CF-Ray={ray}"] if ray else []
    if "text/html" in str(headers.get("Content-Type", "")).lower():
        # The useful error number usually follows a long HTML/style preamble.
        preview = extract_response_body_preview(response, limit=16_384)
        code = re.search(r"\bError(?:\s+code)?\s*:?\s*(1\d{3})\b", preview, re.IGNORECASE)
        if code:
            details.append(f"Cloudflare Error {code.group(1)}")
            if code.group(1) == "1102":
                details.append("Worker 자원 한도 초과")
    return " / ".join(details)

def log_openai_compat_response_diagnostics(provider_label, response, log_list, reason):
    if log_list is None or response is None:
        return
    status_code = getattr(response, "status_code", "unknown")
    content_type = ""
    try:
        content_type = response.headers.get("Content-Type", "")
    except Exception:
        content_type = ""
    body_preview = extract_response_body_preview(response)
    append_status_log(log_list, f"{provider_label} 응답 진단: {reason} / HTTP {status_code} / Content-Type={content_type or '없음'}")
    edge_detail = cloudflare_error_detail(response)
    if edge_detail:
        append_status_log(log_list, f"{provider_label} 서버 진단: {edge_detail}")
    if body_preview:
        append_status_log(log_list, f"{provider_label} 응답 본문 미리보기: {body_preview}")
    else:
        append_status_log(log_list, f"{provider_label} 응답 본문 미리보기: <empty>")

def describe_openai_compat_retry_reason(error, payload=None):
    response = getattr(error, "response", None)
    if is_openai_compat_rate_limit_error(error, payload):
        return "rate limit"
    if response is not None:
        status_code = getattr(response, "status_code", "unknown")
        return f"HTTP {status_code} 일시 오류"
    return "일시 오류"

def call_openai_compatible_chat(
    base_url,
    api_key,
    model_name,
    messages,
    *,
    timeout=86400,
    provider_label="OpenAI-compatible",
    log_list=None,
    cancel_check=None,
    retry_on_rate_limit=True,
    rate_limit_wait_schedule=None,
    max_retries=OPENAI_COMPAT_MAX_RETRIES,
    allow_empty_api_key=False,
    debug_trace_callback=None,
    debug_trace_label="",
    request_options=None,
    total_timeout=None,
    timing_callback=None,
    return_message=False,
    stream=False,
    retry_ambiguous_errors=True,
):
    import requests
    if str(base_url).startswith("chatgpt-plan:") or str(api_key).startswith("chatgpt-local-"):
        from subscription_policy import require_subscription
        require_subscription()
        from chatgpt_subscription import runtime as chatgpt_runtime
        if base_url != chatgpt_runtime.ENDPOINT:
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.protocol import ChatGPTError
            raise ChatGPTError("invalid_transport")
        return chatgpt_runtime.call(api_key, model_name, messages, timeout=timeout,
            request_options=request_options, cancel_check=cancel_check,
            debug_trace_callback=debug_trace_callback, debug_trace_label=debug_trace_label,
            return_message=return_message, timing_callback=timing_callback, total_timeout=total_timeout)
    if not api_key and not allow_empty_api_key:
        raise RuntimeError(f"{provider_label} API Key가 필요합니다.")
    endpoint = build_openai_chat_endpoint(base_url)
    messages = _sanitize_messages(messages)
    payload = {
        "model": model_name,
        "messages": messages,
    }
    normalized_model = str(model_name or "").strip().lower().removeprefix("deepseek/")
    if normalized_model.startswith(("deepseek-v4-", "deepseek-v4.1-")) or normalized_model == "deepseek-flash":
        # DeepSeek V4 defaults to thinking mode. Keep application text features
        # on the lower-latency, lower-cost non-thinking path unless a caller
        # deliberately supplies a different option for an isolated experiment.
        effort = (request_options or {}).get("reasoning", {}).get("effort", "none")
        payload["thinking"] = {"type": "disabled" if effort == "none" else "enabled"}
    if request_options:
        reserved_keys = {"model", "messages", "stream"}
        conflicts = reserved_keys.intersection(request_options)
        if conflicts:
            raise ValueError(
                f"{provider_label} 요청 옵션에서 예약된 키를 사용할 수 없습니다: "
                f"{sorted(conflicts)}"
            )
        payload.update(dict(request_options))
    payload = prepare_generation_request(payload)
    payload, direct = managed_direct.prepare_request(api_key, endpoint, model_name, payload, cancel_check, log_list)
    if direct:
        retry_ambiguous_errors = False
        payload = prepare_generation_request(payload)
    use_stream = bool(stream or callable(debug_trace_callback))
    if use_stream:
        payload["stream"] = True
        # 지원 공급자에 한해 스트리밍 usage를 요청한다. 미지원 공급자는 usage
        # 청크가 없어 기존 추정 경로를 그대로 쓴다.
        if endpoint_supports_stream_usage(endpoint):
            payload["stream_options"] = {"include_usage": True}
    headers = build_openai_compat_headers(managed_direct.provider_key(api_key), endpoint, json_content=True)
    prompt_preview_parts = []
    for message in messages:
        content = message.get("content", "") if isinstance(message, dict) else ""
        if isinstance(content, str):
            prompt_preview_parts.append(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    prompt_preview_parts.append(str(part.get("text", "")))
    prompt_preview = "\n".join(part for part in prompt_preview_parts if part)

    event_callback = debug_trace_callback
    if callable(event_callback):
        event_callback(
            debug_trace_label or f"{provider_label} request",
            _debug_trace_messages(messages),
            "prompt",
        )
    is_local_llm = (
        "llama.cpp" in str(provider_label).lower()
        or "llama-server" in str(provider_label).lower()
        or (allow_empty_api_key and "127.0.0.1" in str(endpoint))
    )
    attempt_index = 0
    first_sse_seen = False
    first_content_seen = False

    def record_timing(stage, **details):
        if callable(timing_callback):
            timing_callback(stage, {"at": time.monotonic(), "attempt": attempt_index + 1, **details})

    while True:
        response = None
        response_lines = None
        stream_response_started = False
        try:
            if cancel_check is not None:
                cancel_check()
            attempt_started = time.monotonic()
            scheduler = (
                GPU_SCHEDULER.acquire("local_llm", priority=GpuPriority.CRITICAL, cancel_check=cancel_check)
                if is_local_llm
                else contextlib.nullcontext()
            )
            with scheduler:
                record_timing("provider_request_start", provider=provider_label)
                direct_request_id = managed_direct.record_dispatch(api_key, model_name)
                response = requests.post(
                    endpoint,
                    headers=headers,
                    json=payload,
                    timeout=timeout,
                    stream=use_stream or total_timeout is not None,
                    **({"allow_redirects": False} if direct else {}),
                )
                response_headers = getattr(response, "headers", {}) or {}
                routed_provider = (
                    response_headers.get("x-vercel-ai-gateway-provider")
                    or response_headers.get("x-openrouter-provider")
                    or ""
                )
                record_timing("headers_received", provider=str(routed_provider), status_code=getattr(response, "status_code", None))
                response.raise_for_status()
                if use_stream:
                    stream_response_started = True
                    content_parts = []
                    search_annotations = []
                    streamed_tool_calls = {}
                    last_usage_payload = {}
                    reasoning_parts = {}
                    reasoning_details = {}
                    stream_complete = False
                    finish_reason = None
                    generation_id = ""
                    # Requests otherwise waits for 512 bytes on non-chunked
                    # responses, delaying short SSE events until completion.
                    response_lines = cancellable_items(response.iter_lines(chunk_size=1, decode_unicode=False), cancel_check)
                    for raw_line in response_lines:
                        if cancel_check is not None:
                            cancel_check()
                        if total_timeout is not None and time.monotonic() - attempt_started > float(total_timeout):
                            raise requests.Timeout(f"전체 응답 제한 {float(total_timeout):.0f}초 초과")
                        if not raw_line:
                            continue
                        if isinstance(raw_line, bytes):
                            line = raw_line.decode("utf-8", errors="replace").strip()
                        else:
                            line = str(raw_line).strip()
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if not line:
                            continue
                        if line == "[DONE]":
                            stream_complete = True
                            break
                        try:
                            stream_payload = json.loads(line)
                        except ValueError:
                            if line.startswith((":", "event:", "id:", "retry:")):
                                continue
                            raise RuntimeError(f"{provider_label} 스트리밍 응답 JSON 파싱 실패")
                        if not isinstance(stream_payload, dict):
                            continue
                        managed_direct.record_generation(api_key, direct_request_id, stream_payload)
                        if stream_payload.get("id"):
                            generation_id = str(stream_payload["id"])
                        if stream_payload.get("error"):
                            raise ProviderStreamError(provider_label, stream_payload, generation_id,
                                                      (api_key, managed_direct.provider_key(api_key)))
                        if not first_sse_seen:
                            first_sse_seen = True
                            record_timing("first_sse_event")
                        if isinstance(stream_payload, dict) and isinstance(stream_payload.get("usage"), dict):
                            # 마지막 usage 이벤트가 실제 과금 토큰이다.
                            last_usage_payload = stream_payload["usage"]
                        choice = (stream_payload.get("choices") or [{}])[0]
                        if choice.get("finish_reason"):
                            finish_reason = choice["finish_reason"]
                        delta = choice.get("delta") or {}
                        message = choice.get("message") or {}
                        search_annotations.extend(delta.get("annotations") or message.get("annotations") or [])
                        for field in ("reasoning_content", "reasoning"):
                            value = delta.get(field) or message.get(field)
                            if isinstance(value, str):
                                reasoning_parts.setdefault(field, []).append(value)
                        for detail in delta.get("reasoning_details") or message.get("reasoning_details") or []:
                            if not isinstance(detail, dict):
                                continue
                            key = (detail.get("index", 0), detail.get("type", ""))
                            current_detail = reasoning_details.setdefault(key, {})
                            for field, value in detail.items():
                                if field in {"text", "summary", "data"} and isinstance(value, str):
                                    current_detail[field] = current_detail.get(field, "") + value
                                else:
                                    current_detail[field] = value
                        token = delta.get("content", "")
                        if not token and message.get("content"):
                            token = message.get("content", "")
                        if isinstance(token, list):
                            normalized_tokens = []
                            for part in token:
                                if isinstance(part, dict):
                                    normalized_tokens.append(str(part.get("text", "")))
                                else:
                                    normalized_tokens.append(str(part))
                            token = "".join(normalized_tokens)
                        token = str(token or "")
                        if token:
                            if not first_content_seen:
                                first_content_seen = True
                                record_timing("first_content")
                            content_parts.append(token)
                            if callable(debug_trace_callback):
                                debug_trace_callback(debug_trace_label or f"{provider_label} response stream", token, "token")
                        for tool_delta in delta.get("tool_calls") or message.get("tool_calls") or []:
                            if not isinstance(tool_delta, dict):
                                continue
                            if not first_content_seen:
                                first_content_seen = True
                                record_timing("first_content", content_type="tool_call")
                            index = int(tool_delta.get("index") or 0)
                            function = tool_delta.get("function") if isinstance(tool_delta.get("function"), dict) else {}
                            current = streamed_tool_calls.setdefault(
                                index,
                                {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
                            )
                            current["id"] += str(tool_delta.get("id") or "")
                            current["type"] = str(tool_delta.get("type") or current["type"] or "function")
                            current["function"]["name"] += str(function.get("name") or "")
                            current["function"]["arguments"] += str(function.get("arguments") or "")
                    if not stream_complete:
                        raise RuntimeError(f"{provider_label} 스트림이 완료 전에 끊겼습니다.")
                    if return_message and finish_reason in {"length", "content_filter"}:
                        raise RuntimeError(f"{provider_label} assistant 응답이 완료되지 않았습니다: {finish_reason}")
                    if callable(event_callback):
                        for index in sorted(streamed_tool_calls):
                            event_callback(
                                debug_trace_label or f"{provider_label} response stream",
                                json.dumps(streamed_tool_calls[index], ensure_ascii=False),
                                "tool_call",
                            )
                    content = "".join(content_parts)
                    usage = extract_openai_compat_usage({"usage": last_usage_payload}, prompt_preview, content)
                    search_report = openrouter_web_search.report(payload, search_annotations, last_usage_payload)
                    if search_report is not None:
                        usage["web_search"] = search_report
                    if return_message:
                        message = {"role": "assistant", "content": content or None}
                        if streamed_tool_calls:
                            message["tool_calls"] = [streamed_tool_calls[i] for i in sorted(streamed_tool_calls)]
                        message.update({field: "".join(parts) for field, parts in reasoning_parts.items()})
                        if reasoning_details:
                            message["reasoning_details"] = list(reasoning_details.values())
                        return message, usage
                    return content, usage
                if total_timeout is not None:
                    body = bytearray()
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if cancel_check is not None:
                            cancel_check()
                        if time.monotonic() - attempt_started > float(total_timeout):
                            raise requests.Timeout(f"전체 응답 제한 {float(total_timeout):.0f}초 초과")
                        if chunk:
                            body.extend(chunk)
                    response._content = bytes(body)
                    response._content_consumed = True
                try:
                    data = response.json()
                except ValueError as error:
                    log_openai_compat_response_diagnostics(provider_label, response, log_list, "JSON 파싱 실패")
                    status_code = getattr(response, "status_code", "unknown")
                    content_type = response.headers.get("Content-Type", "") if response is not None else ""
                    body_preview = extract_response_body_preview(response)
                    raise RuntimeError(
                        f"{provider_label} 응답 JSON 파싱 실패: HTTP {status_code}, "
                        f"Content-Type={content_type or '없음'}, preview={body_preview or '<empty>'}"
                    ) from error
                managed_direct.record_generation(api_key, direct_request_id, data)
                content = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
                message = data.get("choices", [{}])[0].get("message", {})
                if callable(event_callback):
                    for tool_call in message.get("tool_calls") or []:
                        if isinstance(tool_call, dict):
                            event_callback(
                                debug_trace_label or f"{provider_label} response",
                                json.dumps(tool_call, ensure_ascii=False),
                                "tool_call",
                            )
                if isinstance(content, list):
                    normalized_parts = []
                    for part in content:
                        if isinstance(part, dict):
                            normalized_parts.append(str(part.get("text", "")))
                        else:
                            normalized_parts.append(str(part))
                    content = "\n".join(part for part in normalized_parts if part).strip()
                usage = extract_openai_compat_usage(data, prompt_preview, content)
                search_report = openrouter_web_search.report(payload, message.get("annotations"), data.get("usage") or {})
                if search_report is not None:
                    usage["web_search"] = search_report
                if return_message:
                    if not isinstance(message, dict) or message.get("role") != "assistant":
                        raise RuntimeError(f"{provider_label} 응답에 assistant 메시지가 없습니다.")
                    return dict(message), usage
                return content, usage
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # A consumer that stopped reading must not trigger a retry/fallback.
            raise
        except requests.HTTPError as error:
            response = getattr(error, "response", None)
            payload_data = None
            try:
                if response is not None:
                    payload_data = response.json()
            except Exception:
                payload_data = None
            log_openai_compat_response_diagnostics(provider_label, response, log_list, "HTTP 오류")
            if not direct and not stream and callable(debug_trace_callback) and getattr(response, "status_code", None) in {400, 404, 422}:
                record_timing("fallback", reason="stream_unsupported")
                try:
                    debug_trace_callback(
                        debug_trace_label or f"{provider_label} response stream",
                        "스트리밍 응답을 사용할 수 없어 일반 응답 호출로 다시 시도합니다.",
                        "info",
                    )
                except Exception:
                    pass
                payload.pop("stream", None)
                payload.pop("stream_options", None)
                use_stream = False
                debug_trace_callback = None
                continue
            should_retry = should_retry_openai_compat_request(error, payload_data)
            is_rate_limit = is_openai_compat_rate_limit_error(error, payload_data)
            if not retry_ambiguous_errors and getattr(response, "status_code", None) != 429:
                should_retry = False
            has_attempt_budget = (max_retries is None) or (attempt_index < max_retries)
            if has_attempt_budget and should_retry and (retry_on_rate_limit or not is_rate_limit):
                effective_schedule = rate_limit_wait_schedule if is_rate_limit else None
                if is_rate_limit and effective_schedule is None:
                    effective_schedule = DEFAULT_RATE_LIMIT_WAIT_SCHEDULE
                wait_seconds = get_retry_wait_seconds(
                    error,
                    attempt_index,
                    rate_limit_wait_schedule=effective_schedule,
                )
                if log_list is not None:
                    retry_label = "무제한" if max_retries is None else str(max_retries)
                    retry_reason = describe_openai_compat_retry_reason(error, payload_data)
                    append_status_log(log_list, f"{provider_label} {retry_reason} 감지: {wait_seconds:.1f}초 대기 후 재시도 ({attempt_index + 1}/{retry_label})")
                sleep_with_cancel(wait_seconds, cancel_check=cancel_check)
                record_timing("retry", reason=describe_openai_compat_retry_reason(error, payload_data), wait_seconds=wait_seconds)
                attempt_index += 1
                continue
            edge_detail = cloudflare_error_detail(response)
            status_code = getattr(response, "status_code", None)
            if not stream_response_started and status_code in {400, 401, 402, 403, 404, 413, 422, 429}:
                managed_direct.record_rejection(api_key, direct_request_id, status_code)
                raise ProviderRejectedError(provider_label, status_code, payload=payload_data, cause=error, detail=edge_detail, credentials=(api_key,)) from error
            raise ProviderHttpError(provider_label, status_code, payload=payload_data, cause=error,
                                    detail=edge_detail, credentials=(api_key,)) from error
        except Exception as error:
            if isinstance(error, (ProviderStreamError, ProviderRejectedError)):
                # Keep the explicit failure identity for checkpoint recovery;
                # it is not proof of zero cost and must not trigger a free replay.
                raise
            if log_list is not None and isinstance(error, requests.RequestException):
                image_count = sum(
                    1 for message in messages if isinstance(message, dict)
                    and isinstance(message.get("content"), list)
                    for part in message["content"]
                    if isinstance(part, dict) and part.get("type") == "image_url"
                )
                stage = "응답 수신 중" if stream_response_started else "응답 헤더 수신 전"
                append_status_log(log_list,
                    f"{provider_label} 전송 진단: {stage}, "
                    f"경과 {time.monotonic() - attempt_started:.1f}초, "
                    f"이미지 {image_count}개, 연결·전송/읽기 제한 {timeout}, "
                    f"오류 종류 {type(error).__name__}")
            # A disconnected stream may already be billable. Never silently
            # replay a paid request or accept the partial assistant response.
            if stream_response_started or not retry_ambiguous_errors:
                raise RuntimeError(f"{provider_label} 연결 실패: {error}") from error
            should_retry = should_retry_openai_compat_request(error)
            is_rate_limit = is_openai_compat_rate_limit_error(error)
            has_attempt_budget = (max_retries is None) or (attempt_index < max_retries)
            if has_attempt_budget and should_retry and (retry_on_rate_limit or not is_rate_limit):
                effective_schedule = rate_limit_wait_schedule if is_rate_limit else None
                if is_rate_limit and effective_schedule is None:
                    effective_schedule = DEFAULT_RATE_LIMIT_WAIT_SCHEDULE
                wait_seconds = get_retry_wait_seconds(
                    error,
                    attempt_index,
                    rate_limit_wait_schedule=effective_schedule,
                )
                if log_list is not None:
                    retry_label = "무제한" if max_retries is None else str(max_retries)
                    retry_reason = describe_openai_compat_retry_reason(error)
                    append_status_log(log_list, f"{provider_label} {retry_reason} 감지: {wait_seconds:.1f}초 대기 후 재시도 ({attempt_index + 1}/{retry_label})")
                sleep_with_cancel(wait_seconds, cancel_check=cancel_check)
                record_timing("retry", reason=describe_openai_compat_retry_reason(error), wait_seconds=wait_seconds)
                attempt_index += 1
                continue
            raise RuntimeError(f"{provider_label} 연결 실패: {error}") from error
        finally:
            if response_lines is not None:
                response_lines.close()
            if response is not None:
                close_response(response, background=callable(cancel_check))
