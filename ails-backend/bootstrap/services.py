"""Explicit feature wiring. Only this layer knows the application facade."""
from bootstrap.service_registry import ServiceRegistry


def compose_services(facade):
    def create_chat():
        from chat.conversation_service import ConversationService, ConversationServicePorts
        service = ConversationService(ConversationServicePorts(
            append_ai_debug_trace=lambda *args, **kwargs: facade.append_ai_debug_trace(*args, **kwargs),
            append_idle_log=lambda *args, **kwargs: facade.append_idle_log(*args, **kwargs),
            call_managed_gateway_chat=lambda *args, **kwargs: facade.call_managed_gateway_chat(*args, **kwargs),
            collect_engine_results=lambda *args, **kwargs: facade.collect_engine_results(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            get_lock=lambda: facade.lock,
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_model=lambda *args, **kwargs: facade.managed_workflow_model(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            memory_enabled=lambda *args, **kwargs: facade.memory_enabled(*args, **kwargs),
            memory_service=lambda *args, **kwargs: facade.memory_service(*args, **kwargs),
            memory_settings=lambda *args, **kwargs: facade.memory_settings(*args, **kwargs),
            get_processed_results=lambda: facade.processed_results,
            refresh_reports_from_disk=lambda *args, **kwargs: facade.refresh_reports_from_disk(*args, **kwargs),
            research_scope=lambda *args, **kwargs: facade.research_scope(*args, **kwargs),
            selected_ai_model=lambda *args, **kwargs: facade.selected_ai_model(*args, **kwargs),
            verified_memory_user_id=lambda *args, **kwargs: facade.verified_memory_user_id(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        for name in ('_chatbot_turn_cache_lock', '_chatbot_turn_cache'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_memory():
        from chat.memory_service import MemoryService, MemoryServicePorts
        service = MemoryService(MemoryServicePorts(
            embedding_backend=facade.search_runtime.get_backend,
            get__chatbot_turn_cache=lambda: getattr(facade._services.peek("chat"), "_chatbot_turn_cache", None),
            _managed_auth_request=lambda *args, **kwargs: facade._managed_auth_request(*args, **kwargs),
            append_idle_log=lambda *args, **kwargs: facade.append_idle_log(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            get_lock=lambda: facade.lock,
        ))
        for name in ('_memory_service_lock', '_memory_service', '_memory_service_user_id'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_tasks():
        from jobs.summary_task_service import SummaryTaskService, SummaryTaskServicePorts
        service = SummaryTaskService(SummaryTaskServicePorts(
            acquire_managed_ai_action_session=lambda *args, **kwargs: facade.acquire_managed_ai_action_session(*args, **kwargs),
            append_idle_log=lambda *args, **kwargs: facade.append_idle_log(*args, **kwargs),
            call_image_analysis_batch=lambda *args, **kwargs: facade.call_image_analysis_batch(*args, **kwargs),
            call_managed_video_summary=lambda *args, **kwargs: facade.call_managed_video_summary(*args, **kwargs),
            call_personal_video_summary=lambda *args, **kwargs: facade.call_personal_video_summary(*args, **kwargs),
            call_video_stt_cleanup=lambda *args, **kwargs: facade.call_video_stt_cleanup(*args, **kwargs),
            call_video_verification=lambda *args, **kwargs: facade.call_video_verification(*args, **kwargs),
            call_video_verification_web_search=lambda *args, **kwargs: facade.call_video_verification_web_search(*args, **kwargs),
            call_video_verification_with_tools=lambda *args, **kwargs: facade.call_video_verification_with_tools(*args, **kwargs),
            call_video_visual_event=lambda *args, **kwargs: facade.call_video_visual_event(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            get_engine=lambda: facade.engine,
            ensure_lms_login_for_eclass=lambda *args, **kwargs: facade.ensure_lms_login_for_eclass(*args, **kwargs),
            finish_managed_ai_session=lambda *args, **kwargs: facade.finish_managed_ai_session(*args, **kwargs),
            get_managed_ai_session_result=lambda *args, **kwargs: facade.get_managed_ai_session_result(*args, **kwargs),
            invalidate_lecture_materials_cache=lambda *args, **kwargs: facade.invalidate_lecture_materials_cache(*args, **kwargs),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            get_lock=lambda: facade.lock,
            public_config=lambda *args, **kwargs: facade.public_config(*args, **kwargs),
            require_work_preflight=lambda *args, **kwargs: facade.require_work_preflight(*args, **kwargs),
            selected_ai_model=lambda *args, **kwargs: facade.selected_ai_model(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        for name in ('processed_results', 'session_report_titles', 'notifications', '_disk_retry_titles', '_settlement_refresh_running', '_next_settlement_refresh', '_settlement_lookup_cache'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_materials():
        from documents.material_workspace_service import MaterialWorkspaceService, MaterialWorkspaceServicePorts
        service = MaterialWorkspaceService(MaterialWorkspaceServicePorts(
            _ready_pdf_text_payload=lambda *args, **kwargs: facade._ready_pdf_text_payload(*args, **kwargs),
            append_idle_log=lambda *args, **kwargs: facade.append_idle_log(*args, **kwargs),
            get_background_work=lambda: facade.background_work,
            call_managed_gateway_chat=lambda *args, **kwargs: facade.call_managed_gateway_chat(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            current_semester_folder_name=lambda *args, **kwargs: facade.current_semester_folder_name(*args, **kwargs),
            list_pdf_chat_turns=lambda *args, **kwargs: facade.list_pdf_chat_turns(*args, **kwargs),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            get_lock=lambda: facade.lock,
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            memory_enabled=lambda *args, **kwargs: facade.memory_enabled(*args, **kwargs),
            memory_service=lambda *args, **kwargs: facade.memory_service(*args, **kwargs),
            pdf_study_document_info=lambda *args, **kwargs: facade.pdf_study_document_info(*args, **kwargs),
            get_processed_results=lambda: facade.processed_results,
            refresh_reports_from_disk=lambda *args, **kwargs: facade.refresh_reports_from_disk(*args, **kwargs),
            refresh_retry_candidates_from_disk=lambda *args, **kwargs: facade.refresh_retry_candidates_from_disk(*args, **kwargs),
            resolve_chatbot_openai_config=lambda *args, **kwargs: facade.resolve_chatbot_openai_config(*args, **kwargs),
            get_session_report_titles=lambda: facade.session_report_titles,
            start_pdf_text_extraction=lambda *args, **kwargs: facade.start_pdf_text_extraction(*args, **kwargs),
            verified_memory_user_id=lambda *args, **kwargs: facade.verified_memory_user_id(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        for name in ('lecture_materials_cache_lock', '_lecture_materials_cache', '_lecture_materials_cache_key', '_lecture_materials_cache_at', '_material_file_service_instance', '_material_practice_events_lock', '_material_practice_active_events'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_lms_browser():
        from lms.browser_service import LmsBrowserService, LmsBrowserServicePorts
        service = LmsBrowserService(LmsBrowserServicePorts(
            append_idle_log=lambda *args, **kwargs: facade.append_idle_log(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            get_lock=lambda: facade.lock,
        ))
        for name in ('lms_browser_lock', 'lms_auth_condition', 'lms_auth_attempt', 'lms_playwright', 'lms_browser_context', 'lms_browser_process', 'lms_browser_headless', 'lms_browser_auto_hidden', 'lms_browser_info'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_lms_courses():
        from lms.course_service import LmsCourseService, LmsCourseServicePorts
        service = LmsCourseService(LmsCourseServicePorts(
            _lms_page_kind=lambda *args, **kwargs: facade._lms_page_kind(*args, **kwargs),
            append_idle_log=lambda *args, **kwargs: facade.append_idle_log(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            get_engine=lambda: facade.engine,
            ensure_lms_login_for_eclass=lambda *args, **kwargs: facade.ensure_lms_login_for_eclass(*args, **kwargs),
            inject_lms_hidden_elements_viewer=lambda *args, **kwargs: facade.inject_lms_hidden_elements_viewer(*args, **kwargs),
            mark_result_as_running=lambda *args, **kwargs: facade.mark_result_as_running(*args, **kwargs),
            retry_candidates=lambda *args, **kwargs: facade.retry_candidates(*args, **kwargs),
            video_task_config=lambda *args, **kwargs: facade.video_task_config(*args, **kwargs),
        ))
        return service

    def create_auth():
        from accounts.auth_service import ManagedAuthService, ManagedAuthServicePorts
        service = ManagedAuthService(ManagedAuthServicePorts(
            get__chatbot_turn_cache=lambda: getattr(facade._services.peek("chat"), "_chatbot_turn_cache", None),
            clear_memory_service=lambda *args, **kwargs: facade.clear_memory_service(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            get_lock=lambda: facade.lock,
            selected_ai_model=lambda *args, **kwargs: facade.selected_ai_model(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        for name in ('managed_auth_lock', 'managed_browser_auth', 'managed_auth_context_local', 'managed_session_auth_contexts'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_models():
        from settings.model_service import ModelService, ModelServicePorts
        service = ModelService(ModelServicePorts(
            _managed_auth_request=lambda *args, **kwargs: facade._managed_auth_request(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
        ))
        return service

    def create_study():
        from documents.study_records_service import StudyRecordsService, StudyRecordsServicePorts
        service = StudyRecordsService(StudyRecordsServicePorts(
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
        ))
        for name in ('_pdf_study_service_instance',):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_search():
        from search.material_query_service import MaterialQueryService, MaterialQueryServicePorts
        service = MaterialQueryService(MaterialQueryServicePorts(
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
        ))
        for name in ('_material_search_service_instance',):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_pdf_viewer():
        from pdf.viewer_service import PdfViewerService, PdfViewerServicePorts
        service = PdfViewerService(PdfViewerServicePorts(
            on_text_ready=lambda path: facade.background_work.note_material_paths(embedding_paths=[path])
                if facade.config.get("background_document_embedding", True) and not facade.lifetime.stopping.is_set() else None,
        ))
        for name in ('pdf_text_extraction_lock', 'pdf_text_extraction_jobs'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_pdf_work():
        from pdf.work_service import PdfWorkService, PdfWorkServicePorts
        service = PdfWorkService(PdfWorkServicePorts(
            _has_usable_managed_credits=lambda *args, **kwargs: facade._has_usable_managed_credits(*args, **kwargs),
            _pdf_translation_kwargs=lambda *args, **kwargs: facade._pdf_translation_kwargs(*args, **kwargs),
            _pdf_translation_reservation_cost=lambda *args, **kwargs: facade._pdf_translation_reservation_cost(*args, **kwargs),
            get_background_work=lambda: facade.background_work,
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            require_work_preflight=lambda *args, **kwargs: facade.require_work_preflight(*args, **kwargs),
            resolve_chatbot_openai_config=lambda *args, **kwargs: facade.resolve_chatbot_openai_config(*args, **kwargs),
            start_pdf_problem_auto_review=lambda *args, **kwargs: facade.start_pdf_problem_auto_review(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        return service

    def create_auto_review():
        from documents.auto_review_service import AutoReviewService, AutoReviewServicePorts
        service = AutoReviewService(AutoReviewServicePorts(
            acquire_managed_ai_session=lambda *args, **kwargs: facade.acquire_managed_ai_session(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            finish_managed_ai_session=lambda *args, **kwargs: facade.finish_managed_ai_session(*args, **kwargs),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_problem_review_policy=lambda *args, **kwargs: facade.managed_problem_review_policy(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        for name in ('pdf_problem_auto_review_lock', 'pdf_problem_auto_review_jobs', 'pdf_problem_auto_review_cancel_events', 'pdf_problem_auto_review_threads'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_review():
        from documents.review_service import ReviewService, ReviewServicePorts
        service = ReviewService(ReviewServicePorts(
            append_idle_log=lambda *args, **kwargs: facade.append_idle_log(*args, **kwargs),
            call_managed_gateway_chat=lambda *args, **kwargs: facade.call_managed_gateway_chat(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            memory_enabled=lambda *args, **kwargs: facade.memory_enabled(*args, **kwargs),
            memory_service=lambda *args, **kwargs: facade.memory_service(*args, **kwargs),
            resolve_chatbot_openai_config=lambda *args, **kwargs: facade.resolve_chatbot_openai_config(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        return service

    def create_practice():
        from documents.practice_service import PracticeService, PracticeServicePorts
        service = PracticeService(PracticeServicePorts(
            call_managed_gateway_chat=lambda *args, **kwargs: facade.call_managed_gateway_chat(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            resolve_chatbot_openai_config=lambda *args, **kwargs: facade.resolve_chatbot_openai_config(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        return service

    def create_research():
        from chat.research_service import ResearchService, ResearchServicePorts
        service = ResearchService(ResearchServicePorts(
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_workflow_model=lambda *args, **kwargs: facade.managed_workflow_model(*args, **kwargs),
            search_materials=lambda *args, **kwargs: facade.search_materials(*args, **kwargs),
            selected_ai_model=lambda *args, **kwargs: facade.selected_ai_model(*args, **kwargs),
        ))
        return service

    def create_video():
        from summary_generation.video_ai_service import VideoAiService, VideoAiServicePorts
        service = VideoAiService(VideoAiServicePorts(
            append_ai_debug_trace=lambda *args, **kwargs: facade.append_ai_debug_trace(*args, **kwargs),
            call_managed_gateway_chat=lambda *args, **kwargs: facade.call_managed_gateway_chat(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            resolve_chatbot_openai_config=lambda *args, **kwargs: facade.resolve_chatbot_openai_config(*args, **kwargs),
            selected_ai_model=lambda *args, **kwargs: facade.selected_ai_model(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        return service

    def create_notebook():
        from code_services.kernel_service import KernelService, KernelServicePorts
        service = KernelService(KernelServicePorts(
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            read_material_file=lambda *args, **kwargs: facade.read_material_file(*args, **kwargs),
        ))
        for name in ('notebook_kernel_lock', 'notebook_kernels', '_notebook_workers'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_code_assist():
        from code_services.assist_service import CodeAssistService, CodeAssistServicePorts
        service = CodeAssistService(CodeAssistServicePorts(
            call_managed_gateway_chat=lambda *args, **kwargs: facade.call_managed_gateway_chat(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            parse_code_review_response=lambda *args, **kwargs: facade.parse_code_review_response(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        return service

    def create_insight():
        from documents.insight_service import InsightService, InsightServicePorts
        service = InsightService(InsightServicePorts(
            _call_material_practice_ai=lambda *args, **kwargs: facade._call_material_practice_ai(*args, **kwargs),
            _material_practice_ai_selection=lambda *args, **kwargs: facade._material_practice_ai_selection(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            get_managed_auth_context_local=lambda: facade.managed_auth_context_local,
            verified_memory_user_id=lambda *args, **kwargs: facade.verified_memory_user_id(*args, **kwargs),
        ))
        for name in ('_insight_account_access', '_insight_db_root'):
            if name in facade.__dict__:
                setattr(service, name, facade.__dict__.pop(name))
        return service

    def create_preflight():
        from jobs.preflight_service import PreflightService, PreflightServicePorts
        service = PreflightService(PreflightServicePorts(
            _has_usable_managed_credits=lambda *args, **kwargs: facade._has_usable_managed_credits(*args, **kwargs),
            get_config=lambda: facade.config,
            replace_config=lambda value: setattr(facade, "config", value),
            managed_auth_status=lambda *args, **kwargs: facade.managed_auth_status(*args, **kwargs),
            selected_ai_model=lambda *args, **kwargs: facade.selected_ai_model(*args, **kwargs),
        ))
        return service

    def create_voice():
        from voice.agent_service import VoiceAgentService, VoiceAgentServicePorts
        service = VoiceAgentService(VoiceAgentServicePorts(
            append_ai_debug_trace=lambda *args, **kwargs: facade.append_ai_debug_trace(*args, **kwargs),
            call_managed_gateway_chat=lambda *args, **kwargs: facade.call_managed_gateway_chat(*args, **kwargs),
            get_config=lambda: facade.config,
            local_provider_model=lambda *args, **kwargs: facade.local_provider_model(*args, **kwargs),
            managed_ai_action=lambda *args, **kwargs: facade.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: facade.managed_workflow_options(*args, **kwargs),
            resolve_chatbot_openai_config=lambda *args, **kwargs: facade.resolve_chatbot_openai_config(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: facade.workflow_uses_managed_ai(*args, **kwargs),
        ))
        return service

    def create_background_documents():
        if facade.lifetime.stopping.is_set():
            raise RuntimeError("AILS is shutting down")
        from background_document_work import BackgroundDocumentWorkManager
        return BackgroundDocumentWorkManager(
            enqueue_index=facade.search_runtime.enqueue,
            index_status=facade.search_runtime.index_status,
            run_translation=facade._run_background_translation,
            on_document_ocr_complete=lambda path: facade._start_configured_pdf_ocr_review(
                path, str(facade.config.get("md_save_path") or ""), lambda event: None),
        )

    def create_office_studio():
        # Shutdown may already have inspected unused services. Do not create a
        # new optional listener after that inspection and escape its owner.
        if facade.lifetime.stopping.is_set():
            raise RuntimeError("AILS is shutting down")
        from documents.office_studio import OfficeStudioRuntime
        return OfficeStudioRuntime()

    return ServiceRegistry({
        "chat": create_chat,
        "memory": create_memory,
        "tasks": create_tasks,
        "materials": create_materials,
        "lms_browser": create_lms_browser,
        "lms_courses": create_lms_courses,
        "auth": create_auth,
        "models": create_models,
        "study": create_study,
        "search": create_search,
        "pdf_viewer": create_pdf_viewer,
        "pdf_work": create_pdf_work,
        "auto_review": create_auto_review,
        "review": create_review,
        "practice": create_practice,
        "research": create_research,
        "video": create_video,
        "notebook": create_notebook,
        "code_assist": create_code_assist,
        "insight": create_insight,
        "preflight": create_preflight,
        "voice": create_voice,
        "office_studio": create_office_studio,
        "background_documents": create_background_documents,
    })
