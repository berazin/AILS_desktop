"""Read ruled PDF answer tables without flattening answer/explanation columns.

Only explicit number/answer headers and bounded cells are used. Visible parts
of split rows stay marked incomplete. This produces candidates, never confirmed
mappings or an inferred scoring rubric.
"""
from contextlib import closing
import ctypes
import re

from pdf.page_transform import PageTransform
from pdf.pdf_password import open_pdfium_document


def table_edges(path, page_number, reader_page):
    import pypdfium2 as pdfium
    transform = PageTransform.from_page(reader_page)
    horizontal, vertical = [], []
    with open_pdfium_document(path) as document, closing(document[page_number - 1]) as page:
        for obj in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_PATH]):
            fill, stroke = ctypes.c_int(), ctypes.c_int()
            pdfium.raw.FPDFPath_GetDrawMode(obj, ctypes.byref(fill), ctypes.byref(stroke))
            left, top, right, bottom = transform.pdf_bbox_to_canonical(obj.get_bounds())
            left, right = left / transform.width, right / transform.width
            top, bottom = top / transform.height, bottom / transform.height
            width, height = right - left, bottom - top
            # PDFium's stroked-path bounds may include a wide miter margin.
            # Their axis centers are still exact. Only stroked lines may use
            # those wide bounds; filled code backgrounds are not grid borders.
            if width >= .025 and (height <= .003 or stroke.value and height <= .02 and width > height * 12):
                horizontal.append((left, right, (top + bottom) / 2))
            if height >= .012 and (width <= .003 or stroke.value and width <= .02 and height > width * 5):
                vertical.append(((left + right) / 2, top, bottom))
    return horizontal, vertical


def _center(word):
    return ((word["left"] + word["right"]) / 2, (word["top"] + word["bottom"]) / 2)


def _text(words):
    from pdf.pdf_ocr_search import _reconstruct_indexed_region_text
    return _reconstruct_indexed_region_text([
        (w["text"], w["left"], w["top"], w["right"], w["bottom"]) for w in words
    ]).strip()


def _inside(words, left, top, right, bottom):
    return [w for w in words if left < _center(w)[0] < right and top < _center(w)[1] < bottom]


def _unique(values):
    result = []
    for value in sorted(values):
        if not result or value - result[-1] > .002:
            result.append(value)
    return result


def extract_table_candidates(words, edges, page_number):
    horizontal, vertical = edges
    candidates = []
    headers = [w for w in words if w["text"].strip() in {"문항", "번호", "문제번호", "number"}]
    for header in headers:
        x, y = _center(header)
        columns = _unique(edge for edge, top, bottom in vertical if top - .002 < y < bottom + .002)
        column = next((i for i in range(len(columns) - 1) if columns[i] < x < columns[i + 1]), None)
        if column is None or column + 2 >= len(columns):
            continue
        number_left, answer_left, answer_right = columns[column:column + 3]
        header_rows = _unique(edge for left, right, edge in horizontal
                              if left <= number_left + .002 and right >= answer_left - .002)
        header_top = max((edge for edge in header_rows if edge < y), default=None)
        header_bottom = min((edge for edge in header_rows if edge > y), default=None)
        if header_top is None or header_bottom is None:
            continue
        answer_header = _text(_inside(words, answer_left, header_top, answer_right, header_bottom))
        if answer_header not in {"정답", "답", "answer"}:
            continue
        extra_right = columns[column + 3] if column + 3 < len(columns) else answer_right
        extra_header = _text(_inside(words, answer_right, header_top, extra_right, header_bottom))
        if extra_header not in {"해설", "설명", "기준", "평가기준", "criteria"}:
            extra_right = answer_right
        next_header_y = min((_center(w)[1] for w in headers
                             if number_left < _center(w)[0] < answer_left and _center(w)[1] > y + .003), default=1.0)
        row_edges = _unique(edge for left, right, edge in horizontal
                            if left <= number_left + .002 and right >= answer_left - .002
                            and header_bottom - .002 <= edge < next_header_y)
        if not row_edges:
            continue
        # Word tables split across pages can omit the bottom horizontal border
        # of the unfinished row. The shared ends of its vertical borders still
        # bound that visible fragment, without inventing its missing content.
        terminal = min((max((end for edge, start, end in vertical
                             if abs(edge - boundary) < .002 and start <= row_edges[-1] + .003
                             and end < next_header_y), default=0)
                        for boundary in (number_left, answer_left, answer_right)), default=0)
        fragment_bottom = terminal if row_edges and terminal > row_edges[-1] + .003 else None
        if fragment_bottom is not None:
            row_edges.append(fragment_bottom)
        for top, bottom in zip(row_edges, row_edges[1:]):
            # Each cell must have vertical borders throughout this row; stop at
            # a table break rather than swallowing an intervening paragraph.
            if not all(any(abs(edge - boundary) < .002 and start <= top + .003
                           and end >= bottom - .003 for edge, start, end in vertical)
                       for boundary in (number_left, answer_left, answer_right)):
                continue
            number_text = _text(_inside(words, number_left, top, answer_left, bottom))
            answer = _text(_inside(words, answer_left, top, answer_right, bottom))
            extra = _text(_inside(words, answer_right, top, extra_right, bottom)) if extra_right > answer_right else ""
            if not answer and not extra:
                continue
            if number_text and not re.fullmatch(r"\d{1,4}[.)]?", number_text):
                continue
            # A split row can continue after the repeated header on the next
            # page. Keep it explicit, and join only to the preceding table row.
            number = int(number_text.rstrip(".)")) if number_text else None
            candidates.append({
                "chapter": "", "number": number, "subquestion": "", "answer": answer,
                "criteria": extra if extra_header in {"기준", "평가기준", "criteria"} else "",
                "explanation": extra if extra_header in {"해설", "설명"} else "",
                "question": "", "original_text": "\t".join([number_text, answer, extra]).rstrip(),
                "location": {"page": page_number, "line_start": 1, "line_end": 1,
                             "bbox": {"left": number_left, "top": top, "right": extra_right, "bottom": bottom},
                             "answer_bbox": {"left": answer_left, "top": top, "right": answer_right, "bottom": bottom},
                             "number_bbox": {"left": number_left, "top": top, "right": answer_left, "bottom": bottom}},
                "method": "native_pdf_grid", "confidence": min(w["confidence"] for w in _inside(words, number_left, top, extra_right, bottom)),
                "table_column": round(number_left, 3), "table_header": answer_header,
                "continues_after_page": fragment_bottom is not None and bottom == fragment_bottom,
            })
    return sorted(candidates, key=lambda item: (item["table_column"], item["location"]["bbox"]["top"]))
