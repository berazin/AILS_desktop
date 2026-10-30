from __future__ import annotations

import asyncio
import json
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from chat.context_composer import estimate_tokens
from ai_request_limits import enforce_request_input_limit, without_output_limits


def estimate_message_tokens(messages: object) -> int:
    """공급자가 usage를 주지 않았을 때 쓰는 보수적 입력 토큰 추정."""

    total = 0
    for message in messages if isinstance(messages, list) else []:
        if not isinstance(message, Mapping):
            continue
        total += estimate_tokens(message.get("content"))
        for call in message.get("tool_calls") or []:
            if isinstance(call, Mapping):
                total += estimate_tokens(json.dumps(call, ensure_ascii=False))
    return total


def openai_compatible_base_url(endpoint: object) -> str:
    """Return the API root expected by AsyncOpenAI from a chat endpoint or root."""
    value = str(endpoint or "").strip().rstrip("/")
    if not value:
        raise ValueError("OpenAI-compatible endpoint is required.")
    parsed = urlsplit(value)
    path = parsed.path.rstrip("/")
    for suffix in ("/chat/completions", "/responses"):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
            break
    return urlunsplit((parsed.scheme, parsed.netloc, path or "/", "", "")).rstrip("/")


def messages_to_agents_input(messages: object) -> tuple[str, list[dict[str, Any]]]:
    """Convert the existing Chat Completions transcript to Agents SDK input items."""
    instructions: list[str] = []
    items: list[dict[str, Any]] = []
    for message in messages if isinstance(messages, list) else []:
        if not isinstance(message, Mapping):
            continue
        role = str(message.get("role") or "").strip()
        content = message.get("content", "")
        if role in {"system", "developer"}:
            text = str(content or "").strip()
            if text:
                instructions.append(text)
            continue
        if role in {"user", "assistant"}:
            if content:
                items.append({"role": role, "content": content})
            tool_calls = message.get("tool_calls")
            for call in tool_calls if isinstance(tool_calls, list) else []:
                if not isinstance(call, Mapping):
                    continue
                function = call.get("function")
                if not isinstance(function, Mapping):
                    continue
                call_id = str(call.get("id") or "").strip()
                name = str(function.get("name") or "").strip()
                arguments = str(function.get("arguments") or "{}").strip() or "{}"
                if call_id and name:
                    items.append({
                        "type": "function_call",
                        "call_id": call_id,
                        "name": name,
                        "arguments": arguments,
                    })
            continue
        if role == "tool":
            call_id = str(message.get("tool_call_id") or "").strip()
            if call_id:
                items.append({
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": str(content or ""),
                })
    return "\n\n".join(instructions), items


def _tool_call_payload(interruption: object) -> dict[str, Any] | None:
    raw_item = getattr(interruption, "raw_item", None)
    if isinstance(raw_item, Mapping):
        call_id = str(raw_item.get("call_id") or raw_item.get("id") or "").strip()
        name = str(raw_item.get("name") or getattr(interruption, "tool_name", None) or "").strip()
        arguments = raw_item.get("arguments", "{}")
    else:
        call_id = str(getattr(raw_item, "call_id", None) or getattr(raw_item, "id", None) or "").strip()
        name = str(getattr(raw_item, "name", None) or getattr(interruption, "tool_name", None) or "").strip()
        arguments = getattr(raw_item, "arguments", "{}")
    if not call_id or not name:
        return None
    if not isinstance(arguments, str):
        arguments = json.dumps(arguments, ensure_ascii=False, separators=(",", ":"))
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": arguments or "{}"},
    }


def _model_settings(request_options: Mapping | None, sdk: Mapping[str, Any]):
    source = without_output_limits(dict(request_options or {}))
    known_keys = {
        "temperature",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "tool_choice",
        "parallel_tool_calls",
        "reasoning",
        "timeout",
    }
    settings = {key: source[key] for key in known_keys if source.get(key) is not None}
    extra_body = {
        key: value
        for key, value in source.items()
        if key not in known_keys and key not in {"tools", "cache_prompt"}
    }
    if extra_body:
        settings["extra_body"] = extra_body
    settings.setdefault("include_usage", True)
    return sdk["ModelSettings"](**settings)


