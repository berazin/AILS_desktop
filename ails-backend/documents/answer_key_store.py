"""Versioned answer evidence and source provenance, separate from learner data."""
from __future__ import annotations

import os
import re
from pathlib import Path

from documents import problem_manager as problems
from documents.answer_key_sources import (
    PARSER_VERSION, digest, extract_regions, file_version, normalize_region,
    normalized_path, parse_candidates, validate_source, read_only_json,
)
from documents.answer_key_validity import link_validity, problem_version


def store_path(pdf_path, base_dir):
    base = problems._safe_base_dir(base_dir)
    return os.path.join(base, problems.HIDDEN_PROBLEM_DIR, "answer-keys", digest(normalized_path(pdf_path)) + ".json")


def load(pdf_path, base_dir):
    return problems._read_json(store_path(pdf_path, base_dir))


def raw_problem(pdf_path, base_dir, problem_id):
    descriptor, path = problems._load_problem(pdf_path, base_dir, problem_id)
    return problems._state_response(problems._validated_problem_state(descriptor, problems._read_json(path)))


def subquestions(problem):
    if problem.get("subquestion"):
        return {str(problem["subquestion"])}
    return set(re.findall(r"(?:^|\n)\s*\(([0-9a-zA-Z가-힣]+)\)", str(problem.get("problem_text") or "")))


def _invalidate(pdf_path, base_dir, ids, reason):
    for problem_id in ids:
        try:
            problems.invalidate_answer_key_grading(pdf_path, base_dir, problem_id, reason)
        except KeyError:
            continue  # Keep mappings for removed catalog entries as historical evidence.


def refresh_locked(data, pdf_path, base_dir, *, current_problems=None, problem_ids=None):
    """Refresh the requested links; management callers still validate all links."""
    changed = {}
    updated = False
    versions = {}
    links = data.get("links", {})
    selected = None if problem_ids is None else set(problem_ids)
    for problem_id, link in links.items():
        if selected is not None and problem_id not in selected:
            # Shared source changes still invalidate all affected saved grades.
            # A valid source needs no unrelated learner-state/catalog read.
            validity = link_validity(link, None, pdf_path, versions)
            if validity["reason_code"] == "answer_key_problem_missing":
                continue
        else:
            try:
                current = current_problems.get(problem_id) if current_problems is not None else raw_problem(pdf_path, base_dir, problem_id)
            except (KeyError, ValueError):
                current = None
            validity = link_validity(link, current, pdf_path, versions)
        if validity["status"] != link.get("status") or validity["reason"] != link.get("reason", "") or validity["reason_code"] != link.get("reason_code", ""):
            if validity["status"] == "stale" and link.get("status") == "confirmed":
                changed.setdefault(validity["reason_code"], []).append(problem_id)
            link.update(validity)
            updated = True
    for reason, ids in changed.items():
        _invalidate(pdf_path, base_dir, ids, reason)
    if updated:
        problems._atomic_write_json(store_path(pdf_path, base_dir), data)
    return data


def status(pdf_path, base_dir, problem, *, data=None, versions=None):
    """Public status has no answer, criteria, excerpt or candidate IDs."""
    if data is None:
        data = read_only_json(store_path(pdf_path, base_dir))
    link = data.get("links", {}).get(problem["id"])
    validity = link_validity(link, problem, pdf_path, versions)
    if not link:
        if problem["id"] in data.get("auto_connect_excluded", []):
            return {"status": "unlinked", "reason_code": "answer_key_auto_excluded", "reason": "이 문제는 답지 연결을 해제해 자동 연결에서 제외했습니다. 필요하면 답지를 직접 연결해 주세요."}
        held = data.get("auto_connect", {}).get("held", {}).get(problem["id"])
        if held:
            return {"status": "unlinked", "reason_code": "answer_key_auto_review", "reason": "PDF 안의 답지에 확인이 필요한 항목이 있습니다: " + held}
        return validity
    return {**validity, "kind": link["policy"]["kind"], "source_name": Path(link["source"]["path"]).name, "source_version": link["source"]["version"], "connection_method": link.get("verified_by", "user")}

