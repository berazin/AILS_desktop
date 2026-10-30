"""PdfViewerService: feature operations and owned state."""
from __future__ import annotations
from pdf.viewer_support import (
    chat,
    dataclass,
    hashlib,
    os,
    pdf,
    threading,
)
from pdf.viewer_support import __name__ as _support_name
from importlib import import_module as _import_module
import time
from collections.abc import Callable

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class PdfViewerServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    on_text_ready: Callable[[str], None]

class PdfViewerService:
    def __init__(self, ports: PdfViewerServicePorts):
        self._ports = ports
        self.pdf_text_extraction_lock = threading.Lock()
        self.pdf_text_extraction_jobs = {}
        self._closing = threading.Event()

    def close(self):
        self._closing.set()
        with self.pdf_text_extraction_lock:
            workers = [job.get("worker") for job in self.pdf_text_extraction_jobs.values()]
        deadline = time.monotonic() + 2.0
        for worker in workers:
            if worker is not None and worker is not threading.current_thread():
                worker.join(max(0.0, deadline - time.monotonic()))

    def _pdf_text_job_key(self, file_path: str) -> str:
        return os.path.normcase(os.path.abspath(file_path))

    def _ready_pdf_text_payload(self, pdf_data: dict, *, cached: bool) -> dict:
        return {
            "status": "ready",
            "cached": cached,
            "content": str(pdf_data.get("content", "") or ""),
            "page_count": max(0, int(pdf_data.get("page_count", 0) or 0)),
            "page_texts": list(pdf_data.get("page_texts", []) or []),
        }

    def _run_pdf_text_extraction(self, file_path: str, fingerprint: dict, job: dict):
        try:
            pdf_data = pdf.pdf_viewer_data.extract_pdf_viewer_data(file_path, raise_errors=True)
            if self._closing.is_set():
                return
            pdf.pdf_viewer_data.save_pdf_text_cache(file_path, fingerprint, pdf_data)
            # The application schedules optional indexing according to settings.
            try:
                self._ports.on_text_ready(file_path)
            except Exception:
                pass
            result = self._ready_pdf_text_payload(pdf_data, cached=False)
        except Exception as error:
            result = {
                "status": "error",
                "cached": False,
                "error": str(error) or error.__class__.__name__,
            }
        key = self._pdf_text_job_key(file_path)
        with self.pdf_text_extraction_lock:
            if self.pdf_text_extraction_jobs.get(key) is job:
                job.update(result)

    def start_pdf_text_extraction(self, file_path: str) -> dict:
        normalized = os.path.abspath(file_path)
        fingerprint = pdf.pdf_viewer_data.pdf_file_fingerprint(normalized)
        cached = pdf.pdf_viewer_data.load_pdf_text_cache(normalized, fingerprint)
        if cached is not None:
            return self._ready_pdf_text_payload(cached, cached=True)

        key = self._pdf_text_job_key(normalized)
        with self.pdf_text_extraction_lock:
            if self._closing.is_set():
                raise RuntimeError("PDF viewer service has closed")
            existing = self.pdf_text_extraction_jobs.get(key)
            if (
                existing is not None
                and existing.get("fingerprint") == fingerprint
                and existing.get("status") == "extracting"
            ):
                return {"status": "extracting", "cached": False}
            job = {
                "status": "extracting",
                "cached": False,
                "fingerprint": fingerprint,
            }
            self.pdf_text_extraction_jobs[key] = job
            worker = threading.Thread(
                target=self._run_pdf_text_extraction,
                args=(normalized, fingerprint, job),
                name=f"ails-pdf-text-{hashlib.sha1(key.encode('utf-8', errors='ignore')).hexdigest()[:10]}",
                daemon=True,
            )
            job["worker"] = worker
            worker.start()
        return {"status": "extracting", "cached": False}

    def pdf_text_extraction_status(self, file_path: str) -> dict:
        normalized = os.path.abspath(str(file_path or "").strip())
        if not os.path.isfile(normalized) or os.path.splitext(normalized)[1].lower() != ".pdf":
            raise FileNotFoundError("PDF file was not found.")
        fingerprint = pdf.pdf_viewer_data.pdf_file_fingerprint(normalized)
        cached = pdf.pdf_viewer_data.load_pdf_text_cache(normalized, fingerprint)
        if cached is not None:
            return self._ready_pdf_text_payload(cached, cached=True)

        key = self._pdf_text_job_key(normalized)
        with self.pdf_text_extraction_lock:
            job = self.pdf_text_extraction_jobs.get(key)
            if job is not None and job.get("fingerprint") == fingerprint:
                status = str(job.get("status", "extracting"))
                if status == "ready":
                    return self._ready_pdf_text_payload(job, cached=False)
                if status == "error":
                    return {
                        "status": "error",
                        "cached": False,
                        "error": str(job.get("error", "") or "PDF text extraction failed."),
                    }
                return {"status": "extracting", "cached": False}
        return self.start_pdf_text_extraction(normalized)
