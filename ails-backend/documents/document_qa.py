from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Mapping
from contextlib import ExitStack, closing
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageFilter, ImageStat
from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from documents.document_ir import protect_text
from documents.document_typesetting import _bbox, _intersects, _measure
from pdf.page_transform import PageTransform
from pdf.pdf_translation import _render_pdfium_page, source_identity
from pdf.pdfium_runtime import locked_pdfium


_TOLERANCE = 0.05


def _issue(axis, code, **details):
    axis["issues"].append({"code": code, **details})
    axis["status"] = "review_required"


def _number(value, positive=False):
    if isinstance(value, bool):
        raise ValueError("invalid_number")
    result = float(value)
    if not math.isfinite(result) or (positive and result <= 0):
        raise ValueError("invalid_number")
    return result


def _inspect_pdf(path, label, axis):
    transforms = []
    try:
        with Path(path).open("rb") as stream:
            reader = PdfReader(stream)
            for number, page in enumerate(reader.pages, 1):
                try:
                    transforms.append(PageTransform.from_page(page))
                except (TypeError, ValueError, KeyError):
                    transforms.append(None)
                    _issue(axis, "invalid_page_geometry", document=label, page=number)
    except Exception as error:
        _issue(axis, "pdf_open_failed", document=label, error_type=type(error).__name__)
        return None
    with locked_pdfium():
        try:
            document = pdfium.PdfDocument(str(path))
        except Exception as error:
            _issue(axis, "pdfium_open_failed", document=label, error_type=type(error).__name__)
            return transforms
        try:
            if len(document) != len(transforms):
                _issue(axis, "reader_page_count_mismatch", document=label)
            for index in range(len(document)):
                try:
                    image = _render_pdfium_page(document, index, 1.0)
                    try:
                        if image.width <= 0 or image.height <= 0:
                            raise ValueError("empty_render")
                        axis["rendered_pages"][label] += 1
                    finally:
                        image.close()
                except Exception as error:
                    _issue(axis, "page_render_failed", document=label, page=index + 1,
                           error_type=type(error).__name__)
        finally:
            document.close()
    return transforms


def _contains(outer, inner):
    return all(a <= b + _TOLERANCE for a, b in
               ((outer[0], inner[0]), (outer[1], inner[1]), (inner[2], outer[2]), (inner[3], outer[3])))


def _overlap(a, b):
    return min(a[2], b[2]) - max(a[0], b[0]) > _TOLERANCE and min(a[3], b[3]) - max(a[1], b[1]) > _TOLERANCE


