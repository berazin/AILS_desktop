"""Source preparation, STT and visual evidence acquisition."""

from __future__ import annotations

from .media_sources import _build_media_temp_dir
from .media_video import prepare_visual_events
from .media_audio import prepare_audio_source
from .media_video import prepare_video_source
from .media_sources import prepare_eclass_source
from .task_media_workers import create_media_workers
from common import (
    append_status_log,
    build_report_path,
    build_usage_markdown,
    clear_resume_state,
    remove_retry_registry_entry,
    time,
)
from voice.deepgram_transcript import collapse_deepgram_repeated_views
from .managed_costs import usage_cost_sources
from pipeline_utils import (
    build_timed_source_records,
    collapse_exact_repeated_utterance_blocks,
    collapse_exact_repeated_whole_text,
)


def prepare_task_media(run):
    """Acquire media, restore/transcribe speech and prepare visual evidence.

    True means an MP3/STT-only request finished without a summary.
    """
    engine = run.engine
    finalize_image_analysis, run_pdf_image_task, run_stt_task = create_media_workers(
        run=run,
    )



    prepare_eclass_source(run)

    if run.video_mode is not None:
        if prepare_video_source(run):
            return True

    elif run.task['type'] == 'audio':
        if prepare_audio_source(run, run_pdf_image_task, run_stt_task):
            return True
    else:
        raise ValueError(f"Unsupported summary task type: {run.task.get('type', '')}")

    if "deepgram" in str(run.stt_m or "").casefold():
        repaired_transcript, repeated_views = collapse_deepgram_repeated_views(
            run.transcript,
            run.stt_utterances,
        )
        if repeated_views > 1:
            run.transcript = repaired_transcript
            append_status_log(
                engine.status["logs"],
                f"Deepgram 구버전 중복 원문 {repeated_views}개 표현 감지: 한 번만 유지합니다.",
            )

    collapsed_transcript, transcript_repetitions = collapse_exact_repeated_whole_text(run.transcript)
    if transcript_repetitions > 1:
        run.transcript = collapsed_transcript
        append_status_log(
            engine.status["logs"],
            f"STT 전체 반복 {transcript_repetitions}회 감지: 첫 블록만 유지합니다. "
            f"({len(collapsed_transcript):,}자)",
        )
    collapsed_utterances, utterance_repetitions = collapse_exact_repeated_utterance_blocks(
        run.stt_utterances
    )
    if utterance_repetitions > 1:
        run.stt_utterances = collapsed_utterances
        append_status_log(
            engine.status["logs"],
            f"STT 타임스탬프 발화 전체 반복 {utterance_repetitions}회 감지: 첫 블록만 유지합니다.",
        )
    if not run.timed_source_records:
        run.timed_source_records = build_timed_source_records(
            run.stt_utterances, run.stt_duration_seconds
        )
    if run.stt_completed:
        run.persist_partial_progress()

    prepare_visual_events(run)

    if run.task.get('stt_only'):
        engine.check_cancel_requested()
        append_status_log(engine.status["logs"], "요약 생략 모드: STT 원문 저장 중...")
        engine_line = f"**STT 엔진:** `{run.stt_m}`"
        usage_block, usage_summary = build_usage_markdown(run.usage_events, engine_line=engine_line)
        usage_summary["byok_cost_sources"] = usage_cost_sources(run.usage_events)
        run.full_md = f"# 📄 {run.task['title']} STT 원문\n\n{usage_block}\n\n{run.transcript}"

        stt_output_path = build_report_path(run.cfg['md_save_path'], run.task['title'], "_STT원문.md", grade=run.task_grade, semester=run.task_semester)
        with open(stt_output_path, 'w', encoding='utf-8', errors='replace') as f:
            f.write(run.full_md)

        with engine.lock:
            run.task_results.append({
                "title": f"{run.task['title']} (원문)",
                "content": run.full_md,
                "model": f"STT({run.stt_m})",
                "file_path": stt_output_path,
                "status": "success",
                "usage_summary": usage_summary
            })
        remove_retry_registry_entry(run.cfg['md_save_path'], run.task['title'])
        clear_resume_state(run.resume_state_path, run.cfg['md_save_path'], run.task)
        append_status_log(engine.status["logs"], "STT 원문 추출 완료")
        time.sleep(2)
        return True

    return False
