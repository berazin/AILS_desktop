from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
from collections import Counter
from dataclasses import dataclass
from typing import Any, Literal, TypedDict


ParagraphType = Literal[
    "title", "heading", "paragraph", "caption", "footnote", "list",
    "table", "figure", "formula", "code", "unknown",
]


class SpanIR(TypedDict, total=False):
    id: str
    text: str
    bbox: list[float]
    start: int
    end: int
    type: str
    font: str
    font_size: float
    bold: bool
    italic: bool
    serif: bool
    color: list[float] | int
    protect: bool
    translate: bool
    bbox_verified: bool
    baseline: float
    origin: list[float]


class FragmentIR(TypedDict, total=False):
    type: Literal["text", "formula", "code", "styled_text", "url", "citation"]
    text: str
    token: str
    start: int
    end: int
    source_start: int
    source_end: int
    bbox: list[float]
    baseline: float
    style: dict[str, Any]
    protected: bool


class LineIR(SpanIR, total=False):
    source_page: int
    line: int
    origin: list[float]
    available_right: float
    alignment: str
    spans: list[SpanIR]
    block_id: str | int
    column_id: str | int


class BlockIR(TypedDict, total=False):
    id: str
    type: str
    source_type: str
    text: str
    bbox: list[float]
    normalized_bbox: list[float]
    coordinate_space: str
    confidence: float | None
    reading_order: int | None
    text_source: str
    words: list[dict[str, Any]]
    table: dict[str, Any]
    formula: dict[str, Any]
    translate: bool


class ParagraphIR(SpanIR, total=False):
    line_ids: list[str]
    source_lines: list[LineIR]
    source: str
    reading_order: int
    spans: list[SpanIR]
    block_ids: list[str]
    column_id: str


class PageIR(TypedDict, total=False):
    source_page: int
    media_width: float
    media_height: float
    crop_left: float
    crop_bottom: float
    width: float
    height: float
    inverse_transform: list[float]
    layout_digest: str
    lines: list[LineIR]
    paragraphs: list[ParagraphIR]
    blocks: list[BlockIR]
    obstacles: list[BlockIR]


class DocumentIR(TypedDict, total=False):
    layout_version: int
    source: dict[str, Any]
    extractor: str
    selected_pages: list[int]
    total_pages: int
    pages: list[PageIR]


@dataclass(frozen=True)
class GroupingConfig:
    max_gap_ratio: float = 1.0
    font_size_tolerance: float = 0.12
    alignment_tolerance: float = 0.6
    max_indent_ratio: float = 1.8
    column_gap: float = 18.0
    short_line_ratio: float = 0.72
    heading_size_ratio: float = 1.2
    title_size_ratio: float = 1.6
    footnote_size_ratio: float = 0.8
    merge_threshold: float = 2.5
    geometry_weight: float = 1.5
    typography_weight: float = 1.0
    alignment_weight: float = 1.0
    indentation_penalty: float = 0.5
    punctuation_penalty: float = 0.5
    short_line_penalty: float = 1.5

    def __post_init__(self):
        for name, value in vars(self).items():
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"Invalid grouping setting: {name}")
        if self.column_gap == 0 or self.max_gap_ratio == 0:
            raise ValueError("column_gap and max_gap_ratio must be positive")


_PRESERVED_TYPES = {"formula", "code", "table", "figure", "unknown"}
_TYPES = set(ParagraphType.__args__)
_TYPE_ALIASES = {
    "text": "paragraph", "body": "paragraph", "other_text": "paragraph",
    "doc_title": "title", "document_title": "title", "paragraph_title": "heading",
    "section_title": "heading", "image": "figure", "chart": "figure",
    "figure_title": "caption", "table_title": "caption", "figure_caption": "caption",
    "table_caption": "caption", "formula_caption": "caption", "equation": "formula",
    "display_formula": "formula", "inline_formula": "formula", "algorithm": "code",
    "list_item": "list", "reference": "footnote", "reference_content": "footnote",
    "header": "unknown", "footer": "unknown", "number": "unknown",
}
_BULLET = re.compile(r"^\s*(?:[•●▪◦‣*-]|\(?\d{1,3}[.)]|[A-Za-z][.)])\s+")
_END_SENTENCE = re.compile(r"[.!?。！？][\"'’”\)\]]*\s*$")
_CODE_LINE = re.compile(
    r"^\s*(?:>>>|Traceback\b|(?:def|class)\s+\w+|from\s+\S+\s+import\b|"
    r"import\s+\w+|(?:if|elif|for|while|except)\s+.+:\s*$|(?:else|try|finally):|"
    r"(?:return|raise)\s+\S+|[A-Za-z_]\w*(?:\.\w+)*\s*(?:=(?!=)|\+=|-=)\s*\S+)"
)