def _fragment_placements(fit, paragraph, transform, layout_axis, render_axis, record, formulas):
    bounds = _bbox(fit["expanded_bbox"])
    boxes = []
    rows = {}
    for index, item in enumerate(fit["placements"]):
        context = {"page": record["page"], "id": record["id"], "placement": index}
        try:
            if not isinstance(item, Mapping):
                raise ValueError("invalid_placement")
            x, baseline = _number(item["x"]), _number(item["baseline"])
            metric = tuple(_number(v) for v in item["metric"])
            if len(metric) != 4 or metric[0] <= 0 or any(v < 0 for v in metric[1:]):
                raise ValueError("invalid_metric")
            text = item["text"]
            if not isinstance(text, str) or not text or any(c in text for c in "\r\n\t"):
                raise ValueError("invalid_placement_text")
            line = item["line"]
            if type(line) is not int or line < 0:
                raise ValueError("invalid_line")
            rows.setdefault(line, []).append(text)
            if item.get("type") == "formula":
                crop = _bbox(item["bbox"])
                source_baseline = _number(item["source_baseline"])
                expected = (crop[2] - crop[0], 0, source_baseline - crop[1], crop[3] - source_baseline)
                spans = [span for span in paragraph.get("spans", [])
                         if span.get("type") == "formula" and span.get("bbox_verified") is True
                         and span.get("start") == item.get("source_start")
                         and span.get("end") == item.get("source_end")]
                valid = (len(spans) == 1 and paragraph.get("source", "native_pdf") == "native_pdf"
                         and _number(item["scale"]) == 1 and crop[1] <= source_baseline <= crop[3]
                         and _contains(_bbox(paragraph["bbox"]), crop)
                         and any(_contains(_bbox(line["bbox"]), crop) for line in paragraph.get("source_lines", [])))
                if valid:
                    span = spans[0]
                    valid = (all(abs(a - b) <= _TOLERANCE for a, b in zip(crop, _bbox(span["bbox"])))
                             and abs(source_baseline - _number(span["baseline"])) <= _TOLERANCE
                             and paragraph["text"][span["start"]:span["end"]] == text)
                if not valid:
                    _issue(layout_axis, "invalid_formula_provenance", **context)
                output_box = (x, baseline - expected[2], x + expected[0], baseline + expected[3])
                if valid:
                    formulas.append({**context, "source_bbox": list(crop), "output_bbox": list(output_box),
                                     "source_baseline": source_baseline, "baseline": baseline, "scale": 1,
                                     "structural_provenance": "not_evaluated", "pixel_comparison": "not_evaluated"})
            else:
                size = _number(item["font_size"], positive=True)
                original_size = _number(item.get("style", {}).get("font_size", paragraph["font_size"]), positive=True)
                if size / original_size < 0.70 - 1e-9:
                    _issue(layout_axis, "font_ratio_below_minimum", **context, ratio=size / original_size)
                expected = metric
                name = item.get("font_name")
                try:
                    font = pdfmetrics.getFont(name)
                    if not isinstance(font, TTFont):
                        _issue(render_axis, "unverified_font", **context, font_name=name)
                    else:
                        missing = sorted({ord(c) for c in text if not font.face.charToGlyph.get(ord(c), 0)})
                        if missing:
                            _issue(render_axis, "missing_glyph", **context, font_name=name,
                                   codepoints=[f"U+{code:04X}" for code in missing])
                        else:
                            expected = _measure(text, name, size)
                except (TypeError, ValueError, KeyError, AttributeError, OverflowError):
                    _issue(render_axis, "font_metrics_unavailable", **context, font_name=name)
                output_box = (x + metric[1] - expected[1], baseline - expected[2],
                              x + metric[1] - expected[1] + expected[0], baseline + expected[3])
            if any(abs(a - b) > _TOLERANCE for a, b in zip(metric, expected)):
                _issue(layout_axis, "placement_metrics_mismatch", **context)
            output_box = _bbox(output_box)
            if not _contains(bounds, output_box):
                _issue(layout_axis, "bbox_overflow", **context, bbox=list(output_box))
            if transform is not None and not _contains((0, 0, transform.width, transform.height), output_box):
                _issue(layout_axis, "bbox_outside_page", **context, bbox=list(output_box))
            for other_index, other_box in boxes:
                if _overlap(output_box, other_box):
                    _issue(layout_axis, "placement_collision", **context, other_placement=other_index)
            boxes.append((index, output_box))
        except (TypeError, ValueError, KeyError, AttributeError, OverflowError):
            _issue(layout_axis, "invalid_placement_geometry", **context)
    lines = fit.get("lines", [])
    if (not isinstance(lines, (tuple, list)) or any(not isinstance(s, str) for s in lines)
            or any(line >= len(lines) or "".join(texts) != lines[line] for line, texts in rows.items())
            or any(text.strip() and index not in rows for index, text in enumerate(lines))):
        _issue(render_axis, "output_placement_mismatch", page=record["page"], id=record["id"])
    record["placement_bboxes"] = [list(box) for _, box in boxes]
    if not boxes:
        return None
    return (min(b[0] for _, b in boxes), min(b[1] for _, b in boxes),
            max(b[2] for _, b in boxes), max(b[3] for _, b in boxes))


