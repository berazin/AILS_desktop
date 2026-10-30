"""Conservative, page-local excerpt alignment. Never accept model geometry."""
from __future__ import annotations

import math
import re
import sqlite3
from contextlib import closing
from pathlib import Path


def compact(text):
    return re.sub(r"\s+", "", text.replace("\u00ad", ""))


def match_words(excerpt, words):
    """Only a unique complete word sequence is eligible; no fuzzy matching."""
    needle = compact(excerpt)
    if len(needle) < 12 or len(excerpt) > 8000:
        return None
    tokens = [compact(str(word.get("text", ""))) for word in words]
    text = "".join(tokens)
    start = text.find(needle)
    if start < 0 or text.find(needle, start + 1) >= 0:
        return None
    boundaries = [0]
    for token in tokens:
        boundaries.append(boundaries[-1] + len(token))
    end = start + len(needle)
    if start not in boundaries or end not in boundaries:
        return None
    selected = words[boundaries.index(start):boundaries.index(end)]
    if not selected or len(selected) > 1000:
        return None
    for word in selected:
        box = [word.get(k) for k in ("left", "top", "right", "bottom")]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v <= 1 for v in box):
            return None
        if box[0] >= box[2] or box[1] >= box[3]:
            return None
    return selected


def page_words(path, page):
    # Read the existing OCR schema without rebuilding, migrating or changing it.
    from pdf.pdf_ocr_search import _database_path, _fingerprint, OCR_WORD_INDEX_VERSION
    from pdf.pdf_native_text import required_word_index_version, visible_native_index_words
    from pdf.pdf_file_state import file_digest
    database = Path(_database_path())
    if database.is_file():
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1)) as connection:
            row = connection.execute("SELECT fingerprint, word_index_version, index_source, content_digest FROM pdf_ocr_documents WHERE path = ?", (path,)).fetchone()
            if row and row[0] == _fingerprint(path) and row[3] == file_digest(path) and row[2] and int(row[1] or 0) >= required_word_index_version(row[2], OCR_WORD_INDEX_VERSION):
                rows = connection.execute("SELECT text, left, top, right, bottom, block_id FROM pdf_ocr_words WHERE path = ? AND page = ? ORDER BY word_index", (path, page)).fetchall()
                if rows:
                    return [dict(zip(("text", "left", "top", "right", "bottom", "block_id"), row)) for row in rows], row[2]
    # Native glyphs only: invisible OCR without its retained index is not evidence.
    return [dict(text=w.text, left=w.left, top=w.top, right=w.right, bottom=w.bottom) for w in visible_native_index_words(path, page)], "native_text"


def resolve_position(path, index, excerpt, reader):
    fallback = {"precision": "page", "position_reason": "문장 위치를 유일하게 확인하지 못해 페이지로 이동합니다."}
    if not excerpt:
        return {**fallback, "position_reason": "저장된 문장 근거가 없어 페이지로 이동합니다."}
    try:
        from pdf.page_transform import PageTransform
        words, source = page_words(path, index + 1)
        selected = match_words(excerpt, words)
        # Native index text also has a geometric line-order representation. Reuse
        # its exact assembler ordering; never search another page or guess a box.
        if selected is None and source == 'native_text' and compact(excerpt) not in compact(''.join(word['text'] for word in words)):
            from types import SimpleNamespace
            from pdf.index_word_order import page_word_lines
            ordered = [vars(word) for line in page_word_lines([SimpleNamespace(**word) for word in words]) for word in line]
            selected = match_words(excerpt, ordered)
        if selected is None:
            return fallback
        transform = PageTransform.from_page(reader.pages[index])
        boxes = [list(transform.canonical_bbox_to_pdf(transform.normalized_bbox_to_canonical(
            [word[k] for k in ("left", "top", "right", "bottom")]))) for word in selected]
        return {"precision": "excerpt", "position": {"space": "pdf", "boxes": boxes, "source": source},
                "position_reason": "발췌 문장 위치를 강조했습니다."}
    except (OSError, ValueError, RuntimeError, sqlite3.Error, ImportError):
        return fallback
