"""Verification request/replay lifecycle, paid responses and edit application."""

from __future__ import annotations

from .verification_checkpoint import prepare_verification_checkpoint
from .verification_replay import replay_verification_rounds
from .verification_receipts import create_verification_receipt_callbacks
from .verification_contract import create_verification_result_validators
from .verification_tools import create_verification_tool_executor
import json
import hashlib
from common import (
    append_status_log,
    build_image_dir,
    re,
)
from .claim_verification import (
    VERIFICATION_REGISTERED_JSON_SCHEMA,
    apply_verification_edits,
    build_verification_prompt,
)
from .integrated_chunk_verification import (
    CONCEPT_REVIEW_JSON_SCHEMA,
    CONCEPT_ONLY_JSON_SCHEMA,
    FIDELITY_COMPARISON_JSON_SCHEMA,
    LEGACY_FIDELITY_COMPARISON_JSON_SCHEMA,
    INTEGRATED_CHUNK_JSON_SCHEMA,
    UnsafeWebCitation,
    VerificationInputBudgetExceeded,
    apply_integrated_chunk_edits,
    apply_concept_only_edits,
    apply_fidelity_comparison_edits,
    build_cross_chunk_contradiction_prompt,
    build_integrated_chunk_prompt,
    build_concept_only_prompt,
    build_fidelity_comparison_prompt,
)
from .verification_evidence import (
    VerificationClaimRegistry,
    VerificationEvidenceLookup,
    is_safe_verification_correction_message,
    verification_correction_message,
    verification_lookup_limits,
)
from .video_modes import DETAILED_TASK
from ai_request_limits import (
    AI_REQUEST_MAX_INPUT_TOKENS,
    estimate_request_tokens,
)
from pipeline_utils import (
    estimate_token_count,
    video_request_working_limit,
    summary_prompt_exceeds_input_budget,
)
from .verification_contract import (
    CONCEPT_REVIEW_TOOLS,
    CONCEPT_WEB_TOOL_SCHEMA,
    VERIFICATION_TOOL_SCHEMAS,
    WEB_VERIFICATION_TOOL_SCHEMA,
)
from .report_storage import _replace_verified_summary_body


def concept_prompt_for_budget(run, unit_id, body):
    return build_concept_only_prompt(
        unit_id=unit_id, revised_markdown=body,
        web_search_enabled=verification_web_search_enabled(run,
            run.cfg.get("_video_verification_prechecked_identity") or {}, "concept"))


def contradiction_input_digest(run, prompt, source_records, image_records):
    identity_call = run.cfg.get("_video_verification_model_identity")
    model_identity = identity_call() if callable(identity_call) else None
    payload = {
        "contract": "pair-input-v2", "prompt": prompt, "source_records": source_records,
        "image_records": image_records, "model_identity": model_identity,
        "selection": run.cfg.get("ai_model_selection"),
        "verification_model": run.cfg.get("summary_verification_model_name"),
        "video_fingerprint": (getattr(run.video_analysis_result, "source_fingerprint", "")
                              if run.video_analysis_result is not None else ""),
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                      default=str).encode("utf-8")).hexdigest()


