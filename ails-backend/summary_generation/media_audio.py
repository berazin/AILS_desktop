"""Acquire audio/PDF worker results, preserving cancellation and MP3-only completion."""

from __future__ import annotations

from .task_media_workers import (
    raise_phase_error,
    wrap_worker_phase_error,
)
from common import (
    ThreadPoolExecutor,
    append_status_log,
    as_completed,
    build_report_path,
    build_usage_event,
    os,
    shutil,
    time,
)
from pipeline_utils import create_mp3_file


def prepare_audio_source(run, run_pdf_image_task, run_stt_task):
    """Acquire audio/PDF worker results, preserving cancellation and MP3-only completion."""
    engine = run.engine
    engine.check_cancel_requested()
    source_audio_path = run.task['file_path']
    append_status_log(engine.status["logs"], f"입력 오디오 준비 완료: {os.path.basename(source_audio_path)}")
    if run.task.get('pdf_path'):
        append_status_log(engine.status["logs"], f"보조 PDF 감지: {os.path.basename(run.task['pdf_path'])}")

    if run.task.get('mp3_only'):
        engine.check_cancel_requested()
        append_status_log(engine.status["logs"], "STT 생략 모드: 오디오를 MP3로 변환 중...")
        create_mp3_file(source_audio_path, run.mp3_f, cancel_event=engine.cancel_current_event)
        engine.check_cancel_requested()
        target_mp3 = os.path.join(os.path.dirname(build_report_path(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester)), f"{run.safe_title}.mp3")
        shutil.copy(run.mp3_f, target_mp3)
        append_status_log(engine.status["logs"], f"MP3 추출 및 저장 완료: {run.safe_title}.mp3")
        time.sleep(2)
        return True

    engine.check_cancel_requested()
    append_status_log(engine.status["logs"], "오디오 STT 분석 시작")
    if run.task.get('pdf_path'):
        missing_steps = []
        if not run.image_completed:
            missing_steps.append("PDF 이미지 분석")
        if not run.stt_completed:
            missing_steps.append("STT")
        if missing_steps:
            append_status_log(
                engine.status["logs"],
                f"이번 실행에서는 {' + '.join(missing_steps)}만 진행합니다."
            )
        else:
            append_status_log(
                engine.status["logs"],
                "이전 실행의 STT와 이미지 분석 결과가 모두 있어 요약 단계로 바로 이동합니다."
            )

        future_map = {}
        image_error = None
        stt_error = None
        if not run.image_completed or not run.stt_completed:
            with ThreadPoolExecutor(max_workers=max(1, int((not run.image_completed) + (not run.stt_completed)))) as executor:
                if not run.image_completed:
                    future_map[executor.submit(run_pdf_image_task)] = "image"
                if not run.stt_completed:
                    future_map[executor.submit(run_stt_task, source_audio_path)] = "stt"
                for future in as_completed(future_map):
                    role = future_map[future]
                    try:
                        result = future.result()
                        if role == "image":
                            run.image_caps, run.img_d_name, run.image_usage_events, run.image_meta = result
                            run.image_usage_events = [event for event in run.image_usage_events if event]
                            run.image_completed = True
                            run.image_completed_in_this_run = True
                        else:
                            run.transcript, run.stt_m, run.stt_usage, run.stt_utterances, run.stt_duration_seconds = result
                            if not run.has_usable_stt_text():
                                raise RuntimeError("STT 결과에 사용할 수 있는 텍스트가 없습니다.")
                            run.stt_usage_event = build_usage_event("stt", run.stt_m, run.stt_usage, input_type="audio")
                            run.stt_completed = True
                            run.stt_completed_in_this_run = True
                    except Exception as error:
                        phase_error = wrap_worker_phase_error(error, role)
                        if role == "image":
                            image_error = phase_error
                        else:
                            stt_error = phase_error
                        continue
                    run.sync_phase_usage_events()
                    run.persist_partial_progress()
            raise_phase_error(image_error=image_error, stt_error=stt_error)
        engine.check_cancel_requested()
    else:
        run.image_caps, run.img_d_name, run.image_meta = {}, "", []
        if run.stt_completed:
            append_status_log(engine.status["logs"], "이전 실행의 STT 결과를 재사용해 STT 호출을 건너뜁니다.")
        else:
            run.current_phase = "stt"
            run.transcript, run.stt_m, run.stt_usage, run.stt_utterances, run.stt_duration_seconds = engine.run_stt_with_audio_cleanup_fallback(
                source_audio_path,
                run.mp3_f,
                run.cfg,
                engine.status["logs"],
            )
            if not run.has_usable_stt_text():
                raise RuntimeError("STT 결과에 사용할 수 있는 텍스트가 없습니다.")
            run.stt_usage_event = build_usage_event("stt", run.stt_m, run.stt_usage, input_type="audio")
            run.stt_completed = True
            run.stt_completed_in_this_run = True
            run.sync_phase_usage_events()
            run.persist_partial_progress()
    engine.check_cancel_requested()
    if run.stt_completed_in_this_run:
        append_status_log(engine.status["logs"], f"STT 완료: 엔진={run.stt_m}, 길이={len(run.transcript):,}자")
