"""ResponseWorkflow: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from chat.conversation_support import (
    ChatbotRequestTiming,
    LMSTUDIO_DEFAULT_BASE_URL,
    LocalAnswerStream,
    Mapping,
    PROVIDER_DEEPSEEK,
    PROVIDER_GEMINI,
    PROVIDER_LMSTUDIO,
    VOICE_AGENT_RUNTIME,
    ai_model_selection,
    call_openai_compatible_chat,
    capture,
    chatbot_managed_options,
    chatbot_reasoning_options,
    chatbot_text_options,
    common,
    edition_manifest,
    json,
    language_output_directive,
    model_spec,
    normalize_latex_math_syntax,
    nullcontext,
    parse_streamed_voice_tool_call,
    prioritize_chatbot,
    providers,
    question_reasoning_effort,
    question_text_verbosity,
    re,
    time,
    voice,
)


@dataclass(frozen=True)
class ResponseWorkflowPorts:
    append_ai_debug_trace: Callable[..., Any]
    append_idle_log: Callable[..., Any]
    call_managed_gateway_chat: Callable[..., Any]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    prepare_chatbot_turn: Callable[..., Any]
    selected_ai_model: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]
    get_config: Callable[..., Any]


class ResponseWorkflow:
    def __init__(self, ports: ResponseWorkflowPorts):
        self._ports = ports
        self.append_ai_debug_trace = ports.append_ai_debug_trace
        self.append_idle_log = ports.append_idle_log
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.prepare_chatbot_turn = ports.prepare_chatbot_turn
        self.selected_ai_model = ports.selected_ai_model
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    @property
    def config(self):
        return self._ports.get_config()

    def chatbot_gateway_request_options(self, request_options=None, *, model_name="", provider="Vercel AI Gateway", transport=None):
        options = dict(request_options or {})
        if transport == "chatgpt":
            return options
        if model_name == "deepseek/deepseek-v4-flash":
            options.setdefault("reasoning", {"effort": "none"})
        if self.config.get("chatbot_zdr_enabled") is True:
            if provider == "OpenRouter":
                options["provider"] = {**options.get("provider", {}), "zdr": True}
            else:
                provider_options = dict(options.get("providerOptions") or {})
                options["providerOptions"] = {**provider_options, "gateway": {**provider_options.get("gateway", {}), "zeroDataRetention": True}}
        return options

    def chatbot_expert_answer(self, payload: dict):
        question = str(payload.get("question") or "").strip()
        if not question or len(question) > 12000:
            raise ValueError("복잡한 추론 질문은 1~12000자여야 합니다.")
        context = str(payload.get("context") or "").strip()[:12000]
        expert_directive = language_output_directive(self.config.get("language"))
        messages = [
            {
                "role": "system",
                "content": (
                    "당신은 AILS 학습 에이전트가 복잡한 추론을 위임하는 전문 튜터입니다. "
                    "질문과 제공된 문맥을 근거로 정확한 한국어 답변을 작성하세요. "
                    "근거가 부족하면 추측하지 말고 부족한 정보를 명시하세요."
                    + (f"\n\n{expert_directive}" if expert_directive else "")
                ),
            },
            {
                "role": "user",
                "content": f"질문:\n{question}" + (f"\n\n관련 문맥:\n{context}" if context else ""),
            },
        ]
        if self.workflow_uses_managed_ai("chatbot"):
            with self.managed_ai_action("chatbot", request_messages=messages, **self.managed_workflow_options("chatbot")) as session:
                model_name = str(session["model_id"])
                answer, usage = self.call_managed_gateway_chat(
                    session, messages, max_retries=0, timeout=180,
                )
            provider_label = session.get("provider", "AILS Cloud")
        else:
            provider, model_name = self.local_provider_model("chatbot")
            if provider == "llama.cpp":
                with VOICE_AGENT_RUNTIME.session(model_name) as (endpoint, alias):
                    answer, usage = call_openai_compatible_chat(
                        endpoint, "", alias, messages, provider_label="llama.cpp expert",
                        allow_empty_api_key=True, max_retries=0, timeout=180,
                    )
            elif provider == PROVIDER_GEMINI:
                raise ValueError("Personal Gemini API connections are no longer supported.")
            else:
                endpoint, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(provider, model_name)
                answer, usage = call_openai_compatible_chat(
                    endpoint, api_key, model_name, messages,
                    provider_label=f"{label} expert", allow_empty_api_key=allow_empty,
                    max_retries=0, timeout=180,
                )
            provider_label = providers.provider_to_ui(provider)
        return {
            "ok": True,
            "answer": normalize_latex_math_syntax(answer),
            "model": model_name,
            "provider": provider_label,
            "usage": usage,
        }

    def resolve_chatbot_openai_config(self, provider: str, model_name: str):
        if provider != PROVIDER_LMSTUDIO:
            raise ValueError("Personal cloud API connections are no longer supported.")
        from urllib.parse import urlsplit
        base_url = str(self.config.get("lmstudio_base_url") or LMSTUDIO_DEFAULT_BASE_URL)
        if urlsplit(base_url).hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Local model endpoint must be loopback.")
        return base_url, "", model_name, "LM Studio", True

    def stream_chatbot_reply(self, payload: dict, emit, *, cancel_check=None):
        timing = ChatbotRequestTiming(round_index=len(payload.get("tool_rounds") or []) + 1)
        try:
            with capture(timing), prioritize_chatbot():
                timing.mark("priority_ready")
                result = self._stream_chatbot_reply(payload, emit, timing=timing, cancel_check=cancel_check)
        except BaseException as error:
            timing.finish(error)
            raise
        timing.finish()
        return result

    def _stream_chatbot_reply(self, payload: dict, emit, *, timing: ChatbotRequestTiming, cancel_check=None):
        def check_cancelled():
            if callable(cancel_check):
                cancel_check()
        check_cancelled()
        reasoning_effort = question_reasoning_effort(payload)
        text_verbosity = question_text_verbosity(payload)
        started_at = timing.started_at
        prepared = self.prepare_chatbot_turn(payload)
        check_cancelled()
        prepared_at = time.monotonic()
        provider = prepared["provider"]
        model_name = prepared["model_name"]
        timing.identify(model=model_name, provider=provider, memory_retrieve_ms=prepared["metrics"].get("memory_retrieve_ms"))
        timing.mark("prepare_completed", at=prepared_at)
        messages = prepared["messages"]
        first_event_at: float | None = None
        model_first_event_at: float | None = None
        provider_stages: dict[str, float] = {}
        routed_provider = ""
        retry_count = 0
        fallback_count = 0
        metrics_traced = {"value": False}
        assist_mode = payload.get("assist_mode") is True and provider != "llama.cpp"
        force_cloud = payload.get("force_cloud") is True
        fallback_policy = str(
            payload.get("cloud_fallback_policy")
            or self.config.get("ai_assist_cloud_fallback_policy")
            or "manual"
        ).strip().casefold()
        local_failure = ""
        local_draft = ""
        local_cloud_reason = ""
        local_output_emitted = False

        def on_provider_timing(stage: str, details: Mapping) -> None:
            nonlocal routed_provider, retry_count, fallback_count
            observed_at = float(details.get("at") or time.monotonic())
            if stage == "retry":
                retry_count += 1
            elif stage == "fallback":
                fallback_count += 1
            elif stage not in provider_stages or stage == "response_completed":
                provider_stages[stage] = observed_at
            if stage == "headers_received" and details.get("provider"):
                routed_provider = str(details["provider"])
            timing.mark(stage, details, at=observed_at)

        def emit_event(event: Mapping, observed_at: float | None = None) -> None:
            nonlocal first_event_at
            check_cancelled()
            if first_event_at is None and str(event.get("type") or "") in {"token", "tool_call", "done"}:
                first_event_at = observed_at if observed_at is not None else time.monotonic()
            emit(event)
            if str(event.get("type") or "") in {"token", "tool_call", "done"}:
                timing.mark("first_output", at=first_event_at)

        def context_metrics(error: Exception | None = None) -> dict:
            nonlocal first_event_at
            completed_at = time.monotonic()
            if first_event_at is None and error is None:
                first_event_at = completed_at
            metrics = dict(prepared["metrics"])
            metrics["request_id"] = timing.record["request_id"]
            metrics["round_index"] = len(payload.get("tool_rounds") or []) + 1
            metrics["prepare_ms"] = round((prepared_at - started_at) * 1000, 1)
            metrics["first_event_ms"] = round((first_event_at - started_at) * 1000, 1) if first_event_at is not None else None
            if error is not None:
                metrics["error_type"] = type(error).__name__
            if model_first_event_at is not None:
                metrics["model_first_event_ms"] = round((model_first_event_at - prepared_at) * 1000, 1)
            metrics["total_ms"] = round((completed_at - started_at) * 1000, 1)
            metrics["provider"] = routed_provider or provider
            metrics["provider_source"] = "response_header" if routed_provider else "configured"
            metrics["retry_count"] = retry_count
            metrics["fallback_count"] = fallback_count
            for stage in (
                "session_request_start", "session_ready",
                "provider_request_start", "headers_received", "first_sse_event", "first_content",
                "response_completed", "settlement_start", "settlement_completed",
            ):
                observed_at = provider_stages.get(stage)
                metrics[f"{stage}_ms"] = round((observed_at - started_at) * 1000, 1) if observed_at is not None else None
            if not metrics_traced["value"]:
                metrics_traced["value"] = True
                self.append_ai_debug_trace(
                    "chatbot context metrics",
                    json.dumps(metrics, ensure_ascii=False),
                    "info",
                    source="system",
                )
            return metrics

        if force_cloud and provider == "llama.cpp":
            raise ValueError("클라우드 답변을 사용하려면 챗봇 모델 설정에서 클라우드 모델을 선택해 주세요.")
        selected_local_model_id = model_name if provider == "llama.cpp" or model_name in ai_model_selection.CHATBOT_LOCAL_AGENT_MODEL_IDS else ""
        local_attempted = bool(assist_mode or selected_local_model_id) and not force_cloud
        if local_attempted:
            assist_local_model_id = selected_local_model_id or voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(
                self.config.get("local_voice_agent_model")
            )
            local_tool_events = []
            local_stream = LocalAnswerStream()
            local_model = str(model_spec(assist_local_model_id)["alias"])
            timing.identify(model=local_model, provider="llama.cpp")

            def emit_local_token(token, observed_at=None):
                nonlocal local_output_emitted
                if token:
                    local_output_emitted = True
                    emit_event({"type": "token", "token": token}, observed_at)

            def local_stream_event(label, value, event_type):
                nonlocal model_first_event_at
                self.append_ai_debug_trace(label, value, event_type, source="local", model=local_model)
                if event_type == "token":
                    token = str(value or "")
                    if token:
                        observed_at = time.monotonic()
                        if model_first_event_at is None:
                            model_first_event_at = observed_at
                        emit_local_token(local_stream.feed(token), observed_at)
                elif event_type == "tool_call":
                    if model_first_event_at is None:
                        model_first_event_at = time.monotonic()
                    # Tools are committed only if this local round is retained.
                    local_tool_events.append({"type": "tool_call", **parse_streamed_voice_tool_call(value)})

            try:
                local_session = (VOICE_AGENT_RUNTIME.session(assist_local_model_id) if provider == "llama.cpp"
                                 else nullcontext((VOICE_AGENT_RUNTIME.endpoint(assist_local_model_id), local_model)))
                with local_session as (local_endpoint, local_model):
                    local_answer, usage = call_openai_compatible_chat(
                        local_endpoint, "", local_model, messages,
                        provider_label="llama.cpp AI Assist", allow_empty_api_key=True,
                        max_retries=0, timeout=90,
                        debug_trace_callback=local_stream_event,
                        debug_trace_label="llama.cpp AI Assist stream",
                        timing_callback=on_provider_timing,
                        cancel_check=check_cancelled,
                        request_options={
                            **({"tools": prepared["tool_schemas"], "tool_choice": "auto"}
                               if prepared["tool_schemas"] else {}),
                            "temperature": 0.2, "cache_prompt": True,
                        },
                    )
                    on_provider_timing("response_completed", {"at": time.monotonic()})
                emit_local_token(local_stream.finish())
                marker = re.search(r"\[\[CLOUD_RECOMMENDED:(.{1,300}?)\]\]", str(local_answer or ""), re.DOTALL)
                cloud_reason = common.normalize_whitespace(marker.group(1)) if marker else ""
                clean_answer = re.sub(r"\s*\[\[CLOUD_RECOMMENDED:.{1,300}?\]\]\s*", "", str(local_answer or ""), flags=re.DOTALL).strip()
                search_unavailable = False
                for round_value in payload.get("tool_rounds") if isinstance(payload.get("tool_rounds"), list) else []:
                    calls = round_value.get("calls") if isinstance(round_value, Mapping) else []
                    results = round_value.get("results") if isinstance(round_value, Mapping) else []
                    if any(isinstance(call, Mapping) and call.get("name") == "search_context" for call in calls):
                        for result in results if isinstance(results, list) else []:
                            try:
                                parsed = json.loads(str(result.get("content") or "{}"))
                            except (AttributeError, json.JSONDecodeError):
                                continue
                            nested = parsed.get("result") if isinstance(parsed, Mapping) else None
                            if isinstance(nested, str):
                                try:
                                    nested = json.loads(nested)
                                except json.JSONDecodeError:
                                    nested = None
                            if isinstance(nested, Mapping):
                                parsed = nested
                            if not isinstance(parsed, Mapping):
                                continue
                            if parsed.get("status") in {"unavailable", "indexing"} or not parsed.get("chunks"):
                                search_unavailable = True
                if search_unavailable and not cloud_reason:
                    cloud_reason = "현재 문서에서 충분한 근거를 찾지 못했습니다."
                cloud_recommended = bool(cloud_reason)
                if provider == "llama.cpp" or not (cloud_recommended and fallback_policy == "automatic"):
                    for event in local_tool_events:
                        emit_event(event)
                    if clean_answer and not local_output_emitted:
                        emit_local_token(clean_answer)
                    emit_event({
                        "type": "done",
                        "answer": normalize_latex_math_syntax(clean_answer),
                        "model": local_model,
                        "provider": "llama.cpp",
                        "usage": usage or {},
                        "answer_source": "local",
                        "cloud_recommended": cloud_recommended,
                        "cloud_reason": cloud_reason or None,
                        "context_metrics": context_metrics(),
                    })
                    return
                local_draft = clean_answer
                local_cloud_reason = cloud_reason
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError) as error:
                context_metrics(error)
                raise
            except Exception as error:
                if selected_local_model_id and not assist_mode:
                    raise RuntimeError(
                        f"선택한 로컬 모델 {model_spec(selected_local_model_id)['label']}을 사용할 수 없습니다: {error}"
                    ) from error
                local_failure = common.normalize_whitespace(error)[:500]
                self.append_ai_debug_trace(
                    "llama.cpp AI Assist error",
                    local_failure,
                    "error",
                    source="local",
                    model=local_model,
                )

        if assist_mode:
            if local_output_emitted:
                # Replace the visible local draft before streaming its cloud successor.
                emit_event({"type": "reset"})
            if local_attempted:
                on_provider_timing("fallback", {"at": time.monotonic()})
            cloud_payload = dict(payload)
            cloud_payload["force_cloud"] = True
            cloud_prepared = self.prepare_chatbot_turn(cloud_payload)
            provider = cloud_prepared["provider"]
            model_name = cloud_prepared["model_name"]
            messages = cloud_prepared["messages"]
            prepared = cloud_prepared
            timing.identify(model=model_name, provider=provider)
            if local_draft:
                messages.append({"role": "assistant", "content": local_draft})
            cloud_reason = local_cloud_reason or local_failure
            if cloud_reason:
                messages.append({"role": "user", "content": f"로컬 답변을 보강하세요. 부족한 이유: {cloud_reason}"})
        cloud_fallback_reason = local_cloud_reason or local_failure
        cloud_mode = "supplement" if local_draft else "fallback" if local_failure else None

        emitted = {"value": False}
        managed_trace_model = ""

        def managed_stream_event(label, value, event_type):
            nonlocal model_first_event_at
            self.append_ai_debug_trace(label, value, event_type, source="cloud", model=managed_trace_model)
            if event_type == "token":
                token = str(value or "")
                if token:
                    observed_at = time.monotonic()
                    if model_first_event_at is None:
                        model_first_event_at = observed_at
                    emitted["value"] = True
                    emit_event({"type": "token", "token": token}, observed_at)
            elif event_type == "tool_call":
                try:
                    call = parse_streamed_voice_tool_call(value)
                except ValueError:
                    return
                observed_at = time.monotonic()
                if model_first_event_at is None:
                    model_first_event_at = observed_at
                emitted["value"] = True
                emit_event({"type": "tool_call", **call}, observed_at)

        request_options = (
            {"tools": prepared["tool_schemas"], "tool_choice": "auto"}
            if (payload.get("enable_tools") is True or (assist_mode and payload.get("enable_tools") is not False)) and prepared["tool_schemas"]
            else None
        )
        selection = self.selected_ai_model("chatbot")
        request_options = chatbot_text_options(selection, text_verbosity, request_options)
        if selection["mode"] == "local":
            provider, model_name = self.local_provider_model("chatbot")
            timing.identify(model=model_name, provider=provider)
        else:
            session = {}
            try:
                managed_model = chatbot_managed_options(self.managed_workflow_options("chatbot"), reasoning_effort)
                on_provider_timing("session_request_start", {"at": time.monotonic()})
                with self.managed_ai_action(
                    "chatbot", request_messages=messages, request_options=request_options,
                    request_timing_callback=on_provider_timing, **managed_model,
                ) as session:
                    check_cancelled()
                    on_provider_timing("session_ready", {"at": time.monotonic()})
                    managed_trace_model = str(session["model_id"])
                    # Subscription handles can also serve as bearer tokens.
                    receipt_id = session.get("session_id")
                    if session.get("transport") == "chatgpt" or receipt_id == session.get("token"):
                        receipt_id = None
                    timing.identify(model=managed_trace_model, session_id=receipt_id)
                    try:
                        answer, usage = self.call_managed_gateway_chat(
                            session,
                            messages,
                            max_retries=1,
                            timeout=120,
                            debug_trace_callback=managed_stream_event,
                            debug_trace_label="AILS managed chatbot stream",
                            timing_callback=on_provider_timing,
                            cancel_check=check_cancelled,
                            request_options=self.chatbot_gateway_request_options(
                                chatbot_reasoning_options("Vercel AI Gateway", reasoning_effort, request_options),
                                model_name=session["model_id"], transport=session.get("transport")) or None,
                        )
                        on_provider_timing("response_completed", {"at": time.monotonic()})
                        answer = normalize_latex_math_syntax(answer)
                        managed_model = session["model_id"]
                    except BaseException as error:
                        timing.failed(error)
                        raise
                    finally:
                        on_provider_timing("settlement_start", {"at": time.monotonic()})
                on_provider_timing("settlement_completed", {"at": time.monotonic()})
            except Exception as error:
                if "settlement" in session:
                    on_provider_timing("settlement_completed", {"at": time.monotonic()})
                context_metrics(error)
                raise
            emit_event({
                "type": "done",
                "answer": answer,
                "model": managed_model,
                "provider": session.get("provider", "AILS Cloud"),
                "usage": usage,
                "answer_source": "cloud",
                "cloud_mode": cloud_mode,
                "cloud_reason": cloud_fallback_reason or None,
                "context_metrics": context_metrics(),
            })
            return

        # Only an explicit Developer BYOK selection reaches the personal provider.
        if provider == PROVIDER_GEMINI:
            raise ValueError("Personal Gemini API connections are no longer supported.")

        base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(provider, model_name)

        trace_source = "local" if (
            provider == PROVIDER_LMSTUDIO
            or re.match(r"^https?://(?:localhost|127(?:\.\d+){3}|\[::1\])(?::|/|$)", str(base_url), re.IGNORECASE)
        ) else "cloud"

        def stream_event(trace_label, value, event_type):
            nonlocal model_first_event_at
            self.append_ai_debug_trace(trace_label, value, event_type, source=trace_source, model=model_name)
            if event_type == "token":
                token = str(value or "")
                if token:
                    observed_at = time.monotonic()
                    if model_first_event_at is None:
                        model_first_event_at = observed_at
                    emit_event({"type": "token", "token": token}, observed_at)
            elif event_type == "tool_call":
                try:
                    call = parse_streamed_voice_tool_call(value)
                except ValueError:
                    return
                observed_at = time.monotonic()
                if model_first_event_at is None:
                    model_first_event_at = observed_at
                emit_event({"type": "tool_call", **call}, observed_at)

        answer, usage = call_openai_compatible_chat(
            base_url,
            api_key,
            model_name,
            messages,
            provider_label=label,
            allow_empty_api_key=allow_empty,
            max_retries=1,
            timeout=120,
            debug_trace_callback=stream_event,
            debug_trace_label=f"{label} stream",
            timing_callback=on_provider_timing,
            cancel_check=check_cancelled,
            request_options=(
                self.chatbot_gateway_request_options(chatbot_reasoning_options(provider, reasoning_effort, request_options), model_name=model_name, provider=provider)
                if provider in {"Vercel AI Gateway", "OpenRouter"} else chatbot_reasoning_options(provider, reasoning_effort, request_options)
            ),
        )
        on_provider_timing("response_completed", {"at": time.monotonic()})
        if provider == PROVIDER_DEEPSEEK:
            hit = int((usage or {}).get("prompt_cache_hit_tokens") or 0)
            miss = int((usage or {}).get("prompt_cache_miss_tokens") or 0)
            self.append_idle_log(f"DeepSeek chatbot cache: hit={hit}, miss={miss}")
        answer = normalize_latex_math_syntax(answer)
        emit_event({"type": "done", "answer": answer, "model": model_name, "provider": providers.provider_to_ui(provider), "usage": usage, "answer_source": "cloud", "cloud_mode": cloud_mode, "cloud_reason": cloud_fallback_reason or None, "context_metrics": context_metrics()})

    def chatbot_reply(self, payload: dict):
        reasoning_effort = question_reasoning_effort(payload)
        text_verbosity = question_text_verbosity(payload)
        prepared = self.prepare_chatbot_turn(payload)
        provider = prepared["provider"]
        model_name = prepared["model_name"]
        messages = prepared["messages"]

        if edition_manifest.LOCAL_AI_SETTINGS_ENABLED and (provider == "llama.cpp" or model_name in ai_model_selection.CHATBOT_LOCAL_AGENT_MODEL_IDS):
            local_model = str(model_spec(model_name)["alias"])
            local_session = (VOICE_AGENT_RUNTIME.session(model_name) if provider == "llama.cpp"
                             else nullcontext((VOICE_AGENT_RUNTIME.endpoint(model_name), local_model)))
            with local_session as (local_endpoint, local_model):
                answer, usage = call_openai_compatible_chat(
                    local_endpoint, "", local_model, messages,
                    provider_label="llama.cpp chatbot", allow_empty_api_key=True,
                    max_retries=0, timeout=90,
                )
            return {
                "answer": normalize_latex_math_syntax(answer),
                "model": local_model,
                "provider": "llama.cpp",
                "usage": usage,
                "context_metrics": prepared["metrics"],
            }

        selection = self.selected_ai_model("chatbot")
        if selection["mode"] == "local":
            provider, model_name = self.local_provider_model("chatbot")
        else:
            managed_model = chatbot_managed_options(self.managed_workflow_options("chatbot"), reasoning_effort)
            with self.managed_ai_action("chatbot", request_messages=messages, **managed_model) as session:
                answer, usage = self.call_managed_gateway_chat(
                    session,
                    messages,
                    max_retries=1,
                    timeout=120,
                    request_options=self.chatbot_gateway_request_options(
                        chatbot_reasoning_options("Vercel AI Gateway", reasoning_effort,
                                                  chatbot_text_options(selection, text_verbosity)), model_name=session["model_id"],
                        transport=session.get("transport")) or None,
                )
            return {
                "answer": normalize_latex_math_syntax(answer),
                "model": session["model_id"],
                "provider": session.get("provider", "AILS Cloud"),
                "usage": usage,
                "context_metrics": prepared["metrics"],
            }

        # Only an explicit Developer BYOK selection reaches the personal provider.
        if provider == PROVIDER_GEMINI:
            raise ValueError("Personal Gemini API connections are no longer supported.")

        base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(provider, model_name)
        answer, usage = call_openai_compatible_chat(
            base_url,
            api_key,
            model_name,
            messages,
            provider_label=label,
            allow_empty_api_key=allow_empty,
            max_retries=1,
            timeout=120,
            request_options=(self.chatbot_gateway_request_options(chatbot_reasoning_options(provider, reasoning_effort), model_name=model_name, provider=provider)
                             if provider in {"Vercel AI Gateway", "OpenRouter"} else chatbot_reasoning_options(provider, reasoning_effort)) or None,
        )
        if provider == PROVIDER_DEEPSEEK:
            hit = int((usage or {}).get("prompt_cache_hit_tokens") or 0)
            miss = int((usage or {}).get("prompt_cache_miss_tokens") or 0)
            self.append_idle_log(f"DeepSeek chatbot cache: hit={hit}, miss={miss}")
        answer = normalize_latex_math_syntax(answer)
        return {"answer": answer, "model": model_name, "provider": providers.provider_to_ui(provider), "usage": usage, "context_metrics": prepared["metrics"]}
