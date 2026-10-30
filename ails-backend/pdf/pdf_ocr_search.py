"""PDF OCR SQLite index, full-text search, and table-of-contents support.

Extracted from pdf_ocr.py to isolate search database queries, index updates,
and outline parsing.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from typing import Callable, Any

import math
import statistics
from pdf.pdf_password import open_pdf_reader as PdfReader
import pdf.pdf_structure as pdf_structure
import pdf.pdf_analysis_metadata as _analysis_metadata

from pdf.pdf_outline import (
    build_outline as _build_pdf_outline,
    chapter_number as _pdf_outline_chapter_number,
    chapter_title as _pdf_outline_chapter_title,
    choose_app_outline as _choose_app_pdf_outline,
    choose_outline as _choose_pdf_outline,
    entry_for_line as _pdf_outline_entry_for_line,
    native_outline_for_reader as _read_native_pdf_outline,
)

from pdf.pdf_ocr_types import (
    BOOKMARK_VERSION,
    DEFAULT_LANGUAGE,
    DEFAULT_OCR_MODEL_VARIANT,
    OCR_DETECTION_MODEL_KEY,
    OCR_ENGINE_KEY,
    OCR_LANGUAGE_KEY,
    OCR_METADATA_KEY,
    OCR_MODEL_KEY,
    OCR_OUTLINE_SOURCE_KEY,
    OCR_PRESET_VERSION_KEY,
    OCR_RECOGNITION_MODEL_KEY,
    OCR_VERSION,
    OCR_WORD_INDEX_VERSION,
    OUTLINE_INDEX_VERSION,
    OcrWord,
    _normalize_ocr_model_variant,
)

from pdf.pdf_file_state import file_digest as _content_digest, _lock_for_pdf
# pdf_ocr는 모듈 끝에서 pdf_ocr_search를 역임포트하므로, pdf_ocr가 부분 초기화된
# 시점에 바인딩되지 않는 이름은 원래 정의 모듈인 pdf_ocr_postprocess에서 가져온다.
from pdf.pdf_ocr_postprocess import _correct_ocr_page_words
from pdf.pdf_native_text import native_text_pages, required_word_index_version, visible_native_index_words

_logger = logging.getLogger(__name__)


def _active_reader_has_text_layer(reader, minimum_ratio: float = 0.6) -> bool:
    import sys
    mod = sys.modules.get('pdf.pdf_ocr')
    fn = getattr(mod, "_reader_has_text_layer", None) if mod is not None else None
    if fn is not None and fn is not _reader_has_text_layer:
        return fn(reader, minimum_ratio=minimum_ratio)
    return _reader_has_text_layer(reader, minimum_ratio=minimum_ratio)

def _active_rebuild_index_from_embedded(path: str, language: str):
    import sys
    mod = sys.modules.get('pdf.pdf_ocr')
    fn = getattr(mod, "_rebuild_index_from_embedded", None) if mod is not None else None
    if fn is not None and fn is not _rebuild_index_from_embedded:
        return fn(path, language)
    return _rebuild_index_from_embedded(path, language)

def _database_path() -> str:
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir()
    directory = os.path.join(appdata, "AILS", "search")
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, "pdf_ocr_fts5.sqlite3")


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_database_path(), timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS pdf_ocr_documents (
            path TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            language TEXT NOT NULL,
            engine TEXT NOT NULL,
            page_count INTEGER NOT NULL,
            outline_json TEXT NOT NULL DEFAULT '[]',
            outline_version INTEGER NOT NULL DEFAULT 0,
            word_index_version INTEGER NOT NULL DEFAULT 0,
            content_digest TEXT NOT NULL DEFAULT '',
            index_source TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS pdf_ocr_words (
            path TEXT NOT NULL,
            page INTEGER NOT NULL,
            word_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            left REAL NOT NULL,
            top REAL NOT NULL,
            right REAL NOT NULL,
            bottom REAL NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            PRIMARY KEY(path, page, word_index)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS pdf_ocr_pages USING fts5(
            path UNINDEXED,
            page UNINDEXED,
            text,
            tokenize='unicode61'
        );
        CREATE TABLE IF NOT EXISTS pdf_ocr_blocks (
            path TEXT NOT NULL,
            page INTEGER NOT NULL,
            block_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            left REAL NOT NULL,
            top REAL NOT NULL,
            right REAL NOT NULL,
            bottom REAL NOT NULL,
            reading_order INTEGER,
            confidence REAL,
            text_source TEXT NOT NULL DEFAULT 'ocr',
            text TEXT NOT NULL DEFAULT '',
            table_json TEXT NOT NULL DEFAULT '',
            formula_json TEXT NOT NULL DEFAULT '',
            spacing_json TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(path, page, block_id)
        );
        """
    )
    word_columns = {
        str(row[1])
        for row in connection.execute("PRAGMA table_info(pdf_ocr_words)").fetchall()
    }
    if "block_id" not in word_columns:
        connection.execute("ALTER TABLE pdf_ocr_words ADD COLUMN block_id INTEGER")
        connection.commit()
    document_columns = {
        str(row[1])
        for row in connection.execute("PRAGMA table_info(pdf_ocr_documents)").fetchall()
    }
    if "outline_version" not in document_columns:
        connection.execute(
            "ALTER TABLE pdf_ocr_documents ADD COLUMN outline_version INTEGER NOT NULL DEFAULT 0"
        )
        connection.commit()
    if "word_index_version" not in document_columns:
        connection.execute(
            "ALTER TABLE pdf_ocr_documents ADD COLUMN word_index_version INTEGER NOT NULL DEFAULT 0"
        )
        connection.commit()
    if "content_digest" not in document_columns:
        connection.execute(
            "ALTER TABLE pdf_ocr_documents ADD COLUMN content_digest TEXT NOT NULL DEFAULT ''"
        )
        connection.commit()
    if "index_source" not in document_columns:
        connection.execute(
            "ALTER TABLE pdf_ocr_documents ADD COLUMN index_source TEXT NOT NULL DEFAULT ''"
        )
        connection.commit()
    block_columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(pdf_ocr_blocks)")}
    if "spacing_json" not in block_columns:
        connection.execute("ALTER TABLE pdf_ocr_blocks ADD COLUMN spacing_json TEXT NOT NULL DEFAULT ''")
        connection.commit()
    return connection


def _fingerprint(path: str) -> str:
    stat = os.stat(path)
    digest = hashlib.sha256()
    digest.update(os.path.normcase(os.path.abspath(path)).encode("utf-8", errors="replace"))
    digest.update(f"\0{stat.st_size}\0{stat.st_mtime_ns}".encode("ascii"))
    return digest.hexdigest()


