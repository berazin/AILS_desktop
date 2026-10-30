"""Responses SSE adapter preserving AILS text/message/tool/usage contracts."""
import json
import queue
import threading
import time
from contextlib import contextmanager

from chat.stream_cancellation import close_response as close_http_response
from chat.text_verbosity import validate_text_verbosity

from .protocol import ChatGPTError, RESOURCE, error_from_response


def request_body(model, messages, options=None):
    options = dict(options or {})
    # Sampling/output caps from the legacy gateway have no equivalent here.
    # Do not silently pretend that a requested constraint was honored.
    allowed = {"tools", "tool_choice", "parallel_tool_calls", "response_format", "reasoning", "text"}
    if set(options) - allowed:
        raise ChatGPTError("unsupported_capability")
    inputs = []
    for message in messages:
        role = message.get("role")
        if role == "tool":
            inputs.append({"type": "function_call_output", "call_id": message["tool_call_id"],
                           "output": message.get("content") or ""})
            continue
        if role not in {"system", "developer", "user", "assistant"}:
            raise ChatGPTError("unsupported_capability")
        if role == "assistant":
            for item in message.get("_chatgpt_reasoning") or []:
                if item.get("type") != "reasoning" or not item.get("encrypted_content"):
                    raise ChatGPTError("unsupported_capability")
                inputs.append(item)
        content = message.get("content")
        if content:
            if isinstance(content, str):
                converted = content
            elif isinstance(content, list):
                converted = []
                for part in content:
                    if part.get("type") == "text":
                        converted.append({"type": "output_text" if role == "assistant" else "input_text", "text": part["text"]})
                    elif part.get("type") == "image_url" and role == "user":
                        image = part["image_url"]
                        converted.append({"type": "input_image", "image_url": image["url"], "detail": image.get("detail", "auto")})
                    else:
                        raise ChatGPTError("unsupported_capability")
            else:
                raise ChatGPTError("unsupported_capability")
            inputs.append({"role": "developer" if role == "system" else role, "content": converted})
        for call in message.get("tool_calls") or []:
            if call.get("type") != "function":
                raise ChatGPTError("unsupported_capability")
            function = call["function"]
            inputs.append({"type": "function_call", "call_id": call["id"], "name": function["name"],
                           "namespace": "ails", "arguments": function["arguments"]})
    body = {"model": model, "input": inputs, "store": False, "stream": True,
            "include": ["reasoning.encrypted_content"]}
    if "text" in options:
        text = options["text"]
        if not isinstance(text, dict) or set(text) != {"verbosity"}:
            raise ChatGPTError("unsupported_capability")
        body["text"] = {"verbosity": validate_text_verbosity(text["verbosity"])}
    tools = options.get("tools") or []
    if tools:
        functions = []
        for tool in tools:
            if tool.get("type") != "function" or not isinstance(tool.get("function"), dict):
                raise ChatGPTError("unsupported_capability")
            # Existing AILS tools allow omitted arguments (context/query/etc.).
            # Their legacy strict flag is incompatible with Responses strict
            # schemas, which require every property. Preserve optional inputs
            # and explicitly opt out after copying the legacy definition.
            functions.append({**tool["function"], "type": "function", "strict": False})
        body["tools"] = [{"type": "namespace", "name": "ails", "description": "AILS local application tools", "tools": functions}]
    for key in ("tool_choice", "parallel_tool_calls", "reasoning"):
        if key in options:
            if key == "tool_choice" and isinstance(options[key], dict):
                raise ChatGPTError("unsupported_capability")
            body[key] = options[key]
    format_ = options.get("response_format")
    if format_:
        if format_.get("type") == "json_schema":
            body.setdefault("text", {})["format"] = {"type": "json_schema", **format_["json_schema"]}
        elif format_.get("type") in {"json_object", "text"}:
            body.setdefault("text", {})["format"] = format_
        else:
            raise ChatGPTError("unsupported_capability")
    from ai_request_limits import prepare_generation_request
    return prepare_generation_request(body)


def sse_events(response):
    data = []
    size = 0
    for line in response.iter_lines(chunk_size=1):
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if not line:
            if data:
                raw = "\n".join(data)
                if raw != "[DONE]":
                    event = json.loads(raw)
                    if not isinstance(event, dict):
                        raise ChatGPTError("invalid_stream")
                    yield event
                data = []
                size = 0
        elif line.startswith("data:"):
            data.append(line[5:].lstrip(" "))
            size += len(line)
            if size > 16 * 1024 * 1024:
                raise ChatGPTError("invalid_stream")
    # A complete SSE event requires a blank line. Never accept a truncated one.


