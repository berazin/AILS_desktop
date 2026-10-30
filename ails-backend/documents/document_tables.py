from __future__ import annotations

import copy
import hashlib
import math
import re
from dataclasses import asdict
from html.parser import HTMLParser

from documents.document_fragments import assemble_fragments, fit_fragments
from documents.document_ir import protect_text
from documents.document_typesetting import FontFallbackResolver, _measure, fit_paragraph
from pdf.page_transform import PageTransform


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.rows = []
        self.cell = None
        self.tables = 0

    def handle_starttag(self, tag, attrs):
        parent = self.stack[-1] if self.stack else None
        allowed = {
            "html": {None}, "body": {None, "html"}, "table": {None, "body"},
            "thead": {"table"}, "tbody": {"table"}, "tfoot": {"table"},
            "tr": {"table", "thead", "tbody", "tfoot"}, "td": {"tr"}, "th": {"tr"},
        }
        if tag in allowed:
            if parent not in allowed[tag] or self.cell is not None:
                raise ValueError("invalid_table_nesting")
        elif self.cell is None or tag not in {"b", "strong", "i", "em", "span", "code", "pre", "br", "sup", "sub"}:
            raise ValueError("unsupported_table_markup")
        names = [name for name, _ in attrs]
        if len(names) != len(set(names)):
            raise ValueError("duplicate_attributes")
        attrs = dict(attrs)
        if any(name not in {"rowspan", "colspan", "class"} for name in attrs):
            raise ValueError("unsupported_table_attributes")
        if any(name in attrs for name in ("rowspan", "colspan")) and tag not in {"td", "th"}:
            raise ValueError("invalid_span_attribute")
        if tag == "table":
            self.tables += 1
            if self.tables != 1:
                raise ValueError("multiple_tables")
        elif tag == "tr":
            self.rows.append([])
        elif tag in {"td", "th"}:
            spans = {}
            for name in ("rowspan", "colspan"):
                value = attrs.get(name, "1")
                if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,2}", value):
                    raise ValueError("invalid_cell_span")
                spans[name] = int(value)
            self.cell = {**spans, "parts": [], "protected": False, "header": tag == "th"}
            self.rows[-1].append(self.cell)
        if self.cell is not None:
            if tag in {"code", "pre", "sup", "sub"} or re.search(r"formula|math|code", attrs.get("class") or "", re.I):
                self.cell["protected"] = True
            if tag == "br":
                self.cell["parts"].append("\n")
                return
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag != "br":
            raise ValueError("invalid_self_closing_tag")
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            raise ValueError("unbalanced_table_markup")
        if tag in {"td", "th"}:
            self.cell["text"] = "".join(self.cell.pop("parts"))
            self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["parts"].append(data)
        elif data.strip():
            raise ValueError("text_outside_cell")

    def handle_comment(self, data):
        raise ValueError("unsupported_table_markup")

    def handle_decl(self, decl):
        raise ValueError("unsupported_table_markup")

    def handle_pi(self, data):
        raise ValueError("unsupported_table_markup")

    def cells(self, html):
        if not isinstance(html, str) or len(html) > 1_000_000:
            raise ValueError("invalid_table_html")
        self.feed(html)
        self.close()
        if self.stack or self.tables != 1 or not self.rows:
            raise ValueError("incomplete_table_html")
        occupied, cells = set(), []
        for row, entries in enumerate(self.rows):
            col = 0
            for cell in entries:
                while (row, col) in occupied:
                    col += 1
                end_row, end_col = row + cell["rowspan"], col + cell["colspan"]
                if end_row > len(self.rows) or end_col > 1000 or len(cells) >= 10000:
                    raise ValueError("invalid_table_span_extent")
                slots = {(r, c) for r in range(row, end_row) for c in range(col, end_col)}
                if slots & occupied:
                    raise ValueError("overlapping_logical_cells")
                occupied.update(slots)
                cells.append({**cell, "row": row, "col": col})
                col = end_col
        columns = max((c for _, c in occupied), default=-1) + 1
        if not columns or len(occupied) != len(self.rows) * columns:
            raise ValueError("missing_logical_cells")
        return cells, len(self.rows), columns


def _box(value):
    if not isinstance(value, (list, tuple)):
        raise ValueError("invalid_cell_bbox")
    if len(value) == 8:
        value = [value[index:index + 2] for index in range(0, 8, 2)]
    if len(value) == 4 and all(isinstance(point, (list, tuple)) and len(point) == 2 for point in value):
        points = [tuple(_number(v) for v in point) for point in value]
        xs, ys = sorted({p[0] for p in points}), sorted({p[1] for p in points})
        if len(xs) != 2 or len(ys) != 2 or set(points) != {(x, y) for x in xs for y in ys}:
            raise ValueError("nonrectangular_cell_bbox")
        value = [xs[0], ys[0], xs[1], ys[1]]
    if len(value) != 4:
        raise ValueError("invalid_cell_bbox")
    result = [_number(v) for v in value]
    if result[2] <= result[0] or result[3] <= result[1]:
        raise ValueError("invalid_cell_bbox")
    return result


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("invalid_number")
    return float(value)


