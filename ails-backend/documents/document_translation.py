from __future__ import annotations

import copy
import ctypes
import hashlib
import json
import math
import os
import re
import time
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
from pypdf import PdfReader

import pdf.pdf_translation as legacy
from dataclasses import asdict

from documents.document_ir import enrich_page, make_segments
from documents.document_tables import build_table_ir, plan_table
from documents.document_translation_provider import (
    DocumentTranslationOptions,
    OpenAICompatibleTranslationProvider,
    TranslationGlossary,
    TranslationProvider,
    translate_segments,
    translation_cache_identity,
)
from documents.document_typesetting import FontFallbackResolver, fit_paragraph, render_document_pdf
from documents.document_fragments import assemble_fragments, fit_fragments
from pdf.pdf_analysis_metadata import read_analysis_metadata
from pdf.page_transform import PageTransform
from documents.document_qa import assess_document
from pdf.pdfium_runtime import locked_pdfium


def _distinct_paths(*paths: Path) -> None:
    for index, path in enumerate(paths):
        for other in paths[:index]:
            if path == other or (path.exists() and other.exists() and os.path.samefile(path, other)):
                raise ValueError("Source, output, cache and QA paths must all differ")


def _path_edges(obj, transform):
    if obj.type != pdfium.raw.FPDF_PAGEOBJ_PATH:
        return []
    fill, stroke = ctypes.c_int(), ctypes.c_int()
    if not pdfium.raw.FPDFPath_GetDrawMode(obj, ctypes.byref(fill), ctypes.byref(stroke)) or fill.value or not stroke.value:
        return []
    edges, previous, first = [], None, None
    matrix = obj.get_matrix()
    for index in range(pdfium.raw.FPDFPath_CountSegments(obj)):
        segment = pdfium.raw.FPDFPath_GetPathSegment(obj, index)
        x, y = ctypes.c_float(), ctypes.c_float()
        if not pdfium.raw.FPDFPathSegment_GetPoint(segment, ctypes.byref(x), ctypes.byref(y)):
            return []
        point = transform.pdf_to_canonical(matrix.on_point(x.value, y.value))
        kind = pdfium.raw.FPDFPathSegment_GetType(segment)
        if kind == pdfium.raw.FPDF_SEGMENT_MOVETO:
            first = point
        elif kind == pdfium.raw.FPDF_SEGMENT_LINETO and previous is not None:
            edges.append([*previous, *point])
        else:
            return []
        if pdfium.raw.FPDFPathSegment_GetClose(segment) and first is not None:
            edges.append([*point, *first])
        previous = point
    return edges


def _native_obstacles(document: Any, number: int, transform: PageTransform) -> list[dict[str, Any]]:
    width, height = transform.width, transform.height
    blocks = []
    with locked_pdfium():
        page = document[number - 1]
        try:
            for index, obj in enumerate(page.get_objects(max_depth=1)):
                try:
                    if obj.type == pdfium.raw.FPDF_PAGEOBJ_TEXT:
                        continue
                    x0, y0, x1, y1 = transform.pdf_bbox_to_canonical(obj.get_bounds())
                    box = [max(0.0, x0 - 0.5), max(0.0, y0 - 0.5),
                           min(width, x1 + 0.5), min(height, y1 + 0.5)]
                    if all(math.isfinite(v) for v in box) and box[2] > box[0] and box[3] > box[1]:
                        blocks.append({"id": f"P{number:04d}-OBJ{index:04d}", "type": "figure",
                                        "source_type": "native_pdf_object", "bbox": box,
                                        "image_bbox": [x0, y0, x1, y1],
                                        "is_image": obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE,
                                        "path_edges": _path_edges(obj, transform),
                                        "coordinate_space": "pdf_points", "translate": False})
                finally:
                    obj.close()
        finally:
            page.close()
    return blocks


def _overlaps(first: Sequence[float], second: Sequence[float]) -> bool:
    return (min(first[2], second[2]) > max(first[0], second[0])
            and min(first[3], second[3]) > max(first[1], second[1]))


def _prose_eligible(line: Mapping[str, Any]) -> bool:
    text = str(line.get("text", "")).strip()
    return (any(unicodedata.category(char).startswith("L") for char in text)
            and not legacy.is_code_line(text, [str(line.get("font", ""))])
            and not re.fullmatch(r"https?://\S+|\S+@\S+", text))


