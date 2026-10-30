"""ReviewService: feature operations and owned state."""
from __future__ import annotations
from documents.review_support import (
    ANSWER_TYPE_CODE,
    ANSWER_TYPE_SHORT_ANSWER,
    Any,
    BatchGradingCancelled,
    Callable,
    Mapping,
    answer_key_grading,
    answer_key_store,
    choose_review_model,
    common,
    complete_problem_grading,
    dataclass,
    documents,
    json,
    normalize_answer_type,
    normalize_latex_math_syntax,
    os,
    pdf,
    pipeline_utils,
    providers,
    re,
    safe_float,
    server_config,
)
from documents.review_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class ReviewServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    append_idle_log: Callable[..., Any]
    call_managed_gateway_chat: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    memory_enabled: Callable[..., Any]
    memory_service: Callable[..., Any]
    resolve_chatbot_openai_config: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class ReviewService:
    def __init__(self, ports: ReviewServicePorts):
        self._ports = ports
        self.append_idle_log = ports.append_idle_log
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.memory_enabled = ports.memory_enabled
        self.memory_service = ports.memory_service
        self.resolve_chatbot_openai_config = ports.resolve_chatbot_openai_config
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def generate_pdf_problem_hint(self, payload: dict):
        pdf_path = payload.get("pdf_path", "")
        base_dir = payload.get("base_dir", "")
        problem_id = payload.get("problem_id", "")
        problem = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, problem_id)
        from documents.practice_rounds import check_round
        check_round(problem, payload.get("solve_round_id"))
        existing_hint = problem.get("ai_hint")
        if (
            isinstance(existing_hint, Mapping)
            and str(existing_hint.get("text", "") or "").strip()
            and payload.get("force") is not True
        ):
            return {
                "problem": problem,
                "hint": str(existing_hint.get("text", "") or "").strip(),
                "provider": str(existing_hint.get("provider", "") or ""),
                "model": str(existing_hint.get("model", "") or ""),
                "cached": True,
            }

        answer_type = normalize_answer_type(
            problem.get("answer_type")
            or (ANSWER_TYPE_CODE if problem.get("is_code_problem") else ANSWER_TYPE_SHORT_ANSWER)
        )
        draft_answer = problem.get("draft_answer")
        if not isinstance(draft_answer, Mapping):
            draft_answer = {}
        answer_text = (
            payload.get("answer_text")
            if "answer_text" in payload
            else draft_answer.get("answer_text", "")
        )
        selected_choice = (
            payload.get("selected_choice")
            if "selected_choice" in payload
            else draft_answer.get("selected_choice")
        )
        hint_messages = documents.problem_answering.build_problem_hint_messages({
            "problem_text": problem.get("problem_text", ""),
            "answer_type": answer_type,
            "choices": problem.get("choices") or [],
            "answer_text": answer_text,
            "selected_choice": selected_choice,
        }, language=self.config.get("language"))
        use_managed = self.workflow_uses_managed_ai("grading")
        provider, model_name = ("AILS", "") if use_managed else self.local_provider_model("grading")
        usage = None
        provider_label = providers.provider_to_ui(provider)
        if use_managed:
            with self.managed_ai_action("grading", **self.managed_workflow_options("grading")) as session:
                raw_hint, usage = self.call_managed_gateway_chat(
                    session,
                    hint_messages,
                    timeout=120,
                    max_retries=1,
                )
                model_name = session["model_id"]
            provider_label = session.get("provider", "AILS Cloud")
        elif provider == common.PROVIDER_GEMINI:
            raise ValueError("Personal Gemini API connections are no longer supported.")
        else:
            base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(
                provider,
                model_name,
            )
            raw_hint, usage = pipeline_utils.call_openai_compatible_chat(
                base_url,
                api_key,
                model_name,
                hint_messages,
                provider_label=f"{label} hint",
                allow_empty_api_key=allow_empty,
                max_retries=1,
                timeout=120,
            )

        hint_text = normalize_latex_math_syntax(str(raw_hint or "")).strip()
        if not hint_text:
            raise RuntimeError("AI가 빈 힌트를 반환했습니다. 모델 설정을 확인해 주세요.")
        updated_problem = documents.problem_manager.save_problem_hint(
            pdf_path,
            base_dir,
            problem_id,
            hint_text,
            provider=provider_label,
            model=model_name,
            expected_round_id=problem["solve_round_id"],
        )
        saved_hint = updated_problem.get("ai_hint") or {}
        result = {
            "problem": updated_problem,
            "hint": str(saved_hint.get("text", "") or hint_text),
            "provider": provider_label,
            "model": model_name,
            "cached": False,
        }
        if usage:
            result["usage"] = usage
        return result

    def review_pdf_problem(self, payload: dict):
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        base_dir = payload.get("base_dir", "")
        problem_id = payload.get("problem_id", "")
        problem = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, problem_id)
        status = pdf.pdf_ocr.pdf_ocr_status(pdf_path)
        page_count = max(
            int(status.get("page_count") or 0),
            int(problem.get("page_end") or problem.get("page") or 1),
        )
        start_page = max(1, int(problem.get("page") or 1))
        end_page = min(page_count, max(start_page, int(problem.get("page_end") or start_page)))
        context_start = max(1, start_page - 1)
        context_end = min(page_count, end_page + 1)
        page_numbers = list(range(context_start, context_end + 1))
        if len(page_numbers) > 6:
            page_numbers = sorted({
                context_start,
                start_page,
                min(end_page, start_page + 1),
                max(start_page, end_page - 1),
                end_page,
                context_end,
            })
        page_context = []
        for page_number in page_numbers:
            indexed = pdf.pdf_ocr.indexed_pdf_page(pdf_path, page_number)
            page_context.append({
                "page": page_number,
                "text": str(indexed.get("text", "") or "")[:24_000],
            })
        review_messages = documents.problem_answering.build_problem_review_messages({
            "problem": problem,
            "page_context": page_context,
        }, language=self.config.get("language"))

        use_managed = self.workflow_uses_managed_ai("grading")
        provider, model_name = ("AILS", "") if use_managed else self.local_provider_model("grading")
        usage = None
        if use_managed:
            with self.managed_ai_action("grading", **self.managed_workflow_options("grading")) as session:
                raw_review, usage = self.call_managed_gateway_chat(
                    session, review_messages, timeout=120, max_retries=1,
                )
                model_name = session["model_id"]
        elif provider == common.PROVIDER_GEMINI:
            raise ValueError("Personal Gemini API connections are no longer supported.")
        else:
            base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(
                provider,
                model_name,
            )
            raw_review, usage = pipeline_utils.call_openai_compatible_chat(
                base_url,
                api_key,
                model_name,
                review_messages,
                provider_label=f"{label} problem review",
                allow_empty_api_key=allow_empty,
                max_retries=1,
                timeout=120,
            )
        proposal = documents.problem_answering.parse_problem_review_response(
            raw_review,
            problem,
            page_count=page_count,
        )
        result = {
            "problem": problem,
            "proposal": proposal,
            "provider": providers.provider_to_ui(provider),
            "model": model_name,
        }
        if usage:
            result["usage"] = usage
        return result

    def choose_pdf_problem_review_model(self, payload: dict):
        results = payload.get("results")
        if not isinstance(results, list):
            raise ValueError("사람이 검증한 비교 결과 배열이 필요합니다.")
        if len(results) > 80:
            raise ValueError("비교 표본은 모델당 최대 40개입니다.")
        total_cost = sum(max(0.0, safe_float(item.get("cost_usd"), 0.0)) for item in results if isinstance(item, Mapping))
        cap = min(documents.problem_review_gateway.MAX_BENCHMARK_COST_USD, safe_float(payload.get("budget_usd"), documents.problem_review_gateway.MAX_BENCHMARK_COST_USD))
        if total_cost > cap:
            raise ValueError(f"AI 게이트웨이 비교 예산 ${cap:.2f}을 초과했습니다.")
        selected = choose_review_model([item for item in results if isinstance(item, Mapping)])
        # Benchmark selection is retained as evidence only. Production review
        # routing remains Nano -> Luna -> Gemini by confidence.
        self.config["problem_review_benchmark_selected_model"] = selected
        server_config.save_config(self.config)
        return {"selected_model": selected, "total_cost_usd": round(total_cost, 6), "budget_usd": cap, "sample_count": len(results)}

    def preview_pdf_answer_key(self, payload: dict):
        return answer_key_store.preview(payload)

    def list_pdf_study_problems(self, pdf_path, base_dir):
        from documents.answer_key_auto_connect import study_problems
        return study_problems(pdf_path, base_dir)

    def scan_pdf_study_problems(self, payload):
        from documents.answer_key_auto_connect import study_problems
        return study_problems(payload.get("pdf_path", ""), payload.get("base_dir", ""), scan=True,
            chapter_name=payload.get("chapter_name", ""), reuse_cached=not bool(payload.get("force", False)))

    def manage_pdf_answer_key(self, payload: dict):
        return answer_key_store.management(payload)

    def confirm_pdf_answer_key(self, payload: dict):
        return answer_key_store.confirm(payload)

    def confirm_pdf_answer_keys(self, payload: dict):
        from documents.answer_key_batch import confirm_batch
        return confirm_batch(payload)

    def _validate_answer_key_grading_ai(self):
        import ai_compliance
        import edition_manifest
        ai_compliance.require_external_ai_consent(
            "/api/pdf/problems/grade", self.config,
            ai_compliance.compliance_metadata(edition_manifest.EDITION_MANIFEST))

    def _call_answer_key_grading_ai(self, messages):
        self._validate_answer_key_grading_ai()
        return self._call_pdf_problem_grading_ai(messages)

    def grade_pdf_problem(self, payload: dict):
        from documents.answer_key_auto_connect import ensure_auto_connections
        ensure_auto_connections(payload["pdf_path"], payload["base_dir"])
        return answer_key_grading.grade(payload, language=self.config.get("language"),
            call_ai=self._call_answer_key_grading_ai, validate_ai=self._validate_answer_key_grading_ai)

    def grade_pdf_problems_batch(self, payload: dict, *, is_cancelled=lambda: False, emit=None):
        from documents.answer_key_auto_connect import ensure_auto_connections
        ensure_auto_connections(payload["pdf_path"], payload["base_dir"])
        response = answer_key_grading.grade_batch(payload, language=self.config.get("language"),
            call_ai=self._call_answer_key_grading_ai, validate_ai=self._validate_answer_key_grading_ai, is_cancelled=is_cancelled, emit=emit)
        if emit:
            emit({"type": "done", "result": response})
        return response

    def _complete_pdf_problem_grading(self, prepared, grading, response):
        return complete_problem_grading(prepared, grading,
            provider_label=response["provider"], model_name=response["model"], usage=response.get("usage"),
            observe_grading=self.memory_service().observe_grading if self.memory_enabled() else None,
            on_warning=self.append_idle_log)

    def _call_pdf_problem_grading_ai(self, grading_messages, *, on_text=None, on_started=None, is_cancelled=None):
        use_managed = self.workflow_uses_managed_ai("grading")
        provider, model_name = ("AILS", "") if use_managed else self.local_provider_model("grading")
        usage = None
        provider_label = providers.provider_to_ui(provider)
        def check_cancelled():
            if is_cancelled and is_cancelled():
                raise BatchGradingCancelled("Batch grading was cancelled.")

        def trace(_label, content, kind):
            if kind == "token":
                check_cancelled()
                on_text(str(content or ""))

        def started():
            if on_started:
                on_started({"provider": provider_label, "model": model_name})

        stream_options = ({"debug_trace_callback": trace, "cancel_check": check_cancelled}
                          if on_text else {})
        if use_managed:
            with self.managed_ai_action("grading", **self.managed_workflow_options("grading")) as session:
                model_name = session["model_id"]
                provider_label = session.get("provider", "AILS Cloud")
                started()
                raw_answer, usage = self.call_managed_gateway_chat(
                    session,
                    grading_messages,
                    timeout=120,
                    max_retries=0,
                    **stream_options,
                )
                model_name = session["model_id"]
            provider_label = session.get("provider", "AILS Cloud")
        elif provider == common.PROVIDER_GEMINI:
            raise ValueError("Personal Gemini API connections are no longer supported.")
        else:
            base_url, api_key, model_name, label, allow_empty = self.resolve_chatbot_openai_config(provider, model_name)
            started()
            raw_answer, usage = pipeline_utils.call_openai_compatible_chat(
                base_url,
                api_key,
                model_name,
                grading_messages,
                provider_label=f"{label} grading",
                allow_empty_api_key=allow_empty,
                max_retries=0,
                timeout=120,
                **({**stream_options, "stream": True, "retry_ambiguous_errors": False} if on_text else {}),
            )

        return {"answer": raw_answer, "usage": usage, "provider": provider_label, "model": model_name}

    @staticmethod
    def parse_code_review_response(raw_answer, active_file):
        text = str(raw_answer or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text)
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        json_text = match.group(0) if match else text
        try:
            parsed = json.loads(json_text)
        except Exception:
            return {
                "summary": text[:1200] or "AI 진단 결과를 JSON으로 해석하지 못했습니다.",
                "can_run": None,
                "issues": [{
                    "file": active_file,
                    "line": 1,
                    "column": 1,
                    "severity": "info",
                    "title": "AI 진단 응답",
                    "explanation": text[:2000] or "진단 응답이 비어 있습니다.",
                    "fix": "",
                }],
            }

        issues = []
        raw_issues = parsed.get("issues", []) if isinstance(parsed, dict) else []
        for item in raw_issues if isinstance(raw_issues, list) else []:
            if not isinstance(item, dict):
                continue
            severity = str(item.get("severity", "info") or "info").lower()
            if severity not in {"error", "warning", "info"}:
                severity = "info"
            try:
                line = max(1, int(item.get("line", 1) or 1))
            except Exception:
                line = 1
            try:
                column = max(1, int(item.get("column", 1) or 1))
            except Exception:
                column = 1
            issues.append({
                "file": str(item.get("file", "") or active_file),
                "line": line,
                "column": column,
                "severity": severity,
                "title": str(item.get("title", "") or "AI 진단"),
                "explanation": str(item.get("explanation", "") or ""),
                "fix": str(item.get("fix", "") or ""),
            })
        return {
            "summary": str(parsed.get("summary", "") or "AI 코드 진단이 완료되었습니다.") if isinstance(parsed, dict) else "AI 코드 진단이 완료되었습니다.",
            "can_run": parsed.get("can_run") if isinstance(parsed, dict) and isinstance(parsed.get("can_run"), bool) else None,
            "issues": issues,
        }