def _placement(fit, paragraph, page, transform, layout_axis, render_axis, record, formulas):
    context = {"page": page["source_page"], "id": fit.get("id")}
    if (fit.get("fits") is not True or fit.get("fallback")
            or fit.get("status") in {"failed", "fallback", "skipped", "preserved"}
            or "fallback" in str(fit.get("reason", "")).lower()):
        _issue(layout_axis, "placement_not_successful", **context, reason=fit.get("reason", ""))
        return None
    try:
        box = _bbox(fit.get("expanded_bbox", ()))
        size = _number(fit.get("font_size"), positive=True)
        original_size = _number(paragraph.get("font_size"), positive=True)
        if size / original_size < 0.70 - 1e-9:
            _issue(layout_axis, "font_ratio_below_minimum", **context, ratio=size / original_size)
        if transform is not None and (box[0] < -_TOLERANCE or box[1] < -_TOLERANCE
                                     or box[2] > transform.width + _TOLERANCE
                                     or box[3] > transform.height + _TOLERANCE):
            _issue(layout_axis, "bbox_outside_page", **context, bbox=list(box))
        if any(_number(fit.get(key, 0)) > _TOLERANCE for key in ("overflow_x", "overflow_y")):
            _issue(layout_axis, "reported_overflow", **context)
    except (TypeError, ValueError, KeyError, OverflowError):
        _issue(layout_axis, "invalid_placement_geometry", **context)
        return None
    if fit.get("placements"):
        if not isinstance(fit["placements"], (list, tuple)):
            _issue(layout_axis, "invalid_placement_geometry", **context)
            return None
        return _fragment_placements(fit, paragraph, transform, layout_axis, render_axis, record, formulas)
    lines = fit.get("lines")
    if (not isinstance(lines, (list, tuple)) or not lines
            or any(not isinstance(line, str) for line in lines) or not "".join(lines).strip()):
        _issue(render_axis, "missing_output_lines", **context)
        return box
    try:
        name = fit.get("font_name")
        font = pdfmetrics.getFont(name)
        if not isinstance(font, TTFont):
            _issue(render_axis, "unverified_font", **context, font_name=name)
            return box
        missing = sorted({ord(char) for line in lines for char in line
                          if char not in "\r\n\t" and not font.face.charToGlyph.get(ord(char), 0)})
        if missing:
            _issue(render_axis, "missing_glyph", **context, font_name=name,
                   codepoints=[f"U+{code:04X}" for code in missing])
            return box
        tracking = _number(fit.get("character_spacing", 0))
        metrics = [_measure(line, name, size, tracking) for line in lines]
        height = max(item[2] for item in metrics) + max(item[3] for item in metrics)
        leading = _number(fit.get("line_spacing", max(size * 1.2, height)), positive=True)
        if len(lines) > 1 and leading + _TOLERANCE < height:
            _issue(layout_axis, "line_collision", **context)
        overflow_x = max(0.0, max(item[0] for item in metrics) - (box[2] - box[0]))
        overflow_y = max(0.0, height + (len(lines) - 1) * leading - (box[3] - box[1]))
        if max(overflow_x, overflow_y) > _TOLERANCE:
            _issue(layout_axis, "bbox_overflow", **context, overflow_x=overflow_x, overflow_y=overflow_y)
    except (TypeError, ValueError, KeyError, AttributeError, OverflowError):
        _issue(render_axis, "font_metrics_unavailable", **context, font_name=fit.get("font_name"))
    return box