def _reader_has_text_layer(reader, minimum_ratio: float = 0.6) -> bool:
    if not reader.pages:
        return True
    ratio = min(max(float(minimum_ratio), 0.0), 1.0)
    required = 1 if ratio <= 0 else max(1, math.ceil(len(reader.pages) * ratio))
    populated = 0
    for index, page in enumerate(reader.pages):
        if len((page.extract_text() or "").strip()) >= 8:
            populated += 1
            if populated >= required:
                return True
        remaining = len(reader.pages) - index - 1
        if populated + remaining < required:
            return False
    return populated >= required


def pdf_has_text_layer(path: str, minimum_ratio: float = 0.6) -> bool:
    import sys
    from pdf.pdf_password import open_pdf_reader as PdfReader

    mod = sys.modules.get('pdf.pdf_ocr')
    fn = getattr(mod, "_reader_has_text_layer", _reader_has_text_layer) if mod is not None else _reader_has_text_layer
    return fn(PdfReader(os.path.abspath(path)), minimum_ratio)


def pdf_pages_missing_text_layer(path: str, *, minimum_characters: int = 8, reader=None) -> list[int]:
    """텍스트 레이어가 없는 페이지의 0-based 인덱스 목록을 반환한다.

    기본값은 _reader_has_text_layer와 같은 기준(추출 텍스트 8자 미만)이다.
    프레젠테이션은 minimum_characters=1로 짧은 제목도 보존한다.
    reader가 있으면 같은 PDF를 다시 열지 않고 페이지 판정을 재사용한다.
    """
    from pdf.pdf_password import open_pdf_reader as PdfReader

    reader = reader if reader is not None else PdfReader(os.path.abspath(path))
    return [
        index
        for index, page in enumerate(reader.pages)
        if len((page.extract_text() or "").strip()) < max(1, minimum_characters)
    ]


def _upgrade_word_index_from_rows(
    connection: sqlite3.Connection,
    normalized: str,
) -> bool:
    rows = connection.execute(
        "SELECT page, word_index, text, left, top, right, bottom, confidence "
        "FROM pdf_ocr_words WHERE path = ? ORDER BY CAST(page AS INTEGER), word_index",
        (normalized,),
    ).fetchall()
    if not rows:
        return False

    rows_by_page: dict[int, list[tuple]] = {}
    for row in rows:
        rows_by_page.setdefault(int(row[0]), []).append(row)
    for page_number, page_rows in rows_by_page.items():
        words = [
            OcrWord(
                str(row[2] or ""),
                float(row[3]),
                float(row[4]),
                float(row[5]),
                float(row[6]),
                float(row[7]),
            )
            for row in page_rows
        ]
        corrected = _correct_ocr_page_words(words, 1.0, 1.0)
        updates = [
            (word.text, normalized, page_number, int(row[1]))
            for row, word in zip(page_rows, corrected)
            if word.text != str(row[2] or "")
        ]
        if updates:
            connection.executemany(
                "UPDATE pdf_ocr_words SET text = ? "
                "WHERE path = ? AND page = ? AND word_index = ?",
                updates,
            )
            connection.execute(
                "UPDATE pdf_ocr_pages SET text = ? WHERE path = ? AND page = ?",
                (_page_text(corrected), normalized, page_number),
            )
    connection.execute(
        "UPDATE pdf_ocr_documents SET word_index_version = ?, updated_at = CURRENT_TIMESTAMP "
        "WHERE path = ?",
        (OCR_WORD_INDEX_VERSION, normalized),
    )
    connection.commit()
    return True


def _analysis_config_hashes(language: str, model_variant: str) -> set[str]:
    config = pdf_structure.structure_modules_config(language, model_variant)
    hashes = {_analysis_metadata.compute_config_hash(config)}
    formula = config.get("formula")
    if isinstance(formula, dict) and not formula.get("enabled"):
        # Older config hashing recorded the formula module as enabled whenever
        # the main structure model existed, even if no formula model was installed.
        legacy = {**config, "formula": {**formula, "enabled": True}}
        hashes.add(_analysis_metadata.compute_config_hash(legacy))
    return hashes


