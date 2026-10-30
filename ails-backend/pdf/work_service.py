"""PdfWorkService: feature operations and owned state."""
from __future__ import annotations
from pdf.work_support import (
    AIConsentRequired,
    AILSGatewayTranslationProvider,
    Any,
    Callable,
    DOCUMENT_TRANSLATION_PROMPT_VERSION,
    HTTPStatus,
    Mapping,
    OpenAICompatibleTranslationProvider,
    PROVIDER_DEEPSEEK,
    Path,
    PdfTranslationCancelled,
    TRANSLATION_LAYOUT_VERSION,
    TranslationGlossary,
    VOICE_AGENT_RUNTIME,
    accounts,
    ai_model_selection,
    asdict,
    cancel_ocr_job,
    coerce_config_bool,
    compliance_metadata,
    dataclass,
    documents,
    edition_manifest,
    ensure_ocr_benchmark_document,
    inspect_pdf_ocr_folder,
    install_ocr_model,
    install_whisper_cpp_model,
    measure_optimal_ocr_performance_profile,
    normalize_app_language,
    ocr_model_status,
    ocr_performance_profile_status,
    os,
    pdf_ocr_status,
    pdf_translation_progress_status,
    register_translation_cancel,
    release_translation_cancel,
    request_translation_cancel,
    require_external_ai_consent,
    resolve_app_path,
    resolve_ocr_model_variant,
    run_full_pdf_ocr,
    run_pdf_ocr_batch,
    run_pdf_translation,
    scan_pdf_problems,
    settings,
    source_identity,
    voice,
    whisper_cpp_model_status,
)
from pdf.work_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class PdfWorkServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    _has_usable_managed_credits: Callable[..., Any]
    _pdf_translation_kwargs: Callable[..., Any]
    _pdf_translation_reservation_cost: Callable[..., Any]
    get_background_work: Callable[[], Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    local_provider_model: Callable[..., Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    require_work_preflight: Callable[..., Any]
    resolve_chatbot_openai_config: Callable[..., Any]
    start_pdf_problem_auto_review: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class PdfWorkService:
    def __init__(self, ports: PdfWorkServicePorts):
        self._ports = ports
        self._has_usable_managed_credits = ports._has_usable_managed_credits
        self._pdf_translation_kwargs = ports._pdf_translation_kwargs
        self._pdf_translation_reservation_cost = ports._pdf_translation_reservation_cost
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.require_work_preflight = ports.require_work_preflight
        self.resolve_chatbot_openai_config = ports.resolve_chatbot_openai_config
        self.start_pdf_problem_auto_review = ports.start_pdf_problem_auto_review
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    @property
    def background_work(self):
        return self._ports.get_background_work()

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def _start_configured_pdf_ocr_review(self, file_path: str, base_dir: str, emit):
        review_engine = str(self.config.get("pdf_ocr_auto_review") or "none").strip().casefold()
        import personal_mode
        if personal_mode.enabled() and review_engine == "cloud":
            emit({"type": "auto_review_error", "error": "개인용에서는 PDF 자동 다중 모델 검수를 지원하지 않습니다. OCR 결과는 보존됩니다."})
            return None
        if review_engine not in {"local", "cloud"}:
            return None
        resolved_base_dir = os.path.abspath(str(base_dir or "").strip()) if str(base_dir or "").strip() else ""
        if not resolved_base_dir:
            emit({
                "type": "auto_review_error",
                "pdf_path": file_path,
                "review_engine": review_engine,
                "error": "문제 검수 저장 폴더가 설정되지 않았습니다.",
            })
            return None
        try:
            emit({
                "type": "auto_review",
                "stage": "analyzing",
                "pdf_path": file_path,
                "review_engine": review_engine,
            })
            catalog = scan_pdf_problems(file_path, resolved_base_dir, reuse_cached=False)
            problems = [item for item in catalog.get("problems", []) if isinstance(item, Mapping)]
            if not problems:
                emit({
                    "type": "auto_review",
                    "stage": "skipped",
                    "status": "completed",
                    "pdf_path": file_path,
                    "review_engine": review_engine,
                    "reason": "no_problems",
                })
                return None
            local_model_id = ""
            if review_engine == "local":
                local_model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(
                    self.config.get("local_problem_review_model")
                )
                local_status = VOICE_AGENT_RUNTIME.status(local_model_id)
                if not local_status.get("runtime_ready"):
                    raise RuntimeError(str(
                        local_status.get("runtime_error") or "llama.cpp Vulkan 실행 파일이 없습니다."
                    ))
                if not local_status.get("ready"):
                    def emit_download(event):
                        emit({
                            **dict(event or {}),
                            "type": "auto_review_model_download",
                            "pdf_path": file_path,
                            "review_engine": review_engine,
                            "model_id": local_model_id,
                        })

                    VOICE_AGENT_RUNTIME.install_model(True, emit_download, model_id=local_model_id)
            job = self.start_pdf_problem_auto_review({
                "pdf_path": file_path,
                "base_dir": resolved_base_dir,
                "mode": "production",
                "review_engine": review_engine,
                "local_problem_review_model": local_model_id,
                "work_acknowledged": True,
            })
            emit({
                "type": "auto_review",
                "stage": "started",
                "pdf_path": file_path,
                "review_engine": review_engine,
                "job_id": job.get("job_id"),
                "status": job.get("status"),
                "primary_model": job.get("primary_model"),
            })
            return job
        except Exception as error:
            emit({
                "type": "auto_review_error",
                "pdf_path": file_path,
                "review_engine": review_engine,
                "error": str(error)[:1_000],
            })
            return None

    def full_pdf_ocr(self, payload: dict, emit):
        file_path = os.path.abspath(str(payload.get("path", "") or ""))
        language = normalize_app_language(
            payload.get("language") or getattr(self, "config", {}).get("language")
        )
        force = payload.get("force") is True
        status = pdf_ocr_status(file_path)
        if status.get("ocr_allowed") is False or (
            status.get("has_text") and not status.get("index_repair_required") and not force
            and status.get("ocr_scope") != "textless_slides"
        ):
            result = {**status, "skipped": True, "skip_reason": "text_layer_exists"}
            emit({"type": "skipped", "reason": "text_layer_exists", "result": result})
            emit({"type": "done", "result": result})
            return result
        allow_cpu = payload.get("allow_cpu") is True
        variant_selector = getattr(self, "selected_pdf_ocr_model_variant", None)
        raw_variant = variant_selector(payload) if callable(variant_selector) else payload.get("model_variant")
        model_variant = resolve_ocr_model_variant(
            raw_variant,
            emit=emit,
            allow_cpu=allow_cpu,
            language=language,
        )
        result = run_full_pdf_ocr(
            file_path,
            language=language,
            emit=emit,
            model_variant=model_variant,
            job_id=payload.get("job_id"),
            force=force,
        )
        config = getattr(self, "config", {})
        if str(config.get("pdf_ocr_auto_review") or "none").strip().casefold() in {"local", "cloud"}:
            review_base_dir = str(payload.get("base_dir") or config.get("md_save_path") or "").strip()
            self._start_configured_pdf_ocr_review(file_path, review_base_dir, emit)
        return result

    def material_folder_pdf_ocr_preflight(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        folder_path = documents.material_workspace_support.ensure_safe_material_dir(
            payload.get("folder_path", "") or payload.get("path", ""),
            base_dir,
        )
        excluded_paths = self.config.get("background_document_ocr_excluded_paths") or []
        return inspect_pdf_ocr_folder(folder_path, excluded_paths=excluded_paths)

    def material_folder_pdf_ocr(self, payload: dict, emit):
        if payload.get("work_acknowledged") is not True:
            raise ValueError("OCR 대상과 텍스트 레이어 제외 안내를 확인한 뒤 시작해 주세요.")
        language = normalize_app_language(
            payload.get("language") or getattr(self, "config", {}).get("language")
        )
        preflight = self.material_folder_pdf_ocr_preflight(payload)
        emit({
            "type": "folder_preflight",
            "folder_path": preflight["folder_path"],
            "pdf_count": preflight["pdf_count"],
            "ocr_count": preflight["ocr_count"],
            "skipped_text_count": preflight["skipped_text_count"],
            "skipped_excluded_count": preflight.get("skipped_excluded_count", 0),
            "unreadable_count": preflight["unreadable_count"],
        })
        paths = [item["path"] for item in preflight["targets"]]
        if not paths:
            result = {
                "total": 0,
                "completed": 0,
                "skipped_text": 0,
                "failed": 0,
                "errors": [],
            }
            emit({"type": "done", "result": result})
            return result
        model_variant = resolve_ocr_model_variant(
            self.selected_pdf_ocr_model_variant(payload),
            emit=emit,
            allow_cpu=payload.get("allow_cpu") is True,
            language=language,
        )
        completed_paths = []

        def emit_batch(event):
            if event.get("type") == "file_done" and event.get("path"):
                completed_paths.append(str(event["path"]))
            emit(event)

        result = run_pdf_ocr_batch(
            paths,
            language=language,
            emit=emit_batch,
            model_variant=model_variant,
            job_id=payload.get("job_id"),
        )
        review_base_dir = str(self.config.get("md_save_path") or "").strip()
        for completed_path in completed_paths:
            self._start_configured_pdf_ocr_review(completed_path, review_base_dir, emit)
        return result

    def _background_translation_identity(self) -> dict:
        if self.workflow_uses_managed_ai("pdf_translation"):
            raise ValueError(
                "Managed background translation is unavailable until the exact session model and endpoint can be resolved without reserving credits; use streaming translation."
            )
        provider, model = self.local_provider_model("pdf_translation")
        endpoint, key, model, _label, _ = self.resolve_chatbot_openai_config(provider, model)
        return OpenAICompatibleTranslationProvider({"api_key": key, "base_url": endpoint, "model": model}).identity

    def enqueue_pdf_translation(self, payload: dict):
        from pypdf import PdfReader

        if payload.get("engine") != "document":
            raise ValueError("Background translation requires engine=document")
        kwargs = self._pdf_translation_kwargs(payload)
        require_external_ai_consent(
            "/api/pdf/translate/stream", self.config, compliance_metadata(edition_manifest.EDITION_MANIFEST),
        )
        self.require_work_preflight(payload, "pdf_translation")
        identity = self._background_translation_identity()
        source = Path(str(payload.get("path") or "")).resolve()
        if source.suffix.lower() != ".pdf":
            raise ValueError("Only PDF documents are supported")
        revision = source_identity(source)["sha256"]
        with source.open("rb") as stream:
            pages = list(range(1, len(PdfReader(stream).pages) + 1))
        if not pages or (payload.get("pages") is not None and kwargs.get("pages") != pages):
            raise ValueError("Background translation currently requires all document pages")
        options = kwargs["options"]
        glossary = kwargs.get("glossary") or TranslationGlossary()
        descriptor = {
            "document_revision": revision,
            "selected_pages": pages,
            "target_language": normalize_app_language(payload.get("target_language") or self.config.get("language")),
            "source_language": options.source_language,
            "provider": identity,
            "prompt_version": DOCUMENT_TRANSLATION_PROMPT_VERSION,
            "glossary_hash": glossary.version,
            "layout_version": TRANSLATION_LAYOUT_VERSION,
            "options": asdict(options),
            "glossary": [asdict(item) for item in glossary.items],
        }
        item = self.background_work.enqueue_translation(str(source), descriptor)
        return {**item, "queued": item["state"] == "pending"}

    def _run_background_translation(self, path, descriptor, emit, cancel_check):
        def check():
            cancel_check()
            require_external_ai_consent(
                "/api/pdf/translate/stream", self.config, compliance_metadata(edition_manifest.EDITION_MANIFEST),
            )

        try:
            check()
            if not coerce_config_bool(self.config.get("background_document_translation"), False):
                raise PdfTranslationCancelled("Background translation is disabled")
            if source_identity(Path(path))["sha256"] != descriptor["document_revision"]:
                return {"status": "blocked"}
            if (descriptor["prompt_version"] != DOCUMENT_TRANSLATION_PROMPT_VERSION
                    or descriptor["layout_version"] != TRANSLATION_LAYOUT_VERSION
                    or self._background_translation_identity() != descriptor["provider"]):
                return {"status": "blocked"}
            payload = {
                "path": path, "engine": "document", "work_acknowledged": True,
                "pages": descriptor["selected_pages"], "target_language": descriptor["target_language"],
                "options": descriptor["options"], "glossary": descriptor["glossary"],
            }
            self.require_work_preflight(payload, "pdf_translation")
            check()
            return self.translate_pdf(
                payload, emit, _cancel_check=check, _expected_provider_identity=descriptor["provider"],
            )
        except AIConsentRequired:
            return {"status": "auth"}
        except accounts.auth_support.ManagedAuthError as error:
            return {"status": "billing" if error.status == HTTPStatus.PAYMENT_REQUIRED else "auth"}
        except ValueError:
            return {"status": "blocked"}

    def translate_pdf(self, payload: dict, emit, *, _cancel_check=None, _expected_provider_identity=None):
        translation_kwargs = self._pdf_translation_kwargs(payload)
        file_path = os.path.abspath(str(payload.get("path", "") or ""))
        target_language = normalize_app_language(
            payload.get("target_language") or getattr(self, "config", {}).get("language")
        )
        cancel_event = register_translation_cancel(file_path)

        def check_cancel():
            if cancel_event.is_set():
                raise PdfTranslationCancelled("사용자가 PDF 번역을 취소했습니다.")
            if _cancel_check is not None:
                _cancel_check()

        try:
            check_cancel()
            if edition_manifest.EDITION_MANIFEST["id"] == "personal" or "ai_model_selection" in getattr(self, "config", {}):
                use_managed_credits = self.workflow_uses_managed_ai("pdf_translation")
            else:
                use_managed_credits = not edition_manifest.LOCAL_AI_SETTINGS_ENABLED or self._has_usable_managed_credits()
            if _expected_provider_identity is not None:
                expected_route = "ails-gateway" if use_managed_credits else "openai-compatible"
                if not translation_kwargs or _expected_provider_identity.get("provider") != expected_route:
                    raise ValueError("Translation provider identity changed")
            if use_managed_credits:
                status = pdf_ocr_status(file_path)
                page_count = max(1, int(status.get("page_count") or 1))
                trans_status = {} if translation_kwargs else pdf_translation_progress_status(file_path, target_language)
                total_pages = max(1, int(trans_status.get("total_pages") or page_count))
                cached_count = int(trans_status.get("cached_pages") or 0)
                remaining_pages = max(0, total_pages - cached_count)
                reserve_pages = remaining_pages if trans_status.get("total_pages", 0) > 0 else page_count
                reserve_cost = self._pdf_translation_reservation_cost(reserve_pages)

                with self.managed_ai_action(
                    "pdf_translation",
                    reserve_cost,
                    **self.managed_workflow_options("pdf_translation"),
                ) as session:
                    translation_config = {
                        **self.config,
                        "summary_provider": PROVIDER_DEEPSEEK,
                        "summary_model_name": session["model_id"],
                        "deepseek_api_key": session["token"],
                        "deepseek_base_url": str(
                            session.get("gateway_url") or ai_model_selection.MANAGED_GATEWAY_CHAT_ENDPOINT
                        ),
                        "deepseek_summary_model_name": session["model_id"],
                    }
                    if translation_kwargs:
                        if session.get("transport") == "chatgpt":
                            from subscription_policy import require_subscription
                            require_subscription()
                            from chatgpt_subscription.translation import ChatGPTTranslationProvider
                            translation_kwargs["provider"] = ChatGPTTranslationProvider(session)
                        else:
                            translation_kwargs["provider"] = AILSGatewayTranslationProvider({
                                "api_key": session["token"],
                                "base_url": translation_config["deepseek_base_url"],
                                "model": session["model_id"],
                            })
                        if (_expected_provider_identity is not None
                                and translation_kwargs["provider"].identity != _expected_provider_identity):
                            raise ValueError("Translation provider identity changed")
                    check_cancel()
                    return run_pdf_translation(
                        file_path,
                        translation_config,
                        emit=emit,
                        cancel_check=check_cancel,
                        target_language=target_language,
                        **translation_kwargs,
                    )
            if edition_manifest.EDITION_MANIFEST["id"] == "personal" or "ai_model_selection" in getattr(self, "config", {}):
                provider_name, personal_model = self.local_provider_model("pdf_translation")
                endpoint, key, personal_model, _label, _ = self.resolve_chatbot_openai_config(provider_name, personal_model)
                translation_config = {
                    **self.config,
                    "deepseek_api_key": key,
                    "deepseek_base_url": endpoint,
                    "deepseek_summary_model_name": personal_model,
                }
            else:
                translation_config = dict(self.config)
                key = str(self.config.get("deepseek_api_key") or "")
                endpoint = str(self.config.get("deepseek_base_url") or "")
                personal_model = str(self.config.get("deepseek_summary_model_name") or self.config.get("summary_model_name") or "")
            if _expected_provider_identity is not None:
                provider = OpenAICompatibleTranslationProvider({
                    "api_key": key, "base_url": endpoint, "model": personal_model,
                })
                if provider.identity != _expected_provider_identity:
                    raise ValueError("Translation provider identity changed")
                translation_kwargs["provider"] = provider
            check_cancel()
            return run_pdf_translation(
                file_path,
                translation_config,
                emit=emit,
                cancel_check=check_cancel,
                target_language=target_language,
                **translation_kwargs,
            )
        finally:
            release_translation_cancel(file_path, cancel_event)

    def cancel_pdf_translation(self, payload: dict):
        file_path = os.path.abspath(str(payload.get("path", "") or ""))
        cancelled = request_translation_cancel(file_path)
        return {"path": file_path, "cancelled": bool(cancelled)}

    def benchmark_pdf_ocr(self, payload: dict, emit):
        requested_path = str(payload.get("path", "") or "").strip()
        built_in_document = not requested_path
        file_path = os.path.abspath(requested_path) if requested_path else ensure_ocr_benchmark_document()
        emit({
            "type": "benchmark_source",
            "source": "built_in" if built_in_document else "user_pdf",
            "path": file_path,
        })
        language = normalize_app_language(
            payload.get("language") or getattr(self, "config", {}).get("language")
        )
        if language != "korean":
            raise ValueError("모델 자동 비교는 현재 한국어 OCR만 지원합니다.")
        compare_models = payload.get("compare_models") is True
        if compare_models:
            resolve_ocr_model_variant(
                "auto",
                allow_cpu=payload.get("allow_cpu") is True,
                language=language,
            )
            model_variant = "auto"
        else:
            model_variant = resolve_ocr_model_variant(
                payload.get("model_variant", "auto"),
                emit=emit,
                allow_cpu=payload.get("allow_cpu") is True,
                language=language,
            )
        return measure_optimal_ocr_performance_profile(
            file_path,
            language=language,
            emit=emit,
            model_variant=model_variant,
            job_id=payload.get("job_id"),
            install_missing_models=payload.get("confirmed") is True,
        )

    def cancel_pdf_ocr(self, payload: dict):
        return cancel_ocr_job(payload.get("job_id"))

    def download_pdf_ocr_model(self, payload: dict, emit):
        language = normalize_app_language(
            payload.get("language") or getattr(self, "config", {}).get("language")
        )
        model_variant = resolve_ocr_model_variant(
            payload.get("model_variant", "auto"),
            emit=emit,
            allow_cpu=payload.get("allow_cpu") is True,
            language=language,
        )
        status = install_ocr_model(
            payload.get("confirmed") is True,
            language=language,
            model_variant=model_variant,
            emit=emit,
        )
        emit({"type": "model_download_complete", "model": status})
        return status

    def get_local_models_status(self) -> dict:
        language = normalize_app_language(getattr(self, "config", {}).get("language"))
        model_variant = resolve_ocr_model_variant(
            self.selected_pdf_ocr_model_variant({}),
            language=language,
        )
        ocr_stat = ocr_model_status(language=language, model_variant=model_variant)
        stt_stat = settings.model_support.offline_voice_whisper_status()

        # Video / Lecture summary STT model
        models = edition_manifest.whisper_cpp_model_options()
        requested_video_model = str(getattr(self, "config", {}).get("stt_model_name") or "").strip()
        video_model_id = (
            requested_video_model
            if requested_video_model in models
            else settings.model_support.select_video_whisper_cpp_model(models=models)
        )
        video_stt_stat = whisper_cpp_model_status(video_model_id)

        local_model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(
            getattr(self, "config", {}).get("local_voice_agent_model")
        )
        va_stat = VOICE_AGENT_RUNTIME.status(local_model_id)

        all_ready = bool(
            ocr_stat.get("ready")
            and stt_stat.get("ready")
            and video_stt_stat.get("ready")
            and va_stat.get("ready")
        )
        return {
            "all_ready": all_ready,
            "ocr": ocr_stat,
            "stt": stt_stat,
            "video_stt": {"selected_model": video_model_id, **video_stt_stat},
            "voice_agent": va_stat,
        }

    def prepare_local_models(self, payload: dict, emit) -> dict:
        if payload.get("confirmed") is not True:
            raise ValueError("로컬 AI 모델 다운로드는 사용자 확인 후에만 실행할 수 있습니다.")

        # 1. OCR Model
        emit({"type": "stage_start", "stage": "ocr", "title": "PDF OCR 모델 준비"})
        language = normalize_app_language(
            payload.get("language") or getattr(self, "config", {}).get("language")
        )
        model_variant = resolve_ocr_model_variant(
            payload.get("model_variant") or self.selected_pdf_ocr_model_variant({}),
            emit=emit,
            allow_cpu=payload.get("allow_cpu") is True,
            language=language,
        )
        ocr_curr = ocr_model_status(language=language, model_variant=model_variant)
        if not ocr_curr.get("ready"):
            install_ocr_model(
                True,
                language=language,
                model_variant=model_variant,
                emit=emit,
            )
        emit({"type": "stage_complete", "stage": "ocr", "title": "PDF OCR 모델 준비 완료"})

        # 2. Voice STT (Whisper) Model
        emit({"type": "stage_start", "stage": "stt", "title": "음성인식(보이스 STT) 모델 준비"})
        stt_curr = settings.model_support.offline_voice_whisper_status()
        if not stt_curr.get("ready"):
            settings.model_support.install_offline_voice_models(True, emit=emit)
        emit({"type": "stage_complete", "stage": "stt", "title": "음성인식(보이스 STT) 모델 준비 완료"})

        # 3. Video / Lecture summary STT Model
        models = edition_manifest.whisper_cpp_model_options()
        requested_video_model = str(getattr(self, "config", {}).get("stt_model_name") or "").strip()
        video_model_id = (
            requested_video_model
            if requested_video_model in models
            else settings.model_support.select_video_whisper_cpp_model(models=models)
        )
        video_stt_curr = whisper_cpp_model_status(video_model_id)
        emit({"type": "stage_start", "stage": "video_stt", "title": f"강의 정리용 음성인식(STT {video_model_id}) 모델 준비"})
        if not video_stt_curr.get("ready"):
            install_whisper_cpp_model(video_model_id, confirmed=True, emit=emit)
        emit({"type": "stage_complete", "stage": "video_stt", "title": "강의 정리용 음성인식(STT) 모델 준비 완료"})

        # 4. Voice Agent (Qwen3) Model
        emit({"type": "stage_start", "stage": "voice_agent", "title": "로컬 AI 모델 준비"})
        local_model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(
            getattr(self, "config", {}).get("local_voice_agent_model")
        )
        va_curr = VOICE_AGENT_RUNTIME.status(local_model_id)
        if not va_curr.get("ready"):
            VOICE_AGENT_RUNTIME.install_model(True, emit, model_id=local_model_id)
        emit({"type": "stage_complete", "stage": "voice_agent", "title": "로컬 AI 모델 준비 완료"})

        final_status = self.get_local_models_status()
        emit({"type": "all_models_ready", "status": final_status})
        return final_status

    def pdf_ocr_performance_profile(self, payload: dict):
        language = normalize_app_language(
            payload.get("language") or getattr(self, "config", {}).get("language")
        )
        return ocr_performance_profile_status(
            language=language,
            model_variant=self.selected_pdf_ocr_model_variant(payload),
        )

    def selected_pdf_ocr_model_variant(self, payload: Mapping) -> str:
        requested = str(payload.get("model_variant") or "auto").strip().casefold()
        if requested != "auto":
            return requested
        return str(getattr(self, "config", {}).get("pdf_ocr_model_variant") or "auto")