def _verify_formulas(source, output, source_pages, output_pages, layout, axis):
    records = axis["formulas"]
    if not records:
        return
    try:
        with ExitStack() as stack:
            before = PdfReader(stack.enter_context(Path(source).open("rb")))
            after = PdfReader(stack.enter_context(Path(output).open("rb")))
            for record in records:
                number = record["page"]
                try:
                    page = before.pages[number - 1]
                    transform = source_pages[number - 1]
                    layout_page = next(p for p in layout["pages"] if p["source_page"] == number)
                    if "page_transform" in layout_page:
                        left = bottom = 0
                        height = transform.height
                        inverse = transform.overlay_to_pdf
                    else:
                        from pdf.pdf_translation import _normalized_page_geometry
                        _, _, left, bottom, _, height, inverse = _normalized_page_geometry(page)
                    a, b, c, d, e, f = inverse
                    det = a * d - b * c
                    forward = (d / det, -b / det, -c / det, a / det,
                               (c * f - d * e) / det, (b * e - a * f) / det)
                    x0, y0, x1, y1 = record["source_bbox"]
                    crop = (left + x0, bottom + height - y1, left + x1, bottom + height - y0)
                    content = page.get_contents().get_data()
                    output_page = after.pages[number - 1]
                    objects = output_page.get("/Resources", {}).get("/XObject", {})
                    found = False
                    for name, reference in objects.items():
                        form = reference.get_object()
                        if form.get("/Subtype") != "/Form" or not content:
                            continue
                        data = form.get_data()
                        position = data.find(content)
                        if position < 0 or not form.get("/Resources"):
                            continue
                        prefix = data[:position].decode("ascii")
                        tokens = prefix.split()
                        if len(tokens) != 15 or tokens[0] != "q" or tokens[5:8] != ["re", "W", "n"] or tokens[-1] != "cm":
                            continue
                        clip = tuple(_number(v) for v in tokens[1:5])
                        matrix = tuple(_number(v) for v in tokens[8:14])
                        if (not all(abs(a - b) <= _TOLERANCE for a, b in zip(_bbox(form["/BBox"]), crop))
                                or not all(abs(a - b) <= _TOLERANCE for a, b in zip(clip, (crop[0], crop[1], x1 - x0, y1 - y0)))
                                or not all(abs(a - b) <= 1e-7 for a, b in zip(matrix, forward))):
                            continue
                        operations = output_page.get_contents().operations
                        delta = (1, 0, 0, 1, record["output_bbox"][0] - x0,
                                 record["source_baseline"] - record["baseline"])
                        for index, (args, operator) in enumerate(operations):
                            if operator == b"Do" and str(args[0]) == str(name) and index:
                                values, previous = operations[index - 1]
                                if previous == b"cm" and len(values) == 6 and all(
                                        abs(_number(a) - b) <= _TOLERANCE for a, b in zip(values, delta)):
                                    found = True
                        if found:
                            break
                    record["structural_provenance"] = "passed" if found else "review_required"
                    if not found:
                        _issue(axis, "formula_vector_provenance_unverified", page=number,
                               id=record["id"], placement=record["placement"])
                except (TypeError, ValueError, KeyError, AttributeError, IndexError, OverflowError):
                    record["structural_provenance"] = "review_required"
                    _issue(axis, "formula_vector_provenance_unverified", page=number,
                           id=record["id"], placement=record["placement"])
    except Exception as error:
        _issue(axis, "formula_verification_unavailable", error_type=type(error).__name__)
        return
    with locked_pdfium(), ExitStack() as stack:
        try:
            before = stack.enter_context(closing(pdfium.PdfDocument(str(source))))
            after = stack.enter_context(closing(pdfium.PdfDocument(str(output))))
            for number in sorted({record["page"] for record in records}):
                selected = [record for record in records if record["page"] == number]
                try:
                    transform = source_pages[number - 1]
                    if transform is None or output_pages[number - 1] != transform:
                        continue
                    scale = min(4.0, math.sqrt(16000000 / (transform.width * transform.height)))
                    with closing(_render_pdfium_page(before, number - 1, scale)) as original, \
                            closing(_render_pdfium_page(after, number - 1, scale)) as rendered:
                        for record in selected:
                            with ExitStack() as crops:
                                source_box = record["source_bbox"]
                                size = (max(1, round((source_box[2] - source_box[0]) * scale)),
                                        max(1, round((source_box[3] - source_box[1]) * scale)))
                                samples = []
                                for image, key in ((original, "source_bbox"), (rendered, "output_bbox")):
                                    box = record[key]
                                    if not _contains((0, 0, transform.width, transform.height), box):
                                        raise ValueError("crop_outside_page")
                                    extent = transform.canonical_bbox_to_image(box, image.width, image.height)
                                    crop = crops.enter_context(image.transform(size, Image.Transform.EXTENT, extent,
                                                                               resample=Image.Resampling.BILINEAR))
                                    samples.append(crops.enter_context(crop.filter(ImageFilter.GaussianBlur(0.6))))
                                contrast = max(ImageStat.Stat(samples[0]).stddev)
                                if contrast < 5 or min(size) < 3:
                                    record["pixel_comparison_reason"] = "insufficient_source_detail"
                                    continue
                                difference = crops.enter_context(ImageChops.difference(*samples))
                                error = sum(ImageStat.Stat(difference).mean) / 3
                                passed = error <= 20 and error <= contrast * 0.5
                                record.update(pixel_comparison="passed" if passed else "review_required",
                                              pixel_mean_absolute_error=error)
                                if not passed:
                                    _issue(axis, "formula_crop_changed", page=number, id=record["id"],
                                           placement=record["placement"])
                except Exception as error:
                    for record in selected:
                        record["pixel_comparison_reason"] = type(error).__name__
        except Exception as error:
            for record in records:
                record["pixel_comparison_reason"] = type(error).__name__


