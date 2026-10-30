"""Whole-draft fidelity/concept coverage, bounded review windows and recovery."""

from __future__ import annotations

from .review_fidelity import compare_fidelity_draft
from .review_windows import create_review_window_splitters
import hashlib
from .integrated_chunk_verification import (
    assemble_written_blocks,
    VerificationInputBudgetExceeded,
    build_cross_chunk_contradiction_prompt,
    split_cross_chunk_windows,
)
from pipeline_utils import summary_prompt_exceeds_input_budget
from .verification_contract import VIDEO_CONTRADICTION_INSPECTION_ENABLED
from .verification_calls import (
    contradiction_input_digest,
    run_verification,
)


def review_task_summary(run):
    """Compare cleaned STT/draft, then optionally review technical concepts."""
    split_review_units, split_after_tool_budget = create_review_window_splitters(
        run=run,
    )


    fidelity_complete = True
    fidelity_complete = compare_fidelity_draft(run, split_after_tool_budget, split_review_units)

    if run.video_mode is not None and run.image_caps:
        run.used_images_set.update(run.image_caps)

    retry_incomplete_chunks = (list((run.saved_summary_progress or {}).get("incomplete_chunks") or [])
                               if run.video_mode is None and not run.report_user_modified else [])
    for incomplete_chunk in retry_incomplete_chunks:
        if not isinstance(incomplete_chunk, dict):
            continue
        chunk_id = str(incomplete_chunk.get("chunk_id") or "")
        if chunk_id in run.rechecked_chunk_ids:
            continue
        draft = str(incomplete_chunk.get("draft") or "")
        if not chunk_id or not draft:
            raise RuntimeError("미완료 청크 검사 입력이 올바르지 않습니다.")
        if chunk_id.startswith("chunk-"):
            parts, indices = run.completed_writer_parts()
            try:
                number = int(chunk_id.removeprefix("chunk-")) - 1
                current_draft = parts[indices.index(number)]
            except (ValueError, IndexError) as error:
                raise RuntimeError("미완료 청크의 작성 위치가 올바르지 않습니다.") from error
            if draft != current_draft:
                # A completed whole-report pass may have edited this
                # block after its earlier incomplete inspection.
                # Recheck the current body with a fresh checkpoint.
                previous = (run.summary_resume_payload.get("integrated_checks") or {}).pop(chunk_id, None)
                if isinstance(previous, dict) and previous.get("rounds"):
                    run.summary_resume_payload.setdefault("integrated_history", []).append({
                        "chunk_id": chunk_id, "checkpoint": previous,
                    })
                draft = current_draft
                incomplete_chunk = {**incomplete_chunk, "draft": draft, "claims": []}
                run.summary_resume_payload["incomplete_chunks"] = [
                    incomplete_chunk if isinstance(item, dict) and item.get("chunk_id") == chunk_id else item
                    for item in run.summary_resume_payload.get("incomplete_chunks") or []
                ]
                run.persist_partial_progress()
        elif chunk_id == "final":
            current_draft = "\n\n".join(run.summary_resume_payload.get("written_chunk_bodies") or [])
            if current_draft and draft != current_draft:
                # A previous pass can apply an edit to the report
                # while leaving its final inspection incomplete.
                # Recheck the saved report body, not the stale draft.
                previous = (run.summary_resume_payload.get("integrated_checks") or {}).pop(chunk_id, None)
                if isinstance(previous, dict) and previous.get("rounds"):
                    run.summary_resume_payload.setdefault("integrated_history", []).append({
                        "chunk_id": chunk_id, "checkpoint": previous,
                    })
                draft = current_draft
                run.summary_body_for_verification = draft
                run.summary_resume_payload["summary_body"] = draft
                incomplete_chunk = {**incomplete_chunk, "draft": draft, "claims": []}
                run.summary_resume_payload["incomplete_chunks"] = [
                    incomplete_chunk if isinstance(item, dict) and item.get("chunk_id") == chunk_id else item
                    for item in run.summary_resume_payload.get("incomplete_chunks") or []
                ]
                run.persist_partial_progress()
        run.current_phase = "integrated_verification"
        try:
            edited_chunk, chunk_result = run_verification(run,
                mode="integrated", chunk_id=chunk_id,
                summary_body_for_verification=draft,
                verification_source_records=incomplete_chunk.get("source_records") or [],
                verification_image_records=incomplete_chunk.get("image_records") or [],
                summary_claims=incomplete_chunk.get("claims") or [],
                scene_records=incomplete_chunk.get("scene_records") or [],
                retry_incomplete=True,
            )
        except VerificationInputBudgetExceeded:
            edited_chunk, chunk_result = draft, {"status": "incomplete", "incomplete_reason": "input_budget"}
        run.summary_resume_payload["incomplete_chunks"] = [
            item for item in run.summary_resume_payload.get("incomplete_chunks") or []
            if not isinstance(item, dict) or item.get("chunk_id") != chunk_id
        ]
        if chunk_result["status"] != "complete":
            run.summary_resume_payload["incomplete_chunks"].append({**incomplete_chunk, "draft": edited_chunk})
        run.persist_partial_progress()

    if (VIDEO_CONTRADICTION_INSPECTION_ENABLED and run.verified_single_pipeline
            and run.video_mode is not None and not run.report_user_modified and len(run.chunks) > 1):
        contradiction_result = {"status": "complete", "source_looked_up": True}
        def written_report_parts():
            return run.completed_writer_parts()

        def window_t_ids(ids, window, body_length):
            if not ids:
                return []
            first = min(len(ids) - 1, int(window["start"] / max(1, body_length) * len(ids)))
            last = min(len(ids) - 1, int(window["end"] / max(1, body_length) * len(ids)))
            return ids[max(0, first - 2):min(len(ids), last + 3)][:5]

        initial_parts, _ = written_report_parts()
        initial_windows = [split_cross_chunk_windows(part) for part in initial_parts]
        max_revisions = max(8, 2 * sum(len(initial_windows[left]) * len(initial_windows[right])
                                      for left in range(len(initial_parts))
                                      for right in range(left + 1, len(initial_parts))) + 1)
        for _revision in range(max_revisions):
            written_parts, written_indices = written_report_parts()
            changed_body = False
            incomplete_pair = False
            for left in range(len(written_parts) - 2, -1, -1):
                if changed_body:
                    break
                for right in range(left + 1, len(written_parts)):
                    left_index, right_index = written_indices[left], written_indices[right]
                    left_ids = [str(item.get("source_id") or "")
                                for item in run.chunks[left_index].get("utterances", [])
                                if str(item.get("source_id") or "").startswith("T")]
                    right_ids = [str(item.get("source_id") or "")
                                 for item in run.chunks[right_index].get("utterances", [])
                                 if str(item.get("source_id") or "").startswith("T")]
                    pair_ids = set(left_ids + right_ids)
                    pair_records = [record for record in run.verification_source_records
                                    if record.get("source_id") in pair_ids]
                    left_windows = split_cross_chunk_windows(written_parts[left])
                    right_windows = split_cross_chunk_windows(written_parts[right])
                    if not left_windows or not right_windows:
                        incomplete_pair = True
                        continue
                    for left_window_index, left_window in enumerate(left_windows):
                        if changed_body:
                            break
                        for right_window_index, right_window in enumerate(right_windows):
                            check_id = (f"pair-{left_index + 1}-{right_index + 1}"
                                        f"-w{left_window_index + 1}-{right_window_index + 1}")
                            context = {
                                "left_draft": left_window["text"],
                                "right_draft": right_window["text"],
                                "left_t_ids": window_t_ids(left_ids, left_window, len(written_parts[left])),
                                "right_t_ids": window_t_ids(right_ids, right_window, len(written_parts[right])),
                            }
                            expected_prompt = build_cross_chunk_contradiction_prompt(
                                chunk_id=check_id, **context,
                            )
                            if summary_prompt_exceeds_input_budget(expected_prompt):
                                incomplete_pair = True
                                continue
                            previous_check = (run.summary_resume_payload.get("contradiction_checks") or {}).get(check_id) or {}
                            expected_digest = contradiction_input_digest(run,
                                expected_prompt,
                                pair_records, run.verification_image_records,
                            )
                            same_body = previous_check.get("output_body_sha256") == hashlib.sha256(
                                run.summary_body_for_verification.encode("utf-8")
                            ).hexdigest()
                            no_local_edit = (previous_check.get("input_body_sha256")
                                             == previous_check.get("output_body_sha256"))
                            quotes = previous_check.get("registered_quotes")
                            # A no-edit verdict remains valid when another chunk
                            # changes, provided its exact pair input and every
                            # registered quote still identify the same unique spans.
                            unchanged_spans = (no_local_edit and isinstance(quotes, list)
                                               and all(isinstance(quote, str) and quote
                                                       and run.summary_body_for_verification.count(quote) == 1
                                                       for quote in quotes))
                            if (previous_check.get("inspection_status") == "complete"
                                    and previous_check.get("source_looked_up")
                                    and previous_check.get("reuse_input_digest") == expected_digest
                                    and (same_body or unchanged_spans)):
                                continue
                            edited_body, pair_result = run_verification(run,
                                mode="contradiction", chunk_id=check_id,
                                summary_body_for_verification=run.summary_body_for_verification,
                                verification_source_records=pair_records,
                                verification_image_records=run.verification_image_records,
                                summary_claims=[], scene_records=[], boundary_context=context,
                                retry_incomplete=previous_check.get("inspection_status") == "incomplete",
                            )
                            if pair_result.get("status") != "complete" or not pair_result.get("source_looked_up"):
                                incomplete_pair = True
                            if edited_body != run.summary_body_for_verification:
                                changed_body = True
                            run.summary_body_for_verification = edited_body
                            run.summary_resume_payload["summary_body"] = edited_body
                            run.summary_resume_payload["full_markdown"] = run.full_md
                            run.persist_partial_progress()
                            if changed_body:
                                break
            if changed_body:
                continue
            if incomplete_pair:
                contradiction_result = {"status": "incomplete", "source_looked_up": False,
                                        "incomplete_reason": "cross_chunk_pair_unresolved"}
            break
        else:
            contradiction_result = {"status": "incomplete", "source_looked_up": False,
                                    "incomplete_reason": "cross_chunk_revision_limit"}
    elif run.verified_single_pipeline and run.video_mode is None and not run.report_user_modified:
        _final_body, contradiction_result = run_verification(run,
            mode="legacy", chunk_id="final",
            summary_body_for_verification=run.summary_body_for_verification,
            verification_source_records=run.verification_source_records,
            verification_image_records=run.verification_image_records,
            summary_claims=[], scene_records=[],
        )
    else:
        contradiction_result = {"status": "complete", "source_looked_up": True}
    unresolved_contradictions = run.video_mode is not None and (
        contradiction_result.get("status") != "complete"
        or (len(run.chunks) > 1 and not contradiction_result.get("source_looked_up"))
    )
    run.needs_review = run.video_mode is not None and (
        bool(run.summary_resume_payload.get("incomplete_chunks")) or unresolved_contradictions
        or run.summary_resume_payload.get("fidelity_status") != "completed"
        or run.report_user_modified
        or (run.concept_review_enabled and run.summary_resume_payload.get("concept_review_status")
            != "completed")
    )
    if run.video_mode is not None and run.concept_review_enabled:
        run.summary_resume_payload["verification_coverage"] = {
            "status": run.summary_resume_payload.get("concept_review_status"),
            "scope": "concept_only", "text_basis": "revised_summary",
            "raw_stt_semantics_verified": False}
    if run.video_mode is not None and not run.concept_review_enabled:
        run.summary_resume_payload["concept_review_status"] = "disabled"
    if run.video_mode is not None:
        if not run.needs_review and len(run.summary_resume_payload.get("written_chunk_bodies") or []) > 1:
            assembled = assemble_written_blocks(run.summary_resume_payload["written_chunk_bodies"])
            marker_at = run.full_md.find(run.usage_placeholder)
            if marker_at < 0:
                raise RuntimeError("정리본 본문 시작 위치를 확인할 수 없습니다.")
            prefix_end = marker_at + len(run.usage_placeholder)
            while prefix_end < len(run.full_md) and run.full_md[prefix_end] == "\n":
                prefix_end += 1
            run.full_md = run.full_md[:prefix_end] + assembled + "\n\n---\n"
            run.summary_resume_payload["assembly"] = {
                "operation": "move_merge_deduplicate_only",
                "source_block_count": len(run.summary_resume_payload["written_chunk_bodies"]),
                "body_sha256": hashlib.sha256(assembled.encode("utf-8")).hexdigest(),
            }
