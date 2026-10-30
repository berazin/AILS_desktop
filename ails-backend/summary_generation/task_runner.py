"""Task-slot orchestration, cancellation, cleanup and settlement publication."""

from __future__ import annotations

import hashlib
from pathlib import Path
from common import (
    TEMP_DIR_NAME,
    append_status_log,
    build_image_dir_name,
    build_report_path,
    build_retry_task_payload,
    build_usage_event,
    build_usage_markdown,
    has_valid_image_resume_payload,
    load_resume_state,
    os,
    sanitize_title,
    save_resume_state,
    threading,
    time,
    upsert_retry_registry_entry,
)
from task_persistence import load_resume_media
from voice.deepgram_transcript import collapse_deepgram_repeated_views
from .ffmpeg_runtime import ensure_ffmpeg_available
from .claim_verification import parse_verification_result
from .video_modes import (
    DETAILED_TASK,
    SUMMARY_TASK,
    video_summary_instruction,
    video_task_mode,
)
from .managed_costs import (
    apply_settlements,
    merge_settlements,
    persist_settlement_result,
    previous_report_settlements,
    prior_settlements,
    prior_usage_events,
    usage_cost_sources,
)
from pipeline_utils import (
    TaskCancelledError,
    safe_float,
    safe_remove,
    safe_rmtree,
)
from .verification_contract import (
    CONCEPT_CANDIDATE_TOOL_SCHEMA,
    CONCEPT_ONLY_CONTRACT_VERSION,
    CONCEPT_REVIEW_TOOLS,
    CONCEPT_VERIFICATION_CONTRACT_VERSION,
    CONCEPT_WEB_TOOL_SCHEMA,
    FIDELITY_VERIFICATION_CONTRACT_VERSION,
    VERIFICATION_TOOL_SCHEMAS,
    VIDEO_CONTRADICTION_INSPECTION_ENABLED,
    WEB_VERIFICATION_TOOL_SCHEMA,
    _STT_ID_PARAMETERS,
    _STT_TIME_PARAMETERS,
    _bounded_verification_call,
    _checkpoint_verification_call,
    _recover_rejected_verification_round,
    _validated_verification_checkpoint_result,
    _verification_evidence_digest,
    fidelity_invalid_tools_resolved,
)
from .task_state import TaskRunState
from .media_temp_cleanup import cleanup_completed_downloads, keep_media_file
from .task_media import (
    _build_media_temp_dir,
    prepare_task_media,
)
from .report_storage import (
    _extract_report_body_for_comparison,
    _replace_verified_summary_body,
    _report_user_edited,
    _save_report_atomically,
    ensure_report_heading,
    save_task_report,
)
from .task_review import review_task_summary
from .task_writer import write_task_summary


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


