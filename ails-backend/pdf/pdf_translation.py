from __future__ import annotations

import concurrent.futures
import ctypes
import hashlib
import json
import logging
import math
import os
import re
import statistics
import tempfile
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from io import BytesIO
from pathlib import Path
from typing import Any


from common import (
    DEEPSEEK_DEFAULT_BASE_URL,
    DEEPSEEK_DEFAULT_MODEL,
    normalize_deepseek_model_name,
)
from pdf.pdf_ocr import _normalized_page_geometry, pdf_ocr_status
from pdf.page_transform import PageTransform
from pdf.pdfium_runtime import locked_pdfium
from pipeline_utils import call_openai_compatible_chat
from language_support import (
    TRANSLATION_FONT_CANDIDATES,
    language_display_name,
    language_korean_name,
    language_text_pattern,
    normalize_app_language,
)

_logger = logging.getLogger(__name__)

LAYOUT_VERSION = 2
PROMPT_VERSION = 5
TRANSLATION_BATCH_SIZE = 60
REPAIR_BATCH_SIZE = 40
MAX_PARALLEL_PAGE_REQUESTS = 100
DEFAULT_TEST_PAGES = (1, 2, 5, 6, 13, 14, 15, 25, 184, 218)
LINE_RESPONSE_PATTERN = re.compile(
    r"<<<LINE:([A-Z0-9-]+)>>>(.*?)<<<END_LINE:\1>>>",
    re.DOTALL,
)
FLEXIBLE_LINE_PATTERN = re.compile(
    r"<{2,3}\s*LINE:\s*([A-Z0-9-]+)\s*>{2,3}(.*?)(?:<{2,3}\s*END_LINE:\s*\1\s*>{2,3}|(?=<{2,3}\s*LINE:)|$)",
    re.DOTALL | re.IGNORECASE,
)
BRACKET_LINE_PATTERN = re.compile(
    r"\[\s*LINE:\s*([A-Z0-9-]+)\s*\](.*?)(?:\[\s*END_LINE:\s*\1\s*\]|(?=\[\s*LINE:)|$)",
    re.DOTALL | re.IGNORECASE,
)
LIGATURES = str.maketrans(
    {
        "\ufb00": "ff",
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\ufb03": "ffi",
        "\ufb04": "ffl",
        "\ufffe": "-",
        "\uffff": "",
    }
)
CODE_PATTERNS = (
    re.compile(r"^\s*(?:>>>|\.\.\.|Traceback\b|File\s+['\"]|[~^]+\s*$)"),
    re.compile(
        r"^\s*(?:SyntaxError|NameError|TypeError|ValueError|IndexError|KeyError|"
        r"AttributeError|ImportError|ModuleNotFoundError|ZeroDivisionError|"
        r"IndentationError|RuntimeError|OSError)\b"
    ),
    re.compile(
        r"^\s*(?:from\s+\S+\s+import\b|import\s+\S+|def\s+\w+\s*\(|"
        r"class\s+\w+.*:|if\s+.+:\s*$|elif\s+.+:\s*$|else\s*:\s*$|"
        r"for\s+.+:\s*$|while\s+.+:\s*$|try\s*:\s*$|except\b.*:\s*$)"
    ),
    re.compile(
        r"^\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\[[^\]]+\])?\s*"
        r"(?:=(?!=)|\+=|-=|\*=|/=)\s*.+"
    ),
    re.compile(r"^\s*(?:print|input|open|len|range)\s*\("),
    re.compile(r"^\s*#"),
)
ENGLISH_PROSE_MARKERS = {
    "a", "an", "and", "are", "as", "at", "be", "because", "but", "by",
    "can", "could", "do", "does", "for", "from", "has", "have", "how",
    "if", "in", "into", "is", "it", "of", "on", "or", "should", "that",
    "the", "these", "this", "to", "was", "we", "were", "when", "which",
    "while", "will", "with", "would", "you", "your",
    "copyright", "credit", "credits", "design", "details", "history",
    "license", "licensed", "printing", "support",
}
STAGE_LABELS = {
    "preparing": "번역 준비 중",
    "extracting": "PDF 텍스트와 배치 분석 중",
    "translating": "DeepSeek 번역 중",
    "repairing": "미번역 문장 확인 중",
    "rendering": "번역 PDF 생성 중",
    "verifying": "번역 PDF 검증 중",
}

_font_registration_lock = threading.Lock()
_translation_locks_guard = threading.Lock()
_translation_locks: dict[str, threading.RLock] = {}
_translation_cancels_guard = threading.Lock()
_translation_cancels: dict[str, threading.Event] = {}


class PdfTranslationCancelled(RuntimeError):
    """Raised when the user cancels a running PDF translation."""


def _cancel_key(path: str | Path) -> str:
    return os.path.normcase(str(Path(path).resolve()))


def register_translation_cancel(path: str | Path) -> threading.Event:
    """Register (or join) the cancel signal for the translation of `path`.

    Concurrent registrations for the same file intentionally share one event,
    so cancelling the active job signals every waiter for that file.
    """
    key = _cancel_key(path)
    with _translation_cancels_guard:
        existing = _translation_cancels.get(key)
        if existing is not None:
            return existing
        event = threading.Event()
        _translation_cancels[key] = event
        return event


def release_translation_cancel(path: str | Path, event: threading.Event) -> None:
    with _translation_cancels_guard:
        key = _cancel_key(path)
        if _translation_cancels.get(key) is event:
            _translation_cancels.pop(key, None)


def request_translation_cancel(path: str | Path) -> bool:
    """Signal cancellation for the active translation of `path`."""
    with _translation_cancels_guard:
        event = _translation_cancels.get(_cancel_key(path))
    if event is None:
        return False
    event.set()
    return True


def _translation_lock(path: Path) -> threading.RLock:
    key = os.path.normcase(str(path.resolve()))
    with _translation_locks_guard:
        lock = _translation_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _translation_locks[key] = lock
        return lock


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    for attempt in range(4):
        try:
            os.replace(temp, path)
            break
        except PermissionError as error:
            # Windows can briefly hold the checkpoint during a prior write.
            if os.name != "nt" or getattr(error, "winerror", None) not in {5, 32} or attempt == 3:
                raise
            time.sleep(0.05 * (attempt + 1))


def source_identity(path: Path) -> dict[str, Any]:
    stat = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "path": str(path.resolve()),
        "sha256": digest.hexdigest(),
        "size": int(stat.st_size),
        "mtime_ns": int(stat.st_mtime_ns),
    }


def deepseek_config_from_mapping(config: Mapping[str, Any]) -> dict[str, str]:
    raise ValueError("Personal cloud API connections are no longer supported. Use an account-backed workflow.")


def deepseek_config(config_path: Path) -> dict[str, str]:
    raise ValueError("Personal cloud API connections are no longer supported. Use an account-backed workflow.")


def parse_pages(value: str) -> list[int]:
    pages: list[int] = []
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            pages.extend(range(start, end + 1))
        else:
            pages.append(int(part))
    return sorted(set(pages))


def normalized_text(text: str) -> str:
    return re.sub(r"[ \t]+", " ", str(text or "").translate(LIGATURES)).strip()


def is_code_line(
    text: str,
    fonts: list[str] | None = None,
    flags: list[int] | None = None,
) -> bool:
    lowered_fonts = " ".join(fonts or []).lower()
    if "mono" in lowered_fonts or "courier" in lowered_fonts:
        return True
    if any(int(value) & 8 for value in (flags or [])):
        return True
    return any(pattern.search(text) for pattern in CODE_PATTERNS)


