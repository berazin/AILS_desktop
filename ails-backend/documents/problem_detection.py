from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any

from pdf.pdf_ocr import (
    OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION,
    indexed_pdf_pages,
    mark_indexed_pdf_analysis_roles,
    pdf_ocr_status,
)
import pdf.pdf_structure as pdf_structure
from documents.problem_footer_rules import filter_problem_footer_lines
from documents.problem_chapter_evidence import outline_chapter_has_body_evidence
from documents.problem_answer_key_boundary import (
    ANSWER_KEY_HEADING_PATTERN as _ANSWER_KEY_HEADING_PATTERN, is_answer_key_heading,
)
from documents.problem_number_rules import (
    can_start_problem,
    can_be_section_heading,
    is_learning_chapter_opener,
    is_end_matter_heading,
    normalized_body_heading,
    is_number_column,
    padded_label_match,
    joined_numeric_label_match,
    problem_reading_blocks,
    section_heading_top,
)
from documents.problem_answering import (
    ANSWER_TYPE_CODE,
    ANSWER_TYPE_MULTIPLE_CHOICE,
    ANSWER_TYPE_SHORT_ANSWER,
    ANSWER_TYPE_UNKNOWN,
    MAX_ANSWER_CHARS,
    MAX_CHOICES,
    MAX_PROBLEM_CHARS,
    classify_problem_answer_type,
    normalize_answer_type,
    normalize_draft_answer,
)


PROBLEM_STATE_FILE = ".ails-problem.json"
HIDDEN_PROBLEM_DIR = ".ails-problems"
MAX_CHAPTER_NUMBER = 30
MAX_PROBLEM_NUMBER_GAP = 6
KIND_FOLDERS = {
    "practice": "연습 문제",
    "lab": "실습 문제",
    "quiz": "퀴즈",
}


def _pdf_fingerprint(path: str) -> str:
    pdf_stat = os.stat(path)
    payload = f"{pdf_stat.st_size}:{pdf_stat.st_mtime_ns}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


_INVALID_PATH_CHARS = re.compile(r"[<>:\"/\\|?*\x00-\x1f]")


def _safe_base_dir(base_dir: str) -> str:
    path = os.path.abspath(str(base_dir or ""))
    if not path or not os.path.isdir(path):
        raise ValueError("Invalid base directory.")
    return path


def _sanitize_folder_name(value: str, fallback: str) -> str:
    name = _INVALID_PATH_CHARS.sub("", str(value or "")).strip()
    if not name:
        name = fallback
    if name.upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}:
        name = f"{name}_"
    return name[:96].rstrip(" .") or fallback


_SECTION_PATTERN = re.compile(r"(?P<kind>연습|실습)\s*문제", re.IGNORECASE)
_SECTION_HEADING_PATTERN = re.compile(
    r"^\s*(?P<kind>연습|실습)\s*문제(?:\s|[•·]|$)",
    re.IGNORECASE,
)
_PRACTICE_SECTION_TITLE_PATTERN = re.compile(
    r"(?:종합\s*)?"
    r"(?:연습(?:\s*(?:문제|문항|하기|과제))?"
    r"|복습(?:\s*(?:문제|문항|연습|과제))?"
    r"|(?:practice|review)\s*(?:problems?|questions?|exercises?)?"
    r"|exercises?)"
    r"(?:\s*[•·:|\-]\s*[^.!?？]{1,30})?"
    r"(?:\s+\d{1,3})?",
    re.IGNORECASE,
)
_LAB_SECTION_TITLE_PATTERN = re.compile(
    r"(?:프로그래밍|코딩)?\s*실습(?:\s*(?:문제|문항|하기|과제))?"
    r"|(?:프로그래밍|코딩)\s*(?:문제|과제|연습)"
    r"|프로젝트(?:\s*(?:문제|과제|실습))?"
    r"|labs?(?:oratory)?(?:\s*(?:problems?|exercises?|tasks?))?"
    r"|hands[\s\-]*on(?:\s*(?:lab|problems?|exercises?))?"
    r"|(?:programming|coding)\s*(?:problems?|exercises?|projects?|tasks?)",
    re.IGNORECASE,
)
_QUIZ_SECTION_TITLE_PATTERN = re.compile(
    r"문제(?:\s*(?:풀이|모음|확인))?"
    r"|퀴즈|쪽지\s*시험"
    r"|(?:개념|학습|단원|스스로)?\s*(?:확인|점검|평가)(?:\s*(?:문제|학습|하기))?"
    r"|단원\s*마무리"
    r"|생각해\s*보기|풀어\s*보기|스스로\s*해\s*보기"
    r"|도전(?:\s*(?:문제|하기))?"
    r"|체크(?:\s*(?:타임|포인트))?"
    r"|(?:quick\s*)?quiz(?:zes)?"
    r"|self[\s\-]*(?:check|test)"
    r"|test\s+yourself|check\s*time|checkpoints?"
    r"|questions?|problems?"
    r"|(?:open\s+)?challenges?",
    re.IGNORECASE,
)
_PROBLEM_PROMPT_PATTERN = re.compile(
    r"[?？]"
    r"|(?:하시오|하라|하세요|해라|구하시오|구하라|고르시오|고르라"
    r"|쓰시오|써라|기입하라|기입하시오|설명하라|설명하시오"
    r"|작성하라|작성하시오|구현하라|구현하시오|출력하라|출력하시오"
    r"|계산하라|계산하시오|찾아라|찾으시오|수정하라|수정하시오"
    r"|완성하라|완성하시오|비교하라|비교하시오|나열하라|나열하시오"
    r"|증명하라|증명하시오|답하라|답하시오|선택하라|선택하시오"
    r"|채우시오|채워라)"
    r"|(?:다음\s*(?:중|보기|설명|문장|코드|빈칸)"
    r"|빈칸|옳은|틀린|알맞은|적절한|잘못된|해당하지\s*않는|아닌\s*것)"
    r"|(?:무엇|어느|몇|왜|어떻게)"
    r"(?=\s|인가|입니까|인가요|을|를|이|가|에|와|과|의|[?？.,]|$)"
    r"|\b(?:what|which|why|how|write|choose|select|explain|calculate"
    r"|implement|predict|fill|find|determine|show|prove|describe|compare"
    r"|complete|correct)\b",
    re.IGNORECASE,
)
_PROBLEM_PATTERNS = (
    re.compile(r"^\s*(?:문제\s*)?(?P<number>\d{1,3})\s*번(?:\s*문제)?\s*[.):\-]?", re.IGNORECASE),
    re.compile(r"^\s*(?:문제\s*)?(?P<number>\d{1,3})\s*[.)](?!\d)\s*", re.IGNORECASE),
    # Some exercise numbers carry a difficulty/favorite star instead of a
    # period (for example ``11*``). A following digit is excluded so ordinary
    # multiplication expressions are not promoted to problem labels.
    re.compile(
        r"^\s*(?P<number>\d{1,3})\s*[\u2605\u2606*](?!\s*\d)\s*",
        re.IGNORECASE,
    ),
    # When faint punctuation is lost, retain a bare number only if it is in
    # the canonical far-left exercise-number column (checked below).
    re.compile(r"^\s*(?P<number>\d{1,3})\s*$", re.IGNORECASE),
)
_PROBLEM_GROUP_RANGE_PATTERN = re.compile(
    r"^\s*\[\s*(?P<start>\d{1,3})\s*[~\-–—]\s*(?P<end>\d{1,3})\s*\]"
)
_OCR_JOINED_PROBLEM_PATTERN = re.compile(
    r"^\s*(?P<number>[1-9]\d{0,2})(?!CHAPTER\b)(?=[A-Za-z가-힣#])",
    re.IGNORECASE,
)
_OCR_JOINED_DECIMAL_PROBLEM_PATTERN = re.compile(
    r"^\s*(?P<number>\d{1,3})\.(?=\d)",
    re.IGNORECASE,
)
_OCR_SPACED_PROBLEM_PATTERN = re.compile(
    r"^\s*(?P<number>[1-9]\d{0,2})\s+(?!CHAPTER\b)(?=[A-Za-z\uac00-\ud7a3#])",
    re.IGNORECASE,
)
_OCR_SPACED_NUMERIC_BODY_PATTERN = re.compile(
    r"^\s*(?P<number>[1-9]\d{0,2})\s+"
    r"(?!CHAPTER\b)(?=\d{1,3}\s*[A-Za-z\uac00-\ud7a3#])",
    re.IGNORECASE,
)
_OUTLINE_SECTION_PATTERN = re.compile(
    r"^\s*[^0-9]{0,4}(?P<chapter>\d{1,2})\s*[.．]\s*(?P<section>\d{1,2})(?!\d)",
    re.IGNORECASE,
)
_BODY_SECTION_HEADING_PATTERN = re.compile(
    r"^\s*(?:제\s*)?(?P<chapter>\d{1,2})[.．](?P<section>\d{1,2})"
    r"(?:\s+|(?=[A-Za-z가-힣#]))(?P<title>\S.*)\s*$",
    re.IGNORECASE,
)
_KOREAN_CHAPTER_PATTERN = re.compile(
    r"^\s*(?:제\s*)?(?P<number>\d{1,3})\s*장"
    r"(?:\s*[:.\-]?\s*(?P<title>.*))?$",
    re.IGNORECASE,
)
_ENGLISH_CHAPTER_PATTERN = re.compile(
    r"^\s*chapter\s*(?P<number>\d{1,3})\b"
    r"(?:\s*[:.\-]?\s*(?P<title>.*))?$",
    re.IGNORECASE,
)
_TRAILING_CHAPTER_DECORATION = re.compile(
    r"\s+(?:chapter|part)\s*\d{1,4}(?:\s+\d{1,4})?\s*$",
    re.IGNORECASE,
)
_TRAILING_OCR_CHAPTER_FRAGMENT = re.compile(r"\s+\d{1,3}[A-Z]\s*$", re.IGNORECASE)
_TOC_PAGE_PATTERN = re.compile(r"(?:^|\s)(?:목\s*차|차\s*례|contents?)(?:\s|$)", re.IGNORECASE)
_TOC_NUMBERED_LINE_PATTERN = re.compile(
    r"^.{2,160}?(?:\s*[.…·•_-]{2,}\s*|\s+)\d{1,4}\s*$"
)
_RUNNING_PAGE_HEADER_PATTERN = re.compile(
    r"(?:\bchapter\b|\bprogramming\b|프로그래밍|\uc81c\s*\d+\s*\uc7a5)",
    re.IGNORECASE,
)
_MISSING_NUMBER_EXCLUDED_LINE_PATTERN = re.compile(
    r"^\s*(?:힌(?:트|\s)|hint\b)",
    re.IGNORECASE,
)
_INVALID_PATH_CHARS = re.compile(r"[<>:\"/\\|?*\x00-\x1f]")

