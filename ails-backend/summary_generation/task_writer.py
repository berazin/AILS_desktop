"""Summary authoring and writer-ledger migration, independent of source acquisition."""

from __future__ import annotations

from .writer_resume import restore_writer_ledger
from .writer_inputs import prepare_writer_inputs
from common import (
    append_status_log,
    build_usage_event,
    emit_debug_trace,
    re,
)
from .claim_verification import (
    build_single_summary_prompt,
    call_deepseek_single_summary,
    parse_summary_bundle,
    restore_summary_image_links,
)
from .video_modes import (
    assign_visual_events_to_chunks,
    attach_visual_events_to_chunks,
)
from pipeline_utils import (
    SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS,
    build_chunk_image_prompt_context,
    build_context_bookmark,
    build_missing_final_sections_prompt,
    build_summary_resume_progress,
    build_summary_prompt,
    extract_outline,
    extract_used_heading_keys,
    extract_used_section_titles,
    has_fun_fact_section,
    has_mastery_or_quiz_section,
    normalize_image_links,
    normalize_markdown_image_link_sizes,
    normalize_markdown_tables,
    should_generate_summary_supplement,
    split_timed_summary_chunk,
    split_text,
    strip_more_markers,
    strip_summary_restart_artifacts,
    summarize_timed_chunk_range,
    summary_prompt_exceeds_input_budget,
    trim_chunk_boundary_overlap,
)
from providers import (
    call_ai_summary,
    continue_summary_if_needed,
)


