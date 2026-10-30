"""Spacing jobs share the document worker and its persisted document ledger."""

import os
import time
from pdf.pdf_password import PdfPasswordRequiredError
from pdf.pdf_work_files import is_pdf_work_temp


class SpacingWorkMixin:
    SPACING_MAX_RETRIES = 3
    SPACING_RETRY_SECONDS = 1.0

    def _prune_pdf_work_temps_locked(self):
        for key, item in list(self._ledger["items"].items()):
            if is_pdf_work_temp(item["path"]):
                self._ledger["items"].pop(key, None)
        for key, item in list(self._eval_items.items()):
            if is_pdf_work_temp(item["path"]):
                self._eval_items.pop(key, None)

    def submit_spacing_password(self, path, password):
        if not isinstance(password, str):
            raise ValueError("PDF 비밀번호를 입력해 주세요.")
        path = os.path.abspath(str(path or ""))
        with self._wake:
            item = self._ledger["items"].get(self._item_key("spacing", path))
            if not self._settings.get("spacing_enabled") or not item or item["state"] != "password_required" or is_pdf_work_temp(path):
                raise ValueError("비밀번호 입력을 기다리는 문법정제 작업이 없습니다.")
            self._spacing_passwords[path] = password
            self._touch(item, state="pending", error="", progress=None)
            self._active = True
            self._start_threads_locked()
            self._wake.notify_all()
            return {"accepted": True}

    def _spacing_ready_locked(self, now=None):
        from background_document_work import _is_path_ocr_excluded
        if not self._settings.get("spacing_enabled"):
            return None
        now = time.time() if now is None else now
        return next((item for item in self._ledger["items"].values()
                     if item["kind"] == "spacing" and item["state"] in {"pending", "failed"}
                     and int(item.get("attempts") or 0) <= self.SPACING_MAX_RETRIES
                     and float(item.get("next_retry_at") or 0) <= now
                     and not is_pdf_work_temp(item["path"])
                     and not _is_path_ocr_excluded(item["path"], self._settings.get("ocr_excluded_paths") or ())), None)

    def _spacing_wait_timeout_locked(self):
        # The shared worker normally wakes every 15 seconds; spacing retries
        # must wake at their one-second deadline instead.
        now = time.time()
        if self._spacing_ready_locked(now + self.SPACING_RETRY_SECONDS) is not None:
            return min(self.TICK_SECONDS, self.SPACING_RETRY_SECONDS)
        return self.TICK_SECONDS

    def _claim_spacing_locked(self, now=None):
        item = self._spacing_ready_locked(now)
        if item is not None:
            self._touch(item, state="running", error="", next_retry_at=0.0)
        return item

    def _note_spacing_locked(self, paths, *, presentation_pdf_paths=()):
        self._prune_pdf_work_temps_locked()
        if self._settings.get("spacing_enabled"):
            for path in paths:
                if os.path.splitext(path)[1].casefold() == ".pdf" and not is_pdf_work_temp(path):
                    from pdf.pdf_grammar_refinement_metadata import GRAMMAR_REFINEMENT_VERSION
                    source = "presentation" if os.path.abspath(path) in presentation_pdf_paths else ""
                    self._ensure_item_locked("spacing", path, source=source)
                    item = self._ledger["items"].get(self._item_key("spacing", path))
                    if item and item["state"] != "running" and item.get("refinement_version") != GRAMMAR_REFINEMENT_VERSION:
                        self._touch(item, state="pending", error="", attempts=0, next_retry_at=0.0, refinement_version=GRAMMAR_REFINEMENT_VERSION)

    def _run_spacing_item(self, item, now=None):
        from pdf.pdf_ocr_spacing_job import reprocess_index_spacing
        from background_document_work import _is_path_ocr_excluded

        def cancel_check():
            with self._lock:
                if self._stop or not self._settings.get("spacing_enabled"):
                    raise InterruptedError("띄어쓰기 후처리가 중지되었습니다.")
                if _is_path_ocr_excluded(item["path"], self._settings.get("ocr_excluded_paths") or ()):
                    raise InterruptedError("OCR 제외 설정됨")

        def record(event):
            with self._lock:
                self._touch(item, progress={"page": event["page"], "total": event["total"]})

        try:
            cancel_check()
            with self._lock:
                password = self._spacing_passwords.pop(item["path"], None)
            result = reprocess_index_spacing(item["path"], include_non_ails=bool(self._settings.get("spacing_non_ails")),
                                             password=password, source=item.get("source", ""), cancel_check=cancel_check, emit=record)
        except PdfPasswordRequiredError as error:
            with self._lock:
                self._touch(item, state="password_required", error=str(error), progress=None)
            return
        except InterruptedError:
            with self._lock:
                self._touch(item, state="pending", progress=None)
            return
        except Exception as error:
            with self._lock:
                attempts = int(item.get("attempts") or 0) + 1
                retry = attempts <= self.SPACING_MAX_RETRIES
                failed_at = time.time() if now is None else now
                self._touch(item, state="pending" if retry else "failed", error=str(error)[:500],
                            attempts=attempts, next_retry_at=failed_at + self.SPACING_RETRY_SECONDS if retry else 0.0,
                            progress=None)
            return
        with self._lock:
            self._touch(item, state="skipped" if result.get("skipped") else "done",
                        error=result.get("reason", ""), signature=self._signature(item["path"]), next_retry_at=0.0, progress=None)
            if not result.get("skipped") and self._settings.get("embedding_enabled"):
                self._reset_embedding_item_locked(item["path"])

    def _spacing_queue_locked(self):
        if not self._settings.get("spacing_enabled"):
            return []
        return [{"path": i["path"], "file_name": os.path.basename(i["path"]),
                 "state": i["state"], "error": i.get("error", ""), "progress": i.get("progress"),
                 "attempts": i.get("attempts", 0), "next_retry_at": i.get("next_retry_at", 0.0)}
                for i in self._ledger["items"].values()
                if i["kind"] == "spacing" and i["state"] in {"pending", "running", "failed", "password_required"}
                and not is_pdf_work_temp(i["path"])]