def _owned_boundary(item, paragraph, output_box, page):
    try:
        kind = str(item.get("type", item.get("kind", ""))).lower()
        box = _bbox(item["bbox"])
        authorization = paragraph.get("scan_authorization")
        if kind == "image" or item.get("is_image") is True:
            if not isinstance(authorization, Mapping):
                return False
            source = _bbox(authorization["source_bbox"])
            image = _bbox(item.get("image_bbox", box))
            return (authorization.get("background_verified") is True
                    and authorization.get("image_id") is not None
                    and item.get("id") == authorization["image_id"]
                    and authorization.get("text_provenance") in {"indexed_ocr_match", "embedded_ocr_block"}
                    and 0.90 <= _number(authorization["confidence"]) <= 1
                    and source == _bbox(paragraph["bbox"])
                    and _contains(box, source) and _contains(image, source))
        own = set(paragraph.get("line_ids", [])) | set(paragraph.get("block_ids", [])) | {paragraph.get("id")}
        own.discard(None)
        owner = item.get("paragraph_id", item.get("owner_id", item.get("line_id")))
        if kind in {"inline_formula", "inline_boundary", "formula"} and (owner in own or item.get("id") in own):
            return any(span.get("type") == "formula" and span.get("bbox_verified") is True
                       and all(abs(a - b) <= _TOLERANCE for a, b in zip(_bbox(span["bbox"]), box))
                       for span in paragraph.get("spans", []))
        for table in page.get("tables", []):
            if table.get("id") != paragraph.get("table_id") or table.get("status") != "ready":
                continue
            cells = [cell for cell in table.get("cells", []) if cell.get("id") == paragraph.get("id")]
            if len(cells) != 1 or not _contains(_bbox(cells[0]["bbox"]), output_box):
                continue
            if not _contains(_bbox(cells[0]["bbox"]), _bbox(paragraph["bbox"])):
                continue
            if (kind == "table" and item.get("id") in {table.get("id"), table.get("block_id")}
                    and all(abs(a - b) <= _TOLERANCE for a, b in zip(_bbox(table["bbox"]), box))):
                return True
        if (kind == "table" and paragraph.get("table_id") is not None
                and item.get("id") == paragraph["table_id"]
                and _contains(box, _bbox(paragraph["bbox"])) and _contains(box, output_box)):
            return True
        if (kind in {"cell", "table_cell"} and paragraph.get("cell_id") is not None
                and item.get("id") == paragraph["cell_id"]
                and paragraph.get("table_id") is not None and item.get("table_id") == paragraph["table_id"]
                and _contains(box, _bbox(paragraph["bbox"])) and _contains(box, output_box)):
            return True
    except (TypeError, ValueError, KeyError, OverflowError):
        pass
    return False


