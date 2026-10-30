"""Independent PDF image/STT workers and completed-result registration."""

from __future__ import annotations

from pipeline_utils import TaskCancelledError
from common import (
    append_status_log,
    build_image_dir,
    build_usage_event,
)
from providers import (
    apply_penultimate_duplicate_representatives,
    extract_pdf_pages,
    generate_image_captions_silent,
    review_image_duplicates_with_summary_model,
)


def create_media_workers(*, run):
    engine = run.engine
    """Independent PDF image/STT workers and completed-result registration."""
    def finalize_image_analysis(
        image_names,
        image_dir_path,
        task_image_meta,
        image_source_label,
        allow_duplicate_detection=True,
    ):
        image_captions = {}
        image_usage = []
        filtered_image_meta = list(task_image_meta or [])
        all_duplicate_records = []
        if image_names:
            image_config = run.cfg if allow_duplicate_detection else {**run.cfg, "disable_image_duplicate_detection": True}
            image_captions, image_usage, duplicate_records = generate_image_captions_silent(
                image_names,
                image_dir_path,
                image_config,
                engine.status["logs"],
            )
            if allow_duplicate_detection and duplicate_records:
                all_duplicate_records.extend(duplicate_records)
        if image_names and allow_duplicate_detection:
            try:
                captions_before_final_duplicate_review = dict(image_captions)
                (
                    image_captions,
                    final_duplicate_records,
                    final_duplicate_usage,
                    final_duplicate_model,
                ) = review_image_duplicates_with_summary_model(
                    image_names,
                    image_captions,
                    run.cfg,
                    engine.status["logs"],
                )
                if final_duplicate_usage:
                    image_usage.append(
                        build_usage_event(
                            "image",
                            final_duplicate_model,
                            final_duplicate_usage,
                            input_type="text",
                        )
                    )
                if final_duplicate_records:
                    all_duplicate_records.extend(final_duplicate_records)
                    merged_captions = dict(captions_before_final_duplicate_review)
                    merged_captions.update(image_captions)
                    image_captions = merged_captions
            except Exception as error:
                append_status_log(
                    engine.status["logs"],
                    f"이미지 최종 중복 검사 실패: 기존 이미지 분석 결과로 계속 진행합니다. ({error})",
                )
        if allow_duplicate_detection and all_duplicate_records:
            image_captions, filtered_image_meta, _representative_records = apply_penultimate_duplicate_representatives(
                image_names,
                image_captions,
                filtered_image_meta,
                all_duplicate_records,
                engine.status["logs"],
            )
        append_status_log(engine.status["logs"], f"{image_source_label} 이미지 분석 완료: {len(image_captions)}개 캡션")
        return image_captions, image_usage, filtered_image_meta

    def run_pdf_image_task():
        image_dir_path = build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester)
        run.generated_image_dirs.append(image_dir_path)
        append_status_log(engine.status["logs"], "PDF 페이지 이미지 추출 중...")
        image_names, _, task_image_meta = extract_pdf_pages(
            run.task['pdf_path'],
            image_dir_path,
            pdf_password=str(run.task.get('pdf_password', '') or ''),
            cancel_check=engine.check_cancel_requested,
        )
        append_status_log(engine.status["logs"], f"PDF 페이지 추출 완료: {len(image_names)}쪽")
        image_captions, image_usage, filtered_image_meta = finalize_image_analysis(
            image_names,
            image_dir_path,
            task_image_meta,
            "PDF",
            allow_duplicate_detection=False,
        )
        return image_captions, run.task['title'], image_usage, filtered_image_meta

    def run_stt_task(source_media_path):
        return engine.run_stt_with_audio_cleanup_fallback(
            source_media_path,
            run.mp3_f,
            run.cfg,
            engine.status["logs"],
        )

    return finalize_image_analysis, run_pdf_image_task, run_stt_task


def raise_phase_error(image_error=None, stt_error=None):
    if image_error and stt_error:
        raise RuntimeError(
            f"이미지 분석과 STT가 모두 실패했습니다. 이미지 분석: {image_error} / STT: {stt_error}"
        )
    if image_error:
        raise image_error
    if stt_error:
        raise stt_error


def wrap_worker_phase_error(error, role):
    if isinstance(error, TaskCancelledError):
        return error
    phase_for_role = "image_analysis" if role == "image" else "stt"
    if "[phase:" in str(error):
        return error
    return RuntimeError(f"[phase:{phase_for_role}] {error}")
