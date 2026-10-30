from __future__ import annotations

import math
import re
import unicodedata
from copy import deepcopy

from documents.document_ir import FragmentIR, ProtectionError, protect_text


_STYLE_KEYS = ("font", "font_size", "bold", "italic", "serif", "color")
_ATOMIC = {"formula", "code", "url", "citation"}


def assemble_fragments(paragraph: dict, translated: str) -> list[FragmentIR]:
    if not isinstance(translated, str):
        raise ProtectionError("Translation must be text")
    source = str(paragraph.get("text", ""))
    spans = paragraph.get("spans", [])
    protection = protect_text(source, spans=spans)
    base_style = {key: deepcopy(paragraph[key]) for key in _STYLE_KEYS if key in paragraph}
    events, occupied = [], []
    grouped = {}
    boundaries = []
    for element in protection.elements:
        if element["type"] in {"style_start", "style_end"}:
            token = element["token"]
            if translated.count(token) != 1:
                raise ProtectionError("missing_or_duplicated_style_boundary")
            boundaries.append((translated.index(token), element))
        else:
            grouped.setdefault(element["text"], []).append(element)
    for original, elements in sorted(grouped.items(), key=lambda item: -len(item[0])):
        matches = [match for match in re.finditer(re.escape(original), translated)
                   if not any(a < match.end() and match.start() < b for a, b in occupied)]
        if len(matches) != len(elements):
            raise ProtectionError("protected_original_missing_or_ambiguous")
        mapped = []
        for element in elements:
            start, end = element["start"], element["end"]
            exact = [span for span in spans if span.get("start") == start and span.get("end") == end]
            kind = element["type"]
            if kind not in _ATOMIC:
                kind = "url" if kind == "email" else "citation" if kind == "reference" else "code"
            style = dict(base_style)
            for span in spans:
                if span.get("start", -1) <= start and span.get("end", -1) >= end:
                    style.update({key: deepcopy(span[key]) for key in _STYLE_KEYS if key in span})
            fragment = {"type": kind, "text": original, "token": element["token"],
                        "source_start": start, "source_end": end, "style": style, "protected": True}
            if kind == "formula":
                if paragraph.get("source", "native_pdf") != "native_pdf":
                    raise ProtectionError("formula_requires_native_source: review_required")
                reliable = [span for span in exact if span.get("bbox_verified") is True
                            and "bbox" in span and "baseline" in span]
                if len(reliable) != 1:
                    raise ProtectionError("formula_source_bbox_unverified: review_required")
                span = reliable[0]
                from documents.document_ir import _bbox, _intersects
                box = _bbox(span["bbox"])
                baseline = float(span["baseline"])
                if not math.isfinite(baseline) or not box[1] <= baseline <= box[3]:
                    raise ProtectionError("formula_source_baseline_invalid: review_required")
                if any(_intersects(box, _bbox(other["bbox"])) for other in spans
                       if "bbox" in other and (other.get("end", end) <= start or other.get("start", start) >= end)):
                    raise ProtectionError("formula_source_crop_overlap: review_required")
                fragment.update(bbox=box, baseline=baseline)
            elif len(exact) == 1 and "bbox" in exact[0]:
                fragment["bbox"] = deepcopy(exact[0]["bbox"])
            mapped.append(fragment)
        if len(mapped) > 1 and any({k: v for k, v in item.items() if k not in {"token", "source_start", "source_end"}}
                                   != {k: v for k, v in mapped[0].items() if k not in {"token", "source_start", "source_end"}}
                                   for item in mapped[1:]):
            raise ProtectionError("ambiguous_repeated_source_fragment: review_required")
        for match, fragment in zip(matches, mapped):
            events.append((match.start(), match.end(), fragment))
            occupied.append((match.start(), match.end()))
    for position, element in boundaries:
        events.append((position, position + len(element["token"]), element))
    fragments, cursor, output_offset = [], 0, 0
    active = None

    def append(text, fragment=None):
        nonlocal output_offset
        if not text:
            return
        if fragment is None:
            style = dict(base_style)
            if active is not None:
                style.update({key: deepcopy(active[key]) for key in _STYLE_KEYS if key in active})
            fragment = {"type": "styled_text" if active is not None else "text", "style": style,
                        "protected": False}
            if active is not None:
                fragment.update(source_start=active["start"], source_end=active["end"])
        fragments.append({**fragment, "text": text, "start": output_offset, "end": output_offset + len(text)})
        output_offset += len(text)

    for start, end, event in sorted(events, key=lambda event: event[0]):
        if start < cursor:
            raise ProtectionError("overlapping_translated_fragments")
        append(translated[cursor:start])
        if event["type"] == "style_start":
            candidates = [span for span in spans if span.get("start") == event["start"]
                          and span.get("type", "styled_text") in {"text", "styled_text", "rich_text"}]
            if active is not None or len(candidates) != 1:
                raise ProtectionError("invalid_style_boundary_order")
            active = candidates[0]
        elif event["type"] == "style_end":
            if active is None or active["end"] != event["end"]:
                raise ProtectionError("invalid_style_boundary_order")
            active = None
        else:
            append(event["text"], event)
        cursor = end
    append(translated[cursor:])
    if any(re.search(r"\[\[AILS_", item["text"]) for item in fragments if not item["protected"]):
        raise ProtectionError("unknown_fragment_boundary")
    if active is not None:
        raise ProtectionError("unclosed_style_boundary")
    if not any(item["type"] != "text" for item in fragments):
        return []
    return fragments