def should_translate_line(
    text: str,
    fonts: list[str] | None = None,
    flags: list[int] | None = None,
    target_language: str = "korean",
) -> bool:
    target = normalize_app_language(target_language)
    if target == "korean":
        source_pattern = r"[A-Za-z]"
    else:
        # Non-Korean targets translate the textbook's original Korean/CJK text.
        source_pattern = r"[가-힣]|[ぁ-んァ-ヶ]|[一-龥]"
    if not re.search(source_pattern, text):
        return False
    if re.fullmatch(r"https?://\S+|\S+@\S+", text.strip()):
        return False
    if re.match(r"^(?:Editorial Support|Cover Design|Edited by|Translated by)\s*:", text):
        return True
    return not is_code_line(text, fonts, flags)


def english_word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", str(text or "")))


def translation_request_options(line_count: int, config=None) -> dict[str, Any]:
    if config and config.get("base_url") == "chatgpt-plan://responses":
        # This is a DeepSeek-specific default, not a user-requested constraint.
        return {}
    return {
        "thinking": {"type": "disabled"},

    }


def is_high_confidence_untranslated(
    line: Mapping[str, Any],
    text: str,
    target_language: str = "korean",
) -> bool:
    value = str(text or "").strip()
    if not value or not line.get("translate"):
        return False
    if is_code_line(str(line.get("text", "")), [str(line.get("font", ""))]):
        return False
    scrubbed = re.sub(r"https?://\S+|\S+@\S+|`[^`]+`", " ", value)
    words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", scrubbed)
    lowered_words = {word.lower() for word in words}
    prose_markers = lowered_words.intersection(ENGLISH_PROSE_MARKERS)
    source_is_unchanged = normalized_text(value).casefold() == normalized_text(
        str(line.get("text", ""))
    ).casefold()
    if len(words) < 6 and not (source_is_unchanged and prose_markers):
        return False
    if len(words) < 10 and not prose_markers:
        return False
    target_count = len(re.findall(language_text_pattern(target_language), scrubbed))
    english_chars = sum(len(word) for word in words)
    if target_count == 0:
        return True
    return english_chars >= max(24, target_count)


def _join_word_text(words: list[Mapping[str, Any]]) -> str:
    output = ""
    for item in words:
        token = normalized_text(str(item.get("text", "")))
        if not token:
            continue
        if not output or re.match(r"^[,.;:!?%\)\]\}]", token) or output.endswith(("(", "[", "{")):
            output += token
        else:
            output += " " + token
    return output


def _group_page_words(words: list[Mapping[str, Any]]) -> list[list[Mapping[str, Any]]]:
    usable = [
        item
        for item in words
        if str(item.get("text", "") or "").strip()
        and float(item.get("right", 0)) > float(item.get("left", 0))
        and float(item.get("bottom", 0)) > float(item.get("top", 0))
    ]
    if not usable:
        return []
    usable.sort(key=lambda item: (float(item["top"]), float(item["left"])))
    median_height = max(
        0.001,
        statistics.median(float(item["bottom"]) - float(item["top"]) for item in usable),
    )
    rows: list[list[Mapping[str, Any]]] = []
    for word in usable:
        center = (float(word["top"]) + float(word["bottom"])) / 2
        if not rows:
            rows.append([word])
            continue
        row_center = statistics.mean(
            (float(item["top"]) + float(item["bottom"])) / 2 for item in rows[-1]
        )
        if abs(center - row_center) <= median_height * 0.65:
            rows[-1].append(word)
        else:
            rows.append([word])

    groups: list[list[Mapping[str, Any]]] = []
    column_gap = max(0.06, median_height * 4.0)
    for row in rows:
        ordered = sorted(row, key=lambda item: float(item["left"]))
        current: list[Mapping[str, Any]] = []
        previous_right = 0.0
        for word in ordered:
            left = float(word["left"])
            if current and left - previous_right > column_gap:
                groups.append(current)
                current = []
            current.append(word)
            previous_right = max(previous_right, float(word["right"]))
        if current:
            groups.append(current)
    return groups


def _text_line_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    start = 0
    for match in re.finditer(r"\r\n|\r|\n", text):
        ranges.append((start, match.start()))
        start = match.end()
    ranges.append((start, len(text)))
    return ranges


def _pdfium_text_indices(text_page: Any, text: str) -> list[tuple[int, ...]]:
    import pypdfium2 as pdfium
    count = text_page.count_chars()
    first = next((index for index in range(count)
                  if pdfium.raw.FPDFText_GetTextIndexFromCharIndex(text_page, index) >= 0), None)
    if first is None:
        return [() for _ in text]
    offset = pdfium.raw.FPDFText_GetTextIndexFromCharIndex(text_page, first)
    indices = []
    for char in text:
        units = len(char.encode("utf-16-le", errors="surrogatepass")) // 2
        mapped = tuple(dict.fromkeys(pdfium.raw.FPDFText_GetCharIndexFromTextIndex(text_page, offset + unit)
                                     for unit in range(units)))
        indices.append(mapped if all(0 <= index < count for index in mapped) else ())
        offset += units
    return indices


def _normalized_text_indices(text: str, indices: list[tuple[int, ...]]) -> tuple[str, list[tuple[int, ...]]]:
    chars, mapped = [], []
    for char, source in zip(text, indices):
        for value in char.translate(LIGATURES):
            if value in " \t":
                if chars and chars[-1] == " ":
                    mapped[-1] = tuple(dict.fromkeys((*mapped[-1], *source))) if mapped[-1] and source else ()
                    continue
                value = " "
            chars.append(value)
            mapped.append(source)
    start, end = 0, len(chars)
    while start < end and chars[start].isspace():
        start += 1
    while end > start and chars[end - 1].isspace():
        end -= 1
    return "".join(chars[start:end]), mapped[start:end]


def _pdfium_character(text_page: Any, index: int, transform: PageTransform) -> dict[str, Any]:
    import pypdfium2 as pdfium
    result: dict[str, Any] = {}
    obj = font = None
    try:
        box = transform.pdf_bbox_to_canonical(text_page.get_charbox(index))
        if box[2] > box[0] and box[3] > box[1]:
            result["bbox"] = list(box)
        x, y = ctypes.c_double(), ctypes.c_double()
        if pdfium.raw.FPDFText_GetCharOrigin(text_page, index, x, y):
            result["origin"] = list(transform.pdf_to_canonical((x.value, y.value)))
        obj = text_page.get_textobj(index)
        matrix = obj.get_matrix()
        font = obj.get_font()
        name = str(font.get_base_name() or font.get_family_name() or "")
        flags = pdfium.raw.FPDFFont_GetFlags(font)
        size = float(obj.get_font_size()) * math.hypot(matrix.c, matrix.d) * transform.user_unit
        if not name or not math.isfinite(size) or size <= 0 or flags < 0:
            return result
        color = [ctypes.c_uint() for _ in range(4)]
        if not pdfium.raw.FPDFText_GetFillColor(text_page, index, *color):
            return result
        result["style"] = {
            "font": name, "font_size": round(size, 3),
            "bold": bool(font.get_weight() >= 600 or "bold" in name.lower()),
            "italic": bool(flags & 64 or any(token in name.lower() for token in ("italic", "oblique"))),
            "serif": bool(flags & 2 or any(token in name.lower() for token in ("roman", "times", "serif", "batang"))),
            "color": [value.value / 255 for value in color[:3]],
        }
        result["kind"] = ("code" if flags & 1 or is_code_line("", [name]) else
                          "formula" if re.search(r"symbol|math|cmsy|cmmi|cmex", name, re.IGNORECASE) else "text")
        start = transform.pdf_to_canonical((matrix.e, matrix.f))
        end = transform.pdf_to_canonical((matrix.e + matrix.a, matrix.f + matrix.b))
        result["verified"] = bool("bbox" in result and "origin" in result
                                  and abs(end[1] - start[1]) < 1e-5 and end[0] > start[0]
                                  and pdfium.raw.FPDFText_IsGenerated(text_page, index) == 0)
    except Exception:
        result["verified"] = False
    finally:
        if font is not None:
            font.close()
        if obj is not None:
            obj.close()
    return result


