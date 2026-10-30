"""SummaryTaskService: feature operations and owned state."""
from __future__ import annotations
from jobs.summary_task_support import (
    Any,
    BASE_PROMPT_TEMPLATE,
    Callable,
    LOCAL_WHISPER_CPP_VULKAN_ENGINE,
    ManagedStageSessions,
    Mapping,
    PROVIDER_GEMINI,
    STT_MODEL_DEFAULT,
    apply_settlements,
    build_resume_state_path,
    build_retry_result_content,
    build_youtube_report_title,
    clear_resume_state,
    collect_retry_entries_from_disk,
    common,
    dataclass,
    documents,
    edition_manifest,
    estimate_status_progress,
    extract_youtube_sources,
    hashlib,
    infer_stt_provider,
    install_whisper_cpp_model,
    is_unselected_file_value,
    load_resume_media,
    load_resume_state,
    merge_settlements,
    normalize_retry_candidate_logs,
    organize_reports,
    os,
    persist_settlement_result,
    pipeline_utils,
    prior_settlements,
    providers,
    re,
    read_settlements,
    remove_retry_registry_entry,
    require_feature,
    require_local_stt_provider,
    require_summary_task,
    resolve_app_path,
    safe_float,
    safe_remove,
    save_resume_state,
    server_config,
    settings,
    shutil,
    summary_task_allowed,
    threading,
    time,
    validate_video_summary_verification_config,
)
from jobs.summary_task_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class SummaryTaskServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    acquire_managed_ai_action_session: Callable[..., Any]
    append_idle_log: Callable[..., Any]
    call_image_analysis_batch: Callable[..., Any]
    call_managed_video_summary: Callable[..., Any]
    call_personal_video_summary: Callable[..., Any]
    call_video_stt_cleanup: Callable[..., Any]
    call_video_verification: Callable[..., Any]
    call_video_verification_web_search: Callable[..., Any]
    call_video_verification_with_tools: Callable[..., Any]
    call_video_visual_event: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    get_engine: Callable[[], Any]
    ensure_lms_login_for_eclass: Callable[..., Any]
    finish_managed_ai_session: Callable[..., Any]
    get_managed_ai_session_result: Callable[..., Any]
    invalidate_lecture_materials_cache: Callable[..., Any]
    local_provider_model: Callable[..., Any]
    get_lock: Callable[[], Any]
    public_config: Callable[..., Any]
    require_work_preflight: Callable[..., Any]
    selected_ai_model: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class SummaryTaskService:
    def __init__(self, ports: SummaryTaskServicePorts):
        self._ports = ports
        self.acquire_managed_ai_action_session = ports.acquire_managed_ai_action_session
        self.append_idle_log = ports.append_idle_log
        self.call_image_analysis_batch = ports.call_image_analysis_batch
        self.call_managed_video_summary = ports.call_managed_video_summary
        self.call_personal_video_summary = ports.call_personal_video_summary
        self.call_video_stt_cleanup = ports.call_video_stt_cleanup
        self.call_video_verification = ports.call_video_verification
        self.call_video_verification_web_search = ports.call_video_verification_web_search
        self.call_video_verification_with_tools = ports.call_video_verification_with_tools
        self.call_video_visual_event = ports.call_video_visual_event
        self.ensure_lms_login_for_eclass = ports.ensure_lms_login_for_eclass
        self.finish_managed_ai_session = ports.finish_managed_ai_session
        self.get_managed_ai_session_result = ports.get_managed_ai_session_result
        self.invalidate_lecture_materials_cache = ports.invalidate_lecture_materials_cache
        self.local_provider_model = ports.local_provider_model
        self.public_config = ports.public_config
        self.require_work_preflight = ports.require_work_preflight
        self.selected_ai_model = ports.selected_ai_model
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai
        self.processed_results = {}
        self.session_report_titles = set()
        self.notifications = []
        self._disk_retry_titles = set()
        self._settlement_refresh_running = False
        self._next_settlement_refresh = 0
        self._settlement_lookup_cache = {}

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    @property
    def engine(self):
        return self._ports.get_engine()

    @property
    def lock(self):
        return self._ports.get_lock()

    def is_task_active_for_title(self, title: str) -> bool:
        normalized_title = str(title or "").strip()
        if not normalized_title:
            return False
        with self.engine.lock:
            pending_titles = [
                str((item.get("task") or {}).get("title", "") or "").strip()
                for item in self.engine.pending_tasks
            ]
            active_titles = [
                str(slot.get("title") or ((slot.get("task") or {}).get("title", "")) or "").strip()
                for slot in getattr(self.engine, "active_tasks", {}).values()
            ]
            current_title = str(self.engine.status.get("current_title", "") or "").strip()
            is_running = bool(self.engine.status.get("is_running"))
        return (
            normalized_title in pending_titles
            or normalized_title in active_titles
            or (is_running and current_title == normalized_title)
        )

    def mark_result_as_running(self, title: str):
        normalized_title = str(title or "").strip()
        if not normalized_title:
            return
        with self.lock:
            existing = self.processed_results.get(normalized_title, {})
            updated = dict(existing)
            updated["title"] = normalized_title
            updated["status"] = "running"
            updated.pop("retry_task", None)
            updated.pop("_retry_source", None)
            updated.pop("last_error", None)
            self.processed_results[normalized_title] = updated
            self.session_report_titles.add(normalized_title)

    def refresh_reports_from_disk(self):
        base_dir = str(self.config.get("md_save_path", "") or "").strip()
        for report_path in documents.material_workspace_support.iter_report_markdown_paths(base_dir):
            try:
                with open(report_path, "r", encoding="utf-8", errors="replace") as handle:
                    content = handle.read()
            except Exception:
                continue
            title = documents.material_workspace_support.title_from_report_path(report_path)
            with self.lock:
                existing = self.processed_results.get(title, {})
                if existing.get("status") in {"running", "retrying"}:
                    continue
                self.processed_results[title] = {
                    **existing,
                    "title": title,
                    "content": content,
                    "model": existing.get("model") or "disk",
                    "file_path": report_path,
                    "status": existing.get("status") or "success",
                    "updated_at": os.path.getmtime(report_path),
                }
        self.invalidate_lecture_materials_cache()

    def refresh_retry_candidates_from_disk(self):
        base_dir = str(self.config.get("md_save_path", "") or "").strip()
        disk_entries = collect_retry_entries_from_disk(base_dir)
        with self.lock:
            for title in list(self._disk_retry_titles):
                existing = self.processed_results.get(title)
                if existing and existing.get("_retry_source") == "disk" and existing.get("status") in {"failed", "needs_review"}:
                    self.processed_results.pop(title, None)
            self._disk_retry_titles = set()

            for title, entry in disk_entries.items():
                if self.is_task_active_for_title(title):
                    continue
                existing = self.processed_results.get(title, {})
                updated = dict(existing)
                updated["title"] = title
                updated["content"] = (existing.get("content") if entry.get("status") == "needs_review" and existing.get("content")
                                      else entry.get("content") or build_retry_result_content(title, entry))
                updated["model"] = entry.get("model", "재시도 대기")
                updated["status"] = "needs_review" if entry.get("status") == "needs_review" else "failed"
                updated["file_path"] = entry.get("file_path") or existing.get("file_path")
                updated["retry_task"] = entry.get("retry_task")
                updated["usage_summary"] = entry.get("usage_summary") or existing.get("usage_summary")
                updated["last_error"] = entry.get("last_error")
                updated["logs"] = normalize_retry_candidate_logs(entry)
                updated["_retry_source"] = "disk"
                self.processed_results[title] = updated
                self._disk_retry_titles.add(title)

    def refresh_disk_indexes(self):
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        self.request_managed_settlement_refresh()

    def collect_engine_results(self):
        with self.engine.lock:
            results = list(self.engine.results_to_collect)
            self.engine.results_to_collect.clear()
        if not results:
            self.request_managed_settlement_refresh()
            return
        has_completed_report = False
        with self.lock:
            for result in results:
                if result.get("_ui_event"):
                    self.notifications.append(result)
                    continue
                title = str(result.get("title", "") or "").strip()
                if not title:
                    continue
                existing = self.processed_results.get(title, {})
                new_status = result.get("status") or existing.get("status", "success")

                updated = dict(existing)
                updated["title"] = title
                updated["content"] = result.get("content", "")
                updated["model"] = result.get("model", "")
                updated["status"] = new_status
                updated["file_path"] = result.get("file_path") or existing.get("file_path")
                updated["usage_summary"] = result.get("usage_summary")
                for key, value in result.items():
                    if key in {"title", "content", "model", "file_path", "usage_summary"}:
                        continue
                    if value is not None:
                        updated[key] = value
                if updated.get("status") not in {"failed", "needs_review"}:
                    updated.pop("retry_task", None)
                    updated.pop("_retry_source", None)
                self.processed_results[title] = updated
                self.session_report_titles.add(title)
                if new_status == "success":
                    has_completed_report = True

        self.refresh_retry_candidates_from_disk()
        if has_completed_report:
            self.invalidate_lecture_materials_cache()
        # Include the results just collected; the caller may stop polling now.
        self.request_managed_settlement_refresh()

    def request_managed_settlement_refresh(self):
        import personal_mode
        if personal_mode.enabled():
            return
        if not callable(getattr(self, "get_managed_ai_session_result", None)):
            return
        now = time.monotonic()
        with self.lock:
            if getattr(self, "_settlement_refresh_running", False) or now < getattr(self, "_next_settlement_refresh", 0):
                return
            candidates = []
            for title, result in self.processed_results.items():
                if result.get("status") not in {"success", "failed", "needs_review"}:
                    continue
                if "<!-- AILS_REPORT_COST_START -->" not in str(result.get("content") or ""):
                    continue  # Legacy reports are read-only during settlement refresh.
                records = ((result.get("usage_summary") or {}).get("managed_settlement") or {}).get("sessions")
                records = records or read_settlements(
                    result.get("content"), base_dir=self.config.get("md_save_path", ""), title=title,
                    report_path=result.get("file_path") or "",
                )
                if any(record.get("status") == "closing" for record in records):
                    candidates.append((title, result, records))
            if not candidates:
                return
            self._next_settlement_refresh = now + 30
            self._settlement_refresh_running = True
        threading.Thread(target=self.refresh_pending_managed_settlements, args=(candidates,), daemon=True).start()

    def refresh_pending_managed_settlements(self, candidates):
        try:
            cache = getattr(self, "_settlement_lookup_cache", None)
            if cache is None:
                cache = self._settlement_lookup_cache = {}
            pending_ids = {record["session_id"] for _, _, records in candidates
                           for record in records if record.get("status") == "closing"}
            for session_id in set(cache) - pending_ids:
                cache.pop(session_id, None)
            for title, original, records in candidates:
                receipts = []
                for record in records:
                    if record.get("status") != "closing":
                        continue
                    session_id = record["session_id"]
                    cached = cache.get(session_id)
                    now = time.monotonic()
                    if cached and now < cached["next_lookup"]:
                        receipts.append(cached["receipt"])
                        continue
                    unchanged = (cached or {}).get("unchanged", 0)
                    try:
                        receipt = {**self.get_managed_ai_session_result(session_id),
                                   "session_id": session_id, "lookup_failures": 0}
                    except Exception:
                        receipt = {**record, "lookup_failures": record.get("lookup_failures", 0) + 1}
                    # Attribution belongs to each report (current/prior), not
                    # the shared server receipt cached across those reports.
                    receipt = {key: value for key, value in receipt.items() if key not in {"phase", "attempt"}}
                    unchanged = unchanged + 1 if (cached and receipt.get("status") == cached["receipt"].get("status")) else 0
                    terminal = receipt.get("status") in {"completed", "failed"}
                    cache[session_id] = {"receipt": receipt, "unchanged": unchanged,
                        "next_lookup": float("inf") if terminal else now + min(300, 30 * 2 ** min(unchanged, 4))}
                    receipts.append(receipt)
                updated_records = merge_settlements(records, receipts)
                if updated_records == records:
                    continue
                with self.lock:
                    current = self.processed_results.get(title)
                    if not current or current.get("status") not in {"success", "failed", "needs_review"}:
                        continue
                    current_records = ((current.get("usage_summary") or {}).get("managed_settlement") or {}).get("sessions") or read_settlements(
                        current.get("content"), base_dir=self.config.get("md_save_path", ""), title=title,
                        report_path=current.get("file_path") or "",
                    )
                    if current_records != records:
                        continue
                    updated = dict(current)
                    apply_settlements(updated, updated_records)
                    try:
                        persist_settlement_result(updated, self.config.get("md_save_path", ""))
                    except OSError:
                        continue
                    updated["updated_at"] = time.time()
                    self.processed_results[title] = updated
        finally:
            with self.lock:
                self._settlement_refresh_running = False

    def queue_url_task(self, payload: dict) -> int:
        require_feature("summary.web_inputs")
        url = str(payload.get("url", "") or "").strip()
        title = str(payload.get("title", "") or "").strip()
        if not url or not title:
            raise ValueError("URL과 제목을 입력하세요.")
        start = int(payload.get("start", 1) or 1)
        end = int(payload.get("end", 1) or 1)
        if start < 1 or end < start:
            raise ValueError("범위는 1 이상이며 종료값은 시작값 이상이어야 합니다.")
        if "(*)" not in url:
            url = re.sub(r"(segment-)\d+", r"\1(*)", url)
        if "(*)" not in url:
            raise ValueError("URL에 segment 번호 패턴 또는 (*)가 필요합니다.")

        self.config = server_config.save_config(self.config)
        task = {
            "type": "url",
            "url": url,
            "start": start,
            "end": end,
            "title": title,
            "detail_mode": "detailed" if payload.get("detail_mode") == "detailed" else "summary",
            "skip_images": bool(payload.get("skip_images", False)),
            "interval": safe_float(payload.get("interval", 3), 3.0),
            "mse_threshold": safe_float(payload.get("mse_threshold", 500), 500.0),
            "prompt_template": self.config["prompt_template"],
            "stt_only": bool(payload.get("stt_only", False)),
            "mp3_only": bool(payload.get("mp3_only", False)),
            "local_stt": bool(payload.get("local_stt", infer_stt_provider(self.config) in providers.LOCAL_STT_PROVIDERS)),
            "local_stt_model": str(payload.get("local_stt_model") or self.config.get("stt_model_name") or ""),
        }
        task_id = self.engine.add_task(task, self.video_task_config(task))
        if task_id != -1:
            self.mark_result_as_running(title)
            self.append_idle_log(f"URL 작업 추가: {title}")
        return task_id

    def queue_youtube_task(self, payload: dict) -> list[int]:
        require_feature("summary.web_inputs")
        youtube_url = str(payload.get("youtube_url") or payload.get("url") or "").strip()
        base_title = str(payload.get("title", "") or "").strip()
        if not youtube_url:
            raise ValueError("YouTube URL을 입력해주세요.")
        if not re.match(r"^https?://", youtube_url, re.IGNORECASE):
            raise ValueError("YouTube URL은 http 또는 https 주소여야 합니다.")
        if not base_title:
            raise ValueError("강의 제목을 입력해주세요. 예: 자료구조")

        youtube_sources = extract_youtube_sources(youtube_url)
        entries = youtube_sources.get("entries") or []
        if not entries:
            raise ValueError("YouTube에서 분석할 영상을 찾을 수 없습니다.")
        is_playlist = bool(youtube_sources.get("is_playlist")) and len(entries) > 1

        self.config = server_config.save_config(self.config)
        task_ids = []
        for entry in entries:
            report_title = build_youtube_report_title(
                base_title,
                str(entry.get("title", "") or ""),
                index=int(entry.get("index", len(task_ids) + 1) or len(task_ids) + 1),
                playlist=is_playlist,
            )
            if not report_title:
                raise ValueError("작업 제목을 생성할 수 없습니다.")
            task = {
                "type": "youtube",
                "youtube_url": str(entry.get("url", "") or "").strip(),
                "youtube_video_title": str(entry.get("title", "") or "").strip(),
                "youtube_playlist_title": str(youtube_sources.get("playlist_title", "") or "").strip(),
                "title": report_title,
                "detail_mode": "detailed" if payload.get("detail_mode") == "detailed" else "summary",
                "skip_images": bool(payload.get("skip_images", False)) or bool(payload.get("stt_only", False)) or bool(payload.get("mp3_only", False)),
                "interval": safe_float(payload.get("frame_interval", payload.get("interval", 3)), 3.0),
                "mse_threshold": safe_float(payload.get("mse_threshold", 500), 500.0),
                "prompt_template": self.config["prompt_template"],
                "stt_only": bool(payload.get("stt_only", False)),
                "mp3_only": bool(payload.get("mp3_only", False)),
                "local_stt": bool(payload.get("local_stt", infer_stt_provider(self.config) in providers.LOCAL_STT_PROVIDERS)),
                "local_stt_model": str(payload.get("local_stt_model") or self.config.get("stt_model_name") or ""),
            }
            if not task["youtube_url"]:
                raise ValueError("YouTube 영상 URL을 찾을 수 없습니다.")
            tid = self.engine.add_task(task, self.video_task_config(task))
            if tid != -1:
                self.mark_result_as_running(report_title)
                task_ids.append(tid)

        label = "재생목록" if is_playlist else "영상"
        self.append_idle_log(f"YouTube {label} 작업 추가: {base_title} ({len(task_ids)}개)")
        return task_ids

    def queue_audio_task(self, payload: dict) -> list[int]:
        require_feature("summary.audio_pdf")
        audio_paths = payload.get("audio_paths") or payload.get("audio_path") or []
        if isinstance(audio_paths, str):
            audio_paths = [audio_paths]
        audio_paths = [str(path).strip() for path in audio_paths if str(path or "").strip()]
        audio_paths = [path for path in audio_paths if not is_unselected_file_value(path)]
        title = str(payload.get("title", "") or "").strip()
        if not audio_paths:
            raise ValueError("오디오 파일 경로를 입력하세요.")
        if len(audio_paths) == 1 and not title:
            raise ValueError("작업 제목을 입력하세요.")
        for audio_path in audio_paths:
            if not os.path.exists(audio_path):
                raise ValueError(f"오디오 파일을 찾을 수 없습니다: {audio_path}")

        pdf_path = str(payload.get("pdf_path", "") or "").strip()
        pdf_password = str(payload.get("pdf_password", "") or "")
        has_pdf = bool(pdf_path) and not is_unselected_file_value(pdf_path)
        if has_pdf and not os.path.exists(pdf_path):
            raise ValueError(f"PDF 파일을 찾을 수 없습니다: {pdf_path}")

        self.config = server_config.save_config(self.config)
        os.makedirs(common.TEMP_DIR_NAME, exist_ok=True)
        task_ids = []
        for index, audio_path in enumerate(audio_paths, start=1):
            created_files = []
            try:
                timestamp = f"{int(time.time() * 1000)}_{index}"
                audio_ext = os.path.splitext(audio_path)[1] or ".bin"
                temp_audio_path = os.path.join(common.TEMP_DIR_NAME, f"api_{timestamp}{audio_ext}")
                shutil.copy(audio_path, temp_audio_path)
                created_files.append(temp_audio_path)

                task_title = title if len(audio_paths) == 1 else os.path.splitext(os.path.basename(audio_path))[0]
                task = {
                    "type": "audio",
                    "file_path": temp_audio_path,
                    "source_audio_path": os.path.abspath(audio_path),
                    "title": task_title,
                    "skip_images": True,
                    "prompt_template": self.config["prompt_template"],
                    "stt_only": bool(payload.get("stt_only", False)),
                    "mp3_only": bool(payload.get("mp3_only", False)),
                }
                if has_pdf:
                    temp_pdf_path = os.path.join(common.TEMP_DIR_NAME, f"api_pdf_{timestamp}.pdf")
                    shutil.copy(pdf_path, temp_pdf_path)
                    created_files.append(temp_pdf_path)
                    task["pdf_path"] = temp_pdf_path
                    task["source_pdf_path"] = os.path.abspath(pdf_path)
                    task["pdf_password"] = pdf_password
                    task["skip_images"] = False

                tid = self.engine.add_task(task, self.summary_task_config())
                if tid != -1:
                    self.mark_result_as_running(task_title)
                    task_ids.append(tid)
            except Exception:
                for file_path in created_files:
                    safe_remove(file_path)
                raise
        self.append_idle_log(f"오디오 작업 추가: {len(task_ids)}건")
        return task_ids

    def queue_video_task(self, payload: dict, task_type: str) -> int:
        require_summary_task(task_type)
        video_path = os.path.abspath(str(payload.get("video_path", "") or "").strip())
        if not video_path or is_unselected_file_value(video_path):
            raise ValueError("영상 파일을 선택하세요.")
        if not os.path.isfile(video_path):
            raise ValueError(f"영상 파일을 찾을 수 없습니다: {video_path}")
        if os.path.splitext(video_path)[1].lower() not in {".mp4", ".mov", ".mkv", ".webm"}:
            raise ValueError("지원하는 영상 형식은 MP4, MOV, MKV, WebM입니다.")
        local_stt = payload.get("local_stt", False)
        if not isinstance(local_stt, bool):
            raise ValueError("로컬 STT 선택값이 올바르지 않습니다.")
        if local_stt:
            require_local_stt_provider(LOCAL_WHISPER_CPP_VULKAN_ENGINE)
            models = edition_manifest.whisper_cpp_model_options()
            if not models:
                raise ValueError("이 배포판에는 사용할 수 있는 로컬 STT 모델이 없습니다.")
            requested_model = str(payload.get("local_stt_model") or self.config.get("stt_model_name") or "").strip()
            local_stt_model = requested_model if requested_model in models else settings.model_support.select_video_whisper_cpp_model(models=models)
            pipeline_utils.validate_whisper_cpp_vulkan_runtime(local_stt_model)
        else:
            local_stt_model = ""

        base_title = str(payload.get("title", "") or "").strip()
        if not base_title:
            base_title = os.path.splitext(os.path.basename(video_path))[0]
        mode_label = "상세정리본" if task_type == "video_detailed" else "요약정리본"
        task = {
            "type": task_type,
            "video_path": video_path,
            "source_video_path": video_path,
            "title": f"{base_title} {mode_label}",
            "base_title": base_title,
            "prompt_template": self.config["prompt_template"],
            "local_stt": local_stt,
            "local_stt_model": local_stt_model,
        }
        preflight = self.require_work_preflight(payload, task_type)
        self.config = server_config.save_config(self.config)
        task_config = self.video_task_config(task)
        # Queueing and cache-only retries do not reserve money or start a TTL.
        # Each stage opens its session lazily at the first actual AI request.
        cleanup = task_config.get("_task_cleanup")
        try:
            task_id = self.engine.add_task(task, task_config)
        except Exception:
            if cleanup:
                cleanup()
            raise
        if task_id == -1:
            if cleanup:
                cleanup()
            raise ValueError("같은 영상 정리 작업이 이미 대기 중이거나 실행 중입니다.")
        self.mark_result_as_running(task["title"])
        model_note = f" · 로컬 STT {local_stt_model}" if local_stt_model else ""
        self.append_idle_log(f"영상 {mode_label} 작업 추가: {task['title']}{model_note}")
        return task_id

    def download_video_whisper_model(self, payload: dict, emit):
        model_id = str(payload.get("model_id") or "").strip()
        models = edition_manifest.whisper_cpp_model_options()
        if model_id not in models:
            model_id = settings.model_support.select_video_whisper_cpp_model(models=models)
        status = install_whisper_cpp_model(
            model_id,
            confirmed=payload.get("confirmed") is True,
            emit=emit,
        )
        result = {"selected_model": model_id, **status}
        emit({"type": "model_download_complete", "model": result})
        return result

    def summary_task_config(self) -> dict:
        config = dict(self.config)
        config["_ai_provider_snapshot"] = {workflow: self.selected_ai_model(workflow)
            for workflow in ("video_summary", "video_verification", "video_stt_cleanup", "video_visual", "image_analysis")}
        records = []
        pool = ManagedStageSessions(
            lambda *args, **kwargs: self.acquire_managed_ai_action_session(*args, **kwargs),
            lambda session_id: self.finish_managed_ai_session(session_id), records)
        config["_managed_session_records"] = records
        config["_managed_stage_sessions"] = pool
        config["_task_cleanup"] = pool.close
        config["_managed_stage_complete"] = pool.close_stage
        config["_managed_session_resolve"] = self.get_managed_ai_session_result
        config["_summary_model_selection"] = self.selected_ai_model("video_summary")
        summary_selection = dict(config["_summary_model_selection"])
        import personal_mode
        if personal_mode.enabled():
            config["summary_verification_web_search_enabled"] = False
        if summary_selection["mode"] == "chatgpt" and config.get("summary_verification_web_search_enabled"):
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.protocol import ChatGPTError
            raise ChatGPTError("verification_web_search_unsupported")
        config["_summary_model_identity"] = lambda: self.video_summary_model_identity(summary_selection)
        cleanup_selection = dict(self.selected_ai_model("video_stt_cleanup"))
        config["_stt_cleanup_selection"] = cleanup_selection
        config["_stt_cleanup_call"] = self.call_video_stt_cleanup
        config["_stt_cleanup_model_identity"] = lambda: self.video_stt_cleanup_model_identity(cleanup_selection)
        verification_selection = dict(summary_selection)
        config["_video_verification_selection"] = verification_selection
        config["_managed_summary_call"] = (
            self.call_managed_video_summary if self.workflow_uses_managed_ai("video_summary") else self.call_personal_video_summary
        )
        config["_video_verification_call"] = self.call_video_verification
        config["_video_verification_tools_call"] = self.call_video_verification_with_tools
        config["_video_verification_model_identity"] = (
            lambda: self.video_verification_model_identity(verification_selection)
        )
        config["_video_verification_web_search_call"] = self.call_video_verification_web_search
        config["_image_analysis_call"] = self.call_image_analysis_batch
        return config

    def video_verification_model_identity(self, selection: Mapping | None = None) -> dict:
        """Resolve the model and policy revision immediately before verification."""
        selection = selection if selection is not None else self.selected_ai_model("video_summary")
        if selection["mode"] == "chatgpt":
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.runtime import model_identity
            return model_identity(selection)
        if selection["mode"] == "local":
            if "provider" in selection and "modelId" in selection:
                provider, selected_model = selection["provider"], selection["modelId"]
            else:
                provider, selected_model = self.local_provider_model("video_summary")
            return {"mode": "local", "provider": str(provider), "model_id": str(selected_model), "policy_revision": None}

        import client_ai_policy
        return client_ai_policy.identity(self.config, "video_summary", selection)

    def video_stt_cleanup_model_identity(self, selection: Mapping | None = None) -> dict:
        selection = selection if selection is not None else self.selected_ai_model("video_stt_cleanup")
        if selection["mode"] == "chatgpt":
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.runtime import model_identity
            return model_identity(selection)
        if selection["mode"] == "local":
            provider, model_id = str(selection["provider"]), str(selection["modelId"])
            return {"mode": "local", "provider": provider, "model_id": model_id}
        import client_ai_policy
        return client_ai_policy.identity(self.config, "video_stt_cleanup", selection)

    def video_summary_model_identity(self, selection: Mapping | None = None) -> dict:
        selection = selection if selection is not None else self.selected_ai_model("video_summary")
        if selection["mode"] == "chatgpt":
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.runtime import model_identity
            return model_identity(selection)
        if selection["mode"] == "local":
            return {"mode": "local", "provider": str(selection["provider"]),
                    "model_id": str(selection["modelId"])}
        import client_ai_policy
        return client_ai_policy.identity(self.config, "video_summary", selection)

    def video_task_config(self, task: Mapping) -> dict:
        config = self.summary_task_config()
        config["_video_vision_call"] = self.call_video_visual_event
        visual_selection = self.selected_ai_model("video_visual")
        config["_video_vision_identity"] = (
            ("chatgpt:" if visual_selection["mode"] == "chatgpt" else "")
            + str(visual_selection.get("modelId") or "AILS 기본 모델")
        )
        if task.get("local_stt"):
            model_id = str(task.get("local_stt_model", "") or "").strip()
            if model_id not in edition_manifest.whisper_cpp_model_options():
                model_id = settings.model_support.select_video_whisper_cpp_model()
            config["stt_provider"] = LOCAL_WHISPER_CPP_VULKAN_ENGINE
            config["stt_model_name"] = model_id
        elif infer_stt_provider(config) in providers.LOCAL_STT_PROVIDERS:
            config["stt_provider"] = PROVIDER_GEMINI
            config["stt_model_name"] = STT_MODEL_DEFAULT
        config["summary_verification_enabled"] = validate_video_summary_verification_config(config)
        return config

    def import_markdown(self, payload: dict) -> dict:
        path = str(payload.get("path", "") or "").strip()
        content = str(payload.get("content", "") or "")
        title = str(payload.get("title", "") or "").strip()
        file_path = ""
        if path:
            if not os.path.exists(path):
                raise ValueError(f"MD 파일을 찾을 수 없습니다: {path}")
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                content = handle.read()
            file_path = os.path.abspath(path)
            if not title:
                title = os.path.splitext(os.path.basename(path))[0]
        if not title:
            title = "업로드 정리본"
        if not content.strip():
            raise ValueError("등록할 마크다운 내용이 비어 있습니다.")

        with self.lock:
            self.processed_results[title] = {
                "title": title,
                "content": content,
                "model": "업로드",
                "file_path": file_path,
                "status": "success",
            }
            self.session_report_titles.add(title)
        self.append_idle_log(f"MD 리포트 등록: {title}")
        return self.processed_results[title]

    def retry_candidates(self, *, scan_disk: bool = False):
        if scan_disk:
            self.refresh_retry_candidates_from_disk()
        with self.lock:
            candidates = []
            for title, data in sorted(self.processed_results.items(), reverse=True):
                retry_task = data.get("retry_task")
                if data.get("status") not in {"failed", "needs_review"} or not isinstance(retry_task, dict):
                    continue
                retry_task_type = str(retry_task.get("type", "") or "").strip()
                if retry_task_type in {"audio", "video_detailed", "video_summary", "url", "youtube", "eclass_vod"} and not summary_task_allowed(retry_task_type):
                    continue
                candidates.append(
                    {
                        "title": title,
                        "task_type": retry_task.get("type"),
                        "status": data.get("status"),
                        "active": self.is_task_active_for_title(title),
                        "logs": normalize_retry_candidate_logs(data),
                        "last_error": str(data.get("last_error", "") or "").strip(),
                    }
                )
            return candidates

    def prepare_retry_task(self, retry_task: dict) -> dict:
        if not isinstance(retry_task, dict):
            raise RuntimeError("재시도 정보가 없습니다.")

        task_type = str(retry_task.get("type", "") or "").strip()
        if task_type in {"audio", "video_detailed", "video_summary", "url", "youtube", "eclass_vod"}:
            require_summary_task(task_type)
        title = str(retry_task.get("title", "") or "").strip()
        prompt_template = retry_task.get("prompt_template", self.config.get("prompt_template", BASE_PROMPT_TEMPLATE))
        stt_only = bool(retry_task.get("stt_only"))
        mp3_only = bool(retry_task.get("mp3_only"))

        if task_type in {"video_detailed", "video_summary"}:
            source_video_path = os.path.abspath(
                str(retry_task.get("source_video_path") or retry_task.get("video_path") or "").strip()
            )
            if not os.path.isfile(source_video_path):
                raise RuntimeError("원본 영상 파일을 찾을 수 없습니다.")
            return {
                "type": task_type,
                "video_path": source_video_path,
                "source_video_path": source_video_path,
                "title": title,
                "base_title": str(retry_task.get("base_title", "") or "").strip(),
                "prompt_template": prompt_template,
                "local_stt": bool(retry_task.get("local_stt")),
                "local_stt_model": str(retry_task.get("local_stt_model", "") or "").strip(),
            }

        if task_type == "url":
            return {
                "type": "url",
                "url": str(retry_task.get("url", "") or "").strip(),
                "start": int(retry_task.get("start", 0) or 0),
                "end": int(retry_task.get("end", 0) or 0),
                "title": title,
                "detail_mode": "detailed" if retry_task.get("detail_mode") == "detailed" else "summary",
                "skip_images": bool(retry_task.get("skip_images")),
                "interval": safe_float(retry_task.get("interval", 3), 3.0),
                "mse_threshold": safe_float(retry_task.get("mse_threshold", 500), 500.0),
                "prompt_template": prompt_template,
                "stt_only": stt_only,
                "mp3_only": mp3_only,
                "local_stt": bool(retry_task.get("local_stt")),
                "local_stt_model": str(retry_task.get("local_stt_model") or ""),
            }

        if task_type == "youtube":
            return {
                "type": "youtube",
                "youtube_url": str(retry_task.get("youtube_url") or retry_task.get("url") or "").strip(),
                "title": title,
                "detail_mode": "detailed" if retry_task.get("detail_mode") == "detailed" else "summary",
                "skip_images": bool(retry_task.get("skip_images")),
                "interval": safe_float(retry_task.get("frame_interval", retry_task.get("interval", 3)), 3.0),
                "mse_threshold": safe_float(retry_task.get("mse_threshold", 500), 500.0),
                "prompt_template": prompt_template,
                "stt_only": stt_only,
                "mp3_only": mp3_only,
                "local_stt": bool(retry_task.get("local_stt")),
                "local_stt_model": str(retry_task.get("local_stt_model") or ""),
            }

        if task_type == "eclass_vod":
            task = {
                "type": "eclass_vod",
                "vod_url": str(retry_task.get("vod_url") or retry_task.get("url") or "").strip(),
                "title": title,
                "skip_images": bool(retry_task.get("skip_images")),
                "interval": safe_float(retry_task.get("frame_interval", retry_task.get("interval", 3)), 3.0),
                "mse_threshold": safe_float(retry_task.get("mse_threshold", 500), 500.0),
                "prompt_template": prompt_template,
                "stt_only": stt_only,
                "mp3_only": mp3_only,
                "detail_mode": str(retry_task.get("detail_mode") or "summary"),
                "local_stt": bool(retry_task.get("local_stt")),
                "local_stt_model": str(retry_task.get("local_stt_model") or ""),
            }
            if retry_task.get("lms_batch") is True:
                task.update(lms_batch=True, grade=retry_task.get("grade"), semester=retry_task.get("semester"))
            return task

        if task_type != "audio":
            raise RuntimeError(f"지원하지 않는 재시도 작업 유형입니다: {task_type}")

        source_audio_path = str(retry_task.get("source_audio_path", "") or "").strip()
        if not source_audio_path or not os.path.exists(source_audio_path):
            raise RuntimeError("원본 오디오 파일을 찾을 수 없습니다.")

        os.makedirs(common.TEMP_DIR_NAME, exist_ok=True)
        created_files = []
        try:
            timestamp = int(time.time() * 1000)
            audio_ext = os.path.splitext(source_audio_path)[1] or ".bin"
            temp_audio_path = os.path.join(common.TEMP_DIR_NAME, f"retry_{timestamp}{audio_ext}")
            shutil.copy(source_audio_path, temp_audio_path)
            created_files.append(temp_audio_path)

            task = {
                "type": "audio",
                "file_path": temp_audio_path,
                "source_audio_path": os.path.abspath(source_audio_path),
                "title": title,
                "skip_images": bool(retry_task.get("skip_images", True)),
                "prompt_template": prompt_template,
                "stt_only": stt_only,
                "mp3_only": mp3_only,
            }

            source_pdf_path = str(retry_task.get("source_pdf_path", "") or "").strip()
            if source_pdf_path:
                if not os.path.exists(source_pdf_path):
                    raise RuntimeError("원본 PDF 파일을 찾을 수 없습니다.")
                temp_pdf_path = os.path.join(common.TEMP_DIR_NAME, f"retry_pdf_{timestamp}.pdf")
                shutil.copy(source_pdf_path, temp_pdf_path)
                created_files.append(temp_pdf_path)
                task["pdf_path"] = temp_pdf_path
                task["source_pdf_path"] = os.path.abspath(source_pdf_path)
                task["pdf_password"] = str(retry_task.get("pdf_password", "") or "")
                task["skip_images"] = False

            return task
        except Exception:
            for file_path in created_files:
                safe_remove(file_path)
            raise

    def retry_failed_task(self, title: str) -> int:
        normalized_title = str(title or "").strip()
        if not normalized_title:
            raise ValueError("재시도할 작업 제목이 비어 있습니다.")
        self.refresh_retry_candidates_from_disk()
        if self.is_task_active_for_title(normalized_title):
            raise RuntimeError("같은 제목의 작업이 이미 대기열 또는 실행 중입니다.")
        with self.lock:
            report_state = self.processed_results.get(normalized_title, {})
            retry_task = report_state.get("retry_task") if isinstance(report_state, dict) else None
        if not isinstance(retry_task, dict):
            raise RuntimeError("이 실패 작업에는 재시도 정보가 없습니다.")

        self.config = server_config.save_config(self.config)
        queued_task = self.prepare_retry_task(retry_task)
        previous_error = str(report_state.get("last_error") or "")
        if (
            queued_task.get("type") in {"video_detailed", "video_summary", "url", "youtube", "eclass_vod"}
            and not queued_task.get("local_stt")
            and "[phase:stt]" in previous_error
            and "gemini api key" in previous_error.casefold()
            and infer_stt_provider(self.config) == LOCAL_WHISPER_CPP_VULKAN_ENGINE
        ):
            base_dir = self.config.get("md_save_path", "")
            old_resume, _, _ = load_resume_state(base_dir, queued_task)
            queued_task["local_stt"] = True
            queued_task["local_stt_model"] = str(self.config.get("stt_model_name") or "")
            if old_resume and load_resume_media(old_resume):
                new_path, new_signature = build_resume_state_path(base_dir, queued_task)
                save_resume_state(new_path, new_signature, {
                    "media": old_resume["media"],
                    "managed_sessions": old_resume.get("managed_sessions") or [],
                })
        if queued_task.get("type") == "youtube" and not str(queued_task.get("youtube_url", "") or "").strip():
            raise RuntimeError("YouTube URL 정보가 없어 재시도할 수 없습니다.")
        if queued_task.get("type") == "eclass_vod":
            vod_url = str(queued_task.get("vod_url", "") or "").strip()
            if not vod_url:
                raise RuntimeError("e-class VOD URL 정보가 없어 재시도할 수 없습니다.")
        task_config = (
            self.video_task_config(queued_task)
            if queued_task.get("type") in {"video_detailed", "video_summary", "url", "youtube", "eclass_vod"}
            else self.summary_task_config()
        )
        task_config["_managed_previous_settlements"] = prior_settlements((
            (report_state.get("usage_summary") or {}).get("managed_settlement") or {}
        ).get("sessions", []))
        if queued_task.get("type") == "eclass_vod":
            task_config["_lms_ensure_authenticated"] = self.ensure_lms_login_for_eclass
        task_id = self.engine.add_task(queued_task, task_config)
        if task_id != -1:
            self.mark_result_as_running(normalized_title)
            self.append_idle_log(f"재시도 작업 추가: {normalized_title}")
        return task_id

    def retry_all_failed_tasks(self) -> dict:
        candidates = self.retry_candidates()
        queued = []
        failed = []
        for candidate in candidates:
            title = candidate.get("title", "")
            if candidate.get("active"):
                continue
            try:
                queued.append({"title": title, "task_id": self.retry_failed_task(title)})
            except Exception as error:
                failed.append({"title": title, "reason": str(error)})
        if queued:
            self.append_idle_log(f"실패 작업 재시도 추가: {len(queued)}건")
        return {"queued": queued, "failed": failed}

    def delete_retry_candidate(self, title: str) -> dict:
        normalized_title = str(title or "").strip()
        if not normalized_title:
            raise ValueError("삭제할 작업 제목이 비어 있습니다.")
        if self.is_task_active_for_title(normalized_title):
            raise RuntimeError("진행 중이거나 대기열에 있는 작업은 재시도 목록에서 삭제할 수 없습니다.")

        with self.lock:
            report_state = self.processed_results.get(normalized_title, {})
            retry_task = report_state.get("retry_task") if isinstance(report_state, dict) else None

        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        remove_retry_registry_entry(base_dir, normalized_title)
        if isinstance(retry_task, dict):
            clear_resume_state(None, base_dir, retry_task)

        with self.lock:
            self._disk_retry_titles.discard(normalized_title)
            if isinstance(report_state, dict) and report_state.get("status") == "failed":
                self.processed_results.pop(normalized_title, None)
            elif isinstance(report_state, dict):
                updated = dict(report_state)
                updated.pop("retry_task", None)
                updated.pop("_retry_source", None)
                self.processed_results[normalized_title] = updated
        self.append_idle_log(f"재시도 목록 삭제: {normalized_title}")
        return {"deleted": True, "title": normalized_title}

    def organize_report_files(self) -> dict:
        target_dir = resolve_app_path(self.config.get("md_save_path", ""))
        if not target_dir:
            raise ValueError("먼저 마크다운 저장 폴더를 설정해 주세요.")
        if not os.path.isdir(target_dir):
            raise ValueError(f"저장 폴더를 찾을 수 없습니다: {target_dir}")
        semester_folder = self.current_semester_folder_name()
        result = organize_reports(target_dir, semester_folder=semester_folder)
        moved_markdowns = int(result.get("moved_markdowns", 0) or 0)
        moved_image_dirs = int(result.get("moved_image_dirs", 0) or 0)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        self.append_idle_log(f"정리본 분류 완료: {semester_folder} 기준, 마크다운 {moved_markdowns}개, 이미지 폴더 {moved_image_dirs}개 이동")
        return result

    def current_semester_folder_name(self) -> str:
        grade = max(1, min(6, int(self.config.get("current_grade", 2) or 2)))
        semester = max(1, min(2, int(self.config.get("current_semester", 1) or 1)))
        return f"{grade}학년 {semester}학기"

    @staticmethod
    def _fingerprint_parts(parts: list[tuple]) -> str:
        digest = hashlib.blake2s(digest_size=8)
        for part in sorted(parts):
            digest.update(repr(part).encode("utf-8", "surrogatepass"))
            digest.update(b"\0")
        return digest.hexdigest()

    def status_static_fingerprints(self) -> dict:
        report_parts = []
        retry_parts = []
        with self.lock:
            for title, data in self.processed_results.items():
                if title in self.session_report_titles and data.get("status") == "success":
                    report_parts.append(
                        (
                            title,
                            data.get("updated_at") or 0,
                            data.get("file_path") or "",
                            data.get("model") or "",
                        )
                    )
                retry_task = data.get("retry_task")
                if data.get("status") == "failed" and isinstance(retry_task, dict):
                    logs = data.get("logs")
                    retry_parts.append(
                        (
                            title,
                            data.get("last_error") or "",
                            len(logs) if isinstance(logs, list) else 0,
                            self.is_task_active_for_title(title),
                        )
                    )
        return {
            "reports_fingerprint": self._fingerprint_parts(report_parts),
            "retry_candidates_fingerprint": self._fingerprint_parts(retry_parts),
        }

    def build_status_payload(self, *, scan_disk: bool = False, lite: bool = False):
        self.collect_engine_results()
        if scan_disk:
            self.refresh_disk_indexes()
        with self.engine.lock:
            update_main_status = getattr(self.engine, "_update_main_status_unlocked", None)
            if callable(update_main_status):
                update_main_status()
            pending = [
                {
                    "id": item.get("id"),
                    "title": (item.get("task") or {}).get("title", ""),
                    "type": (item.get("task") or {}).get("type", ""),
                }
                for item in self.engine.pending_tasks
            ]
            status = {
                "is_running": bool(self.engine.status.get("is_running")),
                "current_title": self.engine.status.get("current_title", "대기 중"),
                "current_task_id": self.engine.current_task_id,
                "cancel_requested": bool(self.engine.cancel_current_requested),
                "is_paused": bool(self.engine.status.get("is_paused")),
                "pause_reason": self.engine.status.get("pause_reason", ""),
                "logs": list(self.engine.status.get("logs", []) or []),
                "debug_events": list(getattr(self.engine, "_debug_events", self.engine.status.get("debug_events", [])) or []),
                "locator_status": dict(self.engine.status.get("locator_status", {}) or {}),
            }
            progress = estimate_status_progress(status["logs"], status["is_running"])
            status["progress_percent"] = progress["percent"]
            status["progress_label"] = progress["label"]
            status["progress_indeterminate"] = progress["indeterminate"]
            active_tasks = self.engine._active_task_snapshots_unlocked()
            for active in active_tasks:
                active_progress = estimate_status_progress(active.get("logs", []), active.get("status") == "running")
                active["progress_percent"] = active_progress["percent"]
                active["progress_label"] = active_progress["label"]
                active["progress_indeterminate"] = active_progress["indeterminate"]
        fingerprints = self.status_static_fingerprints()
        if lite:
            return {
                "status": status,
                "active_tasks": active_tasks,
                "pending": pending,
                "lite": True,
                **fingerprints,
            }
        return {
            "status": status,
            "active_tasks": active_tasks,
            "pending": pending,
            "reports": self.report_summaries(session_only=True),
            "retry_candidates": self.retry_candidates(scan_disk=False),
            "config": self.public_config(include_secrets=False),
            **fingerprints,
        }

    def report_summaries(self, session_only=False):
        with self.lock:
            reports = []
            for title, data in self.processed_results.items():
                if session_only and title not in self.session_report_titles:
                    continue
                # Saved reports needing another inspection remain readable.
                if data.get("status") not in {"success", "needs_review"}:
                    continue
                reports.append(
                    {
                        "id": title,
                        "title": title,
                        "model": data.get("model", ""),
                        "status": data.get("status", "success"),
                        "file_path": data.get("file_path", ""),
                        "updated_at": data.get("updated_at", 0),
                    }
                )
        reports.sort(key=lambda item: (item.get("updated_at") or 0, item.get("title") or ""), reverse=True)
        return reports
