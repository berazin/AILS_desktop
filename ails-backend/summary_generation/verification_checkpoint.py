"""Verification identity, legacy migration and paid checkpoint scope registration."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from common import build_image_dir
from .integrated_chunk_verification import (
    apply_fidelity_comparison_edits,
    normalize_saved_v24_fidelity_payload,
    parse_fidelity_comparison_result,
)
from .verification_contract import (
    CONCEPT_ONLY_CONTRACT_VERSION,
    CONCEPT_VERIFICATION_CONTRACT_VERSION,
    FIDELITY_VERIFICATION_CONTRACT_VERSION,
    _verification_evidence_digest,
)


def prepare_verification_checkpoint(*, chunk_id, full_body_sha256, legacy_fidelity, mode, model_identity, replay_only_output, retry_incomplete, run, saved_v24_prompt_digest, scene_records, summary_body_for_verification, verification_image_records, verification_limits, verification_prompt, verification_source_records, web_search_enabled, web_search_requested):
    """Bind verification settings to paid history and register its current scope."""
    verification_settings = {
        "contract_version": (22 if mode == "fidelity" and legacy_fidelity else
                             FIDELITY_VERIFICATION_CONTRACT_VERSION if mode == "fidelity"
                             else CONCEPT_ONLY_CONTRACT_VERSION if mode == "concept"
                             else CONCEPT_VERIFICATION_CONTRACT_VERSION if mode == "integrated"
                             else 16 if mode != "legacy" else 15),
        "lookup_limits": verification_limits,
        "web_search_requested": web_search_requested,
        "web_search_enabled": web_search_enabled,
        "model": run.cfg.get("summary_verification_model_name"),
        "reasoning_effort": str(run.cfg.get("summary_verification_reasoning_effort") or "medium"),
        "selection": run.cfg.get("ai_model_selection"),
        "effective_model": model_identity,
        "video_source_path": (str(Path(run.source_video_path).resolve())
                              if run.video_mode is not None and mode not in {"concept", "fidelity"} else ""),
        "video_fingerprint": (getattr(run.video_analysis_result, "source_fingerprint", "")
                              if run.video_analysis_result is not None and mode not in {"concept", "fidelity"} else ""),
        "prompt_digest": hashlib.sha256(verification_prompt.encode("utf-8")).hexdigest(),
        "evidence_digest": (hashlib.sha256(json.dumps(
            verification_source_records, ensure_ascii=False, sort_keys=True,
        ).encode("utf-8")).hexdigest() if mode == "fidelity" else "" if mode == "concept" else _verification_evidence_digest(
            verification_source_records, verification_image_records, run.image_meta, run.stt_utterances,
            build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester),
        )),
    }
    if mode == "concept":
        verification_settings["full_body_sha256"] = full_body_sha256
    if mode != "legacy":
        verification_settings.update({
            "mode": mode, "chunk_id": chunk_id,
            "summary_mode": run.video_mode if mode == "fidelity" else None,
            "concept_review_enabled": run.concept_review_enabled if mode in {"integrated", "concept"} else False,
            "scene_digest": ("" if mode in {"concept", "fidelity"} else hashlib.sha256(json.dumps(
                scene_records, ensure_ascii=False, sort_keys=True, default=str
            ).encode("utf-8")).hexdigest()),
        })
        if mode == "contradiction":
            verification_settings["draft_digest"] = hashlib.sha256(
                summary_body_for_verification.encode("utf-8")
            ).hexdigest()
    verification_identity = hashlib.sha256(
        json.dumps(verification_settings, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    saved_verification = (
        ((run.summary_resume_payload or {}).get("concept_checks") or {}).get(chunk_id)
        if mode == "concept" else
        ((run.summary_resume_payload or {}).get("fidelity_checks") or {}).get(chunk_id)
        if mode == "fidelity" else
        ((run.summary_resume_payload or {}).get("integrated_checks") or {}).get(chunk_id)
        if mode == "integrated" else
        ((run.summary_resume_payload or {}).get("contradiction_checks") or {}).get(chunk_id)
        if mode == "contradiction" else
        (run.summary_resume_payload or {}).get("verification")
    )
    # Removing an output ceiling does not invalidate a paid
    # answer to otherwise identical input/model/prompt settings.
    if isinstance(saved_verification, dict):
        old_settings = saved_verification.get("settings")
        if (isinstance(old_settings, dict) and "max_output_tokens" in old_settings
                and {key: value for key, value in old_settings.items()
                     if key != "max_output_tokens"} == verification_settings):
            old_identity = hashlib.sha256(json.dumps(
                old_settings, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()
            for usage_event in run.usage_events:
                if usage_event and usage_event.get("verification_identity") == old_identity:
                    usage_event["verification_identity"] = verification_identity
            saved_verification["settings"] = verification_settings
    paid_v24_reparsed = False
    if (mode == "fidelity" and not legacy_fidelity
            and isinstance(saved_verification, dict)
            and saved_verification.get("version") == 24
            and saved_verification.get("input_body_sha256") == hashlib.sha256(
                summary_body_for_verification.encode("utf-8")).hexdigest()
            and isinstance(saved_verification.get("rounds"), list)
            and saved_verification["rounds"]
            and saved_verification["rounds"][-1].get("completed")
            and isinstance(saved_verification["rounds"][-1].get("raw_result"), dict)
            and not saved_verification.get("tool_outcomes")
            and not any(item.get("tool_calls") for item in saved_verification["rounds"])):
        old_settings = saved_verification.get("settings")
        expected_old_settings = {**verification_settings,
                                 "prompt_digest": saved_v24_prompt_digest}
        if old_settings == expected_old_settings and old_settings != verification_settings:
            old_raw = saved_verification["rounds"][-1]["raw_result"]
            try:
                normalized_raw = normalize_saved_v24_fidelity_payload(
                    old_raw, summary_body_for_verification,
                    verification_source_records)
                reparsed = parse_fidelity_comparison_result(
                    json.dumps(normalized_raw, ensure_ascii=False),
                    comparison_id=chunk_id,
                    draft_markdown=summary_body_for_verification,
                    cleaned_stt=verification_source_records,
                    scene_records=[], registered_claims={})
                if reparsed["status"] == "completed":
                    apply_fidelity_comparison_edits(summary_body_for_verification, reparsed)
            except ValueError:
                reparsed = None
            if reparsed is not None and reparsed["status"] == "completed":
                old_identity = hashlib.sha256(json.dumps(
                    old_settings, ensure_ascii=False, sort_keys=True,
                    default=str).encode("utf-8")).hexdigest()
                for usage_event in run.usage_events:
                    if usage_event and usage_event.get("verification_identity") == old_identity:
                        usage_event["verification_identity"] = verification_identity
                saved_verification["rounds"][-1].update(
                    paid_raw_result=old_raw, raw_result=normalized_raw, result=reparsed)
                saved_verification["settings"] = verification_settings
                paid_v24_reparsed = True
    # Reparse a paid text answer with the current block applicator
    # before considering a new call, including formerly held edits.
    replay_paid_text_round = (
        mode in {"fidelity", "concept"} and isinstance(saved_verification, dict)
        and saved_verification.get("settings") == verification_settings
        and bool(saved_verification.get("rounds"))
        and not saved_verification["rounds"][-1].get("tool_calls")
        and any(isinstance(saved_verification["rounds"][-1].get(key), dict)
                for key in ("raw_result", "rejected_structured_result"))
    )
    if (retry_incomplete and isinstance(saved_verification, dict)
            and not paid_v24_reparsed and not replay_paid_text_round
            and (saved_verification.get("rounds") or [])
            and (saved_verification.get("inspection_status") in {"incomplete", "needs_review"}
                 or (saved_verification["rounds"][-1].get("result") or {}).get("status") in {"incomplete", "needs_review"})):
        history = run.summary_resume_payload.setdefault("integrated_history", [])
        history.append({"chunk_id": chunk_id, "checkpoint": saved_verification})
        for usage_event in run.usage_events:
            if usage_event and usage_event.get("verification_identity") == verification_identity:
                usage_event["verification_identity"] = f"{verification_identity}:retry:{len(history)}"
        saved_verification = None
    legacy_settings = {**verification_settings, "contract_version": 13,
                       "lookup_limits": {key: value for key, value in verification_limits.items()
                                         if key != "tool_rounds"}}
    legacy_verification_identity = hashlib.sha256(
        json.dumps(legacy_settings, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    if not isinstance(saved_verification, dict) or (
        saved_verification.get("version") != verification_settings["contract_version"]
        or saved_verification.get("settings") != verification_settings
    ):
        if mode == "fidelity" and replay_only_output is not None:
            raise RuntimeError("저장된 유료 검증의 입력 또는 설정이 변경되었습니다.")
        if (mode in {"fidelity", "concept", "integrated"}
                and isinstance(saved_verification, dict) and saved_verification.get("rounds")):
            history = run.summary_resume_payload.setdefault("integrated_history", [])
            history.append({"chunk_id": chunk_id, "checkpoint": saved_verification})
            for usage_event in run.usage_events:
                if (usage_event and usage_event.get("verification_identity")
                        in {verification_identity, legacy_verification_identity}):
                    usage_event["verification_identity"] = (
                        f"{usage_event['verification_identity']}:prior:{len(history)}")
        saved_verification = {"version": verification_settings["contract_version"], "settings": verification_settings, "rounds": [], "tool_outcomes": []}
    prior_verification_rounds = len(saved_verification["rounds"])
    if run.summary_resume_payload is None:
        raise RuntimeError("검증 진행 상태를 저장할 요약 체크포인트가 없습니다.")
    if mode == "fidelity":
        run.summary_resume_payload.setdefault("fidelity_checks", {})[chunk_id] = saved_verification
    elif mode == "contradiction":
        run.summary_resume_payload.setdefault("contradiction_checks", {})[chunk_id] = saved_verification
    elif mode == "concept":
        run.summary_resume_payload.setdefault("concept_checks", {})[chunk_id] = saved_verification
    elif mode != "integrated":
        run.summary_resume_payload["verification"] = saved_verification
    else:
        run.summary_resume_payload.setdefault("integrated_checks", {})[chunk_id] = saved_verification

    return saved_verification, verification_identity, legacy_verification_identity, prior_verification_rounds, replay_paid_text_round, verification_settings
