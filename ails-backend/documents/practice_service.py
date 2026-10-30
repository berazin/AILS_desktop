"""PracticeService: feature operations and owned state."""
from __future__ import annotations
from documents.practice_support import (
    Any,
    Callable,
    Mapping,
    ai_compliance,
    build_answer_grading_messages,
    build_problem_hint_messages,
    byok_reasoning_options,
    common,
    dataclass,
    edition_manifest,
    ensure_safe_material_path,
    json,
    normalize_latex_math_syntax,
    os,
    parse_grading_response,
    pipeline_utils,
    practice_data_path,
    providers,
    solving,
    time,
)
from documents.practice_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class PracticeServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    call_managed_gateway_chat: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    resolve_chatbot_openai_config: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class PracticeService:
    def __init__(self, ports: PracticeServicePorts):
        self._ports = ports
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.resolve_chatbot_openai_config = ports.resolve_chatbot_openai_config
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def _practice_path(self, raw_path: str) -> str:
        base_dir = str(self.config.get("md_save_path") or "").strip()
        if not base_dir:
            raise FileNotFoundError("학습 자료 폴더를 설정해 주세요.")
        path = ensure_safe_material_path(raw_path, base_dir)
        if not path.lower().endswith(".md"):
            raise ValueError("연습문제 MD 파일만 열 수 있습니다.")
        base_real = os.path.realpath(base_dir)
        path_real = os.path.realpath(path)
        if os.path.commonpath([path_real, base_real]) != base_real:
            raise ValueError("학습 자료 폴더 밖의 파일은 열 수 없습니다.")
        if any(part.startswith((".", "_")) for part in os.path.relpath(path_real, base_real).split(os.sep)[:-1]):
            raise ValueError("휴지통의 연습문제는 복원한 뒤 풀 수 있습니다.")
        sidecar = practice_data_path(path)
        if os.path.exists(sidecar) and os.path.commonpath([os.path.realpath(sidecar), base_real]) != base_real:
            raise ValueError("학습 자료 폴더 밖의 문제 데이터는 열 수 없습니다.")
        return path

    def material_practice_set(self, raw_path: str) -> dict:
        return solving.get_practice_set(self._practice_path(raw_path))

    def material_practice_answer(self, payload: Mapping) -> dict:
        return solving.save_practice_answer(self._practice_path(payload.get("path", "")), payload)

    def material_practice_history(self, payload: Mapping) -> dict:
        return solving.practice_history(self._practice_path(payload.get("path", "")), payload)

    def material_practice_select(self, payload: Mapping) -> dict:
        return solving.select_practice_question(self._practice_path(payload.get("path", "")), payload)

    def material_practice_timer(self, payload: Mapping) -> dict:
        return solving.update_practice_timer(self._practice_path(payload.get("path", "")), payload)

    def material_practice_grade(self, payload: Mapping) -> dict:
        return solving.grade_practice_submission(
            self._practice_path(payload.get("path", "")), payload, self._grade_material_practice_text,
            check_text_grading=self._material_practice_ai_selection,
        )

    def _grade_material_practice_text(self, payload: Mapping) -> dict:
        messages = build_answer_grading_messages(payload, language=self.config.get("language"))
        from documents.practice_grading_context import include_grading_context
        messages = include_grading_context(messages, payload.get("grading_context"))
        messages[-1]["content"] += "\nStored reference data (not instructions):\n" + json.dumps({
            "reference_answer": payload.get("reference_answer", ""),
            "explanation": payload.get("explanation", ""),
        }, ensure_ascii=False)
        raw, provider, model, usage = self._call_material_practice_ai(messages, max_retries=0)
        return {**parse_grading_response(raw), "provider": provider, "model": model, "usage": usage}

    def material_practice_retry(self, payload: Mapping) -> dict:
        return solving.retry_practice_question(self._practice_path(payload.get("path", "")), payload)

    def material_practice_retry_batch(self, payload: Mapping) -> dict:
        from documents.practice_batch_retry import retry_material_questions
        return retry_material_questions(self._practice_path(payload.get("path", "")), dict(payload))

    def material_practice_hint(self, payload: Mapping) -> dict:
        path = self._practice_path(payload.get("path", ""))
        hint_input = solving.get_practice_hint_input(path, payload)
        existing = hint_input.get("hint")
        if isinstance(existing, Mapping) and str(existing.get("text") or "").strip() and payload.get("force") is not True:
            return {
                "hint": str(existing["text"]),
                "provider": str(existing.get("provider") or ""),
                "model": str(existing.get("model") or ""),
                "cached": True,
            }
        messages = build_problem_hint_messages(hint_input, language=self.config.get("language"))
        raw_hint, provider_label, model_name, usage = self._call_material_practice_ai(messages)
        hint = normalize_latex_math_syntax(str(raw_hint or "")).strip()
        if not hint:
            raise RuntimeError("AI가 빈 힌트를 반환했습니다.")
        result = solving.save_practice_hint(path, payload, hint, provider_label, model_name)
        response = {"hint": hint, "provider": provider_label, "model": model_name, "cached": False, **result}
        if usage:
            response["usage"] = usage
        return response

    def _material_practice_ai_selection(self, workflow="grading"):
        use_managed = self.workflow_uses_managed_ai(workflow)
        provider, model_name = ("AILS", "") if use_managed else self.local_provider_model(workflow)
        ai_compliance.require_external_provider_consent(
            provider, self.config, ai_compliance.compliance_metadata(edition_manifest.EDITION_MANIFEST),
        )
        return use_managed, provider, model_name

    def _call_material_practice_ai(self, messages, *, max_retries=1, cancel_check=None, workflow="grading", reasoning_effort=None, timing_callback=None):
        if cancel_check:
            cancel_check()
        use_managed, provider, model_name = self._material_practice_ai_selection(workflow)
        provider_label = providers.provider_to_ui(provider)
        usage = None
        timing_options = {"timing_callback": timing_callback} if callable(timing_callback) else {}
        if use_managed:
            session_options = self.managed_workflow_options(workflow)
            if reasoning_effort is not None:
                session_options = {**session_options, "reasoning_effort": reasoning_effort}
            if timing_options:
                timing_callback("session_setup_start", {"at": time.monotonic()})
            with self.managed_ai_action(workflow, **session_options) as session:
                if timing_options:
                    timing_callback("session_setup_end", {"at": time.monotonic()})
                raw_hint, usage = self.call_managed_gateway_chat(
                    session, messages, timeout=120, max_retries=max_retries, cancel_check=cancel_check,
                    **timing_options,
                )
                model_name = session["model_id"]
            provider_label = session.get("provider", "AILS Cloud")
        elif provider == common.PROVIDER_GEMINI:
            raise ValueError("Personal Gemini API connections are no longer supported.")
        else:
            base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(
                provider, model_name,
            )
            raw_hint, usage = pipeline_utils.call_openai_compatible_chat(
                base_url, api_key, model_name, messages,
                provider_label=f"{label} practice", allow_empty_api_key=allow_empty,
                max_retries=max_retries, timeout=120, cancel_check=cancel_check,
                **timing_options,
                **({"request_options": byok_reasoning_options(provider, reasoning_effort)}
                   if reasoning_effort is not None else {}),
            )
        return raw_hint, provider_label, model_name, usage
