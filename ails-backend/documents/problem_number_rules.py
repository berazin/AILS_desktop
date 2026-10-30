"""Problem-only label and reading-order rules; never change the OCR index."""
from __future__ import annotations

import re
from collections.abc import Mapping


_PADDED_LABEL = re.compile(
    r"^\s*(?P<number>0[1-9])(?=\s+\S|[A-Za-z가-힣#\"'“‘(\[]|\d{1,3}[A-Za-z가-힣#])"
)
_ILLUSTRATIONS = {"table", "image", "figure", "chart", "formula", "equation", "display_formula"}
_FURNITURE = {"header", "footer", "page_header", "page_footer", "header_image"}
_ATTACHMENTS = _ILLUSTRATIONS | {"figure_title", "vision_footnote", "other_text"}


def is_number_column(left: float) -> bool:
    return 0 <= left <= 0.12 or 0.18 <= left <= 0.30


def padded_label_match(text: str, left: float):
    return _PADDED_LABEL.match(text) if is_number_column(left) else None


def joined_numeric_label_match(text: str, left: float):
    return re.match(r"^\s*(?P<number>[1-9]\d{1,5})(?=[A-Za-z가-힣#])", text) if is_number_column(left) else None


def is_page_furniture(line: Mapping) -> bool:
    kind = str(line.get("block_type", "")).lower()
    return kind in _FURNITURE or (
        kind == "number" and float(line.get("top", 0)) >= 0.86
    )


def can_start_problem(line: Mapping) -> bool:
    kind = str(line.get("block_type", "")).lower()
    if kind in {"figure_title", "vision_footnote", "other_text"} and not re.search(
        r"[가-힣]{2}|[?？]|[A-Za-z]{3}\s+[A-Za-z]{3}", str(line.get("text", ""))
    ):
        return False
    if str(line.get("block_type", "")).lower() == "paragraph_title":
        text = str(line.get("text", "")).strip()
        if re.fullmatch(r"\d{1,3}(?:\s+[A-Za-z0-9'|•·→*#]){0,6}", text):
            return False
    return (
        str(line.get("block_type", "")).lower() not in _ILLUSTRATIONS
        and not is_page_furniture(line)
    )


def section_heading_top(line: Mapping, lines: list[dict]) -> float:
    """A gutter Quiz badge may begin a few pixels below its first question."""
    top = float(line.get("top", 0))
    if float(line.get("left", 0)) > 0.18:
        return top
    bottom = float((line.get("bbox") or {}).get("bottom", top + 0.04))
    for candidate in lines:
        candidate_top = float(candidate.get("top", 0))
        if not top - 0.015 <= candidate_top <= bottom:
            continue
        left = float(candidate.get("left", 0))
        text = str(candidate.get("text", ""))
        if can_start_problem(candidate) and is_number_column(left) and (
            padded_label_match(text, left) or re.match(r"^\s*\d{1,3}[.)]", text)
        ):
            top = min(top, candidate_top - 0.001)
    return top


def can_be_section_heading(line: Mapping) -> bool:
    text = re.sub(r"^[\s()\[\]•·]+|[\s()\[\]•·]+$", "", str(line.get("text", "")))
    return not (
        text.casefold() in {"문제", "questions", "question", "problems", "problem"}
        and line.get("block_type") not in {None, "", "paragraph_title"}
    )


def is_learning_chapter_opener(page: Mapping, title: str) -> bool:
    normalize = lambda text: re.sub(r"[^0-9A-Za-z가-힣]+", "", text).casefold()
    lines = page.get("lines") or []
    return any("학습목표" in normalize(str(line.get("text", ""))) for line in lines) and any(
        normalize(title) in normalize(str(line.get("text", "")))
        and "학습목표" not in normalize(str(line.get("text", "")))
        and len(normalize(str(line.get("text", "")))) <= len(normalize(title)) * 4 + 8
        and line.get("block_type") in {None, "", "paragraph_title"}
        for line in lines
    )


def is_end_matter_heading(line: Mapping) -> bool:
    return (
        line.get("block_type") == "paragraph_title"
        and float(line.get("top", 1)) <= 0.30
        and bool(re.match(r"^\s*(?:찾아보기|색인|참고\s*문헌|저자\s*소개|index|references|bibliography)(?:\s|$)",
                          str(line.get("text", "")), re.IGNORECASE))
    )


def normalized_body_heading(line: Mapping) -> str:
    text = re.sub(r"\s+", " ", str(line.get("text", ""))).strip()
    if line.get("block_type") == "paragraph_title":
        text = re.sub(r"^(\d{1,2})[,，](\d{1,2})(?=\s|[A-Za-z가-힣])", r"\1.\2", text)
    return text


def problem_reading_blocks(blocks: list[dict], words_by_block: Mapping) -> list[dict]:
    """Place late-emitted illustrations at their position within the text column.

    Keep PP-Structure's relative text-column order. Table recognition can append
    its blocks after the page footer, despite the table belonging to an earlier
    question; geometric placement fixes only those non-text attachments.
    """
    result = list(blocks)
    boxes = {}
    for block in blocks:
        words = words_by_block.get(int(block.get("block_id", -1)), [])
        if words:
            boxes[int(block["block_id"])] = (
                min(float(w["left"]) for w in words),
                min(float(w["top"]) for w in words),
                max(float(w["right"]) for w in words),
            )
    for block in sorted(blocks, key=lambda b: boxes.get(int(b.get("block_id", -1)), (0, 2, 0))[1]):
        if str(block.get("type", "")).lower() not in _ATTACHMENTS:
            continue
        box = boxes.get(int(block.get("block_id", -1)))
        if box is None:
            continue
        center = (box[0] + box[2]) / 2
        anchors = []
        for other in blocks:
            if str(other.get("type", "")).lower() in _ATTACHMENTS | _FURNITURE | {"number"}:
                continue
            other_box = boxes.get(int(other.get("block_id", -1)))
            if (
                other_box and other_box[1] > box[1]
                and other_box[0] <= box[0] + 0.06
                and other_box[0] <= center
                and (center <= other_box[2] or center - other_box[0] <= 0.30)
            ):
                anchors.append((other_box[1], int(other.get("reading_order") or 0), other))
        if anchors:
            anchor = min(anchors, key=lambda item: item[:2])[2]
            result.remove(block)
            result.insert(result.index(anchor), block)
    return result