def cancellable_events(response, check, timing_callback=None):
    """Poll cancellation even when the peer stops producing bytes.

    requests' blocking reader cannot be interrupted with a cancellation flag.
    A bounded queue keeps the worker from buffering an unbounded response. Its
    socket timeout still bounds a stalled read after cancellation.
    """
    events = queue.Queue(maxsize=8)
    stopped = threading.Event()

    def put(item):
        while not stopped.is_set():
            try:
                events.put(item, timeout=0.2)
                return
            except queue.Full:
                pass

    def read():
        first_event, first_content = True, True
        try:
            for event in sse_events(response):
                if stopped.is_set():
                    return
                kind = event.get("type")
                if callable(timing_callback):
                    if first_event:
                        timing_callback("first_sse_event", {"at": time.monotonic(), "precise_at": time.perf_counter()})
                        first_event = False
                    if first_content and kind in {"response.output_text.delta", "response.refusal.delta", "response.function_call_arguments.delta"}:
                        timing_callback("first_content", {"at": time.monotonic(), "precise_at": time.perf_counter()})
                        first_content = False
                    if kind == "response.completed":
                        timing_callback("provider_request_end", {"at": time.monotonic(), "precise_at": time.perf_counter()})
                put(("event", event))
        except Exception as error:
            put(("error", error))
        finally:
            put(("end", None))

    reader = threading.Thread(target=read, daemon=True, name="chatgpt-stream")
    reader.start()
    try:
        while True:
            check()
            try:
                kind, value = events.get(timeout=0.2)
            except queue.Empty:
                continue
            if kind == "end":
                return
            if kind == "error":
                raise value
            yield value
    finally:
        stopped.set()


def close_response(response):
    close_http_response(response, background=True)


def completed_message(response):
    text, calls, reasoning = [], [], []
    for item in response.get("output", []):
        if item.get("type") == "message":
            for part in item.get("content", []):
                if part.get("type") == "output_text":
                    text.append(part.get("text", ""))
                elif part.get("type") == "refusal":
                    text.append(part.get("refusal", ""))
                else:
                    raise ChatGPTError("unsupported_capability")
        elif item.get("type") == "function_call":
            if item.get("namespace", "ails") != "ails":
                raise ChatGPTError("unsupported_capability")
            calls.append({"id": item["call_id"], "type": "function", "function": {
                "name": item["name"], "arguments": item["arguments"]}})
        elif item.get("type") == "reasoning":
            if item.get("encrypted_content"):
                reasoning.append(item)
        else:
            raise ChatGPTError("unsupported_capability")
    message = {"role": "assistant", "content": "".join(text)}
    if calls:
        message["tool_calls"] = calls
        if reasoning:
            # Stateless tool continuation needs the provider's opaque
            # reasoning items; never convert them into displayed text.
            message["_chatgpt_reasoning"] = reasoning
    return message


@contextmanager
def _auth_timing(callback):
    started = time.perf_counter()
    if callable(callback):
        callback("provider_auth_start", {"at": time.monotonic(), "precise_at": started})
    try:
        yield
    finally:
        if callable(callback):
            finished = time.perf_counter()
            callback("provider_auth_end", {"at": time.monotonic(), "precise_at": finished, "duration_s": finished - started})


