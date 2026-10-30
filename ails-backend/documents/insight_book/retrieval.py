"""Find related Book sections with the shared local encoder and account-local vectors."""
from __future__ import annotations

import math
import re

from .contracts import digest


def shared_encoder():
    from chat.theory_search import shared_embedding_backend
    return shared_embedding_backend()


def encode_sections(changes, existing, encoder):
    by_id = {s["id"]: s for s in existing}
    pending = [c for c in changes if c["action"] == "upsert" and
               (c["id"] not in by_id or any(c[f] != by_id[c["id"]][f] for f in ("title", "content")))]
    if not pending:
        return {}
    backend = encoder()
    vectors = backend.encode([c["title"] + "\n" + c["content"] for c in pending], "passage")
    if len(vectors) != len(pending):
        raise ValueError("변경된 절의 임베딩 개수가 일치하지 않습니다.")
    result = {}
    for change, vector in zip(pending, vectors):
        values = [float(x) for x in vector]
        if not values or not all(math.isfinite(x) for x in values):
            raise ValueError("유효하지 않은 임베딩입니다.")
        result[change["id"]] = {"model": backend.model_key, "vector": values,
                                "digest": digest([change["title"], change["content"]]),
                                "degraded": bool(getattr(backend, "degraded", False))}
    return result


def related_sections(query, sections, encoder, limit=6):
    if not sections:
        return []
    terms = set(re.findall(r"[\w가-힣]+", query.casefold()))
    backend = encoder()
    vector = [float(x) for x in backend.encode([query], "query")[0]]
    lexical = sorted(sections, key=lambda s: -len(terms.intersection(
        re.findall(r"[\w가-힣]+", (s["title"] + " " + s["content"]).casefold()))))
    semantic = []
    for section in sections:
        cached = section.get("embedding", {})
        other = cached.get("vector", [])
        if cached.get("model") == backend.model_key and len(other) == len(vector):
            semantic.append((sum(a * b for a, b in zip(vector, other)), section["id"]))
    # Reciprocal-rank fusion keeps exact terms and semantic matches useful together.
    score = {s["id"]: 1 / (61 + rank) for rank, s in enumerate(lexical)}
    for rank, (_, key) in enumerate(sorted(semantic, reverse=True)):
        score[key] += 1 / (61 + rank)
    return sorted(sections, key=lambda s: -score[s["id"]])[:limit]


def public_sections(sections):
    return [{key: value for key, value in s.items() if key != "embedding"} for s in sections]


def toc(sections):
    return [{key: s[key] for key in ("id", "chapter", "title", "position")} for s in
            sorted(sections, key=lambda s: (s["position"], s["id"]))]
