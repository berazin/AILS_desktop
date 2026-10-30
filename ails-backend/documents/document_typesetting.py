from __future__ import annotations

import hashlib
import math
import os
import re
import struct
import tempfile
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from typing import Any
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont, TTFError
from reportlab.pdfgen import canvas


@dataclass
class LayoutFitResult:
    fits: bool = False
    overflow_x: float = 0.0
    overflow_y: float = 0.0
    font_size: float = 0.0
    line_spacing: float = 0.0
    character_spacing: float = 0.0
    expanded_bbox: tuple = ()
    line_count: int = 0
    fit_score: float = 0.0
    lines: tuple[str, ...] = ()
    font_name: str = ""
    reason: str = ""
    placements: tuple[dict[str, Any], ...] = ()


class FontFallbackResolver:
    def __init__(self, font_paths: Iterable[str | Path] | None = None) -> None:
        self.font_paths = font_paths
        self._names = {}

    def resolve_font(self, original_font: str | dict[str, Any], target_language: str,
                     required_characters: Iterable[str]) -> str:
        import pdf.pdf_translation as translation

        original = original_font if isinstance(original_font, dict) else {"font": original_font}
        if target_language not in self._names:
            names = []
            paths = self.font_paths
            if paths is None:
                try:
                    names.extend(translation._register_fonts(target_language))
                except (OSError, ValueError, TTFError):
                    pass
                roots = [Path(reportlab.__file__).parent / "fonts",
                         Path(__file__).resolve().parent.parent / "assets" / "fonts",
                         Path("/usr/share/fonts"), Path("/usr/local/share/fonts"),
                         Path.home() / ".local/share/fonts", Path("/Library/Fonts")]
                paths = [path for root in roots if root.is_dir()
                         for path in sorted(root.rglob("*"))
                         if path.suffix.lower() in {".ttf", ".ttc"}]
                from language_support import TRANSLATION_FONT_CANDIDATES, normalize_app_language
                windows = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
                paths += [windows / name for group in TRANSLATION_FONT_CANDIDATES[
                    normalize_app_language(target_language)] for name in group]
                names.extend(pdfmetrics.getRegisteredFontNames())
            with translation._font_registration_lock:
                for path in paths:
                    path = Path(path)
                    if not path.is_file():
                        continue
                    name = "AILSTypeset" + hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:16]
                    try:
                        if name not in pdfmetrics.getRegisteredFontNames():
                            pdfmetrics.registerFont(TTFont(name, str(path)))
                        names.append(name)
                    except (OSError, ValueError, TTFError):
                        continue
            self._names[target_language] = list(dict.fromkeys(names))
        required = {ord(char) for char in required_characters if char not in "\r\n\t"}
        candidates = []
        wanted = str(original.get("font", "")).lower().split("+")[-1]
        bold = bool(original.get("bold") or "bold" in wanted)
        italic = bool(original.get("italic") or any(word in wanted for word in ("italic", "oblique")))
        serif = bool(original.get("serif") or any(word in wanted for word in ("times", "serif", "roman")))
        original_name = str(original.get("font", ""))
        names = list(self._names[target_language])
        if original_name in pdfmetrics.getRegisteredFontNames() and original_name not in names:
            names.insert(0, original_name)
        for name in names:
            font = pdfmetrics.getFont(name)
            if not isinstance(font, TTFont) or not all(font.face.charToGlyph.get(code, 0) for code in required):
                continue
            face = font.face
            label = f"{name} {face.name} {face.familyName} {face.styleName}".lower()
            score = 8 * (bold == bool(face.flags & 262144 or "bold" in label))
            score += 8 * (italic == bool(face.italicAngle))
            score += 2 * (serif == bool(face.flags & 2))
            score += 4 * (any(word in wanted for word in ("mono", "courier", "console"))
                          == bool(face.flags & 1 or "mono" in label))
            score += 4 * (name == original_name)
            candidates.append((score, name))
        if not candidates:
            codes = " ".join(f"U+{code:04X}" for code in sorted(required)[:12])
            raise ValueError(f"unsupported_glyph: no verified TTFont covers required characters ({codes})")
        return max(candidates, key=lambda item: item[0])[1]