def pdf_ocr_status(
    path: str, *, rebuild_native_index: bool = True, outline_state_dir: str = "",
) -> dict:
    normalized = os.path.abspath(str(path or ""))
    if not os.path.isfile(normalized):
        raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")
    from pdf.pdf_refinement_recovery import recover
    with _lock_for_pdf(normalized):
        from pdf.pdf_ocr_index_recovery import recover as recover_ocr
        recover_ocr(normalized)
        recover(normalized)
    from pdf.pdf_password import open_pdf_reader as PdfReader

    status_fingerprint = _fingerprint(normalized)
    reader = PdfReader(normalized)
    metadata = reader.metadata or {}
    embedded_version = str(metadata.get(OCR_METADATA_KEY, "") or "").strip()
    # The marker identifies an AILS-generated OCR text layer. Its value is a
    # pipeline version, so older releases (for example v1/server OCR) must still
    # be treated as embedded OCR. Comparing it only with the current version
    # caused upgrades to reinterpret the hidden layer as native PDF text and
    # overwrite the precise PaddleOCR index with duplicated synthetic boxes.
    embedded = bool(embedded_version)
    # The automatic prompt is only for image-only PDFs. A mixed document with
    # even one genuine text page must not be treated as completely textless.
    has_text = _active_reader_has_text_layer(reader, minimum_ratio=0.0)
    from documents.presentation_processing_policy import is_presentation_pdf
    presentation_pdf = is_presentation_pdf(normalized)
    ocr_page_indexes = None
    if presentation_pdf:
        # Even a one-character title is a native text slide.
        ocr_page_indexes = pdf_pages_missing_text_layer(normalized, minimum_characters=1, reader=reader)
        has_text = len(ocr_page_indexes) < len(reader.pages)
    indexed = False
    index_source = ""
    index_repair_required = False
    outline = []
    outline_version = 0
    try:
        with closing(_connect()) as connection:
            row = connection.execute(
                "SELECT fingerprint, outline_json, outline_version, page_count, word_index_version, "
                "content_digest, index_source "
                "FROM pdf_ocr_documents WHERE path = ?",
                (normalized,),
            ).fetchone()
            if row:
                stored_fingerprint = str(row[0] or "")
                stored_digest = str(row[5] or "")
                index_source = str(row[6] or "")
                if not index_source:
                    confidence_row = connection.execute(
                        "SELECT COUNT(*), MIN(confidence), MAX(confidence) "
                        "FROM pdf_ocr_words WHERE path = ?",
                        (normalized,),
                    ).fetchone()
                    word_count = int(confidence_row[0] or 0) if confidence_row else 0
                    all_confidence_one = bool(
                        word_count
                        and float(confidence_row[1] or 0) >= 0.999999
                        and float(confidence_row[2] or 0) >= 0.999999
                    )
                    if embedded:
                        # Old releases could recreate a missing PaddleOCR index
                        # from every hidden/native PDF text layer. Those synthetic
                        # rows all have confidence 1.0 and duplicate fragmented
                        # glyphs, so they must never be accepted as OCR results.
                        index_source = (
                            "native_text"
                            if all_confidence_one
                            else ("paddleocr" if word_count else "")
                        )
                    elif word_count:
                        index_source = "native_text"
                    if index_source:
                        if index_source == "paddleocr" and not stored_digest:
                            stored_digest = _content_digest(normalized)
                        connection.execute(
                            "UPDATE pdf_ocr_documents "
                            "SET content_digest = ?, index_source = ? WHERE path = ?",
                            (stored_digest, index_source, normalized),
                        )
                        connection.commit()

                fingerprint_matches = stored_fingerprint == _fingerprint(normalized)
                if not fingerprint_matches and stored_digest:
                    if _content_digest(normalized) == stored_digest:
                        stored_fingerprint = _fingerprint(normalized)
                        connection.execute(
                            "UPDATE pdf_ocr_documents "
                            "SET fingerprint = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?",
                            (stored_fingerprint, normalized),
                        )
                        connection.commit()
                        fingerprint_matches = True
                word_index_version = int(row[4] or 0)
                if (
                    fingerprint_matches
                    and index_source != "native_text"
                    and word_index_version < OCR_WORD_INDEX_VERSION
                    and _upgrade_word_index_from_rows(connection, normalized)
                ):
                    word_index_version = OCR_WORD_INDEX_VERSION
                indexed = (
                    fingerprint_matches
                    and word_index_version >= required_word_index_version(index_source, OCR_WORD_INDEX_VERSION)
                    and not (embedded and index_source == "native_text")
                )
                index_repair_required = bool(
                    embedded
                    and (
                        index_source != "paddleocr"
                        or not fingerprint_matches
                        or word_index_version < OCR_WORD_INDEX_VERSION
                    )
                )
                outline = json.loads(row[1] or "[]")
                outline_version = int(row[2] or 0)
                # Cached words lack the extra TOC crop pass. Keep an existing
                # generated PDF and its DB outline in sync until the next OCR.
                if (
                    indexed
                    and outline_version != OUTLINE_INDEX_VERSION
                    and str(metadata.get(OCR_OUTLINE_SOURCE_KEY, "") or "").strip().lower() != "generated"
                ):
                    refreshed = _refresh_outline_from_index(
                        connection,
                        normalized,
                        max(0, int(row[3] or 0)),
                    )
                    if refreshed is not None:
                        outline = refreshed
                        outline_version = OUTLINE_INDEX_VERSION
    except Exception:
        pass
    if rebuild_native_index and has_text and not indexed and not embedded:
        try:
            _active_rebuild_index_from_embedded(normalized, str(metadata.get(OCR_LANGUAGE_KEY, DEFAULT_LANGUAGE)))
            indexed = True
            index_source = "native_text"
            with closing(_connect()) as connection:
                row = connection.execute("SELECT outline_json FROM pdf_ocr_documents WHERE path = ?", (normalized,)).fetchone()
                outline = json.loads(row[0] or "[]") if row else []
                outline_version = OUTLINE_INDEX_VERSION
        except Exception:
            indexed = False
    if embedded and not indexed:
        index_repair_required = True
    if outline_state_dir and indexed:
        try:
            outline = _versioned_outline(
                normalized, outline_state_dir, len(reader.pages),
                outline, _native_outline_for_reader(reader), embedded,
            )
        except Exception:
            _logger.exception("Failed to refresh PDF outline sidecar: %s", normalized)
    raw_model_variant = str(metadata.get(OCR_MODEL_KEY, DEFAULT_OCR_MODEL_VARIANT))
    try:
        model_variant = _normalize_ocr_model_variant(raw_model_variant)
    except ValueError:
        model_variant = DEFAULT_OCR_MODEL_VARIANT

    analysis_status = None
    try:
        # Header-only read: pdf_ocr_status runs on every viewer poll and must
        # not decompress the embedded analysis payload.
        header = _analysis_metadata.read_analysis_header(normalized)
        if header:
            analysis_language = str(metadata.get(OCR_LANGUAGE_KEY, DEFAULT_LANGUAGE))
            try:
                current_hashes = _analysis_config_hashes(analysis_language, raw_model_variant)
            except Exception:
                current_hashes = set()
            stored_hash = str(header.get("config_hash", "") or "")
            analysis_status = {
                "pipeline": str(header.get("pipeline", "") or pdf_structure.ANALYSIS_PIPELINE),
                "schema_version": header.get("schema_version"),
                "config_hash": stored_hash,
                "config_stale": bool(stored_hash and current_hashes and stored_hash not in current_hashes),
                "created_at": header.get("created_at"),
                "models": header.get("models") or {},
                "payload_available": bool(header.get("payload_bytes")),
                "corrupt": False,
            }
    except Exception:
        analysis_status = None

    stale_ocr = bool(
        embedded
        and (
            embedded_version != OCR_VERSION
            or not analysis_status
            or analysis_status.get("pipeline") != pdf_structure.ANALYSIS_PIPELINE
            or bool(analysis_status.get("config_stale"))
        )
    )
    needs_ocr = not has_text or stale_ocr
    if presentation_pdf:
        # Other slides' text and stale document-wide metadata do not opt native
        # slide text into OCR. An already OCRed slide now has its own text layer.
        needs_ocr = bool(ocr_page_indexes)

    status = {
        "path": normalized,
        "page_count": len(reader.pages),
        "has_text": has_text,
        "needs_ocr": needs_ocr,
        "ocr_allowed": not presentation_pdf or bool(ocr_page_indexes),
        "ocr_scope": "textless_slides" if presentation_pdf else "all_pages",
        "ocr_page_indexes": ocr_page_indexes,
        "ocr_stale": stale_ocr,
        "ocr_embedded": embedded,
        "ocr_embedded_version": embedded_version,
        "indexed": indexed,
        "index_source": index_source,
        "index_repair_required": index_repair_required,
        "language": str(metadata.get(OCR_LANGUAGE_KEY, DEFAULT_LANGUAGE)),
        "engine": str(metadata.get(OCR_ENGINE_KEY, "")),
        "model_variant": model_variant,
        "model_variant_raw": raw_model_variant,
        "detection_model": str(metadata.get(OCR_DETECTION_MODEL_KEY, "")),
        "recognition_model": str(metadata.get(OCR_RECOGNITION_MODEL_KEY, "")),
        "preset_version": str(metadata.get(OCR_PRESET_VERSION_KEY, "")),
        "outline": outline,
        "outline_version": outline_version if indexed else 0,
        "pipeline": (
            (analysis_status or {}).get("pipeline")
            if analysis_status
            else ("paddleocr-legacy" if embedded else "")
        ),
        "analysis": analysis_status,
        "grammar_refinement": _analysis_metadata._header_from_value(metadata.get("/AILSGrammarRefinement")),
    }
    from pdf.pdf_live_search import remember_validated_index
    remember_validated_index(normalized, status, status_fingerprint)
    return status


