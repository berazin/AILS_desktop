"""Reuse or download/remux the authenticated LMS media source."""

from __future__ import annotations

from common import (
    FIRST_COMPLETED,
    MAX_WORKERS,
    TEMP_DIR_NAME,
    ThreadPoolExecutor,
    append_status_log,
    os,
    shutil,
    wait,
)
from task_persistence import build_file_resume_fingerprint
from .media_temp_cleanup import prepare_download_dir, owned_download_dir
from .lms_media_cache import (
    find_lms_video,
    save_lms_video,
)
from pipeline_utils import (
    TaskCancelledError,
    download_authenticated_web_media,
    download_youtube_media,
    download_segment,
    run_subprocess_with_cancel,
)


def prepare_eclass_source(run):
    """Reuse or download/remux the authenticated LMS media source."""
    engine = run.engine
    # A retry may use durable media and still own the previous download folder.
    previous_dir = owned_download_dir((run.resume_state or {}).get('download_dir'), TEMP_DIR_NAME, run.task_type)
    if previous_dir and previous_dir.is_dir():
        run.download_dir = str(previous_dir)
        run.media_temp_dirs.append(str(previous_dir))
    if run.task_type == "eclass_vod" and run.resume_media:
        run.ts_f = save_lms_video(run.task["vod_url"], run.resume_media["path"])
        run.resume_media = build_file_resume_fingerprint(run.ts_f)
        append_status_log(engine.status["logs"], "저장된 LMS 영상을 재사용합니다.")
    elif run.task_type == "eclass_vod" and (cached_video := find_lms_video(run.task["vod_url"])):
        run.ts_f = cached_video
        run.resume_media = build_file_resume_fingerprint(run.ts_f)
        append_status_log(engine.status["logs"], "영구 저장된 LMS 영상을 재사용합니다.")
    elif run.task_type in {"youtube", "eclass_vod", "url"} and run.resume_media:
        run.ts_f = run.resume_media["path"]
        append_status_log(engine.status["logs"], "이전 실행에서 다운로드한 영상을 재사용합니다.")
    elif run.task_type in {"youtube", "eclass_vod"}:
        engine.check_cancel_requested()
        media_dir = prepare_download_dir(run, TEMP_DIR_NAME, _build_media_temp_dir(run.task_type, run.run_id))
        if run.task_type == "youtube":
            run.current_phase = "media_download"
            media_path, detected_title = download_youtube_media(
                run.task["youtube_url"], media_dir, run.task["title"],
                cancel_event=engine.cancel_current_event,
                log_list=engine.status["logs"],
            )
        else:
            run.current_phase = "lms_media_discovery"
            ensure_authenticated = run.cfg.get("_lms_ensure_authenticated")
            if callable(ensure_authenticated):
                ensure_authenticated(run.task["vod_url"], cancel_event=engine.cancel_current_event)
            engine.check_cancel_requested()
            media_path, detected_title = download_authenticated_web_media(
                run.task["vod_url"], media_dir, run.task["title"],
                source_label="e-class VOD",
                cancel_event=engine.cancel_current_event,
                log_list=engine.status["logs"],
            )
            media_path = save_lms_video(run.task["vod_url"], media_path)
            run.current_phase = "media_download"
        run.segment_files.append(media_path)
        run.ts_f = media_path
        if detected_title:
            append_status_log(engine.status["logs"], f"영상 제목 감지: {detected_title}")

    elif run.task_type == "url":
        engine.check_cancel_requested()
        run.current_phase = "media_download"
        append_status_log(
            engine.status["logs"],
            f"세그먼트 다운로드 시작: {run.task['start']}~{run.task['end']} ({run.task['end'] - run.task['start'] + 1}개)",
        )
        segment_tasks = [
            (run.task['url'].replace("(*)", str(i)), os.path.join(TEMP_DIR_NAME, f"s_{run.run_id}_{i}.ts"))
            for i in range(run.task['start'], run.task['end'] + 1)
        ]
        run.segment_files.extend(path for _, path in segment_tasks)
        os.makedirs(TEMP_DIR_NAME, exist_ok=True)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(download_segment, link, path, engine.cancel_current_event): (link, path) for link, path in segment_tasks}
            pending_futures = set(futures)
            failed_urls = []
            while pending_futures:
                engine.check_cancel_requested()
                done, pending_futures = wait(pending_futures, timeout=0.2, return_when=FIRST_COMPLETED)
                for future in done:
                    link, path = futures[future]
                    try:
                        result_path = future.result()
                        if result_path is None or not os.path.exists(path):
                            failed_urls.append(link)
                    except Exception:
                        failed_urls.append(link)
                if engine.cancel_current_event.is_set():
                    for future in pending_futures:
                        future.cancel()
                    raise TaskCancelledError("사용자 요청으로 현재 작업이 취소되었습니다.")
        if failed_urls:
            raise RuntimeError(f"세그먼트 다운로드 실패: {len(failed_urls)}개")
        append_status_log(engine.status["logs"], f"세그먼트 다운로드 완료: {len(segment_tasks)}개")
        with open(run.ts_f, 'wb') as output:
            for _, path in segment_tasks:
                with open(path, 'rb') as source:
                    shutil.copyfileobj(source, output)
        append_status_log(engine.status["logs"], "세그먼트 병합 완료")
        merged_ts_path = run.ts_f
        remuxed_path = f"temp_{run.run_id}.mp4"
        run.segment_files.append(merged_ts_path)
        run.segment_files.append(remuxed_path)
        run.current_phase = "media_remux"
        run_subprocess_with_cancel(
            [run.ffmpeg_path, "-y", "-i", merged_ts_path, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", remuxed_path],
            cancel_event=engine.cancel_current_event,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        run.ts_f = remuxed_path
        append_status_log(engine.status["logs"], "세그먼트 영상을 공통 분석 형식으로 변환했습니다.")


def _build_media_temp_dir(task_type: str, run_id: str) -> str:
    prefix = {"youtube": "youtube", "eclass_vod": "eclass_vod"}.get(task_type, "media")
    return os.path.join(TEMP_DIR_NAME, f"{prefix}_{run_id}")