def run_verification(run, *, mode, chunk_id, summary_body_for_verification, verification_source_records, verification_image_records, summary_claims, scene_records, retry_incomplete=False, boundary_context=None, prechecked_identity=None, fidelity_namespace="", legacy_fidelity=False, replay_only_output=None, original_body_range=None, original_body_text="", full_body_sha256="", source_identity="", concept_web_reuse=()):
    engine = run.engine

    if not summary_body_for_verification:
        raise RuntimeError("단일 정리 결과가 비어 있어 검증을 시작할 수 없습니다.")
    if mode == "concept" and not re.fullmatch(r"[0-9a-f]{64}", full_body_sha256):
        raise RuntimeError("오개념 검토의 전체 1차 수정본 지문이 없습니다.")
    engine.check_cancel_requested()
    run.current_phase = "verification"
    append_status_log(
        engine.status["logs"],
        f"근거 검증 준비: 기술 주장 {len(summary_claims)}개, "
        f"원문 근거 {len(verification_source_records)}개",
    )
    saved_v24_prompt_digest = ""
    if mode == "fidelity":
        verification_prompt = build_fidelity_comparison_prompt(
            comparison_id=chunk_id, draft_markdown=summary_body_for_verification,
            cleaned_stt=verification_source_records,
            scene_records=scene_records,
            summary_mode="detailed" if run.video_mode == DETAILED_TASK else "summary",
            legacy_coverage=legacy_fidelity,
            source_payload=run.summary_resume_payload.get("source_payload"),
        )
        saved_v24_prompt_digest = (hashlib.sha256(
            build_fidelity_comparison_prompt(
                comparison_id=chunk_id,
                draft_markdown=summary_body_for_verification,
                cleaned_stt=verification_source_records,
                scene_records=scene_records,
                summary_mode="detailed" if run.video_mode == DETAILED_TASK else "summary",
                saved_v24_prompt=True,
            ).encode("utf-8")).hexdigest() if not legacy_fidelity else "")
    elif mode == "contradiction":
        if not isinstance(boundary_context, dict):
            raise RuntimeError("교차 구간 검사 범위를 확인할 수 없습니다.")
        verification_prompt = build_cross_chunk_contradiction_prompt(
            chunk_id=chunk_id, **boundary_context,
        )
        if summary_prompt_exceeds_input_budget(verification_prompt):
            raise RuntimeError("교차 구간 검사 입력이 24,000토큰 예산을 넘었습니다.")
    elif mode == "concept":
        verification_prompt = ""
    elif mode == "integrated":
        verification_prompt = build_integrated_chunk_prompt(
            chunk_id=chunk_id, draft_markdown=summary_body_for_verification,
            stt_records=verification_source_records, scene_analysis=scene_records,
            concept_review_enabled=run.concept_review_enabled,
            claim_hints=summary_claims,
        )
    else:
        verification_prompt = build_verification_prompt(
            summary_markdown=summary_body_for_verification,
            claims=summary_claims,
            source_records=verification_source_records,
            image_records=verification_image_records,
        )
    verification_call = run.cfg.get("_video_verification_tools_call")
    if not callable(verification_call):
        raise RuntimeError("영상 검증 도구 호출기가 연결되지 않았습니다.")
    identity_call = run.cfg.get("_video_verification_model_identity")
    if not callable(identity_call):
        raise RuntimeError("영상 검증 모델 식별기가 연결되지 않았습니다.")
    model_identity = (prechecked_identity if prechecked_identity is not None
                      else run.cfg.get("_video_verification_prechecked_identity") or identity_call())
    if not isinstance(model_identity, dict) or not str(model_identity.get("model_id") or ""):
        raise RuntimeError("영상 검증 모델을 확인할 수 없습니다.")
    if model_identity.get("mode") == "managed" and not model_identity.get("policy_revision"):
        raise RuntimeError("영상 검증 관리형 정책 revision을 확인할 수 없습니다.")
    run.cfg["_video_verification_identity"] = model_identity
    selected_model = str(model_identity["model_id"])
    run.cfg["_video_verifier_working_limit"] = video_request_working_limit(selected_model)
    web_search_requested = (mode in {"concept", "integrated", "legacy"} and run.concept_review_enabled
                            and run.cfg.get("summary_verification_web_search_enabled") is True)
    web_search_call = run.cfg.get("_video_verification_web_search_call")
    web_search_enabled = verification_web_search_enabled(run, model_identity, mode)
    if mode == "concept":
        verification_prompt = build_concept_only_prompt(
            unit_id=chunk_id, revised_markdown=summary_body_for_verification,
            web_search_enabled=web_search_enabled)
    elif web_search_enabled:
        verification_prompt += (
            "\n[선택적 웹 조회]\n강의 STT를 실제 조회한 뒤 강의 자체의 기술 설명이 불확실할 때에만 "
            "lookup_web에 100자 이하 기술 개념 검색어, 해당 claim_ids, "
            "reason_code=technical_accuracy_uncertain를 보내세요. "
            "발화 원문, 정리본 문장, 강의 제목, 개인정보는 검색어에 넣지 마세요. "
            "기술 용어라도 원문에 연속된 구절을 그대로 복사하지 말고 일반 질문으로 바꾸세요. "
            "예: TCP congestion control definition, 혼잡 제어 원리, OAuth token semantics. "
            "웹 근거는 강의 원본 근거가 아니며 출처가 없거나 검색이 불가하면 단정적 수정은 보류하세요."
        )
    elif web_search_requested and mode != "concept":
        verification_prompt += (
            "\n[웹 검색 불가]\n현재 선택한 검증 경로에서는 웹 검색을 사용할 수 없습니다. "
            "강의 STT 자체의 기술 설명이 불확실한 주장은 판정을 보류하고 개념 수정을 제안하지 마세요. "
            "STT와 정리본의 명백한 불일치는 실제 STT 근거를 확인해 수정할 수 있습니다."
        )
    if mode in {"integrated", "fidelity", "concept"} and verification_prompt_exceeds_budget(run,
            verification_prompt, mode, web_search_enabled):
        raise VerificationInputBudgetExceeded("통합 대조 입력이 선택 모델의 안전 예산을 넘었습니다.")
    if mode == "fidelity":
        verification_limits = {"tool_rounds": 0}
    else:
        verification_limits = (verification_lookup_limits([], []) if mode == "concept"
                               else verification_lookup_limits(
                                   verification_source_records, run.stt_utterances))
        verification_limits["tool_rounds"] = (
            (1 if web_search_enabled else 0) if mode == "concept"
            else min(24, verification_limits["tool_rounds"] + 1))
    max_verification_tool_rounds = verification_limits["tool_rounds"]
    saved_verification, verification_identity, legacy_verification_identity, prior_verification_rounds, replay_paid_text_round, verification_settings = prepare_verification_checkpoint(
        chunk_id=chunk_id,
        full_body_sha256=full_body_sha256,
        legacy_fidelity=legacy_fidelity,
        mode=mode,
        model_identity=model_identity,
        replay_only_output=replay_only_output,
        retry_incomplete=retry_incomplete,
        run=run,
        saved_v24_prompt_digest=saved_v24_prompt_digest,
        scene_records=scene_records,
        summary_body_for_verification=summary_body_for_verification,
        verification_image_records=verification_image_records,
        verification_limits=verification_limits,
        verification_prompt=verification_prompt,
        verification_source_records=verification_source_records,
        web_search_enabled=web_search_enabled,
        web_search_requested=web_search_requested,
    )
    lookup = None if mode == "fidelity" and not legacy_fidelity else VerificationEvidenceLookup(
        source_records=verification_source_records,
        image_records=verification_image_records,
        image_dir=build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester),
        image_meta=[] if mode == "concept" else run.image_meta,
        stt_utterances=[] if mode == "concept" or run.timed_source_records else run.stt_utterances,
        summary_markdown=summary_body_for_verification,
        lecture_title=run.task["title"],
        locator_hints=[] if mode == "concept" else [{"summary_quote": claim["summary_quote"],
                        "t_ids": [source for source in claim["evidence_ids"]
                                  if source.startswith(("T", "S"))]}
                       for claim in summary_claims],
        video_source_path=run.source_video_path if run.video_mode is not None else None,
        video_fingerprint=(getattr(run.video_analysis_result, "source_fingerprint", "")
                           if run.video_analysis_result is not None else ""),
        allow_supplied_t_ids=mode == "fidelity",
        cancel_check=engine.check_cancel_requested,
    )
    claim_registry = VerificationClaimRegistry(summary_body_for_verification)
    web_result_by_call_id = {}
    web_usage_by_call_id = {}
    frame_digest_by_call_id = {}
    candidate_digest_by_call_id = {}

    execute_verification_tool = create_verification_tool_executor(
        candidate_digest_by_call_id=candidate_digest_by_call_id,
        claim_registry=claim_registry,
        concept_web_reuse=concept_web_reuse,
        frame_digest_by_call_id=frame_digest_by_call_id,
        legacy_fidelity=legacy_fidelity,
        lookup=lookup,
        mode=mode,
        run=run,
        saved_verification=saved_verification,
        summary_body_for_verification=summary_body_for_verification,
        verification_identity=verification_identity,
        verification_source_records=verification_source_records,
        web_result_by_call_id=web_result_by_call_id,
        web_search_call=web_search_call,
        web_search_enabled=web_search_enabled,
        web_usage_by_call_id=web_usage_by_call_id,
    )

    validate_verification_payload, validated_checkpoint_result, recover_rejected_round = create_verification_result_validators(
        chunk_id=chunk_id,
        claim_registry=claim_registry,
        lookup=lookup,
        mode=mode,
        run=run,
        saved_verification=saved_verification,
        summary_body_for_verification=summary_body_for_verification,
        verification_source_records=verification_source_records,
        web_search_enabled=web_search_enabled,
        web_search_requested=web_search_requested,
    )



    rounds = saved_verification.get("rounds") or []
    if not isinstance(rounds, list) or len(rounds) > max_verification_tool_rounds + 2:
        raise RuntimeError("잘못된 근거 검증 체크포인트입니다.")
    if mode in {"concept", "fidelity"} and rounds and rounds[-1].get("completed"):
        last_round = rounds[-1]
        paid_raw = last_round.get("raw_result")
        if isinstance(paid_raw, dict):
            try:
                validate_verification_payload(paid_raw)
            except ValueError as error:
                if ("unsafe_edit" not in str(error)
                        or any(item.get("correction_used") for item in rounds)
                        or len(json.dumps(paid_raw, ensure_ascii=False)) > 100_000):
                    raise
                correction = verification_correction_message(
                    "semantic_validation", error)
                if not is_safe_verification_correction_message(correction):
                    raise
                last_round.update(completed=False, invalid_request=True,
                                  correction_used=True, unsafe_edit_retry=True,
                                  correction_message=correction,
                                  rejected_structured_result=paid_raw)
                last_round.pop("raw_result", None)
                last_round.pop("result", None)
                run.persist_partial_progress()
    if mode == "fidelity" and any(
            round_entry.get("tool_calls") for round_entry in rounds):
        raise RuntimeError("정제 STT 대조 체크포인트에 허용되지 않는 도구 요청이 있습니다.")
    messages = [{"role": "user", "content": verification_prompt}]
    saved_outcomes = {
        (item.get("round_index"), item.get("tool_call_id")): item
        for item in saved_verification.get("tool_outcomes") or []
        if isinstance(item, dict)
    }
    replay_verification_rounds(
        engine=engine,
        candidate_digest_by_call_id=candidate_digest_by_call_id,
        claim_registry=claim_registry,
        execute_verification_tool=execute_verification_tool,
        frame_digest_by_call_id=frame_digest_by_call_id,
        lookup=lookup,
        max_verification_tool_rounds=max_verification_tool_rounds,
        messages=messages,
        mode=mode,
        recover_rejected_round=recover_rejected_round,
        rounds=rounds,
        run=run,
        saved_outcomes=saved_outcomes,
        saved_verification=saved_verification,
    )

    refresh_verification_usage, on_verification_round, on_verification_tool = create_verification_receipt_callbacks(
        candidate_digest_by_call_id=candidate_digest_by_call_id,
        frame_digest_by_call_id=frame_digest_by_call_id,
        legacy_verification_identity=legacy_verification_identity,
        mode=mode,
        model_identity=model_identity,
        prior_verification_rounds=prior_verification_rounds,
        run=run,
        saved_verification=saved_verification,
        validated_checkpoint_result=validated_checkpoint_result,
        verification_identity=verification_identity,
        web_result_by_call_id=web_result_by_call_id,
        web_usage_by_call_id=web_usage_by_call_id,
    )



    completed_round = rounds[-1] if rounds else None
    if mode == "fidelity" and replay_only_output is not None and not (
            completed_round and completed_round.get("completed")
            and "result" in completed_round):
        raise RuntimeError("재사용할 완료된 유료 검증 응답이 없습니다.")
    if completed_round and completed_round.get("completed") and "result" in completed_round:
        verification_result = validated_checkpoint_result(
            completed_round["raw_result"] if mode != "legacy" else completed_round["result"]
        )
        run.verifier_m = completed_round.get("model") or ""
        append_status_log(engine.status["logs"], "이전 실행의 완료된 근거 검증을 재사용합니다.")
        verification_usage = None
    else:
        selected_tools = ([] if mode in {"concept", "fidelity"} else
                          CONCEPT_REVIEW_TOOLS if mode == "integrated"
                          else VERIFICATION_TOOL_SCHEMAS)
        offered_tools = ([CONCEPT_WEB_TOOL_SCHEMA] if mode == "concept" and web_search_enabled
                         else [*selected_tools, WEB_VERIFICATION_TOOL_SCHEMA]
                         if web_search_enabled else selected_tools)
        raw_verification, run.verifier_m, verification_usage = verification_call(
            messages, run.cfg,
            offered_tools,
            execute_verification_tool,
            response_format={"type": "json_schema", "json_schema": {"name": "concept_only" if mode == "concept" else "fidelity_comparison" if mode == "fidelity" else "integrated_chunk" if mode == "integrated" else "cross_chunk_contradiction" if mode == "contradiction" else "verification", "strict": True, "schema": CONCEPT_ONLY_JSON_SCHEMA if mode == "concept" else LEGACY_FIDELITY_COMPARISON_JSON_SCHEMA if mode == "fidelity" and legacy_fidelity else FIDELITY_COMPARISON_JSON_SCHEMA if mode == "fidelity" else CONCEPT_REVIEW_JSON_SCHEMA if mode == "integrated" else INTEGRATED_CHUNK_JSON_SCHEMA if mode != "legacy" else VERIFICATION_REGISTERED_JSON_SCHEMA}},
            max_tool_rounds=max_verification_tool_rounds, log_list=engine.status["logs"],
            on_round_complete=on_verification_round,
            on_tool_complete=on_verification_tool,
            prior_usages=[item.get("usage") or {} for item in rounds],
            prior_tool_rounds=len(rounds),
            prior_correction_used=any(item.get("correction_used") for item in rounds),
            prior_tool_outcomes=[item for item in saved_verification.get("tool_outcomes") or []
                                 if isinstance(item, dict) and item.get("completed")],
            validate_structured_result=validate_verification_payload,
            available_tools=lambda: (offered_tools if mode in {"concept", "fidelity"} else [*selected_tools, WEB_VERIFICATION_TOOL_SCHEMA]
                                     if web_search_enabled and lookup.has_returned_stt()
                                     else selected_tools),
            correction_source_ids=lambda claim_id: sorted(
                lookup.returned_evidence_by_claim.get(claim_id, set())) if lookup else [],
            locked_claim_quotes=lambda claim_id: lookup.stt_quote_by_claim.get(claim_id) if lookup else None,
        )
        verification_result = saved_verification["rounds"][-1]["result"]
    verification_usage = refresh_verification_usage()
    if mode == "fidelity":
        try:
            edited_summary_body, projected_verification = apply_fidelity_comparison_edits(
                summary_body_for_verification, verification_result, allow_incomplete=True,
                scope_namespace=fidelity_namespace,
            )
        except ValueError:
            edited_summary_body = summary_body_for_verification
            projected_verification = {**verification_result, "status": "needs_review",
                                      "incomplete_reason": "unsafe_edit_application"}
    elif mode == "concept":
        if any(outcome.get("replay_blocked") for outcome in saved_verification["tool_outcomes"]
               if isinstance(outcome, dict)):
            edited_summary_body = summary_body_for_verification
            projected_verification = {**verification_result, "status": "needs_review",
                                      "incomplete_reason": "web_replay_unavailable"}
        else:
            try:
                edited_summary_body, projected_verification = apply_concept_only_edits(
                    summary_body_for_verification, verification_result,
                    web_records=lookup.web_records)
            except (UnsafeWebCitation, ValueError):
                edited_summary_body = summary_body_for_verification
                projected_verification = {**verification_result, "status": "needs_review",
                                          "incomplete_reason": "unsafe_edit_application"}
    elif mode != "legacy":
        engine.status["locator_status"] = dict(lookup.locator_status_by_claim)
        if any(str(record.get("source_id") or "").startswith("T")
               for record in verification_source_records):
            try:
                edited_summary_body, projected_verification = apply_integrated_chunk_edits(
                    summary_body_for_verification, verification_result, allow_incomplete=True,
                    web_records=lookup.web_records,
                )
            except (UnsafeWebCitation, ValueError):
                edited_summary_body = summary_body_for_verification
                projected_verification = {**verification_result, "status": "incomplete",
                                          "incomplete_reason": "unsafe_edit_application"}
        else:
            edited_summary_body = summary_body_for_verification
            projected_verification = {**verification_result, "status": "incomplete",
                                      "incomplete_reason": "timed_stt_unavailable"}
    else:
        engine.status["locator_status"] = dict(verification_result["locator_status"])
        edited_summary_body, projected_verification = apply_verification_edits(
            summary_body_for_verification,
            verification_result,
            source_records=[*lookup.source_records, *verification_image_records],
            web_records=lookup.web_records,
        )
    if mode == "fidelity" and replay_only_output is not None:
        if (projected_verification.get("status") != "completed"
                or edited_summary_body != replay_only_output):
            projected_verification = {**projected_verification,
                                      "status": "needs_review",
                                      "incomplete_reason": "paid_replay_mismatch"}
        edited_summary_body = replay_only_output
    elif mode in {"integrated", "fidelity", "concept"}:
        if chunk_id.startswith("window-"):
            current_parts, _ = run.completed_writer_parts()
            whole_body = "\n\n".join(current_parts)
            if whole_body.count(summary_body_for_verification) != 1:
                edited_summary_body = summary_body_for_verification
                projected_verification = {**projected_verification,
                                          "status": "needs_review" if mode in {"fidelity", "concept"} else "incomplete",
                                          "incomplete_reason": "ambiguous_window"}
            else:
                next_body = whole_body.replace(
                    summary_body_for_verification, edited_summary_body, 1)
                try:
                    run.full_md, edited_parts = _replace_verified_summary_body(
                        run.full_md, whole_body, next_body, run.usage_placeholder,
                        chunk_parts=current_parts, return_parts=True)
                except ValueError:
                    edited_summary_body = summary_body_for_verification
                    projected_verification = {**projected_verification,
                                              "status": "needs_review" if mode in {"fidelity", "concept"} else "incomplete",
                                              "incomplete_reason": "unsafe_edit_application"}
                else:
                    run.summary_resume_payload["written_chunk_bodies"] = edited_parts
                    run.summary_resume_payload["summary_body"] = next_body
                    run.summary_resume_payload["full_markdown"] = run.full_md
        elif chunk_id == "final":
            current_parts, _ = run.completed_writer_parts()
            try:
                run.full_md, edited_parts = _replace_verified_summary_body(
                    run.full_md, summary_body_for_verification, edited_summary_body,
                    run.usage_placeholder, chunk_parts=current_parts, return_parts=True,
                )
            except ValueError:
                edited_summary_body = summary_body_for_verification
                projected_verification = {**projected_verification,
                                          "status": "needs_review" if mode in {"fidelity", "concept"} else "incomplete",
                                          "incomplete_reason": "unsafe_edit_application"}
                edited_parts = current_parts
            run.summary_resume_payload["written_chunk_bodies"] = edited_parts
            run.summary_resume_payload["summary_body"] = edited_summary_body
            run.summary_resume_payload["full_markdown"] = run.full_md
        else:
            try:
                run.replace_written_part(chunk_id, summary_body_for_verification, edited_summary_body)
            except ValueError:
                edited_summary_body = summary_body_for_verification
                projected_verification = {**projected_verification,
                                          "status": "needs_review" if mode in {"fidelity", "concept"} else "incomplete",
                                          "incomplete_reason": "unsafe_edit_application"}
    else:
        if mode == "contradiction":
            current_parts, _ = run.completed_writer_parts()
            run.full_md, edited_parts = _replace_verified_summary_body(
                run.full_md, summary_body_for_verification, edited_summary_body,
                run.usage_placeholder, chunk_parts=current_parts, return_parts=True,
            )
            run.summary_resume_payload["written_chunk_bodies"] = edited_parts
        else:
            run.full_md = _replace_verified_summary_body(
                run.full_md, summary_body_for_verification, edited_summary_body, run.usage_placeholder,
            )
    run.persist_partial_progress()
    append_status_log(
        engine.status["logs"],
        "정제 STT·초안 대조 완료" if mode == "fidelity" else
        "오개념 검토 완료" if mode == "concept" else
        "통합 청크 검사 완료" if mode == "integrated" else "교차 구간 모순 검사 완료",
    )
    if mode == "contradiction":
        saved_verification["reuse_input_digest"] = contradiction_input_digest(run,
            verification_prompt,
            verification_source_records, verification_image_records,
        )
        saved_verification["registered_quotes"] = [
            str(claim.get("summary_quote") or "")
            for claim in claim_registry.claims.values()
        ]
        saved_verification["input_body_sha256"] = hashlib.sha256(
            summary_body_for_verification.encode("utf-8")
        ).hexdigest()
        saved_verification["output_body_sha256"] = hashlib.sha256(
            edited_summary_body.encode("utf-8")
        ).hexdigest()
    if mode in {"integrated", "fidelity", "concept"}:
        saved_verification["input_body_sha256"] = hashlib.sha256(
            summary_body_for_verification.encode("utf-8")
        ).hexdigest()
        saved_verification["output_body_sha256"] = hashlib.sha256(
            edited_summary_body.encode("utf-8")
        ).hexdigest()
        if mode == "fidelity" and projected_verification.get("status") == "completed":
            saved_verification["completed_scope"] = {
                **verification_result["coverage"],
                "checked_block_ids": [f"{fidelity_namespace}:{block_id}"
                                      for block_id in verification_result["coverage"]["checked_block_ids"]],
                "input_body_sha256": saved_verification["input_body_sha256"],
                "output_body_sha256": saved_verification["output_body_sha256"],
                "prompt_digest": verification_settings["prompt_digest"],
                "namespace": fidelity_namespace,
                "source_identity": source_identity,
                "full_body_sha256": full_body_sha256,
                "body_range": list(original_body_range or []),
                "original_body_sha256": hashlib.sha256(
                    original_body_text.encode("utf-8")).hexdigest(),
            }
            saved_verification["input_draft"] = summary_body_for_verification
            saved_verification["output_body"] = edited_summary_body
        if mode == "integrated":
            projected_verification["source_looked_up"] = lookup.has_returned_stt()
            saved_verification["source_looked_up"] = projected_verification["source_looked_up"]
        if not chunk_id.startswith("window-"):
            run.summary_resume_payload["summary_body"] = edited_summary_body
        run.summary_resume_payload["full_markdown"] = run.full_md
    saved_verification["inspection_status"] = projected_verification.get("status")
    if mode in {"integrated", "fidelity", "concept"}:
        run.summary_resume_payload.setdefault("fidelity_checked_chunks" if mode == "fidelity" else
                                          "concept_checked_chunks" if mode == "concept" else
                                          "checked_chunks", {})[chunk_id] = {
            "draft": edited_summary_body,
            "inspection_status": projected_verification.get("status"),
            "source_records": verification_source_records,
            "image_records": verification_image_records,
            "claims": summary_claims,
            "scene_records": scene_records,
        }
    run.persist_partial_progress()
    return edited_summary_body, projected_verification