def _transform(page):
    if "page_transform" in page:
        value = page["page_transform"]
        transform = value if isinstance(value, PageTransform) else PageTransform.from_dict(value)
        if any(not math.isclose(_number(page[key]), extent, abs_tol=0.001)
               for key, extent in (("width", transform.width), ("height", transform.height))):
            raise ValueError("page_transform_mismatch")
        return transform
    width, height = _number(page["width"]), _number(page["height"])
    return PageTransform((0, 0, width, height), (0, 0, width, height))


def _canonical(value, metadata, transform, normalized=False):
    box = _box(value)
    space = "normalized" if normalized else metadata.get("coordinate_space")
    if space == "normalized":
        if not all(0 <= v <= 1 for v in box):
            raise ValueError("normalized_bbox_outside_page")
        box = list(transform.normalized_bbox_to_canonical(box))
    elif space == "image_pixels":
        box = list(transform.image_bbox_to_canonical(box, metadata["image_width"], metadata["image_height"]))
    elif space == "pdf_user_space":
        box = list(transform.pdf_bbox_to_canonical(box))
    elif space not in {"pdf_points", PageTransform.COORDINATE_SPACE}:
        raise ValueError("unverified_coordinate_space")
    if not _contains([0, 0, transform.width, transform.height], box):
        raise ValueError("bbox_outside_page")
    return box


def _contains(outer, inner):
    return all((inner[i] >= outer[i] - 1e-6 if i < 2 else inner[i] <= outer[i] + 1e-6) for i in range(4))


def _intersects(a, b):
    return min(a[2], b[2]) - max(a[0], b[0]) > 1e-6 and min(a[3], b[3]) - max(a[1], b[1]) > 1e-6


def _edges(boxes, axis):
    values = sorted({box[index] for box in boxes for index in (axis, axis + 2)})
    result = []
    for value in values:
        if not result or value - result[-1] > 1e-6:
            result.append(value)
    return result


def _grid(cells, rows, cols, bounds):
    boxes = [_box(cell["bbox"]) for cell in cells]
    if any(not _contains(bounds, box) for box in boxes):
        raise ValueError("cell_outside_table")
    if any(_intersects(a, b) for index, a in enumerate(boxes) for b in boxes[index + 1:]):
        raise ValueError("overlapping_cell_boxes")
    xs, ys = _edges(boxes, 0), _edges(boxes, 1)
    if len(xs) != cols + 1 or len(ys) != rows + 1:
        raise ValueError("ambiguous_grid_boundaries")
    slots = set()
    for cell, box in zip(cells, boxes):
        r, c, rs, cs = (cell[key] for key in ("row", "col", "rowspan", "colspan"))
        if any(type(v) is not int for v in (r, c, rs, cs)) or not (0 <= r < r + rs <= rows and 0 <= c < c + cs <= cols):
            raise ValueError("invalid_cell_span")
        expected = [xs[c], ys[r], xs[c + cs], ys[r + rs]]
        if any(abs(a - b) > 1e-6 for a, b in zip(box, expected)):
            raise ValueError("cell_span_geometry_mismatch")
        occupied = {(row, col) for row in range(r, r + rs) for col in range(c, c + cs)}
        if occupied & slots:
            raise ValueError("overlapping_logical_cells")
        slots.update(occupied)
    if len(slots) != rows * cols:
        raise ValueError("missing_logical_cells")
    return xs, ys