def is_path_ocr_excluded(path: str, excluded_paths: Any) -> bool:
    """주어진 경로가 OCR 제외 목록(파일 또는 상위 폴더)에 속하는지 판별한다."""
    norm = os.path.abspath(str(path or ""))
    for excluded in (excluded_paths or ()):
        excluded_norm = os.path.abspath(str(excluded or ""))
        if not excluded_norm:
            continue
        if norm == excluded_norm:
            return True
        try:
            if os.path.commonpath([excluded_norm, norm]) == excluded_norm:
                return True
        except ValueError:
            continue
    return False


def inspect_pdf_ocr_folder(
    folder_path: str,
    *,
    excluded_paths: Any = None,
) -> dict:
    """Classify PDFs recursively; any existing text layer or exclusion excludes OCR."""
    folder = os.path.abspath(str(folder_path or ""))
    if not os.path.isdir(folder):
        raise FileNotFoundError("강의자료 폴더를 찾을 수 없습니다.")

    root = os.path.realpath(folder)
    pdf_paths: list[str] = []
    from system_storage import visible_data_folder
    for current_root, dir_names, file_names in os.walk(folder):
        dir_names[:] = [
            name for name in dir_names
            if visible_data_folder(os.path.join(current_root, name))
        ]
        for file_name in file_names:
            if os.path.splitext(file_name)[1].lower() != ".pdf":
                continue
            candidate = os.path.abspath(os.path.join(current_root, file_name))
            try:
                if os.path.commonpath([os.path.realpath(candidate), root]) != root:
                    continue
            except ValueError:
                continue
            pdf_paths.append(candidate)

    targets: list[dict] = []
    skipped_text: list[dict] = []
    skipped_excluded: list[dict] = []
    unreadable: list[dict] = []
    excluded_list = list(excluded_paths or ())
    for pdf_path in sorted(pdf_paths, key=lambda value: value.lower()):
        if is_path_ocr_excluded(pdf_path, excluded_list):
            skipped_excluded.append({
                "path": pdf_path,
                "name": os.path.basename(pdf_path),
                "reason": "OCR 제외 설정됨",
            })
            continue
        try:
            import sys
            mod = sys.modules.get('pdf.pdf_ocr')
            status_fn = getattr(mod, "pdf_ocr_status", pdf_ocr_status) if mod is not None else pdf_ocr_status
            status = status_fn(pdf_path)
            item = {
                "path": pdf_path,
                "name": os.path.basename(pdf_path),
                "page_count": int(status.get("page_count") or 0),
            }
            needs_ocr = status.get("needs_ocr") if "needs_ocr" in status else not status.get("has_text")
            if needs_ocr:
                targets.append(item)
            else:
                skipped_text.append(item)
        except Exception as error:
            unreadable.append({
                "path": pdf_path,
                "name": os.path.basename(pdf_path),
                "error": str(error),
            })

    return {
        "folder_path": folder,
        "pdf_count": len(pdf_paths),
        "ocr_count": len(targets),
        "skipped_text_count": len(skipped_text),
        "skipped_excluded_count": len(skipped_excluded),
        "unreadable_count": len(unreadable),
        "targets": targets,
        "skipped_text": skipped_text,
        "skipped_excluded": skipped_excluded,
        "unreadable": unreadable,
    }


def _rebuild_index_from_embedded(path: str, language: str):
    from pdf.pdf_password import open_pdf_reader as PdfReader

    document = PdfReader(path)
    try:
        pages, page_sizes = native_text_pages(path, document)
        _store_native_text_index(path, language, document, pages, page_sizes)
    finally:
        stream = getattr(document, "stream", None)
        if stream is not None:
            stream.close()


def _store_native_text_index(path, language, document, pages, page_sizes):
    parsed_outline = _outline_for_pages(pages, page_sizes)
    metadata = document.metadata or {}
    outline = _choose_pdf_outline(
        _native_outline_for_reader(document),
        parsed_outline,
        is_ails_ocr=bool(metadata.get(OCR_METADATA_KEY)),
        source_hint=str(metadata.get(OCR_OUTLINE_SOURCE_KEY, "") or "").strip().lower(),
    )
    _store_index(
        path,
        pages,
        language,
        outline,
        page_sizes=page_sizes,
        index_source="native_text",
    )
    from pdf.pdf_grammar_refinement_native import apply_embedded_native_refinement
    from pdf.pdf_grammar_refinement_index import apply_embedded_ocr_refinement
    with closing(_connect()) as connection, connection:
        apply_embedded_native_refinement(path, connection)
        apply_embedded_ocr_refinement(path, connection)



def _page_text(words: list[OcrWord]) -> str:
    from pdf.index_word_order import page_word_lines
    return "\n".join(" ".join(item.text for item in line) for line in page_word_lines(words))


def _reconstruct_indexed_region_text(rows) -> str:
    """Rebuild selected OCR words with line breaks and approximate indentation."""
    words = [
        {
            "text": str(row[0]),
            "left": float(row[1]),
            "top": float(row[2]),
            "right": float(row[3]),
            "bottom": float(row[4]),
        }
        for row in rows
        if str(row[0]).strip()
    ]
    if not words:
        return ""

    median_height = max(1e-6, statistics.median(word["bottom"] - word["top"] for word in words))
    lines: list[list[dict]] = []
    for word in sorted(words, key=lambda item: (item["top"], item["left"])):
        center = (word["top"] + word["bottom"]) / 2
        if not lines:
            lines.append([word])
            continue
        last_center = statistics.mean(
            (item["top"] + item["bottom"]) / 2 for item in lines[-1]
        )
        if abs(center - last_center) > median_height * 0.65:
            lines.append([word])
        else:
            lines[-1].append(word)

    char_widths = [
        (word["right"] - word["left"]) / max(1, len(word["text"]))
        for word in words
        if word["right"] > word["left"]
    ]
    char_width = max(1e-6, statistics.median(char_widths or [median_height]))
    base_left = min(word["left"] for word in words)
    output = []
    for line in lines:
        ordered = sorted(line, key=lambda item: item["left"])
        pieces = [" " * max(0, round((ordered[0]["left"] - base_left) / char_width))]
        pieces.append(ordered[0]["text"])
        previous = ordered[0]
        for word in ordered[1:]:
            gap = word["left"] - previous["right"]
            pieces.append(" " * max(1, round(gap / char_width)))
            pieces.append(word["text"])
            previous = word
        output.append("".join(pieces).rstrip())
    return "\n".join(output)


