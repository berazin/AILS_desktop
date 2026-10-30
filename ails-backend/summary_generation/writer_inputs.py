"""Pin models and budgets, build evidence chunks and initialise the draft ledger."""

from __future__ import annotations

import json
import hashlib
from common import (
    PROVIDER_CUSTOM,
    PROVIDER_DEEPSEEK,
    append_status_log,
    get_custom_feature_values,
    get_effective_feature_model_name,
    infer_summary_model_name,
    infer_summary_provider,
)
from .claim_verification import (
    DEEPSEEK_SINGLE_SUMMARY_MODEL,
    validate_luna_verification_config,
)
from .video_modes import (
    DETAILED_TASK,
    SUMMARY_TASK,
    attach_visual_events_to_chunks,
    video_writer_source_contract,
)
from pipeline_utils import (
    SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS,
    video_request_working_limit,
    build_summary_resume_identity,
    build_summary_transcript_text,
    build_timed_summary_chunks,
    load_summary_resume_progress,
)


def prepare_writer_inputs(run):
    """Pin models and budgets, build evidence chunks and initialise the draft ledger."""
    engine = run.engine
    engine.check_cancel_requested()
    append_status_log(engine.status["logs"], "AI 요약 집필 준비 중...")
    run.complete_managed_stage("video_visual")
    run.complete_managed_stage("image_analysis")
    run.current_phase = "summary"
    verification_enabled = run.cfg.get("summary_verification_enabled", True)
    if isinstance(verification_enabled, str):
        run.concept_review_enabled = verification_enabled.strip().lower() not in {
            "0",
            "false",
            "no",
            "off",
            "",
        }
    else:
        run.concept_review_enabled = bool(verification_enabled)
    run.verified_single_pipeline = run.video_mode is not None or run.concept_review_enabled
    summary_selection = run.cfg.get("_summary_model_selection") or {}
    verification_selection = run.cfg.get("_video_verification_selection") or {}
    if run.video_mode is not None:
        summary_identity_call = run.cfg.get("_summary_model_identity")
        if not callable(summary_identity_call):
            raise RuntimeError("정리 작성 모델 식별 경로가 없습니다.")
        run.cfg["_summary_pinned_identity"] = summary_identity_call()
        verification_identity_call = run.cfg.get("_video_verification_model_identity")
        if not callable(verification_identity_call):
            raise RuntimeError("검증 모델 식별 경로가 없습니다.")
        run.cfg["_video_verification_prechecked_identity"] = verification_identity_call()
    run.video_writer_limit = video_request_working_limit(
        str((run.cfg.get("_summary_pinned_identity") or {}).get("model_id")
            or summary_selection.get("modelId") or run.cfg.get("summary_model_name") or "")
    )
    run.video_verifier_limit = video_request_working_limit(
        str((run.cfg.get("_video_verification_prechecked_identity") or {}).get("model_id")
            or verification_selection.get("modelId") or run.cfg.get("summary_verification_model_name") or "")
    )
    if run.verified_single_pipeline:
        if run.video_mode is not None and not callable(run.cfg.get("_video_verification_tools_call")):
            validate_luna_verification_config(run.cfg)
        single_transcript = build_summary_transcript_text(
            run.transcript,
            run.stt_utterances,
            run.stt_duration_seconds,
        )
        run.chunks = build_timed_summary_chunks(
            run.transcript,
            run.timed_source_records,
            run.stt_duration_seconds,
            one_shot_max_input_tokens=run.video_writer_limit if run.video_mode is not None else SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS,
        )
        append_status_log(
            engine.status["logs"],
            "선택한 정리 모델로 작성한 뒤 선택한 근거 검증 모델로 확인합니다.",
        )
    else:
        append_status_log(engine.status["logs"], "입력 길이에 맞춰 요약 방식을 선택합니다.")
        summary_provider_for_chunking = infer_summary_provider(run.cfg)
        one_shot_max_input_tokens = run.video_writer_limit
        run.chunks = build_timed_summary_chunks(
            run.transcript,
            run.stt_utterances,
            run.stt_duration_seconds,
            one_shot_max_input_tokens=one_shot_max_input_tokens,
        )
    if not run.chunks:
        raise RuntimeError("요약에 사용할 STT 텍스트가 없습니다.")
    if run.video_visual_events:
        run.chunks = attach_visual_events_to_chunks(run.chunks, run.video_visual_events)
        append_status_log(
            engine.status["logs"],
            "영상 시각 이벤트를 시간대별 STT 요약 입력에 연결했습니다.",
        )
    if run.verified_single_pipeline:
        append_status_log(
            engine.status["logs"],
            f"검증용 요약 입력 준비 완료: {len(run.chunks)}개 구간",
        )
    else:
        append_status_log(engine.status["logs"], f"요약 청크 준비 완료: {len(run.chunks)}개")
        if len(run.chunks) == 1 and isinstance(run.chunks[0], dict) and run.chunks[0].get("one_shot"):
            append_status_log(
                engine.status["logs"],
                "요약 모드: 단일 요청 "
                f"(예상 입력 {int(run.chunks[0].get('estimated_input_tokens') or 0):,}토큰)",
            )
        else:
            append_status_log(engine.status["logs"], "요약 모드: 분할 요청")
    run.usage_placeholder = "<<<AI_USAGE_PLACEHOLDER>>>"
    hidden_source_meta = ""
    if run.task.get("type") in {"url", "youtube", "eclass_vod"}:
        source_url = str(run.task.get("youtube_url") or run.task.get("vod_url") or run.task.get("url", "") or "").strip()
        if source_url:
            hidden_source_meta = f"<!-- AILS_SOURCE_URL: {source_url} -->\n"
    report_title = run.task['title'] if run.task_type in {DETAILED_TASK, SUMMARY_TASK, 'eclass_vod'} else f"{run.task['title']} {'상세' if run.video_mode == DETAILED_TASK else '요약'}"
    run.full_md = f"{hidden_source_meta}# 📚 {report_title}\n\n{run.usage_placeholder}\n\n"
    run.roll_s = ""
    run.bookmark_text = "시작"
    run.last_m = "N/A"
    run.summary_claims = []
    run.verification_source_records = []
    run.verification_image_records = []
    run.summary_body_for_verification = ""
    run.used_images_set = set()
    from system_storage import canonical_system_name
    run.image_link_dir = f".images/{canonical_system_name(str(run.image_dir_name or ''))}"
    run.resolved_summary_provider = run.cfg.get("summary_provider", infer_summary_provider(run.cfg))
    run.resolved_summary_model_name = get_effective_feature_model_name(
        run.cfg,
        "summary",
        infer_summary_model_name(run.cfg),
    )
    if run.verified_single_pipeline:
        selection = run.cfg.get("_summary_model_selection")
        if callable(run.cfg.get("_managed_summary_call")) and isinstance(selection, dict):
            run.resolved_summary_provider = str(selection.get("provider") or "AILS")
            shared = run.cfg.get("_managed_summary_session")
            run.resolved_summary_model_name = str(
                selection.get("modelId")
                or (shared.get("model_id") if isinstance(shared, dict) else "")
                or "AILS 기본 모델"
            )
        else:
            run.resolved_summary_provider = PROVIDER_DEEPSEEK
            run.resolved_summary_model_name = str(run.cfg.get("summary_model_name") or DEEPSEEK_SINGLE_SUMMARY_MODEL)
    run.has_timed_image_meta = any(
        isinstance(item, dict)
        and (item.get("start_time") is not None or item.get("end_time") is not None)
        for item in (run.image_meta or [])
    )
    run.timed_image_matching_enabled = bool(
        run.image_caps
        and run.has_timed_image_meta
        and any(isinstance(chunk, dict) and chunk.get("timed") for chunk in run.chunks)
    )
    if run.image_caps and run.verified_single_pipeline and len(run.chunks) == 1:
        append_status_log(
            engine.status["logs"],
            f"단일 정리 모드: 이미지 캡션 {len(run.image_caps)}개를 전체 강의 입력에 함께 전달합니다.",
        )
    elif run.image_caps and run.timed_image_matching_enabled:
        append_status_log(
            engine.status["logs"],
            "요약 모드: STT/이미지 타임스탬프 기반으로 청크별 관련 이미지만 전달합니다. "
            "padding=5초, 청크당 최대 20장, 가까운 이미지 보강 없음, 첫 청크 전체 전달 없음",
        )
    elif run.image_caps:
        append_status_log(
            engine.status["logs"],
            "요약 모드: 타임스탬프 매칭 정보가 부족해 청크당 최대 20장씩 이미지 후보를 전달합니다. "
            "첫 청크 전체 전달 없음",
        )

    append_status_log(
        engine.status["logs"],
        f"요약 엔진 준비: provider={run.resolved_summary_provider}, selected={run.cfg.get('summary_model_name', '')}, effective={run.resolved_summary_model_name}",
    )
    if run.resolved_summary_provider == PROVIDER_CUSTOM:
        custom_summary_endpoint, custom_summary_model_name, custom_summary_api_key = get_custom_feature_values(run.cfg, "summary")
        append_status_log(
            engine.status["logs"],
            f"Custom 요약 설정: endpoint={custom_summary_endpoint}, model={custom_summary_model_name or '미설정'}, api_key={'설정됨' if custom_summary_api_key else '없음'}",
        )

    run.summary_resume_identity = build_summary_resume_identity(
        transcript=single_transcript if run.verified_single_pipeline else build_summary_transcript_text(
            run.transcript, run.stt_utterances, run.stt_duration_seconds
        ),
        image_captions=run.image_caps,
        prompt_template=run.task.get('prompt_template', run.cfg['prompt_template']),
        content_instruction=run.video_content_instruction + (
            "\nwriter_reasoning=" + str(run.cfg["summary_reasoning_effort"])
            if run.cfg.get("summary_reasoning_effort", "none") != "none" else ""),
        provider=run.resolved_summary_provider,
        model_name=run.resolved_summary_model_name,
        language=run.cfg.get('language'),
        verification_enabled=run.concept_review_enabled,
        source_contract=(video_writer_source_contract(run.timed_source_records, run.video_visual_events)
            if run.video_mode is not None else
            "timed-utterances-v1:" + hashlib.sha256(
                json.dumps(run.timed_source_records, ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest() if run.verified_single_pipeline and run.timed_source_records else
            "untimed-source-v1" if run.verified_single_pipeline else ""),
    )
    run.saved_summary_progress = load_summary_resume_progress(
        run.resume_state,
        run.summary_resume_identity,
        total_chunks=len(run.chunks),
    )
