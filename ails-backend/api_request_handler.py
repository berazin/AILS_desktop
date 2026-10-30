from __future__ import annotations
import base64
import binascii
import hmac
import json
import logging
import mimetypes
import os
import posixpath
import re
import sys
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Mapping, TYPE_CHECKING
from urllib.parse import parse_qs, unquote, urlparse
import ai_compliance
import api_context
import api_modules.api_managed_auth
import api_modules.api_model_options
from edition_manifest import feature_enabled as _ide_feature_enabled
if _ide_feature_enabled("ide"):
    from api_modules.api_notebook_environments import notebook_environment_request
import api_modules.api_pdf_viewer
import code_services.code_executor
import common
import edition_manifest
import ide_policy
import hardware_capabilities
import pdf.pdf_viewer_data
import server_config

if TYPE_CHECKING:
    import api_server

class AILSRequestHandler(BaseHTTPRequestHandler):
    server_version = 'AILSApi/0.1'

    def handle_one_request(self):
        with self.server.state.search_runtime.scope():
            super().handle_one_request()

    @property
    def state(self) -> api_server.ApiState:
        return self.server.state

    @property
    def frontend_dir(self) -> Path:
        return self.server.frontend_dir

    def _reject_foreign_origin_or_host(self) -> bool:
        """Send a 403 when Host or Origin fails validation; True means rejected."""
        server = self.server
        host = str(self.headers.get('Host') or '').strip().lower()
        if host not in getattr(server, 'allowed_host_headers', frozenset()):
            self.send_json({'error': 'forbidden host'}, status=HTTPStatus.FORBIDDEN)
            return True
        origin = str(self.headers.get('Origin') or '').strip().rstrip('/').lower()
        if origin and origin not in getattr(server, 'allowed_origins', frozenset()):
            self.send_json({'error': 'forbidden origin'}, status=HTTPStatus.FORBIDDEN)
            return True
        return False

    def check_api_access(self, parsed) -> bool:
        """Validate Host/Origin/token for an /api request; False means blocked."""
        if self._reject_foreign_origin_or_host():
            return False
        provided = str(self.headers.get(api_context.LOCAL_API_TOKEN_HEADER) or '').strip()
        expected = str(getattr(self.server, 'local_api_token', '') or '')
        if not expected or not hmac.compare_digest(provided.encode('utf-8'), expected.encode('utf-8')):
            self.send_json({'error': 'forbidden'}, status=HTTPStatus.FORBIDDEN)
            return False
        ide_policy.check_route(parsed.path)
        if parsed.path == "/api/files":
            ide_policy.require_document(parse_qs(parsed.query).get("path", [""])[0], resource=True)
        for prefix, feature in (("/api/memory", "user_memory"), ("/api/insight-book", "insight_book")):
            if parsed.path == prefix or parsed.path.startswith(prefix + "/"):
                edition_manifest.require_feature(feature)
        return True

    def do_OPTIONS(self):
        try:
            if self._reject_foreign_origin_or_host():
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.write_cors_headers()
            self.end_headers()
        except Exception as error:
            return self.handle_request_error(error)

    @staticmethod
    def is_client_disconnect(error: Exception) -> bool:
        if isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return True
        if isinstance(error, OSError):
            return getattr(error, 'winerror', None) in {10038, 10053, 10054, 10057, 10058}
        return False

    def handle_request_error(self, error: Exception):
        if self.is_client_disconnect(error):
            return None
        try:
            return self.send_error_json(error)
        except Exception as send_error:
            if self.is_client_disconnect(send_error):
                return None
            raise

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path.startswith('/api') and (not self.check_api_access(parsed)):
                return
            if path.startswith('/api/local-ai/'):
                from api_modules.api_local_ai import handle_local_ai_request
                return handle_local_ai_request(self, 'GET', path)
            if path.startswith('/api/auth/'):
                from personal_mode import require_server_enabled
                require_server_enabled()
            if path.startswith('/api/chatgpt/'):
                from api_modules.api_chatgpt import handle_chatgpt_request
                return self.send_json(handle_chatgpt_request(self.state, 'GET', path))
            if path == '/api/health':
                return self.send_json({'ok': True, 'time': time.time(), 'edition': edition_manifest.EDITION_MANIFEST['id'], 'edition_manifest_sha256': edition_manifest.manifest_sha256()})
            if path == '/api/practice/grading-context':
                from api_modules.api_practice_grading_context import handle_practice_grading_context
                values = parse_qs(parsed.query)
                return self.send_json(handle_practice_grading_context(self.state, 'GET', {key: values.get(key, [''])[0] for key in ('kind', 'path', 'base_dir')}))
            if path == '/api/edition':
                return self.send_json({'id': edition_manifest.EDITION_MANIFEST['id'], 'display_name': edition_manifest.EDITION_MANIFEST['display_name'], 'features': edition_manifest.EDITION_MANIFEST['features'], 'manifest_sha256': edition_manifest.manifest_sha256()})
            if path == '/api/options':
                return self.send_json({'stt_provider_options': api_modules.api_model_options.available_stt_provider_options(), 'whisper_model_options': edition_manifest.whisper_cpp_model_options(), 'whisper_cpp_model_options': edition_manifest.whisper_cpp_model_options(), 'local_stt_runtime': {'providers': list(edition_manifest.allowed_local_stt_providers()), 'faster_whisper_models': edition_manifest.faster_whisper_model_options(), 'whisper_cpp_models': edition_manifest.whisper_cpp_model_options(), 'directml_whisper_models': edition_manifest.directml_whisper_model_options(), 'acceleration': edition_manifest.EDITION_MANIFEST['packaging']['whisper_cpp_acceleration'], 'execution_provider': 'Vulkan preferred' if edition_manifest.whisper_cpp_model_options() else None, 'decoder_execution_provider': 'Vulkan preferred' if edition_manifest.whisper_cpp_model_options() else None, 'model_bundled': edition_manifest.EDITION_MANIFEST['packaging']['local_stt_policy'] == 'audited-whisper-cpp-vulkan-bundle-required', 'model_downloadable': edition_manifest.EDITION_MANIFEST['packaging']['local_stt_policy'] in {'audited-whisper-cpp-vulkan-bundle-required', 'downloadable-whisper-cpp-vulkan-models'}, 'cpu_fallback': True}, 'status_log_view_options': common.STATUS_LOG_VIEW_OPTIONS})
            if path == '/api/model-options':
                return self.send_json(self.state.model_options())
            if path == '/api/chatbot/model-catalog':
                return self.send_json(self.state.chatbot_model_catalog())
            if path == '/api/chatbot/practice-tutor-capabilities':
                return self.send_json(self.state.practice_tutor_capabilities())
            if path in ('/api/managed-ai-policy', '/api/cloud-models', '/managed-ai-policy', '/api/api/managed-ai-policy'):
                return self.send_json(self.state.managed_cloud_model_catalog())
            if path == '/api/phoenix/status':
                edition_manifest.require_feature('developer_tools')
                return self.send_json(self.state.phoenix_status())
            if path == '/api/config':
                return self.send_json({'config': self.state.public_config(include_secrets=True)})
            if path == '/api/memory':
                return self.send_json(self.state.memory_snapshot())
            if path == '/api/config/defaults':
                return self.send_json({'config': server_config.default_config_for_ui()})
            if path == '/api/local-inference/capabilities':
                return self.send_json(hardware_capabilities.HardwareCapabilityService().snapshot())
            if path == '/api/python/status':
                return self.send_json(self.state.python_runtime_status())
            if path == '/api/voice/status':
                return self.send_json(api_modules.api_model_options.offline_voice_whisper_status())
            if path == '/api/local/models/status':
                return self.send_json(self.state.get_local_models_status())
            if path == '/api/assist/status':
                return self.send_json(self.state.ai_assist_status())
            if path == '/api/background-work/status':
                background_work = getattr(self.state, 'background_work', None)
                payload = background_work.status() if background_work is not None else {}
                return self.send_json({'background_work': payload})
            if path == '/api/background-work/queue':
                background_work = getattr(self.state, 'background_work', None)
                payload = background_work.queue_details() if background_work is not None else {'current_ocr': None, 'evaluating': [], 'ocr_pending': [], 'embedding_pending': [], 'total_waiting': 0}
                return self.send_json({'queue': payload})
            if path == '/api/auth/status':
                return self.send_json(self.state.managed_auth_status())
            if path == '/api/auth/plans':
                return self.send_json(self.state.managed_auth_plans())
            if path == '/api/auth/credit-payment':
                return self.send_json(self.state.managed_auth_credit_payment_status())
            if path == '/api/compliance':
                return self.send_json(ai_compliance.build_compliance_status(edition_manifest.EDITION_MANIFEST, self.state.config, common.BASE_EXE_DIR))
            if path == '/api/status':
                params = parse_qs(parsed.query)
                scan_disk = str(params.get('scan_disk', [''])[0]).lower() in {'1', 'true', 'yes'}
                lite = str(params.get('lite', [''])[0]).lower() in {'1', 'true', 'yes'}
                return self.send_json(self.state.build_status_payload(scan_disk=scan_disk, lite=lite and (not scan_disk)))
            if path == '/api/lms/auth/status':
                return self.send_json(self.state.get_lms_auth_status())
            if path == '/api/files':
                return self.serve_local_file(parsed)
            if path == '/api/lecture-materials':
                params = parse_qs(parsed.query, keep_blank_values=True)
                if 'directory' in params:
                    self.send_json(self.state.lecture_material_directory(params['directory'][0], **(
                        {'include_problem_progress': True} if params.get('problem_progress', [''])[0] == '1' else {}
                    )))
                    startup_scan = getattr(self.state, 'startup_material_scan', None)
                    if startup_scan is not None:
                        startup_scan.release()
                    return
                return self.send_json(self.state.lecture_materials())
            if path == '/api/material-practice/set':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.material_practice_set(params.get('path', [''])[0]))
            if path == '/api/insight-book':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.insight_snapshot(params.get('raw_offset', ['0'])[0], params.get('revision_offset', ['0'])[0], params.get('review_filter', ['all'])[0]))
            if path == '/api/insight-book/record':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.insight_record(params.get('raw_id', [''])[0]))
            if path == '/api/libreoffice/status':
                from documents.presentation_service import libreoffice_status
                return self.send_json(libreoffice_status())
            if path == '/api/presentation/convert-status':
                params = parse_qs(parsed.query)
                raw_path = str(params.get('path', [''])[0] or '').strip()
                if not raw_path:
                    return self.send_json({'error': 'missing path'}, status=HTTPStatus.BAD_REQUEST)
                from documents.presentation_service import presentation_convert_status
                return self.send_json(presentation_convert_status(raw_path))
            if path == '/api/developer-tools':
                edition_manifest.require_feature('developer_tools')
                from developer_tools import developer_tools_status
                params = parse_qs(parsed.query)
                force = str(params.get('refresh', [''])[0]).lower() in {'1', 'true', 'yes'}
                return self.send_json(developer_tools_status(force=force))
            if path == '/api/developer-tools/install-status':
                edition_manifest.require_feature('developer_tools')
                from developer_tools import developer_tool_install_status
                params = parse_qs(parsed.query)
                return self.send_json(developer_tool_install_status(params.get('job_id', [''])[0]))
            if path == '/api/code/language-profiles':
                edition_manifest.require_feature('developer_tools')
                from code_services.language_profiles import language_profiles_status
                return self.send_json(language_profiles_status())
            if path == '/api/code/language-registry/search':
                edition_manifest.require_feature('developer_tools')
                from code_services.language_registry import search_language_registry
                params = parse_qs(parsed.query)
                return self.send_json(search_language_registry(params.get('query', [''])[0]))
            if path == '/api/code/language-registry/install-status':
                edition_manifest.require_feature('developer_tools')
                from code_services.language_registry import language_pack_install_status
                params = parse_qs(parsed.query)
                return self.send_json(language_pack_install_status(params.get('job_id', [''])[0]))
            if path == '/api/code/language-profiles/assets':
                edition_manifest.require_feature('developer_tools')
                from code_services.language_registry import language_profile_assets
                params = parse_qs(parsed.query)
                return self.send_json(language_profile_assets(params.get('profile_id', [''])[0]))
            if path == '/api/code/run/stream':
                params = parse_qs(parsed.query)
                return self.send_json(self.server.code_execution_manager.read(session_id=params.get('session_id', [''])[0], stdout_offset=params.get('stdout_offset', [0])[0], stderr_offset=params.get('stderr_offset', [0])[0], wait_seconds=params.get('wait', [0])[0]))
            if path == '/api/office/open':
                from api_modules.api_office import office_request
                params = parse_qs(parsed.query)
                return self.send_json(office_request(self.state, 'open', {'path': params.get('path', [''])[0]}), cache_control='no-store')
            if path == '/api/material-file':
                params = parse_qs(parsed.query)
                return self.send_json({'file': self.state.read_material_file(params.get('path', [''])[0])})
            if path == '/api/material-file/siblings':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.material_file_siblings(params.get('path', [''])[0]))
            if path == '/api/material-file/text-status':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.pdf_text_extraction_status(params.get('path', [''])[0]))
            if path == '/api/material-file/pdf-page-version':
                return self.serve_pdf_page_version(parsed)
            if path == '/api/material-file/pdf-page':
                return self.serve_pdf_thumbnail(parsed)
            if path == '/api/pdf-page-state':
                return self.send_json(self.state.read_pdf_page_state())
            if path == '/api/pdf/study/chat-concepts':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.list_pdf_chat_concepts({'path': params.get('path', [''])[0]}))
            if path == '/api/pdf/study/chat-sessions':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.list_pdf_chat_sessions({'path': params.get('path', [''])[0]}))
            if path == '/api/pdf/study/chat-history':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.list_pdf_chat_turns({'path': params.get('path', [''])[0], 'session_id': params.get('session_id', [''])[0]}))
            if path == '/api/pdf/study/annotations':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.list_pdf_annotations({'path': params.get('path', [''])[0]}))
            if path == '/api/pdf/study/document-info':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.pdf_study_document_info({'path': params.get('path', [''])[0]}))
            if path == '/api/pdf/study/document-metas':
                return self.send_json(self.state.list_pdf_document_metas())
            if path == '/api/pdf/problems':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.list_pdf_study_problems(params.get('pdf_path', [''])[0], params.get('base_dir', [''])[0]))
            if path == '/api/pdf/problems/multimodal-review/gold':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.list_pdf_problem_multimodal_gold_samples({'pdf_path': params.get('pdf_path', [''])[0], 'base_dir': params.get('base_dir', [''])[0]}))
            if path == '/api/pdf/problems/multimodal-review/queue':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.list_pdf_problem_multimodal_review_queue({'pdf_path': params.get('pdf_path', [''])[0], 'base_dir': params.get('base_dir', [''])[0]}))
            if path == '/api/pdf/problems/multimodal-review/auto/status':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.pdf_problem_auto_review_status({'pdf_path': params.get('pdf_path', [''])[0], 'base_dir': params.get('base_dir', [''])[0]}))
            if path == '/api/reports':
                self.state.collect_engine_results()
                self.state.refresh_reports_from_disk()
                return self.send_json({'reports': self.state.report_summaries(session_only=True)})
            if path.startswith('/api/reports/'):
                title = unquote(path[len('/api/reports/'):])
                return self.send_json({'report': self.state.get_report(title)})
            return self.serve_static(path)
        except Exception as error:
            return self.handle_request_error(error)

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path.startswith('/api') and (not self.check_api_access(parsed)):
                return
            payload = self.read_json_body()
            if path == '/api/practice/grading-context':
                from api_modules.api_practice_grading_context import handle_practice_grading_context
                return self.send_json(handle_practice_grading_context(self.state, 'POST', payload))
            if path.startswith('/api/local-ai/'):
                from api_modules.api_local_ai import handle_local_ai_request
                return handle_local_ai_request(self, 'POST', path, payload)
            if path.startswith('/api/auth/'):
                from personal_mode import require_server_enabled
                require_server_enabled()
            if path.startswith('/api/chatgpt/'):
                from api_modules.api_chatgpt import handle_chatgpt_request
                return self.send_json(handle_chatgpt_request(self.state, 'POST', path, payload))
            if path == '/api/background-work/spacing/password':
                return self.send_json(self.state.background_work.submit_spacing_password(
                    payload.get('path'), payload.get('password')), status=HTTPStatus.ACCEPTED)
            if path == '/api/model-selection/preview':
                return self.send_json(self.state.preview_ai_model_selections(payload))
            if path == '/api/chatbot/model-selection/validate':
                return self.send_json(self.state.validate_chatbot_model(payload))
            if path == '/api/auth/register':
                return self.send_json(self.state.managed_auth_register(payload), status=HTTPStatus.CREATED)
            if path == '/api/auth/signup/email':
                return self.send_json(self.state.managed_auth_start_signup_email(payload), status=HTTPStatus.CREATED)
            if path == '/api/auth/signup/email/verify':
                return self.send_json(self.state.managed_auth_verify_signup_email(payload))
            if path == '/api/auth/email/verification/resend':
                return self.send_json(self.state.managed_auth_resend_verification(payload), status=HTTPStatus.ACCEPTED)
            if path == '/api/auth/password/reset/request':
                return self.send_json(self.state.managed_auth_request_password_reset(payload), status=HTTPStatus.ACCEPTED)
            if path == '/api/auth/account/id-recovery/request':
                return self.send_json(self.state.managed_auth_request_id_recovery(payload), status=HTTPStatus.ACCEPTED)
            if path == '/api/auth/login':
                return self.send_json(self.state.managed_auth_login(payload))
            if path == '/api/auth/plan':
                return self.send_json(self.state.managed_auth_select_plan(payload))
            if path == '/api/auth/checkout':
                return self.send_json(self.state.managed_auth_checkout(payload))
            if path == '/api/auth/secondary-pin':
                return self.send_json(self.state.managed_auth_set_secondary_pin(payload))
            if path == '/api/auth/account-registration':
                return self.send_json(self.state.managed_auth_start_account_registration())
            if path == '/api/auth/registered-account-charge':
                return self.send_json(self.state.managed_auth_charge_registered_account(payload))
            if path == '/api/auth/browser/start':
                return self.send_json(self.state.managed_auth_browser_start(payload), status=HTTPStatus.CREATED)
            if path == '/api/auth/browser/poll':
                return self.send_json(self.state.managed_auth_browser_poll())
            if path == '/api/auth/browser/cancel':
                return self.send_json(self.state.managed_auth_browser_cancel(payload))
            if path == '/api/auth/logout':
                return self.send_json(self.state.managed_auth_logout())
            if path == '/api/feedback':
                return self.send_json(self.state.submit_feedback(payload))
            if path == '/api/voice/model/download/stream':
                return self.send_ndjson_stream(lambda emit: api_modules.api_model_options.install_offline_voice_models(payload.get('confirmed') is True, emit))
            if path == '/api/voice/agent/model/download/stream':
                from voice.llama_cpp_voice_agent import VOICE_AGENT_RUNTIME
                return self.send_ndjson_stream(lambda emit: VOICE_AGENT_RUNTIME.install_model(payload.get('confirmed') is True, emit, model_id=str(payload.get('model_id') or '').strip()))
            if path == '/api/voice/start':
                import pipeline_utils
                import voice.voice_recognition
                status = api_modules.api_model_options.offline_voice_whisper_status()
                if not status['ready']:
                    raise RuntimeError(status['runtime_error'] or '오프라인 Whisper 모델이 준비되지 않았습니다.')
                pipeline_utils.validate_whisper_cpp_vulkan_runtime(status['selected_model'])
                start = voice.voice_recognition.VOICE_RECOGNITION_SERVICE.start_two_pass if status['two_pass'] else voice.voice_recognition.VOICE_RECOGNITION_SERVICE.start_whisper
                return self.send_json(start(status['selected_model'], status['use_vulkan']), status=HTTPStatus.CREATED)
            if path == '/api/voice/chunk':
                import voice.voice_recognition
                encoded = str(payload.get('pcm16_base64', '') or '')
                if len(encoded) > (voice.voice_recognition.MAX_PCM_CHUNK_BYTES + 2) // 3 * 4 + 4:
                    raise ValueError('보이스 PCM chunk가 너무 큽니다.')
                try:
                    pcm = base64.b64decode(encoded, validate=True)
                except (binascii.Error, TypeError, ValueError) as error:
                    raise ValueError('보이스 PCM chunk가 올바른 base64가 아닙니다.') from error
                return self.send_json(voice.voice_recognition.VOICE_RECOGNITION_SERVICE.accept_pcm16(payload.get('session_id', ''), pcm, int(payload.get('sample_rate', 0) or 0), str(payload.get('speech_state', 'active') or 'active')))
            if path == '/api/voice/stop':
                import voice.voice_recognition
                return self.send_json(voice.voice_recognition.VOICE_RECOGNITION_SERVICE.stop(payload.get('session_id', '')))
            if path == '/api/voice/flush':
                import voice.voice_recognition
                return self.send_json(voice.voice_recognition.VOICE_RECOGNITION_SERVICE.flush(payload.get('session_id', '')))
            if path == '/api/voice/cancel':
                import voice.voice_recognition
                import voice.llama_cpp_voice_agent
                result = voice.voice_recognition.VOICE_RECOGNITION_SERVICE.cancel(payload.get('session_id', ''))
                voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.close()
                return self.send_json(result)
            if path == '/api/compliance/consent':
                action = str(payload.get('action', '') or '')
                next_config = ai_compliance.record_consent_decision(self.state.config, ai_compliance.compliance_metadata(edition_manifest.EDITION_MANIFEST), action, payload.get('acknowledgements') if isinstance(payload.get('acknowledgements'), Mapping) else None)
                with self.state.lock:
                    self.state.config = server_config.save_config(next_config)
                if action.strip().lower() == 'withdraw':
                    self.state.engine.request_cancel_all()
                    self.state.cancel_all_pdf_problem_auto_reviews()
                    self.state.cancel_all_material_practice_generations()
                    self.state.cancel_all_insight_work()
                return self.send_json(ai_compliance.build_compliance_status(edition_manifest.EDITION_MANIFEST, self.state.config, common.BASE_EXE_DIR))
            if path == '/api/material-practice/cancel':
                return self.send_json(self.state.cancel_material_practice_generation(payload))
            if path in {'/api/chatbot/evidence/anchor', '/api/chatbot/evidence/resolve'}:
                from api_modules.api_answer_evidence import answer_evidence_request
                return self.send_json(answer_evidence_request(self.state.config, payload, anchor=path.endswith('/anchor')))
            if path == '/api/insight-book/submit':
                return self.send_json(self.state.insight_submit(payload), status=HTTPStatus.ACCEPTED)
            if path == '/api/insight-book/action':
                return self.send_json(self.state.insight_action(payload))
            if path == '/api/compliance/open-data-directory':
                return self.send_json(self.state.open_local_path(common.BASE_EXE_DIR))
            if path == '/api/work/preflight':
                return self.send_json(self.state.work_preflight(payload))
            if path == '/api/search/context':
                return self.send_json(self.state.search_context(payload))
            if path == '/api/chatbot/research-tool':
                return self.send_json(self.state.execute_research_tool(payload))
            if path == '/api/search/materials':
                return self.send_json(self.state.search_materials(payload))
            if path == '/api/search/prepare':
                return self.send_json(self.state.prepare_material_search(payload))
            if path == '/api/search/status':
                return self.send_json(self.state.material_search_status(payload))
            if path == '/api/assist/warmup':
                return self.send_json(self.state.warm_ai_assist(payload))
            if path == '/api/assist/stop':
                return self.send_json(self.state.stop_ai_assist())
            if path not in {"/api/pdf/problems/grade", "/api/pdf/problems/grade-batch"}:
                ai_compliance.require_external_ai_consent(path, self.state.config, ai_compliance.compliance_metadata(edition_manifest.EDITION_MANIFEST))
            if path == '/api/voice/agent/stream':
                self.state.require_work_preflight(payload, 'voice_agent')
                return self.send_ndjson_stream(lambda emit: self.state.stream_realtime_voice_agent(payload, emit))
            if path == '/api/voice/agent/warmup':
                self.state.require_work_preflight(payload, 'voice_agent')
                return self.send_json(self.state.warm_realtime_voice_agent())
            if path == '/api/config':
                config_update = payload.get('config', payload)
                if isinstance(config_update, dict):
                    config_update = server_config.filter_config_update_for_edition(config_update)
                    config_update = {key: value for key, value in config_update.items() if not key.startswith('ai_consent_') and (key not in server_config.SECRET_CONFIG_KEYS or value != server_config.API_KEY_STORED_PLACEHOLDER)}
                with self.state.lock:
                    previous_save_path = self.state.config.get('md_save_path')
                    next_config = dict(self.state.config)
                    next_config.update(config_update)
                    self.state.config = server_config.save_config(next_config)
                    retry_scan_required = previous_save_path != self.state.config.get('md_save_path')
                if retry_scan_required:
                    self.state.refresh_retry_candidates_from_disk()
                background_work = getattr(self.state, 'background_work', None)
                if background_work is not None:
                    try:
                        background_work.configure(self.state.config)
                    except Exception:
                        pass
                return self.send_json({'config': self.state.public_config(include_secrets=True)})
            if path == '/api/tasks/url':
                task_id = self.state.queue_url_task(payload)
                return self.send_json({'task_id': task_id}, status=HTTPStatus.CREATED)
            if path == '/api/tasks/youtube':
                task_ids = self.state.queue_youtube_task(payload)
                return self.send_json({'task_ids': task_ids, 'task_id': task_ids[0] if task_ids else None}, status=HTTPStatus.CREATED)
            if path == '/api/tasks/eclass-vod':
                task_id = self.state.queue_eclass_vod_task(payload)
                return self.send_json({'task_id': task_id}, status=HTTPStatus.CREATED)
            if path == '/api/tasks/lms-scan':
                result = self.state.scan_lms_course_and_enqueue(payload)
                return self.send_json(result, status=HTTPStatus.CREATED)
            if path == '/api/tasks/audio':
                task_ids = self.state.queue_audio_task(payload)
                return self.send_json({'task_ids': task_ids}, status=HTTPStatus.CREATED)
            if path == '/api/tasks/video-detailed':
                task_id = self.state.queue_video_task(payload, 'video_detailed')
                return self.send_json({'task_id': task_id}, status=HTTPStatus.CREATED)
            if path == '/api/tasks/video-summary':
                task_id = self.state.queue_video_task(payload, 'video_summary')
                return self.send_json({'task_id': task_id}, status=HTTPStatus.CREATED)
            if path == '/api/tasks/cancel-current':
                return self.send_json({'cancelled': self.state.engine.request_cancel_current_task()})
            if path == '/api/tasks/cancel-all':
                return self.send_json({'cancelled': self.state.engine.request_cancel_all()})
            if path == '/api/tasks/pause-current':
                return self.send_json({'paused': self.state.engine.request_pause(reason='user')})
            if path == '/api/tasks/resume-current':
                return self.send_json({'resumed': self.state.engine.resume(reason='user')})
            if path.startswith('/api/tasks/') and path.endswith('/cancel'):
                task_id_text = path[len('/api/tasks/'):-len('/cancel')]
                task_id = int(task_id_text)
                cancelled = self.state.engine.request_cancel_task(task_id)
                removed = None if cancelled else self.state.engine.remove_pending_task(task_id)
                if removed:
                    title = (removed.get('task') or {}).get('title', '대기 작업')
                    self.state.append_idle_log(f'대기 작업 취소: {title}')
                return self.send_json({'cancelled': bool(cancelled or removed)})
            if path.startswith('/api/tasks/') and path.endswith('/pause'):
                task_id_text = path[len('/api/tasks/'):-len('/pause')]
                return self.send_json({'paused': self.state.engine.request_pause_task(int(task_id_text), reason='user')})
            if path.startswith('/api/tasks/') and path.endswith('/resume'):
                task_id_text = path[len('/api/tasks/'):-len('/resume')]
                return self.send_json({'resumed': self.state.engine.resume_task(int(task_id_text), reason='user')})
            if path == '/api/retry-all':
                return self.send_json(self.state.retry_all_failed_tasks())
            if path.startswith('/api/retry/'):
                title = unquote(path[len('/api/retry/'):])
                task_id = self.state.retry_failed_task(title)
                return self.send_json({'task_id': task_id}, status=HTTPStatus.CREATED)
            if path == '/api/reports/import':
                report = self.state.import_markdown(payload)
                return self.send_json({'report': report}, status=HTTPStatus.CREATED)
            if path == '/api/chatbot/stream':
                from api_modules.request_connection import request_disconnected

                def check_chat_connection():
                    if request_disconnected(self.connection):
                        raise ConnectionAbortedError('Chat request disconnected')

                def memory_aware_emit(emit):

                    def wrapped(event):
                        if isinstance(event, Mapping) and str(event.get('type') or '') == 'done':
                            self.state.observe_chat_exchange(payload, event.get('answer'))
                        emit(event)
                    return wrapped
                return self.send_ndjson_stream(lambda emit: self.state.stream_chatbot_reply(
                    payload, memory_aware_emit(emit), cancel_check=check_chat_connection))
            if path == '/api/chatbot':
                result = self.state.chatbot_reply(payload)
                self.state.observe_chat_exchange(payload, result.get('answer') if isinstance(result, Mapping) else None)
                return self.send_json(result)
            if path == '/api/memory':
                return self.send_json(self.state.memory_mutate(payload), status=HTTPStatus.CREATED)
            if path == '/api/memory/delete':
                return self.send_json(self.state.memory_delete(payload))
            if path == '/api/memory/settings':
                return self.send_json(self.state.memory_update_settings(payload))
            if path == '/api/chatbot/expert':
                return self.send_json(self.state.chatbot_expert_answer(payload))
            if path == '/api/chatbot/save-answer':
                return self.send_json(self.state.save_chatbot_answer(payload), status=HTTPStatus.CREATED)
            if path == '/api/material-file/notebook/environment':
                return self.send_json(notebook_environment_request(self.state, payload))
            if path == '/api/material-file/notebook/packages':
                def package_operation(emit):
                    result = notebook_environment_request(self.state, payload, emit)
                    emit({'type': 'done', **result})
                return self.send_ndjson_stream(package_operation)
            if path == '/api/material-file/notebook/execute':
                return self.send_ndjson_stream(lambda emit: self.state.execute_notebook_cell(payload, emit=emit))
            if path == '/api/material-file/notebook/restart':
                return self.send_json(self.state.restart_notebook_kernel(payload))
            if path == '/api/material-file/save':
                return self.send_json({'file': self.state.save_material_file(payload)})
            if path.startswith('/api/office/'):
                from api_modules.api_office import office_request
                return self.send_json(office_request(self.state, path.removeprefix('/api/office/'), payload))
            if path == '/api/material-file/unlock-pdf':
                return self.send_json(self.state.unlock_material_pdf(payload))
            if path == '/api/material-file/rename':
                return self.send_json(self.state.rename_material_file(payload))
            if path == '/api/material-file/delete':
                return self.send_json(self.state.delete_material_file(payload))
            if path == '/api/material-folder/create':
                return self.send_json(self.state.create_material_folder(payload), status=HTTPStatus.CREATED)
            if path == '/api/material-file/create':
                return self.send_json(self.state.create_material_file(payload), status=HTTPStatus.CREATED)
            if path == '/api/material-folder/rename':
                return self.send_json(self.state.rename_material_folder(payload))
            if path == '/api/material-folder/delete':
                return self.send_json(self.state.delete_material_folder(payload))
            if path == '/api/material-trash/delete':
                return self.send_json(self.state.delete_material_trash_item(payload))
            if path == '/api/material-trash/restore':
                return self.send_json(self.state.restore_material_trash_item(payload))
            if path == '/api/material-trash/empty':
                return self.send_json(self.state.empty_material_trash())
            if path == '/api/material-file/move':
                return self.send_json(self.state.move_material_file(payload))
            if path == '/api/material-entry/move':
                return self.send_json(self.state.move_material_entry(payload))
            if path == '/api/material-entry/transfer':
                return self.send_json(self.state.transfer_material_entries(payload))
            if path == '/api/material-practice/generate':
                return self.send_json(self.state.generate_material_practice(payload), status=HTTPStatus.CREATED)
            if path == '/api/material-practice/answer':
                return self.send_json(self.state.material_practice_answer(payload))
            if path == '/api/material-practice/history':
                return self.send_json(self.state.material_practice_history(payload))
            if path == '/api/material-practice/select':
                return self.send_json(self.state.material_practice_select(payload))
            if path == '/api/material-practice/timer':
                return self.send_json(self.state.material_practice_timer(payload))
            if path == '/api/material-practice/grade':
                return self.send_json(self.state.material_practice_grade(payload))
            if path == '/api/material-practice/retry':
                return self.send_json(self.state.material_practice_retry(payload))
            if path == '/api/material-practice/retry-batch':
                return self.send_json(self.state.material_practice_retry_batch(payload))
            if path == '/api/material-practice/hint/generate':
                return self.send_json(self.state.material_practice_hint(payload))
            if path == '/api/pdf-page-state':
                return self.send_json(self.state.update_pdf_page_state(payload), status=HTTPStatus.CREATED)
            if path == '/api/pdf/study/chat-history':
                result = self.state.save_pdf_chat_turn(payload)
                if isinstance(payload, Mapping) and str(payload.get('question') or '').strip():
                    self.state.observe_chat_exchange(payload, payload.get('answer'))
                return self.send_json(result, status=HTTPStatus.CREATED if result.get('created') else HTTPStatus.OK)
            if path == '/api/pdf/study/annotations':
                result = self.state.save_pdf_annotation(payload)
                return self.send_json(result, status=HTTPStatus.CREATED if result.get('created') else HTTPStatus.OK)
            if path == '/api/pdf/study/session/start':
                return self.send_json(self.state.start_pdf_study_session(payload), status=HTTPStatus.CREATED)
            if path == '/api/pdf/study/session/activity':
                return self.send_json(self.state.record_pdf_study_activity(payload))
            if path == '/api/pdf/study/bookmarks':
                result = self.state.toggle_pdf_bookmark(payload)
                return self.send_json(result, status=HTTPStatus.CREATED if result.get('created') else HTTPStatus.OK)
            if path == '/api/pdf/study/document-note':
                return self.send_json(self.state.save_pdf_document_note(payload))
            if path == '/api/pdf/study/tags':
                return self.send_json(self.state.save_pdf_document_tags(payload))
            if path == '/api/code/run/start':
                workspace_root = None
                if payload.get('workspace_id'):
                    from code_services.workspace_store import WorkspaceStore
                    store = WorkspaceStore(Path(common.APP_BASE_DIR) / '.ails' / 'code-workspaces.sqlite3')
                    store._entry(payload['workspace_id'], payload.get('file_name', ''))
                    workspace_root = str(store._root(payload['workspace_id']))
                return self.send_json(self.server.code_execution_manager.start(code=payload.get('code', ''), language=payload.get('language', ''), file_name=payload.get('file_name', ''), files=payload.get('files') or [], stdin=payload.get('stdin', ''), timeout=payload.get('timeout', 5), action=payload.get('action', 'run'), workspace_root=workspace_root, console_encoding=payload.get('console_encoding', 'auto')))
            if path == '/api/code/run/input':
                return self.send_json(self.server.code_execution_manager.write(session_id=payload.get('session_id', ''), value=payload.get('input', ''), eof=bool(payload.get('eof', False))))
            if path == '/api/code/run/stop':
                return self.send_json(self.server.code_execution_manager.stop(payload.get('session_id', '')))
            if path == '/api/code/run':
                return self.send_json(code_services.code_executor.run_code_sandbox(code=payload.get('code', ''), language=payload.get('language', ''), file_name=payload.get('file_name', ''), files=payload.get('files') or [], stdin=payload.get('stdin', ''), timeout=payload.get('timeout', 5), action=payload.get('action', 'run'), console_encoding=payload.get('console_encoding', 'auto')))
            if path == '/api/code/review':
                return self.send_json(self.state.review_code_sandbox(payload))
            if path == '/api/code/review/stream':
                return self.send_ndjson_stream(lambda emit: self.state.review_code_sandbox(payload, emit))
            if path == '/api/code/prompt-edit':
                return self.send_json(self.state.prompt_edit_code_sandbox(payload))
            if path == '/api/code/ocr-region':
                return self.send_json(self.state.extract_pdf_ocr_region(payload))
            if path == '/api/pdf/ocr/status':
                return self.send_json(self.state.pdf_outline_status(payload.get('path', '')))
            if path == '/api/pdf/ocr/page-count':
                return self.send_json({'page_count': api_modules.api_pdf_viewer.read_pdf_page_count(payload.get('path', ''))})
            if path == '/api/pdf/ocr/folder/preflight':
                return self.send_json(self.state.material_folder_pdf_ocr_preflight(payload))
            if path == '/api/pdf/ocr/performance-profile':
                return self.send_json(self.state.pdf_ocr_performance_profile(payload))
            if path == '/api/pdf/ocr/model/download/stream':
                return self.send_ndjson_stream(lambda emit: self.state.download_pdf_ocr_model(payload, emit))
            if path == '/api/video/local-stt/model/download/stream':
                return self.send_ndjson_stream(lambda emit: self.state.download_video_whisper_model(payload, emit))
            if path == '/api/local/models/prepare/stream':
                return self.send_ndjson_stream(lambda emit: self.state.prepare_local_models(payload, emit))
            if path == '/api/pdf/ocr/page':
                from documents.answer_key_visibility import redact_page
                from pdf.pdf_ocr import indexed_pdf_page
                page = indexed_pdf_page(payload.get('path', ''), payload.get('page', 1))
                return self.send_json(redact_page(payload.get('path', ''), page))
            if path == '/api/pdf/ocr/full/stream':
                self.state.require_work_preflight(payload, 'pdf_ocr')
                return self.send_ndjson_stream(lambda emit: self.state.full_pdf_ocr(payload, emit))
            if path == '/api/pdf/ocr/folder/stream':
                return self.send_ndjson_stream(lambda emit: self.state.material_folder_pdf_ocr(payload, emit))
            if path == '/api/pdf/ocr/benchmark/stream':
                return self.send_ndjson_stream(lambda emit: self.state.benchmark_pdf_ocr(payload, emit))
            if path == '/api/pdf/ocr/cancel':
                return self.send_json(self.state.cancel_pdf_ocr(payload))
            if path == '/api/pdf/translate/enqueue':
                try:
                    item = self.state.enqueue_pdf_translation(payload)
                except OSError:
                    return self.send_json({'error': 'storage_error'}, status=HTTPStatus.SERVICE_UNAVAILABLE)
                return self.send_json(item, status=HTTPStatus.ACCEPTED)
            if path == '/api/pdf/translate/job/cancel':
                job_id = str(payload.get('job_id') or '')
                return self.send_json({'job_id': job_id, 'cancelled': self.state.background_work.cancel_translation(job_id)})
            if path == '/api/pdf/translate/stream':
                from pdf.pdf_translation import PdfTranslationCancelled
                self.state.require_work_preflight(payload, 'pdf_translation')

                def produce_translation(emit):
                    try:
                        self.state.translate_pdf(payload, emit)
                    except PdfTranslationCancelled as error:
                        emit({'type': 'cancelled', 'error': str(error)})
                return self.send_ndjson_stream(produce_translation)
            if path == '/api/pdf/translate/cancel':
                return self.send_json(self.state.cancel_pdf_translation(payload))
            if path == '/api/pdf/search':
                from pdf.pdf_ocr import search_pdf
                return self.send_json(search_pdf(payload.get('path', ''), payload.get('query', ''), payload.get('limit', 50)))
            if path == '/api/pdf/problems/scan':
                return self.send_json(self.state.scan_pdf_study_problems(payload), status=HTTPStatus.CREATED)
            if path == '/api/pdf/problems/state':
                import documents.problem_manager
                return self.send_json({'problem': documents.problem_manager.update_problem_status(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), payload.get('status', ''))})
            if path == '/api/pdf/problems/retry':
                import documents.problem_solve_rounds
                return self.send_json({'problem': documents.problem_solve_rounds.retry_problem(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), payload.get('solve_round_id'), payload.get('draft_files'))})
            if path == '/api/pdf/problems/retry-batch':
                import documents.practice_batch_retry
                return self.send_json(documents.practice_batch_retry.retry_pdf_problems(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload))
            if path == '/api/pdf/problems/code-draft':
                import documents.problem_solve_rounds
                return self.send_json({'problem': documents.problem_solve_rounds.save_code_drafts(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), payload.get('solve_round_id'), payload.get('draft_files'))})
            if path == '/api/pdf/problems/history':
                import documents.problem_solve_rounds
                return self.send_json(documents.problem_solve_rounds.problem_history(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', '')))
            if path == '/api/pdf/problems/type':
                import documents.problem_manager
                return self.send_json({'problem': documents.problem_manager.update_problem_answer_type(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), payload.get('answer_type', ''))})
            if path == '/api/pdf/problems/edit':
                import documents.problem_answering
                requested_answer_type = documents.problem_answering.normalize_answer_type(payload.get('answer_type')) if 'answer_type' in payload else None
                import documents.problem_manager
                updated_problem = documents.problem_manager.update_problem_content(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), problem_text=payload.get('problem_text', ''), number=payload.get('number'), page=payload.get('page'), page_end=payload.get('page_end'), choices=payload.get('choices'), code=payload.get('code') if 'code' in payload else None, code_positions=payload.get('code_positions') if 'code_positions' in payload else None, edit_source=payload.get('edit_source', 'user'))
                if requested_answer_type is not None:
                    import documents.problem_manager
                    updated_problem = documents.problem_manager.update_problem_answer_type(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), requested_answer_type)
                return self.send_json({'problem': updated_problem})
            if path == '/api/pdf/problems/review':
                return self.send_json(self.state.review_pdf_problem(payload))
            if path == '/api/pdf/problems/multimodal-review':
                return self.send_json(self.state.review_pdf_problem_multimodal(payload))
            if path == '/api/pdf/problems/multimodal-review/auto/start':
                self.state.require_work_preflight(payload, 'pdf_problem_review')
                return self.send_json(self.state.start_pdf_problem_auto_review(payload), status=HTTPStatus.ACCEPTED)
            if path == '/api/pdf/problems/multimodal-review/auto/cancel':
                return self.send_json(self.state.cancel_pdf_problem_auto_review(payload))
            if path == '/api/pdf/problems/multimodal-review/queue/resolve':
                return self.send_json(self.state.resolve_pdf_problem_multimodal_review_queue(payload))
            if path == '/api/pdf/problems/multimodal-review/gold':
                return self.send_json(self.state.save_pdf_problem_multimodal_gold_sample(payload))
            if path == '/api/pdf/problems/multimodal-review/choose-model':
                return self.send_json(self.state.choose_pdf_problem_review_model(payload))
            if path == '/api/pdf/problems/answer':
                answer = payload.get('answer')
                if not isinstance(answer, Mapping):
                    answer = {}
                import documents.problem_manager
                return self.send_json({'problem': documents.problem_manager.save_problem_answer(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), answer_text=answer.get('answer_text', payload.get('answer_text', '')), selected_choice=answer.get('selected_choice', payload.get('selected_choice')), **({'expected_round_id': payload['solve_round_id']} if 'solve_round_id' in payload else {}))})
            if path == '/api/pdf/problems/timer/start':
                import documents.problem_manager
                return self.send_json({'problem': documents.problem_manager.start_problem_timer(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), expected_round_id=payload.get('solve_round_id'))})
            if path == '/api/pdf/problems/timer/stop':
                import documents.problem_manager
                return self.send_json({'problem': documents.problem_manager.stop_problem_timer(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), expected_round_id=payload.get('solve_round_id'))})
            if path == '/api/pdf/problems/hint':
                import documents.problem_manager
                return self.send_json({'problem': documents.problem_manager.mark_problem_hint_used(payload.get('pdf_path', ''), payload.get('base_dir', ''), payload.get('problem_id', ''), expected_round_id=payload.get('solve_round_id'))})
            if path == '/api/pdf/problems/hint/generate':
                return self.send_json(self.state.generate_pdf_problem_hint(payload))
            if path == '/api/pdf/problems/answer-key/manage':
                return self.send_json(self.state.manage_pdf_answer_key(payload))
            if path == '/api/pdf/problems/answer-key/preview':
                return self.send_json(self.state.preview_pdf_answer_key(payload))
            if path == '/api/pdf/problems/answer-key/confirm':
                return self.send_json(self.state.confirm_pdf_answer_key(payload))
            if path == '/api/pdf/problems/answer-key/confirm-batch':
                return self.send_json(self.state.confirm_pdf_answer_keys(payload))
            if path == '/api/pdf/problems/grade':
                return self.send_json(self.state.grade_pdf_problem(payload))
            if path == '/api/pdf/problems/grade-batch':
                from api_modules.request_connection import request_disconnected
                if payload.get('stream') is True:
                    return self.send_ndjson_stream(lambda emit: self.state.grade_pdf_problems_batch(
                        payload, emit=emit, is_cancelled=lambda: request_disconnected(self.connection)))
                return self.send_json(self.state.grade_pdf_problems_batch(
                    payload, is_cancelled=lambda: request_disconnected(self.connection)))
            if path == '/api/code/save':
                return self.send_json(code_services.code_executor.save_code_project(base_dir=payload.get('base_dir', ''), project_name=payload.get('project_name', ''), files=payload.get('files') or []))
            if path == '/api/code/workspaces':
                from code_services.workspace_store import handle_workspace_request
                result = handle_workspace_request(payload, Path(common.APP_BASE_DIR) / '.ails' / 'code-workspaces.sqlite3')
                return self.send_json(result, status=HTTPStatus.CONFLICT if result.get('error') else HTTPStatus.OK)
            if path == '/api/code/projects/create':
                return self.send_json(code_services.code_executor.create_code_project(base_dir=payload.get('base_dir', ''), project_name=payload.get('project_name', '')))
            if path == '/api/code/projects/delete':
                return self.send_json(code_services.code_executor.delete_code_project(base_dir=payload.get('base_dir', ''), project_name=payload.get('project_name', '')))
            if path == '/api/code/projects/rename':
                return self.send_json(code_services.code_executor.rename_code_project(base_dir=payload.get('base_dir', ''), old_project_name=payload.get('old_project_name', ''), new_project_name=payload.get('new_project_name', '')))
            if path == '/api/code/projects/delete-file':
                return self.send_json(code_services.code_executor.delete_code_file(base_dir=payload.get('base_dir', ''), project_name=payload.get('project_name', ''), file_name=payload.get('file_name', '')))
            if path == '/api/code/projects':
                return self.send_json(code_services.code_executor.get_code_projects(payload.get('base_dir', '')))
            if path == '/api/code/project-files':
                return self.send_json(code_services.code_executor.get_code_project_files(base_dir=payload.get('base_dir', ''), project_name=payload.get('project_name', '')))
            if path == '/api/libreoffice/install':
                from documents.presentation_service import install_libreoffice_with_winget
                return self.send_json(install_libreoffice_with_winget())
            if path == '/api/developer-tools/install':
                edition_manifest.require_feature('developer_tools')
                from developer_tools import start_developer_tool_install
                return self.send_json(start_developer_tool_install(payload.get('tool_id', '')), status=HTTPStatus.ACCEPTED)
            if path == '/api/code/language-profiles/save':
                edition_manifest.require_feature('developer_tools')
                from code_services.language_profiles import save_language_profile
                return self.send_json({'profile': save_language_profile(payload.get('profile', payload))})
            if path == '/api/code/language-profiles/delete':
                edition_manifest.require_feature('developer_tools')
                from code_services.language_profiles import delete_language_profile
                return self.send_json({'deleted': delete_language_profile(payload.get('profile_id', ''))})
            if path == '/api/code/language-registry/install':
                edition_manifest.require_feature('developer_tools')
                from code_services.language_registry import start_language_pack_install
                return self.send_json(start_language_pack_install(payload), status=HTTPStatus.ACCEPTED)
            if path == '/api/model-test':
                return self.send_json(self.state.test_model_connection(payload))
            if path == '/api/model-options':
                return self.send_json(self.state.model_options(payload.get('config', payload)))
            if path == '/api/lms/login':
                return self.send_json(self.state.open_lms_login_browser(force_new_window=True, headless=False, start_minimized=False, target_url=str(payload.get('target_url', '') or '').strip()), status=HTTPStatus.CREATED)
            if path == '/api/lms/auth/cancel':
                return self.send_json(self.state.cancel_lms_auth(str(payload.get('attempt_id') or '')))
            if path == '/api/lms/credentials':
                return self.send_json(self.state.save_lms_credentials(payload), status=HTTPStatus.CREATED)
            if path == '/api/python/validate':
                return self.send_json(self.state.validate_python_executable(payload))
            if path == '/api/system/open-path':
                target_path = str(payload.get('path', '') or '').strip()
                return self.send_json(self.state.open_local_path(target_path))
            if path == '/api/system/open-licenses':
                return self.send_json(self.state.open_distribution_licenses())
            if path == '/api/actions/latex-postprocess':
                return self.send_json(self.state.latex_postprocess_reports())
            if path == '/api/actions/organize-reports':
                return self.send_json(self.state.organize_report_files())
            return self.send_json({'error': 'unknown endpoint'}, status=HTTPStatus.NOT_FOUND)
        except Exception as error:
            return self.handle_request_error(error)

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path.startswith('/api') and (not self.check_api_access(parsed)):
                return
            if path.startswith('/api/tasks/'):
                task_id = int(path[len('/api/tasks/'):])
                removed = self.state.engine.remove_pending_task(task_id)
                if removed:
                    title = (removed.get('task') or {}).get('title', '이름 없는 작업')
                    self.state.append_idle_log(f'대기열 작업 취소: {title}')
                return self.send_json({'deleted': bool(removed)})
            if path.startswith('/api/retry/'):
                title = unquote(path[len('/api/retry/'):])
                return self.send_json(self.state.delete_retry_candidate(title))
            if path == '/api/pdf/study/chat-history':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.delete_pdf_chat_turns({'path': params.get('path', [''])[0], 'session_id': params.get('session_id', [''])[0], 'purge': params.get('purge', [''])[0]}))
            if path == '/api/pdf/study/chat-turn':
                payload = self.read_json_body()
                return self.send_json(self.state.delete_pdf_chat_turn(payload))
            if path == '/api/pdf/study/annotations':
                params = parse_qs(parsed.query)
                return self.send_json(self.state.delete_pdf_annotation({'path': params.get('path', [''])[0], 'annotation_id': params.get('annotation_id', [''])[0]}))
            return self.send_json({'error': 'unknown endpoint'}, status=HTTPStatus.NOT_FOUND)
        except Exception as error:
            return self.handle_request_error(error)

    def read_json_body(self):
        length = int(self.headers.get('Content-Length', '0') or '0')
        if self.path.startswith('/api/office/') and (length < 0 or length > 90 * 1024 * 1024):
            raise ValueError('문서 요청 크기가 제한을 초과합니다.')
        if not length:
            return {}
        raw_body = self.rfile.read(length)
        if not raw_body:
            return {}
        return json.loads(raw_body.decode('utf-8'))

    def send_json(self, data, status=HTTPStatus.OK, *, cache_control=None):
        body = json.dumps(data, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(status)
        self.write_cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if cache_control:
            self.send_header('Cache-Control', cache_control)
        self.end_headers()
        self.wfile.write(body)

    def send_ndjson_stream(self, producer, status=HTTPStatus.OK):
        self.send_response(status)
        self.write_cors_headers()
        self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        def emit(event):
            body = json.dumps(event, ensure_ascii=False, default=str).encode('utf-8') + b'\n'
            self.wfile.write(body)
            self.wfile.flush()
        try:
            producer(emit)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as error:
            try:
                event = {'type': 'error', 'error': str(error)}
                code = getattr(error, 'code', '')
                if code:
                    event['code'] = code
                emit(event)
            except Exception:
                return

    def send_error_json(self, error: Exception):
        if isinstance(error, (edition_manifest.EditionFeatureDisabled, ai_compliance.AIConsentRequired)):
            status = HTTPStatus.FORBIDDEN
        elif isinstance(error, api_modules.api_managed_auth.ManagedAuthError) and error.status:
            status = error.status
        else:
            status = HTTPStatus.NOT_FOUND if isinstance(error, KeyError) else HTTPStatus.BAD_REQUEST
        payload = {'error': str(error)}
        code = getattr(error, 'code', '')
        if code:
            payload['code'] = code
        try:
            if edition_manifest.feature_enabled('developer_tools') and bool(getattr(self.server, 'state', None).config.get('debug_trace_enabled')):
                import traceback
                payload['traceback'] = traceback.format_exc()
        except Exception:
            pass
        self.send_json(payload, status=status)

    def write_cors_headers(self):
        origin = str(self.headers.get('Origin') or '').strip().rstrip('/').lower()
        if origin and origin in getattr(self.server, 'allowed_origins', frozenset()):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', f'Content-Type, {api_context.LOCAL_API_TOKEN_HEADER}')

    def serve_static(self, request_path: str):
        frontend_dir = self.frontend_dir
        if not frontend_dir or not frontend_dir.exists():
            return self.send_json({'error': 'frontend build not found'}, status=HTTPStatus.NOT_FOUND)
        normalized = unquote(request_path).lstrip('/')
        candidate = (frontend_dir / normalized).resolve() if normalized else frontend_dir / 'index.html'
        frontend_root = frontend_dir.resolve()
        if not str(candidate).startswith(str(frontend_root)):
            return self.send_json({'error': 'invalid path'}, status=HTTPStatus.BAD_REQUEST)
        if not candidate.exists() or candidate.is_dir():
            candidate = frontend_root / 'index.html'
        content_type = mimetypes.guess_type(str(candidate))[0] or 'application/octet-stream'
        body = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.write_cors_headers()
        self.send_header('Content-Type', content_type)
        if candidate.name == 'index.html':
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_local_file(self, parsed):
        from system_storage import resolve_system_path
        params = parse_qs(parsed.query)
        raw_path = params.get('path', [''])[0]
        if not raw_path:
            return self.send_json({'error': 'missing path'}, status=HTTPStatus.BAD_REQUEST)
        file_path = resolve_system_path(os.path.abspath(raw_path))
        if not os.path.isfile(file_path):
            return self.send_json({'error': 'file not found'}, status=HTTPStatus.NOT_FOUND)
        # Windows MIME discovery scans the registry on its first call. PDF has
        # a fixed standard type; do not put that scan on its first-page path.
        content_type = 'application/pdf' if file_path.lower().endswith('.pdf') else (mimetypes.guess_type(file_path)[0] or 'application/octet-stream')
        file_size = os.path.getsize(file_path)
        range_header = str(self.headers.get('Range', '') or '').strip()
        start = 0
        end = max(0, file_size - 1)
        status = HTTPStatus.OK
        if range_header.startswith('bytes=') and file_size > 0:
            match = re.fullmatch('bytes=(\\d*)-(\\d*)', range_header)
            if match:
                start_text, end_text = match.groups()
                if start_text:
                    start = min(max(0, int(start_text)), file_size - 1)
                    end = min(max(start, int(end_text)) if end_text else file_size - 1, file_size - 1)
                elif end_text:
                    suffix_length = min(max(1, int(end_text)), file_size)
                    start = file_size - suffix_length
                status = HTTPStatus.PARTIAL_CONTENT
        content_length = max(0, end - start + 1) if file_size else 0
        self.send_response(status)
        self.write_cors_headers()
        self.send_header('Content-Type', content_type)
        self.send_header('Accept-Ranges', 'bytes')
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self.send_header('Content-Length', str(content_length))
        self.end_headers()
        remaining = content_length
        with open(file_path, 'rb') as handle:
            handle.seek(start)
            while remaining > 0:
                chunk = handle.read(min(api_context.LOCAL_FILE_STREAM_CHUNK_SIZE, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def serve_pdf_thumbnail(self, parsed):
        params = parse_qs(parsed.query)
        raw_path = params.get('path', [''])[0]
        file_path = os.path.abspath(raw_path) if raw_path else ''
        if not file_path or not os.path.isfile(file_path):
            return self.send_json({'error': 'PDF file not found'}, status=HTTPStatus.NOT_FOUND)
        extension = os.path.splitext(file_path)[1].lower()
        if extension in {'.ppt', '.pptx'}:
            from documents.presentation_service import presentation_pdf_cache_path
            file_path = presentation_pdf_cache_path(file_path)
        if extension not in {'.pdf', '.ppt', '.pptx'} or not os.path.isfile(file_path):
            return self.send_json({'error': 'PDF file not found'}, status=HTTPStatus.NOT_FOUND)
        try:
            page = int(params.get('page', ['1'])[0])
            width = int(params.get('target_width', ['480'])[0])
        except (TypeError, ValueError):
            return self.send_json({'error': 'invalid thumbnail parameters'}, status=HTTPStatus.BAD_REQUEST)
        if page < 1 or not 64 <= width <= 800:
            return self.send_json({'error': 'invalid thumbnail parameters'}, status=HTTPStatus.BAD_REQUEST)
        stat = os.stat(file_path)
        etag = f'"{stat.st_mtime_ns}-{stat.st_size}-{page}-{width}"'
        if self.headers.get('If-None-Match') == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.write_cors_headers()
            self.send_header('ETag', etag)
            self.end_headers()
            return
        try:
            body = api_modules.api_pdf_viewer.render_pdf_thumbnail_png(file_path, page, width)
        except ValueError as error:
            return self.send_json({'error': str(error)}, status=HTTPStatus.BAD_REQUEST)
        self.send_response(HTTPStatus.OK)
        self.write_cors_headers()
        self.send_header('Content-Type', 'image/png')
        self.send_header('Cache-Control', 'private, no-cache')
        self.send_header('ETag', etag)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_pdf_page_version(self, parsed):
        params = parse_qs(parsed.query)
        file_path = os.path.abspath(params.get('path', [''])[0])
        if not os.path.isfile(file_path) or os.path.splitext(file_path)[1].lower() != '.pdf':
            return self.send_json({'error': 'PDF file not found'}, status=HTTPStatus.NOT_FOUND)
        fingerprint = pdf.pdf_viewer_data.pdf_file_fingerprint(file_path)
        return self.send_json({'version': f"{fingerprint['mtime_ns']}-{fingerprint['size']}"})

    def log_message(self, format, *args):
        try:
            if sys.stderr:
                sys.stderr.write('%s - - [%s] %s\n' % (self.client_address[0], self.log_date_time_string(), format % args))
        except Exception:
            pass
