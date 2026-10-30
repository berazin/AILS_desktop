"""Use current visible PDF passages even when persisted vectors predate hiding.

Only local embedding inputs are rebuilt, from current read-only index text.
Original vectors are excluded before scoring; source PDFs/embedding DB are not
rewritten by this adapter. A bounded cache avoids repeated local encoding.
"""
from collections import OrderedDict
import os
import threading

import numpy as np

_cache = OrderedDict()
_lock = threading.Lock()
_overlay = None


def visible_vectors(source, metadata, matrix, allowed, backend):
    global _overlay
    from documents.answer_key_visibility import hidden
    from pdf.pdf_ocr_search import indexed_pdf_search_pages

    keep, affected = [], set()
    for index, item in enumerate(metadata):
        path, page, _chunk, _hash = item
        if os.path.normcase(path) not in allowed:
            continue
        if hidden(path, page):
            if os.path.splitext(path)[1].casefold() == ".pdf":
                affected.add((path, page))
            continue
        keep.append(index)
    if not affected:
        if len(keep) == len(metadata):
            return metadata, matrix
        return [metadata[i] for i in keep], matrix[keep]
    pages = indexed_pdf_search_pages(sorted(affected))
    rebuilt = []
    for key in sorted(pages):
        page = pages[key]
        for chunk in source._build_chunks([page], source._outline_items(page["outline"])):
            if chunk["text"].strip():
                rebuilt.append(((*key, chunk["chunk_index"], chunk["text_hash"]), chunk["embedding_text"]))
    old = {tuple(metadata[i]): matrix[i] for i in range(len(metadata))}
    vectors, misses = {}, []
    for item, text in rebuilt:
        cache_key = (backend.model_key, id(backend), matrix.shape[1], item[3])
        if item in old:
            vectors[item] = old[item]
            continue
        with _lock:
            cached = _cache.get(cache_key)
        if cached is None:
            misses.append((item, text, cache_key))
        else:
            vectors[item] = cached
    if misses:
        encoded = np.asarray(backend.encode([text for _item, text, _key in misses], "passage"), dtype=np.float32)
        if encoded.shape != (len(misses), matrix.shape[1]) or not np.isfinite(encoded).all():
            raise RuntimeError("Invalid visible passage embeddings")
        for (item, _text, key), vector in zip(misses, encoded):
            vectors[item] = vector
            with _lock:
                _cache[key] = vector.copy()
                _cache.move_to_end(key)
                while len(_cache) > 512:
                    _cache.popitem(last=False)
    overlay_key = (tuple(keep), tuple(item for item, _text in rebuilt), backend.model_key, id(backend))
    with _lock:
        if _overlay is not None and _overlay[0] is matrix and _overlay[1] == overlay_key:
            return _overlay[2]
    visible_metadata = [metadata[i] for i in keep] + [item for item, _text in rebuilt]
    visible_matrix = [matrix[i] for i in keep] + [vectors[item] for item, _text in rebuilt]
    result = visible_metadata, np.stack(visible_matrix) if visible_matrix else np.empty((0, matrix.shape[1]), dtype=np.float32)
    with _lock:
        _overlay = (matrix, overlay_key, result)
    return result
