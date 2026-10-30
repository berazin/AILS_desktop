"""Compare cleaned STT and draft scopes, retain coverage and replay exact paid edits."""

from __future__ import annotations

from .review_concepts import review_concept_draft
import json
import hashlib
from .integrated_chunk_verification import (
    VerificationInputBudgetExceeded,
    build_fidelity_comparison_prompt,
    fidelity_scene_key,
    fidelity_scope_namespace,
    fidelity_scopes_cover_original_body,
)
from .video_modes import DETAILED_TASK
from pipeline_utils import TaskCancelledError
from .verification_contract import FIDELITY_VERIFICATION_CONTRACT_VERSION
from .report_storage import _replace_verified_summary_body
from .verification_calls import (
    run_verification,
    verification_prompt_exceeds_budget,
)


def compare_fidelity_draft(run, split_after_tool_budget, split_review_units):
    """Compare cleaned STT and draft scopes, retain coverage and replay exact paid edits."""
    engine = run.engine
    fidelity_complete = True
    if run.video_mode is not None and not run.report_user_modified:
        # A save-only retry may resume from the concept-edited body.
        # Replay fidelity against its exact completed output first,
        # then reapply the paid concept result from its own checkpoint.
        prior_concept = (run.summary_resume_payload.get("concept_checks") or {}).get("final") or {}
        fidelity_body = run.summary_resume_payload.get("fidelity_output_body")
        concept_checks = run.summary_resume_payload.get("concept_checks") or {}
        split_concept_complete = (
            run.summary_resume_payload.get("concept_review_status") == "completed"
            and run.summary_resume_payload.get("concept_output_body")
            == run.summary_body_for_verification
            and any(key.startswith("window-concept-") for key in concept_checks)
            and all(check.get("inspection_status") == "completed"
                    for key, check in concept_checks.items()
                    if key.startswith("window-concept-")))
        if (isinstance(fidelity_body, str) and fidelity_body and (
                (prior_concept.get("inspection_status") == "completed"
                 and prior_concept.get("output_body_sha256") == hashlib.sha256(
                     run.summary_body_for_verification.encode("utf-8")).hexdigest()
                 and prior_concept.get("input_body_sha256") == hashlib.sha256(
                     fidelity_body.encode("utf-8")).hexdigest())
                or (split_concept_complete
                    and run.summary_resume_payload.get("concept_input_body_sha256")
                    == hashlib.sha256(fidelity_body.encode("utf-8")).hexdigest()))):
            current_parts, _ = run.completed_writer_parts()
            run.full_md, restored_parts = _replace_verified_summary_body(
                run.full_md, run.summary_body_for_verification, fidelity_body,
                run.usage_placeholder, chunk_parts=current_parts, return_parts=True)
            run.summary_body_for_verification = fidelity_body
            run.summary_resume_payload["summary_body"] = fidelity_body
            run.summary_resume_payload["written_chunk_bodies"] = restored_parts
            run.summary_resume_payload["full_markdown"] = run.full_md
        run.complete_managed_stage("summary")
        run.current_phase = "fidelity_comparison"
        run.summary_resume_payload["incomplete_chunks"] = []
        run.summary_resume_payload["fidelity_status"] = "pending"
        run.summary_resume_payload["concept_review_status"] = (
            "disabled" if not run.concept_review_enabled else "blocked_by_fidelity")
        run.persist_partial_progress()
        active_scenes = []
        fidelity_source_identity = hashlib.sha256(json.dumps(
            {"contract": FIDELITY_VERIFICATION_CONTRACT_VERSION,
             "stt": run.timed_source_records}, ensure_ascii=False,
            sort_keys=True, default=str).encode("utf-8")).hexdigest()
        if (run.summary_resume_payload.get("fidelity_source_identity") != fidelity_source_identity
                or any(check.get("version") != FIDELITY_VERIFICATION_CONTRACT_VERSION
                       for check in (run.summary_resume_payload.get("fidelity_checks") or {}).values()
                       if isinstance(check, dict))):
            initial_body = run.summary_body_for_verification
            run.summary_resume_payload["fidelity_source_identity"] = fidelity_source_identity
            run.summary_resume_payload["fidelity_initial_body"] = initial_body
            run.summary_resume_payload["fidelity_initial_body_sha256"] = hashlib.sha256(
                initial_body.encode("utf-8")).hexdigest()
        fidelity_initial_body = run.summary_resume_payload.get("fidelity_initial_body")
        if not isinstance(fidelity_initial_body, str) or not fidelity_initial_body:
            fidelity_initial_body = run.summary_body_for_verification
            run.summary_resume_payload["fidelity_initial_body"] = fidelity_initial_body
            run.summary_resume_payload["fidelity_initial_body_sha256"] = hashlib.sha256(
                fidelity_initial_body.encode("utf-8")).hexdigest()
        fidelity_initial_body_sha256 = run.summary_resume_payload["fidelity_initial_body_sha256"]
        review_units = [("final", fidelity_initial_body,
                         run.timed_source_records, [], active_scenes,
                         0, len(fidelity_initial_body))]
        final_fidelity_prompt = build_fidelity_comparison_prompt(
            comparison_id="final", draft_markdown=fidelity_initial_body,
            cleaned_stt=run.timed_source_records, scene_records=active_scenes,
            summary_mode="detailed" if run.video_mode == DETAILED_TASK else "summary",
            source_payload=run.summary_resume_payload.get("source_payload"),
        )
        if verification_prompt_exceeds_budget(run, final_fidelity_prompt, "fidelity"):
            try:
                review_units = split_review_units(
                    "fidelity", fidelity_initial_body,
                    run.timed_source_records, [], active_scenes)
            except VerificationInputBudgetExceeded:
                review_units = []
                fidelity_complete = False
                run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                    "mode": "fidelity", "chunk_id": "final",
                    "draft": run.summary_body_for_verification,
                    "incomplete_reason": "input_budget",
                })
        fidelity_window_rewrites = {}
        replayed_fidelity_body = fidelity_initial_body
        expected_body_units = []
        for unit_index, (unit_id, draft, sources, images, scenes,
                         body_start, body_end) in enumerate(review_units):
            if not draft:
                fidelity_complete = False
                continue
            run.summary_body_for_verification = run.summary_resume_payload["summary_body"]
            original_draft = draft
            expected_body_units.append((unit_id, body_start, body_end))
            fidelity_namespace = fidelity_scope_namespace(
                fidelity_source_identity, fidelity_initial_body_sha256, unit_id)
            if unit_id.startswith("window-"):
                draft = (run.summary_resume_payload["summary_body"]
                         if draft == run.summary_body_for_verification
                         else fidelity_window_rewrites.get(draft, draft))
            prior_fidelity = (run.summary_resume_payload.get("fidelity_checks") or {}).get(unit_id) or {}
            prior_settings = prior_fidelity.get("settings") or {}
            current_evidence_digest = hashlib.sha256(json.dumps(
                sources, ensure_ascii=False, sort_keys=True,
            ).encode("utf-8")).hexdigest()
            current_scene_digest = ""
            saved_scope = prior_fidelity.get("completed_scope") or {}
            expected_scope = {
                "checked_stt_ids": sorted(str(item.get("source_id")) for item in sources
                                          if isinstance(item, dict)),
                "checked_scene_keys": sorted(fidelity_scene_key(item) for item in scenes
                                             if isinstance(item, dict) and not item.get("duplicate_of")),
                "checked_block_ids": [f"{fidelity_namespace}:B{index:04d}"
                                      for index, _ in enumerate(original_draft.split("\n\n"), 1)],
                "body_range": [body_start, body_end],
                "original_body_sha256": hashlib.sha256(
                    original_draft.encode("utf-8")).hexdigest(),
                "full_body_sha256": fidelity_initial_body_sha256,
                "source_identity": fidelity_source_identity,
            }
            def restore_legacy_input(output_body, input_body):

                if not isinstance(output_body, str) or not isinstance(input_body, str):
                    return False
                whole_body = run.summary_resume_payload["summary_body"]
                if ((unit_id == "final" and whole_body != output_body)
                        or whole_body.count(output_body) != 1):
                    return False
                if output_body == input_body:
                    return True
                restored = whole_body.replace(output_body, input_body, 1)
                try:
                    current_parts, _ = run.completed_writer_parts()
                    next_md, restored_parts = _replace_verified_summary_body(
                        run.full_md, whole_body, restored, run.usage_placeholder,
                        chunk_parts=current_parts, return_parts=True)
                except (ValueError, RuntimeError):
                    return False
                run.full_md = next_md
                run.summary_resume_payload["written_chunk_bodies"] = restored_parts
                run.summary_resume_payload["summary_body"] = restored
                run.summary_resume_payload["full_markdown"] = run.full_md
                run.summary_body_for_verification = restored
                run.persist_partial_progress()
                return True
            if (prior_fidelity.get("version") == FIDELITY_VERIFICATION_CONTRACT_VERSION
                    and prior_fidelity.get("inspection_status") == "completed"
                    and all(saved_scope.get(key) == value for key, value in expected_scope.items())
                    and saved_scope.get("output_body_sha256") == prior_fidelity.get("output_body_sha256")
                    and saved_scope.get("input_body_sha256") == prior_fidelity.get("input_body_sha256")
                    and saved_scope.get("prompt_digest") == prior_settings.get("prompt_digest")
                    and saved_scope.get("namespace") == fidelity_namespace
                    and prior_fidelity.get("input_draft") == draft
                    and not prior_fidelity.get("tool_outcomes")
                    and not any(round_entry.get("tool_calls") for round_entry in
                                prior_fidelity.get("rounds") or [])
                    and prior_fidelity.get("output_body_sha256")
                    == hashlib.sha256(draft.encode("utf-8")).hexdigest()
                    and prior_settings.get("evidence_digest") == current_evidence_digest
                    and prior_settings.get("scene_digest") == current_scene_digest
                    and prior_settings.get("effective_model")
                    == run.cfg.get("_video_verification_prechecked_identity")
                    and prior_settings.get("model") == run.cfg.get("summary_verification_model_name")
                    and prior_settings.get("summary_mode") == run.video_mode
                    and prior_settings.get("reasoning_effort")
                    == str(run.cfg.get("summary_verification_reasoning_effort") or "medium")
                    and prior_settings.get("selection") == run.cfg.get("ai_model_selection")
                    and prior_settings.get("video_fingerprint") == ""
                    and (unit_id == "final" or replayed_fidelity_body.count(draft) == 1)):
                fidelity_window_rewrites[original_draft] = draft
                if unit_id == "final":
                    replayed_fidelity_body = draft
                continue
            verifier_settings_changed = (
                prior_settings.get("effective_model")
                != run.cfg.get("_video_verification_prechecked_identity")
                or prior_settings.get("model") != run.cfg.get("summary_verification_model_name")
                or prior_settings.get("summary_mode") != run.video_mode
                or prior_settings.get("reasoning_effort")
                != str(run.cfg.get("summary_verification_reasoning_effort") or "medium")
                or prior_settings.get("selection") != run.cfg.get("ai_model_selection"))
            if (prior_fidelity.get("version") == FIDELITY_VERIFICATION_CONTRACT_VERSION
                    and prior_fidelity.get("inspection_status") == "completed"
                    and verifier_settings_changed):
                # A different model/policy must run a fresh review.
                # Restore only the exact known paid input/output pair;
                # run_verification archives its paid rounds and usage.
                paid_input = prior_fidelity.get("input_draft")
                paid_output = prior_fidelity.get("output_body")
                if not (isinstance(paid_input, str) and isinstance(paid_output, str)
                        and all(saved_scope.get(key) == value
                                for key, value in expected_scope.items())
                        and prior_fidelity.get("input_body_sha256")
                        == hashlib.sha256(paid_input.encode("utf-8")).hexdigest()
                        and prior_fidelity.get("output_body_sha256")
                        == hashlib.sha256(paid_output.encode("utf-8")).hexdigest()
                        and restore_legacy_input(paid_output, paid_input)):
                    fidelity_complete = False
                    run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                        "mode": "fidelity", "chunk_id": unit_id,
                        "incomplete_reason": "paid_input_restore_failed"})
                    continue
            if (prior_fidelity.get("version") == FIDELITY_VERIFICATION_CONTRACT_VERSION
                    and prior_fidelity.get("inspection_status") == "completed"
                    and not verifier_settings_changed):
                paid_input = prior_fidelity.get("input_draft")
                paid_output = prior_fidelity.get("output_body")
                current_output = (run.summary_resume_payload.get("summary_body") if unit_id == "final"
                                  else ((run.summary_resume_payload.get("fidelity_checked_chunks") or {})
                                        .get(unit_id) or {}).get("draft"))
                if (paid_input == draft
                        and isinstance(paid_output, str)
                        and paid_output == current_output
                        and (unit_id == "final" or
                             replayed_fidelity_body.count(paid_input) == 1)
                        and prior_fidelity.get("input_body_sha256")
                        == hashlib.sha256(paid_input.encode("utf-8")).hexdigest()
                        and prior_fidelity.get("output_body_sha256")
                        == hashlib.sha256(paid_output.encode("utf-8")).hexdigest()):
                    try:
                        reused_body, reused_result = run_verification(run,
                            mode="fidelity", chunk_id=unit_id,
                            summary_body_for_verification=paid_input,
                            verification_source_records=sources,
                            verification_image_records=images,
                            summary_claims=[], scene_records=scenes,
                            replay_only_output=paid_output,
                            fidelity_namespace=fidelity_namespace,
                            original_body_range=(body_start, body_end),
                            original_body_text=original_draft,
                            full_body_sha256=fidelity_initial_body_sha256,
                            source_identity=fidelity_source_identity)
                    except (TypeError, ValueError, RuntimeError):
                        reused_body, reused_result = paid_output, {"status": "needs_review"}
                    if reused_result["status"] == "completed":
                        fidelity_window_rewrites[original_draft] = reused_body
                        replayed_fidelity_body = (
                            reused_body if unit_id == "final" else
                            replayed_fidelity_body.replace(paid_input, reused_body, 1))
                        continue
                fidelity_complete = False
                run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                    "mode": "fidelity", "chunk_id": unit_id,
                    "incomplete_reason": "paid_revalidation_failed"})
                continue
            try:
                edited, result = run_verification(run,
                    mode="fidelity", chunk_id=unit_id,
                    summary_body_for_verification=draft,
                    verification_source_records=sources,
                    verification_image_records=images,
                    summary_claims=[], scene_records=scenes,
                    retry_incomplete=True,
                    fidelity_namespace=fidelity_namespace,
                    original_body_range=(body_start, body_end),
                    original_body_text=original_draft,
                    full_body_sha256=fidelity_initial_body_sha256,
                    source_identity=fidelity_source_identity,
                )
            except VerificationInputBudgetExceeded:
                children = (split_after_tool_budget(
                    "fidelity", unit_id, original_draft, sources, images, scenes,
                    body_start=body_start)
                    if draft == original_draft else [])
                if children and len(review_units) + len(children) <= 128:
                    expected_body_units.pop()
                    review_units[unit_index + 1:unit_index + 1] = children
                    run.persist_partial_progress()
                    continue
                edited, result = draft, {"status": "needs_review", "incomplete_reason": "input_budget"}
            except TaskCancelledError:
                run.summary_resume_payload["fidelity_status"] = "cancelled"
                run.persist_partial_progress()
                raise
            except Exception:
                run.summary_resume_payload["fidelity_status"] = "failed"
                run.persist_partial_progress()
                raise
            fidelity_window_rewrites[original_draft] = edited
            if result["status"] != "completed":
                fidelity_complete = False
                run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                    "mode": "fidelity", "chunk_id": unit_id, "draft": edited,
                    "source_records": sources, "image_records": images,
                    "claims": [], "scene_records": scenes,
                })
            elif unit_id == "final":
                replayed_fidelity_body = edited
            elif replayed_fidelity_body.count(draft) == 1:
                replayed_fidelity_body = replayed_fidelity_body.replace(draft, edited, 1)
            else:
                fidelity_complete = False
        expected_stt_ids = {str(record.get("source_id") or "")
                            for record in run.timed_source_records if isinstance(record, dict)}
        expected_scene_keys = {fidelity_scene_key(scene) for scene in active_scenes}
        checked_stt_ids = set()
        checked_scene_keys = set()
        completed_scopes = {}
        for unit_id, *_ in review_units:
            checkpoint = (run.summary_resume_payload.get("fidelity_checks") or {}).get(unit_id) or {}
            scope = checkpoint.get("completed_scope") or {}
            if checkpoint.get("inspection_status") == "completed":
                checked_stt_ids.update(scope.get("checked_stt_ids") or [])
                checked_scene_keys.update(scope.get("checked_scene_keys") or [])
                completed_scopes[unit_id] = scope
        missing_stt_ids = sorted(expected_stt_ids - checked_stt_ids)
        missing_scene_keys = sorted(expected_scene_keys - checked_scene_keys)
        body_covered = fidelity_scopes_cover_original_body(
            fidelity_initial_body, fidelity_source_identity,
            expected_body_units, completed_scopes)
        if (missing_stt_ids or missing_scene_keys or not body_covered
                or replayed_fidelity_body != run.summary_resume_payload["summary_body"]):
            fidelity_complete = False
        run.summary_resume_payload["fidelity_coverage"] = {
            "text_basis": "ai_cleaned_stt", "raw_stt_semantics_verified": False,
            "missing_stt_ids": missing_stt_ids,
            "missing_scene_keys": missing_scene_keys,
            "original_body_covered": body_covered,
        }
        run.summary_body_for_verification = run.summary_resume_payload["summary_body"]
        run.summary_resume_payload["fidelity_status"] = "completed" if fidelity_complete else "needs_review"
        if fidelity_complete:
            run.summary_resume_payload["fidelity_output_body"] = run.summary_body_for_verification
        run.summary_resume_payload["verification_text_basis"] = "ai_cleaned_stt"
        run.summary_resume_payload["raw_stt_semantics_verified"] = False
        run.summary_resume_payload["concept_review_status"] = (
            "disabled" if not run.concept_review_enabled else
            "pending" if fidelity_complete else "blocked_by_fidelity"
        )
        run.persist_partial_progress()
        review_concept_draft(fidelity_complete, run, split_after_tool_budget, split_review_units)

    return fidelity_complete
