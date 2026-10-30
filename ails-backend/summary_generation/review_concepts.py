"""Review confirmed draft concepts, reuse paid children and preserve rewrite positions."""

from __future__ import annotations

import json
import hashlib
from .integrated_chunk_verification import VerificationInputBudgetExceeded
from pipeline_utils import TaskCancelledError
from .verification_calls import (
    concept_prompt_for_budget,
    run_verification,
    verification_prompt_exceeds_budget,
    verification_web_search_enabled,
)


def review_concept_draft(fidelity_complete, run, split_after_tool_budget, split_review_units):
    """Review confirmed draft concepts, reuse paid children and preserve rewrite positions."""
    engine = run.engine
    if fidelity_complete and run.concept_review_enabled:
        run.complete_managed_stage("verification")
        run.current_phase = "concept_review"
        concept_full_body_sha256 = hashlib.sha256(
            run.summary_body_for_verification.encode("utf-8")).hexdigest()
        run.summary_resume_payload["concept_input_body_sha256"] = concept_full_body_sha256
        final_review_prompt = concept_prompt_for_budget(run,
            "final", run.summary_body_for_verification)
        if not verification_prompt_exceeds_budget(run,
                final_review_prompt, "concept",
                verification_web_search_enabled(run,
                    run.cfg.get("_video_verification_prechecked_identity") or {}, "concept")):
            concept_units = [("final", run.summary_body_for_verification, [], [], [])]
        else:
            try:
                concept_units = split_review_units(
                    "concept", run.summary_body_for_verification, [], [], [])
            except VerificationInputBudgetExceeded:
                concept_units = []
                run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                    "mode": "concept", "chunk_id": "final",
                    "draft": run.summary_body_for_verification,
                    "incomplete_reason": "input_budget",
                })
        def prior_concept_web_attempts(parent_id, parent_body):
            checkpoint = (run.summary_resume_payload.get("concept_checks") or {}).get(parent_id) or {}
            settings = checkpoint.get("settings") or {}
            if settings.get("prompt_digest") != hashlib.sha256(
                    concept_prompt_for_budget(run, parent_id, parent_body).encode("utf-8")
            ).hexdigest():
                return []
            outcomes = {(item.get("round_index"), item.get("tool_call_id")): item
                        for item in checkpoint.get("tool_outcomes") or []
                        if isinstance(item, dict) and item.get("name") == "lookup_concept_web"
                        and not item.get("reused_from_parent") and not item.get("replay_blocked")}
            blocks = parent_body.split("\n\n")
            attempts = []
            parsed_keys = set()
            for round_index, round_entry in enumerate(checkpoint.get("rounds") or []):
                for call in round_entry.get("tool_calls") or []:
                    if call.get("function", {}).get("name") != "lookup_concept_web":
                        continue
                    outcome = outcomes.get((round_index, call.get("id")))
                    if outcome is None:
                        continue
                    try:
                        args = json.loads(call["function"]["arguments"])
                        selected = {block_id: blocks[int(block_id[1:]) - 1]
                                    for block_id in args["block_ids"]}
                        if not selected or not isinstance(args["query"], str):
                            continue
                    except (KeyError, IndexError, TypeError, ValueError):
                        continue
                    attempts.append({"query": args["query"], "blocks": selected,
                                     "unique_in_parent": all(blocks.count(text) == 1
                                                             for text in selected.values()),
                                     "status": outcome.get("evidence_status"),
                                     "records": outcome.get("web_records") or []})
                    parsed_keys.add((round_index, call.get("id")))
            if parsed_keys != set(outcomes):
                # An attempted paid search with damaged arguments
                # cannot be identified safely after a split.
                attempts.append({"query": "*", "blocks": {},
                                 "status": "unavailable", "records": []})
            return attempts

        concept_web_reuse_by_unit = {}
        concept_window_rewrites = {}
        for unit_index, (unit_id, draft, sources, images,
                         scenes) in enumerate(concept_units):
            original_draft = draft
            if unit_id.startswith("window-"):
                draft = (run.summary_resume_payload["summary_body"]
                         if draft == run.summary_body_for_verification
                         else concept_window_rewrites.get(draft, draft))
            try:
                edited, result = run_verification(run,
                    mode="concept", chunk_id=unit_id,
                    summary_body_for_verification=draft,
                    verification_source_records=[],
                    verification_image_records=[],
                    summary_claims=[], scene_records=[],
                    full_body_sha256=concept_full_body_sha256,
                    concept_web_reuse=concept_web_reuse_by_unit.get(unit_id, ()),
                )
            except VerificationInputBudgetExceeded:
                children = (split_after_tool_budget(
                    "concept", unit_id, original_draft, [], [], [])
                    if draft == original_draft else [])
                if children and len(concept_units) + len(children) <= 128:
                    paid_web_attempts = [
                        *concept_web_reuse_by_unit.get(unit_id, ()),
                        *prior_concept_web_attempts(unit_id, original_draft),
                    ]
                    for child_id, *_ in children:
                        concept_web_reuse_by_unit[child_id] = paid_web_attempts
                    concept_units[unit_index + 1:unit_index + 1] = children
                    run.persist_partial_progress()
                    continue
                edited, result = draft, {"status": "needs_review", "incomplete_reason": "input_budget"}
            except TaskCancelledError:
                run.summary_resume_payload["concept_review_status"] = "cancelled"
                run.persist_partial_progress()
                raise
            except Exception:
                run.summary_resume_payload["concept_review_status"] = "failed"
                run.persist_partial_progress()
                raise
            concept_window_rewrites[original_draft] = edited
            run.summary_body_for_verification = run.summary_resume_payload["summary_body"]
            if result["status"] != "completed":
                run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                    "mode": "concept", "chunk_id": unit_id, "draft": edited,
                })
        run.summary_body_for_verification = run.summary_resume_payload["summary_body"]
        if (concept_units and all(unit_id.startswith("window-") for unit_id, *_ in concept_units)
                and not any(item.get("mode") == "concept"
                            for item in run.summary_resume_payload["incomplete_chunks"])):
            run.summary_resume_payload.setdefault("concept_checked_chunks", {})["final"] = {
                "draft": run.summary_body_for_verification, "inspection_status": "completed",
            }
        run.summary_resume_payload["concept_review_status"] = (
            "needs_review" if not concept_units or any(item.get("mode") == "concept"
                                  for item in run.summary_resume_payload["incomplete_chunks"])
            else "completed"
        )
        if run.summary_resume_payload["concept_review_status"] == "completed":
            run.summary_resume_payload["concept_output_body"] = run.summary_body_for_verification
        run.persist_partial_progress()