def _load_sdk() -> dict[str, Any]:
    try:
        from agents import Agent, FunctionTool, ModelSettings, OpenAIChatCompletionsModel, RunConfig, Runner
        from openai import AsyncOpenAI
    except ImportError as error:
        raise RuntimeError(
            "OpenAI Agents SDK가 설치되어 있지 않습니다. requirements.txt를 설치한 뒤 다시 시도하세요."
        ) from error
    return {
        "Agent": Agent,
        "AsyncOpenAI": AsyncOpenAI,
        "FunctionTool": FunctionTool,
        "ModelSettings": ModelSettings,
        "OpenAIChatCompletionsModel": OpenAIChatCompletionsModel,
        "RunConfig": RunConfig,
        "Runner": Runner,
    }


def start_openai_agents_sdk_warmup(
    on_error: Callable[[Exception], None] | None = None,
) -> threading.Thread:
    """Load the Agents SDK off the request path so the first chat stays responsive."""

    def warmup() -> None:
        try:
            _load_sdk()
        except Exception as error:
            if on_error is not None:
                on_error(error)

    thread = threading.Thread(target=warmup, name="ails-agents-sdk-warmup", daemon=True)
    thread.start()
    return thread


async def _stream_openai_agents_sdk(
    base_url: str,
    api_key: str,
    model_name: str,
    messages: list[dict],
    *,
    tool_schemas: list[dict] | None,
    request_options: Mapping | None,
    debug_trace_callback: Callable[[str, object, str], None] | None,
    debug_trace_label: str,
    default_headers: Mapping[str, str] | None,
    stream: bool,
    timing_callback: Callable[[str, dict], None] | None,
    sdk: Mapping[str, Any],
) -> tuple[str, dict[str, int]]:
    enforce_request_input_limit({**without_output_limits(dict(request_options or {})),
                                "model": model_name, "messages": messages, "tools": tool_schemas or []})
    instructions, input_items = messages_to_agents_input(messages)
    if debug_trace_callback is not None:
        if timing_callback is not None:
            timing_callback("sdk_prompt_trace_start", {"at": time.monotonic()})
        debug_trace_callback(
            debug_trace_label,
            json.dumps(messages, ensure_ascii=False),
            "prompt",
        )
        if timing_callback is not None:
            timing_callback("sdk_prompt_trace_done", {"at": time.monotonic()})

    async def pending_client_tool(_context, _arguments):
        raise RuntimeError("AILS UI tools must be executed by the Electron renderer.")

    tools = []
    for schema in tool_schemas or []:
        function = schema.get("function") if isinstance(schema, Mapping) else None
        if not isinstance(function, Mapping):
            continue
        name = str(function.get("name") or "").strip()
        if not name:
            continue
        tools.append(sdk["FunctionTool"](
            name=name,
            description=str(function.get("description") or ""),
            params_json_schema=dict(function.get("parameters") or {"type": "object", "properties": {}}),
            on_invoke_tool=pending_client_tool,
            strict_json_schema=False,
            needs_approval=True,
        ))

    http_client = None
    if timing_callback is not None:
        import httpx

        request_attempts = 0

        async def on_request(_request):
            nonlocal request_attempts
            request_attempts += 1
            if request_attempts > 1:
                timing_callback("retry", {"at": time.monotonic(), "attempt": request_attempts - 1, "reason": "sdk_retry"})
            timing_callback("provider_request_start", {"at": time.monotonic(), "attempt": request_attempts})

        async def on_response(response):
            provider = (
                response.headers.get("x-vercel-ai-gateway-provider")
                or response.headers.get("x-openrouter-provider")
                or ""
            )
            timing_callback("headers_received", {
                "at": time.monotonic(), "attempt": request_attempts,
                "provider": provider, "status_code": response.status_code,
            })

        http_client = httpx.AsyncClient(timeout=600.0, event_hooks={"request": [on_request], "response": [on_response]})

    client = sdk["AsyncOpenAI"](
        api_key=str(api_key or "unused"),
        base_url=openai_compatible_base_url(base_url),
        default_headers=dict(default_headers or {}),
        max_retries=1,
        **({"http_client": http_client} if http_client is not None else {}),
    )
    model = sdk["OpenAIChatCompletionsModel"](
        model=model_name,
        openai_client=client,
        buffer_streamed_tool_calls=True,
    )
    agent = sdk["Agent"](
        name="AILS Workspace Agent",
        instructions=instructions,
        model=model,
        model_settings=_model_settings(request_options, sdk),
        tools=tools,
    )
    if timing_callback is not None:
        timing_callback("sdk_ready", {"at": time.monotonic()})
    run_options = {
        "max_turns": 1,
        "run_config": sdk["RunConfig"](
            tracing_disabled=True,
            trace_include_sensitive_data=False,
            workflow_name="AILS workspace agent",
        ),
    }
    answer_parts: list[str] = []
    first_sse_seen = False
    first_content_seen = False
    try:
        if stream:
            result = sdk["Runner"].run_streamed(agent, input_items, **run_options)
            if timing_callback is not None:
                timing_callback("sdk_run_start", {"at": time.monotonic()})
            async for event in result.stream_events():
                if getattr(event, "type", "") != "raw_response_event":
                    continue
                if timing_callback is not None and not first_sse_seen:
                    first_sse_seen = True
                    timing_callback("first_sse_event", {"at": time.monotonic(), "attempt": max(1, request_attempts)})
                data = getattr(event, "data", None)
                if getattr(data, "type", "") != "response.output_text.delta":
                    continue
                token = str(getattr(data, "delta", "") or "")
                if not token:
                    continue
                if timing_callback is not None and not first_content_seen:
                    first_content_seen = True
                    timing_callback("first_content", {"at": time.monotonic(), "attempt": max(1, request_attempts)})
                answer_parts.append(token)
                if debug_trace_callback is not None:
                    debug_trace_callback(debug_trace_label, token, "token")
        else:
            result = await sdk["Runner"].run(agent, input_items, **run_options)
            final_token = str(getattr(result, "final_output", "") or "").strip()
            if final_token:
                answer_parts.append(final_token)
                if debug_trace_callback is not None:
                    debug_trace_callback(debug_trace_label, final_token, "token")
        for interruption in list(getattr(result, "interruptions", None) or []):
            payload = _tool_call_payload(interruption)
            if payload is not None and debug_trace_callback is not None:
                if timing_callback is not None and not first_content_seen:
                    first_content_seen = True
                    timing_callback("first_content", {"at": time.monotonic(), "content_type": "tool_call"})
                debug_trace_callback(
                    debug_trace_label,
                    json.dumps(payload, ensure_ascii=False),
                    "tool_call",
                )
        final_output = str(getattr(result, "final_output", "") or "").strip()
        answer = final_output or "".join(answer_parts).strip()
        usage_value = getattr(getattr(result, "context_wrapper", None), "usage", None)
        input_tokens = int(getattr(usage_value, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage_value, "output_tokens", 0) or 0)
        total_tokens = int(getattr(usage_value, "total_tokens", 0) or 0)
        usage = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
        }
        # 공급자가 실제 usage를 주지 않은 0 값은 추정으로 구별해 표시한다.
        if input_tokens or output_tokens or total_tokens:
            usage["source"] = "api"
            usage["input_tokens"] = input_tokens or total_tokens - output_tokens
            usage["output_tokens"] = output_tokens or max(0, total_tokens - (usage["input_tokens"] or 0))
        else:
            usage["source"] = "estimated"
            usage["input_tokens"] = estimate_message_tokens(messages)
            usage["output_tokens"] = estimate_tokens(answer)
            usage["total_tokens"] = usage["input_tokens"] + usage["output_tokens"]
        cached = int(getattr(getattr(usage_value, "input_tokens_details", None), "cached_tokens", 0) or 0)
        if cached:
            usage["prompt_cache_hit_tokens"] = cached
        return answer, usage
    finally:
        await client.close()
        if http_client is not None:
            await http_client.aclose()


def stream_openai_agents_sdk(
    base_url: str,
    api_key: str,
    model_name: str,
    messages: list[dict],
    *,
    tool_schemas: list[dict] | None = None,
    request_options: Mapping | None = None,
    debug_trace_callback: Callable[[str, object, str], None] | None = None,
    debug_trace_label: str = "OpenAI Agents SDK",
    default_headers: Mapping[str, str] | None = None,
    stream: bool = True,
    timing_callback: Callable[[str, dict], None] | None = None,
    _sdk: Mapping[str, Any] | None = None,
) -> tuple[str, dict[str, int]]:
    """Run one AILS agent turn with the OpenAI Agents SDK and stream renderer events."""
    return asyncio.run(_stream_openai_agents_sdk(
        base_url,
        api_key,
        model_name,
        messages,
        tool_schemas=tool_schemas,
        request_options=request_options,
        debug_trace_callback=debug_trace_callback,
        debug_trace_label=debug_trace_label,
        default_headers=default_headers,
        stream=stream,
        timing_callback=timing_callback,
        sdk=dict(_sdk or _load_sdk()),
    ))