def _native_line_spans(text: str, indices: list[tuple[int, ...]], characters: dict[int, dict],
                       base_style: dict) -> list[dict]:
    from documents.document_ir import protect_text

    styles, kinds = [], []
    for mapped in indices:
        character = characters.get(mapped[0], {}) if mapped else {}
        styles.append(character.get("style", base_style))
        kinds.append(character.get("kind", "text"))
    native = []
    start = 0
    while start < len(text):
        end = start + 1
        while end < len(text) and kinds[end] == kinds[start]:
            end += 1
        if kinds[start] != "text" and text[start:end].strip():
            a = start + len(text[start:end]) - len(text[start:end].lstrip())
            b = end - len(text[start:end]) + len(text[start:end].rstrip())
            native.append({"start": a, "end": b, "type": kinds[start]})
        start = end
    protected = protect_text(text, spans=native).elements
    ranges = []
    cursor = 0
    for element in [*protected, {"start": len(text), "end": len(text)}]:
        while cursor < element["start"]:
            end = cursor + 1
            while end < element["start"] and styles[end] == styles[cursor]:
                end += 1
            ranges.append((cursor, end, "text" if styles[cursor] == base_style else "styled_text"))
            cursor = end
        if element["end"] > element["start"]:
            kind = element["type"]
            kind = "url" if kind == "email" else "citation" if kind == "reference" else kind
            ranges.append((element["start"], element["end"], kind))
            cursor = element["end"]
    spans = []
    for start, end, kind in ranges:
        visible = [index for index in range(start, end) if not text[index].isspace()]
        raw = list(dict.fromkeys(index for position in visible for index in indices[position]))
        records = [characters.get(index, {}) for index in raw]
        boxes = [record["bbox"] for record in records if "bbox" in record]
        outside = {index for position, mapped in enumerate(indices) if position < start or position >= end
                   for index in mapped}
        verified = bool(visible and all(indices[position] for position in visible)
                        and records and all(record.get("verified", False) for record in records)
                        and not outside.intersection(raw))
        span = {"start": start, "end": end, "text": text[start:end], "type": kind,
                **styles[start], "bbox_verified": False}
        if kind == "text":
            span["protect"] = False
        elif kind == "styled_text":
            span["translate"] = True
        if boxes:
            span["bbox"] = [min(b[0] for b in boxes), min(b[1] for b in boxes),
                            max(b[2] for b in boxes), max(b[3] for b in boxes)]
        origins = [record["origin"] for record in records if "origin" in record]
        if verified and origins:
            baseline = origins[0][1]
            verified = all(abs(origin[1] - baseline) <= 0.01 for origin in origins)
            if verified:
                span.update(origin=origins[0], baseline=baseline)
        span["bbox_verified"] = verified
        spans.append(span)
    return spans


def _pdfium_page_lines(document: Any, page_index: int,
                       transform: PageTransform | None = None) -> tuple[float, float, list[dict[str, Any]]]:
    with locked_pdfium():
        page = document[page_index]
        text_page = None
        try:
            width, height = ((transform.width, transform.height) if transform is not None
                             else (float(value) for value in page.get_size()))
            text_page = page.get_textpage()
            text = str(text_page.get_text_range(errors="surrogatepass") or "") if transform is not None else str(text_page.get_text_range() or "")
            text_indices = _pdfium_text_indices(text_page, text) if transform is not None else [(i,) for i in range(len(text))]
            characters = {index: _pdfium_character(text_page, index, transform)
                          for index in dict.fromkeys(index for mapped in text_indices for index in mapped)} if transform is not None else {}
            lines: list[dict[str, Any]] = []
            visual_runs: list[list[tuple[int, tuple[float, float, float, float]]]] = []
            for start, end in _text_line_ranges(text):
                raw_entries: list[tuple[int, tuple[float, float, float, float]]] = []
                for char_index in range(start, end):
                    if text[char_index].isspace():
                        continue
                    try:
                        if transform is not None:
                            boxes = [characters[index]["bbox"] for index in text_indices[char_index]
                                     if "bbox" in characters[index]]
                            if not boxes:
                                continue
                            box = (min(b[0] for b in boxes), min(b[1] for b in boxes),
                                   max(b[2] for b in boxes), max(b[3] for b in boxes))
                        else:
                            box = tuple(float(value) for value in text_page.get_charbox(char_index))
                    except Exception:
                        continue
                    if box[2] <= box[0] or box[3] <= box[1]:
                        continue
                    raw_entries.append((char_index, box))
                if not raw_entries:
                    continue
                current: list[tuple[int, tuple[float, float, float, float]]] = []
                for entry in raw_entries:
                    box = entry[1]
                    center = (box[1] + box[3]) / 2
                    height_value = max(0.1, box[3] - box[1])
                    if current:
                        current_centers = [(item[1][1] + item[1][3]) / 2 for item in current]
                        current_heights = [max(0.1, item[1][3] - item[1][1]) for item in current]
                        if abs(center - statistics.median(current_centers)) > max(
                            height_value,
                            statistics.median(current_heights),
                        ) * 0.9:
                            visual_runs.append(current)
                            current = []
                    current.append(entry)
                if current:
                    visual_runs.append(current)

            for line_index, run in enumerate(visual_runs):
                first_visible_index = run[0][0]
                line_text, line_indices = _normalized_text_indices(
                    text[run[0][0] : run[-1][0] + 1], text_indices[run[0][0] : run[-1][0] + 1]
                )
                if not line_text:
                    continue
                boxes = [entry[1] for entry in run]
                left = min(box[0] for box in boxes)
                bottom_from_pdf = min(box[1] for box in boxes)
                right = max(box[2] for box in boxes)
                top_from_pdf = max(box[3] for box in boxes)
                top = max(0.0, bottom_from_pdf if transform is not None else height - top_from_pdf)
                bottom = min(height, top_from_pdf if transform is not None else height - bottom_from_pdf)
                font_name = ""
                font_size = max(4.0, (bottom - top) * 0.9)
                font_weight = 400
                if first_visible_index is not None and transform is None:
                    text_object = None
                    font = None
                    try:
                        text_object = text_page.get_textobj(first_visible_index)
                        raw_size = float(text_object.get_font_size() or font_size)
                        font_size = max(4.0, raw_size)
                        font = text_object.get_font()
                        font_name = str(font.get_base_name() or font.get_family_name() or "")
                        font_weight = int(font.get_weight() or 400)
                    except Exception:
                        pass
                    finally:
                        if font is not None:
                            font.close()
                        if text_object is not None:
                            text_object.close()
                canonical = {}
                if transform is not None:
                    candidates = [characters[index] for position, mapped in enumerate(line_indices)
                                  if not line_text[position].isspace() for index in mapped
                                  if "style" in characters[index]]
                    prose = [record for record in candidates if record.get("kind") == "text"]
                    choices = prose or candidates
                    base = max((record["style"] for record in choices),
                               key=lambda style: sum(record["style"] == style for record in choices)) if choices else {}
                    canonical.update(base)
                    canonical["spans"] = _native_line_spans(line_text, line_indices, characters, base)
                    canonical["bbox"] = [left, top, right, bottom]
                lines.append({
                    "line": line_index,
                    "text": line_text,
                    "bbox": [round(left, 3), round(top, 3), round(right, 3), round(bottom, 3)],
                    "font_size": round(font_size, 3),
                    "font": font_name,
                    "bold": bool(font_weight >= 600 or "bold" in font_name.lower()),
                    "serif": bool(
                        any(token in font_name.lower() for token in ("roman", "times", "serif", "batang"))
                    ),
                    **canonical,
                })
            return width, height, lines
        finally:
            if text_page is not None:
                text_page.close()
            page.close()


