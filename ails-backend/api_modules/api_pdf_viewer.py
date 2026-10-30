"""Compatibility exports. Implementation belongs to pdf.viewer_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("pdf.viewer_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class PdfViewerMixin:
    """Stable API methods delegating to the pdf_viewer service."""
    def _pdf_text_job_key(self, file_path: str) -> str:
        return _service_call(self, "pdf_viewer", '_pdf_text_job_key', file_path)

    def _ready_pdf_text_payload(self, pdf_data: dict, *, cached: bool) -> dict:
        return _service_call(self, "pdf_viewer", '_ready_pdf_text_payload', pdf_data, cached=cached)

    def _run_pdf_text_extraction(self, file_path: str, fingerprint: dict, job: dict):
        return _service_call(self, "pdf_viewer", '_run_pdf_text_extraction', file_path, fingerprint, job)

    def start_pdf_text_extraction(self, file_path: str) -> dict:
        return _service_call(self, "pdf_viewer", 'start_pdf_text_extraction', file_path)

    def pdf_text_extraction_status(self, file_path: str) -> dict:
        return _service_call(self, "pdf_viewer", 'pdf_text_extraction_status', file_path)
