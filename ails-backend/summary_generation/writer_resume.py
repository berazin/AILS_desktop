"""Restore and migrate authored chunks without discarding paid results or user edits."""

from __future__ import annotations

from common import (
    append_status_log,
    build_report_path,
)
from .managed_costs import prior_usage_events
from .report_storage import _report_user_edited
from .verification_calls import run_verification


def restore_writer_ledger(run):
    """Restore and migrate authored chunks without discarding paid results or user edits."""
    engine = run.engine
    run.summary_resume_payload = run.saved_summary_progress or {}
    run.idx = 0
    if run.saved_summary_progress:
        saved_chunks = run.saved_summary_progress.get("chunks") or []
        if saved_chunks:
            run.chunks = saved_chunks
        run.idx = int(run.saved_summary_progress["next_chunk_index"])
        run.full_md = run.saved_summary_progress["full_markdown"]
        run.bookmark_text = run.saved_summary_progress["bookmark"] or run.bookmark_text
        run.used_images_set = set(run.saved_summary_progress["used_images"])
        run.usage_events = prior_usage_events(run.saved_summary_progress["usage_events"])
        run.last_m = run.saved_summary_progress["last_model"] or run.last_m
        run.summary_body_for_verification = run.saved_summary_progress["summary_body"]
        run.summary_claims = list(run.saved_summary_progress["claims"])
        run.verification_source_records = list(run.saved_summary_progress["source_records"])
        run.verification_image_records = list(run.saved_summary_progress["image_records"])
        append_status_log(
            engine.status["logs"],
            f"이전 실행의 요약 청크 {run.idx}/{len(run.chunks)}개를 재사용합니다.",
        )
    saved_report_path = build_report_path(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester)
    run.report_user_modified = _report_user_edited(saved_report_path, run.saved_summary_progress or {})
    if (run.saved_summary_progress and not run.report_user_modified
            and any(isinstance(item, dict) and item.get("chunk_id") == "final"
                    for item in run.saved_summary_progress.get("incomplete_chunks") or [])):
        saved_parts = run.saved_summary_progress.get("written_chunk_bodies")
        if isinstance(saved_parts, list) and saved_parts:
            current_body = "\n\n".join(saved_parts)
            if current_body != run.summary_body_for_verification:
                marker_at = run.full_md.find(run.usage_placeholder)
                prefix_end = marker_at + len(run.usage_placeholder)
                while prefix_end < len(run.full_md) and run.full_md[prefix_end] == "\n":
                    prefix_end += 1
                if (marker_at < 0 or run.full_md != run.full_md[:prefix_end]
                        + "\n\n---\n\n\n".join(saved_parts) + "\n\n---\n"):
                    raise RuntimeError("저장된 작성 청크와 검사 본문을 대응시킬 수 없습니다.")
                run.summary_body_for_verification = current_body
                run.summary_resume_payload["summary_body"] = current_body


    if run.video_mode is not None and run.saved_summary_progress and run.idx and not run.report_user_modified:
        restored_parts, restored_indices = run.completed_writer_parts()
        run.summary_resume_payload["written_chunk_bodies"] = restored_parts
        run.summary_resume_payload["written_chunk_indices"] = restored_indices

    pending_chunk = (run.summary_resume_payload or {}).get("pending_chunk")
    if run.video_mode is None and isinstance(pending_chunk, dict):
        draft = str(pending_chunk.get("draft") or "")
        chunk_id = str(pending_chunk.get("chunk_id") or "")
        if not draft or not chunk_id or not run.summary_body_for_verification.endswith(draft):
            raise RuntimeError("저장된 청크 검사 입력이 올바르지 않습니다.")
        run.current_phase = "integrated_verification"
        edited_chunk, chunk_result = run_verification(run,
            mode="integrated", chunk_id=chunk_id,
            summary_body_for_verification=draft,
            verification_source_records=pending_chunk.get("source_records") or [],
            verification_image_records=pending_chunk.get("image_records") or [],
            summary_claims=pending_chunk.get("claims") or [],
            scene_records=pending_chunk.get("scene_records") or [],
        )
        if chunk_result["status"] != "complete":
            run.summary_resume_payload.setdefault("incomplete_chunks", []).append({**pending_chunk, "draft": edited_chunk})
        run.summary_resume_payload.pop("pending_chunk", None)
        run.persist_partial_progress()

    # Old writer checkpoints may have no integrated ledger, or a
    # partially migrated ledger after an interrupted inspection.
    # Inspect every written part still missing a completed entry.
    written_indices = (run.summary_resume_payload or {}).get("written_chunk_indices")
    checked_ids = set(((run.summary_resume_payload or {}).get("checked_chunks") or {}).keys())
    has_unchecked_written_chunk = (
        "final" not in checked_ids and (
            not isinstance(written_indices, list)
            or any(f"chunk-{number + 1}" not in checked_ids for number in written_indices)
        )
    )
    if (run.video_mode is None and run.saved_summary_progress and run.idx
            and not run.report_user_modified and has_unchecked_written_chunk
            and not run.summary_resume_payload.get("pending_chunk")):
        legacy_parts, legacy_indices = run.completed_writer_parts()
        run.summary_resume_payload["written_chunk_indices"] = legacy_indices
        for legacy_part, legacy_index in zip(legacy_parts, legacy_indices):
            chunk_id = f"chunk-{legacy_index + 1}"
            if chunk_id in (run.summary_resume_payload.get("checked_chunks") or {}):
                continue
            source_records, image_records, scene_records = run.current_chunk_evidence(
                legacy_index, run.verification_image_records,
            )
            run.current_phase = "integrated_verification"
            edited_chunk, chunk_result = run_verification(run,
                mode="integrated", chunk_id=chunk_id,
                summary_body_for_verification=legacy_part,
                verification_source_records=source_records,
                verification_image_records=image_records,
                summary_claims=run.summary_claims, scene_records=scene_records,
            )
            if chunk_result["status"] != "complete":
                run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                    "chunk_id": chunk_id, "draft": edited_chunk,
                    "source_records": source_records, "image_records": image_records,
                    "claims": run.summary_claims, "scene_records": scene_records,
                })
            run.persist_partial_progress()

    # A completed writer chunk may outlive a failed report save.
    # Confirm its verifier policy again before skipping the writer
    # loop, and rerun only checks whose effective model changed.
    run.rechecked_chunk_ids = set()
    if run.video_mode is None and run.saved_summary_progress and not run.report_user_modified:
        for checked_id, checked_input in list((run.summary_resume_payload.get("checked_chunks") or {}).items()):
            if not isinstance(checked_input, dict):
                continue
            previous_check = (run.summary_resume_payload.get("integrated_checks") or {}).get(checked_id)
            if not isinstance(previous_check, dict):
                continue
            try:
                if checked_id == "final":
                    current_sources = run.timed_source_records
                    current_images = run.verification_image_records
                    current_scenes = [event for event in run.video_visual_events
                                      if isinstance(event, dict) and not event.get("duplicate_of")]
                else:
                    checked_index = int(checked_id.removeprefix("chunk-")) - 1
                    if checked_id != f"chunk-{checked_index + 1}" or not 0 <= checked_index < run.idx:
                        raise ValueError("invalid chunk ID")
                    current_sources, current_images, current_scenes = run.current_chunk_evidence(
                        checked_index, checked_input.get("image_records") or [],
                    )
            except (TypeError, ValueError, IndexError) as error:
                raise RuntimeError("저장된 청크 검사의 현재 근거를 확인할 수 없습니다.") from error
            run.current_phase = "verification"
            identity_call = run.cfg.get("_video_verification_model_identity")
            if not callable(identity_call):
                raise RuntimeError("영상 검증 모델 식별기가 연결되지 않았습니다.")
            current_identity = identity_call()
            if (not isinstance(current_identity, dict)
                    or not str(current_identity.get("model_id") or "")
                    or (current_identity.get("mode") == "managed"
                        and not current_identity.get("policy_revision"))):
                raise RuntimeError("영상 검증 모델을 확인할 수 없습니다.")
            previous_settings = previous_check.get("settings") or {}
            requested_web = (run.concept_review_enabled
                             and run.cfg.get("summary_verification_web_search_enabled") is True)
            selected_model = str(current_identity["model_id"])
            eligible_web = (
                current_identity.get("mode") == "managed"
                and selected_model in {"openai/gpt-5-nano", "openai/gpt-5.6-luna", "openai/gpt-6-luna"}
            ) or (
                current_identity.get("mode") == "byok"
                and str((run.cfg.get("_video_verification_selection") or {}).get("provider") or "").casefold() == "openai"
                and selected_model in {"gpt-5-nano", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-luna"}
            )
            enabled_web = (requested_web and eligible_web
                           and callable(run.cfg.get("_video_verification_web_search_call")))
            if (current_identity == previous_settings.get("effective_model")
                    and requested_web == previous_settings.get("web_search_requested")
                    and enabled_web == previous_settings.get("web_search_enabled")
                    and run.concept_review_enabled == previous_settings.get("concept_review_enabled")
                    and run.cfg.get("summary_verification_model_name") == previous_settings.get("model")
                    and run.cfg.get("ai_model_selection") == previous_settings.get("selection")
                    and current_sources == checked_input.get("source_records")
                    and current_images == checked_input.get("image_records")
                    and current_scenes == checked_input.get("scene_records")):
                continue
            prior_draft = str(checked_input.get("draft") or "")
            if not prior_draft:
                raise RuntimeError("저장된 청크 검사 본문 위치가 달라졌습니다.")
            if (current_sources != checked_input.get("source_records")
                    or current_images != checked_input.get("image_records")
                    or current_scenes != checked_input.get("scene_records")):
                run.summary_resume_payload.setdefault("integrated_history", []).append({
                    "chunk_id": checked_id, "checkpoint": previous_check,
                })
                run.summary_resume_payload.setdefault("integrated_checks", {}).pop(checked_id, None)
            edited_chunk, chunk_result = run_verification(run,
                mode="integrated", chunk_id=checked_id,
                summary_body_for_verification=prior_draft,
                verification_source_records=current_sources,
                verification_image_records=current_images,
                summary_claims=checked_input.get("claims") or [],
                scene_records=current_scenes,
                prechecked_identity=current_identity,
            )
            run.rechecked_chunk_ids.add(checked_id)
            run.summary_resume_payload["incomplete_chunks"] = [
                item for item in run.summary_resume_payload.get("incomplete_chunks") or []
                if not isinstance(item, dict) or item.get("chunk_id") != checked_id
            ]
            if chunk_result["status"] != "complete":
                run.summary_resume_payload.setdefault("incomplete_chunks", []).append({
                    "chunk_id": checked_id, "draft": edited_chunk,
                    "source_records": current_sources, "image_records": current_images,
                    "claims": checked_input.get("claims") or [],
                    "scene_records": current_scenes,
                })
            run.persist_partial_progress()
