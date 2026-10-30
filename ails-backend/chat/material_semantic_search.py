"""Cross-material Dense Top20 and the shared BGE cross-encoder."""
from __future__ import annotations

import os
import re

import numpy as np

from chat.bge_reranker import CANDIDATE_K, rerank_candidates
from chat.material_search_index import material_vectors
from documents.material_keyword_sources import inside_root, workspace_paths


def search(source, root: str, query: str, limit: int = 20):
    value = re.sub(r"\s+", " ", str(query or "")).strip()[:1000]
    if not value:
        raise ValueError("검색어를 입력하세요.")
    if not str(root or "").strip() or not os.path.isdir(root):
        return {"query": value, "status": "ready", "results": []}
    root = os.path.realpath(root)
    backend = source.shared_embedding_backend()
    if backend.degraded:
        return {"query": value, "status": "unavailable", "results": [], "embedding_backend": backend.name,
                "degraded": True, "reason": "임베딩 모델을 사용할 수 없어 의미 검색을 실행할 수 없습니다."}
    query_vector = backend.encode([value], "query")[0]
    metadata, matrix = material_vectors(source._embedding_database_path(), str(root or ""),
                                        backend.model_key, int(query_vector.size), source._connect_embedding_cache)
    allowed = {os.path.normcase(path) for path in workspace_paths(root)}
    from chat.material_search_visibility import visible_vectors
    metadata, matrix = visible_vectors(source, metadata, matrix, allowed, backend)
    scores = matrix @ query_vector
    if not np.isfinite(scores).all():
        raise RuntimeError("Invalid material search scores")
    # Matrix metadata order comes from SQLite; sort ties by persistent document/chunk ID.
    ranked = sorted(range(len(metadata)), key=lambda i: (-float(scores[i]), metadata[i][:3]))
    limit = max(1, min(int(limit), CANDIDATE_K))
    from pdf.pdf_ocr_search import indexed_pdf_search_pages
    # Validate source hashes before selecting the actual Top20. No stale passage
    # is reranked or shown. Bulk page reads preserve the existing fast PDF path.
    # Vector metadata is not an access grant: filter before source reads/reranking.
    scan = [i for i in ranked if os.path.normcase(metadata[i][0]) in allowed
            and inside_root(metadata[i][0], root)][:CANDIDATE_K * 3]
    pdf_candidates = [(metadata[i][0], metadata[i][1]) for i in scan
                      if os.path.splitext(metadata[i][0])[1].casefold() == ".pdf"]
    indexed_pages = indexed_pdf_search_pages(pdf_candidates)
    by_path, by_page = {}, {}
    candidates, documents = [], []
    seen = set()
    for i in scan:
        path, page, chunk_index, text_hash = metadata[i]
        from documents.answer_key_visibility import hidden
        is_pdf = os.path.splitext(path)[1].casefold() == ".pdf"
        if not is_pdf and hidden(path, page):
            continue
        by_key = by_page.get((path, page)) if is_pdf else by_path.get(path)
        if by_key is None:
            try:
                if is_pdf:
                    indexed_page = indexed_pages.get((path, page))
                    chunks = source._build_chunks([indexed_page], source._outline_items(indexed_page["outline"])) if indexed_page else []
                else:
                    chunks, _digest = source._generic_document_chunks(path)
            except Exception:
                chunks = []
            by_key = {(int(c["page"]), int(c["chunk_index"])): c for c in chunks}
            if is_pdf:
                by_page[(path, page)] = by_key
            else:
                by_path[path] = by_key
        chunk = by_key.get((page, chunk_index))
        key = (path, page, chunk_index)
        if key in seen or chunk is None or str(chunk.get("text_hash") or "") != text_hash:
            continue
        seen.add(key)
        candidates.append({"path": path, "title": os.path.splitext(os.path.basename(path))[0],
                           "page": int(page), "section": str(chunk.get("title") or ""),
                           "snippet": re.sub(r"\s+", " ", str(chunk["text"]))[:240],
                           "score": round(min(1.0, max(0.0, float(scores[i]))), 6), "score_type": "dense"})
        documents.append(str(chunk["embedding_text"]))
        if len(candidates) == CANDIDATE_K:
            break
    if not candidates:
        return {"query": value, "status": "ready", "results": [], "embedding_backend": backend.name,
                "degraded": False, "candidate_count": 0, "reranker": {"status": "not_needed"}}
    reranked, reranker = rerank_candidates(value, documents, limit)
    if reranked is None:
        results = candidates[:limit]
    else:
        results = [{**candidates[r["index"]], "score": round(r["score"], 6), "score_type": "reranker"}
                   for r in reranked]
    degraded = reranked is None
    return {"query": value, "status": "partial" if degraded else "ready", "results": results,
            "embedding_backend": backend.name, "embedding_execution": dict(getattr(backend, "evidence", {})),
            "degraded": degraded, "reranker": reranker, "candidate_count": len(candidates),
            "retrieval_pipeline": "dense-fallback" if degraded else "dense20-bge5"}
