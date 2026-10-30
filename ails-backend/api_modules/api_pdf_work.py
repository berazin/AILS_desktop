"""Compatibility exports. Implementation belongs to pdf.work_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("pdf.work_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class PdfWorkMixin:
    """Stable API methods delegating to the pdf_work service."""
    def _start_configured_pdf_ocr_review(self, file_path: str, base_dir: str, emit):
        return _service_call(self, "pdf_work", '_start_configured_pdf_ocr_review', file_path, base_dir, emit)

    def full_pdf_ocr(self, payload: dict, emit):
        return _service_call(self, "pdf_work", 'full_pdf_ocr', payload, emit)

    def material_folder_pdf_ocr_preflight(self, payload: dict):
        return _service_call(self, "pdf_work", 'material_folder_pdf_ocr_preflight', payload)

    def material_folder_pdf_ocr(self, payload: dict, emit):
        return _service_call(self, "pdf_work", 'material_folder_pdf_ocr', payload, emit)

    def _background_translation_identity(self) -> dict:
        return _service_call(self, "pdf_work", '_background_translation_identity')

    def enqueue_pdf_translation(self, payload: dict):
        return _service_call(self, "pdf_work", 'enqueue_pdf_translation', payload)

    def _run_background_translation(self, path, descriptor, emit, cancel_check):
        return _service_call(self, "pdf_work", '_run_background_translation', path, descriptor, emit, cancel_check)

    def translate_pdf(self, payload: dict, emit, *, _cancel_check=None, _expected_provider_identity=None):
        return _service_call(self, "pdf_work", 'translate_pdf', payload, emit, _cancel_check=_cancel_check, _expected_provider_identity=_expected_provider_identity)

    def cancel_pdf_translation(self, payload: dict):
        return _service_call(self, "pdf_work", 'cancel_pdf_translation', payload)

    def benchmark_pdf_ocr(self, payload: dict, emit):
        return _service_call(self, "pdf_work", 'benchmark_pdf_ocr', payload, emit)

    def cancel_pdf_ocr(self, payload: dict):
        return _service_call(self, "pdf_work", 'cancel_pdf_ocr', payload)

    def download_pdf_ocr_model(self, payload: dict, emit):
        return _service_call(self, "pdf_work", 'download_pdf_ocr_model', payload, emit)

    def get_local_models_status(self) -> dict:
        return _service_call(self, "pdf_work", 'get_local_models_status')

    def prepare_local_models(self, payload: dict, emit) -> dict:
        return _service_call(self, "pdf_work", 'prepare_local_models', payload, emit)

    def pdf_ocr_performance_profile(self, payload: dict):
        return _service_call(self, "pdf_work", 'pdf_ocr_performance_profile', payload)

    def selected_pdf_ocr_model_variant(self, payload: Mapping) -> str:
        return _service_call(self, "pdf_work", 'selected_pdf_ocr_model_variant', payload)
