"""VoiceAgentService: feature operations and owned state."""
from __future__ import annotations
from voice.agent_support import (
    Any,
    Callable,
    Mapping,
    VOICE_TOOL_SCHEMAS,
    build_realtime_voice_messages,
    common,
    dataclass,
    parse_streamed_voice_tool_call,
    pipeline_utils,
    time,
    voice,
    voice_tool_schemas_for_rounds,
)
from voice.agent_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class VoiceAgentServicePorts:
    append_ai_debug_trace: Callable[..., Any]
    call_managed_gateway_chat: Callable[..., Any]
    get_config: Callable[..., Any]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    resolve_chatbot_openai_config: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]


class VoiceAgentService:
    def __init__(self, ports: VoiceAgentServicePorts):
        self._ports = ports
        self.append_ai_debug_trace = ports.append_ai_debug_trace
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.resolve_chatbot_openai_config = ports.resolve_chatbot_openai_config
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    @property
    def config(self):
        return self._ports.get_config()

    def stream_realtime_voice_agent(self, payload: Mapping, emit) -> None:
        messages, _context = build_realtime_voice_messages(
            payload.get("transcript"),
            payload.get("context"),
            payload.get("tool_rounds"),
            language=self.config.get("language"),
        )
        assist_mode = payload.get("assist_mode") is True
        force_cloud = payload.get("force_cloud") is True
        provider = "cloud" if force_cloud else "local" if assist_mode else str(self.config.get("voice_agent_provider") or "local").strip().casefold()
        local_failure = ""
        request_options = {
            "tools": voice_tool_schemas_for_rounds(payload.get("tool_rounds"), local=provider == "local"),
            "tool_choice": "auto",
            "temperature": 0.2,

            "cache_prompt": True,
        }
        started_at = time.monotonic()
        first_event_at = None
        trace_source = "local" if provider == "local" else "cloud"
        trace_model = ""

        def stream_event(label, value, event_type):
            nonlocal first_event_at
            self.append_ai_debug_trace(label, value, event_type, source=trace_source, model=trace_model)
            if event_type == "token":
                token = str(value or "")
                if not token:
                    return
                if first_event_at is None:
                    first_event_at = time.monotonic()
                emit({"type": "token", "token": token})
            elif event_type == "tool_call":
                call = parse_streamed_voice_tool_call(value)
                if first_event_at is None:
                    first_event_at = time.monotonic()
                emit({"type": "tool_call", **call})

        def call_cloud_voice(options):
            nonlocal trace_model, trace_source
            trace_source = "cloud"
            if self.workflow_uses_managed_ai("voice_agent"):
                with self.managed_ai_action("voice_agent", **self.managed_workflow_options("voice_agent")) as session:
                    trace_model = str(session["model_id"])
                    answer, usage = self.call_managed_gateway_chat(
                        session, messages, max_retries=0, timeout=60,
                        debug_trace_callback=stream_event,
                        debug_trace_label="AILS realtime voice agent",
                        request_options={**options, "reasoning": {"effort": "none"}},
                    )
                    return answer, usage, trace_model, session.get("provider", "AILS Cloud")
            personal_provider, personal_model = self.local_provider_model("voice_agent")
            endpoint, key, personal_model, label, _ = self.resolve_chatbot_openai_config(
                personal_provider, personal_model,
            )
            trace_model = personal_model
            answer, usage = pipeline_utils.call_openai_compatible_chat(
                endpoint, key, personal_model, messages,
                provider_label=f"{label} realtime voice agent", max_retries=0, timeout=60,
                debug_trace_callback=stream_event,
                debug_trace_label="AILS realtime voice agent",
                request_options=options,
            )
            return answer, usage, personal_model, label

        if provider == "cloud":
            content, usage, model, provider_label = call_cloud_voice(request_options)
        elif provider == "local":
            local_model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(self.config.get("local_voice_agent_model"))
            try:
                endpoint = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.endpoint(local_model_id)
                trace_model = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.active_alias()
                content, usage = pipeline_utils.call_openai_compatible_chat(
                    endpoint,
                    "",
                    trace_model,
                    messages,
                    provider_label="llama.cpp realtime voice agent",
                    allow_empty_api_key=True,
                    max_retries=0,
                    timeout=90,
                    debug_trace_callback=stream_event,
                    debug_trace_label="AILS realtime voice agent",
                    request_options=request_options,
                )
            except RuntimeError as error:
                if not assist_mode:
                    raise RuntimeError(
                        "로컬 실시간 보이스 AI를 사용할 수 없습니다. AILS의 llama.cpp Vulkan 런타임과 "
                        "자동 선택된 Qwen3 보이스 모델을 확인해 주세요. "
                        f"Details: {error}"
                    ) from error
                local_failure = common.normalize_whitespace(error)[:500]
                self.append_ai_debug_trace(
                    "llama.cpp realtime voice agent error",
                    local_failure,
                    "error",
                    source="local",
                    model=trace_model,
                )
                content, usage, model, provider_label = call_cloud_voice({
                    **request_options, "tools": VOICE_TOOL_SCHEMAS,
                })
            else:
                model = trace_model
                provider_label = "llama.cpp"
        else:
            raise ValueError("보이스 명령 처리 방식이 올바르지 않습니다.")
        emit({
            "type": "done",
            "answer": content,
            "model": model,
            "provider": provider_label,
            "usage": usage or {},
            "answer_source": "local" if provider_label == "llama.cpp" else "cloud",
            "cloud_mode": "fallback" if local_failure else None,
            "cloud_reason": local_failure or None,
            "first_event_ms": None if first_event_at is None else round((first_event_at - started_at) * 1000, 1),
        })


    def warm_realtime_voice_agent(self) -> dict:
        provider = str(self.config.get("voice_agent_provider") or "local").strip().casefold()
        if provider != "local":
            return {"warmed": False, "provider": provider, "elapsed_ms": 0}
        messages, _context = build_realtime_voice_messages(
            "준비됐어?",
            {
                "document_title": "",
                "current_page": 0,
                "page_count": 0,
                "pdf_open": False,
                "practice_open": False,
                "problem_count": 0,
                "ocr_active": False,
                "selected_text": "",
                "page_text": "",
                "materials": [],
            },
            language=self.config.get("language"),
        )
        started_at = time.monotonic()
        local_model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(self.config.get("local_voice_agent_model"))
        endpoint = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.endpoint(local_model_id)
        pipeline_utils.call_openai_compatible_chat(
            endpoint,
            "",
            voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.active_alias(),
            messages,
            provider_label="llama.cpp realtime voice warmup",
            allow_empty_api_key=True,
            max_retries=0,
            timeout=90,
            debug_trace_callback=lambda *_args: None,
            request_options={
                "tools": voice_tool_schemas_for_rounds([], local=True),
                "tool_choice": "auto",
                "temperature": 0,

                "cache_prompt": True,
            },
        )
        return {
            "warmed": True,
            "provider": "llama.cpp",
            "elapsed_ms": round((time.monotonic() - started_at) * 1000, 1),
        }


    def ai_assist_status(self) -> dict:
        return voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.status(
            voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(self.config.get("local_voice_agent_model"))
        )


    def warm_ai_assist(self, payload: Mapping | None = None) -> dict:
        payload = payload if isinstance(payload, Mapping) else {}
        model_id = str(payload.get("model_id") or "").strip()
        if not model_id:
            model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(self.config.get("local_voice_agent_model"))
        messages, _context = build_realtime_voice_messages(
            "준비됐어?",
            {"document_title": "", "current_page": 0, "page_count": 0, "pdf_open": False},
            language=self.config.get("language"),
        )
        started_at = time.monotonic()
        endpoint = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.endpoint(model_id)
        response, _usage = pipeline_utils.call_openai_compatible_chat(
            endpoint,
            "",
            voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.active_alias(),
            messages,
            provider_label="llama.cpp AI Assist warmup",
            allow_empty_api_key=True,
            max_retries=0,
            timeout=90,
            debug_trace_callback=lambda *_args: None,
            request_options={"tools": voice_tool_schemas_for_rounds([], local=True), "tool_choice": "auto", "temperature": 0,  "cache_prompt": True},
        )
        status = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.status(model_id)
        return {
            **status,
            "warmed": status["resident"],
            "provider": "llama.cpp",
            "response": response,
            "elapsed_ms": round((time.monotonic() - started_at) * 1000, 1),
        }


    @staticmethod
    def stop_ai_assist() -> dict:
        voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.close()
        return {"stopped": True, "resident": False}