def _kind(value: Any) -> str:
    value = str(value or "unknown").lower().replace("-", "_").replace(" ", "_")
    return _TYPE_ALIASES.get(value, value if value in _TYPES else "unknown")


def _bbox(value: Any) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError("bbox must contain four top-left coordinates")
    box = [float(item) for item in value]
    if not all(math.isfinite(item) for item in box) or box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("bbox must be finite and have positive area")
    return box


def _intersects(a: list[float], b: list[float]) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def _union(boxes: list[list[float]]) -> list[float]:
    return [min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)]


def _size(line: dict) -> float:
    value = float(line.get("font_size") or (line["bbox"][3] - line["bbox"][1]))
    if not math.isfinite(value) or value <= 0:
        raise ValueError("font_size must be positive and finite")
    return value


def _normalize_blocks(blocks: list[dict], width: float, height: float) -> list[dict]:
    result = []
    for index, block in enumerate(blocks):
        normalized = block.get("normalized_bbox")
        box = _bbox(normalized if normalized is not None else block.get("bbox"))
        space = block.get("coordinate_space")
        if normalized is not None or space == "normalized" or (
            space is None and all(0 <= item <= 1 for item in box)
        ):
            box = [box[0] * width, box[1] * height, box[2] * width, box[3] * height]
        elif space not in (None, "pdf_points"):
            raise ValueError("Layout blocks require normalized or pdf_points coordinates")
        kind = _kind(block.get("type", block.get("label")))
        result.append({
            **block, "id": str(block.get("id", f"B{index:04d}")),
            "source_type": block.get("source_type", block.get("type", block.get("label", "unknown"))),
            "type": kind, "bbox": box, "coordinate_space": "pdf_points",
            "translate": kind not in _PRESERVED_TYPES and block.get("translate", True),
        })
    return result


def _line_type(line: dict, blocks: list[dict], body_size: float, height: float, config: GroupingConfig) -> str:
    for block in blocks:
        if not block["translate"]:
            return block["type"]
    if blocks:
        return min(blocks, key=lambda b: (b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1]))["type"]
    if line.get("type"):
        return _kind(line["type"])
    text = str(line.get("text", ""))
    font = str(line.get("font", "")).lower()
    if "mono" in font or "courier" in font or _CODE_LINE.search(text):
        return "code"
    if re.fullmatch(r"\s*(?:\$[\s\S]+\$|\\\([\s\S]+\\\)|\\\[[\s\S]+\\\])\s*", text):
        return "formula"
    if _BULLET.match(text):
        return "list"
    if re.match(r"^\s*(?:Fig(?:ure)?\.?|Table)\s+\d", text, re.IGNORECASE):
        return "caption"
    size = _size(line)
    if size >= body_size * config.title_size_ratio:
        return "title"
    if size >= body_size * config.heading_size_ratio or line.get("bold", False):
        return "heading"
    if size <= body_size * config.footnote_size_ratio and line["bbox"][1] > height * 0.75:
        return "footnote"
    return "paragraph" if text.strip() else "unknown"


def _ordered(items: list[dict], config: GroupingConfig, column: str = "0") -> list[dict]:
    if len(items) <= 1:
        return [{**item, "column": column} for item in items]
    for axis in (0, 1):
        ordered = sorted(items, key=lambda item: item["box"][axis])
        edge = ordered[0]["box"][axis + 2]
        cuts = []
        for index, item in enumerate(ordered[1:], 1):
            gap = item["box"][axis] - edge
            if (axis == 0 and gap >= config.column_gap) or (axis == 1 and gap > 0):
                cuts.append((gap, index))
            edge = max(edge, item["box"][axis + 2])
        if cuts:
            _, split = max(cuts, key=lambda cut: (cut[0], -abs(cut[1] - len(ordered) / 2)))
            left_column = column + "L" if axis == 0 else column
            right_column = column + "R" if axis == 0 else column
            return _ordered(ordered[:split], config, left_column) + _ordered(ordered[split:], config, right_column)
    return [{**item, "column": column} for item in sorted(items, key=lambda item: (item["box"][1], item["box"][0]))]