def _bbox(value):
    box = tuple(float(v) for v in value)
    if len(box) != 4 or not all(math.isfinite(v) for v in box) or box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("invalid_bbox")
    return box


def _intersects(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _owned_table_boundary(paragraph, item, page):
    table = next((t for t in page.get("tables", []) if t.get("id") == paragraph.get("table_id")), None)
    if not table or not table.get("plan", {}).get("renderable"):
        return False
    cell = next((c for c in table.get("cells", []) if c.get("id") == paragraph.get("id")), None)
    if not cell or item.get("id") not in table.get("owning_block_ids", []):
        return False
    box, bounds = _bbox(paragraph["bbox"]), _bbox(cell["bbox"])
    return bounds[0] < box[0] < box[2] < bounds[2] and bounds[1] < box[1] < box[3] < bounds[3]


def _authorized_scan_image(paragraph, item):
    authorization = paragraph.get("scan_authorization", {})
    if (not authorization.get("background_verified") or item.get("is_image") is not True
            or item.get("source_type") != "native_pdf_object"
            or item.get("id") != authorization.get("image_id")
            or authorization.get("text_provenance") not in {"indexed_ocr_match", "embedded_ocr_block"}):
        return False
    try:
        confidence = authorization["confidence"]
        if isinstance(confidence, bool) or not math.isfinite(float(confidence)) or not 0.90 <= float(confidence) <= 1:
            return False
        source, box, image = _bbox(authorization["source_bbox"]), _bbox(paragraph["bbox"]), _bbox(item["image_bbox"])
        return source == box and all(image[i] <= box[i] if i < 2 else box[i] <= image[i] for i in range(4))
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


def _barriers(paragraph, page):
    own = set(paragraph.get("line_ids", []))
    boxes = []
    paragraphs = page.get("paragraphs", [])
    source = next((other for other in paragraphs if other is paragraph), None)
    if source is None:
        source = next((other for other in paragraphs if other == paragraph), None)
    excluded = False
    for other in paragraphs:
        if other is source and not excluded:
            excluded = True
            continue
        boxes.append(_bbox(other["bbox"]))
    for key in ("lines", "original_lines", "obstacles", "blocks", "allocations"):
        for item in page.get(key, []):
            if key in {"blocks", "obstacles"} and (_owned_table_boundary(paragraph, item, page)
                                                    or _authorized_scan_image(paragraph, item)):
                continue
            kind = str(item.get("type", item.get("kind", ""))).lower()
            text_block = kind in {"text", "paragraph", "body", "heading", "title", "caption", "list", "footnote"}
            if (key in {"blocks", "obstacles"} and text_block and item.get("translate") is True
                    and item.get("id") in paragraph.get("block_ids", [])):
                continue
            if (key in {"lines", "original_lines"} or kind == "line") and item.get("id") in own:
                continue
            boxes.append(_bbox(item["bbox"]))
    for other in page.get("paragraphs", []):
        for line in other.get("source_lines", []):
            if line.get("id") not in own:
                boxes.append(_bbox(line["bbox"]))
    return boxes


@lru_cache(maxsize=8192)
def _glyph_bounds(font_name, char):
    face = pdfmetrics.getFont(font_name).face
    gid = face.charToGlyph[ord(char)]
    start, end = face.glyphPos[gid:gid + 2]
    if start == end:
        return (0.0, 0.0, 0.0, 0.0)
    offset = face.get_table_pos("glyf")[0] + start
    return tuple(v * 1000 / face.unitsPerEm for v in struct.unpack_from(">hhhh", face._ttf_data, offset + 2))


def _measure(text, name, size, tracking=0.0):
    face = pdfmetrics.getFont(name).face
    cursor = low = high = 0.0
    ascent, descent = face.ascent * size / 1000, -face.descent * size / 1000
    for char in text:
        x0, y0, x1, y1 = (v * size / 1000 for v in _glyph_bounds(name, char))
        low, high = min(low, cursor + x0), max(high, cursor + x1)
        ascent, descent = max(ascent, y1), max(descent, -y0)
        cursor += pdfmetrics.stringWidth(char, name, size) + tracking
    return max(high, cursor - tracking if text else 0) - low, -low, ascent, descent


_CJK = r"\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\u3040-\u30ff"
_TOKENS = re.compile(r"`[^`\n]+`|\$[^$\n]+\$|https?://\S+|[^\S\n]+|[" + _CJK + r"]|[^\s" + _CJK + r"]+")
_OPEN = "([{（［｛〈《「『【〔“‘"
_CLOSE = ")]},.!?:;%）］｝〉》」』】〕、。，．！？：；％”’"


def _wrap(text, name, size, tracking, width):
    lines = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").expandtabs(4).split("\n"):
        tokens = []
        for token in _TOKENS.findall(raw):
            if tokens and (token[0] in _CLOSE or tokens[-1][-1] in _OPEN):
                tokens[-1] += token
            else:
                tokens.append(token)
        current = ""
        for token in tokens:
            candidate = current + token
            if current.strip() and not token.isspace() and _measure(candidate.rstrip(), name, size, tracking)[0] > width:
                lines.append(current.rstrip())
                current = token.lstrip()
            else:
                current = candidate.lstrip() if not current else candidate
        lines.append(current.rstrip())
    return tuple(lines)


def _settings(config):
    settings = dict(config or {})
    for key, default, low, high in (("margin", 12.0, 0, 10000), ("min_font_ratio", 0.70, 0, 1),
                                   ("font_step_ratio", 0.01, 0.001, 0.1),
                                   ("max_expansion_points", 10000.0, 0, 10000)):
        value = float(settings.get(key, default))
        if not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"invalid_config: {key}")
        settings[key] = max(0.70, value) if key == "min_font_ratio" else value
    for key, default, low, high, descending in (
            ("line_spacing_ratios", (1.2, 1.1, 1.0), 1.0, 2.0, True),
            ("character_spacing_ratios", (0.0, -0.015, -0.03), -0.05, 0.0, True)):
        values = tuple(float(value) for value in settings.get(key, default))
        if (not 1 <= len(values) <= 32 or any(not math.isfinite(v) or not low <= v <= high for v in values)
                or values != tuple(sorted(set(values), reverse=descending))
                or (key == "character_spacing_ratios" and values[0] != 0)):
            raise ValueError(f"invalid_config: {key}")
        settings[key] = values
    order = tuple(settings.get("expansion_order", ("right", "bottom", "left", "top")))
    if len(order) != len(set(order)) or any(edge not in {"right", "bottom", "left", "top"} for edge in order):
        raise ValueError("invalid_config: expansion_order")
    settings["expansion_order"] = order
    return settings