from pdf.pdf_analysis_roles import (
    OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION,
    _RotatedTextRun,
    _analysis_page_size,
    _analysis_quantile,
    _detached_rotated_text_runs,
    _pages_for_structural_analysis,
    _repeated_rotated_decoration_word_indexes,
    mark_indexed_pdf_analysis_roles,
)



# Compatibility handles kept here because existing OCR callers and tests import
# these private names from pdf_ocr. The parser itself lives in pdf_outline.py.
def _native_outline_for_reader(reader) -> list[dict]:
    return _read_native_pdf_outline(reader)


def _toc_chapter_number(title: str) -> int | None:
    return _pdf_outline_chapter_number(title)


def _toc_chapter_title(line: str) -> str | None:
    return _pdf_outline_chapter_title(line)


def _toc_entry_for_line(line: str, page_count: int) -> tuple[str, int] | None:
    return _pdf_outline_entry_for_line(line, page_count)


def _toc_entries_for_words(words: list[OcrWord], page_count: int) -> list[tuple[str, int]]:
    entries = []
    for line in _page_text(words).splitlines():
        entry = _pdf_outline_entry_for_line(line, page_count)
        if entry is not None:
            entries.append(entry)
    return entries


def _outline_for_pages(
    pages: list[list[OcrWord]],
    page_sizes: list[tuple[float, float]] | None = None,
    analyses: list[dict] | None = None,
) -> list[dict]:
    structural_pages = _pages_for_structural_analysis(pages, page_sizes)
    for page_index, analysis in enumerate(analyses or []):
        if not analysis:
            continue
        extra = analysis.get("outline_words") or []
        if not extra or page_index >= len(structural_pages):
            continue
        crop_bottom = float(analysis["outline_crop_bottom"])
        first_extra_top = min(float(word["bbox"][1]) for word in extra)
        structural_pages[page_index] = [
            word for word in structural_pages[page_index]
            if (word.top + word.bottom) / 2 < first_extra_top
            or (word.top + word.bottom) / 2 >= crop_bottom
        ] + [
            OcrWord(
                text=str(word["text"]),
                left=float(word["bbox"][0]),
                top=float(word["bbox"][1]),
                right=float(word["bbox"][2]),
                bottom=float(word["bbox"][3]),
                confidence=float(word["confidence"]),
            )
            for word in extra
        ]
    return _build_pdf_outline(structural_pages, page_sizes)


def _parsed_outline_from_index(
    connection: sqlite3.Connection,
    normalized_path: str,
    page_count: int,
) -> list[dict] | None:
    page_rows = connection.execute(
        "SELECT page FROM pdf_ocr_pages WHERE path = ? ORDER BY CAST(page AS INTEGER)",
        (normalized_path,),
    ).fetchall()
    if not page_rows:
        return None

    indexed_page_count = max((int(row[0]) for row in page_rows), default=0)
    pages: list[list[OcrWord]] = [[] for _ in range(max(page_count, indexed_page_count))]
    word_rows = connection.execute(
        "SELECT page, text, left, top, right, bottom, confidence "
        "FROM pdf_ocr_words WHERE path = ? "
        "ORDER BY CAST(page AS INTEGER), word_index",
        (normalized_path,),
    ).fetchall()
    for row in word_rows:
        page_number = int(row[0])
        if not 1 <= page_number <= len(pages):
            continue
        pages[page_number - 1].append(OcrWord(
            text=str(row[1] or ""),
            left=float(row[2]) * 1000.0,
            top=float(row[3]) * 1000.0,
            right=float(row[4]) * 1000.0,
            bottom=float(row[5]) * 1000.0,
            confidence=float(row[6]),
        ))
    return _outline_for_pages(pages, [(1000.0, 1000.0) for _page in pages])


def _outline_state_path(path: str, state_dir: str) -> str:
    key = hashlib.sha256(os.path.normcase(os.path.abspath(path)).encode("utf-8")).hexdigest()
    return os.path.join(state_dir, "pdf-outlines", f"{key}.json")


def _versioned_outline(
    path: str, state_dir: str, page_count: int, fallback: list[dict],
    native: list[dict], embedded: bool,
) -> list[dict]:
    state_path = _outline_state_path(path, state_dir)
    fingerprint = _fingerprint(path)
    with _lock_for_pdf(path):
        try:
            with open(state_path, encoding="utf-8") as handle:
                saved = json.load(handle)
            if (isinstance(saved, dict)
                    and saved.get("version") == BOOKMARK_VERSION
                    and saved.get("fingerprint") == fingerprint
                    and isinstance(saved.get("outline"), list)):
                return saved["outline"]
        except (FileNotFoundError, ValueError, TypeError, OSError):
            pass
        with closing(_connect()) as connection:
            parsed = _parsed_outline_from_index(connection, path, page_count)
        outline = _choose_app_pdf_outline(native, parsed or fallback, page_count, is_ails_ocr=embedded)
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        temporary = ""
        try:
            fd, temporary = tempfile.mkstemp(prefix=".outline-", suffix=".tmp", dir=os.path.dirname(state_path))
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"version": BOOKMARK_VERSION, "fingerprint": fingerprint, "outline": outline}, handle, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, state_path)
        finally:
            if temporary and os.path.exists(temporary):
                os.remove(temporary)
        return outline


def _refresh_outline_from_index(
    connection: sqlite3.Connection,
    normalized_path: str,
    page_count: int,
) -> list[dict] | None:
    """Rebuild an obsolete outline using persisted words, without running OCR."""
    from pdf.pdf_password import open_pdf_reader as PdfReader

    reader = PdfReader(normalized_path)
    try:
        metadata = dict(reader.metadata or {})
        native_outline = _native_outline_for_reader(reader)
    finally:
        reader_stream = getattr(reader, "stream", None)
        if reader_stream is not None and hasattr(reader_stream, "close"):
            reader_stream.close()

    parsed_outline = _parsed_outline_from_index(connection, normalized_path, page_count)
    if parsed_outline is None:
        return None
    outline = _choose_pdf_outline(
        native_outline,
        parsed_outline,
        is_ails_ocr=bool(metadata.get(OCR_METADATA_KEY)),
        source_hint=str(metadata.get(OCR_OUTLINE_SOURCE_KEY, "") or "").strip().lower(),
    )
    connection.execute(
        "UPDATE pdf_ocr_documents "
        "SET outline_json = ?, outline_version = ?, updated_at = CURRENT_TIMESTAMP "
        "WHERE path = ?",
        (
            json.dumps(outline, ensure_ascii=False),
            OUTLINE_INDEX_VERSION,
            normalized_path,
        ),
    )
    connection.commit()
    return outline



