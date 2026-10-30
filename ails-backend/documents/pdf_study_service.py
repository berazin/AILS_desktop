"""Own reading positions and select the study store for the current data folder."""
from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from common import resolve_app_path
from documents.study_manager import StudyStore


class PdfStudyService:
    def __init__(self, get_base_dir: Callable[[], str]):
        self.get_base_dir = get_base_dir
        self._page_lock = threading.RLock()
        self._pdf_study_store_instance: StudyStore | None = None

    def _ails_state_dir(self) -> str:
        base_dir = self.get_base_dir()
        if not base_dir:
            return ""
        state_dir = os.path.join(base_dir, ".ails")
        os.makedirs(state_dir, exist_ok=True)
        return state_dir

    def _pdf_page_state_path(self) -> str:
        state_dir = self._ails_state_dir()
        return os.path.join(state_dir, "pdf-pages.json") if state_dir else ""

    def _normalize_pdf_page_key(self, value: str) -> str:
        return str(value or "").replace("\\", "/").strip()

    def _pdf_page_key_exists(self, path_key: str) -> bool:
        normalized_key = self._normalize_pdf_page_key(path_key)
        if not normalized_key:
            return False
        candidates = [normalized_key]
        if not os.path.isabs(normalized_key):
            resolved = resolve_app_path(normalized_key)
            if resolved:
                candidates.append(resolved)
        return any(os.path.isfile(candidate) for candidate in candidates)

    def _write_pdf_page_state(self, state_path: str, pages: dict[str, int]):
        data = {"pages": pages}
        tmp_path = f"{state_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, state_path)

    def read_pdf_page_state(self):
        with self._page_lock:
            state_path = self._pdf_page_state_path()
            if not state_path or not os.path.exists(state_path):
                return {"pages": {}}
            try:
                with open(state_path, "r", encoding="utf-8") as handle:
                    raw = json.load(handle)
            except Exception:
                return {"pages": {}}
            raw_pages = raw.get("pages", raw) if isinstance(raw, dict) else {}
            pages = {}
            if isinstance(raw_pages, dict):
                for key, value in raw_pages.items():
                    normalized_key = self._normalize_pdf_page_key(key)
                    try:
                        page = int(value)
                    except Exception:
                        continue
                    if normalized_key and page >= 1 and self._pdf_page_key_exists(normalized_key):
                        pages[normalized_key] = page
            if raw != {"pages": pages}:
                try:
                    self._write_pdf_page_state(state_path, pages)
                except Exception:
                    pass
            return {"pages": pages}

    def save_pdf_page_state(self, payload: dict):
        with self._page_lock:
            path_key = self._normalize_pdf_page_key(payload.get("path", ""))
            if not path_key:
                raise ValueError("path is empty")
            if not self._pdf_page_key_exists(path_key):
                raise FileNotFoundError(f"file not found: {path_key}")
            page = int(payload.get("page", 1) or 1)
            if page < 1:
                raise ValueError("page must be positive")
            state_path = self._pdf_page_state_path()
            if not state_path:
                return {"saved": False, "pages": {}}
            state = self.read_pdf_page_state()
            pages = dict(state.get("pages", {}) or {})
            pages[path_key] = page
            self._write_pdf_page_state(state_path, pages)
            return {"saved": True, "path": path_key, "page": page, "pages": pages}

    def sync_pdf_page_state(self, payload: dict):
        with self._page_lock:
            state_path = self._pdf_page_state_path()
            if not state_path:
                return {"saved": False, "pages": {}}
            state = self.read_pdf_page_state()
            pages = dict(state.get("pages", {}) or {})
            raw_pages = payload.get("pages", {})
            if isinstance(raw_pages, dict):
                for key, value in raw_pages.items():
                    path_key = self._normalize_pdf_page_key(key)
                    try:
                        page = int(value)
                    except Exception:
                        continue
                    if path_key and page >= 1 and self._pdf_page_key_exists(path_key):
                        pages[path_key] = page
            self._write_pdf_page_state(state_path, pages)
            return {"saved": True, "pages": pages}

    def update_pdf_page_state(self, payload: dict):
        if isinstance(payload.get("pages"), dict):
            return self.sync_pdf_page_state(payload)
        return self.save_pdf_page_state(payload)

    def _pdf_study_store(self) -> StudyStore:
        with self._page_lock:
            state_dir = self._ails_state_dir()
            if not state_dir:
                raise ValueError("학습 기록을 저장하려면 먼저 저장 폴더를 설정해 주세요.")
            store_path = os.path.join(state_dir, "pdf-study.sqlite3")
            cached_store = self._pdf_study_store_instance
            if cached_store is not None and cached_store.db_path == os.path.abspath(store_path):
                return cached_store
            cached_store = StudyStore(store_path)
            self._pdf_study_store_instance = cached_store
            return cached_store