def fit_paragraph(text: str, paragraph: dict[str, Any], page: dict[str, Any],
                  resolver: FontFallbackResolver | None = None,
                  config: dict[str, Any] | None = None) -> LayoutFitResult:
    result = LayoutFitResult()
    try:
        config = _settings(config)
        box = _bbox(paragraph["bbox"])
        size = float(paragraph["font_size"])
        width, height = float(page["width"]), float(page["height"])
        margin = float(config.get("margin", 12.0))
        if not all(math.isfinite(v) for v in (size, width, height, margin)) or size <= 0 or margin < 0:
            raise ValueError("invalid_geometry")
        result.font_size, result.expanded_bbox = size, box
        if not isinstance(text, str) or not text.strip():
            raise ValueError("empty_translation")
        if any(unicodedata.category(c).startswith("M") or unicodedata.bidirectional(c) in {"R", "AL"}
               or unicodedata.category(c) == "Cf" for c in text):
            raise ValueError("unsupported_shaping")
        name = (resolver or FontFallbackResolver(config.get("font_paths"))).resolve_font(
            paragraph, config.get("target_language", "korean"), text)
        font = pdfmetrics.getFont(name)
        if not isinstance(font, TTFont) or not all(font.face.charToGlyph.get(ord(c), 0) for c in text if c not in "\r\n\t"):
            raise ValueError("unsupported_glyph: resolver returned an unverified font")
        result.font_name = name
        obstacles = _barriers(paragraph, page)
        if box[0] < margin or box[1] < margin or box[2] > width - margin or box[3] > height - margin:
            raise ValueError("bbox_outside_margins")
        if any(_intersects(box, obstacle) for obstacle in obstacles):
            raise ValueError("source_collision")
        boxes = [box]
        expanded = list(box)
        directions = {"right": (2, width - margin), "bottom": (3, height - margin),
                      "left": (0, margin), "top": (1, margin)}
        for direction in (() if paragraph.get("scan_authorization") else config["expansion_order"]):
            edge, boundary = directions[direction]
            limit = config["max_expansion_points"]
            trial = expanded.copy()
            trial[edge] = min(boundary, box[edge] + limit) if edge >= 2 else max(boundary, box[edge] - limit)
            for obstacle in obstacles:
                if _intersects(trial, obstacle):
                    trial[edge] = min(trial[edge], obstacle[edge - 2]) if edge >= 2 else max(trial[edge], obstacle[edge + 2])
            if tuple(trial) != boxes[-1]:
                boxes.append(tuple(trial))
            expanded = trial
        min_ratio, step_ratio = config["min_font_ratio"], config["font_step_ratio"]
        leading, tracking = config["line_spacing_ratios"], config["character_spacing_ratios"]
        variants = [(size, leading[0], 0.0, b) for b in boxes]
        variants += [(size, value, 0.0, boxes[-1]) for value in leading[1:]]
        variants += [(size, leading[-1], size * value, boxes[-1]) for value in tracking[1:]]
        variants += [(size * max(min_ratio, 1 - step * step_ratio), leading[-1],
                      size * max(min_ratio, 1 - step * step_ratio) * tracking[-1], boxes[-1])
                     for step in range(1, math.ceil((1 - min_ratio) / step_ratio) + 1)]
        for current_size, leading, tracking, bounds in variants:
            available_width, available_height = bounds[2] - bounds[0], bounds[3] - bounds[1]
            lines = _wrap(text, name, current_size, tracking, available_width)
            metrics = [_measure(line, name, current_size, tracking) for line in lines]
            ink_height = max(m[2] for m in metrics) + max(m[3] for m in metrics)
            spacing = max(current_size * leading, ink_height)
            overflow_x = max(0.0, max(m[0] for m in metrics) - available_width)
            overflow_y = max(0.0, ink_height + (len(lines) - 1) * spacing - available_height)
            fits = overflow_x == 0 and overflow_y == 0
            result = LayoutFitResult(fits, overflow_x, overflow_y, current_size, spacing, tracking,
                                    bounds, len(lines), current_size / size if fits else 0.0,
                                    lines, name, "fit" if fits else "no_collision_free_fit")
            if fits:
                return result
        return result
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        result.reason = str(exc)
        return result