def _store_index(
    path: str,
    pages: list[list[OcrWord]],
    language: str,
    outline: list[dict],
    page_sizes: list[tuple[float, float]] | None = None,
    *,
    index_source: str = "paddleocr",
    content_digest: str | None = None,
    analyses: list[dict] | None = None,
    native_page_texts: dict[int, str] | None = None,
    commit_guard: Callable[[sqlite3.Connection], None] | None = None,
    commit_receipt: Callable[[sqlite3.Connection], None] | None = None,
):
    normalized = os.path.abspath(path)
    digest = str(content_digest or _content_digest(normalized))
    with closing(_connect()) as connection:
        if commit_guard is not None:
            connection.execute("BEGIN IMMEDIATE")
            commit_guard(connection)
        connection.execute("DELETE FROM pdf_ocr_pages WHERE path = ?", (normalized,))
        connection.execute("DELETE FROM pdf_ocr_words WHERE path = ?", (normalized,))
        connection.execute("DELETE FROM pdf_ocr_blocks WHERE path = ?", (normalized,))
        for page_number, words in enumerate(pages, start=1):
            page_width, page_height = page_sizes[page_number - 1] if page_sizes and page_number <= len(page_sizes) else (1.0, 1.0)
            analysis = analyses[page_number - 1] if analyses and page_number <= len(analyses) else None
            word_block_ids: list[int | None] = [None] * len(words)
            if analysis:
                analysis_words = analysis.get("words") or []
                for word_index, analysis_word in enumerate(analysis_words):
                    if word_index < len(word_block_ids):
                        word_block_ids[word_index] = analysis_word.get("block_id")
            native_text = (native_page_texts or {}).get(page_number, "")
            if native_text:
                # 선택적 OCR에서 원본 텍스트를 유지한 슬라이드의 색인 텍스트.
                page_text = native_text
            else:
                page_text = (
                    pdf_structure.reading_order_text(analysis, words)
                    if analysis
                    else _page_text(words)
                )
            connection.execute("INSERT INTO pdf_ocr_pages(path, page, text) VALUES (?, ?, ?)", (normalized, page_number, page_text))
            connection.executemany(
                "INSERT INTO pdf_ocr_words(path, page, word_index, text, left, top, right, bottom, confidence, block_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [(
                    normalized,
                    page_number,
                    index,
                    word.text,
                    word.left / max(page_width, 1.0),
                    word.top / max(page_height, 1.0),
                    word.right / max(page_width, 1.0),
                    word.bottom / max(page_height, 1.0),
                    word.confidence,
                    word_block_ids[index] if index < len(word_block_ids) else None,
                ) for index, word in enumerate(words)],
            )
            if analysis:
                block_rows = pdf_structure.normalized_blocks(analysis, page_width, page_height)
                connection.executemany(
                    "INSERT INTO pdf_ocr_blocks(path, page, block_id, type, left, top, right, bottom, "
                    "reading_order, confidence, text_source, text, table_json, formula_json, spacing_json) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [(
                        normalized,
                        page_number,
                        block["block_id"],
                        block["type"],
                        block["normalized_bbox"][0],
                        block["normalized_bbox"][1],
                        block["normalized_bbox"][2],
                        block["normalized_bbox"][3],
                        block["reading_order"],
                        block["confidence"],
                        block["text_source"],
                        block["text"],
                        json.dumps(block.get("table") or {}, ensure_ascii=False),
                        json.dumps(block.get("formula") or {}, ensure_ascii=False),
                        json.dumps(block.get("spacing") or {}, ensure_ascii=False),
                    ) for block in block_rows],
                )
        connection.execute(
            "INSERT OR REPLACE INTO pdf_ocr_documents("
            "path, fingerprint, language, engine, page_count, outline_json, outline_version, "
            "word_index_version, content_digest, index_source, updated_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            (
                normalized,
                _fingerprint(normalized),
                language,
                "PaddleOCR ONNX / Windows ML",
                len(pages),
                json.dumps(outline, ensure_ascii=False),
                OUTLINE_INDEX_VERSION,
                required_word_index_version(index_source, OCR_WORD_INDEX_VERSION),
                digest,
                str(index_source or ""),
            ),
        )
        if commit_receipt is not None:
            commit_receipt(connection)
        connection.commit()



def search_pdf(path: str, query: str, limit: int = 50) -> dict:
    normalized = os.path.abspath(path)
    value = str(query or "").strip()
    if not value:
        return {"query": value, "results": []}
    from pdf.pdf_live_search import search_index
    from documents.answer_key_visibility import hidden, redact_page
    if hidden(normalized):
        results = []
        for page in indexed_pdf_pages(normalized):
            visible = redact_page(normalized, page)
            position = visible["text"].casefold().find(value.casefold())
            if position >= 0:
                results.append({"page": page["page"], "snippet": visible["text"][max(0, position - 60):position + len(value) + 100]})
        return {"query": value, "results": results[:max(1, min(int(limit), 200))]}
    return {"query": value, "results": search_index(normalized, value, limit)}


def search_materials(root: str, query: str, limit: int = 40) -> dict:
    """Compatibility entry point for workspace title/body keyword search."""
    from documents.material_keyword_search import search_materials as keyword_search
    from pdf.pdf_keyword_source import indexed_pdf_text
    return keyword_search(root, query, limit=limit, pdf_reader=indexed_pdf_text)


def _indexed_block_bbox(values, words: list[dict], block_id: int) -> dict:
    """Recover old pixel-space block rows from their normalized OCR words.

    Reading a legacy index never rewrites it or combines it with native text.
    Empty/corrupt boxes are marked unavailable instead of becoming a false
    (1,1,1,1) rectangle through clamping.
    """
    import math

    try:
        bbox = [float(value) for value in values]
    except (TypeError, ValueError):
        bbox = [float("nan")] * 4
    source = "layout"
    if (not all(math.isfinite(v) and 0 <= v <= 1 for v in bbox)
            or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]):
        assigned = [w for w in words if w.get("block_id") == block_id]
        if not assigned:
            return dict(left=0., top=0., right=0., bottom=0., bbox_source="unavailable")
        bbox = [min(w["left"] for w in assigned), min(w["top"] for w in assigned),
                max(w["right"] for w in assigned), max(w["bottom"] for w in assigned)]
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in bbox) or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
            return dict(left=0., top=0., right=0., bottom=0., bbox_source="unavailable")
        source = "legacy_words"
    return dict(zip(("left", "top", "right", "bottom"), bbox), bbox_source=source)


