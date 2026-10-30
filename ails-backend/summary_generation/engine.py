from __future__ import annotations

from .report_storage import ensure_report_heading

"""Optional lecture-summary engine for manifest-enabled input types."""

from common import (
    FIRST_COMPLETED,
    MAX_WORKERS,
    PROVIDER_CUSTOM,
    PROVIDER_DEEPSEEK,
    PROVIDER_GEMINI,
    PROVIDER_GROQ,
    TEMP_DIR_NAME,
    ThreadPoolExecutor,
    append_status_log,
    as_completed,
    build_image_dir,
    build_image_dir_name,
    build_report_path,
    build_retry_task_payload,
    build_usage_event,
    build_usage_markdown,
    clear_resume_state,
    emit_debug_trace,
    get_custom_feature_values,
    get_effective_feature_model_name,
    has_valid_image_resume_payload,
    infer_summary_model_name,
    infer_summary_provider,
    infer_stt_model_name,
    infer_stt_provider,
    load_resume_state,
    os,
    re,
    remove_retry_registry_entry,
    resolve_app_path,
    sanitize_title,
    save_resume_state,
    shutil,
    threading,
    time,
    upsert_retry_registry_entry,
    wait,
)
from edition_manifest import SUMMARY_TASK_FEATURES, require_summary_task
from voice.deepgram_transcript import collapse_deepgram_repeated_views
from .ffmpeg_runtime import ensure_ffmpeg_available
from .claim_verification import (
    DEEPSEEK_SINGLE_SUMMARY_MODEL,
    build_single_summary_prompt,
    build_verification_prompt,
    call_deepseek_single_summary,
    call_luna_verification,
    parse_summary_bundle,
    parse_verification_result,
    render_verification_markdown,
    validate_luna_verification_config,
)
from .video_modes import (
    DETAILED_TASK,
    SUMMARY_TASK,
    attach_visual_events_to_chunks,
    build_video_visual_event_messages,
    deduplicate_visual_events,
    format_video_timestamp,
    hold_video_transcript_lock,
    load_video_visual_events,
    load_video_transcript,
    parse_video_visual_event,
    save_video_visual_events,
    save_video_transcript,
    select_video_scenes,
    select_video_speech_context,
    video_mode_label,
    video_summary_instruction,
    video_visual_event_identity,
)
from .video_analysis import analyze_video
from .video_segmentation import build_or_load_video_segmentation
from .video_segments import (
    prepare_segment_frame_images,
    run_video_segment_analysis,
)
from pipeline_utils import (
    SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS,
    TaskCancelledError,
    build_chunk_image_prompt_context,
    build_context_bookmark,
    build_missing_final_sections_prompt,
    build_summary_resume_identity,
    build_summary_resume_progress,
    build_summary_prompt,
    build_summary_transcript_text,
    build_timed_summary_chunks,
    collapse_exact_repeated_utterance_blocks,
    collapse_exact_repeated_whole_text,
    create_mp3_file,
    download_authenticated_web_media,
    download_youtube_media,
    download_segment,
    extract_outline,
    extract_used_heading_keys,
    extract_used_section_titles,
    has_fun_fact_section,
    has_mastery_or_quiz_section,
    normalize_image_links,
    normalize_latex_math_syntax,
    normalize_markdown_image_link_sizes,
    normalize_markdown_separators,
    normalize_markdown_tables,
    load_summary_resume_progress,
    safe_float,
    safe_remove,
    safe_rmtree,
    should_generate_summary_supplement,
    split_timed_summary_chunk,
    strip_more_markers,
    strip_summary_restart_artifacts,
    summarize_timed_chunk_range,
    summary_prompt_exceeds_input_budget,
    trim_chunk_boundary_overlap,
)
from providers import (
    apply_penultimate_duplicate_representatives,
    call_ai_summary,
    call_stt_with_fallback_silent,
    continue_summary_if_needed,
    extract_pdf_pages,
    extract_scenes_by_interval,
    generate_image_captions_silent,
    review_image_duplicates_with_summary_model,
)



