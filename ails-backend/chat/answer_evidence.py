"""Provenance comes from selected retrieval chunks, never from answer page text."""
from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping


def file_revision(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _identity(item):
    data = [item.get(key) for key in ("path", "revision", "page_index")]
    if item.get("excerpt"):
        data.append(item["excerpt"])
    return hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()


def evidence_for_chunks(path, chunks):
    if not path or not chunks:
        return []
    path = os.path.abspath(path)
    try:
        revision = file_revision(path)
    except OSError:
        revision = ""
    result = []
    seen = set()
    for chunk in chunks:
        page = chunk.get("page")
        # Retrieval pages are one-based. Markdown's synthetic page 1 is not PDF evidence.
        index = page - 1 if type(page) is int and page > 0 and path.lower().endswith(".pdf") else None
        item = {"path": path, "title": os.path.basename(path), "revision": revision,
                "page_index": index, "status": "ready" if revision and index is not None else "unavailable"}
        excerpt = chunk.get("text") or chunk.get("snippet")
        if isinstance(excerpt, str) and 0 < len(excerpt) <= 8000:
            item["excerpt"] = excerpt
        item["id"] = _identity(item)
        if item["id"] not in seen:
            result.append(item)
            seen.add(item["id"])
    return result


def normalize_evidence(value):
    result = []
    seen = set()
    for raw in value[:100] if isinstance(value, list) else []:
        if not isinstance(raw, Mapping):
            continue
        item = {key: raw.get(key) for key in ("id", "path", "title", "revision", "page_index", "status")}
        if raw.get("excerpt"):
            if not isinstance(raw["excerpt"], str) or len(raw["excerpt"]) > 8000:
                continue
            item["excerpt"] = raw["excerpt"]
        if not all(isinstance(item[key], str) and len(item[key]) <= 4096 for key in ("id", "path", "title", "revision", "status")):
            continue
        if item["page_index"] is not None and (type(item["page_index"]) is not int or item["page_index"] < 0):
            continue
        if item["id"] != _identity(item) or item["id"] in seen:
            continue
        result.append(item)
        seen.add(item["id"])
    return result


def retained_evidence(evidence, chunks):
    """A retained page alone must not retain another excerpt on that page."""
    from chat.evidence_position import compact
    return [item for item in evidence if any(
        item.get("page_index") is not None and item["page_index"] + 1 == chunk.get("page")
        and chunk.get("text") and (not item.get("excerpt") or compact(item["excerpt"]) in compact(chunk["text"]))
        for chunk in chunks)]


def tool_evidence(original_rounds, reduced_rounds):
    """Keep only source locations whose text survived the tool budget reducer."""
    from chat.evidence_position import compact

    def retained_text(evidence, text):
        return [item for item in evidence if not item.get("excerpt")
                or compact(item["excerpt"]) in compact(text)]

    def results(rounds):
        for round_ in rounds if isinstance(rounds, list) else []:
            if not isinstance(round_, Mapping):
                continue
            values = round_.get("results")
            for result in values if isinstance(values, list) else []:
                if isinstance(result, Mapping):
                    yield result
    originals = {result.get("tool_call_id"): result.get("content", "") for result in results(original_rounds)}
    selected = []
    def parse(value):
        try:
            data = json.loads(value)
            if isinstance(data, dict) and isinstance(data.get("result"), str):
                return parse(data["result"])
            return data if isinstance(data, dict) else {}
        except (ValueError, TypeError):
            return {}
    for result in results(reduced_rounds):
        original = parse(originals.get(result.get("tool_call_id"), ""))
        reduced = parse(result.get("content", ""))
        # Search chunks share a document; other tools carry paths per item.
        if "chunks" in reduced:
            selected.extend(retained_evidence(original.get("evidence", []), reduced["chunks"]))
        if reduced.get("text") and reduced.get("path") == original.get("path"):
            selected.extend(retained_text(original.get("evidence", []), reduced["text"]))
        for item in reduced.get("results", []):
            if item.get("snippet") or item.get("text"):
                selected.extend(retained_text(item.get("evidence", []), item.get("text") or item["snippet"]))
    return normalize_evidence(selected)


def resolve_evidence(raw):
    items = normalize_evidence([raw])
    if not items:
        return {"status": "unavailable", "reason": "검증 가능한 근거 정보가 없습니다."}
    item = items[0]
    if item["page_index"] is None:
        return {"status": "unavailable", "reason": "PDF 페이지 정보가 없는 출처입니다."}
    try:
        revision = file_revision(item["path"])
    except OSError:
        return {"status": "missing", "reason": "원문 파일이 삭제되었거나 열 수 없습니다."}
    if revision != item["revision"]:
        return {"status": "changed", "reason": "답변 생성 후 원문이 변경되어 페이지를 확인할 수 없습니다."}
    try:
        from pypdf import PdfReader
        reader = PdfReader(item["path"])
        index = item["page_index"]
        if index >= len(reader.pages):
            return {"status": "unavailable", "reason": "근거 페이지가 PDF 범위를 벗어났습니다."}
        label = reader.page_labels[index]
    except Exception:
        return {"status": "unavailable", "reason": "PDF 페이지를 확인할 수 없습니다. 잠금 또는 파일 상태를 확인하세요."}
    from chat.evidence_position import resolve_position
    position = resolve_position(item["path"], index, item.get("excerpt"), reader)
    try:
        if file_revision(item["path"]) != revision:
            return {"status": "changed", "reason": "위치 확인 중 원문이 변경되었습니다."}
    except OSError:
        return {"status": "missing", "reason": "원문 파일을 열 수 없습니다."}
    return {"status": "ready", "path": item["path"], "page_index": index,
            "page": index + 1, "page_label": label, "revision": revision, **position}
