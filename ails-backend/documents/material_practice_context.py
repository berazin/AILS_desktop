"""Bounded, source-aware topic hints for generated practice questions.

The model sees labels that also occur in the selected MD, never chat, bookmark,
or memory prose. Source IDs and counts are the only persisted context metadata.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping


SOURCE_NAMES = ("chat", "bookmarks", "memory")
_TOKENS = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}|[가-힣]{2,}|[0-9]{2,}")
_STOP = {"about", "also", "and", "are", "can", "for", "from", "how", "that", "the", "this", "what", "with",
         "그리고", "그러나", "대한", "때문", "문제", "보기", "설명", "정답", "학습", "해설", "내용", "자료", "정리", "차이"}
_CONFUSION = ("헷갈", "혼동", "모르", "어렵", "차이", "confus", "difficult", "difference", "why")


def normalize_context_sources(raw: object) -> dict[str, bool]:
    if raw is None:
        return {name: True for name in SOURCE_NAMES}
    if not isinstance(raw, Mapping):
        raise ValueError("context_sources must be an object.")
    sources = {}
    for name in SOURCE_NAMES:
        value = raw.get(name, True)
        if not isinstance(value, bool):
            raise ValueError(f"context_sources.{name} must be a boolean.")
        sources[name] = value
    return sources


def normalize_reference_pdfs(raw: object, base_dir: str) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("reference_pdf_paths must be a list.")
    root = os.path.realpath(base_dir)
    if not os.path.isdir(root):
        raise FileNotFoundError("Lecture material root is unavailable.")
    result = []
    seen = set()
    for value in raw:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Each reference PDF must be a path.")
        path = os.path.realpath(value.strip())
        try:
            within_root = os.path.commonpath([root, path]) == root
        except ValueError:
            within_root = False
        if not within_root or not os.path.isfile(path) or os.path.splitext(path)[1].casefold() != ".pdf":
            raise ValueError("Reference PDFs must be existing PDFs inside the learning material root.")
        key = os.path.normcase(path)
        if key not in seen:
            result.append(path)
            seen.add(key)
    return result


def normalize_home_chat(raw: object, *, max_pairs: int = 6, max_tokens: int = 1200) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > 2 * max_pairs or len(raw) % 2:
        raise ValueError("home_chat must contain up to six complete user/assistant pairs.")
    result = []
    seen = set()
    for index, item in enumerate(raw):
        if not isinstance(item, Mapping):
            raise ValueError("Invalid home_chat message.")
        role = item.get("role")
        message_id = str(item.get("id") or "").strip()
        content = item.get("content")
        if (role != ("user" if index % 2 == 0 else "assistant") or
                not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", message_id) or
                message_id in seen or not isinstance(content, str) or
                not content.strip() or len(content) > 4800):
            raise ValueError("home_chat must contain unique, ordered, completed message pairs.")
        seen.add(message_id)
        result.append({"id": message_id, "role": role, "content": content.strip()})
    if sum((len(item["content"]) + 3) // 4 for item in result) > max_tokens:
        raise ValueError("home_chat exceeds its token budget.")
    return result


def bookmarked_page_records(pdf_path: str, document_info: Mapping) -> list[dict]:
    """Read only selected, bookmarked PDF pages; omit pages without text."""
    bookmarks = document_info.get("bookmarks") or []
    if not bookmarks:
        return []
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    if reader.is_encrypted:
        return []
    document_id = str(document_info.get("document_id") or "")
    records = []
    for bookmark in bookmarks[:40]:
        try:
            page = int(bookmark.get("page"))
        except (TypeError, ValueError, AttributeError):
            continue
        if page < 1 or page > len(reader.pages):
            continue
        text = str(reader.pages[page - 1].extract_text() or "").strip()
        if text:
            records.append({
                "id": f"{document_id}:{page}",
                "text": f"{str(bookmark.get('label') or '')[:120]}\n{text[:4000]}",
            })
    return records


def _md_terms(markdown: str) -> dict[str, str]:
    terms = {}
    for match in _TOKENS.finditer(markdown[:12000]):
        token = match.group(0)
        key = token.casefold()
        if key not in _STOP and len(key) >= 3:
            terms.setdefault(key, token)
    return terms


def topic_hints_for_markdown(
    markdown: str,
    records: Mapping[str, list[dict]],
    sources: Mapping[str, bool],
    failures: Mapping[str, str] | None = None,
    *,
    total_budget_tokens: int = 1200,
    source_budget_tokens: int = 400,
    max_topic_labels: int = 100,
) -> tuple[list[str], dict]:
    """Return only MD vocabulary matched by enabled source signals."""
    failures = failures or {}
    terms = _md_terms(markdown)
    labels = []
    usage = {}
    total_cost = 0
    for source in SOURCE_NAMES:
        source_records = records.get(source, []) if sources.get(source) else []
        source_ids = []
        source_cost = 0
        reasons = []
        if not sources.get(source):
            usage[source] = {"status": "disabled", "used_count": 0, "source_ids": [], "skipped_reasons": []}
            continue
        if source in failures:
            usage[source] = {"status": "unavailable", "used_count": 0, "source_ids": [], "skipped_reasons": [failures[source]]}
            continue
        if not source_records:
            reason = "no_pdf_selected" if source == "bookmarks" and records.get("_pdf_count") == 0 else "no_text"
            usage[source] = {"status": "empty", "used_count": 0, "source_ids": [], "skipped_reasons": [reason]}
            continue
        candidates = []
        for rank, record in enumerate(reversed(source_records)):
            raw_text = str(record.get("text") or "")[:8000]
            found = [term for key, term in terms.items() if key in raw_text.casefold()]
            if not found:
                continue
            confused = any(marker in raw_text.casefold() for marker in _CONFUSION)
            for term in found:
                candidates.append((0 if confused else 1, rank, term, str(record.get("id") or "")))
        candidates.sort()
        used_labels = set()
        for _confusion_rank, _recency_rank, label, source_id in candidates:
            key = label.casefold()
            if key in used_labels:
                if source_id:
                    source_ids.append(source_id)
                continue
            if len(labels) >= max_topic_labels:
                reasons.append("budget_exceeded")
                break
            cost = max(1, (len(source) + len(label) + 5) // 4)
            if source_cost + cost > source_budget_tokens or total_cost + cost > total_budget_tokens:
                reasons.append("budget_exceeded")
                break
            used_labels.add(key)
            source_cost += cost
            total_cost += cost
            labels.append(f"{source}: {label}")
            source_ids.append(source_id)
        if not used_labels and not reasons:
            reasons.append("not_relevant")
        usage[source] = {
            "status": "used" if used_labels else "empty",
            "used_count": len(used_labels),
            "source_ids": list(dict.fromkeys(source_ids))[:50],
            "skipped_reasons": reasons,
        }
    return labels, usage