def _merge_score(group: list[dict], item: dict, obstacles: list[dict], config: GroupingConfig) -> float:
    previous = group[-1]
    a, b = previous["line"], item["line"]
    first = group[0]
    if previous["column"] != item["column"] or previous["memberships"] != item["memberships"]:
        return -math.inf
    if any(a.get(key) != b.get(key) for key in ("block_id", "column_id")):
        return -math.inf
    if not previous["translate"] or not item["translate"] or item["kind"] in _PRESERVED_TYPES:
        return -math.inf
    if previous["kind"] != item["kind"] and not (first["kind"] == "list" and item["kind"] == "paragraph"):
        return -math.inf
    if _BULLET.match(str(b.get("text", ""))):
        return -math.inf
    if any(a.get(key, default) != b.get(key, default) for key, default in (
        ("font", ""), ("bold", False), ("italic", False), ("serif", False),
        ("color", [0.0, 0.0, 0.0]), ("alignment", "left"),
    )):
        return -math.inf
    size = max(_size(a), _size(b))
    if abs(_size(a) - _size(b)) > size * config.font_size_tolerance:
        return -math.inf
    ab, bb = previous["box"], item["box"]
    gap = bb[1] - ab[3]
    if gap < -size * 0.15 or gap > size * config.max_gap_ratio or min(ab[2], bb[2]) <= max(ab[0], bb[0]):
        return -math.inf
    corridor = _union([ab, bb])
    if any(_intersects(corridor, obstacle["bbox"]) for obstacle in obstacles):
        return -math.inf
    alignment = a.get("alignment", "left")
    delta = abs((ab[0] + ab[2] - bb[0] - bb[2]) / 2) if alignment == "center" else abs(ab[0] - bb[0])
    if alignment == "right":
        delta = abs(ab[2] - bb[2])
    if delta > size * config.max_indent_ratio:
        return -math.inf
    score = config.typography_weight + config.geometry_weight * (1 - max(0, gap) / (2 * size * config.max_gap_ratio))
    if delta <= size * config.alignment_tolerance:
        score += config.alignment_weight
    else:
        score += config.alignment_weight - config.indentation_penalty
    width = max(entry["box"][2] - entry["box"][0] for entry in group + [item])
    short = ab[2] - ab[0] < width * config.short_line_ratio
    if short:
        score -= config.short_line_penalty
    if _END_SENTENCE.search(str(a.get("text", ""))):
        score -= config.punctuation_penalty
    return score