def preview(payload):
    pdf_path, base_dir = payload["pdf_path"], payload["base_dir"]
    source = validate_source(payload.get("source_path") or pdf_path, base_dir, pdf_path)
    version = file_version(source)
    current_problems = [raw_problem(pdf_path, base_dir, descriptor["id"]) for descriptor in problems._load_catalog(pdf_path, base_dir)[1].get("problems", [])]
    detection = None
    if Path(source).suffix.lower() == ".pdf" and (payload.get("auto_detect") is True or not payload.get("region")):
        from documents.answer_key_discovery import discover
        detection = discover(source, current_problems, same_document=source == normalized_path(pdf_path))
        if file_version(source) != version:
            raise ValueError("답지 구간을 찾는 동안 파일이 바뀌었습니다. 다시 찾아 주세요.")
        if detection["status"] != "detected":
            return {"status": "unreadable", "reason": detection["reason"], "candidates": [], "rows": [], "links": {}, "cached": False, "preview_id": "", "discovery": detection,
                    "source": {"path": source, "version": file_version(source), "edition": str(payload.get("edition") or "")}}
        payload = {**payload, "region": detection["region"]}
    region = normalize_region(payload.get("region"))
    cache_id = digest({"version": version, "region": region, "parser": PARSER_VERSION})
    path = store_path(pdf_path, base_dir)
    with problems._path_lock(path):
        data = refresh_locked(problems._read_json(path), pdf_path, base_dir)
        cache_dir = os.path.join(os.path.dirname(path), "extractions")
        cache_path = os.path.join(cache_dir, cache_id + ".json")
        cached = problems._read_json(cache_path)
        reused = bool(cached)
        if not cached:
            try:
                pages = extract_regions(source, region)
                candidates = parse_candidates(pages, region)
                from documents.answer_key_matching import consolidate
                candidates = consolidate(candidates)
                extraction_status = "ready" if candidates else "unreadable" if pages else "unsupported"
                reason = "" if candidates else "번호/답을 읽지 못했습니다. 필요한 영역을 바꾸거나 텍스트/표로 옮겨 주세요." if pages else "PDF(텍스트/저장 OCR), UTF-8 TXT/MD/CSV/TSV만 지원합니다. 이미지는 OCR PDF로 변환해 주세요."
                cached = {"status": extraction_status, "reason": reason, "candidates": candidates}
            except Exception as error:
                cached = {"status": "unreadable", "reason": str(error), "candidates": []}
            if file_version(source) != version:
                raise ValueError("추출 도중 답지가 바뀌었습니다. 다시 미리보기 해 주세요.")
            # Failed OCR/index reads may recover without changing the PDF bytes.
            if cached["status"] != "unreadable":
                problems._atomic_write_json(cache_path, cached)
        source_meta = {"path": source, "version": version, "region": region, "parser_version": PARSER_VERSION, "edition": str(payload.get("edition") or "").strip()[:200], "auto_detected": bool(detection)}
        preview_id = digest({"source": source_meta, "cache": cache_id})
        data.setdefault("previews", {})[preview_id] = {"source": source_meta, **cached}
        data["last_source"] = source_meta
        problems._atomic_write_json(path, data)
        from documents.answer_key_visibility import protect_source
        protect_source(pdf_path, source_meta, enabled=payload.get("hide_answers", True) is not False)
        from documents.answer_key_matching import options_for
        rows = []
        for problem in current_problems:
            parts = subquestions(problem)
            options = options_for(problem, cached["candidates"], parts)
            risks = ["문제 번호·내용과 원본 답을 직접 확인해야 합니다."]
            if len(options) > 1:
                risks.append("중복 번호 또는 답 후보 충돌")
            if parts and not parts.issubset({item["subquestion"] for item in options}):
                risks.append("소문항 답 누락")
            if any(item["method"] == "saved_ocr" or item["confidence"] < .95 or "�" in item["answer"] for item in options):
                risks.append("OCR 판독 확인 필요")
            if any(item.get("continues_after_page") for item in options):
                risks.append("답지 표 행 미완성: 다음 페이지를 포함해 다시 확인해야 합니다.")
            rows.append({"problem_id": problem["id"], "problem_version": problem_version(problem), "problem": {key: problem.get(key) for key in ("chapter", "number", "subquestion", "problem_text", "page", "page_end", "label_bbox")}, "candidate_ids": [item["id"] for item in options], "risks": risks})
        from documents.answer_key_batch import annotate_rows
        annotate_rows(rows, cached["candidates"], current_problems, policy_from_payload)
        return {**cached, "preview_id": preview_id, "source": source_meta, "discovery": detection, "cached": reused, "rows": rows, "links": {key: {"status": item["status"], "candidate_id": item["candidate_id"]} for key, item in data.get("links", {}).items()}}