def prevent_sleep():
    """컴퓨터가 절전 모드로 들어가지 않도록 설정 (Windows)"""
    import os
    if os.name == 'nt':
        try:
            import ctypes
            # ES_CONTINUOUS = 0x80000000
            # ES_SYSTEM_REQUIRED = 0x00000001
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
        except Exception:
            pass

def allow_sleep():
    """컴퓨터 절전 모드 방지 해제 (Windows)"""
    import os
    if os.name == 'nt':
        try:
            import ctypes
            # ES_CONTINUOUS = 0x80000000
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
        except Exception:
            pass


from .task_runner import TaskExecutionMixin
from .media_temp_cleanup import cleanup_pending_downloads


class BackgroundEngine(TaskExecutionMixin):
    @property
    def status(self):
        return getattr(self._thread_state, "status", self._main_status)

    @status.setter
    def status(self, value):
        self._main_status = value

    @property
    def current_task_id(self):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            return slot.get("id")
        oldest = self._oldest_active_slot_unlocked()
        return oldest.get("id") if oldest else None

    @current_task_id.setter
    def current_task_id(self, value):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            if value is not None:
                slot["id"] = value
        else:
            self._current_task_id = value

    @property
    def cancel_current_event(self):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            return slot["cancel_event"]
        oldest = self._oldest_active_slot_unlocked()
        return oldest["cancel_event"] if oldest else self._default_cancel_event

    @property
    def pause_event(self):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            return slot["pause_event"]
        oldest = self._oldest_active_slot_unlocked()
        return oldest["pause_event"] if oldest else self._default_pause_event

    @property
    def cancel_current_requested(self):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            return bool(slot.get("cancel_requested"))
        oldest = self._oldest_active_slot_unlocked()
        return bool(oldest.get("cancel_requested")) if oldest else False

    @cancel_current_requested.setter
    def cancel_current_requested(self, value):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            slot["cancel_requested"] = bool(value)
        else:
            self._cancel_current_requested = bool(value)

    @property
    def is_paused(self):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            return bool(slot.get("is_paused"))
        oldest = self._oldest_active_slot_unlocked()
        return bool(oldest.get("is_paused")) if oldest else False

    @is_paused.setter
    def is_paused(self, value):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            slot["is_paused"] = bool(value)
        else:
            self._is_paused = bool(value)

    @property
    def pause_reason(self):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            return str(slot.get("pause_reason", "") or "")
        oldest = self._oldest_active_slot_unlocked()
        return str(oldest.get("pause_reason", "") or "") if oldest else ""

    @pause_reason.setter
    def pause_reason(self, value):
        slot = getattr(self._thread_state, "slot", None)
        if slot is not None:
            slot["pause_reason"] = str(value or "")
        else:
            self._pause_reason = str(value or "")

    def __init__(self):
        self.pending_tasks = []
        self.results_to_collect = []
        self.lock = threading.Lock()
        self._thread_state = threading.local()
        self._main_status = {"is_running": False, "current_title": "대기 중", "logs": [], "debug_events": [],
                             "locator_status": {}}
        self._debug_events = []
        self._main_status["is_paused"] = False
        self._main_status["pause_reason"] = ""
        self.active_tasks = {}
        self.max_parallel_jobs = 2
        self.next_task_id = 1
        self._current_task_id = None
        self._cancel_current_requested = False
        self._default_cancel_event = threading.Event()
        self._default_pause_event = threading.Event()
        self._is_paused = False
        self._pause_reason = ""
        self._shutdown = threading.Event()
        self._start_lock = threading.Lock()
        self.thread = None
        self._network_monitor_thread = None

    def start(self):
        """Opening a document must not start media workers or network polling."""
        with self._start_lock:
            if self._shutdown.is_set():
                raise RuntimeError("Background engine has closed")
            if self.thread is not None:
                return
            cleanup_pending_downloads(TEMP_DIR_NAME, lambda message: append_status_log(self._main_status['logs'], message))
            self.thread = threading.Thread(target=self._worker_loop, name="ails-summary-queue", daemon=True)
            self._network_monitor_thread = threading.Thread(target=self._network_monitor_loop, name="ails-network-monitor", daemon=True)
            self.thread.start()
            self._network_monitor_thread.start()

    def close(self, timeout: float = 3.0):
        with self._start_lock:
            self._shutdown.set()
        self.request_cancel_all()
        with self.lock:
            workers = [slot.get("thread") for slot in self.active_tasks.values()]
        deadline = time.monotonic() + timeout
        for worker in [self.thread, self._network_monitor_thread, *workers]:
            if worker is not None and worker is not threading.current_thread():
                worker.join(max(0.0, deadline - time.monotonic()))
        allow_sleep()

    def _oldest_active_slot_unlocked(self):
        if not getattr(self, "active_tasks", None):
            return None
        return min(self.active_tasks.values(), key=lambda slot: slot.get("started_at", 0))

    def _parallel_limit_from_config(self, config=None):
        try:
            raw = (config or {}).get("max_parallel_summary_jobs", self.max_parallel_jobs)
            return max(1, min(4, int(raw or 2)))
        except Exception:
            return 2

    def _is_serial_task(self, task):
        return (task or {}).get("type") in {"repair_image_links", "latex_postprocess"}

    def _active_task_snapshots_unlocked(self):
        snapshots = []
        for slot in sorted(self.active_tasks.values(), key=lambda item: item.get("started_at", 0)):
            status = slot.get("status") or {}
            snapshots.append({
                "task_id": slot.get("id"),
                "title": slot.get("title", ""),
                "type": slot.get("type", ""),
                "status": slot.get("state", "running"),
                "started_at": slot.get("started_at", 0),
                "is_paused": bool(slot.get("is_paused")),
                "pause_reason": slot.get("pause_reason", ""),
                "cancel_requested": bool(slot.get("cancel_requested")),
                "logs": list(status.get("logs", []) or []),
                "debug_events": list(status.get("debug_events", []) or []),
                "locator_status": dict(status.get("locator_status", {}) or {}),
            })
        return snapshots

    def active_task_snapshots(self):
        with self.lock:
            return self._active_task_snapshots_unlocked()

    def _update_main_status_unlocked(self):
        oldest = self._oldest_active_slot_unlocked()
        if oldest:
            status = oldest.get("status") or {}
            self._main_status["is_running"] = True
            self._main_status["current_title"] = status.get("current_title", oldest.get("title", ""))
            self._main_status["logs"] = list(status.get("logs", []) or [])
            self._main_status["debug_events"] = list(status.get("debug_events", []) or [])
            self._main_status["locator_status"] = dict(status.get("locator_status", {}) or {})
            self._main_status["is_paused"] = bool(oldest.get("is_paused"))
            self._main_status["pause_reason"] = oldest.get("pause_reason", "")
        else:
            self._main_status["is_running"] = False
            self._main_status["current_title"] = "대기 중"
            self._main_status["is_paused"] = False
            self._main_status["pause_reason"] = ""
            self._main_status["locator_status"] = {}

    def _make_slot(self, task_item):
        task = task_item.get("task") or {}
        task_id = task_item.get("id")
        status = {
            "is_running": True,
            "current_title": task.get("title", ""),
            "logs": [],
            "debug_events": [],
            "locator_status": {},
            "is_paused": False,
            "pause_reason": "",
        }
        return {
            "id": task_id,
            "task": task,
            "type": task.get("type", ""),
            "title": task.get("title", ""),
            "status": status,
            "cancel_event": threading.Event(),
            "pause_event": threading.Event(),
            "cancel_requested": False,
            "is_paused": False,
            "pause_reason": "",
            "started_at": time.time(),
            "state": "running",
            "thread": None,
        }

    def _set_thread_slot(self, slot):
        self._thread_state.slot = slot
        self._thread_state.status = slot["status"]

    def _clear_thread_slot(self):
        if hasattr(self._thread_state, "slot"):
            del self._thread_state.slot
        if hasattr(self._thread_state, "status"):
            del self._thread_state.status

    def add_task(self, task, config):
        task_type = str(task.get("type", "") or "").strip()
        if task_type in SUMMARY_TASK_FEATURES:
            require_summary_task(task_type)
        elif task_type not in {"repair_image_links", "latex_postprocess"}:
            raise ValueError(f"Unsupported background task type: {task_type or 'missing'}")
        self.start()
        with self.lock:
            if self._shutdown.is_set():
                raise RuntimeError("Background engine has closed")
            title = str(task.get("title", "") or "").strip()
            if title:
                # 1. 대기열(pending_tasks) 중복 방지
                for item in self.pending_tasks:
                    if str(item.get("task", {}).get("title", "") or "").strip() == title:
                        return -1
                # 2. 실행 중(active_tasks) 중복 방지
                for slot in self.active_tasks.values():
                    if str(slot.get("task", {}).get("title", "") or "").strip() == title:
                        return -1
            task_id = self.next_task_id
            self.next_task_id += 1
            self.pending_tasks.append({"id": task_id, "task": dict(task), "config": dict(config)})
            return task_id

    def remove_pending_task(self, task_id):
        removed = None
        with self.lock:
            for index, item in enumerate(self.pending_tasks):
                if item.get("id") == task_id:
                    removed = self.pending_tasks.pop(index)
                    break
        cleanup = (removed or {}).get("config", {}).get("_task_cleanup")
        if callable(cleanup):
            cleanup()
        return removed

    def request_cancel_current_task(self):
        with self.lock:
            oldest = self._oldest_active_slot_unlocked()
            task_id = oldest.get("id") if oldest else None
        return self.request_cancel_task(task_id) if task_id is not None else False

    def request_cancel_task(self, task_id):
        with self.lock:
            slot = self.active_tasks.get(task_id)
            if slot is None:
                return False
            if slot.get("cancel_requested"):
                return True
            slot["cancel_requested"] = True
            slot["cancel_event"].set()
            logs = slot["status"].setdefault("logs", [])
        append_status_log(logs, "현재 작업 취소 요청을 받았습니다. 가능한 즉시 중단합니다.")
        return True

    def request_cancel_all(self):
        with self.lock:
            task_ids = list(self.active_tasks.keys())
            pending = list(self.pending_tasks)
            self.pending_tasks.clear()
        for item in pending:
            cleanup = item.get("config", {}).get("_task_cleanup")
            if callable(cleanup):
                cleanup()
        cancelled = False
        for task_id in task_ids:
            cancelled = self.request_cancel_task(task_id) or cancelled
        return cancelled or bool(pending)

    def request_pause(self, reason: str = "user"):
        with self.lock:
            oldest = self._oldest_active_slot_unlocked()
            task_id = oldest.get("id") if oldest else None
        return self.request_pause_task(task_id, reason=reason) if task_id is not None else False

    def request_pause_task(self, task_id, reason: str = "user"):
        with self.lock:
            slot = self.active_tasks.get(task_id)
            if slot is None:
                return False
            if slot.get("is_paused"):
                return True
            slot["is_paused"] = True
            slot["pause_reason"] = reason
            slot["pause_event"].set()
            slot["status"]["is_paused"] = True
            slot["status"]["pause_reason"] = reason
            logs = slot["status"].setdefault("logs", [])
        reason_label = {
            "network": "network",
            "sleep": "sleep",
            "user": "user",
        }.get(reason, reason or "user")
        append_status_log(logs, f"[일시정지:{reason_label}] 작업이 일시정지되었습니다. 재개하면 이어서 진행합니다.")
        return True

    def resume(self, reason: str = ""):
        with self.lock:
            oldest = self._oldest_active_slot_unlocked()
            task_id = oldest.get("id") if oldest else None
        return self.resume_task(task_id, reason=reason) if task_id is not None else False

    def resume_task(self, task_id, reason: str = ""):
        with self.lock:
            slot = self.active_tasks.get(task_id)
            if slot is None or not slot.get("is_paused"):
                return False
            slot["is_paused"] = False
            slot["pause_reason"] = ""
            slot["pause_event"].clear()
            slot["status"]["is_paused"] = False
            slot["status"]["pause_reason"] = ""
            logs = slot["status"].setdefault("logs", [])
        append_status_log(logs, "[재개] 작업을 다시 진행합니다.")
        return True

    def request_pause_all(self, reason: str = "user"):
        with self.lock:
            task_ids = list(self.active_tasks.keys())
        changed = False
        for task_id in task_ids:
            changed = self.request_pause_task(task_id, reason=reason) or changed
        return changed

    def resume_all(self, reason: str = ""):
        with self.lock:
            task_ids = list(self.active_tasks.keys())
        changed = False
        for task_id in task_ids:
            changed = self.resume_task(task_id, reason=reason) or changed
        return changed

    def check_cancel_requested(self):
        if self.cancel_current_event.is_set():
            raise TaskCancelledError("현재 작업이 취소되었습니다.")
        while self.pause_event.is_set():
            if self.cancel_current_event.is_set():
                raise TaskCancelledError("일시정지 중 작업이 취소되었습니다.")
            time.sleep(0.5)
        if self.cancel_current_event.is_set():
            raise TaskCancelledError("현재 작업이 취소되었습니다.")

    def _network_monitor_loop(self):
        import socket

        network_host = "8.8.8.8"
        network_port = 53
        poll_interval = 4
        offline_confirm_count = 2
        sleep_gap_seconds = 30
        consecutive_failures = 0
        was_paused_by_network = False
        last_tick = time.monotonic()

        while not self._shutdown.wait(poll_interval):
            now = time.monotonic()
            with self.lock:
                has_active = bool(self.active_tasks)
            if now - last_tick > sleep_gap_seconds and has_active:
                self.request_pause_all(reason="sleep")
            last_tick = now

            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.settimeout(2)
                sock.connect((network_host, network_port))
                consecutive_failures = 0
                with self.lock:
                    has_network_paused = any(
                        slot.get("is_paused") and slot.get("pause_reason") == "network"
                        for slot in self.active_tasks.values()
                    )
                if was_paused_by_network and has_network_paused:
                    was_paused_by_network = False
                    self.resume_all(reason="network")
            except OSError:
                consecutive_failures += 1
                if consecutive_failures >= offline_confirm_count:
                    with self.lock:
                        has_active = bool(self.active_tasks)
                    if has_active:
                        self.request_pause_all(reason="network")
                        was_paused_by_network = True
            finally:
                sock.close()

    @staticmethod
    def _append_debug_event(events, event):
        if event["event_type"] == "token" and events:
            last_event = events[-1]
            if (
                isinstance(last_event, dict)
                and last_event.get("event_type") == "token"
                and last_event.get("label") == event["label"]
                and last_event.get("source") == event["source"]
                and last_event.get("model") == event["model"]
            ):
                last_event["content"] = str(last_event.get("content", "")) + event["content"]
                last_event["updated_at"] = event["updated_at"]
                return
        events.append(dict(event))
        del events[:-500]

    def append_debug_trace(self, label, content="", event_type="info", *, source="", direction="", model=""):
        timestamp = time.strftime("%H:%M:%S")
        label = str(label or "debug")
        event_type = str(event_type or "info")
        if not source:
            lowered_label = label.casefold()
            if any(name in lowered_label for name in ("llama.cpp", "lm studio", "local")):
                source = "local"
            elif any(name in lowered_label for name in ("gemini", "groq", "deepseek", "vercel", "gateway", "managed")):
                source = "cloud"
            else:
                source = "system"
        if not direction:
            if event_type in {"prompt", "request", "input"}:
                direction = "input"
            elif event_type in {"token", "response", "output", "tool_call", "error"}:
                direction = "output"
            else:
                direction = "event"
        event = {
            "time": timestamp,
            "updated_at": timestamp,
            "label": label,
            "event_type": event_type,
            "source": str(source),
            "direction": str(direction),
            "model": str(model or ""),
            "content": str(content or ""),
        }
        with self.lock:
            events = self.status.setdefault("debug_events", [])
            self._append_debug_event(events, event)
            self._append_debug_event(self._debug_events, event)

    def run_stt_with_audio_cleanup_fallback(self, source_audio_path, mp3_path, cfg, log_list):
        attempts = [
            {"label": "기본 설정", "threshold_db": -50.0},
            {"label": "완화 1단계", "threshold_db": -55.0},
            {"label": "완화 2단계", "threshold_db": -60.0},
            {"label": "무음 제거 없음", "threshold_db": None},
        ]
        for idx, attempt in enumerate(attempts, start=1):
            self.check_cancel_requested()
            threshold_db = attempt["threshold_db"]
            if threshold_db is None:
                append_status_log(log_list, f"STT 재시도 {idx}/{len(attempts)}: 무음 제거 없이 다시 시도합니다.")
            elif idx == 1:
                append_status_log(log_list, "STT용 오디오 정리를 시작합니다.")
            else:
                append_status_log(log_list, f"STT 재시도 {idx}/{len(attempts)}: 무음 제거 임계값을 {threshold_db:.0f}dB로 낮춰 다시 시도합니다.")

            create_mp3_file(
                source_audio_path,
                mp3_path,
                cancel_event=self.cancel_current_event,
                silence_threshold_db=threshold_db,
            )

            if threshold_db is None:
                append_status_log(log_list, "STT용 오디오 정리 완료 (무음 제거 없음)")
            else:
                append_status_log(log_list, "STT용 오디오 정리 완료")

            transcript, stt_m, stt_usage, stt_utterances, stt_duration_seconds = call_stt_with_fallback_silent(
                mp3_path,
                cfg,
                log_list,
            )
            usable_text = build_summary_transcript_text(transcript, stt_utterances, stt_duration_seconds)
            if usable_text:
                if idx > 1:
                    append_status_log(log_list, f"STT 재시도 성공: {attempt['label']} 설정에서 사용할 수 있는 텍스트를 확보했습니다.")
                return transcript, stt_m, stt_usage, stt_utterances, stt_duration_seconds
            if idx < len(attempts):
                append_status_log(log_list, "STT 결과에 사용할 수 있는 텍스트가 없어 다음 오디오 정리 설정으로 다시 시도합니다.")

        raise RuntimeError("STT 결과에 사용할 수 있는 텍스트가 없습니다.")


    def _worker_loop(self):
        while not self._shutdown.is_set():
            launched = False
            with self.lock:
                if self._shutdown.is_set():
                    return
                self._update_main_status_unlocked()
                active_count = len(self.active_tasks)
                next_item = self.pending_tasks[0] if self.pending_tasks else None
                if next_item:
                    task = next_item.get("task") or {}
                    cfg = next_item.get("config") or {}
                    self.max_parallel_jobs = self._parallel_limit_from_config(cfg)
                    serial_task = self._is_serial_task(task)
                    can_start = False
                    if serial_task:
                        can_start = active_count == 0
                    else:
                        can_start = active_count < self.max_parallel_jobs and not any(
                            self._is_serial_task(slot.get("task")) for slot in self.active_tasks.values()
                        )
                    if can_start:
                        task_item = self.pending_tasks.pop(0)
                        slot = self._make_slot(task_item)
                        worker = threading.Thread(target=self._run_task_item, args=(task_item, slot), daemon=True)
                        slot["thread"] = worker
                        self.active_tasks[slot["id"]] = slot
                        self._update_main_status_unlocked()
                        worker.start()
                        launched = True
            if not launched:
                with self.lock:
                    has_work = bool(self.active_tasks or self.pending_tasks)
                if not has_work:
                    allow_sleep()
                self._shutdown.wait(0.5)
