"""Read current PDF keyword text without rebuilding or modifying the OCR index."""
from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path


def indexed_pdf_text(sources: dict[str, str], *, literal: str = ""):
    """Yield (workspace path, page, text); scope paths before any result limit."""
    if not sources:
        return
    from pdf.pdf_ocr_search import _database_path, _fingerprint
    database = Path(_database_path())
    if not database.is_file():
        return
    workspace_by_key = {os.path.normcase(path): source for path, source in sources.items()}
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1)) as connection:
        paths = list(sources)
        for offset in range(0, len(paths), 400):
            batch = paths[offset:offset + 400]
            placeholders = ",".join("?" for _ in batch)
            documents = connection.execute(
                f"SELECT path, fingerprint FROM pdf_ocr_documents WHERE path COLLATE NOCASE IN ({placeholders})", batch,
            )
            current = []
            for path, fingerprint in documents:
                try:
                    if fingerprint == _fingerprint(path):
                        current.append(path)
                except OSError:
                    continue
            if not current:
                continue
            condition = ""
            parameters = list(current)
            if literal:
                escaped = literal.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                # Python IGNORECASE also folds these four non-ASCII characters
                # against ASCII i/s/k. Include their pages to avoid false misses.
                condition = " AND (text LIKE ? ESCAPE '\\' OR text GLOB '*[İıſK]*')"
                parameters.append("%" + escaped + "%")
            rows = connection.execute(
                "SELECT path, page, text FROM pdf_ocr_pages WHERE path IN ("
                + ",".join("?" for _ in current) + ")" + condition
                + " ORDER BY path, CAST(page AS INTEGER)", parameters,
            )
            for path, page, text in rows:
                from pdf.pdf_search_visibility import visible_index_text
                visible = visible_index_text(connection, path, page, text)
                if visible.strip():
                    yield workspace_by_key[os.path.normcase(path)], int(page), visible