def _contains(outer, inner):
    return all(inner[i] >= outer[i] if i < 2 else inner[i] <= outer[i] for i in range(4))


def _prepare_scan(page, document, number):
    import numpy as np
    from documents.document_typesetting import _barriers, _mask_colors, _protected

    images = [b for b in page["blocks"] if b.get("is_image")]
    page["scan_review_reasons"] = []
    if not images:
        return
    claimed = set()
    for block in page["blocks"]:
        if block.get("source_type") == "native_pdf_object":
            continue
        hits = [image for image in images if _overlaps(block["bbox"], image["bbox"])]
        if not hits:
            continue
        reason = ""
        box = block["bbox"]
        lines = sorted((line for line in page["lines"] if _overlaps(line["bbox"], box)),
                       key=lambda line: (line["bbox"][1], line["bbox"][0]))
        text = legacy.normalized_text(block.get("text") or "")
        confidence = block.get("confidence")
        if not block["translate"] or _protected(block, lines, text):
            reason = "scan_protected_content_preserved"
        elif (isinstance(confidence, bool) or not isinstance(confidence, (int, float))
              or not math.isfinite(confidence) or not 0.90 <= confidence <= 1):
            reason = "scan_ocr_confidence_untrusted"
        elif (not text or not _prose_eligible({"text": text})
              or (lines and (legacy.normalized_text(" ".join(line["text"] for line in lines)) != text
                             or any(not _contains(box, line["bbox"]) for line in lines)))
              or (not lines and page["lines"])):
            reason = "scan_ocr_source_text_mismatch"
        elif len(hits) != 1 or not _contains(hits[0]["image_bbox"], box):
            reason = "scan_image_ownership_ambiguous"
        if reason:
            page["scan_review_reasons"].append({"page": number, "id": block["id"], "reason": reason})
            continue
        ids = {line["id"] for line in lines}
        if ids & claimed or any(set(p["line_ids"]) & ids and not set(p["line_ids"]) <= ids
                                for p in page["paragraphs"]):
            page["scan_review_reasons"].append({"page": number, "id": block["id"],
                                                "reason": "scan_ocr_assignment_ambiguous"})
            continue
        key = f"P{number:04d}-SCAN{block['id']}"
        regions = lines or [{"id": key + "-OCR", "text": text, "bbox": box.copy(),
                            "text_source": "embedded_ocr_block", "bbox_verified": False}]
        paragraph = {"id": key, "text": text, "bbox": box.copy(), "type": "paragraph", "translate": True,
                     "source": "ocr", "font": "", "font_size": lines[0]["font_size"] if lines else 12.0,
                     "spans": [], "line_ids": [line["id"] for line in regions], "source_lines": regions,
                     "block_ids": [block["id"]], "fixed_bbox": True,
                     "scan_authorization": {"image_id": hits[0]["id"], "source_bbox": box.copy(),
                                            "ocr_block_id": block["id"], "confidence": confidence,
                                            "text_provenance": "indexed_ocr_match" if lines else "embedded_ocr_block",
                                            "background_verified": True}}
        planning = {**page, "paragraphs": [p for p in page["paragraphs"] if not set(p["line_ids"]) & ids]}
        if any(_overlaps(box, obstacle) for obstacle in _barriers(paragraph, planning)):
            page["scan_review_reasons"].append({"page": number, "id": block["id"], "reason": "scan_source_collision"})
            continue
        image = legacy._render_pdfium_page(document, number - 1, 2.0)
        try:
            _mask_colors(np.asarray(image), box, page["width"], page["height"])
        except ValueError as error:
            paragraph["scan_authorization"]["background_verified"] = False
            paragraph["scan_fallback_reason"] = str(error)
        finally:
            image.close()
        page["paragraphs"] = planning["paragraphs"] + [paragraph]
        claimed.update(ids)
    uncovered = [line["id"] for line in page["lines"] if line["id"] not in claimed
                 and any(_overlaps(line["bbox"], image["bbox"]) for image in images)]
    if uncovered or (not page["lines"] and not any(p.get("scan_authorization") for p in page["paragraphs"])
                     and not page["scan_review_reasons"]):
        page["scan_review_reasons"].append({"page": number, "reason": "scan_requires_verified_embedded_ocr",
                                            "line_ids": uncovered})
    page["suppressed_line_ids"] = [key for key in page["suppressed_line_ids"] if key not in claimed]


