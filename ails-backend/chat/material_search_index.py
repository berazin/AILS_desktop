"""Reusable dense matrix for cross-material semantic search; no model or PDF I/O."""

from __future__ import annotations

import os
import threading
from contextlib import closing

import numpy as np

_lock = threading.Lock()
_snapshot = None


def _revision(path: str) -> tuple:
    values = []
    for candidate in (path, path + "-wal"):
        try:
            stat = os.stat(candidate)
            values.append((stat.st_size, stat.st_mtime_ns))
        except OSError:
            values.append(None)
    return tuple(values)


def material_vectors(database: str, root: str, model: str, dimensions: int, connect):
    """Keep one immutable matrix, rebuilding when SQLite/WAL changes.

    The key includes the database, material root and model: tests and separate
    libraries cannot reuse another library's vectors. Root filtering happens in
    SQL before blobs are read. Existing embedding databases need no migration.
    """
    global _snapshot
    normalized_root = os.path.normcase(os.path.abspath(root)) if root.strip() else ""
    key = (database, normalized_root, model, dimensions)
    with _lock:
        revision = _revision(database)
        if _snapshot is not None and _snapshot[0] == key and _snapshot[1] == revision:
            return _snapshot[2], _snapshot[3]
        sql = (
            "SELECT path, source_digest, page, chunk_index, text_hash, vector, updated_at, rowid "
            "FROM pdf_theory_embeddings WHERE model = ?"
        )
        parameters = [model]
        if normalized_root:
            prefix = os.path.abspath(root).rstrip("/\\") + os.sep
            escaped = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            sql += " AND path LIKE ? ESCAPE '\\'"
            parameters.append(escaped + "%")
        with closing(connect()) as connection:
            rows = connection.execute(sql, parameters).fetchall()
        latest = {}
        for path, digest, _page, _chunk, _hash, _vector, updated, rowid in rows:
            candidate = (updated, rowid, digest)
            if path not in latest or candidate > latest[path]:
                latest[path] = candidate
        metadata = []
        vectors = []
        for path, digest, page, chunk, text_hash, blob, _updated, _rowid in rows:
            if digest != latest[path][2]:
                continue
            if normalized_root:
                try:
                    if os.path.commonpath([normalized_root, os.path.normcase(os.path.abspath(path))]) != normalized_root:
                        continue
                except ValueError:
                    continue
            vector = np.frombuffer(blob, dtype="<f4")
            if vector.size != dimensions or not np.isfinite(vector).all():
                continue
            metadata.append((path, page, chunk, text_hash))
            vectors.append(vector)
        matrix = np.stack(vectors) if vectors else np.empty((0, dimensions), dtype=np.float32)
        # Keep the pre-read revision. A concurrent commit causes a refresh on the
        # next request instead of being mistaken for part of this snapshot.
        _snapshot = (key, revision, metadata, matrix)
        return metadata, matrix