def verification_prompt_exceeds_budget(run, prompt, mode, web_enabled=False,
                                        working_limit=None):
    input_limit = min(run.video_verifier_limit, int(working_limit or run.video_verifier_limit))
    estimated_request, request_overhead = verification_request_size(run,
        prompt, mode, web_enabled)
    if estimated_request > min(AI_REQUEST_MAX_INPUT_TOKENS, input_limit):
        return True
    return summary_prompt_exceeds_input_budget(
        prompt, max_input_tokens=max(1, input_limit - request_overhead))


def verification_request_size(run, prompt, mode, web_enabled=False):
    if mode == "concept":
        schema = CONCEPT_ONLY_JSON_SCHEMA
        tools = [CONCEPT_WEB_TOOL_SCHEMA] if web_enabled else []
    elif mode == "fidelity":
        schema = FIDELITY_COMPARISON_JSON_SCHEMA
        tools = []
    else:
        return estimate_token_count(prompt), 0
    envelope = {
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_schema", "json_schema": {
            "name": "concept_only" if mode == "concept" else "fidelity_comparison",
            "strict": True, "schema": schema}},
        "tools": tools, "tool_choice": "auto" if tools else None,
    }
    estimated_request = estimate_request_tokens(envelope)
    envelope["messages"][0]["content"] = ""
    request_overhead = estimate_request_tokens(envelope)
    return estimated_request, request_overhead


def verification_web_search_enabled(run, model_identity, mode):
    if (mode not in {"concept", "integrated", "legacy"}
            or not run.concept_review_enabled
            or run.cfg.get("summary_verification_web_search_enabled") is not True
            or not callable(run.cfg.get("_video_verification_web_search_call"))):
        return False
    selected_model = str(model_identity.get("model_id") or "")
    if model_identity.get("mode") == "managed":
        return selected_model in {
            "openai/gpt-5-nano", "openai/gpt-5.6-luna", "openai/gpt-6-luna"}
    return (model_identity.get("mode") == "byok"
            and str((run.cfg.get("_video_verification_selection") or {})
                    .get("provider") or "").casefold() == "openai"
            and selected_model in {
                "gpt-5-nano", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-luna"})
