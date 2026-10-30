"""Compatibility exports. Implementation belongs to documents.auto_review_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("documents.auto_review_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class ProblemAutoReviewMixin:
    """Stable API methods delegating to the auto_review service."""
    def _ensure_pdf_problem_auto_review_state(self):
        return _service_call(self, "auto_review", '_ensure_pdf_problem_auto_review_state')

    @staticmethod
    def _pdf_problem_auto_review_key(pdf_path: str, base_dir: str) -> str:
        return _import_module("documents.auto_review_service").AutoReviewService._pdf_problem_auto_review_key(pdf_path, base_dir)

    def _update_pdf_problem_auto_review_job(self, key: str, job_id: str, **changes) -> dict:
        return _service_call(self, "auto_review", '_update_pdf_problem_auto_review_job', key, job_id, **changes)

    def pdf_problem_auto_review_status(self, payload: Mapping) -> dict:
        return _service_call(self, "auto_review", 'pdf_problem_auto_review_status', payload)

    def start_pdf_problem_auto_review(self, payload: Mapping) -> dict:
        return _service_call(self, "auto_review", 'start_pdf_problem_auto_review', payload)

    def review_pdf_problem_local(self, payload: Mapping) -> dict:
        return _service_call(self, "auto_review", 'review_pdf_problem_local', payload)

    def _run_pdf_problem_auto_review(self, key: str, job_id: str, revision: str, page_seeds: Mapping[int, str], problem_ids_by_page: Mapping[int, list[str]], cancel_event: threading.Event, access_mode: str, managed_estimated_cost_usd: float) -> None:
        return _service_call(self, "auto_review", '_run_pdf_problem_auto_review', key, job_id, revision, page_seeds, problem_ids_by_page, cancel_event, access_mode, managed_estimated_cost_usd)

    def cancel_pdf_problem_auto_review(self, payload: Mapping) -> dict:
        return _service_call(self, "auto_review", 'cancel_pdf_problem_auto_review', payload)

    def cancel_all_pdf_problem_auto_reviews(self) -> int:
        return _service_call(self, "auto_review", 'cancel_all_pdf_problem_auto_reviews')

    def review_pdf_problem_multimodal(self, payload: dict):
        return _service_call(self, "auto_review", 'review_pdf_problem_multimodal', payload)

    def _review_pdf_problem_multimodal_with_key(self, payload: dict):
        return _service_call(self, "auto_review", '_review_pdf_problem_multimodal_with_key', payload)

    def get_pdf_problem_multimodal_review(self, payload: dict):
        return _service_call(self, "auto_review", 'get_pdf_problem_multimodal_review', payload)

    def list_pdf_problem_multimodal_review_queue(self, payload: dict):
        return _service_call(self, "auto_review", 'list_pdf_problem_multimodal_review_queue', payload)

    def resolve_pdf_problem_multimodal_review_queue(self, payload: dict):
        return _service_call(self, "auto_review", 'resolve_pdf_problem_multimodal_review_queue', payload)

    def list_pdf_problem_multimodal_gold_samples(self, payload: dict):
        return _service_call(self, "auto_review", 'list_pdf_problem_multimodal_gold_samples', payload)

    def save_pdf_problem_multimodal_gold_sample(self, payload: dict):
        return _service_call(self, "auto_review", 'save_pdf_problem_multimodal_gold_sample', payload)