def extract_indexed_layout(source_path: Path, page_numbers: list[int], target_language: str = "korean",
                           canonical_coordinates: bool = False) -> dict[str, Any]:
    import pypdfium2 as pdfium
    from pypdf import PdfReader
    source_path = source_path.resolve()
    status = pdf_ocr_status(str(source_path))
    if not status.get("has_text"):
        raise ValueError("텍스트가 없는 PDF입니다. 먼저 PDF 전체 OCR을 실행해 주세요.")
    if status.get("index_repair_required"):
        raise ValueError("기존 OCR 텍스트 좌표가 손상되었습니다. PDF 전체 OCR을 다시 실행해 주세요.")
    reader = PdfReader(str(source_path))
    with locked_pdfium():
        document = pdfium.PdfDocument(str(source_path))
    try:
        total_pages = len(reader.pages)
        if any(page < 1 or page > total_pages for page in page_numbers):
            raise ValueError("선택한 페이지가 원본 PDF 범위를 벗어났습니다.")
        pages: list[dict[str, Any]] = []
        for source_page in page_numbers:
            transform = PageTransform.from_page(reader.pages[source_page - 1]) if canonical_coordinates else None
            if transform is not None:
                media_width = width = transform.width
                media_height = height = transform.height
                crop_left = crop_bottom = 0.0
                inverse = transform.overlay_to_pdf
                pdfium_width, pdfium_height, extracted_lines = _pdfium_page_lines(document, source_page - 1, transform)
            else:
                geometry = _normalized_page_geometry(reader.pages[source_page - 1])
                media_width, media_height, crop_left, crop_bottom, width, height, inverse = geometry
                pdfium_width, pdfium_height, extracted_lines = _pdfium_page_lines(document, source_page - 1)
            scale_x = 1.0 if transform is not None else width / max(pdfium_width, 1.0)
            scale_y = 1.0 if transform is not None else height / max(pdfium_height, 1.0)
            page_lines: list[dict[str, Any]] = []
            raw_sizes: list[float] = []
            for extracted in extracted_lines:
                line_index = int(extracted["line"])
                source_bbox = extracted["bbox"]
                left = float(source_bbox[0]) * scale_x
                top = float(source_bbox[1]) * scale_y
                right = float(source_bbox[2]) * scale_x
                bottom = float(source_bbox[3]) * scale_y
                text = str(extracted["text"])
                font_size = max(4.0, float(extracted["font_size"]) * min(scale_x, scale_y))
                raw_sizes.append(font_size)
                page_lines.append({
                    "id": f"P{source_page:04d}-L{line_index:04d}",
                    "source_page": source_page,
                    "line": line_index,
                    "text": text,
                    "bbox": [round(left, 3), round(top, 3), round(right, 3), round(bottom, 3)],
                    "origin": [round(left, 3), round(bottom, 3)],
                    "font_size": round(font_size, 3),
                    "font": str(extracted["font"]),
                    "bold": bool(extracted["bold"]),
                    "serif": bool(extracted["serif"]),
                    "color": [0.0, 0.0, 0.0],
                    "translate": should_translate_line(text, [str(extracted["font"])], target_language=target_language),
                    "available_right": round(right, 3),
                    "alignment": "left",
                    **({"spans": extracted.get("spans", []), "italic": extracted.get("italic", False),
                        "color": extracted.get("color", [0.0, 0.0, 0.0]),
                        "bbox": [left, top, right, bottom]} if transform is not None else {}),
                })

            median_size = statistics.median(raw_sizes) if raw_sizes else 10.0
            for line in page_lines:
                bbox = line["bbox"]
                line_center = (float(bbox[0]) + float(bbox[2])) / 2
                line_width = float(bbox[2]) - float(bbox[0])
                line["bold"] = bool(
                    line["bold"] or float(line["font_size"]) >= median_size * 1.25
                )
                line["alignment"] = (
                    "center"
                    if (
                        abs(line_center - width / 2) <= width * 0.06
                        and (
                            line_width <= width * 0.45
                            or float(line["font_size"]) >= median_size * 1.15
                        )
                    )
                    else "left"
                )
                same_row_to_right = [
                    other
                    for other in page_lines
                    if other["id"] != line["id"]
                    and float(other["bbox"][0]) > float(bbox[2]) + 2.0
                    and abs(
                        (float(other["bbox"][1]) + float(other["bbox"][3])) / 2
                        - (float(bbox[1]) + float(bbox[3])) / 2
                    ) <= max(
                        float(bbox[3]) - float(bbox[1]),
                        float(other["bbox"][3]) - float(other["bbox"][1]),
                    ) * 0.8
                ]
                if same_row_to_right:
                    line["available_right"] = round(
                        min(float(other["bbox"][0]) for other in same_row_to_right) - 2.0,
                        3,
                    )
                else:
                    right_margin = max(18.0, min(float(bbox[0]), 60.0))
                    line["available_right"] = round(
                        max(float(bbox[2]), width - right_margin),
                        3,
                    )

            digest_payload = [
                (item["id"], item["text"], item["bbox"], item["translate"])
                for item in page_lines
            ]
            pages.append({
                "source_page": source_page,
                "media_width": round(float(media_width), 3),
                "media_height": round(float(media_height), 3),
                "crop_left": round(float(crop_left), 3),
                "crop_bottom": round(float(crop_bottom), 3),
                "width": round(float(width), 3),
                "height": round(float(height), 3),
                "inverse_transform": [float(value) for value in inverse],
                "layout_digest": hashlib.sha256(
                    json.dumps(digest_payload, ensure_ascii=False).encode("utf-8")
                ).hexdigest(),
                "lines": page_lines,
                **({"coordinate_space": PageTransform.COORDINATE_SPACE,
                    "page_transform": transform.to_dict()} if transform is not None else {}),
            })
        return {
            "layout_version": LAYOUT_VERSION,
            "source": source_identity(source_path),
            "extractor": "pdfium_text_coordinates",
            "selected_pages": page_numbers,
            "total_pages": total_pages,
            "pages": pages,
        }
    finally:
        with locked_pdfium():
            document.close()
        stream = getattr(reader, "stream", None)
        if stream is not None and hasattr(stream, "close"):
            stream.close()


# Retained for callers of the earlier command-line prototype.
extract_native_layout = extract_indexed_layout


def translation_system_prompt(target_language: str = "korean") -> str:
    target = language_display_name(target_language)
    return f"""
You are translating a technical programming textbook into natural, accurate {target}.

The PDF layout is immutable. Every source marker represents exactly one visual source line.
Return exactly one {target} visual line for every requested marker, using the identical marker.
Never add, delete, merge, split, reorder, or move information between line markers.
Use neighboring lines as context, including when a word is hyphenated across lines.
If a word is visually split at a source line ending in a hyphen, keep the same split: the first
result must end at that partial word and the next result must start with the remaining fragment.
Do not move or duplicate the sentence continuation across those two line markers.
Preserve all meaning. Do not summarize merely to make text shorter.
Preserve section numbers, page numbers, dotted leaders, URLs, filenames, identifiers, commands,
operators, error names, and proper nouns where translation would be incorrect.
Translate headings, prose, captions, diagram labels, contents entries, bullets, and credits.
Do not emit Markdown or explanations. The response format must be exactly:
<<<LINE:line-id>>>{target} text on one line<<<END_LINE:line-id>>>
""".strip()