def _source_regions(paragraph, page):
    ids = paragraph.get("line_ids", [])
    lines = {line["id"]: line for line in page.get("lines", []) + page.get("original_lines", [])}
    lines.update({line["id"]: line for line in paragraph.get("source_lines", [])})
    if not ids or len(set(ids)) != len(ids) or any(key not in lines for key in ids):
        raise ValueError("missing_source_lines")
    regions = [lines[key] for key in ids]
    bounds = _bbox(paragraph["bbox"])
    barriers = _barriers(paragraph, page)
    for line in regions:
        box = _bbox(line["bbox"])
        if box[0] < bounds[0] or box[1] < bounds[1] or box[2] > bounds[2] or box[3] > bounds[3]:
            raise ValueError("source_line_outside_paragraph")
        if any(_intersects(box, obstacle) for obstacle in barriers):
            raise ValueError("source_region_collision")
    return regions


def _protected(paragraph, regions, text):
    import pdf.pdf_translation as translation

    for item in [paragraph, *regions]:
        kind = str(item.get("type", item.get("kind", ""))).lower()
        if (kind in {"formula", "equation", "code", "table", "image"}
                or any(item.get(key) for key in ("protected", "protected_runs", "protected_spans", "has_formula", "has_code"))
                or translation.is_code_line(str(item.get("text", "")), [str(item.get("font", ""))])):
            return True
    source = str(paragraph.get("text", "")) + "\n" + text
    return bool(re.search(r"`|\$|\\[([]|[=∑∫√]", source))


