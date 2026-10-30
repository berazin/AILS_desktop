"""OCR text post-processing, confusable correction, and deduplication.

Extracted from pdf_ocr.py to isolate word deduplication, Korean/English
OCR confusion repair, and raw result payload extraction.
"""

from __future__ import annotations

import json
import re
import statistics
from typing import Callable, Any

from pdf.pdf_ocr_types import OcrWord

_OCR_CONFUSABLE_WORDS = frozenset(
    """
    abstract align alliance allocate algorithm application array available block boolean
    build button byte callable callback character child class click client close
    code collection column command compile compiler console constant constructor
    context control dalvik default delimiter dialog dictionary display document double
    element else error example exception false field file filename fill filter final
    finally float folder function global google handler hello html image illegal implement
    implementation import include index initialize input install integer interface
    item iterator java kotlin label language length library limit line linked linux
    list listener literal local login loop main map method mobile model module
    multiple null object online option outline output override package parameter path
    pipeline pixel plugin print printf println private problem process profile program
    property protected public reader result return select server solution source split
    static string style system table text thread title true type valid value variable
    viewer visible void volatile while width wildcard window write writer
    """.split()
)
_OCR_CONFUSABLE_TOKEN_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_])[A-Za-z1]+(?![A-Za-z0-9_])"
)
_OCR_OBJECTIVE_COLUMN_CUE_PATTERN = re.compile(
    r"(?:연습|응용|배열|반복문|조건|문자열|클래스|상속|GUI|스윙|스트림|"
    r"컬렉션|이벤트|네트워크|입출력)",
    re.IGNORECASE,
)


def _result_payload(result) -> dict:
    if isinstance(result, dict):
        return result
    payload = getattr(result, "json", None)
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except Exception:
            return {}
    if isinstance(payload, dict):
        return payload
    raw = getattr(result, "res", None)
    return raw if isinstance(raw, dict) else {}


def _ocr_word_area(word: OcrWord) -> float:
    return max(0.0, word.right - word.left) * max(0.0, word.bottom - word.top)


def _ocr_word_intersection(left: OcrWord, right: OcrWord) -> float:
    width = max(0.0, min(left.right, right.right) - max(left.left, right.left))
    height = max(0.0, min(left.bottom, right.bottom) - max(left.top, right.top))
    return width * height


def _ocr_words_are_duplicates(left: OcrWord, right: OcrWord) -> bool:
    intersection = _ocr_word_intersection(left, right)
    if intersection <= 0:
        return False
    left_area = _ocr_word_area(left)
    right_area = _ocr_word_area(right)
    union = left_area + right_area - intersection
    iou = intersection / max(union, 1.0)
    if iou >= 0.82:
        return True
    left_text = re.sub(r"\s+", "", left.text).casefold()
    right_text = re.sub(r"\s+", "", right.text).casefold()
    containment = intersection / max(min(left_area, right_area), 1.0)
    return bool(left_text and left_text == right_text and containment >= 0.88)


def _deduplicate_ocr_words(words: list[OcrWord]) -> list[OcrWord]:
    """Drop duplicate high-recall boxes while preserving distinct nearby text."""

    selected: list[OcrWord] = []
    for word in sorted(words, key=lambda item: (item.top, item.left)):
        duplicate_index = next(
            (
                index
                for index, existing in enumerate(selected)
                if _ocr_words_are_duplicates(existing, word)
            ),
            None,
        )
        if duplicate_index is None:
            selected.append(word)
            continue
        existing = selected[duplicate_index]
        existing_priority = (
            float(existing.confidence),
            len(re.sub(r"\s+", "", existing.text)),
        )
        word_priority = (
            float(word.confidence),
            len(re.sub(r"\s+", "", word.text)),
        )
        if word_priority > existing_priority:
            selected[duplicate_index] = word
    selected = [
        word for word in selected
        if not any(
            parent is not word
            and parent.confidence >= 0.8
            and len(re.sub(r"\s+", "", parent.text)) >= 5
            and parent.right - parent.left >= 2 * (parent.bottom - parent.top)
            and parent.right - parent.left >= 1.5 * (word.right - word.left)
            and parent.bottom - parent.top >= 1.25 * (word.bottom - word.top)
            and _ocr_word_intersection(parent, word) / max(_ocr_word_area(word), 1.0) >= 0.85
            for parent in selected
        )
    ]
    selected.sort(key=lambda item: (item.top, item.left))
    return selected


def _ocr_confusable_candidates(token: str, allow_capital_i: bool) -> list[str]:
    ambiguous_indexes = [
        index
        for index, character in enumerate(token)
        if character == "1" or (allow_capital_i and character == "I")
    ]
    if not ambiguous_indexes or len(ambiguous_indexes) > 3:
        return []

    letters = [character for character in token if character.isalpha()]
    all_uppercase = bool(letters) and all(character.isupper() for character in letters)
    candidates = [token]
    for index in ambiguous_indexes:
        character = token[index]
        if character == "1":
            replacements = ("L", "I") if all_uppercase else ("l", "i")
        else:
            replacements = ("L",) if all_uppercase else ("l",)
        candidates = [
            candidate[:index] + replacement + candidate[index + 1:]
            for candidate in candidates
            for replacement in replacements
        ]
    return candidates