def policy_from_payload(candidate, payload, problem):
    kind = str(payload.get("kind") or candidate["kind"])
    if problem.get("answer_type") == "ox" and (not payload.get("kind") or kind == "short"):
        kind = "ox"  # Older previews and saved keys call these short answers.
    if not payload.get("kind"):
        from documents.answer_key_grading import choice_index, numeric_value
        if problem.get("answer_type") == "multiple_choice" and choice_index(candidate["answer"]) is not None:
            kind = "choice"
        elif kind == "choice" and problem.get("answer_type") == "short_answer" and numeric_value(candidate["answer"]):
            kind = "numeric"
    if kind not in {"choice", "short", "numeric", "essay", "ox"}:
        raise ValueError("지원하지 않는 채점 유형입니다.")
    if problem.get("answer_type") == "multiple_choice" and kind != "choice":
        raise ValueError("객관식 문항은 보기 번호를 확인해 결정적 비교로 연결해 주세요.")
    if problem.get("answer_type") == "code" and kind != "essay":
        raise ValueError("코드 문항은 확정 모범답과 명시된 기준을 사용하는 평가로 연결해 주세요.")
    if problem.get("answer_type") == "ox" and kind != "ox":
        raise ValueError("O/X 문항은 참·거짓 정답 비교로 연결해 주세요.")
    answer = str(payload.get("answer", candidate["answer"]) or "").strip()
    criteria = str(payload.get("criteria", candidate["criteria"]) or "").strip()
    if not answer or max(len(answer), len(criteria)) > 12_000:
        raise ValueError("문항의 답과 기준은 비어 있지 않은 12,000자 이하여야 합니다.")
    if "�" in answer:
        raise ValueError("판독 오류를 원문과 확인해 수정해 주세요.")
    parts = subquestions(problem)
    if parts and not problem.get("subquestion") and not parts.issubset(set(re.findall(r"\(([0-9a-zA-Z가-힣]+)\)", answer))):
        raise ValueError("모든 소문항의 답을 확인해 (1)/(a) 등의 표기를 포함해 주세요.")
    if parts and not problem.get("subquestion") and kind not in {"essay", "ox"}:
        raise ValueError("복합 소문항은 전체 답지 근거를 확인한 뒤 서술형 평가로 연결해 주세요.")
    alternatives = payload.get("accepted_answers") or []
    if not isinstance(alternatives, list) or len(alternatives) > 20 or any(not isinstance(item, str) or not item.strip() or len(item) > 1000 for item in alternatives):
        raise ValueError("명시적으로 확인한 동치 답 목록이 잘못되었습니다.")
    policy = {"kind": kind, "answer": answer, "criteria": criteria, "accepted_answers": alternatives}
    if kind == "ox":
        from documents.problem_binary_answers import binary_answers
        values = binary_answers(answer)
        if not values or (parts and not problem.get("subquestion") and set(values) != parts):
            raise ValueError("답지의 모든 O/X 또는 true/false 정답을 확인해 주세요.")
    if kind == "choice":
        from documents.answer_key_grading import choice_index
        index = choice_index(answer)
        if index is None or index >= len(problem.get("choices") or []) or problem.get("answer_type") != "multiple_choice":
            raise ValueError("객관식 답 번호와 문제의 보기를 확인해 주세요.")
        policy["selected_choice"] = index
    if kind == "numeric":
        from documents.answer_key_grading import numeric_value
        from decimal import Decimal, InvalidOperation
        if not numeric_value(answer):
            raise ValueError("수치 답은 하나의 유한 수와 명시된 단위여야 합니다.")
        try:
            tolerance = Decimal(str(payload.get("absolute_tolerance", "0")))
            if not tolerance.is_finite() or tolerance < 0:
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            raise ValueError("허용 오차는 답지/문항에서 확인한 0 이상의 유한 수여야 합니다.") from None
        policy["absolute_tolerance"] = str(tolerance)
        policy["unit"] = numeric_value(answer)[1]
    return policy