def _canonical_chapter_title(value: str, *, page: int | None = None) -> str | None:
    """Return a stable chapter title only for explicit chapters 1..30."""
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return None
    match = _KOREAN_CHAPTER_PATTERN.match(text)
    is_korean_heading = bool(match)
    if not match:
        match = _ENGLISH_CHAPTER_PATTERN.match(text)
    if not match:
        return None
    number = int(match.group("number"))
    if not 1 <= number <= MAX_CHAPTER_NUMBER:
        return None

    title = re.sub(r"\s+", " ", str(match.group("title") or "")).strip(" .:-")
    # Generated outlines can mistake a numbered answer choice for a chapter.
    # A choice bullet after CHAPTER is evidence of a choice, not an opener.
    if re.match(r"^[①-⑳⓵-⓾❶-❿]", title):
        return None
    # OCR can concatenate more than one decoration, for example
    # ``80H 445`` or ``14 CHAPTER 797``. Peel suffixes until stable.
    for _index in range(4):
        previous_title = title
        title, decoration_count = _TRAILING_CHAPTER_DECORATION.subn("", title)
        title = title.strip(" .:-")
        if decoration_count:
            duplicated_chapter = re.search(r"\s+(?P<number>\d{1,2})\s*$", title)
            if duplicated_chapter and int(duplicated_chapter.group("number")) == number:
                title = title[:duplicated_chapter.start()].strip(" .:-")
        title = _TRAILING_OCR_CHAPTER_FRAGMENT.sub("", title).strip(" .:-")
        trailing_page = re.search(r"\s+(?P<page>\d{1,4})\s*$", title)
        if trailing_page:
            decoration = int(trailing_page.group("page"))
            preceding = title[:trailing_page.start()].rstrip()
            preceded_by_korean = bool(preceding and re.match(r"[가-힣]", preceding[-1]))
            if (
                decoration > MAX_CHAPTER_NUMBER
                or (page is not None and decoration == int(page))
                or (
                    is_korean_heading
                    and preceded_by_korean
                    and decoration <= MAX_CHAPTER_NUMBER
                )
            ):
                title = title[:trailing_page.start()].strip(" .:-")
        if title == previous_title:
            break
    return f"{number}장 {title}".strip()


def _chapter_number(value: str) -> int | None:
    match = re.match(r"^\s*(?P<number>\d{1,2})장(?:\s|$)", str(value or ""))
    if not match:
        return None
    number = int(match.group("number"))
    return number if 1 <= number <= MAX_CHAPTER_NUMBER else None



def _word_lines(page: Mapping[str, Any]) -> list[dict]:
    raw_words = [dict(item) for item in page.get("words", []) if isinstance(item, Mapping) and str(item.get("text", "")).strip()]
    raw_words.sort(key=lambda item: (float(item.get("top", 0)), float(item.get("left", 0))))
    if not raw_words:
        return [
            {
                "text": line.strip(),
                "words": [],
                "top": min(0.98, index * 0.025),
                "left": 0.02,
                "bbox": {"left": 0.02, "top": min(0.98, index * 0.025), "right": 0.98, "bottom": min(1.0, index * 0.025 + 0.02)},
            }
            for index, line in enumerate(str(page.get("text", "") or "").splitlines())
            if line.strip()
        ]

    heights = [max(0.001, float(word.get("bottom", 0)) - float(word.get("top", 0))) for word in raw_words]
    threshold = max(0.003, median(heights) * 0.65)
    groups: list[list[dict]] = []
    for word in raw_words:
        center = (float(word.get("top", 0)) + float(word.get("bottom", 0))) / 2
        if not groups:
            groups.append([word])
            continue
        previous_center = sum((float(item.get("top", 0)) + float(item.get("bottom", 0))) / 2 for item in groups[-1]) / len(groups[-1])
        if abs(center - previous_center) > threshold:
            groups.append([word])
        else:
            groups[-1].append(word)

    lines = []
    inline_symbol_gap = max(0.012, median(heights) * 3)
    for words in groups:
        words.sort(key=lambda item: float(item.get("left", 0)))
        symbol_words = [
            word
            for word in words
            if re.fullmatch(r"[*#]+", str(word.get("text", "") or "").strip())
            # Infix symbols belong to this code/prose line, including **.
            # Only detached patterns are treated as separate output lines.
            and not (
                any(0 <= float(word.get("left", 0)) - float(other.get("right", 0)) <= inline_symbol_gap
                    for other in words)
                and any(0 <= float(other.get("left", 0)) - float(word.get("right", 0)) <= inline_symbol_gap
                        for other in words)
            )
        ]
        visual_groups = [words]
        if symbol_words and len(symbol_words) < len(words):
            visual_groups = [
                [word for word in words if word not in symbol_words],
                *[[word] for word in symbol_words],
            ]
        for visual_words in visual_groups:
            lines.append({
                "text": " ".join(
                    str(item.get("text", "")).strip()
                    for item in visual_words
                ).strip(),
                "words": visual_words,
                "top": min(float(item.get("top", 0)) for item in visual_words),
                "left": min(float(item.get("left", 0)) for item in visual_words),
                "bbox": {
                    "left": min(float(item.get("left", 0)) for item in visual_words),
                    "top": min(float(item.get("top", 0)) for item in visual_words),
                    "right": max(float(item.get("right", 0)) for item in visual_words),
                    "bottom": max(float(item.get("bottom", 0)) for item in visual_words),
                },
            })
    lines.sort(key=lambda item: (float(item["top"]), float(item["left"])))
    return lines


def _reading_order_lines(page: Mapping[str, Any]) -> list[dict]:
    """Lines assembled block-by-block in PP-StructureV3 reading order.

    Two-column pages keep their column order (A1 A2 A3 → B1 B2 B3) instead of
    the geometric top-left interleave (A1 B1 A2 B2). Falls back to pure
    geometric ordering for documents analyzed by the legacy pipeline, where
    words carry no block ids.
    """
    blocks = page.get("blocks") if isinstance(page, Mapping) else None
    words = [
        dict(item)
        for item in (page.get("words", []) if isinstance(page, Mapping) else [])
        if isinstance(item, Mapping) and str(item.get("text", "")).strip()
    ]
    if not blocks or not words or not any(word.get("block_id") is not None for word in words):
        return _word_lines(page)

    ordered_blocks = sorted(
        (dict(block) for block in blocks if isinstance(block, Mapping)),
        key=lambda block: (
            int(block["reading_order"])
            if block.get("reading_order") is not None
            else 10**6
        ),
    )
    words_by_block: dict[int, list[dict]] = {}
    unassigned: list[dict] = []
    for word in words:
        block_id = word.get("block_id")
        if block_id is None:
            unassigned.append(word)
        else:
            words_by_block.setdefault(int(block_id), []).append(word)

    lines: list[dict] = []
    for block in problem_reading_blocks(ordered_blocks, words_by_block):
        block_words = words_by_block.pop(int(block.get("block_id", -1)), [])
        if not block_words:
            continue
        for line in _word_lines({"words": block_words, "text": ""}):
            line["block_type"] = str(block.get("type", ""))
            lines.append(line)
    if unassigned:
        lines.extend(_word_lines({"words": unassigned, "text": ""}))
    return lines