def indexed_pdf_pages(path: str, status: dict | None = None) -> list[dict]:
    """Return page text and normalized word boxes from the persisted OCR index.

    Native-text PDFs are indexed on demand using PDFium glyph bounds. Coordinates are kept in
    the same 0..1 space used by ``region_text`` so viewer overlays do not depend on
    the render resolution that was selected for OCR.
    """
    normalized = os.path.abspath(str(path or ""))
    status = dict(status) if isinstance(status, dict) else pdf_ocr_status(normalized)
    if not status.get("has_text"):
        raise ValueError("PDF 전체 OCR을 먼저 실행해 주세요.")
    if not status.get("indexed"):
        if status.get("ocr_embedded"):
            raise ValueError(
                "저장된 PaddleOCR 인덱스가 없거나 손상되었습니다. "
                "PDF 전체 OCR을 다시 실행해 주세요."
            )
        _rebuild_index_from_embedded(
            normalized,
            status.get("language") or DEFAULT_LANGUAGE,
        )
        status = pdf_ocr_status(normalized)
        if not status.get("indexed"):
            raise ValueError("PDF 텍스트 인덱스를 만들 수 없습니다.")

    def load_rows():
        with closing(_connect()) as connection:
            page_rows = connection.execute(
                "SELECT page, text FROM pdf_ocr_pages WHERE path = ? ORDER BY CAST(page AS INTEGER)",
                (normalized,),
            ).fetchall()
            word_rows = connection.execute(
                "SELECT page, word_index, text, left, top, right, bottom, confidence, block_id "
                "FROM pdf_ocr_words WHERE path = ? ORDER BY CAST(page AS INTEGER), word_index",
                (normalized,),
            ).fetchall()
            block_rows = connection.execute(
                "SELECT page, block_id, type, left, top, right, bottom, reading_order, confidence, "
                "text_source, text, spacing_json FROM pdf_ocr_blocks WHERE path = ? "
                "ORDER BY CAST(page AS INTEGER), CAST(reading_order AS INTEGER)",
                (normalized,),
            ).fetchall()
        return page_rows, word_rows, block_rows

    page_rows, word_rows, block_rows = load_rows()
    if not page_rows:
        if status.get("ocr_embedded"):
            raise ValueError(
                "저장된 PaddleOCR 인덱스가 비어 있습니다. "
                "PDF 전체 OCR을 다시 실행해 주세요."
            )
        _rebuild_index_from_embedded(
            normalized,
            status.get("language") or DEFAULT_LANGUAGE,
        )
        page_rows, word_rows, block_rows = load_rows()

    words_by_page: dict[int, list[dict]] = {}
    for row in word_rows:
        page_number = int(row[0])
        words_by_page.setdefault(page_number, []).append({
            "index": int(row[1]),
            "text": str(row[2] or ""),
            "left": max(0.0, min(float(row[3]), 1.0)),
            "top": max(0.0, min(float(row[4]), 1.0)),
            "right": max(0.0, min(float(row[5]), 1.0)),
            "bottom": max(0.0, min(float(row[6]), 1.0)),
            "confidence": max(0.0, min(float(row[7]), 1.0)),
            **({"block_id": int(row[8])} if row[8] is not None else {}),
        })

    blocks_by_page: dict[int, list[dict]] = {}
    for row in block_rows:
        page_number = int(row[0])
        blocks_by_page.setdefault(page_number, []).append({
            "block_id": int(row[1]),
            "type": str(row[2] or ""),
            **_indexed_block_bbox(row[3:7], words_by_page.get(page_number, []), int(row[1])),
            "reading_order": int(row[7]) if row[7] is not None else None,
            "confidence": float(row[8]) if row[8] is not None else None,
            "text_source": str(row[9] or "ocr"),
            "text": str(row[10] or ""),
            "spacing": json.loads(row[11] or "{}"),
        })

    page_text = {int(row[0]): str(row[1] or "") for row in page_rows}
    page_count = max(int(status.get("page_count") or 0), max(page_text, default=0))
    return [
        {
            "page": page_number,
            "text": page_text.get(page_number, ""),
            "words": words_by_page.get(page_number, []),
            "blocks": blocks_by_page.get(page_number, []),
        }
        for page_number in range(1, page_count + 1)
    ]


def indexed_pdf_search_pages(requests: list[tuple[str, int]]) -> dict[tuple[str, int], dict]:
    """Read only the current page text/outline for a search snippet.

    Search never opens a PDF or rebuilds OCR data. A stale/missing index is left
    for the normal document indexing pipeline.
    """
    requested = {(os.path.abspath(path), int(page)) for path, page in requests}
    paths = {path for path, _page in requested if os.path.isfile(path)}
    if not paths:
        return {}
    database = Path(_database_path())
    if not database.is_file():
        return {}
    # Snippet reads need neither schema migrations nor a writer lock while OCR
    # is updating the same WAL database.
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1)) as connection:
        documents = connection.execute(
            "SELECT path, fingerprint, outline_json, word_index_version, index_source "
            f"FROM pdf_ocr_documents WHERE path IN ({','.join('?' for _ in paths)})", list(paths),
        ).fetchall()
        outlines = {}
        for path, fingerprint, outline, version, source in documents:
            try:
                if fingerprint == _fingerprint(path) and int(version or 0) >= required_word_index_version(source, OCR_WORD_INDEX_VERSION) and source:
                    outlines[path] = json.loads(outline or "[]")
            except (OSError, ValueError):
                continue
        pairs = [(path, page) for path, page in requested if path in outlines]
        if not pairs:
            return {}
        # FTS5 path/page are UNINDEXED. One batched scan avoids repeating a full
        # virtual-table scan for every candidate page.
        rows = connection.execute(
            "SELECT path, page, text FROM pdf_ocr_pages WHERE (path, page) IN ("
            + ','.join('(?, ?)' for _ in pairs) + ')',
            [value for pair in pairs for value in pair],
        ).fetchall()
        from pdf.pdf_search_visibility import visible_index_text, visible_outline
        visible_rows = [(path, page, visible_index_text(connection, path, page, text)) for path, page, text in rows]
        outlines = {path: visible_outline(path, outline) for path, outline in outlines.items()}
    return {
        (path, int(page)): {"page": int(page), "text": str(text or ""), "outline": outlines[path]}
        for path, page, text in visible_rows
    }


