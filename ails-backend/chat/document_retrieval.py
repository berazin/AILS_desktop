"""Dense Top20 -> cross-encoder -> Top5 document evidence and valid reuse."""
from __future__ import annotations

import os
import re
from collections.abc import Mapping

import numpy as np
from chat.latency_spans import measured, span

from chat.bge_reranker import CANDIDATE_K, EVIDENCE_K, MODEL_KEY, rerank_candidates


PIPELINE_KEY = "dense20-bge5-v1:" + MODEL_KEY


@measured("document_retrieval")
def search(source, path, *, action="search", query="", textbook_terms="", top_k=EVIDENCE_K,
           retrieval_state=None):
    """The existing facade supplies its document/index owner, preserving patch points."""
    normalized = os.path.abspath(str(path or ""))
    action = str(action or "search").strip().casefold()
    if action not in {"search", "reuse"}:
        raise ValueError("검색 action은 search 또는 reuse여야 합니다.")
    with span("document_read"):
        chunks, digest = source._generic_document_chunks(normalized)
    if not chunks:
        return {"status": "unavailable", "chunks": [], "retrieval_state": None,
                "reason": source._no_text_reason(normalized)}
    queued = source.document_index_status(normalized).get("status")
    with span("embedding_ready"):
        backend = source._LexicalFallbackBackend("document indexing") if queued == "indexing" else source._get_embedding_backend()
    revision = source._document_revision(normalized, digest, backend.model_key) + ":" + PIPELINE_KEY
    limit = max(1, min(int(top_k), EVIDENCE_K))
    state = retrieval_state if isinstance(retrieval_state, Mapping) else {}
    by_id = {f"{int(c['page'])}:{int(c['chunk_index'])}": c for c in chunks}
    if action == "reuse":
        valid = (state.get("document_id") == normalized and state.get("index_revision") == revision
                 and state.get("pipeline") == PIPELINE_KEY)
        reused = [by_id[str(i)] for i in state.get("chunk_ids", []) if str(i) in by_id] if valid else []
        if reused:
            scores = state.get("scores", [])
            if len(scores) == len(reused):
                return response(normalized, revision, reused[:limit], state.get("last_query", ""),
                                state.get("last_textbook_terms", ""), scores[:limit], backend,
                                state.get("reranker", {"status": "unavailable"}), state.get("candidate_count", 0))
        return {"status": "unavailable", "chunks": [], "retrieval_state": None,
                "reason": "이전 검색 결과가 현재 문서와 일치하지 않습니다."}
    value = re.sub(r"\s+", " ", str(query or "")).strip()[:1000]
    if not value:
        raise ValueError("검색어를 입력하세요.")
    term_value = re.sub(r"\s+", " ", str(textbook_terms or "")).strip()[:500]
    try:
        with span("query_embedding"):
            query_vector = backend.encode([value], "query")[0]
        with span("passage_embeddings"):
            vectors, _cache = source._cached_passage_vectors(normalized, chunks, backend, document_digest=digest)
    except Exception as error:
        if backend.degraded:
            raise
        backend = source._LexicalFallbackBackend(str(error))
        revision = source._document_revision(normalized, digest, backend.model_key) + ":" + PIPELINE_KEY
        query_vector = backend.encode([value], "query")[0]
        vectors = backend.encode([c["embedding_text"] for c in chunks], "passage")
    with span("dense_search"):
        dense = np.asarray(vectors) @ query_vector
    if dense.shape != (len(chunks),) or not np.isfinite(dense).all():
        raise RuntimeError("Invalid dense search scores")
    # One query, no keyword/title weighting or RRF. Stable IDs resolve cosine ties.
    order = sorted(range(len(chunks)), key=lambda i: (-float(dense[i]), int(chunks[i]["page"]),
                                                     int(chunks[i]["chunk_index"])))[:CANDIDATE_K]
    candidates = [chunks[i] for i in order]
    if backend.degraded:
        ranked, reranker = None, {"status": "unavailable", "reason": "Dense embedding unavailable", "model": MODEL_KEY}
    else:
        with span("reranking"):
            ranked, reranker = rerank_candidates(value, [str(c["embedding_text"]) for c in candidates], limit)
    if ranked is None:
        selected, scores = candidates[:limit], [float(dense[i]) for i in order[:limit]]
    else:
        selected = [candidates[r["index"]] for r in ranked]
        scores = [r["score"] for r in ranked]
    return response(normalized, revision, selected, value, term_value, scores, backend, reranker, len(candidates))


def response(path, revision, chunks, query, textbook_terms, scores, backend, reranker, candidate_count):
    chunk_ids = [f"{int(c['page'])}:{int(c['chunk_index'])}" for c in chunks]
    degraded = bool(backend.degraded) or reranker.get("status") != "ready"
    state = {"document_id": path, "index_revision": revision, "chunk_ids": chunk_ids,
             "last_query": str(query or "")[:1000], "last_textbook_terms": str(textbook_terms or "")[:500],
             "pipeline": PIPELINE_KEY, "scores": list(scores), "reranker": dict(reranker),
             "candidate_count": candidate_count}
    from chat.answer_evidence import evidence_for_chunks
    return {
        "evidence": evidence_for_chunks(path, chunks),
        "status": "partial" if degraded else "ready",
        "chunks": [{"id": cid, "text": str(c["text"]), "page": int(c["page"]),
                    "section": str(c.get("title") or ""), "score": round(float(score), 6),
                    "score_type": "reranker" if reranker.get("status") == "ready" else "dense"}
                   for cid, c, score in zip(chunk_ids, chunks, scores)],
        "retrieval_state": state, "embedding_backend": backend.name,
        "embedding_execution": dict(getattr(backend, "evidence", {})),
        "reranker": reranker, "candidate_count": candidate_count,
        "retrieval_pipeline": "dense20-bge5" if not degraded else "dense-fallback",
        "degraded": degraded,
    }