class TaskExecutionMixin:
    def _run_task_item(self, task_item, slot):
        engine = self
        engine._set_thread_slot(slot)
        try:
            prevent_sleep()
            run = TaskRunState(engine, task_item['task'], task_item['config'])
            is_lms_batch = run.task.get("type") == "eclass_vod" and run.task.get("lms_batch") is True
            run.task_grade = run.task.get("grade") if is_lms_batch else None
            run.task_semester = run.task.get("semester") if is_lms_batch else None
            run.cfg["_cancel_check"] = engine.check_cancel_requested
            run.cfg["_cancel_event"] = engine.cancel_current_event
            run.cfg["_pause_event"] = engine.pause_event
            run.cfg["_debug_trace"] = engine.append_debug_trace
            engine.status["is_running"] = True
            engine.status["is_paused"] = False
            engine.status["pause_reason"] = ""
            engine.status["current_title"] = run.task['title']
            engine.status["logs"] = []
            engine.status["debug_events"] = []
            engine.status["locator_status"] = {}
            append_status_log(engine.status["logs"], f"작업 시작: {run.task['title']}")
            task_type_label = {
                "audio": "오디오/PDF",
                "url": "URL 패턴",
                "youtube": "YouTube",
                "eclass_vod": "e-class VOD",
                DETAILED_TASK: "영상 상세 정리",
                SUMMARY_TASK: "영상 요약 정리",
                "repair_image_links": "이미지 링크 복구",
                "latex_postprocess": "LaTeX postprocess",
            }.get(run.task.get("type"), str(run.task.get("type", "알 수 없음")))
            append_status_log(engine.status["logs"], f"작업 유형: {task_type_label}")
            
            run.verifier_effort = str(run.cfg.get("summary_verification_reasoning_effort") or "medium").strip()
            if run.verifier_effort not in {"none", "minimal", "low", "medium", "high"}:
                run.verifier_effort = ""
            try:
                if run.task.get("type") == "repair_image_links":
                    engine.check_cancel_requested()
                    repair_runner = run.cfg.get("_repair_image_links_runner")
                    if not callable(repair_runner):
                        raise RuntimeError("이미지 링크 복구 실행기를 찾을 수 없습니다.")
                    repair_results = repair_runner(run.task, run.cfg, engine.status["logs"])
                    with engine.lock:
                        run.task_results.append({
                            "title": "__image_link_repair__",
                            "_ui_event": "image_link_repair",
                            "repair_results": repair_results,
                            "status": "success",
                            "content": "",
                            "model": "이미지 링크 복구",
                        })
                    append_status_log(engine.status["logs"], "이미지 링크 복구 작업 완료")
                    time.sleep(1)
                    return

                if run.task.get("type") == "latex_postprocess":
                    engine.check_cancel_requested()
                    postprocess_runner = run.cfg.get("_latex_postprocess_runner")
                    if not callable(postprocess_runner):
                        raise RuntimeError("LaTeX 문법 후처리 실행기를 찾을 수 없습니다.")
                    postprocess_results = postprocess_runner(run.task, run.cfg, engine.status["logs"])
                    with engine.lock:
                        run.task_results.append({
                            "title": "__latex_postprocess__",
                            "_ui_event": "latex_postprocess",
                            "postprocess_results": postprocess_results,
                            "status": "success",
                            "content": "",
                            "model": "LaTeX postprocess",
                        })
                    append_status_log(engine.status["logs"], "LaTeX 문법 후처리 작업 완료")
                    time.sleep(1)
                    return

                engine.check_cancel_requested()
                run.run_id = f"{task_item.get('id')}_{int(time.time() * 1000)}_{threading.get_ident()}"
                run.ts_f, run.mp3_f = f"temp_{run.run_id}.ts", f"temp_{run.run_id}.mp3"
                run.safe_title = sanitize_title(run.task['title'])
                run.image_dir_name = build_image_dir_name(run.task['title'])
                if run.task.get("type") == "eclass_vod":
                    previous_path = build_report_path(
                        run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester
                    )
                    run.cfg["_managed_previous_settlements"] = merge_settlements(
                        run.cfg.get("_managed_previous_settlements"),
                        previous_report_settlements(run.cfg['md_save_path'], run.task['title'],
                                                    previous_path, run.task.get("vod_url", "")),
                    )


                run.resume_state, run.resume_state_path, run.resume_signature = load_resume_state(run.cfg['md_save_path'], run.task)
                if run.resume_state:
                    # Keep completed chunks even if this retry is cancelled before
                    # the summary identity is checked again.
                    run.summary_resume_payload = run.resume_state.get("summary")
                    if load_resume_media(run.resume_state):
                        run.resume_media = run.resume_state["media"]
                    saved_stt = run.resume_state.get("stt")
                    if isinstance(saved_stt, dict):
                        run.transcript = str(saved_stt.get("transcript", "") or "")
                        run.stt_m = str(saved_stt.get("model", "") or "").strip()
                        run.stt_usage = saved_stt.get("usage") or None
                        run.stt_utterances = saved_stt.get("utterances") or []
                        run.timed_source_records = (
                            saved_stt.get("timed_source_records") or []
                        ) if saved_stt.get("timed_source_contract_version") == 2 else []
                        run.stt_duration_seconds = safe_float(saved_stt.get("duration_seconds", 0.0), 0.0)
                        if "deepgram" in run.stt_m.casefold():
                            repaired_transcript, repeated_views = collapse_deepgram_repeated_views(
                                run.transcript,
                                run.stt_utterances,
                            )
                            if repeated_views > 1:
                                run.transcript = repaired_transcript
                                append_status_log(
                                    engine.status["logs"],
                                    f"저장된 Deepgram 중복 원문 {repeated_views}개 표현을 한 번으로 복구했습니다.",
                                )
                        run.stt_usage_event = (prior_usage_events([run.resume_state.get("stt_usage_event")]) or [None])[0]
                        if not run.stt_usage_event and run.stt_usage:
                            run.stt_usage_event = (prior_usage_events([
                                build_usage_event("stt", run.stt_m, run.stt_usage, input_type="audio")
                            ]) or [None])[0]
                        run.stt_completed = run.has_usable_stt_text()
                        if run.stt_completed:
                            append_status_log(
                                engine.status["logs"],
                                f"이전 실행의 STT 결과를 재사용합니다. ({run.stt_m or '모델 미상'})"
                            )
                        elif run.transcript or run.stt_utterances or run.stt_m:
                            append_status_log(
                                engine.status["logs"],
                                "이전 실행의 STT 결과는 요약에 사용할 본문이 비어 있어 무시하고 다시 진행합니다."
                            )
                            run.transcript = ""
                            run.stt_m = ""
                            run.stt_usage = None
                            run.stt_utterances = []
                            run.timed_source_records = []
                            run.stt_duration_seconds = 0.0
                            run.stt_usage_event = None

                    saved_image = run.resume_state.get("image")
                    if has_valid_image_resume_payload(
                        run.cfg['md_save_path'],
                        run.task['title'],
                        saved_image,
                        require_full_coverage=bool(run.task.get('pdf_path')),
                        grade=run.task_grade,
                        semester=run.task_semester,
                    ):
                        run.image_caps = dict(saved_image.get("captions") or {})
                        run.image_meta = list(saved_image.get("image_meta") or [])
                        run.img_d_name = str(saved_image.get("image_dir_name") or run.image_dir_name).strip() or run.image_dir_name
                        run.image_usage_events = prior_usage_events(run.resume_state.get("image_usage_events"))
                        run.image_completed = True
                        append_status_log(
                            engine.status["logs"],
                            f"이전 실행의 이미지 분석 결과를 재사용합니다. ({len(run.image_caps)}개 캡션)"
                        )
                    elif isinstance(saved_image, dict):
                        append_status_log(
                            engine.status["logs"],
                            "이전 이미지 재개 데이터는 원본 이미지 파일이 없어 무시합니다."
                        )

                run.sync_phase_usage_events()

                run.task_type = str(run.task.get("type") or "")
                run.video_mode = video_task_mode(run.task)
                run.video_content_instruction = video_summary_instruction(run.video_mode or run.task_type)
                legacy_web_images = run.task_type in {"youtube", "eclass_vod", "url"} and any(
                    isinstance(meta, dict) and "image_name" in meta for meta in run.image_meta
                )
                if run.video_mode is not None and (run.task.get('skip_images') or run.task.get('stt_only') or legacy_web_images):
                    run.image_caps = {}
                    run.image_meta = []
                    run.image_usage_events = []
                    run.image_completed = False
                    run.sync_phase_usage_events()
                    if legacy_web_images:
                        append_status_log(engine.status["logs"], "이전 영상 이미지 분석 데이터는 공통 영상 파이프라인에서 다시 준비합니다.")
                needs_ffmpeg = (
                    run.task_type in {"youtube", "eclass_vod", "url"}
                    and (not run.resume_media or run.task.get("mp3_only"))
                ) or (
                    run.task_type == "audio"
                    and (run.task.get("mp3_only") or not run.stt_completed)
                )
                run.ffmpeg_path = None
                if needs_ffmpeg:
                    run.current_phase = "ffmpeg_setup"
                    run.ffmpeg_path = ensure_ffmpeg_available(
                        log_list=engine.status["logs"],
                        cancel_check=engine.check_cancel_requested,
                    )

                if prepare_task_media(run):
                    run.media_work_completed = True
                    return

                write_task_summary(run)


                review_task_summary(run)

                save_task_report(run)
                run.media_work_completed = not run.needs_review
                
            except TaskCancelledError as e:
                run.was_cancelled = True
                if run.stt_completed or run.image_completed:
                    if run.persist_partial_progress():
                        append_status_log(engine.status["logs"], "부분 완료 결과를 저장했습니다. 다음 실행에서 이어서 진행할 수 있습니다.")
                append_status_log(engine.status["logs"], f"작업 취소됨: {e}")
                retry_payload = build_retry_task_payload(run.task)
                if retry_payload:
                    cancellation = {
                        "status": "failed",
                        "retry_task": retry_payload,
                        "last_error": f"[phase:{run.current_phase}] 작업 취소됨: {e}",
                        "content": "작업이 취소되었습니다. 재시도하면 저장된 진행 상태부터 이어갑니다.",
                        "last_logs": list(engine.status["logs"]),
                        "saved_at": int(time.time()),
                    }
                    upsert_retry_registry_entry(run.cfg['md_save_path'], run.task['title'], cancellation)
                    with engine.lock:
                        run.task_results.append({
                            **cancellation, "title": run.task['title'],
                            "model": "작업 취소", "logs": cancellation["last_logs"],
                        })
                time.sleep(1)
            except Exception as e:
                if run.stt_completed or run.image_completed:
                    if run.persist_partial_progress():
                        append_status_log(engine.status["logs"], "부분 완료 결과를 저장했습니다. 다음 실행에서 이어서 진행할 수 있습니다.")
                append_status_log(engine.status["logs"], f"오류 발생: {e}")
                if "[phase:" in str(e):
                    phase_error_message = str(e)
                else:
                    phase_error_message = f"[phase:{run.current_phase}] {e}"
                append_status_log(engine.status["logs"], f"Error phase detail: {phase_error_message}")
                failure_engine_bits = []
                if run.stt_m:
                    failure_engine_bits.append(f"**STT 엔진:** `{run.stt_m}`")
                if run.last_m and run.last_m != "N/A":
                    failure_engine_bits.append(f"**요약 엔진:** `{run.last_m}`")
                if run.verifier_m:
                    label = f"{run.verifier_m} ({run.verifier_effort})" if run.verifier_effort else run.verifier_m
                    failure_engine_bits.append(f"**검증 엔진:** `{label}`")
                engine_line = " | ".join(failure_engine_bits) if failure_engine_bits else None
                usage_block, usage_summary = build_usage_markdown(run.usage_events, engine_line=engine_line)
                usage_summary["byok_cost_sources"] = usage_cost_sources(run.usage_events)
                failure_logs = list(engine.status["logs"])
                failure_content = (
                    f"# {run.task['title']} 분석 실패\n\n"
                    f"> **상태:** 분석 실패\n"
                    f"> **오류:** {e}\n"
                    f"> **phase:** {phase_error_message}\n"
                    f"{usage_block}\n\n"
                    "## 전체 로그\n\n" +
                    "\n".join([f"- {log}" for log in failure_logs])
                )
                with engine.lock:
                    run.task_results.append({
                        "title": run.task['title'],
                        "content": failure_content,
                        "model": "분석 실패",
                        "status": "failed",
                        "usage_summary": usage_summary,
                        "logs": failure_logs,
                        "last_error": phase_error_message,
                        "retry_task": build_retry_task_payload(run.task),
                    })
                retry_payload = build_retry_task_payload(run.task)
                if retry_payload:
                    upsert_retry_registry_entry(
                        run.cfg['md_save_path'],
                        run.task['title'],
                        {
                            "status": "failed",
                            "retry_task": retry_payload,
                            "content": failure_content,
                            "usage_summary": usage_summary,
                            "last_error": phase_error_message,
                            "last_logs": failure_logs,
                            "saved_at": int(time.time()),
                        },
                    )
                time.sleep(5)
            finally:
                run.video_cache_scope.close()
                cleanup = run.cfg.get("_task_cleanup")
                if callable(cleanup):
                    try:
                        cleanup()
                    except Exception as cleanup_error:
                        append_status_log(engine.status["logs"], f"AI 사용량 정산 실패: {cleanup_error}")
                try:
                    receipts = merge_settlements(
                        [*prior_settlements((run.resume_state or {}).get("managed_sessions")), *(run.cfg.get("_managed_previous_settlements") or [])],
                        run.cfg.get("_managed_session_records"),
                    )
                    if receipts:
                        saved, path, signature = load_resume_state(run.cfg['md_save_path'], run.task)
                        for result in run.task_results:
                            report_path = result.get("file_path")
                            previous_hash = ((saved or {}).get("summary") or {}).get("saved_report_sha256")
                            update_review_hash = (
                                result.get("status") == "needs_review"
                                and isinstance(previous_hash, str) and bool(previous_hash)
                                and isinstance(report_path, str) and Path(report_path).is_file()
                                and hashlib.sha256(Path(report_path).read_bytes()).hexdigest() == previous_hash
                            )
                            apply_settlements(result, receipts)
                            persist_settlement_result(result, run.cfg['md_save_path'])
                            if update_review_hash and saved:
                                saved["summary"]["saved_report_sha256"] = hashlib.sha256(
                                    Path(report_path).read_bytes()).hexdigest()
                        if saved:
                            saved["managed_sessions"] = receipts
                            save_resume_state(path, signature, saved)
                except Exception as settlement_error:
                    append_status_log(engine.status["logs"], f"서버 정산 표시 저장 실패: {settlement_error}")
                with engine.lock:
                    engine.results_to_collect.extend(run.task_results)
                    engine.current_task_id = None
                    engine.cancel_current_requested = False
                    engine.cancel_current_event.clear()
                    engine.is_paused = False
                    engine.pause_reason = ""
                    engine.pause_event.clear()
                    engine.status["is_running"] = False
                    engine.status["is_paused"] = False
                    engine.status["pause_reason"] = ""
                    engine.status["current_title"] = "대기 중"
                cleanup_files = [f for f in [run.ts_f, run.mp3_f, *run.segment_files] if f]
                if run.task.get('file_path'): cleanup_files.append(run.task['file_path'])
                if run.task.get('pdf_path'): cleanup_files.append(run.task['pdf_path'])
                for f in cleanup_files:
                    if not keep_media_file(run, f):
                        safe_remove(f)
                cleanup_completed_downloads(run, TEMP_DIR_NAME, lambda message: append_status_log(engine.status['logs'], message))
                if run.was_cancelled and not run.preserve_partial_artifacts:
                    for image_dir in run.generated_image_dirs:
                        safe_rmtree(image_dir)
                with engine.lock:
                    if len(engine.active_tasks) <= 1:
                        status_snapshot = slot.get("status") or {}
                        engine._main_status["logs"] = list(status_snapshot.get("logs", []) or [])
                        engine._main_status["debug_events"] = list(status_snapshot.get("debug_events", []) or [])
                    slot["state"] = "cancelled" if run.was_cancelled else "finished"
                    engine.active_tasks.pop(slot.get("id"), None)
                    engine._update_main_status_unlocked()

        finally:
            engine._clear_thread_slot()
