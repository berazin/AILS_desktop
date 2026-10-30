"""Caption selected frame evidence and register its usage before authoring."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from common import (
    append_status_log,
    build_image_dir,
    build_report_path,
    build_usage_event,
    clear_resume_state,
    infer_stt_model_name,
    infer_stt_provider,
    os,
    remove_retry_registry_entry,
    shutil,
)
from task_persistence import (
    build_file_resume_fingerprint,
    save_resume_media,
)
from .video_modes import (
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
    video_visual_event_identity,
)
from .video_analysis import (
    analyze_video,
    hold_video_analysis_cache,
    options_from_config,
)
from .managed_costs import prior_settlements
from .video_segmentation import build_or_load_video_segmentation
from .video_motion import (
    attach_motion_frames,
    load_or_detect_motion_candidates,
    prepare_fallback_motion_frames,
)
from .stt_cleanup import clean_video_stt
from .visual_cache_scheduling import iter_visual_analysis
from .video_segments import (
    prepare_segment_frame_images,
    run_video_segment_analysis,
)
from pipeline_utils import (
    build_timed_source_records,
    create_mp3_file,
    safe_float,
)
from providers import call_stt_with_fallback_silent


"""Analyse video, acquire/transcribe speech and select visual frame evidence."""


def prepare_video_source(run):
    """Analyse video, acquire/transcribe speech and select visual frame evidence."""
    engine = run.engine
    if run.task_type in {"youtube", "eclass_vod", "url"} and not run.resume_media:
        if run.task_type == "eclass_vod":
            run.resume_media = build_file_resume_fingerprint(run.ts_f)
        else:
            run.resume_media = save_resume_media(run.resume_state_path, run.ts_f)
        run.ts_f = run.resume_media["path"]
        run.persist_partial_progress()
    engine.check_cancel_requested()
    run.source_video_path = str(run.ts_f if run.task_type in {"youtube", "eclass_vod", "url"} else run.task.get("video_path") or "").strip()
    if not run.source_video_path:
        raise RuntimeError("영상 파일 경로가 비어 있습니다.")
    if run.task.get('mp3_only'):
        engine.check_cancel_requested()
        append_status_log(engine.status["logs"], "STT 생략 모드: 영상에서 MP3 추출 중...")
        create_mp3_file(run.source_video_path, run.mp3_f, cancel_event=engine.cancel_current_event)
        target_mp3 = os.path.join(
            os.path.dirname(build_report_path(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester)),
            f"{run.safe_title}.mp3",
        )
        shutil.copy(run.mp3_f, target_mp3)
        append_status_log(engine.status["logs"], f"MP3 추출 및 저장 완료: {run.safe_title}.mp3")
        remove_retry_registry_entry(run.cfg['md_save_path'], run.task['title'])
        clear_resume_state(run.resume_state_path, run.cfg['md_save_path'], run.task)
        return True
    run.current_phase = "video_analysis"
    append_status_log(engine.status["logs"], "Media Foundation 영상 분석 시작")

    def report_video_progress(progress):
        engine.check_cancel_requested()
        append_status_log(
            engine.status["logs"],
            "영상 분석 진행: "
            f"{progress.progress * 100:.1f}% "
            f"({format_video_timestamp(progress.current_position_seconds)} / "
            f"{format_video_timestamp(progress.duration_seconds)}, "
            f"장면 {progress.detected_scene_count}개)",
        )

    analysis_options = options_from_config(run.cfg)
    run.video_cache_scope.enter_context(hold_video_analysis_cache(
        run.source_video_path, options=analysis_options,
    ))
    analysis = analyze_video(
        run.source_video_path,
        options=analysis_options,
        cancel_event=engine.cancel_current_event,
        cancel_check=lambda: engine.cancel_current_requested,
        progress_callback=report_video_progress,
    )
    run.video_analysis_result = analysis
    append_status_log(
        engine.status["logs"],
        f"공통 영상 분석 {'캐시 재사용' if analysis.cached else '완료'}: "
        f"{len(analysis.scenes)}개 장면, {analysis.metadata.duration_seconds:.1f}초",
    )
    if not analysis.metadata.has_video:
        raise RuntimeError("영상 스트림이 없는 파일입니다.")

    image_dir_path = build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester)
    run.generated_image_dirs.append(image_dir_path)
    os.makedirs(image_dir_path, exist_ok=True)
    run.image_caps = {}
    run.image_meta = []
    run.img_d_name = run.task['title']

    if analysis.audio is None or not analysis.audio.wav_path:
        run.persist_partial_progress()
        raise RuntimeError(
            "오디오 스트림이 없어 화면 장면 분석은 완료했지만 음성 기반 정리를 생성할 수 없습니다."
        )
    transcript_identity = (
        f"{run.cfg.get('stt_provider', infer_stt_provider(run.cfg))}\0"
        f"{run.cfg.get('stt_model_name', infer_stt_model_name(run.cfg))}"
    )
    with hold_video_transcript_lock(
        analysis.cache_dir,
        transcript_identity,
        engine.check_cancel_requested,
    ):
        cached_transcript = None if run.stt_completed else load_video_transcript(
            analysis.cache_dir,
            transcript_identity,
        )
        if cached_transcript:
            run.transcript = str(cached_transcript.get("transcript") or "")
            run.stt_m = str(cached_transcript.get("model") or "캐시된 STT")
            run.stt_utterances = list(cached_transcript.get("utterances") or [])
            run.stt_duration_seconds = safe_float(cached_transcript.get("duration_seconds"), 0.0)
            if cached_transcript.get("timed_source_records"):
                run.timed_source_records = list(cached_transcript.get("timed_source_records"))
            run.stt_completed = run.has_usable_stt_text()
            if run.stt_completed:
                append_status_log(engine.status["logs"], "공통 영상 STT 캐시를 재사용합니다.")
        if run.stt_completed:
            append_status_log(engine.status["logs"], "이전 STT 결과를 재사용합니다.")
        else:
            run.current_phase = "stt"
            run.transcript, run.stt_m, run.stt_usage, run.stt_utterances, run.stt_duration_seconds = call_stt_with_fallback_silent(
                analysis.audio.wav_path,
                run.cfg,
                engine.status["logs"],
            )
            if not run.has_usable_stt_text():
                raise RuntimeError("STT 결과에 사용할 수 있는 텍스트가 없습니다.")
            run.stt_usage_event = build_usage_event("stt", run.stt_m, run.stt_usage, input_type="audio")
            run.stt_completed = True
            run.stt_completed_in_this_run = True
            save_video_transcript(
                analysis.cache_dir,
                transcript_identity,
                {
                    "transcript": run.transcript,
                    "model": run.stt_m,
                    "utterances": run.stt_utterances,
                    "duration_seconds": run.stt_duration_seconds,
                    "timed_source_records": run.timed_source_records or build_timed_source_records(
                        run.stt_utterances, run.stt_duration_seconds
                    ),
                },
            )
    run.sync_phase_usage_events()
    run.persist_partial_progress()
    engine.check_cancel_requested()
    if run.stt_completed_in_this_run:
        append_status_log(engine.status["logs"], f"STT 완료: 엔진={run.stt_m}, 길이={len(run.transcript):,}자")

    if run.video_mode is not None and not run.task.get('stt_only'):
        # Scene interpretation and the writer must share the
        # same cleaned speech basis. Keep the raw STT for retry.
        if not run.timed_source_records:
            run.timed_source_records = build_timed_source_records(
                run.stt_utterances, run.stt_duration_seconds,
            )
        run.raw_stt_snapshot = {
            "transcript": run.transcript,
            "utterances": list(run.stt_utterances),
            "timed_source_records": list(run.timed_source_records),
        }
        cleanup_call = run.cfg.get("_stt_cleanup_call")
        cleanup_identity_call = run.cfg.get("_stt_cleanup_model_identity")
        if not callable(cleanup_call) or not callable(cleanup_identity_call):
            raise RuntimeError("STT 정제 모델 호출 경로가 없습니다.")
        cleanup_identity = cleanup_identity_call()
        run.cfg["_stt_cleanup_pinned_identity"] = cleanup_identity
        run.cfg["_stt_cleanup_prior_sessions"] = [
            s for s in prior_settlements((run.resume_state or {}).get("managed_sessions"))
            if isinstance(s, dict) and s.get("phase") == "stt_cleanup"
        ]
        try:
            cleaned_utterances, cleanup_usage = clean_video_stt(
                run.timed_source_records, cache_dir=analysis.cache_dir,
                model_identity=json.dumps(cleanup_identity, sort_keys=True),
                model_id=str(cleanup_identity["model_id"]), cleanup_call=cleanup_call,
                cfg=run.cfg, log_list=engine.status["logs"],
                check_cancel=engine.check_cancel_requested,
            )
        except Exception as cleanup_err:
            append_status_log(engine.status["logs"], f"STT 정제 오류 발생으로 원본 STT를 유지하고 분석을 계속합니다: {cleanup_err}")
            cleaned_utterances = run.timed_source_records
            cleanup_usage = []
        run.complete_managed_stage("stt_cleanup")
        run.stt_utterances = cleaned_utterances
        run.timed_source_records = cleaned_utterances
        run.transcript = " ".join(item["text"] for item in cleaned_utterances)
        run.cleanup_usage_events[:] = cleanup_usage
        run.sync_phase_usage_events()
        append_status_log(engine.status["logs"], "정제 STT를 장면 분석·정리 작성·근거 검증의 텍스트 기준으로 사용합니다.")

    if not run.task.get('skip_images') and not run.task.get('stt_only'):
        # 적응형 세그먼트 구성: profile + STT가 모두 준비된 뒤 수행한다.
        if analysis.profile is not None:
            try:
                run.video_segmentation = build_or_load_video_segmentation(
                    analysis,
                    run.stt_utterances,
                    run.video_mode,
                )
            except Exception as error:
                append_status_log(
                    engine.status["logs"],
                    f"적응형 세그먼트 구성 실패: 기존 장면 분석 방식으로 진행합니다. ({error})",
                )
                run.video_segmentation = None
            if run.video_segmentation is not None:
                append_status_log(
                    engine.status["logs"],
                    f"적응형 세그먼트 구성 완료: {len(run.video_segmentation.segments)}개 구간",
                )

        if run.video_segmentation is not None:
            motion_candidates = load_or_detect_motion_candidates(
                analysis, engine.check_cancel_requested,
            )
            attach_motion_frames(
                analysis, run.video_segmentation, motion_candidates, engine.check_cancel_requested,
            )
            run.image_caps, run.image_meta = prepare_segment_frame_images(run.video_segmentation, image_dir_path)
            for frame_meta in run.image_meta:
                frame_meta["source_fingerprint"] = getattr(analysis, "source_fingerprint", "")
                frame_meta["source_path"] = str(Path(run.source_video_path).resolve())
            analyzed_segment_count = sum(
                1 for segment in run.video_segmentation.segments if segment.strategy.analyze
            )
            run.image_completed = True
            run.image_completed_in_this_run = True
            append_status_log(
                engine.status["logs"],
                f"{video_mode_label(run.video_mode)} 세그먼트 프레임 선택 완료: "
                f"분석 구간 {analyzed_segment_count}개, 프레임 {len(run.image_meta)}개",
            )
        else:
            effective_task_type = run.video_mode
            selected_scenes = select_video_scenes(analysis.scenes, effective_task_type)
            for scene in selected_scenes:
                engine.check_cancel_requested()
                image_name = os.path.basename(scene.image_path)
                shutil.copy2(scene.image_path, os.path.join(image_dir_path, image_name))
                timestamp = format_video_timestamp(scene.timestamp_seconds)
                run.image_caps[image_name] = f"영상 장면 {timestamp}"
                run.image_meta.append({
                    "file_name": image_name,
                    "start_time": scene.timestamp_seconds,
                    "end_time": scene.timestamp_seconds,
                    "timestamp": timestamp,
                    "source_fingerprint": getattr(analysis, "source_fingerprint", ""),
                    "source_path": str(Path(run.source_video_path).resolve()),
                })
            run.image_completed = True
            run.image_completed_in_this_run = True
            append_status_log(
                engine.status["logs"],
                f"{video_mode_label(effective_task_type)} 장면 선택 완료: {len(selected_scenes)}개",
            )


def prepare_visual_events(run):
    """Caption selected frame evidence and register its usage before authoring."""
    engine = run.engine
    if run.video_mode is not None and not run.task.get('skip_images') and not run.task.get('stt_only'):
        visual_call = run.cfg.get("_video_vision_call")
        if not callable(visual_call):
            raise RuntimeError("영상 장면 멀티모달 분석기를 찾을 수 없습니다.")
        if run.video_analysis_result is None:
            raise RuntimeError("영상 장면 분석 결과를 찾을 수 없습니다.")
        run.current_phase = "video_visual_analysis"
        if run.video_segmentation is not None:
            run.video_visual_events, run.video_visual_model, segment_usage_events = run_video_segment_analysis(
                run.video_analysis_result,
                run.video_segmentation,
                utterances=run.stt_utterances,
                image_dir_path=build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester),
                visual_call=visual_call,
                cfg=run.cfg,
                log_list=engine.status["logs"],
                check_cancel=engine.check_cancel_requested,
            )
            run.image_usage_events.extend(segment_usage_events)
            for segment_event in run.video_visual_events:
                segment_file_name = str(segment_event.get("file_name") or "")
                meaning = segment_event.get("integrated_meaning")
                if isinstance(meaning, dict):
                    segment_caption = str(meaning.get("summary") or "").strip()
                else:
                    segment_caption = str(meaning or "").strip()
                if segment_file_name and segment_caption and segment_file_name in run.image_caps:
                    run.image_caps[segment_file_name] = segment_caption
            append_status_log(
                engine.status["logs"],
                f"영상 구간 멀티모달 분석 완료: {len(run.video_visual_events)}개 구간",
            )
            run.sync_phase_usage_events()
            run.persist_partial_progress()
        else:
            motion_candidates = load_or_detect_motion_candidates(
                run.video_analysis_result, engine.check_cancel_requested,
            )
            motion_frames_by_scene = prepare_fallback_motion_frames(
                run.video_analysis_result, run.image_meta,
                build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester),
                motion_candidates, engine.check_cancel_requested,
            )
            for meta in run.image_meta:
                name = str(meta.get("file_name") or "")
                if name in motion_frames_by_scene and name not in run.image_caps:
                    run.image_caps[name] = "원본 영상의 짧은 움직임 장면"
            motion_digest_by_scene = {
                name: hashlib.sha256(json.dumps([
                    {key: frame[key] for key in ("timestamp_seconds", "candidate_start",
                                            "candidate_end", "sha256")}
                    for frame in frames], sort_keys=True).encode("utf-8")).hexdigest()
                for name, frames in motion_frames_by_scene.items()
            }
            visual_identity = video_visual_event_identity(
                str(run.cfg.get("_video_vision_identity") or run.cfg.get("video_vision_model_name") or "qwen/qwen3.5-9b"),
                run.stt_utterances,
                language=run.cfg.get("language") or "korean",
            )
            cached_events = load_video_visual_events(run.video_analysis_result.cache_dir, visual_identity)
            event_by_name = {
                name: event for name, event in cached_events.items()
                if name in run.image_caps and event.get("motion_input_digest")
                == motion_digest_by_scene.get(name)
            }
            run.video_visual_model = next(
                (str(event.get("model") or "") for event in event_by_name.values() if event.get("model")),
                "",
            )
            missing_meta = [
                item for item in run.image_meta
                if str(item.get("file_name") or "") not in event_by_name
            ]
            if event_by_name:
                append_status_log(
                    engine.status["logs"],
                    f"영상 장면 멀티모달 캐시 재사용: {len(event_by_name)}개",
                )

            def analyze_visual_event(meta):
                image_name = str(meta.get("file_name") or "")
                timestamp_seconds = safe_float(meta.get("start_time"), 0.0)
                motion_frames = motion_frames_by_scene.get(image_name) or []
                speech_items = None
                if motion_frames:
                    motion_start = min(frame["candidate_start"] for frame in motion_frames)
                    motion_end = max(frame["candidate_end"] for frame in motion_frames)
                    speech_items = [utterance for utterance in run.stt_utterances
                                    if isinstance(utterance, dict)
                                    and safe_float(utterance.get("end"), 0) >= motion_start
                                    and safe_float(utterance.get("start"), 0) <= motion_end]
                    speech_items = speech_items or None
                messages, response_format = build_video_visual_event_messages(
                    os.path.join(build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester), image_name),
                    timestamp_seconds=timestamp_seconds,
                    speech_context=select_video_speech_context(run.stt_utterances, timestamp_seconds),
                    language=run.cfg.get('language'),
                    ordered_frames=motion_frames,
                    speech_items=speech_items,
                )
                last_error = None
                for attempt in range(1, 4):
                    engine.check_cancel_requested()
                    try:
                        raw_content, model_name, call_usage = visual_call(
                            messages,
                            run.cfg,
                            engine.status["logs"],
                            response_format=response_format,
                        )
                        event = parse_video_visual_event(raw_content, timestamp_seconds, image_name)
                        event["model"] = str(model_name or "")
                        if motion_frames:
                            event["motion_input_digest"] = motion_digest_by_scene[image_name]
                            event["start_seconds"] = min(frame["candidate_start"] for frame in motion_frames)
                            event["end_seconds"] = max(frame["candidate_end"] for frame in motion_frames)
                        return event, model_name, call_usage
                    except Exception as error:
                        last_error = error
                        if attempt < 3:
                            append_status_log(
                                engine.status["logs"],
                                f"영상 장면 형식/응답 재시도 {attempt + 1}/3: {image_name}",
                            )
                raise RuntimeError(f"영상 장면 분석 실패({image_name}): {last_error}") from last_error

            if missing_meta:
                concurrency = max(1, min(8, int(run.cfg.get("video_vision_concurrency") or 4)))
                append_status_log(
                    engine.status["logs"],
                    f"영상 장면 멀티모달 분석 시작: {len(missing_meta)}개, 동시 {concurrency}개",
                )
                results = iter_visual_analysis(
                    missing_meta, analyze_visual_event,
                    model_identity=str(run.cfg.get("_video_vision_identity") or run.cfg.get("video_vision_model_name") or ""),
                    concurrency=concurrency, check_cancel=engine.check_cancel_requested,
                    log_list=engine.status["logs"],
                )
                for completed, (_item, result) in enumerate(results, 1):
                    event, model_name, call_usage = result
                    image_name = str(event.get("file_name") or "")
                    event_by_name[image_name] = event
                    run.video_visual_model = str(model_name or run.video_visual_model)
                    run.image_usage_events.append(
                        build_usage_event("video_visual", model_name, call_usage, input_type="image")
                    )
                    save_video_visual_events(
                        run.video_analysis_result.cache_dir,
                        visual_identity,
                        event_by_name,
                    )
                    cache_hits = (call_usage or {}).get("prompt_cache_hit_tokens")
                    append_status_log(
                        engine.status["logs"],
                        f"영상 장면 멀티모달 분석 진행: {completed}/{len(missing_meta)}"
                        + (f", 공급자 캐시 읽기 {int(cache_hits):,} 토큰" if cache_hits is not None
                           else ", 공급자 캐시 사용량 미보고"),
                    )
            run.video_visual_events = deduplicate_visual_events(list(event_by_name.values()))
            for event in run.video_visual_events:
                if event.get("duplicate_of"):
                    run.image_caps.pop(str(event.get("file_name") or ""), None)
                    continue
                image_name = str(event.get("file_name") or "")
                caption = str((event.get("integrated_meaning") or {}).get("summary") or "").strip()
                if image_name and caption:
                    run.image_caps[image_name] = caption
            duplicate_count = sum(bool(event.get("duplicate_of")) for event in run.video_visual_events)
            append_status_log(
                engine.status["logs"],
                f"영상 장면 멀티모달 분석 완료: {len(run.video_visual_events)}개, 의미 중복 {duplicate_count}개",
            )
            run.sync_phase_usage_events()
            run.persist_partial_progress()