def enrich_page(page: dict, *, source: str = "native_pdf", layout_blocks: list[dict] | None = None,
                config: GroupingConfig | None = None) -> dict:
    """Add dictionary IR without mutating lines; boxes use top-left PDF points.

    Recursive whitespace cuts establish columns; hard block/style/barrier gates
    precede weighted gap, alignment, indentation and sentence-ending evidence.
    """
    config = config or GroupingConfig()
    width, height = float(page["width"]), float(page["height"])
    if not all(math.isfinite(value) and value > 0 for value in (width, height)):
        raise ValueError("Page dimensions must be positive and finite")
    lines = page.get("lines", [])
    blocks = _normalize_blocks(layout_blocks if layout_blocks is not None else page.get("blocks", []), width, height)
    obstacles = [block for block in blocks if not block["translate"]]
    boxes = [_bbox(line.get("bbox")) for line in lines]
    body_size = statistics.median(_size(line) for line in lines) if lines else 10.0
    items = []
    for index, (line, box) in enumerate(zip(lines, boxes)):
        memberships = tuple(i for i, block in enumerate(blocks) if _intersects(box, block["bbox"]))
        members = [blocks[i] for i in memberships]
        kind = _line_type(line, members, body_size, height, config)
        translate = kind not in _PRESERVED_TYPES and bool(line.get("translate", True)) and all(b["translate"] for b in members)
        item = {"line": line, "box": box, "index": index, "memberships": memberships,
                "kind": kind, "translate": translate}
        items.append(item)
        if not translate and not any(not b["translate"] for b in members):
            obstacles.append({"id": f"line-obstacle-{index}", "type": kind, "bbox": box,
                              "translate": False, "coordinate_space": "pdf_points"})
    ordered = _ordered(items, config)
    if ordered and all(item["memberships"] and blocks[item["memberships"][0]].get("reading_order") is not None for item in ordered):
        ordered.sort(key=lambda item: blocks[item["memberships"][0]]["reading_order"])
    groups: list[list[dict]] = []
    for item in ordered:
        if groups and _merge_score(groups[-1], item, obstacles, config) >= config.merge_threshold:
            groups[-1].append(item)
        else:
            groups.append([item])
    paragraphs = []
    for order, group in enumerate(groups):
        source_lines = [item["line"] for item in group]
        first = source_lines[0]
        parts, spans = [], []
        offset = 0
        for line in source_lines:
            text = str(line.get("text", ""))
            for span in line.get("spans", []):
                if "start" in span and "end" in span:
                    spans.append({**span, "start": span["start"] + offset, "end": span["end"] + offset})
            parts.append(text)
            offset += len(text) + 1
        paragraphs.append({
            "id": f"P{int(page.get('source_page', 1)):04d}-PAR{order:04d}",
            "text": "\n".join(parts), "bbox": _union([item["box"] for item in group]),
            "line_ids": [str(item["line"].get("id", f"L{item['index']:04d}")) for item in group],
            "source_lines": source_lines, "source": source,
            "font": str(first.get("font", "")), "font_size": statistics.median(_size(line) for line in source_lines),
            "bold": bool(first.get("bold", False)), "italic": bool(first.get("italic", False)),
            "serif": bool(first.get("serif", False)), "color": first.get("color", [0.0, 0.0, 0.0]),
            "reading_order": order, "type": group[0]["kind"], "translate": all(item["translate"] for item in group),
            "spans": spans, "block_ids": [blocks[i]["id"] for i in group[0]["memberships"]],
            "column_id": group[0]["column"],
        })
    return {**page, "paragraphs": paragraphs, "blocks": blocks, "obstacles": obstacles}


class ProtectionError(ValueError):
    pass


class ProtectedElement(TypedDict):
    token: str
    text: str
    start: int
    end: int
    type: str


_TOKEN = re.compile(r"\[\[AILS_[A-F0-9]{24}_[0-9]{8}\]\]")
_FLEX_TOKEN = re.compile(r"\[\s*\[\s*A\s*I\s*L\s*S\s*_[^\[\]]*\]\s*\]", re.IGNORECASE | re.ASCII)
_PROTECTION_PATTERNS = (
    ("code", re.compile(r"```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`")),
    ("formula", re.compile(r"\$\$[\s\S]+?\$\$|(?<![\\\w])\$(?!\s|\d+[.,]?\d*\b)[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]")),
    ("url", re.compile(r"\b(?:https?://|ftp://|www\.)[^\s<>\"`]+", re.IGNORECASE)),
    ("email", re.compile(r"\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b")),
    ("path", re.compile(r"(?<!\w)(?:[A-Za-z]:\\|\\\\|\.{1,2}[/\\]|~/|/(?!/))[\w.~/\\:@+-]*[\w~/\\]")),
    ("citation", re.compile(r"\[\s*\d+(?:\s*[-–,;]\s*\d+)*\s*\]|\((?:[A-Z][A-Za-z’'-]+(?:\s+et\s+al\.)?[,;]?\s+\d{4}[a-z]?)(?:[^()\n]*?)\)")),
    ("reference", re.compile(r"\b(?:Fig(?:ure)?|Eq(?:uation)?|Table|Section|Chapter|Appendix)\.?\s+(?:\(?\d+(?:\.\d+)*[a-z]?\)?|[A-Z])\b", re.IGNORECASE)),
    ("identifier", re.compile(r"\b(?:[A-Za-z]\w*_[A-Za-z0-9_]\w*|[a-z]+(?:[A-Z][a-z0-9]+)+|[A-Z][A-Z0-9]*\d[A-Z0-9]*|[A-Za-z_]\w*(?:\.\w+)+\(\))\b")),
    ("formula", re.compile(r"(?<!\w)[A-Za-zα-ωΑ-Ω](?:[_^][\w{}]+)?\s*[=≈≤≥]\s*(?:[A-Za-z0-9α-ωΑ-Ω]+(?:[_^][\w{}]+)?)(?:\s*[+*/−-]\s*[A-Za-z0-9α-ωΑ-Ω]+(?:[_^][\w{}]+)?)*")),
    ("literal_token", _FLEX_TOKEN),
)