def _fragment_atoms(fragments, resolver, config):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from documents.document_typesetting import _TOKENS, _OPEN, _CLOSE

    groups = []
    for index, fragment in enumerate(fragments):
        if fragment["type"] == "formula":
            atoms = [{**fragment, "fragment_index": index}]
        else:
            text = fragment["text"]
            if any(unicodedata.category(c).startswith("M") or unicodedata.bidirectional(c) in {"R", "AL"}
                   or unicodedata.category(c) == "Cf" for c in text):
                raise ValueError("unsupported_shaping")
            if fragment["protected"] and any(c in text for c in "\r\n\t"):
                raise ValueError("multiline_protected_fragment: review_required")
            name = resolver.resolve_font(fragment["style"], config.get("target_language", "korean"), text)
            font = pdfmetrics.getFont(name)
            if not isinstance(font, TTFont) or not all(font.face.charToGlyph.get(ord(c), 0) for c in text if c not in "\r\n\t"):
                raise ValueError("unsupported_glyph: resolver returned an unverified font")
            tokens = [text] if fragment["protected"] else re.findall(r"\n|" + _TOKENS.pattern, text.replace("\r\n", "\n").replace("\r", "\n").expandtabs(4))
            atoms = [{**fragment, "text": token, "font_name": name, "fragment_index": index} for token in tokens]
        for atom in atoms:
            value = atom["text"]
            if groups and value != "\n" and groups[-1][-1]["text"] != "\n" and (
                    value[0] in _CLOSE or groups[-1][-1]["text"][-1] in _OPEN):
                groups[-1].append(atom)
            else:
                groups.append([atom])
    return groups


