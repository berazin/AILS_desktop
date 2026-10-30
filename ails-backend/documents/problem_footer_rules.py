"""Exclude page footers from problem analysis without changing saved PDF text."""

from __future__ import annotations

import re
from collections import defaultdict
from statistics import median


_CHAPTER = re.compile(r"^\s*(?:(?:제\s*)?\d{1,2}\s*장(?:\s|$)|chapter\s*\d{1,2}\b)", re.I)
_PAGE_NUMBER = re.compile(r"^\s*[-–—]?\s*\d{1,4}(?:\s*[/·]\s*\d{1,4})?\s*[.\-–—]?\s*$")
_CHOICE = re.compile(r"^\s*(?:[①-⑳⓵-⓾❶-❿]|\(?[1-9]\))")
_CONTENT_BLOCKS = {"table", "image", "figure", "chart", "formula", "equation", "code"}


def _fragments(line: dict) -> list[dict]:
    """Separate footer title and page number joined into one geometric row."""
    words = sorted(line.get("words") or [], key=lambda word: float(word.get("left", 0)))
    if not words:
        return [dict(line)]
    groups = []
    right = -1.0
    for word in words:
        if not groups or float(word.get("left", 0)) - right > 0.18:
            groups.append([])
        groups[-1].append(word)
        right = max(right, float(word.get("right", 0)))
    if len(groups) == 1:
        return [dict(line)]
    return [dict(
        line,
        words=group,
        text=" ".join(str(word.get("text", "")).strip() for word in group).strip(),
        left=min(float(word["left"]) for word in group),
        top=min(float(word["top"]) for word in group),
        bbox={
            "left": min(float(word["left"]) for word in group),
            "top": min(float(word["top"]) for word in group),
            "right": max(float(word["right"]) for word in group),
            "bottom": max(float(word["bottom"]) for word in group),
        },
    ) for group in groups]


def _margin_candidate(line: dict) -> bool:
    box = line.get("bbox") or {}
    top = float(box.get("top", 0))
    left, right = float(box.get("left", 0)), float(box.get("right", 1))
    height = float(box.get("bottom", top)) - top
    # Text-only fallback rows have invented geometry; never classify those
    # as footers. Actual word bounds or layout block types supply the evidence.
    return bool(line.get("words")) and (
        0.90 <= top <= 1.0 and 0 < height <= 0.035
        and right - left <= 0.50 and (left <= 0.14 or right >= 0.86)
        and len(str(line.get("text", ""))) <= 160
    )


def filter_problem_footer_lines(pages: list[dict], *, is_question) -> list[dict]:
    """Remove isolated chapter/page labels and small repeated corner titles.

    All returned objects are analysis copies. OCR words, search data and PDF
    contents stay untouched; real questions and answer choices retain their
    original coordinates, even in the bottom margin.
    """
    prepared = []
    rows_by_page = []
    repetitions = defaultdict(set)
    for page in pages:
        lines = []
        rows = []
        for source in page.get("lines") or []:
            # Splitting body rows would change columns and problem numbering.
            parts = _fragments(source) if float(source.get("top", 0)) >= 0.90 else [dict(source)]
            rows.append((source, parts))
            lines.extend(parts)
            for line in parts:
                if _margin_candidate(line):
                    key = re.sub(r"\s+\d{1,4}\s*$", "", str(line.get("text", ""))).casefold()
                    repetitions[key].add(int(page["page"]))
        prepared.append(dict(page, lines=lines))
        rows_by_page.append(rows)

    for page, rows in zip(prepared, rows_by_page):
        lines = page["lines"]
        body_heights = [
            float(line["bbox"]["bottom"]) - float(line["bbox"]["top"])
            for line in lines if line.get("words") and line.get("bbox")
            and 0.10 <= float(line.get("top", 0)) < 0.90
        ]
        body_height = median(body_heights) if body_heights else 0.0
        kept = []
        for line in lines:
            kind = str(line.get("block_type", "")).lower()
            if kind in {"footer", "page_footer"} or (
                kind == "number" and float(line.get("top", 0)) >= 0.86
            ):
                continue
            text = str(line.get("text", "")).strip()
            if not _margin_candidate(line) or kind in _CONTENT_BLOCKS or _CHOICE.match(text) or is_question(text):
                kept.append(line)
                continue
            box = line["bbox"]
            top = float(box["top"])
            height = float(box["bottom"]) - top
            previous_bottom = max((
                float((other.get("bbox") or {}).get("bottom", other.get("top", 0)))
                for other in lines if float(other.get("top", 0)) < top - 0.005
            ), default=0.0)
            isolated = top - previous_bottom >= max(0.025, height * 1.5)
            key = re.sub(r"\s+\d{1,4}\s*$", "", text).casefold()
            repeated_small = len(repetitions[key]) >= 2 and height <= body_height * 0.95
            if not (isolated and (_CHAPTER.match(text) or _PAGE_NUMBER.fullmatch(text) or repeated_small)):
                kept.append(line)
        kept_ids = {id(line) for line in kept}
        # Keep body rows exactly as assembled unless a footer fragment was
        # removed. A wide space inside a real question is not a column split.
        page["lines"] = [
            line
            for source, parts in rows
            for line in (
                [dict(source)] if all(id(part) in kept_ids for part in parts)
                else [part for part in parts if id(part) in kept_ids]
            )
        ]
    return prepared