@dataclass
class ProtectedText:
    text: str
    elements: list[ProtectedElement]

    def restore(self, translated: str, *, retain_style: bool = True) -> str:
        """Restore exactly once per token, repairing only ASCII case and whitespace."""
        if not isinstance(translated, str):
            raise ProtectionError("Translation must be text")
        expected = {element["token"]: (element["token"] if retain_style and element["type"] in
                    {"style_start", "style_end"} else element["text"]) for element in self.elements}
        if len(expected) != len(self.elements):
            raise ProtectionError("Duplicate protection definitions")
        seen: Counter[str] = Counter()

        def replace(match: re.Match) -> str:
            token = re.sub(r"\s+", "", match.group()).upper()
            if token not in expected:
                raise ProtectionError("Unknown protected token")
            seen[token] += 1
            return expected[token]

        restored = _FLEX_TOKEN.sub(replace, translated)
        if any(seen[token] != 1 for token in expected):
            raise ProtectionError("Missing or duplicated protected token")
        return restored


def protect_text(text: str, *, spans: list[dict] | None = None) -> ProtectedText:
    """Explicit spans use Python start/end offsets; protect=False opts out.

    Overlapping protected ranges become one exact-source element. Detection is
    conservative; callers should supply spans for ambiguous math and rich text.
    """
    if not isinstance(text, str):
        raise ProtectionError("Source must be text")
    if spans is not None and not isinstance(spans, list):
        raise ProtectionError("Protected spans must be a list")
    ranges, styles = [], []
    for span in spans or []:
        if not isinstance(span, dict):
            raise ProtectionError("Protected spans must be dictionaries")
        if span.get("protect") is False:
            continue
        start, end = span.get("start"), span.get("end")
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
            raise ProtectionError("Invalid protected span offsets")
        if "text" in span and span["text"] != text[start:end]:
            raise ProtectionError("Protected span text does not match source")
        kind = str(span.get("type", "styled_text"))
        if kind in {"text", "styled_text", "rich_text"} and span.get("protect") is not True:
            if kind != "text" or any(key in span for key in ("font", "bold", "italic", "color", "font_size")):
                styles.append((start, end, "styled_text"))
        elif span.get("translate") is not True:
            ranges.append((start, end, kind))
    for kind, pattern in _PROTECTION_PATTERNS:
        for match in pattern.finditer(text):
            end = match.end()
            if kind in {"url", "path"}:
                while end > match.start() and text[end - 1] in ".,;:!?":
                    end -= 1
                while end > match.start() and text[end - 1] in ")]}":
                    closer = text[end - 1]
                    opener = {')': '(', ']': '[', '}': '{'}[closer]
                    value = text[match.start():end]
                    if value.count(closer) <= value.count(opener):
                        break
                    end -= 1
            ranges.append((match.start(), end, kind))
    offset = 0
    for line in text.splitlines(keepends=True):
        if _CODE_LINE.search(line):
            ranges.append((offset, offset + len(line.rstrip("\r\n")), "code"))
        offset += len(line)
    merged = []
    for start, end, kind in sorted(ranges, key=lambda item: (item[0], -item[1])):
        if merged and start < merged[-1][1]:
            previous = merged[-1]
            merged[-1] = (previous[0], max(previous[1], end), previous[2])
        else:
            merged.append((start, end, kind))
    active_styles = []
    for start, end, kind in sorted(set(styles)):
        if any(a <= start and end <= b for a, b, _ in merged):
            continue
        if any(a < start < b or a < end < b for a, b, _ in merged):
            raise ProtectionError("Style boundary intersects protected content")
        if active_styles and start < active_styles[-1][1]:
            raise ProtectionError("Overlapping style spans require normalization")
        active_styles.append((start, end, kind))
    events = list(merged)
    for start, end, _ in active_styles:
        events.extend(((start, start, "style_start"), (end, end, "style_end")))
    events.sort(key=lambda item: (item[0], {"style_end": 0, "style_start": 1}.get(item[2], 2)))
    payload = json.dumps([text, events], ensure_ascii=False, separators=(",", ":"))
    compact_source = re.sub(r"\s+", "", text).upper()
    nonce = 0
    while True:
        namespace = hashlib.sha256(f"{nonce}:{payload}".encode("utf-8")).hexdigest()[:24].upper()
        if f"AILS_{namespace}_" not in compact_source:
            break
        nonce += 1
    elements, parts = [], []
    offset = 0
    for index, (start, end, kind) in enumerate(events):
        token = f"[[AILS_{namespace}_{index:08d}]]"
        elements.append({"token": token, "text": text[start:end], "start": start, "end": end, "type": kind})
        parts.extend((text[offset:start], token))
        offset = end
    parts.append(text[offset:])
    return ProtectedText("".join(parts), elements)