def _mask_colors(pixels, box, width, height):
    import numpy as np
    import pdf.pdf_translation as translation

    background = translation._sample_background_color(pixels, box, width, height)
    foreground = translation._sample_foreground_color(pixels, box, width, height, background)
    sx, sy = pixels.shape[1] / width, pixels.shape[0] / height
    x0, y0 = max(2, math.floor(box[0] * sx)), max(2, math.floor(box[1] * sy))
    x1, y1 = min(pixels.shape[1] - 2, math.ceil(box[2] * sx)), min(pixels.shape[0] - 2, math.ceil(box[3] * sy))
    if x1 <= x0 or y1 <= y0:
        raise ValueError("unsafe_background: empty_sample")
    ring = np.concatenate([pixels[y0 - 2:y0, x0:x1, :3].reshape(-1, 3),
                           pixels[y1:y1 + 2, x0:x1, :3].reshape(-1, 3),
                           pixels[y0:y1, x0 - 2:x0, :3].reshape(-1, 3),
                           pixels[y0:y1, x1:x1 + 2, :3].reshape(-1, 3)]).astype(float)
    bg, fg = np.array(background) * 255, np.array(foreground) * 255
    region = pixels[y0:y1, x0:x1, :3].reshape(-1, 3).astype(float)
    vector = fg - bg
    weight = np.maximum((region - bg) @ vector / max(float(vector @ vector), 1.0), 0)
    residual = np.max(np.abs(region - bg - weight[:, None] * vector), axis=1)
    if (np.mean(np.max(np.abs(ring - bg), axis=1) <= 12) < 0.90
            or np.mean(residual <= 16) < 0.99
            or np.mean(np.max(np.abs(region - bg), axis=1) <= 12) < 0.45):
        raise ValueError("unsafe_background: nonuniform_source_region")
    return background, foreground


