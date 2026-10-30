"""Reuse a validated PDF index without reopening its PDF for every keystroke."""

from collections import OrderedDict
from contextlib import closing
from pathlib import Path
import sqlite3
from threading import Lock

_validated = OrderedDict()
_cache_lock = Lock()
_CACHE_LIMIT = 32


def _rows(connection, path, query, limit):
    phrase = '"' + query.replace('"', '""') + '"'
    rows = connection.execute(
        "SELECT page, snippet(pdf_ocr_pages, 2, '<mark>', '</mark>', ' … ', 18) "
        "FROM pdf_ocr_pages WHERE path = ? AND pdf_ocr_pages MATCH ? ORDER BY rank LIMIT ?",
        (path, phrase, max(1, min(int(limit), 200))),
    ).fetchall()
    return [{"page": int(row[0]), "snippet": row[1]} for row in rows]


def _signature(connection, path):
    return connection.execute(
        "SELECT fingerprint, index_source, word_index_version FROM pdf_ocr_documents WHERE path = ?",
        (path,),
    ).fetchone()


def _remember(key, signature):
    with _cache_lock:
        _validated[key] = signature
        _validated.move_to_end(key)
        while len(_validated) > _CACHE_LIMIT:
            _validated.popitem(last=False)


def remember_validated_index(path, status, fingerprint):
    """The viewer's normal status check also prepares its first live search."""
    if not status.get("indexed"):
        return
    from pdf import pdf_ocr_search as store
    database = Path(store._database_path()).resolve()
    try:
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1)) as connection:
            signature = _signature(connection, path)
        if (signature and signature[0] == fingerprint == store._fingerprint(path)
                and signature[1] == status.get("index_source")
                and int(signature[2] or 0) >= store.required_word_index_version(signature[1], store.OCR_WORD_INDEX_VERSION)):
            _remember((str(database), path), signature)
    except (OSError, sqlite3.DatabaseError):
        pass  # Cache preparation cannot turn a successful viewer status into an error.


def search_index(path, query, limit):
    # Import at call time: pdf_ocr_search owns status/recovery and imports this
    # module only from its public search function.
    from pdf import pdf_ocr_search as store

    database = Path(store._database_path()).resolve()
    key = (str(database), path)
    with _cache_lock:
        verified = _validated.get(key)
    try:
        fingerprint = store._fingerprint(path)
    except OSError:
        fingerprint = None
    if verified and fingerprint == verified[0] and database.is_file():
        # A reader transaction sees metadata and FTS rows from the same WAL
        # snapshot; warm searches need no schema writes or PDF parsing.
        try:
            with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1)) as connection:
                connection.execute("BEGIN")
                if _signature(connection, path) == verified:
                    results = _rows(connection, path, query, limit)
                    with _cache_lock:
                        if key in _validated:
                            _validated.move_to_end(key)
                    return results
        except sqlite3.DatabaseError:
            # A replaced/legacy database must use the normal recovery path.
            pass
    with _cache_lock:
        _validated.pop(key, None)

    status = store.pdf_ocr_status(path)
    if not status.get("indexed"):
        if status.get("ocr_embedded"):
            raise ValueError(
                "저장된 PaddleOCR 인덱스가 없거나 손상되었습니다. "
                "PDF 전체 OCR을 다시 실행해 주세요."
            )
        raise ValueError("PDF 텍스트 인덱스를 만들 수 없습니다.")
    with closing(store._connect()) as connection:
        connection.execute("BEGIN")
        signature = _signature(connection, path)
        results = _rows(connection, path, query, limit)
    if (signature and signature[0] == fingerprint == store._fingerprint(path)
            and signature[1] == status.get("index_source")
            and int(signature[2] or 0) >= store.required_word_index_version(signature[1], store.OCR_WORD_INDEX_VERSION)):
        _remember(key, signature)
    return results
