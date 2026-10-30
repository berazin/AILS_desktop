"""Compatibility exports. Implementation belongs to jobs.preflight_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("jobs.preflight_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class WorkPreflightMixin:
    """Stable API methods delegating to the preflight service."""
    @staticmethod
    def _estimated_media_duration_seconds(file_path: str) -> int:
        return _import_module("jobs.preflight_service").PreflightService._estimated_media_duration_seconds(file_path)

    @staticmethod
    def _pdf_translation_kwargs(payload: Mapping) -> dict:
        return _import_module("jobs.preflight_service").PreflightService._pdf_translation_kwargs(payload)

    @staticmethod
    def _pdf_translation_reservation_cost(page_count: int) -> float:
        return _import_module("jobs.preflight_service").PreflightService._pdf_translation_reservation_cost(page_count)

    def work_preflight(self, payload: Mapping) -> dict:
        return _service_call(self, "preflight", 'work_preflight', payload)

    def require_work_preflight(self, payload: Mapping, operation: str) -> dict:
        return _service_call(self, "preflight", 'require_work_preflight', payload, operation)

    def managed_problem_review_policy(self) -> dict:
        return _service_call(self, "preflight", 'managed_problem_review_policy')