def render_document_pdf(source_path: Path, output_path: Path, layout: dict[str, Any], translations: dict[str, str], *,
                        target_language: str = "korean", emit: Callable[[dict[str, Any]], None] | None = None,
                        cancel_check: Callable[[], None] | None = None,
                        config: dict[str, Any] | None = None) -> dict[str, Any]:
    import numpy as np
    import pypdfium2 as pdfium
    from pypdf import PdfReader, PdfWriter
    import pdf.pdf_translation as translation
    from pdf.pdfium_runtime import locked_pdfium
    from pdf.page_transform import PageTransform
    from documents.document_fragments import assemble_fragments, fit_fragments, draw_fragment_text, add_formula_forms

    source_path, output_path = Path(source_path).resolve(), Path(output_path).resolve()
    if source_path == output_path or (output_path.exists() and os.path.samefile(source_path, output_path)):
        raise ValueError("source_and_output_must_differ")
    config = _settings({**(config or {}), "target_language": target_language})
    resolver = FontFallbackResolver(config.get("font_paths"))
    report = {"status": "failed", "pages": [], "omitted": [], "rendered_count": 0, "skipped_count": 0,
              "preserved_pages": []}
    seen, page_numbers = set(), set()
    with source_path.open("rb") as source_stream:
        reader = PdfReader(source_stream)
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        with locked_pdfium():
            document = pdfium.PdfDocument(str(source_path))
        try:
            for page_data in layout.get("pages", []):
                translation._check_cancel(cancel_check)
                number = page_data.get("source_page")
                if not isinstance(number, int) or number in page_numbers or not 1 <= number <= len(reader.pages):
                    report["omitted"].append({"source_page": number, "reason": "invalid_or_duplicate_page"})
                    continue
                page_numbers.add(number)
                page_report = {"source_page": number, "paragraphs": [], "reason": ""}
                report["pages"].append(page_report)
                if "page_transform" in page_data:
                    try:
                        transform = PageTransform.from_dict(page_data["page_transform"])
                        if transform != PageTransform.from_page(reader.pages[number - 1]):
                            raise ValueError("layout_transform_mismatch")
                    except (TypeError, ValueError, KeyError):
                        page_report["reason"] = "layout_transform_mismatch"
                        continue
                    mw = width = transform.width
                    mh = height = transform.height
                    left = bottom = 0.0
                    inverse = transform.overlay_to_pdf
                else:
                    geometry = translation._normalized_page_geometry(reader.pages[number - 1])
                    mw, mh, left, bottom, width, height, inverse = geometry
                if any(not math.isclose(float(page_data.get(key, -1)), value, abs_tol=0.05)
                       for key, value in (("width", width), ("height", height))):
                    page_report["reason"] = "layout_geometry_mismatch"
                    continue
                if "inverse_transform" in page_data and (len(page_data["inverse_transform"]) != 6 or any(
                        not math.isclose(float(a), b, abs_tol=0.001) for a, b in zip(page_data["inverse_transform"], inverse))):
                    page_report["reason"] = "layout_transform_mismatch"
                    continue
                page = {**page_data, "allocations": list(page_data.get("allocations", []))}
                prepared = []
                if not page.get("paragraphs"):
                    page_report["reason"] = "missing_paragraph_layout"
                for paragraph in page.get("paragraphs", []):
                    translation._check_cancel(cancel_check)
                    key = paragraph.get("id")
                    result = LayoutFitResult()
                    try:
                        if not key or key in seen:
                            raise ValueError("missing_or_duplicate_paragraph_id")
                        seen.add(key)
                        if not paragraph.get("translate", True):
                            page_report["paragraphs"].append({"id": key, **asdict(result), "status": "skipped",
                                                              "reason": "preserved_nontranslatable"})
                            report["skipped_count"] += 1
                            continue
                        if key not in translations:
                            raise ValueError("missing_translation")
                        text = translations[key]
                        if not isinstance(text, str) or not text.strip():
                            raise ValueError("empty_translation")
                        if paragraph.get("scan_fallback_reason"):
                            raise ValueError(paragraph["scan_fallback_reason"])
                        regions = _source_regions(paragraph, page)
                        if paragraph.get("scan_authorization"):
                            if _protected(paragraph, regions, text) or paragraph.get("spans"):
                                raise ValueError("scan_protected_content_preserved")
                            regions = [{"bbox": paragraph["scan_authorization"]["source_bbox"]}]
                        fragments = assemble_fragments(paragraph, text)
                        paragraph_config = {**config, "expansion_order": ()} if paragraph.get("fixed_bbox") else config
                        if fragments:
                            if any(paragraph.get(flag) for flag in ("protected_runs", "protected_spans", "has_formula", "has_code")):
                                raise ValueError("unmapped_protected_content: review_required")
                            result = fit_fragments(fragments, paragraph, page, resolver, paragraph_config)
                        else:
                            if _protected(paragraph, regions, text):
                                raise ValueError("protected_content_requires_rich_placement")
                            result = fit_paragraph(text, paragraph, page, resolver, paragraph_config)
                        if result.fits:
                            page["allocations"].append({"bbox": result.expanded_bbox})
                            prepared.append((paragraph, regions, result))
                    except (KeyError, TypeError, ValueError) as exc:
                        result.reason = str(exc)
                    page_report["paragraphs"].append({"id": key, **asdict(result),
                                                      "status": "rendered" if result.fits else "failed"})
                if prepared:
                    image = translation._render_pdfium_page(document, number - 1, 2.0)
                    buffer = BytesIO()
                    try:
                        pixels = np.asarray(image)
                        overlay = canvas.Canvas(buffer, pagesize=(mw, mh), pageCompression=1)
                        colors, safe, samples = [], [], []
                        failed_tables = set()
                        for paragraph, regions, result in prepared:
                            if paragraph.get("table_id"):
                                bounds = paragraph["bbox"]
                                regions = [{**line, "bbox": [max(bounds[0], line["bbox"][0] - 1),
                                            max(bounds[1], line["bbox"][1] - 1),
                                            min(bounds[2], line["bbox"][2] + 1),
                                            min(bounds[3], line["bbox"][3] + 1)]} for line in regions]
                            try:
                                sampled = [_mask_colors(pixels, line["bbox"], width, height) for line in regions]
                            except ValueError as exc:
                                result.fits, result.fit_score, result.reason = False, 0.0, str(exc)
                                record = next(item for item in page_report["paragraphs"] if item["id"] == paragraph["id"])
                                record.update(asdict(result), status="failed")
                                if paragraph.get("table_id"):
                                    failed_tables.add(paragraph["table_id"])
                                continue
                            samples.append((paragraph, regions, result, sampled))
                        for paragraph, regions, result, sampled in samples:
                            if paragraph.get("table_id") in failed_tables:
                                result.fits, result.fit_score, result.reason = False, 0.0, "unsafe_table_region"
                                record = next(item for item in page_report["paragraphs"] if item["id"] == paragraph["id"])
                                record.update(asdict(result), status="failed")
                                continue
                            safe.append((paragraph, regions, result))
                            colors.append(sampled[0][1])
                            for line, (background, _) in zip(regions, sampled):
                                x0, y0, x1, y1 = line["bbox"]
                                overlay.setFillColorRGB(*background)
                                overlay.rect(left + x0, bottom + height - y1, x1 - x0, y1 - y0, stroke=0, fill=1)
                        prepared = safe
                        for (_, _, result), color in zip(prepared, colors):
                            if result.placements:
                                draw_fragment_text(overlay, result, left, bottom, height, color)
                                continue
                            x0, y0, x1, y1 = result.expanded_bbox
                            metrics = [_measure(line, result.font_name, result.font_size, result.character_spacing)
                                       for line in result.lines]
                            overlay.saveState()
                            clip = overlay.beginPath()
                            clip.rect(left + x0, bottom + height - y1, x1 - x0, y1 - y0)
                            overlay.clipPath(clip, stroke=0)
                            for index, (line, metric) in enumerate(zip(result.lines, metrics)):
                                obj = overlay.beginText(left + x0 + metric[1], bottom + height - y0
                                                        - max(m[2] for m in metrics) - index * result.line_spacing)
                                obj.setFont(result.font_name, result.font_size)
                                obj.setCharSpace(result.character_spacing)
                                obj.setFillColorRGB(*color)
                                obj.textOut(line)
                                overlay.drawText(obj)
                            overlay.restoreState()
                        overlay.showPage()
                        overlay.save()
                        buffer.seek(0)
                        overlay_page = PdfReader(buffer).pages[0].clone(writer)
                        add_formula_forms(overlay_page, reader.pages[number - 1],
                                          [item for _, _, result in prepared for item in result.placements],
                                          writer, inverse, left, bottom, height)
                        writer.pages[number - 1].merge_transformed_page(overlay_page, inverse, over=True, expand=False)
                    finally:
                        image.close()
                        buffer.close()
                    report["rendered_count"] += len(prepared)
                translation._emit(emit, {"type": "render_progress", "page": number, "rendered": len(prepared)})
            report["omitted"].extend({"id": key, "reason": "translation_without_layout"}
                                     for key in translations if key not in seen)
            selected = set(layout.get("selected_pages", page_numbers))
            report["omitted"].extend({"source_page": number, "reason": "selected_page_without_layout"}
                                     for number in sorted(selected - page_numbers))
            report["preserved_pages"] = [number for number in range(1, len(reader.pages) + 1)
                                         if number not in page_numbers and number not in selected]
            failed = bool(report["omitted"]) or any(page["reason"] or any(p["status"] == "failed" for p in page["paragraphs"])
                                                   for page in report["pages"])
            report["status"] = "partial" if failed and report["rendered_count"] else "failed" if failed or not seen else "success"
            translation._check_cancel(cancel_check)
            fd, temporary = tempfile.mkstemp(prefix=f".{output_path.stem}-", suffix=".pdf", dir=output_path.parent)
            try:
                with os.fdopen(fd, "wb") as handle:
                    writer.write(handle)
                    handle.flush()
                    os.fsync(handle.fileno())
                translation._check_cancel(cancel_check)
                from documents.atomic_output import replace_output
                replace_output(temporary, output_path, cancel_check)
            finally:
                Path(temporary).unlink(missing_ok=True)
        finally:
            with locked_pdfium():
                document.close()
            writer.close()
    return report