def _obstacles(page, paragraph, output_box):
    own_lines = set(paragraph.get("line_ids", []))
    own_blocks = set(paragraph.get("block_ids", []))
    for key in ("lines", "original_lines", "obstacles", "blocks", "allocations"):
        for item in page.get(key, []):
            kind = str(item.get("type", item.get("kind", ""))).lower()
            own = own_lines if key in {"lines", "original_lines"} or kind == "line" else own_lines | own_blocks
            if _owned_boundary(item, paragraph, output_box, page):
                continue
            if (item.get("id") is not None and item["id"] in own and item.get("is_image") is not True
                    and kind not in {"image", "figure", "formula", "inline_formula", "table", "cell", "table_cell"}):
                continue
            yield item
    for other in page.get("paragraphs", []):
        if other.get("id") != paragraph.get("id"):
            yield other
        for line in other.get("source_lines", []):
            if line.get("id") not in own_lines:
                yield line


def _check_translations(translations, paragraphs, fits, axis):
    if translations is None:
        return
    axis["placeholder_preservation"] = "passed"
    values = translations.get("translations", translations) if isinstance(translations, Mapping) else None
    if not isinstance(values, Mapping):
        _issue(axis, "invalid_translation_data")
        axis["placeholder_preservation"] = "review_required"
        return
    for key, paragraph in paragraphs.items():
        if not paragraph.get("translate", True):
            continue
        value = values.get(key)
        if not isinstance(value, str) or not value.strip():
            _issue(axis, "missing_translation", id=key)
            continue
        try:
            protection = protect_text(paragraph.get("text", ""), spans=paragraph.get("spans"))
            if any(item["type"] == "style_start" for item in protection.elements):
                from documents.document_fragments import assemble_fragments
                value = "".join(item["text"] for item in assemble_fragments(paragraph, value))
            expected = Counter(item["text"] for item in protection.elements
                               if item["type"] not in {"style_start", "style_end"})
            for text, count in expected.items():
                if value.count(text) != count:
                    _issue(axis, "protected_content_changed", id=key)
                    break
            if re.search(r"\[\s*\[\s*AILS_", value, re.IGNORECASE):
                if value != paragraph.get("text"):
                    _issue(axis, "unrestored_placeholder", id=key)
        except (TypeError, ValueError, KeyError):
            _issue(axis, "invalid_protection_data", id=key)
        fit = fits.get(key, {})
        lines = fit.get("lines", [])
        if fit.get("fits") is True and isinstance(lines, (list, tuple)) and all(isinstance(s, str) for s in lines):
            if re.sub(r"\s+", "", "".join(lines)) != re.sub(r"\s+", "", value):
                _issue(axis, "output_translation_mismatch", id=key)
    for key in values.keys() - paragraphs.keys():
        _issue(axis, "translation_without_layout", id=key)
    if axis["issues"]:
        axis["placeholder_preservation"] = "review_required"


def _check_fallback_translations(records, layout, axis):
    if not isinstance(records, (list, tuple)):
        _issue(axis, "invalid_fallback_translations")
        return
    paragraphs = {(page.get("source_page"), paragraph.get("id")): paragraph
                  for page in layout.get("pages", []) for paragraph in page.get("paragraphs", [])}
    for index, record in enumerate(records):
        try:
            if not isinstance(record, Mapping):
                raise ValueError("invalid_record")
            number, key = record["source_page"], record["paragraph_id"]
            if type(number) is not int or not isinstance(key, str):
                raise ValueError("invalid_reference")
            paragraph = paragraphs.get((number, key))
            original, translated = record["original_text"], record["translated_text"]
            if (paragraph is None or not isinstance(original, str)
                    or not isinstance(paragraph.get("text"), str)
                    or not isinstance(translated, str) or not translated.strip()):
                raise ValueError("invalid_content")
            if re.sub(r"\s+", "", original) != re.sub(r"\s+", "", paragraph["text"]):
                _issue(axis, "fallback_source_text_mismatch", page=number, id=key)
        except (TypeError, ValueError, KeyError):
            _issue(axis, "invalid_fallback_translation", record=index)


