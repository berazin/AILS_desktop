"""Material-search policy with explicit index/model operations and root selection."""
from __future__ import annotations

from collections.abc import Callable, Mapping


class MaterialSearchService:
    def __init__(self, *, get_root: Callable[[], str], keyword_search: Callable,
                 semantic_search: Callable, backend_status: Callable[[], dict],
                 warm_backend: Callable[[], dict]):
        self.get_root = get_root
        self.keyword_search = keyword_search
        self.semantic_search = semantic_search
        self.backend_status = backend_status
        self.warm_backend = warm_backend

    def search(self, payload: Mapping) -> dict:
        query = str(payload.get("query") or "")
        mode = str(payload.get("mode") or "keyword").strip().casefold()
        if mode not in {"keyword", "semantic"}:
            raise ValueError("검색 mode는 keyword 또는 semantic이어야 합니다.")
        limit = max(1, min(int(payload.get("limit") or 30), 50))
        root = self.get_root()
        if mode == "semantic":
            if self.backend_status().get("status") != "ready":
                self.warm_backend()
                return {"query": query, "mode": mode, "status": "loading", "results": []}
            result = self.semantic_search(root, query, limit=limit)
        else:
            result = self.keyword_search(root, query, limit=limit)
        return {**result, "mode": mode}