def fit_fragments(fragments, paragraph, page, resolver=None, config=None):
    from documents.document_typesetting import (FontFallbackResolver, LayoutFitResult, _bbox, _barriers,
                                     _intersects, _measure, _settings)

    result = LayoutFitResult()
    try:
        config = _settings(config)
        box = _bbox(paragraph["bbox"])
        size = float(paragraph["font_size"])
        width, height, margin = float(page["width"]), float(page["height"]), config["margin"]
        if not all(math.isfinite(v) and v > 0 for v in (size, width, height)):
            raise ValueError("invalid_geometry")
        obstacles = _barriers(paragraph, page)
        if box[0] < margin or box[1] < margin or box[2] > width - margin or box[3] > height - margin:
            raise ValueError("bbox_outside_margins")
        if any(_intersects(box, obstacle) for obstacle in obstacles):
            raise ValueError("source_collision")
        for fragment in fragments:
            if fragment["type"] == "formula":
                crop = _bbox(fragment["bbox"])
                if not (box[0] <= crop[0] < crop[2] <= box[2] and box[1] <= crop[1] < crop[3] <= box[3]):
                    raise ValueError("formula_crop_outside_source: review_required")
                if not any(line["bbox"][0] <= crop[0] and line["bbox"][1] <= crop[1]
                           and line["bbox"][2] >= crop[2] and line["bbox"][3] >= crop[3]
                           for line in paragraph.get("source_lines", [])):
                    raise ValueError("formula_crop_outside_mask: review_required")
        groups = _fragment_atoms(fragments, resolver or FontFallbackResolver(config.get("font_paths")), config)
        boxes = [box]
        expanded = list(box)
        for direction in config["expansion_order"]:
            edge, boundary = {"right": (2, width - margin), "bottom": (3, height - margin),
                              "left": (0, margin), "top": (1, margin)}[direction]
            trial = expanded.copy()
            limit = config["max_expansion_points"]
            trial[edge] = min(boundary, box[edge] + limit) if edge >= 2 else max(boundary, box[edge] - limit)
            for obstacle in obstacles:
                if _intersects(trial, obstacle):
                    trial[edge] = min(trial[edge], obstacle[edge - 2]) if edge >= 2 else max(trial[edge], obstacle[edge + 2])
            if tuple(trial) != boxes[-1]:
                boxes.append(tuple(trial))
            expanded = trial
        ratios = [1.0] + [max(config["min_font_ratio"], 1 - step * config["font_step_ratio"])
                          for step in range(1, math.ceil((1 - config["min_font_ratio"]) / config["font_step_ratio"]) + 1)]
        variants = [(1.0, bounds, config["line_spacing_ratios"][0]) for bounds in boxes]
        variants += [(1.0, boxes[-1], leading) for leading in config["line_spacing_ratios"][1:]]
        variants += [(ratio, boxes[-1], config["line_spacing_ratios"][-1]) for ratio in ratios[1:]]
        for ratio, bounds, leading in variants:
            rows, row, row_width = [], [], 0.0
            for group in groups:
                measured = []
                for atom in group:
                    if atom["text"] == "\n":
                        continue
                    if atom["type"] == "formula":
                        x0, y0, x1, y1 = atom["bbox"]
                        metric = (x1 - x0, 0, atom["baseline"] - y0, y1 - atom["baseline"])
                        current_size = size
                    else:
                        current_size = float(atom["style"].get("font_size", size)) * (1 if atom["protected"] else ratio)
                        if not math.isfinite(current_size) or current_size <= 0:
                            raise ValueError("invalid_fragment_font_size")
                        metric = _measure(atom["text"], atom["font_name"], current_size)
                    measured.append({**atom, "metric": metric, "font_size": current_size, "scale": 1.0})
                group_width = sum(item["metric"][0] for item in measured)
                whitespace = all(item["text"].isspace() and not item["protected"] for item in measured)
                newline = group[0]["text"] == "\n"
                if newline or (row and not whitespace and row_width + group_width > bounds[2] - bounds[0]):
                    while row and row[-1]["text"].isspace() and not row[-1]["protected"]:
                        row.pop()
                    rows.append(row)
                    row, row_width = [], 0.0
                if not newline and (row or not whitespace):
                    row.extend(measured)
                    row_width += group_width
            while row and row[-1]["text"].isspace() and not row[-1]["protected"]:
                row.pop()
            rows.append(row)
            placements, y = [], bounds[1]
            overflow_x = 0.0
            for index, row in enumerate(rows):
                ascent = max((item["metric"][2] for item in row), default=size * ratio)
                descent = max((item["metric"][3] for item in row), default=0)
                x, baseline = bounds[0], y + ascent
                for item in row:
                    placements.append({**item, "x": x, "baseline": baseline, "line": index,
                                       "source_baseline": item.get("baseline")})
                    x += item["metric"][0]
                overflow_x = max(overflow_x, x - bounds[2])
                y += max(size * ratio * leading, ascent + descent) if index < len(rows) - 1 else ascent + descent
            overflow_y = max(0.0, y - bounds[3])
            fits = overflow_x <= 1e-7 and overflow_y <= 1e-7
            result = LayoutFitResult(fits=fits, overflow_x=max(0, overflow_x), overflow_y=overflow_y,
                                     font_size=size * ratio, line_spacing=size * ratio * leading,
                                     expanded_bbox=bounds, line_count=len(rows), fit_score=ratio if fits else 0,
                                     lines=tuple("".join(item["text"] for item in row) for row in rows),
                                     reason="fit" if fits else "no_collision_free_fragment_fit",
                                     placements=tuple(placements))
            if fits:
                return result
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        result.reason = str(exc)
    return result