def assess_document(source, output, layout, fit_report, translations=None, fallback_translations=None) -> dict:
    axes = {key: {"status": "passed", "issues": []} for key in
            ("translation_quality", "layout_fidelity", "content_preservation", "rendering_stability")}
    quality, fidelity, preservation, stability = axes.values()
    quality.update(status="not_evaluated", semantic_quality="not_evaluated",
                   placeholder_preservation="not_evaluated", reason="No semantic evaluator or reference comparison")
    preservation.update(scope="Page count, source identity and clipped formula provenance/crop checks; not proof of all content preservation",
                        source_hash_verification="not_evaluated", formulas=[])
    fidelity["paragraphs"] = []
    stability.update(scope="PDFium readability and recorded TTFont coverage; not pixel or embedded-font equivalence",
                     rendered_pages={"source": 0, "output": 0})
    source_pages = _inspect_pdf(source, "source", stability)
    output_pages = _inspect_pdf(output, "output", stability)
    preservation["source_page_count"] = len(source_pages) if source_pages is not None else None
    preservation["output_page_count"] = len(output_pages) if output_pages is not None else None
    if source_pages is None or output_pages is None:
        _issue(preservation, "page_count_unavailable")
    elif len(source_pages) != len(output_pages):
        _issue(preservation, "page_count_changed")
    expected_count = layout.get("total_pages", fit_report.get("source_page_count"))
    if expected_count is not None and expected_count != preservation["source_page_count"]:
        _issue(preservation, "source_page_count_changed", expected=expected_count)
    expected_identity = layout.get("source", fit_report.get("source", {}))
    expected_hash = expected_identity.get("sha256") if isinstance(expected_identity, Mapping) else None
    try:
        identity = source_identity(Path(source))
        preservation["source_sha256"] = identity["sha256"]
        if expected_hash is not None:
            preservation["source_hash_verification"] = "passed" if expected_hash == identity["sha256"] else "review_required"
            if expected_hash != identity["sha256"]:
                _issue(preservation, "source_hash_changed")
    except OSError:
        _issue(preservation, "source_identity_unavailable")
    if source_pages is not None and output_pages is not None:
        for number, (before, after) in enumerate(zip(source_pages, output_pages), 1):
            if before != after:
                _issue(fidelity, "page_geometry_changed", page=number)
    reports = {}
    for page in fit_report.get("pages", []):
        number = page.get("source_page")
        if type(number) is not int or source_pages is None or not 1 <= number <= len(source_pages):
            _issue(fidelity, "fit_page_outside_document", page=number)
            continue
        if number in reports:
            _issue(fidelity, "duplicate_fit_page", page=number)
        reports[number] = page
        if page.get("reason"):
            _issue(fidelity, "page_not_successful", page=number, reason=page["reason"])
    if fit_report.get("status") in {"failed", "partial", "fallback"}:
        _issue(fidelity, "fit_report_not_successful", reason=fit_report["status"])
    for item in fit_report.get("omitted", []):
        _issue(fidelity, "omitted_placement", detail=item)
    paragraphs, fits, seen_pages = {}, {}, set()
    for page in layout.get("pages", []):
        number = page.get("source_page")
        if type(number) is not int or source_pages is None or not 1 <= number <= len(source_pages):
            _issue(fidelity, "layout_page_outside_document", page=number)
            continue
        if number in seen_pages:
            _issue(fidelity, "duplicate_layout_page", page=number)
        seen_pages.add(number)
        transform = source_pages[number - 1]
        if transform is not None:
            try:
                if any(abs(_number(page.get(key)) - size) > _TOLERANCE
                       for key, size in (("width", transform.width), ("height", transform.height))):
                    _issue(fidelity, "layout_geometry_mismatch", page=number)
                if "page_transform" in page and PageTransform.from_dict(page["page_transform"]) != transform:
                    _issue(fidelity, "layout_transform_mismatch", page=number)
            except (TypeError, ValueError, KeyError):
                _issue(fidelity, "invalid_layout_geometry", page=number)
        entries = {}
        for fit in reports.get(number, {}).get("paragraphs", []):
            key = fit.get("id")
            if not key or key in fits:
                _issue(fidelity, "duplicate_or_missing_fit_id", page=number, id=key)
            entries[key] = fit
            fits[key] = fit
        successful = []
        if not page.get("paragraphs"):
            _issue(fidelity, "missing_paragraph_layout", page=number)
        for paragraph in page.get("paragraphs", []):
            key = paragraph.get("id")
            if not key or key in paragraphs:
                _issue(fidelity, "duplicate_or_missing_paragraph_id", page=number, id=key)
            paragraphs[key] = paragraph
            fit = entries.pop(key, None)
            if fit is None:
                _issue(fidelity, "missing_fit_report", page=number, id=key)
                continue
            record = {"page": number, "id": key, "status": "rendered", "output_bbox": None}
            fidelity["paragraphs"].append(record)
            preserved = (paragraph.get("translate") is False
                         and fit.get("status") in {"skipped", "preserved"}
                         and fit.get("reason") == "preserved_nontranslatable"
                         and not fit.get("fallback") and not fit.get("placements"))
            if preserved:
                record["status"] = "preserved"
                try:
                    record["output_bbox"] = list(_bbox(paragraph["bbox"]))
                except (TypeError, ValueError, KeyError, OverflowError):
                    _issue(fidelity, "invalid_placement_geometry", page=number, id=key)
                    record["status"] = "review_required"
                continue
            issue_count = len(fidelity["issues"]) + len(stability["issues"])
            box = _placement(fit, paragraph, page, transform, fidelity, stability, record, preservation["formulas"])
            if len(fidelity["issues"]) + len(stability["issues"]) != issue_count:
                record["status"] = "review_required"
            if box is None:
                continue
            record["output_bbox"] = list(box)
            for other_key, other_box in successful:
                if _overlap(box, other_box):
                    _issue(fidelity, "placement_collision", page=number, id=key, other_id=other_key)
            successful.append((key, box))
            for obstacle in _obstacles(page, paragraph, box):
                try:
                    if _intersects(box, _bbox(obstacle["bbox"])):
                        _issue(fidelity, "obstacle_collision", page=number, id=key, other_id=obstacle.get("id"))
                except (TypeError, ValueError, KeyError, OverflowError):
                    _issue(fidelity, "invalid_obstacle_geometry", page=number, id=key)
        for key in entries:
            _issue(fidelity, "fit_without_paragraph", page=number, id=key)
        for key in page.get("suppressed_line_ids", []):
            _issue(fidelity, "suppressed_source_line", page=number, id=key)
    for number in reports.keys() - seen_pages:
        _issue(fidelity, "fit_without_layout_page", page=number)
    selected = layout.get("selected_pages", range(1, len(source_pages or []) + 1))
    for number in set(selected) - seen_pages:
        _issue(fidelity, "selected_page_without_layout", page=number)
    _check_translations(translations, paragraphs, fits, quality)
    _check_fallback_translations(fit_report.get("fallback_translations", [])
                                 if fallback_translations is None else fallback_translations, layout, preservation)
    _verify_formulas(source, output, source_pages, output_pages, layout, preservation)
    return {"status": "review_required" if any(axis["issues"] for axis in axes.values()) else "checks_passed",
            **axes}