def call(account, identity, model, messages, *, request_options=None, cancel_check=None,
         debug_trace_callback=None, debug_trace_label="", return_message=False,
         timing_callback=None, timeout=120, total_timeout=None, **_legacy_options):
    import requests
    if callable(cancel_check):
        cancel_check()
    body = request_body(model, messages, request_options)
    with _auth_timing(timing_callback):
        token, _ = account.access(expected=identity)
    session_cancel = account.session_cancel
    last_identity_check = 0.0
    def check(force=False):
        nonlocal last_identity_check
        if callable(cancel_check):
            cancel_check()
        if session_cancel.is_set():
            raise ChatGPTError("reconnect_required")
        # Local disconnect is immediate. Also detect another process's changes
        # without decrypting the vault for every token in a high-rate stream.
        if force or time.monotonic() - last_identity_check > 1:
            with _auth_timing(timing_callback), account.vault.locked():
                record = account.vault.read()
            if not record.get("access_token") or tuple(identity) != (
                    record.get("client_id"), record.get("subject"), record.get("generation")):
                raise ChatGPTError("reconnect_required")
            last_identity_check = time.monotonic()
        if total_timeout and time.monotonic() - started > total_timeout:
            raise ChatGPTError("stream_interrupted")

    started = time.monotonic()
    check()
    response = None
    events = None
    try:
        if callable(timing_callback):
            timing_callback("provider_request_start", {"at": time.monotonic(), "precise_at": time.perf_counter(), "provider": "ChatGPT 구독"})
        # No automatic HTTP retries and no alternate paid-provider path.
        response = requests.post(RESOURCE + "/responses", headers={"Authorization": "Bearer " + token},
                                 json=body, stream=True, timeout=(15, min(float(timeout[-1] if isinstance(timeout, tuple) else timeout), 120)), allow_redirects=False)
        if callable(timing_callback):
            timing_callback("headers_received", {"at": time.monotonic(), "precise_at": time.perf_counter()})
        if response.status_code != 200:
            raise error_from_response(response)
        # Some ChatGPT plan responses omit Content-Type despite sending SSE.
        # Missing metadata is not proof of a bad body: the SSE parser and
        # response.completed/status checks below still validate completion.
        content_type = response.headers.get("content-type", "").strip().lower()
        if content_type and "text/event-stream" not in content_type:
            raise ChatGPTError("invalid_stream")
        with account.lock:
            check()
            account.streams.add(response)
        completed_output = {}
        events = cancellable_events(response, check, timing_callback)
        for event in events:
            check()
            kind = event.get("type")
            if kind in {"response.output_text.delta", "response.refusal.delta"}:
                if callable(debug_trace_callback):
                    debug_trace_callback(debug_trace_label or "ChatGPT", event.get("delta", ""), "token")
            elif kind == "response.output_item.done":
                index, item = event.get("output_index"), event.get("item")
                if type(index) is not int or index < 0 or not isinstance(item, dict):
                    raise ChatGPTError("invalid_stream")
                completed_output[index] = item
            elif kind in {"error", "response.failed"}:
                error = event.get("response", {}).get("error") or event.get("error") or event
                raise ChatGPTError(error.get("code") or "response_failed", request_id=response.headers.get("x-request-id", ""))
            elif kind == "response.incomplete":
                raise ChatGPTError("response_incomplete")
            elif kind == "response.completed":
                check(force=True)
                result = event.get("response") or {}
                if result.get("status") != "completed":
                    raise ChatGPTError("invalid_stream")
                # ChatGPT plan streams can omit output from the terminal
                # envelope. Only completed items are safe to assemble, and
                # only after a successful terminal event (never from deltas).
                if not result.get("output") and completed_output:
                    result = {**result, "output": [completed_output[index] for index in sorted(completed_output)]}
                message = completed_message(result)
                for tool in message.get("tool_calls", []):
                    if callable(debug_trace_callback):
                        debug_trace_callback(debug_trace_label or "ChatGPT", json.dumps(tool), "tool_call")
                usage = result.get("usage") or {}
                details = usage.get("output_tokens_details") or {}
                reported = (result.get("reasoning") or {}).get("effort")
                measured_usage = {
                    "input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0),
                    "cached_input_tokens": (usage.get("input_tokens_details") or {}).get("cached_tokens", 0),
                    "model": model, "billing_mode": "chatgpt", "source": "response",
                    "requested_reasoning_effort": (body.get("reasoning") or {}).get("effort", "default"),
                }
                if "reasoning_tokens" in details:
                    measured_usage["thought_tokens"] = details["reasoning_tokens"]
                if reported in {"none", "minimal", "low", "medium", "high", "xhigh", "max"}:
                    measured_usage["reported_reasoning_effort"] = reported
                return (message if return_message else message["content"]), measured_usage
        raise ChatGPTError("stream_interrupted")
    except (requests.RequestException, ValueError, UnicodeError):
        raise ChatGPTError("stream_interrupted" if response is not None else "network_error") from None
    finally:
        if events is not None:
            events.close()
        if response is not None:
            with account.lock:
                account.streams.discard(response)
            close_response(response)
