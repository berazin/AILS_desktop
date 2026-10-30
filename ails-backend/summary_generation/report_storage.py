"""Report body boundaries, user-edit detection and atomic publication."""

from __future__ import annotations

import hashlib
import difflib
import tempfile
from pathlib import Path
from common import (
    append_status_log,
    build_image_dir,
    build_report_path,
    SUMMARY_PIPELINE_VERSION,
    build_retry_task_payload,
    build_usage_markdown,
    clear_resume_state,
    os,
    re,
    remove_retry_registry_entry,
    time,
    upsert_retry_registry_entry,
)
from .claim_verification import strip_study_output_markers
from .managed_costs import (
    _COST_BLOCK,
    usage_cost_sources,
    report_content_digest,
)
from pipeline_utils import (
    normalize_latex_math_syntax,
    normalize_markdown_image_link_sizes,
    normalize_markdown_separators,
)


def ensure_report_heading(content, title):
    heading = f"# 📚 {str(title or '').strip() or 'untitled'} 요약"
    lines = str(content or "").replace("\r\n", "\n").strip().split("\n")
    if lines == [""]:
        return heading + "\n"

    meta_lines = []
    while lines:
        first = lines[0].strip()
        if first.startswith("<!--") and first.endswith("-->"):
            meta_lines.append(lines.pop(0).rstrip())
            while lines and not lines[0].strip():
                lines.pop(0)
            continue
        break

    if lines and re.match(r"^#\s+", lines[0].strip()):
        pieces = meta_lines + ([""] if meta_lines else []) + lines
        return "\n".join(pieces).strip() + "\n"

    pieces = meta_lines + ([""] if meta_lines else []) + [heading, ""] + lines
    return "\n".join(pieces).strip() + "\n"


def _replace_verified_summary_body(full_markdown: str, original_body: str, edited_body: str,
                                   usage_placeholder: str, *, chunk_parts=None, return_parts=False):
    """Put edits back into the report while retaining its chunk separators."""
    if edited_body == original_body:
        return (full_markdown, list(chunk_parts)) if return_parts else full_markdown
    placeholder_at = full_markdown.find(usage_placeholder)
    if placeholder_at < 0:
        raise ValueError("정리본 본문 시작 위치를 찾을 수 없습니다.")
    prefix_end = placeholder_at + len(usage_placeholder)
    while prefix_end < len(full_markdown) and full_markdown[prefix_end] == "\n":
        prefix_end += 1
    if prefix_end - placeholder_at - len(usage_placeholder) < 2:
        raise ValueError("정리본 본문 시작 위치를 찾을 수 없습니다.")
    prefix = full_markdown[:prefix_end]
    chunked_body = full_markdown[prefix_end:]
    final_separator = "\n\n---\n"
    chunk_separator = "\n\n---\n\n\n"
    if not chunked_body.endswith(final_separator):
        raise ValueError("정리본 본문 끝 위치를 확인할 수 없습니다.")
    chunked_body = chunked_body[:-len(final_separator)]
    boundaries = []
    if chunk_parts is not None:
        if (not isinstance(chunk_parts, list) or not chunk_parts
                or original_body != "\n\n".join(chunk_parts)
                or chunked_body != chunk_separator.join(chunk_parts)):
            raise ValueError("검증 초안과 저장할 정리본 청크가 다릅니다.")
        offset = 0
        for part in chunk_parts[:-1]:
            offset += len(part)
            boundaries.append(offset)
            offset += 2
    else:
        original_pos = report_pos = 0
        while original_pos < len(original_body):
            if (chunked_body.startswith(chunk_separator, report_pos)
                    and not original_body.startswith(chunk_separator, original_pos)
                    and original_body.startswith("\n\n", original_pos)):
                boundaries.append(original_pos)
                original_pos += 2
                report_pos += len(chunk_separator)
            elif report_pos < len(chunked_body) and original_body[original_pos] == chunked_body[report_pos]:
                original_pos += 1
                report_pos += 1
            else:
                raise ValueError("검증 초안과 저장할 정리본 본문이 다릅니다.")
        if report_pos != len(chunked_body):
            raise ValueError("검증 초안과 저장할 정리본 본문이 다릅니다.")
    edited_parts = [edited_body]
    if boundaries:
        matcher = difflib.SequenceMatcher(None, original_body, edited_body)
        insert_at = []
        for boundary in boundaries:
            matches = [new_start + boundary - old_start
                       for tag, old_start, old_end, new_start, _new_end in matcher.get_opcodes()
                       if tag == "equal" and old_start <= boundary and boundary + 2 <= old_end]
            if len(matches) != 1 or edited_body[matches[0]:matches[0] + 2] != "\n\n":
                raise ValueError("청크 경계에 걸친 교체는 안전하게 저장할 수 없습니다.")
            insert_at.append(matches[0])
        edited_parts = []
        part_start = 0
        for index in insert_at:
            edited_parts.append(edited_body[part_start:index])
            part_start = index + 2
        edited_parts.append(edited_body[part_start:])
        for index in sorted(insert_at, reverse=True):
            edited_body = edited_body[:index] + chunk_separator + edited_body[index + 2:]
    result = prefix + edited_body + final_separator
    return (result, edited_parts) if return_parts else result