def _table_paragraphs(page, source, document=None, number=None):
    page["tables"] = []
    claimed = set()
    characters, mapped, page_text = {}, [], ""
    transform = PageTransform.from_dict(page["page_transform"]) if "page_transform" in page else None
    if document is not None and transform is not None and number is not None:
        with locked_pdfium():
            text_page = document[number - 1].get_textpage()
            try:
                page_text = str(text_page.get_text_range(errors="surrogatepass") or "")
                mapped = legacy._pdfium_text_indices(text_page, page_text)
                characters.update({index: legacy._pdfium_character(text_page, index, transform)
                                   for index in dict.fromkeys(i for group in mapped for i in group)})
            finally:
                text_page.close()
    for block in page["blocks"]:
        if block["type"] != "table":
            continue
        table = build_table_ir(block, page)
        table.setdefault("id", f"P{page['source_page']}-T{block['id']}")
        table.setdefault("block_id", block["id"])
        table.setdefault("bbox", block["bbox"])
        table["cell_padding"] = 2.0
        table["owning_block_ids"] = [block["id"]]
        page["tables"].append(table)
        if any(b.get("is_image") and _overlaps(b["bbox"], table["bbox"]) for b in page["blocks"]):
            table.update(status="review", reason="bitmap_table_grid_unsupported", translate=False, paragraph_ids=[])
        if table["status"] != "ready":
            continue
        candidates, assigned, absorbed = [], set(), set()
        try:
            char_runs = []
            if page_text:
                def char_box(position):
                    found = [characters[i]["bbox"] for i in mapped[position]
                             if i in characters and "bbox" in characters[i]]
                    if not found:
                        return None
                    return [min(b[0] for b in found), min(b[1] for b in found),
                            max(b[2] for b in found), max(b[3] for b in found)]
                char_runs = [(position, char_box(position)) for position in range(len(page_text))
                             if not page_text[position].isspace() and char_box(position)]
            lines = [line for line in page["lines"] if _overlaps(line["bbox"], table["bbox"])]
            for cell in table["cells"]:
                box = cell["bbox"]
                inner = [box[0] + 2, box[1] + 2, box[2] - 2, box[3] - 2]
                if char_runs:
                    hits = [item for item in char_runs if _contains(inner, item[1])]
                    pieces, cursor = [], None
                    for position, _ in hits:
                        if cursor is not None and position > cursor + 1:
                            pieces.append(" ")
                        pieces.append(page_text[position])
                        cursor = position
                    text = "".join(pieces)
                    if re.sub(r"\s+", "", text) != re.sub(r"\s+", "", cell["text"]):
                        raise ValueError("table_source_text_mismatch")
                    if not hits:
                        continue
                    positions = range(hits[0][0], hits[-1][0] + 1)
                    indices = [mapped[position] for position in positions]
                    cell_characters = {index: characters[index] for group in indices
                                       for index in group if index in characters}
                    styles = [cell_characters[group[0]].get("style", {}) if group and group[0] in cell_characters
                              else {} for group in indices]
                    base = max(styles, key=styles.count) if styles else {}
                    spans = legacy._native_line_spans(text, indices, cell_characters, base)
                    line_box = [min(b[0] for _, b in hits), min(b[1] for _, b in hits),
                                max(b[2] for _, b in hits), max(b[3] for _, b in hits)]
                    first = {**base, "id": f"{cell['id']}-SRC0", "source_page": page["source_page"],
                             "line": 10000 + len(candidates), "text": text, "bbox": line_box,
                             "origin": [line_box[0], line_box[3]], "font_size": base.get("font_size", 10.0),
                             "font": base.get("font", ""), "color": base.get("color", [0.0, 0.0, 0.0]),
                             "spans": spans}
                    regions = [first]
                    absorbed.update(position for position, _ in hits)
                else:
                    regions = sorted((line for line in lines if _contains(inner, line["bbox"])),
                                     key=lambda line: (line["bbox"][1], line["bbox"][0]))
                    text = "\n".join(line["text"] for line in regions)
                    if re.sub(r"\s+", "", text) != re.sub(r"\s+", "", cell["text"]):
                        raise ValueError("table_source_text_mismatch")
                    ids = {line["id"] for line in regions}
                    if ids & (assigned | claimed):
                        raise ValueError("ambiguous_table_source_assignment")
                    if not ids:
                        continue
                    assigned.update(ids)
                    grouped = enrich_page({**page, "lines": regions}, source=source, layout_blocks=[])["paragraphs"]
                    first = grouped[0]
                    spans, offset = [], 0
                    for line in regions:
                        spans.extend({**span, "start": span["start"] + offset, "end": span["end"] + offset}
                                     for span in line.get("spans", []))
                        offset += len(line["text"]) + 1
                    regions = copy.deepcopy(regions)
                protected = cell["protected"] or any(span["type"] in {"formula", "code"} for span in spans)
                cell.update(protected=protected, translate=cell["translate"] and not protected)
                style = {key: first.get(key, default) for key, default in (
                    ("font", ""), ("font_size", 10.0), ("bold", False), ("italic", False),
                    ("serif", False), ("color", [0.0, 0.0, 0.0]))}
                candidates.append({**style, "id": cell["id"], "text": text, "bbox": inner,
                                   "type": "paragraph", "translate": cell["translate"], "spans": spans,
                                   "table_id": table["id"], "cell_bbox": box.copy(), "cell_padding": 2.0,
                                   "line_ids": [region["id"] for region in regions], "source_lines": regions,
                                   "block_ids": [block["id"]], "fixed_bbox": True})
            if char_runs:
                if any(position not in absorbed for position, box in char_runs
                       if _overlaps(box, table["bbox"])):
                    raise ValueError("unconfined_table_source_lines")
            elif assigned != {line["id"] for line in lines}:
                raise ValueError("unconfined_table_source_lines")
            for obstacle in page["blocks"]:
                edges = obstacle.get("path_edges", [])
                bounds = table["bbox"]
                if not edges or not _overlaps(obstacle["bbox"], bounds):
                    continue
                if all((abs(x0 - x1) < 0.001 and any(abs(x0 - x) < 0.001 for x in table["column_edges"]) or
                        abs(y0 - y1) < 0.001 and any(abs(y0 - y) < 0.001 for y in table["row_edges"]))
                       and not any(_overlaps([min(x0, x1) - 0.5, min(y0, y1) - 0.5,
                                              max(x0, x1) + 0.5, max(y0, y1) + 0.5], p["bbox"])
                                   for p in candidates) for x0, y0, x1, y1 in edges):
                    table["owning_block_ids"].append(obstacle["id"])
            for paragraph in candidates:
                paragraph["owning_block_ids"] = table["owning_block_ids"].copy()
            table["paragraph_ids"] = [p["id"] for p in candidates if p["translate"]]
            table["font_size"] = max((p["font_size"] for p in candidates), default=10.0)
            table["font"] = candidates[0]["font"] if candidates else ""
            claimed.update(assigned)
            if char_runs:
                absorbed_ids = {line["id"] for line in page["lines"] if _contains(table["bbox"], line["bbox"])}
                page["lines"] = [line for line in page["lines"] if line["id"] not in absorbed_ids]
                claimed.update(absorbed_ids)
            page["paragraphs"] = [p for p in page["paragraphs"]
                                  if not _overlaps(p["bbox"], table["bbox"])
                                  and not (set(p["line_ids"]) & assigned)] + candidates
            for line in page["lines"]:
                if line["id"] in assigned:
                    line["table_id"] = table["id"]
        except (KeyError, TypeError, ValueError) as error:
            table.update(status="review", reason=str(error), translate=False, paragraph_ids=[])
    page["suppressed_line_ids"] = [key for key in page["suppressed_line_ids"] if key not in claimed]