def build_table_ir(block, page) -> dict:
    result = {"status": "review", "reason": "", "cells": [], "translate": False,
              "coordinate_space": PageTransform.COORDINATE_SPACE}
    try:
        if block.get("type") != "table":
            raise ValueError("not_a_table")
        metadata = block["table"]
        transform = _transform(page)
        bounds = _canonical(block.get("normalized_bbox", block.get("bbox")), block, transform,
                            "normalized_bbox" in block)
        logical, rows, cols = _TableParser().cells(metadata.get("html"))
        normalized = "normalized_cell_box_list" in metadata
        raw = metadata.get("normalized_cell_box_list" if normalized else "cell_box_list")
        if not isinstance(raw, (list, tuple)) or len(raw) != len(logical):
            raise ValueError("missing_or_extra_cell_boxes")
        boxes = [_canonical(value, metadata, transform, normalized) for value in raw]
        boxes.sort(key=lambda box: (box[1], box[0]))
        identity = str(block.get("id", block.get("block_id", "")))
        if not identity:
            identity = hashlib.sha256(repr((bounds, metadata.get("region_id"))).encode()).hexdigest()[:12]
        table_id = f"P{page.get('source_page', 1)}-T{identity}"
        cells = []
        for cell, box in zip(logical, boxes):
            protected = cell["protected"] or any(element["type"] in {"formula", "code"}
                                                  for element in protect_text(cell["text"]).elements)
            cells.append({"id": f"{table_id}-R{cell['row']}C{cell['col']}",
                          **{key: cell[key] for key in ("row", "col", "rowspan", "colspan", "text", "header")},
                          "bbox": box, "confidence": None, "translate": bool(cell["text"].strip()) and not protected,
                          "protected": protected})
        xs, ys = _grid(cells, rows, cols, bounds)
        prediction = metadata.get("table_ocr_pred")
        if prediction is not None:
            if not isinstance(prediction, dict):
                raise ValueError("invalid_table_ocr")
            texts = prediction.get("rec_texts")
            ocr_normalized = "normalized_rec_boxes" in prediction
            ocr_boxes = prediction.get("normalized_rec_boxes" if ocr_normalized else "rec_boxes")
            scores = prediction.get("confidences", prediction.get("rec_scores"))
            if not isinstance(texts, list) or not isinstance(ocr_boxes, list) or len(texts) != len(ocr_boxes):
                raise ValueError("incomplete_table_ocr")
            if scores is not None and (not isinstance(scores, list) or len(scores) != len(texts)):
                raise ValueError("incomplete_table_confidences")
            assigned = [[] for _ in cells]
            for index, (text, raw_box) in enumerate(zip(texts, ocr_boxes)):
                if not isinstance(text, str):
                    raise ValueError("invalid_table_ocr_text")
                box = _canonical(raw_box, metadata, transform, ocr_normalized)
                owners = [i for i, cell in enumerate(cells) if _contains(cell["bbox"], box)]
                if len(owners) != 1:
                    raise ValueError("ambiguous_table_ocr_assignment")
                score = scores[index] if scores is not None else None
                if score is not None and not 0 <= _number(score) <= 1:
                    raise ValueError("invalid_table_confidence")
                assigned[owners[0]].append((box, text, score))
            for cell, words in zip(cells, assigned):
                words.sort(key=lambda word: (word[0][1], word[0][0]))
                if re.sub(r"\s+", "", "".join(word[1] for word in words)) != re.sub(r"\s+", "", cell["text"]):
                    raise ValueError("table_ocr_text_mismatch")
                known = [word[2] for word in words if word[2] is not None]
                cell["confidence"] = min(known) if known else None
        result.update(status="ready", cells=cells, id=table_id, block_id=identity, bbox=bounds,
                      rows=rows, cols=cols, column_edges=xs, row_edges=ys,
                      row_heights=[b - a for a, b in zip(ys, ys[1:])],
                      translate=any(cell["translate"] for cell in cells),
                      source_page=page.get("source_page", 1), page_transform=transform.to_dict(),
                      font_size=block.get("font_size", 10.0), font=block.get("font", ""),
                      source=copy.deepcopy(block))
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        result.update(status="review", reason=str(error), cells=[], translate=False)
    return result


def _obstacles(table, page, transform):
    for key in ("obstacles", "blocks", "paragraphs", "lines", "original_lines", "allocations"):
        for item in page.get(key, []):
            box = _canonical(item.get("normalized_bbox", item.get("bbox")),
                             {"coordinate_space": PageTransform.COORDINATE_SPACE, **item}, transform,
                             "normalized_bbox" in item)
            own = str(item.get("id", item.get("block_id", ""))) in {table["id"], table["block_id"]}
            if own and item.get("type") == "table" and all(abs(a - b) < 1e-6 for a, b in zip(box, table["bbox"])):
                continue
            if (item.get("table_id") == table["id"] or table["block_id"] in item.get("block_ids", [])) and _contains(table["bbox"], box):
                continue
            yield box