def indexed_pdf_page(path: str, page: int) -> dict:
    """Return one page's OCR text and normalized word boxes for the viewer."""
    normalized = os.path.abspath(str(path or ""))
    if not os.path.isfile(normalized):
        raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")
    page_number = max(1, int(page))

    def load_rows():
        with closing(_connect()) as connection:
            document_row = connection.execute(
                "SELECT fingerprint, language, page_count, word_index_version, index_source "
                "FROM pdf_ocr_documents WHERE path = ?",
                (normalized,),
            ).fetchone()
            page_row = connection.execute(
                "SELECT text FROM pdf_ocr_pages WHERE path = ? AND page = ?",
                (normalized, page_number),
            ).fetchone()
            word_rows = connection.execute(
                "SELECT word_index, text, left, top, right, bottom, confidence, block_id "
                "FROM pdf_ocr_words WHERE path = ? AND page = ? ORDER BY word_index",
                (normalized, page_number),
            ).fetchall()
            block_rows = connection.execute(
                "SELECT block_id, type, left, top, right, bottom, reading_order, confidence, "
                "text_source, text, spacing_json FROM pdf_ocr_blocks WHERE path = ? AND page = ? "
                "ORDER BY CAST(reading_order AS INTEGER)",
                (normalized, page_number),
            ).fetchall()
        return document_row, page_row, word_rows, block_rows

    document_row, page_row, word_rows, block_rows = load_rows()
    index_is_current = bool(
        document_row
        and str(document_row[0] or "") == _fingerprint(normalized)
        and int(document_row[3] or 0) >= required_word_index_version(str(document_row[4] or ""), OCR_WORD_INDEX_VERSION)
        and bool(str(document_row[4] or ""))
    )
    if index_is_current:
        page_count = max(0, int(document_row[2] or 0))
        if page_count and page_number > page_count:
            raise ValueError("PDF 페이지 범위를 벗어났습니다.")
    else:
        # Only a missing or stale index needs the expensive whole-document
        # inspection. Normal page changes remain a single SQLite lookup.
        status = pdf_ocr_status(normalized)
        if not status.get("has_text"):
            raise ValueError("PDF 전체 OCR을 먼저 실행해 주세요.")
        if not status.get("indexed"):
            if status.get("ocr_embedded"):
                raise ValueError(
                    "저장된 PaddleOCR 인덱스가 없거나 손상되었습니다. "
                    "PDF 전체 OCR을 다시 실행해 주세요."
                )
            raise ValueError("PDF 텍스트 인덱스를 만들 수 없습니다.")
        page_count = max(0, int(status.get("page_count") or 0))
        if page_count and page_number > page_count:
            raise ValueError("PDF 페이지 범위를 벗어났습니다.")
        document_row, page_row, word_rows, block_rows = load_rows()

    if page_row is None:
        status = pdf_ocr_status(normalized)
        if status.get("ocr_embedded"):
            raise ValueError(
                "저장된 PaddleOCR 페이지 인덱스가 비어 있습니다. "
                "PDF 전체 OCR을 다시 실행해 주세요."
            )
        language = str(document_row[1] or DEFAULT_LANGUAGE) if document_row else DEFAULT_LANGUAGE
        _rebuild_index_from_embedded(normalized, language)
        _document_row, page_row, word_rows, block_rows = load_rows()

    if page_row and page_row[0] and not word_rows and document_row and document_row[4] == "paddleocr":
        # Older selective OCR kept native slide strings but discarded their
        # boxes. Recover visible native glyphs only; hidden OCR remains intact.
        # Share OCR's document lock so a concurrent rewrite cannot mix versions.
        with _lock_for_pdf(normalized):
            document_row, page_row, word_rows, block_rows = load_rows()
            if (document_row and document_row[0] == _fingerprint(normalized)
                    and document_row[4] == "paddleocr" and not word_rows):
                native_words = visible_native_index_words(normalized, page_number)
                if native_words:
                    with closing(_connect()) as connection, connection:
                        connection.executemany(
                            "INSERT OR IGNORE INTO pdf_ocr_words(path, page, word_index, text, left, top, right, bottom, confidence) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            [(normalized, page_number, index, word.text, word.left, word.top, word.right, word.bottom, word.confidence)
                             for index, word in enumerate(native_words)],
                        )
                    document_row, page_row, word_rows, block_rows = load_rows()

    page_words = [{
            "index": int(row[0]),
            "text": str(row[1] or ""),
            "left": max(0.0, min(float(row[2]), 1.0)),
            "top": max(0.0, min(float(row[3]), 1.0)),
            "right": max(0.0, min(float(row[4]), 1.0)),
            "bottom": max(0.0, min(float(row[5]), 1.0)),
            "confidence": max(0.0, min(float(row[6]), 1.0)),
            **({"block_id": int(row[7])} if row[7] is not None else {}),
        } for row in word_rows]
    return {
        "page": page_number,
        "text": str(page_row[0] or "") if page_row else "",
        "words": page_words,
        "blocks": [{
            "block_id": int(row[0]),
            "type": str(row[1] or ""),
            **_indexed_block_bbox(row[2:6], page_words, int(row[0])),
            "reading_order": int(row[6]) if row[6] is not None else None,
            "confidence": float(row[7]) if row[7] is not None else None,
            "text_source": str(row[8] or "ocr"),
            "text": str(row[9] or ""),
            "spacing": json.loads(row[10] or "{}"),
        } for row in block_rows],
    }


def region_text(path: str, page: int, region: dict) -> dict:
    left = float(region.get("left", 0))
    top = float(region.get("top", 0))
    right = float(region.get("right", 0))
    bottom = float(region.get("bottom", 0))
    normalized = os.path.abspath(path)
    status = pdf_ocr_status(normalized)
    if not status.get("indexed"):
        if status.get("ocr_embedded"):
            raise ValueError(
                "저장된 PaddleOCR 인덱스가 없거나 손상되었습니다. "
                "PDF 전체 OCR을 다시 실행해 주세요."
            )
        raise ValueError("PDF 텍스트 인덱스를 만들 수 없습니다.")

    def load_rows():
        with closing(_connect()) as connection:
            return connection.execute(
                "SELECT text, left, top, right, bottom FROM pdf_ocr_words WHERE path = ? AND page = ? ORDER BY top, left",
                (normalized, max(1, int(page))),
            ).fetchall()

    rows = load_rows()
    if (
        not rows
        and not status.get("ocr_embedded")
        and pdf_has_text_layer(normalized, minimum_ratio=0.0)
    ):
        _rebuild_index_from_embedded(normalized, DEFAULT_LANGUAGE)
        rows = load_rows()
    if not rows:
        raise ValueError("저장된 OCR 텍스트가 없습니다. PDF 전체 OCR을 먼저 실행하세요.")
    from documents.answer_key_visibility import regions_for
    protected = regions_for(path, page)
    rows = [row for row in rows if not any(region.get("bbox") is None or (float(row[3]) > region["bbox"]["left"] and float(row[1]) < region["bbox"]["right"] and float(row[4]) > region["bbox"]["top"] and float(row[2]) < region["bbox"]["bottom"]) for region in protected)]
    selected = [
        row
        for row in rows
        if float(row[3]) >= left
        and float(row[1]) <= right
        and float(row[4]) >= top
        and float(row[2]) <= bottom
    ]
    return {
        "text": _reconstruct_indexed_region_text(selected),
        "page": max(1, int(page)),
        "engine": "embedded-ocr-index",
        "language": DEFAULT_LANGUAGE,
    }

# ---------------------------------------------------------------------------
# Re-exported benchmark and performance profiling symbols from pdf_ocr_benchmark
# ---------------------------------------------------------------------------