def _plan_page_tables(page, translations, target_language):
    settings = {"target_language": target_language, "cell_padding": 2.0,
                "expansion_order": (), "max_expansion_points": 0, "margin": 0}
    resolver = FontFallbackResolver()
    failures = []
    for table in page.get("tables", []):
        own = set(table["owning_block_ids"])
        planning_page = {**page, "paragraphs": [p for p in page["paragraphs"] if p.get("table_id") == table["id"]]}
        for key in ("blocks", "obstacles", "lines", "original_lines"):
            planning_page[key] = [item for item in page.get(key, [])
                                  if item.get("id") not in own and item.get("table_id") != table["id"]]
        plan = plan_table(table, translations, planning_page, resolver, settings)
        if plan.get("requires_grid_redraw"):
            plan.update(status="review", reason="grid_redraw_required", renderable=False, fits=False)
        if plan["renderable"]:
            for paragraph in planning_page["paragraphs"]:
                if not paragraph["translate"]:
                    continue
                text = translations[paragraph["id"]]
                try:
                    fragments = assemble_fragments(paragraph, text)
                    fit = (fit_fragments(fragments, paragraph, planning_page, resolver, settings) if fragments else
                           fit_paragraph(text, paragraph, planning_page, resolver, settings))
                    cell = next(cell for cell in plan["cells"] if cell["id"] == paragraph["id"])
                    cell.update(paragraph=copy.deepcopy(paragraph), fit=asdict(fit), fits=fit.fits)
                    if not fit.fits:
                        raise ValueError("grid_redraw_required" if fit.overflow_y > 0 else fit.reason)
                except (KeyError, TypeError, ValueError) as error:
                    plan.update(status="review", reason=str(error), renderable=False, fits=False)
                    break
        table["plan"] = plan
        if not plan["renderable"]:
            failures.append({"page": page["source_page"], "id": table["id"], "reason": plan["reason"]})
            for paragraph in page["paragraphs"]:
                if paragraph.get("table_id") == table["id"]:
                    paragraph["translate"] = False
                    translations.pop(paragraph["id"], None)
    return failures