def _extract_report_body_for_comparison(text: str) -> str:
    if not isinstance(text, str):
        return ""
    cleaned = _COST_BLOCK.sub("", text.replace("\r\n", "\n"))
    cleaned = re.sub(r"^<!-- AILS_SOURCE_URL: [^\r\n>]+ -->\s*", "", cleaned)
    cleaned = re.sub(r"^#\s+[^\r\n]+\s*", "", cleaned.strip())
    cleaned = cleaned.replace("<<<AI_USAGE_PLACEHOLDER>>>", "").strip()
    return normalize_markdown_separators(
        normalize_latex_math_syntax(
            normalize_markdown_image_link_sizes(cleaned)
        )
    ).strip()


def _report_user_edited(path: str, saved_summary: dict) -> bool:
    saved_hash = saved_summary.get("saved_report_sha256")
    report = Path(path)
    if not saved_hash or not report.is_file():
        return False
    raw = report.read_bytes()
    if hashlib.sha256(raw).hexdigest() == saved_hash:
        return False
    try:
        current_text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return True
    current_digest = report_content_digest(current_text)
    saved_digest = saved_summary.get("saved_report_content_sha256")
    if saved_digest and current_digest == saved_digest:
        return False

    current_body = _extract_report_body_for_comparison(current_text)
    if not current_body:
        return False

    # Older checkpoints hash the whole file, including the asynchronously
    # refreshed cost card. Check if the disk body matches any of the app-authored
    # stages (draft, initial body, fidelity output, concept output).
    candidates = [
        saved_summary.get("full_markdown"),
        saved_summary.get("concept_output_body"),
        saved_summary.get("fidelity_output_body"),
        saved_summary.get("fidelity_initial_body"),
        saved_summary.get("summary_body"),
    ]
    for cand in candidates:
        if isinstance(cand, str) and cand.strip():
            cand_body = _extract_report_body_for_comparison(cand)
            if cand_body and cand_body == current_body:
                return False
    return True


def _save_report_atomically(path: str, content: str, *, cancel_check=None) -> None:
    """Leave a previous complete report intact if writing or replacing fails."""
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", errors="replace", newline="", delete=False,
            dir=os.path.dirname(path), prefix=f".{os.path.basename(path)}.", suffix=".tmp",
        ) as handle:
            temporary_path = handle.name
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if callable(cancel_check):
            cancel_check()
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None and os.path.exists(temporary_path):
            os.unlink(temporary_path)