def _protected_parts(protection: ProtectedText, limit: int) -> list[ProtectedText]:
    text = protection.text
    matches = list(_TOKEN.finditer(text))
    elements = {element["token"]: element for element in protection.elements}
    if any(len(token) > limit for token in elements):
        raise ValueError("max_characters is smaller than a protected token")
    parts = []
    start = 0
    while start < len(text):
        end = min(len(text), start + limit)
        for match in matches:
            if match.start() < end < match.end():
                end = match.start()
                break
        if end < len(text):
            boundaries = list(re.finditer(r"\s+|(?<=[.!?。！？])(?=\S)", text[start:end]))
            if boundaries and boundaries[-1].end() >= (end - start) // 2:
                end = start + boundaries[-1].end()
        chunk = text[start:end]
        selected = [elements[match.group()] for match in _TOKEN.finditer(chunk)]
        source_start = 0
        local_elements = []
        protected_start = 0
        for match, element in zip(_TOKEN.finditer(chunk), selected):
            source_start += match.start() - protected_start
            local_elements.append({**element, "start": source_start, "end": source_start + len(element["text"])})
            source_start += len(element["text"])
            protected_start = match.end()
        parts.append(ProtectedText(chunk, local_elements))
        start = end
    return parts


def make_segments(paragraphs: list[dict], source_language: str = "auto", target_language: str = "korean",
                  max_characters: int = 4000, context_characters: int = 300) -> list[dict]:
    """Cap protected payload length, excluding context; never split a token.

    Non-translatable paragraphs are context only. The protection object is
    runtime-only; source_text parts concatenate to the exact paragraph text.
    """
    if type(max_characters) is not int or max_characters <= 0 or type(context_characters) is not int or context_characters < 0:
        raise ValueError("Character limits must be positive/nonnegative integers")
    texts = [str(paragraph.get("text", "")) for paragraph in paragraphs]
    ids = [str(paragraph.get("id", f"PAR{index:04d}")) for index, paragraph in enumerate(paragraphs)]
    if len(set(ids)) != len(ids):
        raise ValueError("Paragraph IDs must be unique")
    document_text = "\n\n".join(texts)
    segments = []
    document_offset = 0
    for paragraph, text, paragraph_id in zip(paragraphs, texts, ids):
        if paragraph.get("translate", True) and _kind(paragraph.get("type", "paragraph")) not in _PRESERVED_TYPES:
            protection = protect_text(text, spans=paragraph.get("spans"))
            source_offset = document_offset
            for part_index, part in enumerate(_protected_parts(protection, max_characters)):
                source_text = part.restore(part.text, retain_style=False)
                source_end = source_offset + len(source_text)
                segments.append({
                    "id": f"{paragraph_id}-S{part_index:04d}", "paragraph_ids": [paragraph_id],
                    "source_text": source_text, "protected_text": part.text,
                    "protected_tokens": [element["token"] for element in part.elements],
                    "context_before": document_text[max(0, source_offset - context_characters):source_offset],
                    "context_after": document_text[source_end:source_end + context_characters],
                    "source_language": source_language, "target_language": target_language,
                    "protection": part, "part_index": part_index,
                })
                source_offset = source_end
        document_offset += len(text) + 2
    return segments