def translate_document(
    source: str | Path, target_language: str = "korean", provider: TranslationProvider | None = None,
    model: str | None = None, options: DocumentTranslationOptions | dict[str, Any] | None = None, *,
    app_config: Mapping[str, Any] | None = None, output_path: str | Path | None = None,
    cache_path: str | Path | None = None, pages: Sequence[int] | None = None,
    emit: Callable[[dict[str, Any]], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    glossary: TranslationGlossary | dict[str, Any] | Sequence[Any] | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    source = Path(source).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError("PDF file not found")
    if source.suffix.lower() != ".pdf":
        raise ValueError("Only PDF documents are supported")
    target_language = legacy.normalize_app_language(target_language)
    options = DocumentTranslationOptions(**options) if isinstance(options, dict) else options
    options = options or DocumentTranslationOptions()
    if not isinstance(options, DocumentTranslationOptions):
        raise ValueError("Invalid document translation options")
    if glossary is not None and not isinstance(glossary, TranslationGlossary):
        glossary = TranslationGlossary(**glossary) if isinstance(glossary, dict) else TranslationGlossary(tuple(glossary))
    if provider is None:
        config = legacy.deepseek_config_from_mapping(app_config or {})
        if model is not None:
            config["model"] = model
        provider = OpenAICompatibleTranslationProvider(config)
    elif model is not None and model != provider.identity.get("model"):
        raise ValueError("model conflicts with injected provider")
    identity = translation_cache_identity(provider, "pending", glossary, options)
    model = identity["provider"]["model"]
    destination = (Path(output_path).expanduser().resolve() if output_path else
                   legacy.default_translation_output_path(source) if target_language == "korean" else
                   source.with_name(f"{source.stem}-{target_language}-translated.pdf"))
    key = hashlib.sha256(json.dumps([os.path.normcase(str(source)), identity["provider"], target_language],
                                    sort_keys=True).encode("utf-8")).hexdigest()
    cache = (Path(cache_path).expanduser().resolve() if cache_path else
             legacy.translation_cache_dir() / f"{key}.document.json")
    qa_path = cache.with_suffix(".qa.json")
    layout_path = cache.with_suffix(".layout.json")
    paths = (source, destination, cache, qa_path, layout_path,
             layout_path.with_suffix(layout_path.suffix + ".tmp"), cache.with_suffix(cache.suffix + ".tmp"),
             qa_path.with_suffix(qa_path.suffix + ".tmp"))
    _distinct_paths(*paths)
    timings = {}

    def check():
        legacy._check_cancel(cancel_check)
        _distinct_paths(*paths)

    def progress(kind, stage, completed, total, percent, **extra):
        legacy._emit(emit, {"type": kind, "stage": stage, "completed": completed, "total": total,
                            "progress": percent, "percent": percent, **extra})

    with legacy._translation_lock(source):
        check()
        _distinct_paths(*paths)
        revision = legacy.source_identity(source)
        with source.open("rb") as stream:
            reader = PdfReader(stream)
            total_pages = len(reader.pages)
            selected = list(range(1, total_pages + 1)) if pages is None else list(pages)
            if not selected or any(type(p) is not int or not 1 <= p <= total_pages for p in selected):
                raise ValueError("Selected pages must be valid 1-based PDF page numbers")
            selected = sorted(set(selected))
            progress("stage", "preparing", 0, len(selected), 0, output_path=str(destination), model=model)
            stage_started = time.perf_counter()
            analysis = read_analysis_metadata(reader)
            if analysis and (analysis.get("corrupt") or analysis.get("payload") is None):
                raise ValueError("Embedded layout analysis is unavailable or corrupt; repair OCR first")
            analysis_pages = {p["page"]: p for p in (analysis or {}).get("payload", {}).get("pages", [])}
            layout = {"layout_version": legacy.LAYOUT_VERSION, "source": revision,
                      "extractor": "pdfium_text_coordinates", "selected_pages": selected,
                      "total_pages": total_pages, "pages": []}
            progress("stage", "extracting", 0, len(selected), 0)
            with locked_pdfium():
                document = pdfium.PdfDocument(str(source))
            try:
                for completed, number in enumerate(selected, 1):
                    check()
                    transform = PageTransform.from_page(reader.pages[number - 1])
                    native = _native_obstacles(document, number, transform)
                    with locked_pdfium():
                        pdf_page = document[number - 1]
                        text_page = pdf_page.get_textpage()
                        try:
                            empty_scan = any(b["is_image"] for b in native) and not text_page.count_chars()
                        finally:
                            text_page.close()
                            pdf_page.close()
                    if empty_scan:
                        page = {"source_page": number, "width": transform.width, "height": transform.height,
                                "page_transform": transform.to_dict(), "coordinate_space": PageTransform.COORDINATE_SPACE,
                                "inverse_transform": list(transform.overlay_to_pdf), "lines": []}
                    else:
                        extracted = legacy.extract_indexed_layout(source, [number], target_language,
                                                                  canonical_coordinates=True)
                        if extracted["source"]["sha256"] != revision["sha256"]:
                            raise RuntimeError("Source PDF changed during extraction")
                        page = extracted["pages"][0]
                    page = {**page, "lines": [{**line, "translate": _prose_eligible(line)}
                                              for line in page.get("lines", [])]}
                    source_type = "ocr" if analysis else "native_pdf"
                    baseline = enrich_page(page, source=source_type, layout_blocks=[])
                    eligible_ids = {key for paragraph in baseline["paragraphs"] if paragraph["translate"]
                                    for key in paragraph["line_ids"]}
                    blocks = copy.deepcopy(analysis_pages.get(number, {}).get("blocks", []))
                    if any("normalized_bbox" not in block for block in blocks):
                        raise ValueError("Embedded layout requires normalized coordinates; repair OCR first")
                    for block in blocks:
                        block["bbox"] = list(transform.normalized_bbox_to_canonical(block.pop("normalized_bbox")))
                        block["coordinate_space"] = "pdf_points"
                    enriched = enrich_page(page, source=source_type, layout_blocks=blocks + native)
                    for block in enriched["blocks"] + enriched["obstacles"]:
                        block["coordinate_space"] = PageTransform.COORDINATE_SPACE
                    enriched["suppressed_line_ids"] = [key for paragraph in enriched["paragraphs"]
                                                       if not paragraph["translate"]
                                                       for key in paragraph["line_ids"] if key in eligible_ids]
                    _prepare_scan(enriched, document, number)
                    _table_paragraphs(enriched, source_type, document, number)
                    layout["pages"].append(enriched)
                    progress("stage", "extracting", completed, len(selected), 25 * completed / len(selected), page=number)
            finally:
                with locked_pdfium():
                    document.close()
            analysis_header = copy.deepcopy((analysis or {}).get("header"))
        timings["layout_extraction_seconds"] = time.perf_counter() - stage_started
        paragraphs = [p for page in layout["pages"] for p in page["paragraphs"]]
        segments = make_segments(paragraphs, source_language=options.source_language,
                                 target_language=target_language, max_characters=options.max_segment_characters)
        metadata = {"source": revision, "target_language": target_language, "model": model,
                    "layout": layout, "analysis_header": analysis_header,
                    "segment_mappings": [{k: v for k, v in segment.items() if k != "protection"} for segment in segments]}
        check()
        _distinct_paths(*paths)
        destination.parent.mkdir(parents=True, exist_ok=True)

        def checkpoint(**extra):
            _distinct_paths(*paths)
            try:
                payload = json.loads(cache.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                payload = {}
            if "segments" in extra:
                extra["segments"] = {**payload.get("segments", {}), **extra["segments"]}
            payload.update({key: value for key, value in extra.items()
                            if key not in {"fit_report", "layout_status", "metrics"}})
            for key in ("layout", "analysis_header", "segment_mappings", "fit_report", "layout_status", "metrics"):
                payload.pop(key, None)
            for record in payload.get("segments", {}).values():
                record.pop("fit_report", None)
                record.pop("layout_status", None)
            legacy.atomic_write_json(cache, payload)
            legacy.atomic_write_json(layout_path, {**metadata, **{key: value for key, value in extra.items()
                                     if key != "segments"}, "layout_version": 2,
                                     "translation_identity": payload.get("identity")})
            return payload

        settled = set()

        def segment_progress(event):
            if event.get("status") in {"translated", "completed", "failed", "typesetting"}:
                settled.add(event["segment_id"])
            checkpoint()
            progress("translation_progress", "translating", len(settled), len(segments),
                     30 + 45 * len(settled) / max(1, len(segments)), **event)

        progress("stage", "translating", 0, len(segments), 30)
        stage_started = time.perf_counter()
        try:
            translated = translate_segments(segments, provider, cache_path=cache,
                                            document_revision=revision["sha256"], glossary=glossary,
                                            emit=segment_progress, cancel_check=check, options=options)
        finally:
            if cache.is_file():
                checkpoint()
        timings["translation_seconds"] = time.perf_counter() - stage_started
        records = translated["segments"]
        code = translated.get("systemic_status")
        systemic_status = {401: "auth", 402: "billing", 403: "auth", 429: "transient"}.get(code) if type(code) is int else None
        systemic_failures = sum(record.get("status") == "failed" and record.get("error") == f"http_{code}"
                                for record in records.values()) if systemic_status else 0
        if not systemic_failures:
            systemic_status = None
        progress("translation_progress", "translating",
                 translated["metrics"]["translated"] + translated["metrics"]["failed"], len(segments), 75,
                 cached=translated["metrics"]["cache_hits"], pending=translated["metrics"]["pending"])
        check()
        if legacy.source_identity(source)["sha256"] != revision["sha256"]:
            raise RuntimeError("Source PDF changed before rendering")
        for record in records.values():
            if record["status"] in {"translated", "completed", "typesetting"}:
                record.update(status="typesetting", layout_status="pending")
        checkpoint(segments=records)
        rendered_pages = set()

        def render_progress(event):
            if event.get("type") == "render_progress":
                rendered_pages.add(event["page"])
                progress("render_progress", "rendering", len(rendered_pages), len(selected),
                         75 + 20 * len(rendered_pages) / len(selected), page=event["page"],
                         rendered=event.get("rendered", 0))

        progress("stage", "rendering", 0, len(selected), 75)
        stage_started = time.perf_counter()
        try:
            check()
            _distinct_paths(*paths)
            if legacy.source_identity(source)["sha256"] != revision["sha256"]:
                raise RuntimeError("Source PDF changed before rendering")
            render_translations = dict(translated["translations"])
            table_failures = [failure for page in layout["pages"]
                              for failure in _plan_page_tables(page, render_translations, target_language)]
            render_layout = {**layout, "selected_pages": set(selected)}
            fit_report = render_document_pdf(source, destination, render_layout, render_translations,
                                             target_language=target_language, emit=render_progress, cancel_check=check)
        except BaseException:
            for record in records.values():
                if record["status"] == "typesetting":
                    record.update(status="translated", layout_status="failed")
            checkpoint(segments=records, layout_status="failed")
            raise
        timings["pdf_render_seconds"] = time.perf_counter() - stage_started
        fits = {p["id"]: p for page in fit_report.get("pages", []) for p in page.get("paragraphs", [])}
        failures = [{"page": page["source_page"], "id": key, "reason": "prose_suppressed_by_layout_obstacle"}
                    for page in layout["pages"] for key in page["suppressed_line_ids"]]
        suppressed_count = len(failures)
        failures.extend(table_failures)
        failures.extend(reason for page in layout["pages"] for reason in page.get("scan_review_reasons", []))
        fallback_translations = [{"source_page": page["source_page"], "paragraph_id": p["id"],
                                  "original_text": p["text"], "translated_text": translated["translations"][p["id"]],
                                  "reason": fits.get(p["id"], {}).get("reason", "missing_fit_report")}
                                 for page in layout["pages"] for p in page["paragraphs"]
                                 if p.get("scan_authorization") and p["id"] in translated["translations"]
                                 and not fits.get(p["id"], {}).get("fits")]
        skipped = [p["id"] for p in paragraphs if not p.get("translate", True)]
        for paragraph in paragraphs:
            if paragraph["id"] in skipped:
                continue
            fit = fits.get(paragraph["id"], {})
            if not fit.get("fits"):
                failures.append({"id": paragraph["id"], "reason": fit.get("reason", "missing_fit_report")})
        for record in records.values():
            fit = fits.get(record["paragraph_ids"][0], {})
            if record["status"] == "typesetting":
                record.update(status="completed" if fit.get("fits") else "translated",
                              layout_status="completed" if fit.get("fits") else "failed", fit_report=fit)
        for page in fit_report.get("pages", []):
            if page.get("reason") and page["reason"] != "missing_paragraph_layout":
                failures.append({"page": page["source_page"], "reason": page["reason"]})
        failures.extend(item for item in fit_report.get("omitted", [])
                        if not (item.get("reason") == "page_without_layout" and item.get("source_page") not in selected))
        metrics = {**translated["metrics"], "rendered_paragraphs": fit_report.get("rendered_count", 0),
                   "skipped_paragraphs": len(skipped), "suppressed_prose_lines": suppressed_count,
                   "layout_failures": len(failures), "systemic_failures": systemic_failures}
        check()
        stage_started = time.perf_counter()
        assessment = assess_document(source, destination, layout, fit_report, translated["translations"])
        timings["qa_seconds"] = time.perf_counter() - stage_started
        qa_issues = [{"axis": axis, **issue} for axis, result in assessment.items()
                     if isinstance(result, dict) for issue in result.get("issues", [])]
        failures.extend(qa_issues)
        metrics["qa_issues"] = len(qa_issues)
        status = "review_required" if (failures or metrics["failed"] or metrics["pending"]
                                       or assessment["status"] == "review_required") else "approved"
        outcome = "success" if status == "approved" else "partial" if metrics["rendered_paragraphs"] else "failed"
        timings["total_seconds"] = time.perf_counter() - started
        usage = translated.get("usage") or translated["metrics"].get("usage") or {}
        checkpoint(segments=records, fit_report=fit_report, layout_status=outcome, metrics=metrics)
        qa = {"status": status, "outcome": outcome, "systemic_status": systemic_status,
              "layout": layout, "results": fit_report,
              "review_reasons": failures, "fallback_translations": fallback_translations,
              "skipped_ids": skipped, "failed_ids": translated["failed_ids"],
              "pending_ids": translated["pending_ids"], "provider": identity["provider"],
              "usage": usage, "metrics": metrics, "timings": timings, "assessment": assessment}
        _distinct_paths(*paths)
        legacy.atomic_write_json(qa_path, qa)
        if systemic_status:
            status = "failed" if systemic_status == "transient" else "blocked"
        result = {"path": str(source), "output_path": str(destination), "cache_path": str(cache),
                  "systemic_status": systemic_status,
                  "qa_path": str(qa_path), "status": status, "outcome": outcome, "page_count": len(selected),
                  "model": model, "usage": usage, "timings": timings, "metrics": metrics}
        progress("stage", "saved", len(selected), len(selected), 100)
        legacy._emit(emit, {"type": "done", **result})
        return result