def save_task_report(run):
    """Render costs, preserve user edits and atomically publish the report."""
    engine = run.engine
    run.complete_managed_stage("summary")
    run.complete_managed_stage("verification")
    run.current_phase = "finalizing"
    run.full_md = strip_study_output_markers(run.full_md)
    run.full_md = normalize_markdown_separators(run.full_md)
    run.full_md = re.sub(
        r"(\*\*요약 엔진:\*\*\s*`)([^`]+)(`)",
        rf"\g<1>{run.last_m}\g<3>",
        run.full_md,
        count=1
    )
    engine_line = f"**STT 엔진:** `{run.stt_m}` | **요약 엔진:** `{run.last_m}`"
    if run.video_visual_model:
        engine_line += f" | **장면 분석 엔진:** `{run.video_visual_model}`"
    if run.verifier_m:
        if run.verifier_effort:
            engine_line += f" | **검증 엔진:** `{run.verifier_m} ({run.verifier_effort})`"
        else:
            engine_line += f" | **검증 엔진:** `{run.verifier_m}`"
    engine_line += f" | **파이프라인 버전:** `{SUMMARY_PIPELINE_VERSION}`"
    usage_block, usage_summary = build_usage_markdown(run.usage_events, engine_line=engine_line, pipeline_version=SUMMARY_PIPELINE_VERSION)
    usage_summary["byok_cost_sources"] = usage_cost_sources(run.usage_events)
    run.full_md = run.full_md.replace(run.usage_placeholder, usage_block, 1)
    run.full_md = ensure_report_heading(run.full_md, run.task['title'])
    run.full_md = normalize_markdown_separators(run.full_md)
    latex_normalized_md = normalize_latex_math_syntax(run.full_md)
    if latex_normalized_md != run.full_md:
        append_status_log(engine.status["logs"], "LaTeX 문법 후처리를 정리본에 반영했습니다.")
        run.full_md = latex_normalized_md
        run.full_md = normalize_markdown_separators(run.full_md)

    image_link_sized_md = normalize_markdown_image_link_sizes(run.full_md)
    if image_link_sized_md != run.full_md:
        append_status_log(engine.status["logs"], "이미지 링크 크기 후처리를 적용했습니다.")
        run.full_md = image_link_sized_md
        run.full_md = normalize_markdown_separators(run.full_md)

    engine.check_cancel_requested()
    md_output_path = build_report_path(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester)
    report_was_edited = _report_user_edited(md_output_path, run.summary_resume_payload)
    if report_was_edited:
        run.needs_review = True
        run.full_md = Path(md_output_path).read_text(encoding="utf-8")
        append_status_log(engine.status["logs"], "사용자가 수정한 정리본은 덮어쓰지 않았습니다.")
    else:
        _save_report_atomically(md_output_path, run.full_md, cancel_check=engine.check_cancel_requested)
        if run.needs_review:
            run.summary_resume_payload["saved_report_sha256"] = hashlib.sha256(Path(md_output_path).read_bytes()).hexdigest()
            run.summary_resume_payload["saved_report_content_sha256"] = report_content_digest(run.full_md)
            run.persist_partial_progress()
    append_status_log(engine.status["logs"], f"정리본 저장 완료: {os.path.basename(md_output_path)}")
    review_reason = ""
    if run.needs_review:
        fidelity_pending = run.summary_resume_payload.get("fidelity_status") != "completed"
        stage = "정제 STT·초안 대조" if fidelity_pending else "오개념 검토"
        checks = run.summary_resume_payload.get("fidelity_checks" if fidelity_pending else "concept_checks") or {}
        reasons = []
        for checkpoint in checks.values():
            if checkpoint.get("inspection_status") == "completed":
                continue
            rounds = checkpoint.get("rounds") or []
            latest = (rounds[-1].get("result") or {}) if rounds else {}
            reasons.extend(str(item.get("reason") or "").strip()
                           for item in latest.get("findings", []) if item.get("kind") == "uncertain")
        detail = next((reason for reason in reasons if reason), "저장된 검사부터 재시도할 수 있습니다.")
        review_reason = ("사용자가 수정한 정리본을 보존해 검토를 완료하지 않았습니다."
                         if report_was_edited or run.report_user_modified else f"{stage} 확인 필요: {detail[:350]}")
        append_status_log(engine.status["logs"], review_reason)

    if not run.needs_review and not run.task.get('skip_images'):
        try:
            append_status_log(engine.status["logs"], "미사용 이미지 정리 중...")
            idp = build_image_dir(run.cfg['md_save_path'], run.task['title'], grade=run.task_grade, semester=run.task_semester)
            if os.path.exists(idp):
                for img_file in os.listdir(idp):
                    if img_file.endswith('.jpg') and img_file not in run.used_images_set:
                        file_to_del = os.path.join(idp, img_file)
                        try: os.remove(file_to_del)
                        except Exception: pass
        except Exception as e:
            print(f"이미지 정리 오류: {e}")

    with engine.lock:
        run.task_results.append({
            "title": run.task['title'],
            "content": run.full_md,
            "model": (
                f"STT({run.stt_m}), 요약({run.last_m})"
                + (f", 장면({run.video_visual_model})" if run.video_visual_model else "")
                + (f", 검증({run.verifier_m}, {run.verifier_effort})" if run.verifier_m and run.verifier_effort
                   else f", 검증({run.verifier_m})" if run.verifier_m else "")
            ),
            "file_path": md_output_path,
            "status": "needs_review" if run.needs_review else "success",
            **({"last_error": review_reason} if run.needs_review else {}),
            "usage_summary": usage_summary
        })
    if run.needs_review:
        upsert_retry_registry_entry(run.cfg['md_save_path'], run.task['title'], {
            "status": "needs_review", "retry_task": build_retry_task_payload(run.task),
            "file_path": md_output_path, "saved_at": int(time.time()),
            "usage_summary": usage_summary,
            "content": review_reason, "last_error": review_reason,
            "last_logs": list(engine.status["logs"]),
        })
    else:
        remove_retry_registry_entry(run.cfg['md_save_path'], run.task['title'])
        clear_resume_state(run.resume_state_path, run.cfg['md_save_path'], run.task)
    engine.status["logs"].append("요약 저장됨: 검토 확인 필요" if run.needs_review else "요약 완료!")
    time.sleep(2)