def parse_line_response(response: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    # 1. 표준 엄격 패턴
    for match in LINE_RESPONSE_PATTERN.finditer(str(response or "")):
        value = re.sub(r"\s+", " ", match.group(2)).strip()
        parsed[match.group(1)] = value

    # 2. 누락된 키가 있을 때 유연한 꺽쇠 패턴으로 보충 (공백 허용, END_LINE 생략 허용 등)
    for match in FLEXIBLE_LINE_PATTERN.finditer(str(response or "")):
        line_id = match.group(1).strip()
        if line_id not in parsed:
            val = re.sub(r"\s+", " ", match.group(2)).strip()
            if val:
                parsed[line_id] = val

    # 3. 대괄호 패턴으로 보충
    for match in BRACKET_LINE_PATTERN.finditer(str(response or "")):
        line_id = match.group(1).strip()
        if line_id not in parsed:
            val = re.sub(r"\s+", " ", match.group(2)).strip()
            if val:
                parsed[line_id] = val

    return parsed


def enforce_visual_hyphen_splits(
    page_lines: list[dict[str, Any]],
    translations: dict[str, str],
) -> None:
    for index, line in enumerate(page_lines[:-1]):
        source = str(line.get("text", "") or "")
        match = re.search(r"([A-Za-z][A-Za-z0-9]*)-$", source)
        if not match:
            continue
        next_source = str(page_lines[index + 1].get("text", "") or "")
        if not re.match(r"^[A-Za-z][A-Za-z0-9]*", next_source):
            continue
        line_id = str(line["id"])
        translated = str(translations.get(line_id, "") or "")
        partial_pattern = re.compile(re.escape(match.group(1)) + r"-", re.IGNORECASE)
        translated_match = partial_pattern.search(translated)
        if translated_match and translated_match.end() < len(translated.rstrip()):
            translations[line_id] = translated[: translated_match.end()].rstrip()


def add_usage(total: dict[str, int], addition: Mapping[str, Any]) -> None:
    for key in (
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "thought_tokens",
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
    ):
        total[key] = int(total.get(key, 0) or 0) + int(addition.get(key, 0) or 0)


def translate_line_batch(
    lines: list[dict[str, Any]],
    page_lines: list[dict[str, Any]],
    config: Mapping[str, str],
    stats: dict[str, Any] | None = None,
    cancel_check: Callable[[], None] | None = None,
    target_language: str = "korean",
) -> tuple[dict[str, str], dict[str, Any]]:
    requested_ids = [item["id"] for item in lines]
    context = "\n".join(f"{item['id']}: {item['text']}" for item in page_lines)
    blocks = "\n".join(
        f"<<<LINE:{item['id']}>>>{item['text']}<<<END_LINE:{item['id']}>>>"
        for item in lines
    )
    prompt = (
        "Full page line context (reference only):\n"
        f"{context}\n\nTranslate only these requested lines:\n{blocks}"
    )
    last_error: Exception | None = None
    for attempt in range(1, 3):
        _check_cancel(cancel_check)
        try:
            if stats is not None:
                stats["application_requests"] += 1
            response, usage = call_openai_compatible_chat(
                config["base_url"],
                config["api_key"],
                config["model"],
                [
                    {"role": "system", "content": translation_system_prompt(target_language)},
                    {"role": "user", "content": prompt},
                ],
                timeout=240,
                provider_label="DeepSeek PDF translation",
                max_retries=2,
                cancel_check=cancel_check,
                request_options=translation_request_options(len(lines), config),
            )
            parsed = parse_line_response(response)

            # 단일 라인 번역 시 마커 태그 없이 번역문만 단독 반환된 경우 구제
            if len(lines) == 1 and not parsed:
                single_id = requested_ids[0]
                cleaned = str(response or "").strip()
                cleaned = re.sub(r"^```[a-zA-Z]*\n?|```$", "", cleaned).strip()
                cleaned = re.sub(r"^<{2,3}.*?>{2,3}|<{2,3}.*?>{2,3}$", "", cleaned).strip()
                cleaned = re.sub(r"^\[LINE:.*?\]|\[END_LINE:.*?\]$", "", cleaned).strip()
                cleaned = re.sub(r"\s+", " ", cleaned).strip()
                if cleaned:
                    parsed[single_id] = cleaned

            if set(parsed) != set(requested_ids):
                missing = sorted(set(requested_ids) - set(parsed))
                extra = sorted(set(parsed) - set(requested_ids))
                raise ValueError(
                    f"번역 줄 마커가 일치하지 않습니다: missing={missing[:3]}, extra={extra[:3]}"
                )
            if any(not parsed[line_id] for line_id in requested_ids):
                raise ValueError("빈 줄 번역이 반환되었습니다.")
            return parsed, usage
        except ValueError as error:
            last_error = error
            _check_cancel(cancel_check)
            if attempt < 2:
                time.sleep(min(6, attempt * 2))

    if len(lines) > 1:
        midpoint = max(1, len(lines) // 2)
        left, left_usage = translate_line_batch(
            lines[:midpoint], page_lines, config, stats, cancel_check, target_language
        )
        right, right_usage = translate_line_batch(
            lines[midpoint:], page_lines, config, stats, cancel_check, target_language
        )
        usage_total: dict[str, int] = {}
        add_usage(usage_total, left_usage)
        add_usage(usage_total, right_usage)
        return {**left, **right}, usage_total

    # len(lines) == 1: 단일 라인 다이렉트 프롬프트 최종 구제
    single_item = lines[0]
    single_id = single_item["id"]
    single_source = str(single_item.get("text", "") or "").strip()
    _logger.warning(
        "PDF translation single line marker mismatch for %s (%s). Attempting direct single-line prompt.",
        single_id,
        last_error,
    )
    _check_cancel(cancel_check)
    direct_prompt = (
        f"Translate the following single line from an English textbook into {language_display_name(target_language)}. "
        f"Return ONLY the translated line text, without any explanations or markers:\n\n{single_source}"
    )
    direct_res, direct_usage = call_openai_compatible_chat(
        config["base_url"],
        config["api_key"],
        config["model"],
        [
            {"role": "user", "content": direct_prompt},
        ],
        timeout=60,
        provider_label="DeepSeek PDF single-line translation",
        max_retries=1,
        cancel_check=cancel_check,
    )
    cleaned_direct = re.sub(r"\s+", " ", str(direct_res or "")).strip()
    cleaned_direct = re.sub(r"^```[a-zA-Z]*\n?|```$", "", cleaned_direct).strip()
    if cleaned_direct:
        return {single_id: cleaned_direct}, direct_usage

    raise ValueError(f"단일 라인 {single_id} 번역에 실패했습니다: {last_error}")


def translate_layout(
    layout: dict[str, Any],
    cache_path: Path,
    config: Mapping[str, str],
    *,
    emit: Callable[[dict[str, Any]], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    target_language: str = "korean",
) -> dict[str, Any]:
    target_language = normalize_app_language(target_language)
    current_canonical_model = canonical_model_name(config["model"])
    started = time.perf_counter()
    stats: dict[str, Any] = {
        "translated_pages": 0,
        "cached_pages": 0,
        "line_batches": 0,
        "application_requests": 0,
        "max_workers": 0,
        "page_elapsed_seconds": {},
        "elapsed_seconds": 0.0,
    }
    existing: dict[str, Any] = {}
    if cache_path.is_file():
        try:
            candidate = json.loads(cache_path.read_text(encoding="utf-8"))
            candidate_canonical = canonical_model_name(candidate.get("model"))
            if (
                candidate.get("layout_version") == LAYOUT_VERSION
                and candidate.get("prompt_version") == PROMPT_VERSION
                and candidate.get("source", {}).get("sha256") == layout["source"]["sha256"]
                and (candidate_canonical == current_canonical_model or not candidate_canonical or not current_canonical_model)
                # Caches written before multi-language support are Korean.
                and candidate.get("target_language", "korean") == target_language
            ):
                existing = candidate
        except (OSError, ValueError, TypeError):
            existing = {}
    cached_pages = {
        int(item["source_page"]): item for item in existing.get("pages", [])
    }

    # 주 캐시 파일에 일부 페이지만 있을 때, 동일 PDF(동일 sha256)의 유효한 캐시가 있다면 보충
    if len(cached_pages) < len(layout["pages"]):
        try:
            for other_file in translation_cache_dir().glob("*.json"):
                if other_file == cache_path or other_file.name.endswith(".qa.json"):
                    continue
                try:
                    other_data = json.loads(other_file.read_text(encoding="utf-8"))
                    if (
                        other_data.get("layout_version") == LAYOUT_VERSION
                        and other_data.get("source", {}).get("sha256") == layout["source"]["sha256"]
                        and other_data.get("target_language", "korean") == target_language
                    ):
                        for p_rec in other_data.get("pages", []):
                            p_num = int(p_rec.get("source_page", 0))
                            if p_num not in cached_pages and p_rec.get("translations"):
                                cached_pages[p_num] = p_rec
                except Exception:
                    continue
        except Exception:
            pass

    usage_total = dict(existing.get("usage") or {})
    completed: dict[int, dict[str, Any]] = {}
    pending_pages: list[dict[str, Any]] = []
    for page in layout["pages"]:
        source_page = int(page["source_page"])
        cached = cached_pages.get(source_page)
        if cached and cached.get("layout_digest") == page["layout_digest"]:
            completed[source_page] = cached
            stats["cached_pages"] += 1
        else:
            pending_pages.append(page)

    configured_workers = int(
        os.environ.get("AILS_PDF_TRANSLATION_WORKERS", str(MAX_PARALLEL_PAGE_REQUESTS))
    )
    worker_count = min(max(1, configured_workers), max(1, len(pending_pages)))
    stats["max_workers"] = worker_count if pending_pages else 0
    total = len(layout["pages"])
    _emit(emit, {
        "type": "translation_progress",
        "completed": len(completed),
        "total": total,
        "cached": len(completed),
    })

    def translate_page(
        page: dict[str, Any],
    ) -> tuple[int, dict[str, Any], dict[str, int], dict[str, Any]]:
        _check_cancel(cancel_check)
        page_started = time.perf_counter()
        source_page = int(page["source_page"])
        requested = [item for item in page["lines"] if item["translate"]]
        translations: dict[str, str] = {}
        page_usage: dict[str, int] = {}
        page_stats = {"line_batches": 0, "application_requests": 0}
        for offset in range(0, len(requested), TRANSLATION_BATCH_SIZE):
            _check_cancel(cancel_check)
            page_stats["line_batches"] += 1
            parsed, usage = translate_line_batch(
                requested[offset : offset + TRANSLATION_BATCH_SIZE],
                page["lines"],
                config,
                page_stats,
                cancel_check,
                target_language,
            )
            translations.update(parsed)
            add_usage(page_usage, usage)
        enforce_visual_hyphen_splits(page["lines"], translations)
        page_record = {
            "source_page": source_page,
            "layout_digest": page["layout_digest"],
            "translations": translations,
        }
        page_stats["elapsed_seconds"] = round(time.perf_counter() - page_started, 3)
        return source_page, page_record, page_usage, page_stats

    def cache_payload() -> dict[str, Any]:
        stats["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        return {
            "layout_version": LAYOUT_VERSION,
            "prompt_version": PROMPT_VERSION,
            "source": layout["source"],
            "provider": "DeepSeek",
            "model": config["model"],
            "target_language": target_language,
            "usage": usage_total,
            "translation_stats": stats,
            "pages": [completed[key] for key in sorted(completed)],
        }

    if pending_pages:
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="pdf-translate",
        ) as executor:
            futures = {
                executor.submit(translate_page, page): int(page["source_page"])
                for page in pending_pages
            }
            try:
                for future in concurrent.futures.as_completed(futures):
                    source_page, page_record, page_usage, page_stats = future.result()
                    completed[source_page] = page_record
                    add_usage(usage_total, page_usage)
                    stats["translated_pages"] += 1
                    stats["line_batches"] += int(page_stats["line_batches"])
                    stats["application_requests"] += int(page_stats["application_requests"])
                    stats["page_elapsed_seconds"][str(source_page)] = page_stats["elapsed_seconds"]
                    # 매 페이지 완료 시 즉시 체크포인트를 기록하여 중단 시에도 보존
                    atomic_write_json(cache_path, cache_payload())
                    _emit(emit, {
                        "type": "translation_progress",
                        "page": source_page,
                        "completed": len(completed),
                        "total": total,
                        "cached": int(stats["cached_pages"]),
                    })
                    _check_cancel(cancel_check)
            except Exception:
                for future in futures:
                    future.cancel()
                raise
            finally:
                # 취소나 예외 발생 시에도 이미 완료된 future들의 결과를 수집하여 저장
                for fut, sp_num in futures.items():
                    if fut.done() and not fut.cancelled() and sp_num not in completed:
                        try:
                            sp, prec, pusg, pst = fut.result()
                            completed[sp] = prec
                            add_usage(usage_total, pusg)
                            stats["translated_pages"] += 1
                        except Exception:
                            pass
                if completed:
                    try:
                        atomic_write_json(cache_path, cache_payload())
                    except Exception:
                        pass

    result = cache_payload()
    atomic_write_json(cache_path, result)
    return result


def rewrite_untranslated_prose(
    layout: dict[str, Any],
    translated: dict[str, Any],
    cache_path: Path,
    config: Mapping[str, str],
    *,
    emit: Callable[[dict[str, Any]], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    target_language: str = "korean",
) -> dict[str, Any]:
    target_language = normalize_app_language(target_language)
    target_name = language_display_name(target_language)
    translated_pages = {
        int(item["source_page"]): item for item in translated["pages"]
    }
    stats = {
        "candidate_lines": 0,
        "requests": 0,
        "replacements": 0,
        "failed_batches": 0,
        "elapsed_seconds": 0.0,
    }
    started = time.perf_counter()
    total = len(layout["pages"])
    try:
        for page_index, page in enumerate(layout["pages"], start=1):
            _check_cancel(cancel_check)
            source_page = int(page["source_page"])
            translations = translated_pages[source_page]["translations"]
            candidates: list[tuple[dict[str, Any], str]] = []
            for line in page["lines"]:
                current = translations.get(line["id"])
                if current and is_high_confidence_untranslated(line, current, target_language):
                    candidates.append((line, current))
            stats["candidate_lines"] += len(candidates)
            context = "\n".join(f"{item['id']}: {item['text']}" for item in page["lines"])
            for offset in range(0, len(candidates), REPAIR_BATCH_SIZE):
                _check_cancel(cancel_check)
                batch = candidates[offset : offset + REPAIR_BATCH_SIZE]
                blocks = "\n".join(
                    f"<<<LINE:{line['id']}>>>source={line['text']} | current={current}"
                    f"<<<END_LINE:{line['id']}>>>"
                    for line, current in batch
                )
                prompt = (
                    "Full page source context (reference only):\n"
                    f"{context}\n\nRepair only these high-confidence untranslated lines. "
                    "Translate ordinary prose, including prose inside quotation marks. "
                    "Keep identifiers, commands, error names, filenames, product names, proper "
                    f"nouns, and URLs unchanged. Return exactly one {target_name} result for each identical "
                    "marker, with no Markdown or explanation.\n"
                    + blocks
                )
                stats["requests"] += 1
                try:
                    response, usage = call_openai_compatible_chat(
                        config["base_url"],
                        config["api_key"],
                        config["model"],
                        [
                            {
                                "role": "system",
                                "content": (
                                    f"You are a precise {target_name} technical-book translator. Repair "
                                    "only the requested untranslated prose lines and preserve one "
                                    "visual line per marker."
                                ),
                            },
                            {"role": "user", "content": prompt},
                        ],
                        timeout=240,
                        provider_label="DeepSeek PDF untranslated-prose repair",
                        max_retries=2,
                        cancel_check=cancel_check,
                        request_options=translation_request_options(len(batch), config),
                    )
                except Exception:
                    stats["failed_batches"] += 1
                    continue
                parsed = parse_line_response(response)
                expected = {line["id"] for line, _ in batch}
                if set(parsed) != expected:
                    stats["failed_batches"] += 1
                    continue
                add_usage(translated["usage"], usage)
                for line, current in batch:
                    replacement = parsed[line["id"]]
                    if (
                        re.search(language_text_pattern(target_language), replacement)
                        and english_word_count(replacement) < english_word_count(current)
                    ):
                        translations[line["id"]] = replacement
                        stats["replacements"] += 1
                atomic_write_json(cache_path, translated)
            enforce_visual_hyphen_splits(page["lines"], translations)
            _emit(emit, {
                "type": "repair_progress",
                "page": source_page,
                "completed": page_index,
                "total": total,
            })
    finally:
        stats["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        translated["repair_stats"] = stats
        try:
            atomic_write_json(cache_path, translated)
        except Exception:
            pass
    return translated


from pdf.pdf_translation_renderer import (
    _font_paths,
    _register_fonts,
    _render_pdfium_page,
    _sample_background_color,
    _sample_foreground_color,
    _font_fit,
    _safe_metadata,
    _emit,
    _check_cancel,
    render_layout_pdf,
    _translation_change_bbox,
    pixel_preservation_check,
)

def write_qa(
    path: Path,
    layout: dict[str, Any],
    translated: dict[str, Any],
    checks: list[dict[str, Any]],
) -> dict[str, Any]:
    review_reasons: list[dict[str, Any]] = []
    for check in checks:
        if float(check.get("outside_translation_mae", 0.0)) > 1.5:
            review_reasons.append({
                "page": check["source_page"],
                "reason": "pixels_changed_outside_translation_boxes",
                "value": check["outside_translation_mae"],
            })
        for line in check.get("lines", []):
            if float(line.get("font_scale", 1.0)) < 0.55:
                review_reasons.append({
                    "page": check["source_page"],
                    "line": line["id"],
                    "reason": "font_scale_below_55_percent",
                    "value": line["font_scale"],
                })
    report = {
        "status": "review_required" if review_reasons else "approved",
        "renderer": "pypdfium2 + pypdf + ReportLab",
        "strong_copyleft_pdf_dependency": False,
        "source": layout["source"],
        "model": translated.get("model", ""),
        "selected_pages": layout["selected_pages"],
        "output_pages": len(checks),
        "line_break_policy": "one_source_visual_line_to_one_output_visual_line",
        "usage": translated.get("usage", {}),
        "translation_stats": translated.get("translation_stats", {}),
        "repair_stats": translated.get("repair_stats", {}),
        "review_reasons": review_reasons,
        "pages": checks,
    }
    atomic_write_json(path, report)
    return report


def default_translation_output_path(source_path: Path) -> Path:
    source_path = source_path.resolve()
    suffix = "-ko"
    stem = source_path.stem
    if stem.lower().endswith(suffix):
        stem += "-translated"
    return source_path.with_name(f"{stem}{suffix}.pdf")


def translation_cache_dir() -> Path:
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
    return Path(appdata) / "AILS" / "pdf_translation"


def canonical_model_name(model: str | None) -> str:
    cleaned = str(model or "").strip().lower()
    return re.sub(r"^[^/]+/", "", cleaned)


def default_translation_cache_path(source_path: Path, model: str, target_language: str = "korean") -> Path:
    target_language = normalize_app_language(target_language)
    resolved_path = os.path.normcase(str(source_path.resolve()))
    canonical = canonical_model_name(model)
    key_canonical = (
        f"{resolved_path}\0{canonical}"
        if target_language == "korean"
        else f"{resolved_path}\0{canonical}\0{target_language}"
    )
    cache_key_canonical = hashlib.sha256(
        key_canonical.encode("utf-8", errors="surrogatepass")
    ).hexdigest()
    canonical_path = translation_cache_dir() / f"{cache_key_canonical}.json"

    key_raw = (
        f"{resolved_path}\0{model}"
        if target_language == "korean"
        else f"{resolved_path}\0{model}\0{target_language}"
    )
    cache_key_raw = hashlib.sha256(
        key_raw.encode("utf-8", errors="surrogatepass")
    ).hexdigest()
    raw_path = translation_cache_dir() / f"{cache_key_raw}.json"

    if raw_path.is_file() and not canonical_path.is_file():
        return raw_path
    return canonical_path


def cached_translation_page_numbers(
    source_path: Path | str,
    target_language: str = "korean",
    model: str | None = None,
) -> set[int]:
    """Return set of 1-based page numbers that already have valid translation cache."""
    target_language = normalize_app_language(target_language)
    path_obj = Path(source_path).expanduser().resolve()
    if not path_obj.is_file():
        return set()
    try:
        source_info = source_identity(path_obj)
    except Exception:
        return set()

    current_canonical_model = canonical_model_name(model) if model else None
    cached_pages: set[int] = set()

    if model:
        try:
            main_cache = default_translation_cache_path(path_obj, model, target_language)
            if main_cache.is_file():
                data = json.loads(main_cache.read_text(encoding="utf-8"))
                candidate_canonical = canonical_model_name(data.get("model"))
                if (
                    data.get("layout_version") == LAYOUT_VERSION
                    and data.get("prompt_version") == PROMPT_VERSION
                    and data.get("source", {}).get("sha256") == source_info["sha256"]
                    and (candidate_canonical == current_canonical_model or not candidate_canonical or not current_canonical_model)
                    and data.get("target_language", "korean") == target_language
                ):
                    for p_rec in data.get("pages", []):
                        if p_rec.get("translations"):
                            cached_pages.add(int(p_rec.get("source_page", 0)))
        except Exception:
            pass

    try:
        for other_file in translation_cache_dir().glob("*.json"):
            if other_file.name.endswith(".qa.json"):
                continue
            try:
                other_data = json.loads(other_file.read_text(encoding="utf-8"))
                if (
                    other_data.get("layout_version") == LAYOUT_VERSION
                    and other_data.get("source", {}).get("sha256") == source_info["sha256"]
                    and other_data.get("target_language", "korean") == target_language
                ):
                    candidate_canonical = canonical_model_name(other_data.get("model"))
                    if current_canonical_model and candidate_canonical and candidate_canonical != current_canonical_model:
                        continue
                    for p_rec in other_data.get("pages", []):
                        p_num = int(p_rec.get("source_page", 0))
                        if p_rec.get("translations"):
                            cached_pages.add(p_num)
            except Exception:
                continue
    except Exception:
        pass

    return {p for p in cached_pages if p > 0}


def pdf_translation_progress_status(
    source_path: Path | str,
    target_language: str = "korean",
    model: str | None = None,
) -> dict[str, int]:
    """Return translation completion stats: total_pages, cached_pages, remaining_pages."""
    from pypdf import PdfReader
    path_obj = Path(source_path).expanduser().resolve()
    total_pages = 0
    if path_obj.is_file():
        try:
            reader = PdfReader(str(path_obj))
            total_pages = len(reader.pages)
            stream = getattr(reader, "stream", None)
            if stream is not None and hasattr(stream, "close"):
                stream.close()
        except Exception:
            total_pages = 0

    cached = cached_translation_page_numbers(path_obj, target_language, model)
    cached_count = len(cached)
    remaining_pages = max(0, total_pages - cached_count) if total_pages > 0 else 0

    return {
        "total_pages": total_pages,
        "cached_pages": cached_count,
        "remaining_pages": remaining_pages,
    }


TRANSLATION_CACHE_RETENTION_DAYS = 30


def translation_cache_retention_days(app_config: Mapping[str, Any] | None = None) -> int:
    raw = ""
    if isinstance(app_config, Mapping):
        raw = str(app_config.get("translation_cache_retention_days", "") or "").strip()
    try:
        days = int(raw)
    except (TypeError, ValueError):
        days = TRANSLATION_CACHE_RETENTION_DAYS
    return max(0, min(days, 365))


def prune_translation_cache(retention_days: int, *, exclude_paths: Sequence[str | Path] = ()) -> dict[str, int]:
    """Delete cached translation/QA JSON older than the retention window.

    Cache entries and QA reports hold the full bilingual text plus the
    source-file identity, so they expire after
    `translation_cache_retention_days` (30 by default). A retention of 0
    removes every cached entry.
    """
    cutoff_ts = float("inf") if retention_days <= 0 else time.time() - retention_days * 24 * 60 * 60
    deleted = 0
    failed = 0
    excluded = {Path(path).expanduser().resolve() for path in exclude_paths}
    for cache_path in translation_cache_dir().glob("*.json"):
        try:
            if cache_path.resolve() in excluded or cache_path.stat().st_mtime > cutoff_ts:
                continue
            cache_path.unlink()
            deleted += 1
        except FileNotFoundError:
            continue
        except OSError:
            failed += 1
    return {"deleted": deleted, "failed": failed}


def run_pdf_translation(
    source: str | Path,
    app_config: Mapping[str, Any],
    *,
    output_path: str | Path | None = None,
    cache_path: str | Path | None = None,
    pages: list[int] | None = None,
    emit: Callable[[dict[str, Any]], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    target_language: str = "korean",
    options=None,
    provider=None,
    glossary=None,
) -> dict[str, Any]:
    from pypdf import PdfReader
    if options is not None or provider is not None:
        from documents.document_translation import translate_document

        result = translate_document(
            source, target_language=target_language, provider=provider, options=options,
            app_config=app_config, output_path=output_path, cache_path=cache_path,
            pages=pages, emit=emit, cancel_check=cancel_check, glossary=glossary,
        )
        active_paths = [result[key] for key in ("path", "output_path", "cache_path", "qa_path")
                        if isinstance(result.get(key), (str, Path))]
        if isinstance(result.get("cache_path"), (str, Path)):
            active_paths.append(Path(result["cache_path"]).with_suffix(".layout.json"))
        try:
            prune_translation_cache(translation_cache_retention_days(app_config), exclude_paths=active_paths)
        except OSError:
            pass
        return result
    target_language = normalize_app_language(target_language)
    pipeline_started = time.perf_counter()
    source_path = Path(source).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")
    if source_path.suffix.lower() != ".pdf":
        raise ValueError("PDF 파일만 번역할 수 있습니다.")
    config = deepseek_config_from_mapping(app_config)
    try:
        prune_translation_cache(translation_cache_retention_days(app_config))
    except OSError:
        pass
    reader = PdfReader(str(source_path))
    try:
        total_pages = len(reader.pages)
    finally:
        stream = getattr(reader, "stream", None)
        if stream is not None and hasattr(stream, "close"):
            stream.close()
    selected_pages = sorted(set(pages or range(1, total_pages + 1)))
    if not selected_pages:
        raise ValueError("번역할 페이지가 없습니다.")
    destination = (
        Path(output_path).expanduser().resolve()
        if output_path
        else default_translation_output_path(source_path)
    )
    if destination == source_path:
        raise ValueError("번역 결과는 원본 PDF와 다른 경로에 저장해야 합니다.")
    translation_cache = (
        Path(cache_path).expanduser().resolve()
        if cache_path
        else default_translation_cache_path(source_path, config["model"], target_language)
    )
    qa_path = translation_cache.with_suffix(".qa.json")
    timings: dict[str, float] = {}

    with _translation_lock(source_path):
        _check_cancel(cancel_check)
        _emit(emit, {
            "type": "stage",
            "stage": "preparing",
            "label": STAGE_LABELS["preparing"],
            "total": len(selected_pages),
            "output_path": str(destination),
            "model": config["model"],
        })
        stage_started = time.perf_counter()
        _emit(emit, {
            "type": "stage",
            "stage": "extracting",
            "label": STAGE_LABELS["extracting"],
            "total": len(selected_pages),
        })
        layout = extract_indexed_layout(source_path, selected_pages, target_language)
        timings["layout_extraction_seconds"] = round(time.perf_counter() - stage_started, 3)

        stage_started = time.perf_counter()
        _emit(emit, {
            "type": "stage",
            "stage": "translating",
            "label": STAGE_LABELS["translating"],
            "total": len(selected_pages),
        })
        translated = translate_layout(
            layout,
            translation_cache,
            config,
            emit=emit,
            cancel_check=cancel_check,
            target_language=target_language,
        )
        timings["translation_seconds"] = round(time.perf_counter() - stage_started, 3)

        stage_started = time.perf_counter()
        _emit(emit, {
            "type": "stage",
            "stage": "repairing",
            "label": STAGE_LABELS["repairing"],
            "total": len(selected_pages),
        })
        translated = rewrite_untranslated_prose(
            layout,
            translated,
            translation_cache,
            config,
            emit=emit,
            cancel_check=cancel_check,
            target_language=target_language,
        )
        timings["untranslated_repair_seconds"] = round(
            time.perf_counter() - stage_started, 3
        )

        stage_started = time.perf_counter()
        _emit(emit, {
            "type": "stage",
            "stage": "rendering",
            "label": STAGE_LABELS["rendering"],
            "total": len(selected_pages),
        })
        checks = render_layout_pdf(
            source_path,
            destination,
            layout,
            translated,
            emit=emit,
            cancel_check=cancel_check,
            target_language=target_language,
        )
        timings["pdf_render_seconds"] = round(time.perf_counter() - stage_started, 3)

        stage_started = time.perf_counter()
        _emit(emit, {
            "type": "stage",
            "stage": "verifying",
            "label": STAGE_LABELS["verifying"],
            "total": len(selected_pages),
        })
        checks = pixel_preservation_check(
            source_path,
            destination,
            layout,
            checks,
            emit=emit,
            cancel_check=cancel_check,
        )
        timings["pixel_qa_seconds"] = round(time.perf_counter() - stage_started, 3)
        report = write_qa(qa_path, layout, translated, checks)
        timings["total_seconds"] = round(time.perf_counter() - pipeline_started, 3)
        report["timings"] = timings
        atomic_write_json(qa_path, report)
        result = {
            "path": str(source_path),
            "output_path": str(destination),
            "qa_path": str(qa_path),
            "status": report["status"],
            "page_count": len(selected_pages),
            "model": config["model"],
            "usage": report["usage"],
            "timings": timings,
        }
        _emit(emit, {"type": "done", **result})
        return result