def _check_time_headers_and_clean_lines(
    page_number: int,
    lines: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Find split CHECK/TIME badges and remove only their decorative words."""

    records = []
    for line_index, line in enumerate(lines):
        for word_index, word in enumerate(line.get("words") or []):
            normalized = re.sub(
                r"[^A-Za-z]",
                "",
                str(word.get("text", "") or ""),
            ).upper()
            if normalized in {"CHECK", "TIME", "TIVE"}:
                records.append({
                    # The vertical badge's M is occasionally recognized as V.
                    # Geometry and the paired CHECK token still provide the
                    # guard, so TIVE is a safe local repair for TIME.
                    "kind": "TIME" if normalized == "TIVE" else normalized,
                    "line_index": line_index,
                    "word_index": word_index,
                    "top": float(word.get("top", line.get("top", 0)) or 0),
                    "left": float(word.get("left", line.get("left", 0)) or 0),
                })

    headers = []
    removed: dict[int, set[int]] = {}
    used_time_records: set[tuple[int, int]] = set()
    for check in (record for record in records if record["kind"] == "CHECK"):
        candidates = [
            record
            for record in records
            if record["kind"] == "TIME"
            and (record["line_index"], record["word_index"]) not in used_time_records
            and check["line_index"] <= record["line_index"] <= check["line_index"] + 3
            and -0.005 <= record["top"] - check["top"] <= 0.09
            and abs(record["left"] - check["left"]) <= 0.08
        ]
        if not candidates:
            continue
        time_record = min(
            candidates,
            key=lambda record: (
                abs(record["top"] - check["top"]),
                abs(record["left"] - check["left"]),
            ),
        )
        first_line_index = min(check["line_index"], time_record["line_index"])
        last_line_index = max(check["line_index"], time_record["line_index"])
        nearby_text = " ".join(
            str(lines[index].get("text", "") or "")
            for index in range(first_line_index, min(len(lines), last_line_index + 2))
        )
        if "정답" in nearby_text:
            continue
        used_time_records.add((time_record["line_index"], time_record["word_index"]))
        removed.setdefault(check["line_index"], set()).add(check["word_index"])
        removed.setdefault(time_record["line_index"], set()).add(time_record["word_index"])
        headers.append({
            "page": page_number,
            "top": max(-1.0, min(check["top"], time_record["top"]) - 0.001),
            "line_index": first_line_index - 1,
            "kind": "quiz",
            "is_heading": True,
            "check_time": True,
        })

    # Text-only indexes do not expose individual word boxes. Keep a conservative
    # fallback for one-line CHECK TIME labels used by imported native PDFs.
    if not records:
        for line_index, line in enumerate(lines):
            text = str(line.get("text", "") or "")
            if "정답" in text or not re.search(r"\bCHECK\s*TIME\b", text, re.IGNORECASE):
                continue
            headers.append({
                "page": page_number,
                "top": max(-1.0, float(line.get("top", 0)) - 0.001),
                "line_index": line_index - 1,
                "kind": "quiz",
                "is_heading": True,
                "check_time": True,
            })
            line = dict(line)
            line["text"] = re.sub(r"\bCHECK\s*TIME\b", "", text, flags=re.IGNORECASE).strip()
            lines[line_index] = line

    cleaned = []
    for line_index, line in enumerate(lines):
        excluded = set(removed.get(line_index, set()))
        excluded.update(
            word_index
            for word_index, word in enumerate(line.get("words") or [])
            if word.get("analysis_role") == OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION
        )
        if not excluded:
            cleaned.append(line)
            continue
        words = [
            dict(word)
            for word_index, word in enumerate(line.get("words") or [])
            if word_index not in excluded
        ]
        updated = dict(line)
        updated["words"] = words
        updated["text"] = " ".join(
            str(word.get("text", "") or "").strip()
            for word in words
        ).strip()
        if words:
            updated["top"] = min(float(word.get("top", 0)) for word in words)
            updated["left"] = min(float(word.get("left", 0)) for word in words)
            updated["bbox"] = {
                "left": min(float(word.get("left", 0)) for word in words),
                "top": min(float(word.get("top", 0)) for word in words),
                "right": max(float(word.get("right", 0)) for word in words),
                "bottom": max(float(word.get("bottom", 0)) for word in words),
            }
        cleaned.append(updated)
    return headers, cleaned


def _visual_check_time_labels(
    pdf_path: str,
    pages_by_number: Mapping[int, Mapping[str, Any]],
    check_time_headers: list[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Recover Java coral CHECK TIME labels independently of text OCR."""

    if not check_time_headers:
        return []
    try:
        from pdf.pdf_ocr import _render_pdf_page
        from documents.problem_number_visual import detect_coral_problem_numbers
    except (ImportError, OSError):
        return []

    labels = []
    headers_by_page: dict[int, list[Mapping[str, Any]]] = {}
    for header in check_time_headers:
        headers_by_page.setdefault(int(header["page"]), []).append(header)

    for page_number, page_headers in sorted(headers_by_page.items()):
        page = pages_by_number.get(page_number)
        if not page:
            continue
        try:
            image = _render_pdf_page(
                pdf_path,
                page_number - 1,
                scale=1.8,
            )
            try:
                detections = detect_coral_problem_numbers(image)
            finally:
                image.close()
        except (FileNotFoundError, ImportError, OSError, RuntimeError, ValueError):
            continue
        if not detections:
            continue

        lines = list(page.get("lines") or [])
        used_line_indexes: set[int] = set()
        for detection in detections:
            box = detection.get("bbox") or {}
            box_top = float(box.get("top", 0) or 0)
            nearest_lines = [
                (
                    abs(float(line.get("top", 0) or 0) - box_top),
                    line_index,
                    line,
                )
                for line_index, line in enumerate(lines)
                if line_index not in used_line_indexes
                and str(line.get("text", "") or "").strip()
                and any(
                    line_index > int(header.get("line_index", -1))
                    for header in page_headers
                )
            ]
            if not nearest_lines:
                continue
            distance, line_index, line = min(
                nearest_lines,
                key=lambda item: (item[0], item[1]),
            )
            # The Java pages normally align within 0.005 normalized page
            # height, while the same CHECK TIME badge layout in the audited C++
            # PDF reaches 0.017 because OCR places the body baseline lower.
            # Header scoping, component geometry, and three-model voting remain
            # the surrounding false-positive guards.
            if distance > 0.02:
                continue
            used_line_indexes.add(line_index)
            number = int(detection["number"])
            preceding_header_top = max(
                (
                    float(header.get("top", -1.0) or -1.0)
                    for header in page_headers
                    if line_index > int(header.get("line_index", -1))
                ),
                default=-1.0,
            )
            labels.append({
                "page": page_number,
                # Use the visual badge position for section ordering. A merged
                # OCR body row can begin above CHECK TIME itself (for example,
                # C++ page 231), which would otherwise discard a valid badge as
                # if it appeared before the section header.
                "top": max(box_top, preceding_header_top + 1e-6),
                "line_index": line_index,
                "number": number,
                "label_bbox": {
                    key: float(box.get(key, 0) or 0)
                    for key in ("left", "top", "right", "bottom")
                },
                "detached_prefix": float(box.get("left", 0) or 0) >= 0.22,
                "matched_line_text": str(line.get("text", "") or ""),
                "visual_number_label": True,
                "visual_number_vote_count": int(
                    detection.get("vote_count", 0) or 0
                ),
            })
    return labels


def _prefix_bbox(line: Mapping[str, Any], character_end: int) -> dict[str, float]:
    words = list(line.get("words") or [])
    if not words:
        return dict(line.get("bbox") or {"left": 0.02, "top": 0.0, "right": 0.12, "bottom": 0.02})
    selected = []
    length = 0
    for word in words:
        selected.append(word)
        length += len(str(word.get("text", ""))) + (1 if len(selected) > 1 else 0)
        if length >= character_end:
            break
    recovery_bbox = next(
        (
            item.get("recovery_bbox")
            for item in selected
            if isinstance(item.get("recovery_bbox"), Mapping)
        ),
        None,
    )
    if isinstance(recovery_bbox, Mapping):
        return {
            key: float(recovery_bbox.get(key, 0) or 0)
            for key in ("left", "top", "right", "bottom")
        }
    return {
        "left": max(0.0, min(float(item.get("left", 0)) for item in selected)),
        "top": max(0.0, min(float(item.get("top", 0)) for item in selected)),
        "right": min(1.0, max(float(item.get("right", 0)) for item in selected)),
        "bottom": min(1.0, max(float(item.get("bottom", 0)) for item in selected)),
    }


def _problem_match(text: str):
    for pattern in _PROBLEM_PATTERNS:
        match = pattern.match(text)
        if match:
            return match
    return None


def _normalized_problem_section_title(text: str) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    value = re.sub(r"^[\s\[\]【】()<>〈〉•·◆◇■□▶▷►▪※]+", "", value)
    value = re.sub(r"[\s\[\]【】()<>〈〉•·◆◇■□▶▷►▪※]+$", "", value)
    value = re.sub(
        r"^\d{1,2}(?:\s*[.．]\s*\d{1,2})?\s*[:.)\-]?\s+",
        "",
        value,
    )
    return value.strip()


def _named_problem_section_kind(text: str) -> str | None:
    raw = str(text or "").strip()
    if not raw or len(raw) > 80 or _problem_match(raw):
        return None
    title = _normalized_problem_section_title(raw)
    if not title:
        return None
    if _LAB_SECTION_TITLE_PATTERN.fullmatch(title):
        return "lab"
    if _PRACTICE_SECTION_TITLE_PATTERN.fullmatch(title):
        return "practice"
    if _QUIZ_SECTION_TITLE_PATTERN.fullmatch(title):
        return "quiz"
    return None


def _candidate_problem_prompt(
    candidate: Mapping[str, Any],
    pages_by_number: Mapping[int, Mapping[str, Any]],
) -> str:
    matched = str(candidate.get("matched_line_text") or "").strip()
    if matched:
        return matched
    page = pages_by_number.get(int(candidate.get("page", 0) or 0)) or {}
    lines = page.get("lines") or []
    line_index = int(candidate.get("line_index", -1))
    if 0 <= line_index < len(lines):
        return str(lines[line_index].get("text", "") or "").strip()
    return ""


def _looks_like_problem_prompt(
    candidate: Mapping[str, Any],
    pages_by_number: Mapping[int, Mapping[str, Any]],
) -> bool:
    return bool(
        _PROBLEM_PROMPT_PATTERN.search(
            _candidate_problem_prompt(candidate, pages_by_number)
        )
    )


def _problem_candidate_key(candidate: Mapping[str, Any]) -> tuple[int, int, int, int]:
    left, _height = _problem_label_geometry(candidate)
    return (
        int(candidate.get("page", 0) or 0),
        int(candidate.get("line_index", -1)),
        int(candidate.get("number", 0) or 0),
        round(left * 10_000),
    )


def _problem_match_in_line(line: Mapping[str, Any]):
    """Find a problem label even when OCR joins a left-side purpose column."""

    if not can_start_problem(line):
        return None, line
    text = str(line.get("text", "") or "")
    words = sorted(
        [dict(item) for item in line.get("words", []) if isinstance(item, Mapping)],
        key=lambda item: float(item.get("left", 0)),
    )
    direct = padded_label_match(text, float(line.get("left", 0) or 0)) or _problem_match(text)
    if not direct and words:
        direct = _problem_match(str(words[0].get("text", "") or ""))
    if (
        not direct
        and (
            is_number_column(float(line.get("left", 0) or 0))
        )
    ):
        direct = _OCR_JOINED_PROBLEM_PATTERN.match(text) or joined_numeric_label_match(text, float(line.get("left", 0)))
    if (
        not direct
        and (
            is_number_column(float(line.get("left", 0) or 0))
        )
    ):
        direct = (
            _OCR_SPACED_PROBLEM_PATTERN.match(text)
            or _OCR_SPACED_NUMERIC_BODY_PATTERN.match(text)
        )
    if direct:
        return direct, line

    for index in range(1, len(words)):
        candidate_left = float(words[index].get("left", 0))
        previous_right = max(float(item.get("right", 0)) for item in words[:index])
        if candidate_left > 0.3 or candidate_left - previous_right < 0.012:
            continue
        candidate_words = words[index:]
        candidate_text = " ".join(
            str(item.get("text", "") or "").strip()
            for item in candidate_words
        ).strip()
        match = (
            _problem_match(candidate_text)
            or _OCR_JOINED_PROBLEM_PATTERN.match(candidate_text)
            or _OCR_JOINED_DECIMAL_PROBLEM_PATTERN.match(candidate_text)
            or _OCR_SPACED_PROBLEM_PATTERN.match(candidate_text)
            or _OCR_SPACED_NUMERIC_BODY_PATTERN.match(candidate_text)
        )
        if not match:
            continue
        candidate_line = {
            "text": candidate_text,
            "words": candidate_words,
            "top": min(float(item.get("top", 0)) for item in candidate_words),
            "left": candidate_left,
            "detached_prefix": True,
            "bbox": {
                "left": candidate_left,
                "top": min(float(item.get("top", 0)) for item in candidate_words),
                "right": max(float(item.get("right", 0)) for item in candidate_words),
                "bottom": max(float(item.get("bottom", 0)) for item in candidate_words),
            },
        }
        return match, candidate_line
    return None, line


def _toc_page_numbers(pages: list[dict]) -> set[int]:
    """Identify a TOC block, including continuation pages without a TOC title."""
    toc_pages: set[int] = set()
    in_toc_block = False
    for page in pages:
        page_number = int(page["page"])
        texts = [
            re.sub(r"\s+", " ", str(line.get("text", "") or "")).strip()
            for line in page.get("lines", [])
            if str(line.get("text", "") or "").strip()
        ]
        has_toc_title = any(
            _TOC_PAGE_PATTERN.search(text)
            and (
                len(text) <= 80
                or _TOC_PAGE_PATTERN.match(text)
            )
            for text in texts[:12]
        )
        numbered_entries = sum(
            1 for text in texts if _TOC_NUMBERED_LINE_PATTERN.match(text)
        )
        explicit_chapters = sum(
            1
            for text in texts
            if _canonical_chapter_title(text, page=page_number)
        )
        looks_like_continuation = (
            numbered_entries >= 2
            or (numbered_entries >= 1 and explicit_chapters >= 1)
        )
        if has_toc_title:
            in_toc_block = True
            toc_pages.add(page_number)
        elif in_toc_block and looks_like_continuation:
            toc_pages.add(page_number)
        elif in_toc_block:
            in_toc_block = False
    return toc_pages


def _chapter_markers(pages: list[dict], outline: list[dict]) -> list[tuple[int, float, str]]:
    outline_by_number: dict[int, tuple[int, float, str]] = {}
    outline_sections: dict[int, tuple[int, int]] = {}
    for item in outline or []:
        if not isinstance(item, Mapping):
            continue
        try:
            page = max(1, int(item.get("page", 1) or 1))
        except (TypeError, ValueError):
            continue
        raw_title = str(item.get("title", "") or "")
        section_match = _OUTLINE_SECTION_PATTERN.match(raw_title)
        if section_match:
            chapter_number = int(section_match.group("chapter"))
            section_number = int(section_match.group("section"))
            current = outline_sections.get(chapter_number)
            if current is None or (section_number, page) < current:
                outline_sections[chapter_number] = (section_number, page)
        if int(item.get("level", 1) or 1) == 1:
            title = _canonical_chapter_title(raw_title, page=page)
            number = _chapter_number(title or "")
            if title and number is not None and number not in outline_by_number:
                outline_by_number[number] = (page, -1.0, title)

    toc_pages = _toc_page_numbers(pages)
    pages_by_number = {int(page["page"]): page for page in pages}
    resolved_outline_pages: dict[int, int] = {}
    for number, (section, target_page) in outline_sections.items():
        section_pattern = re.compile(
            rf"^\s*[^0-9]{{0,4}}0*{number}\s*[.．]\s*0*{section}(?!\d)",
            re.IGNORECASE,
        )
        nearby_matches = []
        for page_number in range(max(1, target_page - 4), target_page + 9):
            page = pages_by_number.get(page_number)
            if not page or page_number in toc_pages:
                continue
            for line in page.get("lines", [])[:12]:
                if section_pattern.match(str(line.get("text", "") or "")):
                    nearby_matches.append(page_number)
                    break
        if nearby_matches:
            resolved_outline_pages[number] = min(
                nearby_matches,
                key=lambda page_number: (abs(page_number - target_page), page_number),
            )

    body_by_number: dict[int, tuple[int, float, str]] = {}
    for page in pages:
        page_number = int(page["page"])
        if page_number in toc_pages:
            continue
        top_lines = page["lines"][:12]
        candidates = [
            (
                line,
                _canonical_chapter_title(
                    str(line.get("text", "") or ""),
                    page=page_number,
                ),
            )
            for line in top_lines
            if len(str(line.get("text", "") or "").strip()) <= 140
        ]
        chapter_count = sum(1 for _line, title in candidates if title)
        # TOC pages often contain many chapter entries. Their printed target
        # numbers are not viewer page indexes, so only the generated outline
        # should supply markers for those pages.
        if chapter_count >= 3:
            continue
        for line, title in candidates:
            number = _chapter_number(title or "")
            if not title or number is None or number in body_by_number:
                continue
            body_by_number[number] = (
                page_number,
                float(line.get("top", 0)),
                title,
            )

    markers = []
    supported_outline_numbers = set()
    outline_numbers = set(outline_by_number) | set(outline_sections)
    for number in outline_numbers:
        outline_marker = outline_by_number.get(number)
        body_marker = body_by_number.get(number)
        marker_page = resolved_outline_pages.get(
            number,
            int(outline_marker[0]) if outline_marker else int(outline_sections[number][1]),
        )
        if outline_marker:
            title = outline_marker[2]
        elif body_marker and abs(int(body_marker[0]) - marker_page) <= 8:
            title = body_marker[2]
        else:
            title = f"{number}장"
        marker_top = -1.0
        if (
            body_marker
            and abs(int(body_marker[0]) - marker_page) <= 8
            and re.sub(r"\s+", "", body_marker[2]).casefold()
            == re.sub(r"\s+", "", title).casefold()
        ):
            # The visible opener is authoritative when a generated outline
            # points at a later occurrence of the same running title.
            marker_page, marker_top = body_marker[:2]
        title_body = re.sub(r"^\s*\d{1,2}장\s*", "", title).strip()
        normalized_title_body = re.sub(
            r"[^0-9A-Za-z가-힣]+",
            "",
            title_body,
        ).casefold()
        if normalized_title_body:
            for opener_page in range(max(1, marker_page - 2), marker_page + 1):
                page = pages_by_number.get(opener_page)
                if not page or opener_page in toc_pages:
                    continue
                if is_learning_chapter_opener(page, title_body):
                    marker_page, marker_top = opener_page, -1.0
                    break
                if len(normalized_title_body) < 2:
                    continue
                top_lines = list(page.get("lines", []))[:12]
                number_line = next(
                    (
                        line
                        for line in top_lines
                        if re.fullmatch(
                            rf"\s*0*{number}\s*",
                            str(line.get("text", "") or ""),
                        )
                    ),
                    None,
                )
                normalized_page_text = re.sub(
                    r"[^0-9A-Za-z가-힣]+",
                    "",
                    " ".join(str(line.get("text", "") or "") for line in top_lines),
                ).casefold()
                if number_line and normalized_title_body in normalized_page_text:
                    marker_page = opener_page
                    marker_top = float(number_line.get("top", 0))
                    break
        if not outline_chapter_has_body_evidence(
            pages_by_number.get(marker_page, {}), title,
            canonical_title=_canonical_chapter_title,
        ):
            continue
        supported_outline_numbers.add(number)
        markers.append((marker_page, marker_top, title))
    markers.extend(
        marker
        for number, marker in body_by_number.items()
        if number not in supported_outline_numbers
    )
    markers.sort(key=lambda item: (item[0], item[1]))
    return markers


def _chapter_for(page: int, top: float, markers: list[tuple[int, float, str]], fallback: str) -> str:
    selected = fallback
    for marker_page, marker_top, title in markers:
        if (marker_page, marker_top) <= (page, top):
            selected = title
        else:
            break
    return selected


def _is_body_section_heading(
    line: Mapping[str, Any],
    *,
    page_number: int,
    page_lines: Sequence[Mapping[str, Any]],
    chapter_markers: Sequence[tuple[int, float, str]],
) -> bool:
    """Recognize a numbered body heading without treating decimals as headings.

    Section headings can begin in either book column and OCR sometimes joins
    the number to its title (``1.3C++``).  Away from the traditional left
    margin, require heading-sized text.  Matching the section's chapter number
    to the active chapter also rejects code/list rows such as ``3.14 while``.
    """

    text = normalized_body_heading(line)
    if not text or len(text) > 140:
        return False
    match = _BODY_SECTION_HEADING_PATTERN.match(text)
    if not match or not re.search(r"[A-Za-z가-힣]", match.group("title")):
        return False

    position = (page_number, float(line.get("top", 0) or 0))
    active_marker = next(
        (
            marker
            for marker in reversed(chapter_markers)
            if (int(marker[0]), float(marker[1])) <= position
        ),
        None,
    )
    if chapter_markers and active_marker is None:
        return False
    active_chapter = _chapter_number(active_marker[2]) if active_marker else None
    if active_chapter is not None and active_chapter != int(match.group("chapter")):
        return False

    if float(line.get("left", 1) or 1) <= 0.18:
        return True

    bbox = line.get("bbox") or {}
    line_height = max(
        0.0,
        float(bbox.get("bottom", 0) or 0) - float(bbox.get("top", 0) or 0),
    )
    page_heights = []
    for candidate in page_lines:
        candidate_bbox = candidate.get("bbox") or {}
        height = max(
            0.0,
            float(candidate_bbox.get("bottom", 0) or 0)
            - float(candidate_bbox.get("top", 0) or 0),
        )
        if 0.004 <= height <= 0.06:
            page_heights.append(height)
    typical_height = median(page_heights) if page_heights else 0.0
    if not (
        typical_height
        and line_height >= typical_height * 1.18
        and line_height - typical_height >= 0.002
    ):
        return False

    line_left = float(bbox.get("left", line.get("left", 0)) or 0)
    line_right = float(bbox.get("right", line_left) or line_left)
    previous_bottoms = []
    for candidate in page_lines:
        candidate_bbox = candidate.get("bbox") or {}
        candidate_top = float(candidate_bbox.get("top", candidate.get("top", 0)) or 0)
        candidate_bottom = float(candidate_bbox.get("bottom", candidate_top) or candidate_top)
        if candidate_top >= float(bbox.get("top", line.get("top", 0)) or 0):
            continue
        candidate_left = float(candidate_bbox.get("left", candidate.get("left", 0)) or 0)
        candidate_right = float(candidate_bbox.get("right", candidate_left) or candidate_left)
        overlaps_column = min(line_right, candidate_right) - max(line_left, candidate_left) > 0.01
        if overlaps_column or abs(candidate_left - line_left) <= 0.12:
            previous_bottoms.append(candidate_bottom)
    gap_before = (
        float(bbox.get("top", line.get("top", 0)) or 0) - max(previous_bottoms)
        if previous_bottoms
        else 1.0
    )
    return gap_before >= max(0.012, typical_height * 0.75)


def classify_code_problem(text: str) -> tuple[bool, str]:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    strong_patterns = (
        (r"(?:코드|소스\s*코드)\s*(?:를|을)?\s*(?:작성|완성|구현|수정|고치)", "코드 작성·수정 지시를 찾았습니다."),
        (r"프로그램\s*(?:을|를)?\s*(?:작성|완성|구현|수정|고치)", "프로그램 작성·수정 지시를 찾았습니다."),
        (r"(?:함수|메서드|클래스|알고리즘)\s*(?:을|를)?\s*(?:작성|완성|구현|수정|고치)", "함수·클래스·알고리즘 구현 지시를 찾았습니다."),
        (r"(?:write|implement|complete|fix|modify)\s+(?:a\s+|the\s+)?(?:program|function|method|class|code)\b", "영문 코드 구현 지시를 찾았습니다."),
    )
    for pattern, reason in strong_patterns:
        if re.search(pattern, normalized, re.IGNORECASE):
            return True, reason

    source_skeleton = re.search(
        r"(?:#include\s*<|\bint\s+main\s*\(|\bdef\s+\w+\s*\(|public\s+static\s+void\s+main)",
        normalized,
        re.IGNORECASE,
    )
    if source_skeleton and re.search(
        r"(?:오류|버그|빈칸|TODO|잘못된\s*(?:부분|코드)|문제점).{0,80}(?:수정|고치|완성|채우|구현)"
        r"|(?:수정|고치|완성|채우|구현).{0,80}(?:오류|버그|빈칸|TODO|잘못된\s*(?:부분|코드)|문제점)",
        normalized,
        re.IGNORECASE,
    ):
        return True, "제시된 소스의 오류 수정 또는 빈칸 완성 지시를 찾았습니다."

    # A source listing by itself is not a writing exercise. Textbooks commonly
    # show complete programs and ask only for their output or an explanation.
    read_only_cue = re.search(
        r"(?:실행|출력)\s*결과|무엇(?:이|을)\s*출력|결과를\s*(?:쓰|적|작성|예측)"
        r"|(?:코드|프로그램).{0,40}(?:설명|분석|고르|선택)|what\s+(?:is|will\s+be)\s+(?:the\s+)?output",
        normalized,
        re.IGNORECASE,
    )
    if read_only_cue:
        return False, "코드를 작성하는 대신 실행 결과·설명을 요구하는 문제입니다."

    language_cue = re.search(
        r"(?<![A-Za-z0-9_])(?:python|java|javascript|typescript|c\+\+|c#)(?![A-Za-z0-9_])"
        r"|파이썬|자바|C\s*언어",
        normalized,
        re.IGNORECASE,
    )
    task_cue = re.search(
        r"(?:작성|구현)\s*(?:하라|하여라|하시오|하세요|해라|해\s*보시오|해야\s*한다|할\s*것)"
        r"|입력(?:받|하).{0,160}출력(?:하|해|되|하도록)"
        r"|출력(?:하|해).{0,160}입력(?:받|하)"
        r"|\b(?:write|implement)\b",
        normalized,
        re.IGNORECASE,
    )
    if language_cue and task_cue:
        return True, "프로그래밍 언어 단서와 작성·입출력 지시를 함께 찾았습니다."
    return False, "명시적인 코드·프로그램 작성 지시를 찾지 못했습니다."


def _starter_file(text: str) -> str | None:
    value = str(text or "")
    if re.search(r"\bpython\b|파이썬", value, re.IGNORECASE):
        return "main.py"
    if re.search(r"(?<![A-Za-z0-9_])c\+\+(?![A-Za-z0-9_])", value, re.IGNORECASE):
        return "main.cpp"
    if re.search(r"(?<![A-Za-z0-9_])c#(?![A-Za-z0-9_])", value, re.IGNORECASE):
        return "Program.cs"
    if re.search(r"\bjava\b|자바", value, re.IGNORECASE):
        return "Main.java"
    if re.search(r"\bC\s*언어\b|\bC\s+program", value, re.IGNORECASE):
        return "main.c"
    return None


def _shared_group_prefix(
    section_candidates: list[dict],
    current: dict,
    pages_by_number: dict[int, dict],
) -> tuple[str, int]:
    current_position = (int(current["page"]), int(current["line_index"]))
    start_page = int(current.get("section_start_page", section_candidates[0]["page"]))
    start_top = float(current.get("section_start_top", -1))
    matched_header: tuple[int, int, re.Match[str]] | None = None
    for page_number in range(start_page, current_position[0] + 1):
        page = pages_by_number.get(page_number)
        if not page:
            continue
        for line_index, line in enumerate(page["lines"]):
            if (page_number, line_index) >= current_position:
                break
            if page_number == start_page and float(line.get("top", 0)) <= start_top:
                continue
            match = _PROBLEM_GROUP_RANGE_PATTERN.match(str(line.get("text", "") or ""))
            if match and int(match.group("start")) <= int(current["number"]) <= int(match.group("end")):
                matched_header = (page_number, line_index, match)
    if not matched_header:
        return "", int(current["page"])

    header_page, header_line, match = matched_header
    first_problem = next(
        (
            candidate
            for candidate in section_candidates
            if int(candidate["number"]) == int(match.group("start"))
            and (int(candidate["page"]), int(candidate["line_index"])) > (header_page, header_line)
        ),
        None,
    )
    if not first_problem:
        return "", int(current["page"])

    first_position = (int(first_problem["page"]), int(first_problem["line_index"]))
    lines: list[str] = []
    for page_number in range(header_page, first_position[0] + 1):
        page = pages_by_number.get(page_number)
        if not page:
            continue
        start_line = header_line if page_number == header_page else 0
        end_line = first_position[1] if page_number == first_position[0] else len(page["lines"])
        lines.extend(
            str(line.get("text", "") or "")
            for line in page["lines"][start_line:end_line]
            if not (
                float(line.get("top", 0)) <= 0.09
                and len(str(line.get("text", "") or "").strip()) <= 140
                and _RUNNING_PAGE_HEADER_PATTERN.search(str(line.get("text", "") or ""))
            )
        )
    return "\n".join(lines).strip(), header_page


def _left_problem_column_boundary(lines: Sequence[Mapping[str, Any]], label_left: float) -> float | None:
    """Find a repeated gap between a left problem body and a right sidebar."""

    if label_left > 0.18:
        return None
    candidates = []
    for line in lines:
        words = sorted(
            [dict(word) for word in line.get("words") or [] if isinstance(word, Mapping)],
            key=lambda word: float(word.get("left", 0)),
        )
        best = None
        for index in range(1, len(words)):
            left_words = words[:index]
            right_words = words[index:]
            right_start = min(float(word.get("left", 0)) for word in right_words)
            left_end = max(float(word.get("right", 0)) for word in left_words)
            gap = right_start - left_end
            if (
                gap >= 0.012
                and right_start >= 0.68
                and min(float(word.get("left", 0)) for word in left_words) <= 0.20
            ):
                candidate = (gap, (left_end + right_start) / 2)
                if best is None or candidate[0] > best[0]:
                    best = candidate
        if best is not None:
            candidates.append(best[1])
    if len(candidates) < 2:
        return None
    center = median(candidates)
    aligned = [candidate for candidate in candidates if abs(candidate - center) <= 0.045]
    return median(aligned) if len(aligned) >= 2 else None


def _line_text_left_of(line: Mapping[str, Any], boundary: float) -> str:
    words = sorted(
        [dict(word) for word in line.get("words") or [] if isinstance(word, Mapping)],
        key=lambda word: float(word.get("left", 0)),
    )
    if not words:
        return str(line.get("text", "") or "").strip()
    return " ".join(
        str(word.get("text", "") or "").strip()
        for word in words
        if (float(word.get("left", 0)) + float(word.get("right", 0))) / 2 < boundary
        and str(word.get("text", "") or "").strip()
    ).strip()


def problem_review_ocr_context(
    problem: Mapping[str, Any],
    indexed_pages: Sequence[Mapping[str, Any]],
    problems: Sequence[Mapping[str, Any]],
) -> list[dict]:
    """Return at most two coordinate-cropped OCR pages for local proofreading."""

    start_page = max(1, int(problem.get("page") or 1))
    end_page = min(max(start_page, int(problem.get("page_end") or start_page)), start_page + 1)
    label_bbox = problem.get("label_bbox") if isinstance(problem.get("label_bbox"), Mapping) else {}
    label_left = float(label_bbox.get("left", 0) or 0)
    start_top = float(label_bbox.get("top", 0) or 0)
    ordered_problems = sorted(
        [item for item in problems if isinstance(item, Mapping)],
        key=lambda item: (
            int(item.get("page") or 1),
            float((item.get("label_bbox") or {}).get("top", 0) or 0),
        ),
    )
    following = next(
        (
            item for item in ordered_problems
            if (
                int(item.get("page") or 1),
                float((item.get("label_bbox") or {}).get("top", 0) or 0),
            ) > (start_page, start_top)
        ),
        None,
    )
    context_pages = []
    for page in indexed_pages:
        if not isinstance(page, Mapping):
            continue
        if start_page <= int(page.get("page") or 0) <= end_page:
            line_source = page
        else:
            # Other pages supply only repetition evidence for margin titles.
            # Do not regroup an entire textbook's body for each two-page review.
            line_source = dict(page, text="", words=[
                word for word in page.get("words") or []
                if isinstance(word, Mapping) and float(word.get("top", 0)) >= 0.90
            ])
        context_pages.append(dict(page, lines=_reading_order_lines(line_source)))
    context_pages = filter_problem_footer_lines(
        context_pages, is_question=_PROBLEM_PROMPT_PATTERN.search,
    )
    pages_by_number = {int(page.get("page") or 0): page for page in context_pages}
    context = []
    for page_number in range(start_page, end_page + 1):
        page = pages_by_number.get(page_number)
        if not page:
            continue
        lines = page["lines"]
        page_start = max(0.0, start_top - 0.01) if page_number == start_page else 0.0
        page_end = 1.0
        if following and int(following.get("page") or 0) == page_number:
            page_end = max(
                page_start,
                float((following.get("label_bbox") or {}).get("top", 1.0) or 1.0) - 0.004,
            )
        selected = [
            line for line in lines
            if page_start <= float(line.get("top", 0) or 0) < page_end
            and not (
                float(line.get("top", 0) or 0) <= 0.09
                and _RUNNING_PAGE_HEADER_PATTERN.search(str(line.get("text", "") or ""))
            )
        ]
        boundary = _left_problem_column_boundary(selected, label_left)
        texts = []
        for line in selected:
            text = (
                _line_text_left_of(line, boundary)
                if boundary is not None
                else str(line.get("text", "") or "").strip()
            )
            if text:
                texts.append(text)
        if texts:
            context.append({"page": page_number, "text": "\n".join(texts)[:24_000]})
    return context


from documents.problem_label_recovery import (
    _extract_problem_text,
    _problem_label_geometry,
    _same_problem_number_column,
    _problem_sequence,
    _recover_missing_problem_labels,
    _problem_seed,
    _joined_numeric_body_candidates,
)

def _detect_pdf_problems_once(
    pdf_path: str,
    chapter_name: str = "",
    *,
    indexed_pages_override: list[dict[str, Any]] | None = None,
    status_override: Mapping[str, Any] | None = None,
    index_only: bool = False,
) -> dict:
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    if not os.path.isfile(normalized_pdf):
        raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")
    pdf_stat = os.stat(normalized_pdf)
    fingerprint = _pdf_fingerprint(normalized_pdf)
    status = (
        dict(status_override)
        if status_override is not None
        else pdf_ocr_status(normalized_pdf)
    )
    if status.get("needs_ocr"):
        raise ValueError("문제를 인식하려면 PDF 전체 OCR을 먼저 실행해 주세요.")

    indexed_pages = (
        [dict(page) for page in indexed_pages_override]
        if indexed_pages_override is not None
        else indexed_pdf_pages(normalized_pdf, status=status)
    )
    indexed_pages = mark_indexed_pdf_analysis_roles(indexed_pages)
    analysis_pages = filter_problem_footer_lines([
        dict(page, lines=_reading_order_lines(page)) for page in indexed_pages
    ], is_question=_PROBLEM_PROMPT_PATTERN.search)
    pages = []
    check_time_headers = []
    for item in analysis_pages:
        page = dict(item)
        raw_lines = page["lines"]
        page_headers, cleaned_lines = _check_time_headers_and_clean_lines(
            int(page["page"]),
            raw_lines,
        )
        check_time_headers.extend(page_headers)
        page["lines"] = cleaned_lines
        pages.append(page)
    pages_by_number = {int(page["page"]): page for page in pages}
    toc_pages = _toc_page_numbers(pages)
    chapter_markers = _chapter_markers(pages, status.get("outline") or [])
    first_chapter_position = min(
        ((page, top) for page, top, _title in chapter_markers),
        default=None,
    )

    headers = list(check_time_headers)
    labels = []
    answer_key_boundaries = []
    body_section_boundaries = []
    for page in pages:
        page_number = int(page["page"])
        if page_number in toc_pages:
            continue
        for line_index, line in enumerate(page["lines"]):
            text = str(line.get("text", "") or "")
            named_section_kind = _named_problem_section_kind(text) if can_be_section_heading(line) else None
            header_match = _SECTION_PATTERN.search(text)
            if named_section_kind:
                headers.append({
                    "page": page_number,
                    "top": section_heading_top(line, page["lines"]),
                    "line_index": line_index,
                    "kind": named_section_kind,
                    "is_heading": True,
                    "named_section": True,
                })
            elif header_match:
                headers.append({
                    "page": page_number,
                    "top": float(line.get("top", 0)),
                    "line_index": line_index,
                    "kind": "practice" if header_match.group("kind") == "연습" else "lab",
                    "is_heading": bool(_SECTION_HEADING_PATTERN.match(text)),
                })
            line_position = (page_number, float(line.get("top", 0)))
            next_text = str(page["lines"][line_index + 1].get("text", "")) if line_index + 1 < len(page["lines"]) else ""
            if (
                (is_answer_key_heading(text, next_text) or (
                    page_number > max((marker[0] for marker in chapter_markers), default=0)
                    and is_end_matter_heading(line)
                ))
                and (
                    first_chapter_position is None
                    or line_position > first_chapter_position
                )
            ):
                answer_key_boundaries.append(line_position)
            if _is_body_section_heading(
                line,
                page_number=page_number,
                page_lines=page["lines"],
                chapter_markers=chapter_markers,
            ):
                body_section_boundaries.append(
                    (page_number, float(line.get("top", 0)))
                )
            problem_match, problem_line = _problem_match_in_line(line)
            problem_text = str(problem_line.get("text", "") or "")
            label_left = float(problem_line.get("left", 0))
            is_standalone_number = bool(re.fullmatch(r"\s*\d{1,3}\s*", problem_text))
            if problem_match and label_left <= 0.3 and (
                not is_standalone_number or label_left <= 0.12
            ):
                labels.append({
                    "page": page_number,
                    "top": float(line.get("top", 0)),
                    "line_index": line_index,
                    "number": int(problem_match.group("number")),
                    "label_bbox": _prefix_bbox(problem_line, problem_match.end("number")),
                    "detached_prefix": bool(problem_line.get("detached_prefix")),
                    "matched_line_text": problem_text if problem_line.get("detached_prefix") else "",
                    "source_text": problem_text,
                    "explicit_problem_label": bool(
                        re.match(r"^\s*문제\s*\d{1,3}", problem_text, re.IGNORECASE)
                        or re.match(r"^\s*\d{1,3}\s*번", problem_text, re.IGNORECASE)
                    ),
                })

    if answer_key_boundaries:
        # Back-matter answer pages repeat every CHECK TIME number and often
        # contain imperative code snippets. Without a global cutoff those rows
        # can form convincing orphan 1,2,3... sequences and become a second set
        # of fake quiz problems even though each preceding section already uses
        # the answer-key heading as its extraction boundary.
        answer_key_start = min(answer_key_boundaries)
        headers = [
            item
            for item in headers
            if (int(item["page"]), float(item["top"])) < answer_key_start
        ]
        labels = [
            item
            for item in labels
            if (int(item["page"]), float(item["top"])) < answer_key_start
        ]
        body_section_boundaries = [
            position
            for position in body_section_boundaries
            if position < answer_key_start
        ]

    visual_check_labels = [] if index_only else _visual_check_time_labels(
        normalized_pdf,
        pages_by_number,
        check_time_headers,
    )
    if visual_check_labels:
        visual_pages = {
            int(label["page"])
            for label in visual_check_labels
        }
        check_ranges: dict[int, list[tuple[int, int]]] = {}
        for header in check_time_headers:
            page_number = int(header["page"])
            if page_number not in visual_pages:
                continue
            start_line = int(header.get("line_index", -1))
            next_line = min(
                (
                    int(item.get("line_index", 1_000_000))
                    for item in headers
                    if int(item.get("page", 0)) == page_number
                    and int(item.get("line_index", -1)) > start_line
                    and bool(item.get("is_heading"))
                ),
                default=1_000_000,
            )
            check_ranges.setdefault(page_number, []).append(
                (start_line, next_line)
            )
        labels = [
            label
            for label in labels
            if not any(
                start_line
                < int(label.get("line_index", -1))
                < end_line
                for start_line, end_line in check_ranges.get(
                    int(label.get("page", 0)),
                    [],
                )
            )
        ]
        labels.extend(visual_check_labels)

    headers.sort(key=lambda item: (item["page"], item["top"]))
    labels.sort(key=lambda item: (item["page"], item["top"]))
    raw_fallback = str(chapter_name or "").strip()
    fallback_chapter = (
        _canonical_chapter_title(raw_fallback)
        or raw_fallback
        or "챕터 미확인"
    )
    def section_boundary_for(header_index: int) -> tuple[int, float]:
        header = headers[header_index]
        next_header = next(
            (
                item
                for item in headers[header_index + 1:]
                if bool(item.get("is_heading"))
            ),
            None,
        )
        header_position = (int(header["page"]), float(header["top"]))
        next_chapter = next(
            ((page, top, title) for page, top, title in chapter_markers if (page, top) > header_position),
            None,
        )
        boundaries = [
            (
                int(header["section_boundary"][0]),
                float(header["section_boundary"][1]),
            )
        ] if header.get("section_boundary") else []
        if next_header:
            boundaries.append((int(next_header["page"]), float(next_header["top"])))
        if next_chapter:
            boundaries.append((int(next_chapter[0]), float(next_chapter[1])))
        next_answer_key = next(
            (position for position in answer_key_boundaries if position > header_position),
            None,
        )
        if next_answer_key:
            boundaries.append(next_answer_key)
        if header.get("kind") == "quiz":
            next_body_section = next(
                (
                    position
                    for position in body_section_boundaries
                    if position > header_position
                ),
                None,
            )
            if next_body_section:
                boundaries.append(next_body_section)
        if header.get("check_time"):
            boundaries.append((int(header["page"]) + 1, -1.0))
        return min(boundaries) if boundaries else (len(pages), 2.0)

    reserved_label_keys: set[tuple[int, int, int, int]] = set()
    for header_index, header in enumerate(headers):
        if not bool(header.get("is_heading")):
            continue
        header_position = (int(header["page"]), float(header["top"]))
        section_boundary = section_boundary_for(header_index)
        reserved_label_keys.update(
            _problem_candidate_key(item)
            for item in labels
            if header_position < (int(item["page"]), float(item["top"])) < section_boundary
        )

    orphan_labels = [
        item
        for item in labels
        if _problem_candidate_key(item) not in reserved_label_keys
    ]
    consumed_orphan_keys: set[tuple[int, int, int, int]] = set()
    for seed_index, seed in enumerate(orphan_labels):
        seed_key = _problem_candidate_key(seed)
        if seed_key in consumed_orphan_keys or int(seed["number"]) != 1:
            continue
        seed_position = (int(seed["page"]), float(seed["top"]))
        next_reset = next(
            (
                (int(item["page"]), float(item["top"]))
                for item in orphan_labels[seed_index + 1:]
                if int(item["number"]) == 1
                and _problem_candidate_key(item) not in consumed_orphan_keys
                and _same_problem_number_column(
                    item,
                    seed,
                    minimum_left_tolerance=0.06,
                )
            ),
            None,
        )
        structural_boundaries = [
            (int(item["page"]), float(item["top"]))
            for item in headers
            if bool(item.get("is_heading"))
            and (int(item["page"]), float(item["top"])) > seed_position
        ]
        structural_boundaries.extend(
            (page, top)
            for page, top, _title in chapter_markers
            if (page, top) > seed_position
        )
        structural_boundaries.extend(
            position
            for position in answer_key_boundaries
            if position > seed_position
        )
        structural_boundaries.extend(
            position
            for position in body_section_boundaries
            if position > seed_position
        )
        if next_reset:
            structural_boundaries.append(next_reset)
        # A continuous numbered quiz may span an entire standalone handout.
        # Actual headings, chapter changes, resets and answer keys bound it;
        # an arbitrary three-page cutoff silently loses the remaining items.
        structural_boundaries.append((max(pages_by_number, default=int(seed["page"])) + 1, -1.0))
        candidate_boundary = min(structural_boundaries)
        candidates = [
            item
            for item in orphan_labels[seed_index:]
            if _problem_candidate_key(item) not in consumed_orphan_keys
            and seed_position <= (int(item["page"]), float(item["top"])) < candidate_boundary
        ]
        sequence = _problem_sequence(candidates, seed)
        has_numbered_run = (
            len(sequence) >= 2
            and int(sequence[0]["number"]) == 1
            and int(sequence[1]["number"]) == 2
        )
        has_explicit_single = (
            len(sequence) == 1
            and bool(sequence[0].get("explicit_problem_label"))
        )
        minimum_prompt_count = max(1, (len(sequence) + 1) // 2)
        prompt_count = sum(
            _looks_like_problem_prompt(item, pages_by_number)
            for item in sequence
        )
        if (
            not sequence
            or not (has_numbered_run or has_explicit_single)
            or prompt_count < minimum_prompt_count
        ):
            continue
        consumed_orphan_keys.update(_problem_candidate_key(item) for item in sequence)
        # The last question can continue on the next page before the answer
        # table. Its label page is not a content boundary.
        inferred_boundary = candidate_boundary
        headers.append({
            "page": int(seed["page"]),
            "top": max(-1.0, float(seed["top"]) - 1e-6),
            "line_index": int(seed.get("line_index", 0)) - 1,
            "kind": "quiz",
            "is_heading": True,
            "inferred_without_title": True,
            "allow_label_recovery": False,
            "section_boundary": inferred_boundary,
        })

    headers.sort(key=lambda item: (item["page"], item["top"]))
    detected: list[dict] = []

    for header_index, header in enumerate(headers):
        header_position = (int(header["page"]), float(header["top"]))
        if (
            first_chapter_position is not None
            and header_position < first_chapter_position
        ):
            # Front-matter feature tours can contain miniature CHECK TIME,
            # practice, and lab screenshots. They demonstrate the book layout
            # but are not learnable problem sections.
            continue
        section_boundary = section_boundary_for(header_index)
        section_end_page, section_end_top = section_boundary
        in_section = [
            dict(item)
            for item in labels
            if (int(item["page"]), float(item["top"])) > (int(header["page"]), float(header["top"]))
            and (int(item["page"]), float(item["top"])) < section_boundary
        ]
        sequence_candidates = sorted(
            [*in_section, *_joined_numeric_body_candidates(in_section)],
            key=lambda item: (int(item["page"]), float(item["top"])),
        )
        seed = _problem_seed(sequence_candidates, header)
        if not seed:
            continue

        sequence = _problem_sequence(sequence_candidates, seed)
        recovered_labels = (
            _recover_missing_problem_labels(
                sequence,
                pages_by_number,
                header,
                all_candidates=sequence_candidates,
                pdf_path=None if index_only else normalized_pdf,
                model_variant=status.get("model_variant"),
            )
            if header.get("allow_label_recovery", True)
            else []
        )
        if recovered_labels:
            candidates_with_recovery = sorted(
                [*sequence_candidates, *recovered_labels],
                key=lambda item: (int(item["page"]), float(item["top"])),
            )
            recovered_seed = _problem_seed(candidates_with_recovery, header) or seed
            sequence = _problem_sequence(candidates_with_recovery, recovered_seed)
        for candidate in sequence:
            candidate["section_start_page"] = int(header["page"])
            candidate["section_start_top"] = float(header["top"])
            candidate["section_end_page"] = section_end_page
            candidate["section_end_top"] = section_end_top

        for candidate_index, candidate in enumerate(sequence):
            problem_text, page, page_end = _extract_problem_text(sequence, candidate_index, pages_by_number)
            answer_classification = classify_problem_answer_type(problem_text)
            choices = list(answer_classification.get("choices") or [])
            answer_type_prediction = {
                key: answer_classification.get(key)
                for key in ("value", "confidence", "reason", "classifier_version")
                if answer_classification.get(key) is not None
            }
            is_code = answer_type_prediction.get("value") == ANSWER_TYPE_CODE
            classification_reason = str(answer_type_prediction.get("reason", "") or "")
            chapter = _chapter_for(candidate["page"], candidate["top"], chapter_markers, fallback_chapter)
            chapter_folder = _sanitize_folder_name(chapter, _sanitize_folder_name(fallback_chapter, "챕터"))
            kind_folder = KIND_FOLDERS[header["kind"]]
            label_box = candidate.get("label_bbox") or {}
            position_left = round(
                float(label_box.get("left", 0) or 0) * 1_000
            )
            position_top = round(
                float(label_box.get("top", 0) or 0) * 1_000
            )
            problem_id = hashlib.sha256(
                (
                    f"{fingerprint}\0{header['kind']}\0{candidate['page']}"
                    f"\0{candidate['number']}\0{position_left}\0{position_top}"
                ).encode(
                    "utf-8",
                    errors="replace",
                )
            ).hexdigest()[:24]
            problem_folder = (
                f"{candidate['page']}페이지 {candidate['number']}번 문제"
                if header["kind"] == "quiz"
                else f"{candidate['number']}번 문제"
            )
            workspace_path = f"{chapter_folder}/{kind_folder}/{problem_folder}"
            folder_path = (
                workspace_path
                if is_code
                else None
            )
            hidden_state_path = f"{chapter_folder}/{kind_folder}/{HIDDEN_PROBLEM_DIR}/{problem_id}.json"
            paddleocr_original = {
                "problem_text": problem_text,
                "number": int(candidate["number"]),
                "page": int(page),
                "page_end": int(page_end),
                "choices": choices,
                "code": [],
                "code_positions": [],
                "answer_type": str(answer_type_prediction.get("value") or ANSWER_TYPE_UNKNOWN),
            }
            detected.append({
                "id": problem_id,
                "pdf_fingerprint": fingerprint,
                "chapter": chapter,
                "chapter_folder": chapter_folder,
                "kind": header["kind"],
                "kind_label": {
                    "practice": "연습",
                    "lab": "실습",
                    "quiz": "퀴즈",
                }[header["kind"]],
                "folder_name": kind_folder,
                "number": int(candidate["number"]),
                "page": int(page),
                "page_end": int(page_end),
                "label_bbox": candidate["label_bbox"],
                "problem_text": problem_text,
                "is_code_problem": is_code,
                "classification_reason": classification_reason,
                "answer_type_prediction": answer_type_prediction,
                "choices": choices,
                "code": [],
                "code_positions": [],
                # Immutable source snapshot for practice-mode review choices.
                # PDF search text, coordinates, and index remain owned solely
                # by pdf_ocr; this catalog snapshot never writes that layer.
                "paddleocr_original": paddleocr_original,
                "workspace_path": workspace_path,
                "folder_path": folder_path,
                "project_name": folder_path,
                "state_relative_path": f"{folder_path}/{PROBLEM_STATE_FILE}" if folder_path else hidden_state_path,
                "starter_file": (
                    _starter_file(problem_text)
                    or _starter_file(f"{chapter} {os.path.basename(normalized_pdf)}")
                ),
            })

    return {
        "pdf_path": normalized_pdf,
        "pdf_fingerprint": fingerprint,
        "pdf_size": pdf_stat.st_size,
        "pdf_mtime_ns": pdf_stat.st_mtime_ns,
        "page_count": len(pages),
        "problems": detected,
    }


def detect_pdf_problems(
    pdf_path: str,
    chapter_name: str = "",
    *,
    _status_fn: Any = None,
    _indexed_pages_fn: Any = None,
    index_only: bool = False,
) -> dict:
    """Detect from saved OCR; index_only also disables visual number recovery."""
    status_provider = _status_fn or pdf_ocr_status
    pages_provider = _indexed_pages_fn or indexed_pdf_pages

    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    if not os.path.isfile(normalized_pdf):
        return _detect_pdf_problems_once(
            normalized_pdf,
            chapter_name=chapter_name,
            index_only=index_only,
        )

    status = status_provider(normalized_pdf)
    if status.get("needs_ocr"):
        return _detect_pdf_problems_once(
            normalized_pdf,
            chapter_name=chapter_name,
            status_override=status,
            index_only=index_only,
        )
    indexed_pages = pages_provider(normalized_pdf, status=status)
    base_detection = _detect_pdf_problems_once(
        normalized_pdf,
        chapter_name=chapter_name,
        indexed_pages_override=indexed_pages,
        status_override=status,
        index_only=index_only,
    )

    # Do not re-render or re-run PP-OCR here.  Re-OCR made a single problem
    # scan unexpectedly expensive and could replace a stable OCR index with a
    # different model-tier result.  Missing-number recovery belongs in the
    # explicit full-OCR operation, before this catalog scan.
    base_detection["problem_number_refinement"] = {
        "strategy": "disabled-reocr",
        "applied": False,
        "reason": "ocr-index-only",
        "selected_page_count": 0,
        "retry_page_count": 0,
    }
    numbers = [
        int(problem.get("number"))
        for problem in base_detection.get("problems") or []
        if isinstance(problem, Mapping) and problem.get("number") is not None
    ]
    base_detection["sequence_gaps"] = pdf_structure.problem_number_sequence_gaps(numbers)
    return base_detection