def confirm(payload):
    pdf_path, base_dir, problem_id = payload["pdf_path"], payload["base_dir"], payload["problem_id"]
    path = store_path(pdf_path, base_dir)
    with problems._path_lock(path):
        data = refresh_locked(problems._read_json(path), pdf_path, base_dir)
        if payload.get("unlink") is True:
            data["auto_connect_excluded"] = sorted(set(data.get("auto_connect_excluded", [])) | {problem_id})
            old = data.setdefault("links", {}).pop(problem_id, None)
            if old:
                data.setdefault("history", []).append(old)
                _invalidate(pdf_path, base_dir, [problem_id], "unlinked")
            problems._atomic_write_json(path, data)
            return {"problem": problems.get_pdf_problem(pdf_path, base_dir, problem_id), "status": "unlinked"}
        link = prepare_confirmed_link(data, pdf_path, base_dir, problem_id, payload)
        save_confirmed_links(data, pdf_path, base_dir, [link])
        return {"status": "confirmed", "problem": problems.get_pdf_problem(pdf_path, base_dir, problem_id)}


def prepare_confirmed_link(data, pdf_path, base_dir, problem_id, payload):
    item = data.get("previews", {}).get(payload.get("preview_id"))
    if not item or item["status"] != "ready":
        raise ValueError("답지 미리보기를 먼저 확인해 주세요.")
    if file_version(item["source"]["path"]) != item["source"]["version"]:
        raise ValueError("답지가 바뀌었습니다. 새 버전으로 미리보기 해 주세요.")
    candidate = next((row for row in item["candidates"] if row["id"] == payload.get("candidate_id")), None)
    if not candidate:
        raise ValueError("답 후보를 선택해 주세요.")
    if candidate.get("continues_after_page") and "answer" not in payload:
        raise ValueError("답지 표 행이 다음 페이지로 이어집니다. 전체 행을 포함하거나 원문에서 확인한 완전한 답을 입력해 주세요.")
    problem = raw_problem(pdf_path, base_dir, problem_id)
    if payload.get("problem_version") != problem_version(problem):
        raise ValueError("문제 내용이 바뀌었습니다. 미리보기를 다시 확인해 주세요.")
    if payload.get("verified") is not True or payload.get("edition_verified") is not True:
        raise ValueError("문제 번호·소문항·내용과 원본 답을 확인해야 연결할 수 있습니다.")
    note = str(payload.get("verification_note") or "").strip()
    if not note:
        raise ValueError("확인한 근거 또는 수정 이유를 남겨 주세요.")
    policy = policy_from_payload(candidate, payload, problem)
    from documents.answer_key_links import build_link
    return build_link(problem, candidate, item["source"], pdf_path, policy, subquestions(problem), verified_by="user", note=note)


def save_confirmed_links(data, pdf_path, base_dir, links):
    changed = []
    for prepared in links:
        link = dict(prepared)
        problem_id = link.pop("problem_id")
        old = data.setdefault("links", {}).get(problem_id)
        if old and old["revision"] != link["revision"]:
            data.setdefault("history", []).append(old)
            changed.append(problem_id)
        data["links"][problem_id] = link
        if link.get("verified_by") == "user" and problem_id in data.get("auto_connect_excluded", []):
            data["auto_connect_excluded"].remove(problem_id)
    _invalidate(pdf_path, base_dir, changed, "mapping_changed")
    problems._atomic_write_json(store_path(pdf_path, base_dir), data)



def management(payload):
    """Explicit management view may reveal answers; ordinary problem APIs never do."""
    pdf_path, base_dir = payload["pdf_path"], payload["base_dir"]
    path = store_path(pdf_path, base_dir)
    with problems._path_lock(path):
        data = refresh_locked(problems._read_json(path), pdf_path, base_dir)
        link = data.get("links", {}).get(payload["problem_id"])
        return {"link": link, "source": link["source"] if link else data.get("last_source")}