def plan_table(table, translations, page, resolver=None, config=None) -> dict:
    result = {"status": "review", "reason": "", "cells": [], "fits": False,
              "renderable": False, "requires_grid_redraw": False}
    try:
        if table.get("status") != "ready":
            raise ValueError(table.get("reason") or "unverified_table")
        transform = _transform(page)
        if table.get("source_page") != page.get("source_page", 1):
            raise ValueError("table_page_mismatch")
        if "page_transform" in page and table.get("page_transform") != transform.to_dict():
            raise ValueError("table_transform_mismatch")
        bounds = _box(table["bbox"])
        xs, ys = _grid(table["cells"], table["rows"], table["cols"], bounds)
        ids = [cell["id"] for cell in table["cells"]]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate_cell_ids")
        settings = dict(config or {})
        padding = _number(settings.pop("cell_padding", 2.0))
        if padding < 0:
            raise ValueError("invalid_cell_padding")
        settings.update(expansion_order=(), max_expansion_points=0, margin=0)
        resolver = resolver or FontFallbackResolver(settings.get("font_paths"))
        fit_page = {"width": transform.width, "height": transform.height}
        heights = [b - a for a, b in zip(ys, ys[1:])]
        original_heights = heights.copy()
        result.update(id=table["id"], bbox=bounds.copy(), original_bbox=bounds.copy(),
                      original_row_heights=original_heights, row_heights=heights, growth=[])
        for cell in table["cells"]:
            text = cell["text"]
            if cell["translate"]:
                if cell["id"] not in translations:
                    raise ValueError("missing_cell_translation")
                text = translations[cell["id"]]
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("empty_cell_translation")
            box = cell["bbox"]
            inner = _box([box[0] + padding, box[1] + padding, box[2] - padding, box[3] - padding])
            paragraph = {"id": cell["id"], "text": cell["text"], "font_size": table.get("font_size", 10.0),
                         "font": table.get("font", ""), "bold": cell.get("header", False),
                         **copy.deepcopy(next((p for p in page.get("paragraphs", [])
                                               if p.get("id") == cell["id"] and p.get("table_id") == table["id"]), {})),
                         "bbox": inner}
            record = {**copy.deepcopy(cell), "text": text, "source_text": cell["text"],
                      "original_bbox": box.copy(), "paragraph": paragraph,
                      "original_fit": None, "fit": None, "fits": True,
                      "required_height": box[3] - box[1]}
            if cell["protected"]:
                record["preserve_source"] = True
            elif text.strip():
                fragments = assemble_fragments(paragraph, text)
                original = (fit_fragments(fragments, paragraph, fit_page, resolver, settings) if fragments else
                            fit_paragraph(text, paragraph, fit_page, resolver, settings))
                record.update(original_fit=asdict(original), fit=asdict(original), fits=original.fits)
                if ((not fragments and not original.font_name) or original.overflow_x > 0
                        or (not original.fits and original.overflow_y <= 0)):
                    result["cells"].append(record)
                    raise ValueError(original.reason or "cell_horizontal_overflow")
                if fragments:
                    record["required_height"] += original.overflow_y
                else:
                    metrics = [_measure(line, original.font_name, original.font_size, original.character_spacing)
                               for line in original.lines]
                    record["required_height"] = (max(item[2] for item in metrics) + max(item[3] for item in metrics)
                                                 + (len(metrics) - 1) * original.line_spacing + padding * 2)
            result["cells"].append(record)
        for cell in sorted(result["cells"], key=lambda cell: cell["rowspan"]):
            start, end = cell["row"], cell["row"] + cell["rowspan"]
            deficit = max(0.0, cell["required_height"] - sum(heights[start:end]))
            if deficit:
                heights[end - 1] += deficit + 1e-5
        grown_edges = [ys[0]]
        for height in heights:
            grown_edges.append(grown_edges[-1] + height)
        growth = [{"row": index, "original_height": old, "height": new, "delta": new - old}
                  for index, (old, new) in enumerate(zip(original_heights, heights))]
        new_bounds = [bounds[0], bounds[1], bounds[2], max(bounds[3], grown_edges[-1])]
        changed = any(item["delta"] > 0 for item in growth)
        result.update(bbox=new_bounds, growth=growth, row_edges=grown_edges, column_edges=xs,
                      requires_grid_redraw=changed)
        if not _contains([0, 0, transform.width, transform.height], new_bounds):
            raise ValueError("table_growth_outside_page")
        if any(_intersects(new_bounds, obstacle) for obstacle in _obstacles(table, page, transform)):
            raise ValueError("table_collision")
        for record in result["cells"]:
            row, col, rs, cs = (record[key] for key in ("row", "col", "rowspan", "colspan"))
            box = [xs[col], grown_edges[row], xs[col + cs], grown_edges[row + rs]]
            record["bbox"] = box
            record["paragraph"]["bbox"] = [box[0] + padding, box[1] + padding, box[2] - padding, box[3] - padding]
            if record["fit"] is not None:
                fragments = assemble_fragments(record["paragraph"], record["text"])
                fit = (fit_fragments(fragments, record["paragraph"], fit_page, resolver, settings) if fragments else
                       fit_paragraph(record["text"], record["paragraph"], fit_page, resolver, settings))
                record.update(fit=asdict(fit), fits=fit.fits)
                if not fit.fits:
                    raise ValueError(fit.reason)
        result["fits"] = all(cell["fits"] for cell in result["cells"])
        if changed:
            raise ValueError("grid_redraw_required")
        result.update(status="ready", reason="", renderable=True)
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        result.update(status="review", reason=str(error), renderable=False)
    return result
