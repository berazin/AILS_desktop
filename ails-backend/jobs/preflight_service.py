"""PreflightService: feature operations and owned state."""
from __future__ import annotations
from jobs.preflight_support import (
    Any,
    Callable,
    DocumentTranslationOptions,
    HTTPStatus,
    Mapping,
    TranslationGlossary,
    accounts,
    ai_model_selection,
    dataclass,
    documents,
    edition_manifest,
    math,
    normalize_app_language,
    os,
    pdf,
    pipeline_utils,
    settings,
    voice,
)
from jobs.preflight_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class PreflightServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    _has_usable_managed_credits: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    managed_auth_status: Callable[..., Any]
    selected_ai_model: Callable[..., Any]

class PreflightService:
    def __init__(self, ports: PreflightServicePorts):
        self._ports = ports
        self._has_usable_managed_credits = ports._has_usable_managed_credits
        self.managed_auth_status = ports.managed_auth_status
        self.selected_ai_model = ports.selected_ai_model

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    @staticmethod
    def _estimated_media_duration_seconds(file_path: str) -> int:
        """Estimate duration without decoding media during a disclosure check."""
        try:
            from summary_generation.video_analysis import MediaFoundationBridge

            with MediaFoundationBridge() as bridge:
                duration = int(math.ceil(bridge.probe(file_path).duration_seconds))
            if duration > 0:
                return duration
        except Exception:
            pass
        size_mb = max(1.0, os.path.getsize(file_path) / (1024 * 1024))
        # ponytail: conservative 2 Mbps estimate only when metadata probing is unavailable.
        return max(60, int(size_mb * 4))

    @staticmethod
    def _pdf_translation_kwargs(payload: Mapping) -> dict:
        engine = payload.get("engine", "legacy")
        if engine not in ("legacy", "document"):
            raise ValueError("Unsupported PDF translation engine")
        if engine == "legacy":
            if "options" in payload or "glossary" in payload:
                raise ValueError("Translation options and glossary require engine=document")
            return {}
        options = payload.get("options", {})
        if not isinstance(options, Mapping):
            raise ValueError("Document translation options must be a mapping")
        try:
            kwargs = {"options": DocumentTranslationOptions(**options)}
            if "glossary" in payload:
                glossary = payload["glossary"]
                if isinstance(glossary, Mapping):
                    kwargs["glossary"] = TranslationGlossary(**glossary)
                elif isinstance(glossary, list):
                    kwargs["glossary"] = TranslationGlossary(items=glossary)
                else:
                    raise ValueError("Document translation glossary must be a mapping or list")
        except (TypeError, ValueError) as error:
            raise ValueError("Invalid document translation options or glossary") from error
        if "pages" in payload and payload["pages"] is not None:
            pages = payload["pages"]
            if not isinstance(pages, list) or not pages or any(type(page) is not int or page < 1 for page in pages):
                raise ValueError("Selected pages must be positive page numbers")
            kwargs["pages"] = sorted(set(pages))
        return kwargs

    @staticmethod
    def _pdf_translation_reservation_cost(page_count: int) -> float:
        return (
            min(4.0, max(0.02, round(0.008 * page_count * ai_model_selection.MANAGED_AI_RESERVATION_HEADROOM, 4)))
            if page_count > 0
            else 0.01
        )

    def work_preflight(self, payload: Mapping) -> dict:
        operation = str(payload.get("operation") or "").strip()
        steps: list[dict] = []
        estimate_basis = "PDF 페이지 수 또는 미디어 파일 크기를 사용한 근사치입니다."
        local_problem_review_model = None

        def add_step(kind: str, label: str, seconds: float, cost: float = 0.0, *, conditional=False, workflow=None):
            workflow = workflow or {"pdf_translation": "pdf_translation", "pdf_problem_review": "problem_review",
                                    "voice_agent": "voice_agent"}.get(operation)
            subscription = (kind == "external_ai" and workflow is not None
                            and self.selected_ai_model(workflow)["mode"] == "chatgpt")
            steps.append({
                "kind": kind,
                "label": label,
                "estimated_seconds": max(1, int(math.ceil(seconds))),
                "estimated_cost_usd": None if subscription else round(max(0.0, float(cost)), 6),
                "billing_mode": "chatgpt" if subscription else "existing",
                "conditional": bool(conditional),
            })

        if operation in {"pdf_ocr", "pdf_translation", "pdf_problem_review"}:
            file_path = os.path.abspath(str(payload.get("path") or payload.get("pdf_path") or ""))
            if not os.path.isfile(file_path):
                raise FileNotFoundError(file_path)
            page_count = max(1, int(pdf.pdf_ocr.pdf_ocr_status(file_path).get("page_count") or 1))
            if operation == "pdf_ocr":
                per_page_seconds = 8.0 if payload.get("allow_cpu") is True else 2.5
                add_step("local", "PaddleOCR 텍스트 인식·검색 색인 생성", page_count * per_page_seconds)
            elif operation == "pdf_translation":
                document_engine = bool(self._pdf_translation_kwargs(payload))
                target_lang = normalize_app_language(
                    payload.get("target_language") or getattr(self, "config", {}).get("language")
                )
                trans_status = {} if document_engine else pdf.pdf_translation.pdf_translation_progress_status(file_path, target_lang)
                total_pages = max(1, int(trans_status.get("total_pages") or page_count))
                cached_count = int(trans_status.get("cached_pages") or 0)
                remaining_pages = max(0, total_pages - cached_count)

                if document_engine:
                    estimate_basis = (
                        "문서 번역은 별도 캐시를 사용하므로 보수적으로 산정합니다: "
                        f"캐시 0페이지 · 남은 전체 {total_pages}페이지."
                    )
                    add_step(
                        "external_ai",
                        f"PDF 문서 번역 (캐시 0페이지 · 남은 전체 {total_pages}페이지)",
                        total_pages * 4,
                        self._pdf_translation_reservation_cost(total_pages),
                    )
                    add_step("local", "번역 PDF 재구성·저장", total_pages * 1.5)
                elif remaining_pages == 0 and cached_count > 0:
                    add_step("local", f"기존 번역본 복원 (전체 {total_pages}페이지 완료)", 5)
                    add_step("local", "번역 PDF 재구성·저장", total_pages * 1.5)
                elif cached_count > 0:
                    external_cost = min(4.0, max(0.01, 0.005 * remaining_pages))
                    add_step(
                        "external_ai",
                        f"PDF 본문 한국어 번역 ({cached_count}페이지 기완료 · {remaining_pages}페이지 신규 번역)",
                        remaining_pages * 4,
                        external_cost,
                    )
                    add_step("local", "번역 PDF 재구성·저장", total_pages * 1.5)
                else:
                    external_cost = min(4.0, 0.005 * total_pages)
                    add_step("external_ai", "PDF 본문 한국어 번역", total_pages * 4, external_cost)
                    add_step("local", "번역 PDF 재구성·저장", total_pages * 1.5)
            else:
                base_dir = os.path.abspath(str(payload.get("base_dir") or ""))
                problems = list(documents.problem_manager.list_pdf_problems(file_path, base_dir).get("problems") or [])
                requested_page = int(payload.get("page") or 0)
                if payload.get("review_queue_only") is True:
                    pending_ids = {
                        str(item.get("problem_id") or "")
                        for item in documents.problem_review_gateway.list_review_queue(base_dir, file_path)
                        if isinstance(item, Mapping) and str(item.get("status") or "") == "needs_user_review"
                    }
                    problems = [
                        problem for problem in problems
                        if isinstance(problem, Mapping) and str(problem.get("id") or "") in pending_ids
                    ]
                    if not problems:
                        raise ValueError("재검수할 사용자 검토 문제가 없습니다.")
                if requested_page:
                    problems = [
                        problem for problem in problems
                        if isinstance(problem, Mapping)
                        and int(problem.get("page") or 1) <= requested_page
                        <= int(problem.get("page_end") or problem.get("page") or 1)
                    ]
                if not problems:
                    raise ValueError("검수할 문제가 없습니다.")
                pages = {
                    int(problem.get("page") or 0)
                    for problem in problems
                    if isinstance(problem, Mapping)
                    and int(problem.get("page") or 0) > 0
                }
                review_pages = max(1, len(pages))
                review_engine = str(payload.get("review_engine") or "cloud").strip().casefold()
                if review_engine == "local":
                    local_model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(
                        payload.get("local_problem_review_model", self.config.get("local_problem_review_model"))
                    )
                    local_problem_review_model = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.status(local_model_id)
                    local_model_label = str(local_problem_review_model.get("model_label") or "Qwen3")
                    if local_problem_review_model.get("download_required"):
                        download_size = int(local_problem_review_model.get("file_size") or 0)
                        add_step(
                            "local",
                            f"{local_model_label} 모델 최초 다운로드·검증 ({download_size / (1024 ** 3):.2f}GB)",
                            max(10, download_size / (8 * 1024 * 1024)),
                        )
                    add_step(
                        "local",
                        f"{local_model_label} 맞춤법·띄어쓰기·문제 번호 검수 · {len(problems)}개",
                        20 + len(problems) * 15,
                    )
                    estimate_basis = (
                        f"검수 대상 {len(problems)}개를 한 문제씩 처리하고 각 문제에 최대 두 페이지의 "
                        "좌표 분리 OCR 문맥을 사용하는 실측 근사치입니다."
                    )
                elif review_engine == "cloud":
                    add_step(
                        "external_ai",
                        f"연습 문제 이미지 검수 · {len(problems)}개 문제 / {review_pages}페이지",
                        math.ceil(review_pages / documents.auto_review_support.PDF_PROBLEM_AUTO_REVIEW_MAX_WORKERS) * 18,
                        review_pages * documents.auto_review_support.PDF_PROBLEM_MANAGED_ESTIMATE_USD_PER_PAGE,
                    )
                    estimate_basis = (
                        f"검수 대상 문제 {len(problems)}개가 포함된 {review_pages}페이지와 "
                        "일반적인 Nano 우선·필요 시 후속 검수 사용량을 기준으로 한 근사치입니다."
                    )
                else:
                    raise ValueError("review_engine must be local or cloud.")
        elif operation == "voice_agent":
            if str(self.config.get("voice_agent_provider") or "local").strip().casefold() == "cloud":
                add_step("external_ai", "보이스 명령 의도 해석", 8, ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD)
            else:
                local_voice_agent_model = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.status(
                    voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(self.config.get("local_voice_agent_model"))
                )
                if local_voice_agent_model.get("download_required"):
                    download_size = int(local_voice_agent_model.get("file_size") or 0)
                    model_label = str(local_voice_agent_model.get("model_label") or "Qwen3")
                    add_step(
                        "local",
                        f"{model_label} 모델 최초 다운로드·검증 ({download_size / (1024 ** 3):.2f}GB)",
                        max(10, download_size / (8 * 1024 * 1024)),
                    )
                add_step("local", "llama.cpp Vulkan 명령 해석", 20)
        elif operation in {"video_detailed", "video_summary"}:
            file_path = os.path.abspath(str(payload.get("video_path") or ""))
            if not os.path.isfile(file_path):
                raise FileNotFoundError(file_path)
            duration = self._estimated_media_duration_seconds(file_path)
            add_step("local", "영상 디코딩·장면 분석", duration * 0.18 + 20)
            local_stt_model = None
            if payload.get("local_stt") is True:
                requested_model = str(payload.get("local_stt_model") or self.config.get("stt_model_name") or "").strip()
                selected_model = (
                    requested_model
                    if requested_model in edition_manifest.whisper_cpp_model_options()
                    else settings.model_support.select_video_whisper_cpp_model()
                )
                local_stt_model = {
                    "selected_model": selected_model,
                    **pipeline_utils.whisper_cpp_model_status(selected_model),
                }
                if local_stt_model.get("download_required"):
                    download_size = int(local_stt_model.get("file_size") or 0)
                    add_step(
                        "local",
                        f"Whisper {selected_model} 모델 최초 다운로드·검증 ({download_size / (1024 ** 3):.2f}GB)",
                        max(10, download_size / (8 * 1024 * 1024)),
                    )
                add_step("local", "Whisper 음성 인식", duration * 0.45 + 20)
            else:
                add_step("external_ai", "클라우드 음성 인식", duration * 0.12 + 20, duration / 60 * 0.006)
            visual_calls = max(1, math.ceil(duration / 15))
            visual_selection = self.selected_ai_model("video_visual")
            visual_model = str(visual_selection.get("modelId") or "").casefold()
            visual_cost = 0.0 if visual_selection["mode"] == "local" and (
                visual_model == "openrouter/free" or visual_model.endswith(":free")
            ) else visual_calls * 0.001
            if not edition_manifest.LOCAL_AI_SETTINGS_ENABLED:
                visual_cost = max(ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD, visual_cost)
            add_step(
                "external_ai",
                "대표 장면·주변 STT 멀티모달 분석",
                math.ceil(visual_calls / 4) * 15,
                visual_cost, workflow="video_visual",
            )
            summary_calls = max(1, math.ceil(duration / 1200))
            add_step("external_ai", "AI 강의 정리 생성", summary_calls * 35, summary_calls * ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD, workflow="video_summary")
            add_step("external_ai", "정리 근거 검증", 35, ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD, workflow="video_summary")
        else:
            raise ValueError("지원하지 않는 작업 사전 확인 유형입니다.")

        external_cost = round(sum(step["estimated_cost_usd"] or 0 for step in steps), 6)
        uses_chatgpt = any(step.get("billing_mode") == "chatgpt" for step in steps)
        kinds = {step["kind"] for step in steps}
        execution = "hybrid" if len(kinds) > 1 else next(iter(kinds))
        credit = {
            "enforced": False,
            "available_usd": None,
            "required_usd": None,
            "sufficient": None,
            "reason": "",
        }
        allowed = True
        auth_status = None
        workflow_by_operation = {
            "pdf_translation": "pdf_translation",
            "pdf_problem_review": "problem_review",
            "voice_agent": "voice_agent",
        }
        if operation in {"video_detailed", "video_summary"}:
            uses_managed_credit = any(
                self.selected_ai_model(workflow)["mode"] in {"managed", "managed_default"}
                for workflow in (
                    "video_visual", "video_summary",
                    "video_verification",
                )
            )
        elif operation == "voice_agent":
            uses_managed_credit = (
                str(self.config.get("voice_agent_provider") or "local").strip().casefold() == "cloud"
                and self.selected_ai_model("voice_agent")["mode"] in {"managed", "managed_default"}
            )
        elif operation in workflow_by_operation:
            if edition_manifest.EDITION_MANIFEST["id"] == "personal" or "ai_model_selection" in getattr(self, "config", {}):
                uses_managed_credit = self.selected_ai_model(workflow_by_operation[operation])["mode"] in {"managed", "managed_default"}
            else:
                uses_managed_credit = not edition_manifest.LOCAL_AI_SETTINGS_ENABLED or self._has_usable_managed_credits()
        else:
            uses_managed_credit = False
        route_type = (
            "managed"
            if uses_managed_credit
            else ("personal" if external_cost > 0 else "local")
        )
        route_label = (
            "라우팅 플랫폼 (AILS 크레딧)"
            if route_type == "managed"
            else ("개인 API 키" if route_type == "personal" else "로컬 처리")
        )
        if uses_chatgpt:
            route_type = "chatgpt" if not external_cost else "mixed"
            route_label = "ChatGPT 구독" if not external_cost else "ChatGPT 구독 + 기능별 기존 공급자"
        if external_cost > 0 and uses_managed_credit:
            required_usd = (
                external_cost
                if operation == "pdf_translation" and document_engine
                else math.ceil(external_cost * ai_model_selection.MANAGED_AI_RESERVATION_HEADROOM * 1_000_000) / 1_000_000
            )
            status = auth_status or self.managed_auth_status()
            credits = status.get("credits") if isinstance(status.get("credits"), Mapping) else None
            available_usd = (int(credits.get("available_microusd") or 0) / 1_000_000) if credits else None
            allowed = bool(status.get("authenticated") and credits and available_usd >= required_usd)
            reason = ""
            if not status.get("authenticated"):
                reason = str(status.get("error") or "AILS 계정에 로그인해 주세요.")
            elif credits is None:
                reason = str(status.get("error") or "크레딧 잔액을 확인할 수 없습니다.")
            elif not allowed:
                reason = f"보유 크레딧 ${available_usd:.4f}보다 필요한 예약액 ${required_usd:.4f}이 큽니다."
            credit = {
                "enforced": True,
                "available_usd": available_usd,
                "required_usd": required_usd,
                "sufficient": allowed,
                "reason": reason,
            }
        elif external_cost > 0:
            credit["reason"] = "개발자 개인 API 키의 공급자 잔액은 AILS에서 조회할 수 없습니다."

        if uses_chatgpt:
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.account import ACCOUNT
            try:
                ACCOUNT.access()
                if not uses_managed_credit:
                    credit["reason"] = "ChatGPT 사용량은 ChatGPT 설정에서 관리합니다. AILS 크레딧으로 자동 전환하지 않습니다."
            except RuntimeError as error:
                allowed = False
                credit["reason"] = str(error)
        return {
            "operation": operation,
            "execution": execution,
            "route_type": route_type,
            "route_label": route_label,
            "steps": steps,
            "estimated_seconds": sum(step["estimated_seconds"] for step in steps),
            "estimated_cost_usd": None if uses_chatgpt else external_cost,
            "estimate_basis": estimate_basis,
            "credit": credit,
            "allowed": allowed,
            "local_stt_model": local_stt_model if operation in {"video_detailed", "video_summary"} else None,
            "local_voice_agent_model": local_voice_agent_model if operation == "voice_agent" and execution == "local" else None,
            "local_problem_review_model": local_problem_review_model,
        }

    def require_work_preflight(self, payload: Mapping, operation: str) -> dict:
        if payload.get("work_acknowledged") is not True:
            raise ValueError("작업 유형, 예상 시간과 예상 비용을 확인한 뒤 시작해 주세요.")
        result = self.work_preflight({**dict(payload), "operation": operation})
        if not result["allowed"]:
            credit = result["credit"]
            raise accounts.auth_support.ManagedAuthError(
                str(credit.get("reason") or "크레딧이 부족하여 외부 AI 작업을 시작할 수 없습니다."),
                status=HTTPStatus.PAYMENT_REQUIRED,
                code="insufficient_credits",
            )
        return result

    def managed_problem_review_policy(self) -> dict:
        if self.selected_ai_model("problem_review")["mode"] == "chatgpt":
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.protocol import ChatGPTError
            raise ChatGPTError("unsupported_capability")
        import client_ai_policy
        return client_ai_policy.review_policy(self.config, self.selected_ai_model("problem_review"))