def write_task_summary(run):
    """Pin writer identity, restore its ledger and write missing chunks."""
    engine = run.engine
    prepare_writer_inputs(run)
    restore_writer_ledger(run)

    def split_chunk_for_integrated_budget(chunk_index, source_chunk):
        pieces = split_timed_summary_chunk(source_chunk)
        if not pieces and not source_chunk.get("timed"):
            plain_text = str(source_chunk.get("plain_text") or source_chunk.get("text") or "").strip()
            halves = split_text(plain_text, limit=max(1, len(plain_text) // 2))
            if len(halves) > 1:
                pieces = [{"text": part, "plain_text": part, "start": None,
                           "end": None, "timed": False} for part in halves]
        if len(pieces) < 2:
            return False
        if source_chunk.get("timed"):
            first = float(source_chunk.get("start") or 0)
            last = float(source_chunk.get("end") or first)
            events = [event for event in run.video_visual_events
                      if isinstance(event, dict) and not event.get("duplicate_of")
                      and first <= float(event.get("timestamp") or 0) <= last]
        else:
            events = (run.video_visual_events if "[영상 시각 이벤트]" in str(source_chunk.get("text") or "")
                      else [])
        run.chunks[chunk_index:chunk_index + 1] = attach_visual_events_to_chunks(pieces, events)
        return True

    while run.idx < len(run.chunks):
        run.current_phase = "summary"
        chunk = run.chunks[run.idx]
        engine.check_cancel_requested()
        is_one_shot = bool(isinstance(chunk, dict) and chunk.get("one_shot"))
        chunk_text = str(chunk.get("text", "") if isinstance(chunk, dict) else chunk or "").strip()
        chunk_start_time = chunk.get("start") if isinstance(chunk, dict) and chunk.get("timed") else None
        chunk_end_time = chunk.get("end") if isinstance(chunk, dict) and chunk.get("timed") else None
        chunk_range_text = summarize_timed_chunk_range(chunk) if isinstance(chunk, dict) else ""
        if chunk_range_text:
            append_status_log(
                engine.status["logs"],
                f"요약 청크 처리 중: {run.idx+1}/{len(run.chunks)} (길이 {len(chunk_text):,}자, 시간 {chunk_range_text})",
            )
        else:
            append_status_log(
                engine.status["logs"],
                f"요약 청크 처리 중: {run.idx+1}/{len(run.chunks)} (길이 {len(chunk_text):,}자)",
            )
        is_final_chunk = run.idx == len(run.chunks) - 1
        if run.verified_single_pipeline:
            if len(run.chunks) == 1:
                chunk_img_str = ""
                selected_image_names = list((run.image_caps or {}).keys())
            else:
                chunk_img_str, selected_image_names = build_chunk_image_prompt_context(
                    run.image_caps,
                    run.image_link_dir,
                    run.idx,
                    len(run.chunks),
                    max_images=20,
                    summary_provider=run.resolved_summary_provider,
                    summary_model_name=run.resolved_summary_model_name,
                    excluded_image_names=run.used_images_set,
                    return_selected_names=True,
                    image_meta=run.image_meta if run.has_timed_image_meta and chunk_start_time is not None and chunk_end_time is not None else None,
                    chunk_start_time=chunk_start_time,
                    chunk_end_time=chunk_end_time,
                    padding_seconds=5.0,
                )
        else:
            chunk_img_str, selected_image_names = build_chunk_image_prompt_context(
                run.image_caps,
                run.image_link_dir,
                run.idx,
                len(run.chunks),
                max_images=20,
                summary_provider=run.resolved_summary_provider,
                summary_model_name=run.resolved_summary_model_name,
                excluded_image_names=run.used_images_set,
                return_selected_names=True,
                image_meta=run.image_meta if run.has_timed_image_meta and chunk_start_time is not None and chunk_end_time is not None else None,
                chunk_start_time=chunk_start_time,
                chunk_end_time=chunk_end_time,
                padding_seconds=5.0,
            )
        if run.image_caps:
            append_status_log(
                engine.status["logs"],
                f"요약 청크 이미지 매칭: chunk={run.idx+1}/{len(run.chunks)}, "
                f"time={chunk_range_text or 'unknown'}, images={len(selected_image_names)}",
            )
            emit_debug_trace(
                run.cfg,
                f"요약 청크 {run.idx+1}/{len(run.chunks)} 이미지 캡션 후보",
                chunk_img_str,
                "process",
            )
        if run.verified_single_pipeline:
            chunk_image_caps = {
                name: run.image_caps[name]
                for name in selected_image_names
                if name in run.image_caps
            }
            chunk_source_ids = {
                item.get("source_id") for item in chunk.get("utterances", [])
            } if chunk.get("timed") and run.timed_source_records else set()
            chunk_scene_analysis = assign_visual_events_to_chunks(
                run.chunks, run.video_visual_events,
            )[run.idx] if run.video_mode is not None else []
            prompt, chunk_source_records, chunk_image_records, chunk_source_payload = build_single_summary_prompt(
                (str(chunk.get("plain_text") or chunk_text)
                 if run.video_mode is not None and not chunk.get("timed") else chunk_text),
                timed_source_records=([
                    record for record in run.timed_source_records
                    if record["source_id"] in chunk_source_ids
                ] if chunk.get("timed") and run.timed_source_records else None),
                image_captions=chunk_image_caps,
                scene_analysis=chunk_scene_analysis,
                collect_claims=run.video_mode is None,
                image_link_dir=run.image_link_dir,
                content_instruction=run.video_content_instruction,
                language=run.cfg.get('language'),
                source_id_start=len(run.verification_source_records) + 1,
                image_id_start=len(run.verification_image_records) + 1,
                claim_id_start=len(run.summary_claims) + 1,
                part_info=f"{run.idx+1}/{len(run.chunks)}" if len(run.chunks) > 1 else "",
                return_source_payload=True,
            )
            if run.video_mode is not None:
                run.summary_resume_payload["source_payload"] = chunk_source_payload
        else:
            prompt = build_summary_prompt(
                run.task.get('prompt_template', run.cfg['prompt_template']),
                chunk=chunk_text,
                image_list_str=chunk_img_str,
                image_dir=run.image_link_dir,
                part_info=f"{run.idx+1}/{len(run.chunks)}",
                current_outline=extract_outline(run.full_md),
                used_section_titles=extract_used_section_titles(run.full_md),
                rolling_summary="",
                bookmark=run.bookmark_text,
                mastery_instruction="",
                summary_provider=run.resolved_summary_provider,
                summary_model_name=run.resolved_summary_model_name,
                content_instruction=run.video_content_instruction,
                language=run.cfg.get('language'),
            )
        if summary_prompt_exceeds_input_budget(
                prompt, max_input_tokens=run.video_writer_limit if run.video_mode is not None
                else SUMMARY_ONE_SHOT_MAX_INPUT_TOKENS):
            split_chunks = split_timed_summary_chunk(chunk) if run.video_mode is None else []
            if (split_chunks and run.video_mode is None) or (
                    run.video_mode is not None and split_chunk_for_integrated_budget(run.idx, chunk)):
                if run.video_mode is None:
                    run.chunks[run.idx:run.idx + 1] = split_chunks
                append_status_log(
                    engine.status["logs"],
                    f"요약 프롬프트가 모델 안전 입력 예산({run.video_writer_limit:,}토큰)을 넘어 시간 청크를 더 작게 나눕니다. "
                    f"{chunk_range_text or 'unknown'} -> {len(run.chunks)} total chunks",
                )
                continue
            append_status_log(
                engine.status["logs"],
                "요약 프롬프트가 모델 안전 입력 예산을 넘었지만 더 나눌 타임스탬프 구간이 없습니다.",
            )
            raise RuntimeError("요약 입력을 모델 예산 안으로 분할할 수 없습니다.")

        if run.verified_single_pipeline:
            summary_call = run.cfg.get("_managed_summary_call")
            if callable(summary_call):
                raw_bundle, run.last_m, summary_usage = summary_call(
                    prompt, {**run.cfg, "_summary_json_bundle": True}, engine.status["logs"],
                )
            else:
                raw_bundle, run.last_m, summary_usage = call_deepseek_single_summary(
                    prompt, run.cfg, log_list=engine.status["logs"],
                )
            raw_bundle = restore_summary_image_links(raw_bundle, chunk_image_records)
            run.usage_events.append(build_usage_event("summary", run.last_m, summary_usage, input_type="text"))
            bundle = parse_summary_bundle(
                raw_bundle,
                valid_evidence_ids=[
                    item["source_id"]
                    for item in [*chunk_source_records, *chunk_image_records]
                ],
                allow_unknown_t_ids=run.video_mode is not None,
            )
            resp = bundle["summary_markdown"]
            claim_start = len(run.summary_claims) + 1
            for offset, claim in enumerate(bundle["claims"]):
                run.summary_claims.append({**claim, "claim_id": f"C{claim_start + offset:03d}"})
            run.verification_source_records.extend(chunk_source_records)
            run.verification_image_records.extend(chunk_image_records)
            raw_summary_response_len = len(str(resp or ""))
        else:
            resp, run.last_m, summary_usage = call_ai_summary(prompt, run.cfg, engine.status["logs"])
            raw_summary_response_len = len(str(resp or ""))
            run.usage_events.append(build_usage_event("summary", run.last_m, summary_usage, input_type="text"))
        if not run.verified_single_pipeline:
            resp, run.last_m = continue_summary_if_needed(prompt, resp, run.cfg, engine.status["logs"], run.usage_events, run.last_m)
        emit_debug_trace(
            run.cfg,
            f"요약 청크 {run.idx+1}/{len(run.chunks)} 모델 응답 원본",
            resp,
            "response",
        )
        continued_summary_response_len = len(str(resp or ""))
        if continued_summary_response_len != raw_summary_response_len:
            append_status_log(
                engine.status["logs"],
                f"요약 응답 길이: 최초 {raw_summary_response_len:,}자 -> 이어쓰기 포함 {continued_summary_response_len:,}자",
            )
        else:
            append_status_log(
                engine.status["logs"],
                f"요약 응답 길이: {continued_summary_response_len:,}자",
            )
        if False:
            parts = re.split(r'\n---\n|\n--- \n', resp, maxsplit=1)
            if len(parts) > 1:
                resp = parts[1].strip()
            else:
                resp = re.sub(r'#.*?요약.*?\n', '', resp)
                resp = re.sub(r'- \[.*?\].*?\n(?:.*?\n){0,3}', '', resp)
        resp = strip_summary_restart_artifacts(resp, used_heading_keys=extract_used_heading_keys(run.full_md))

        resp = normalize_image_links(resp, run.image_dir_name, run.used_images_set)
        resp = normalize_markdown_image_link_sizes(resp)
        resp = normalize_markdown_tables(resp)
        emit_debug_trace(
            run.cfg,
            f"요약 청크 {run.idx+1}/{len(run.chunks)} 링크/표 정규화 후",
            resp,
            "process",
        )

        resp = trim_chunk_boundary_overlap(run.full_md[-1200:], resp)
        if is_final_chunk and not run.verified_single_pipeline and should_generate_summary_supplement(run.task):
            final_body = strip_more_markers(resp)
            need_fun_fact = not has_fun_fact_section(final_body)
            need_mastery = not has_mastery_or_quiz_section(final_body)
            if not is_one_shot and (need_fun_fact or need_mastery):
                engine.check_cancel_requested()
                append_status_log(engine.status["logs"], "마지막 파트 보강 생성 중...")
                followup_prompt = build_missing_final_sections_prompt(
                    chunk_text,
                    f"{run.full_md}\n\n{final_body}",
                    include_fun_fact=need_fun_fact,
                    include_mastery=need_mastery,
                )
                extra_resp, run.last_m, extra_usage = call_ai_summary(followup_prompt, run.cfg, engine.status["logs"])
                run.usage_events.append(build_usage_event("summary", run.last_m, extra_usage, input_type="text"))
                extra_resp, run.last_m = continue_summary_if_needed(
                    followup_prompt, extra_resp, run.cfg, engine.status["logs"], run.usage_events, run.last_m
                )
                extra_resp = strip_summary_restart_artifacts(
                    extra_resp,
                    used_heading_keys=extract_used_heading_keys(f"{run.full_md}\n\n{final_body}")
                )
                extra_resp = normalize_markdown_tables(extra_resp)
                extra_resp = strip_more_markers(extra_resp).strip()
                if extra_resp:
                    resp = f"{final_body.rstrip()}\n\n{extra_resp}"
        final_chunk_body = strip_more_markers(resp)
        final_chunk_body = final_chunk_body.strip()
        if run.verified_single_pipeline:
            run.summary_body_for_verification = "\n\n".join(
                part for part in [run.summary_body_for_verification, final_chunk_body] if part
            )
        emit_debug_trace(
            run.cfg,
            f"요약 청크 {run.idx+1}/{len(run.chunks)} 정리본 반영 본문",
            final_chunk_body,
            "process",
        )
        append_status_log(
            engine.status["logs"],
            f"요약 청크 최종 반영 길이: {len(final_chunk_body):,}자",
        )
        if final_chunk_body:
            run.full_md += f"\n\n{final_chunk_body}\n\n---\n"
            emit_debug_trace(
                run.cfg,
                f"요약 청크 {run.idx+1}/{len(run.chunks)} 누적 정리본",
                run.full_md,
                "process",
            )
            run.bookmark_text = build_context_bookmark(final_chunk_body)
        else:
            append_status_log(engine.status["logs"], "요약 청크 본문이 모두 중복으로 제거되어 문서에 추가하지 않았습니다.")
        append_status_log(engine.status["logs"], f"요약 청크 완료: {run.idx+1}/{len(run.chunks)}")
        run.idx += 1
        prior_summary_payload = run.summary_resume_payload or {}
        run.summary_resume_payload = build_summary_resume_progress(
            run.summary_resume_identity,
            next_chunk_index=run.idx,
            total_chunks=len(run.chunks),
            full_markdown=run.full_md,
            bookmark=run.bookmark_text,
            used_images=run.used_images_set,
            usage_events=run.usage_events,
            last_model=run.last_m,
            summary_body=run.summary_body_for_verification,
            claims=run.summary_claims,
            source_records=run.verification_source_records,
            image_records=run.verification_image_records,
            chunks=run.chunks,
            source_payload=prior_summary_payload.get("source_payload"),
        )
        run.summary_resume_payload["integrated_checks"] = dict(prior_summary_payload.get("integrated_checks") or {})
        run.summary_resume_payload["checked_chunks"] = dict(prior_summary_payload.get("checked_chunks") or {})
        run.summary_resume_payload["fidelity_checks"] = dict(prior_summary_payload.get("fidelity_checks") or {})
        run.summary_resume_payload["fidelity_checked_chunks"] = dict(prior_summary_payload.get("fidelity_checked_chunks") or {})
        run.summary_resume_payload["concept_checks"] = dict(prior_summary_payload.get("concept_checks") or {})
        run.summary_resume_payload["concept_checked_chunks"] = dict(prior_summary_payload.get("concept_checked_chunks") or {})
        if isinstance(prior_summary_payload.get("fidelity_output_body"), str):
            run.summary_resume_payload["fidelity_output_body"] = prior_summary_payload["fidelity_output_body"]
        for key in ("concept_input_body_sha256", "concept_output_body"):
            if isinstance(prior_summary_payload.get(key), str):
                run.summary_resume_payload[key] = prior_summary_payload[key]
        run.summary_resume_payload["contradiction_checks"] = dict(prior_summary_payload.get("contradiction_checks") or {})
        run.summary_resume_payload["written_chunk_indices"] = list(prior_summary_payload.get("written_chunk_indices") or [])
        run.summary_resume_payload["written_chunk_bodies"] = list(prior_summary_payload.get("written_chunk_bodies") or [])
        if final_chunk_body:
            run.summary_resume_payload["written_chunk_indices"].append(run.idx - 1)
            run.summary_resume_payload["written_chunk_bodies"].append(final_chunk_body)
        run.summary_resume_payload["integrated_history"] = list(prior_summary_payload.get("integrated_history") or [])
        run.summary_resume_payload["incomplete_chunks"] = list(prior_summary_payload.get("incomplete_chunks") or [])
        run.persist_partial_progress()