def draw_fragment_text(overlay, result, left, bottom, height, fallback_color):
    for item in result.placements:
        if item["type"] == "formula":
            continue
        color = item["style"].get("color", fallback_color)
        if isinstance(color, int):
            color = [(color >> shift & 255) / 255 for shift in (16, 8, 0)]
        obj = overlay.beginText(left + item["x"] + item["metric"][1], bottom + height - item["baseline"])
        obj.setFont(item["font_name"], item["font_size"])
        obj.setFillColorRGB(*color)
        obj.textOut(item["text"])
        overlay.drawText(obj)


def add_formula_forms(overlay_page, source_page, placements, writer, inverse, left, bottom, height):
    from pypdf.generic import (DecodedStreamObject, DictionaryObject, NameObject,
                               NumberObject, RectangleObject)

    a, b, c, d, e, f = inverse
    determinant = a * d - b * c
    forward = (d / determinant, -b / determinant, -c / determinant, a / determinant,
               (c * f - d * e) / determinant, (b * e - a * f) / determinant)
    resources = overlay_page["/Resources"]
    xobjects = resources.setdefault(NameObject("/XObject"), DictionaryObject())
    commands = []
    source_content = source_page.get_contents()
    for index, item in enumerate(placements):
        if item["type"] != "formula":
            continue
        x0, y0, x1, y1 = item["bbox"]
        crop = (left + x0, bottom + height - y1, left + x1, bottom + height - y0)
        form = DecodedStreamObject()
        matrix = " ".join(format(value, ".12g") for value in forward)
        clip = f"{crop[0]:.12g} {crop[1]:.12g} {x1 - x0:.12g} {y1 - y0:.12g} re W n\n"
        form.set_data(("q\n" + clip + matrix + " cm\n").encode("ascii") + source_content.get_data() + b"\nQ\n")
        form.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Form"),
                     NameObject("/FormType"): NumberObject(1), NameObject("/BBox"): RectangleObject(crop),
                     NameObject("/Resources"): source_page["/Resources"].clone(writer)})
        if "/Group" in source_page:
            form[NameObject("/Group")] = source_page["/Group"].clone(writer)
        name = NameObject(f"/AILSFormula{index}")
        while name in xobjects:
            name = NameObject(str(name) + "x")
        xobjects[name] = writer._add_object(form)
        dx = item["x"] - x0
        dy = item["source_baseline"] - item["baseline"]
        commands.append(f"q 1 0 0 1 {dx:.12g} {dy:.12g} cm {name} Do Q\n")
    if commands:
        stream = DecodedStreamObject()
        stream.set_data(overlay_page.get_contents().get_data() + "".join(commands).encode("ascii"))
        overlay_page[NameObject("/Contents")] = writer._add_object(stream)