def _correct_ocr_confusable_text(text: str, confidence: float = 0.0) -> str:
    """Correct OCR confusions only when lexical or numeric context is unambiguous."""

    value = str(text or "")

    def replace(match: re.Match) -> str:
        token = match.group(0)
        if len(token) < 3 or sum(character.isalpha() for character in token) < 2:
            return token
        has_digit_one = "1" in token
        # An embedded digit is a strong OCR signal. Uppercase I is considered
        # only for lower-confidence lines because it is common in identifiers.
        allow_capital_i = has_digit_one or confidence < 0.92
        for candidate in _ocr_confusable_candidates(token, allow_capital_i):
            if candidate.casefold() in _OCR_CONFUSABLE_WORDS:
                return candidate
        return token

    value = _OCR_CONFUSABLE_TOKEN_PATTERN.sub(replace, value)
    code_like = bool(
        re.search(
            r"(?:==|!=|<=|>=|%|;|System\.|Math\.|\b(?:if|for|while|int|long|"
            r"double|float|return|print|println|random)\b)",
            value,
            re.IGNORECASE,
        )
    )
    if code_like:
        value = re.sub(
            r"(?P<operator>[=<>%+\-*/(\[,])(?P<spacing>\s*)θ"
            r"(?=\s*(?:[)\]};,+\-*/%<>=]|$))",
            r"\g<operator>\g<spacing>0",
            value,
        )
    value = re.sub(r"(?<=\[)e(?=\])", "0", value)

    value = re.sub(
        r"(?<=\d)e(?![A-Za-z_])",
        "0",
        value,
    )
    value = re.sub(r"(?<![A-Za-z0-9_])e(?=에(?:\s|$))", "0", value)
    value = re.sub(r"""(?<=["'])e(?=\s*(?:입니다|이다|["']))""", "0", value)
    if re.fullmatch(r"[\s\d,.;:+\-*/%()[\]{}eθ]+", value) and re.search(r"\d", value):
        value = re.sub(r"(?<![A-Za-z0-9_])[eθ](?![A-Za-z0-9_])", "0", value)
    return value


def _correct_ocr_page_words(
    words: list[OcrWord],
    page_width: float,
    page_height: float,
) -> list[OcrWord]:
    if not words:
        return words
    width = max(1e-6, float(page_width))
    height = max(1e-6, float(page_height))
    corrected = [
        OcrWord(
            _correct_ocr_confusable_text(word.text, word.confidence),
            word.left,
            word.top,
            word.right,
            word.bottom,
            word.confidence,
        )
        for word in words
    ]

    heights = [max(1e-6, (word.bottom - word.top) / height) for word in corrected]
    line_threshold = max(0.003, statistics.median(heights) * 0.65)
    lines: list[list[OcrWord]] = []
    for word in sorted(corrected, key=lambda item: (item.top, item.left)):
        center = ((word.top + word.bottom) / 2) / height
        if not lines:
            lines.append([word])
            continue
        previous_center = statistics.mean(
            ((item.top + item.bottom) / 2) / height
            for item in lines[-1]
        )
        if abs(center - previous_center) > line_threshold:
            lines.append([word])
        else:
            lines[-1].append(word)

    for line in lines:
        tokens = [
            token
            for word in line
            for token in re.findall(r"\d+|[eθ]", word.text)
        ]
        compact = re.sub(r"[\s,.;:+\-*/%()[\]{}]", "", " ".join(word.text for word in line))
        if len(tokens) >= 2 and compact and re.fullmatch(r"[\deθ]+", compact):
            for word in line:
                word.text = re.sub(
                    r"(?<![A-Za-z0-9_])[eθ](?![A-Za-z0-9_])",
                    "0",
                    word.text,
                )

    for word in corrected:
        left = word.left / width
        right = word.right / width
        if (
            left <= 0.18
            and right <= 0.34
            and re.match(r"^\s*②\s*", word.text)
            and _OCR_OBJECTIVE_COLUMN_CUE_PATTERN.search(word.text)
        ):
            word.text = re.sub(r"^\s*②\s*", "목적 ", word.text, count=1)
    corrected.sort(key=lambda item: (item.top, item.left))
    return corrected


def _words_from_result(result) -> list[OcrWord]:
    payload = _result_payload(result)
    data = payload.get("res", payload)
    texts = data.get("rec_texts") or data.get("texts") or []
    scores = data.get("rec_scores") or data.get("scores") or []
    boxes = data.get("rec_polys") or data.get("dt_polys") or data.get("boxes") or []
    words = []
    for index, text in enumerate(texts):
        text = str(text or "").strip()
        if not text or index >= len(boxes):
            continue
        score = float(scores[index]) if index < len(scores) else 0.0
        text = _correct_ocr_confusable_text(text, score)
        points = boxes[index]
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        words.append(OcrWord(text, min(xs), min(ys), max(xs), max(ys), score))
    return _deduplicate_ocr_words(words)


