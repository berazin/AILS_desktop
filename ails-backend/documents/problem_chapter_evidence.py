"""Require indexed body evidence before an outline can bound a problem set."""
from __future__ import annotations

import re
from collections.abc import Callable, Mapping

from documents.problem_number_rules import is_learning_chapter_opener, normalized_body_heading


def _normalized_title(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", value).casefold()


def outline_chapter_has_body_evidence(
    page: Mapping,
    title: str,
    *,
    canonical_title: Callable,
) -> bool:
    """Support intact titles, split chapter openers and numbered body sections.

    Generated outlines can turn answer rows into CHAPTER entries, even when
    their targets are unrelated question pages. An outline label alone cannot
    establish a chapter boundary in the indexed body.
    """
    match = re.match(r"^(\d{1,2})장(?:\s+(.*))?$", title)
    if not match:
        return False
    number, title_body = int(match[1]), match[2] or ""
    lines = list(page.get("lines", []))[:12]
    expected = _normalized_title(title)
    for line in lines:
        body_title = canonical_title(str(line.get("text", "")), page=int(page["page"]))
        if body_title and _normalized_title(body_title) == expected:
            return True

    if title_body and is_learning_chapter_opener(page, title_body):
        return True
    normalized_body = _normalized_title(title_body)
    if normalized_body and any(
        re.fullmatch(rf"\s*0*{number}\s*", str(line.get("text", "")))
        for line in lines
    ) and normalized_body in _normalized_title(" ".join(str(line.get("text", "")) for line in lines)):
        return True

    section = re.compile(rf"^\s*0*{number}\s*[.．]\s*\d{{1,2}}\s+\S")
    return any(
        section.match(normalized_body_heading(line))
        and str(line.get("block_type", "")) in {"", "paragraph_title", "title", "heading"}
        for line in lines
    )
