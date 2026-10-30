"""Compatibility exports. Implementation belongs to documents.practice_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("documents.practice_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class MaterialPracticeMixin:
    """Stable API methods delegating to the practice service."""
    def _practice_path(self, raw_path: str) -> str:
        return _service_call(self, "practice", '_practice_path', raw_path)

    def material_practice_set(self, raw_path: str) -> dict:
        return _service_call(self, "practice", 'material_practice_set', raw_path)

    def material_practice_answer(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_answer', payload)

    def material_practice_history(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_history', payload)

    def material_practice_select(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_select', payload)

    def material_practice_timer(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_timer', payload)

    def material_practice_grade(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_grade', payload)

    def _grade_material_practice_text(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", '_grade_material_practice_text', payload)

    def material_practice_retry(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_retry', payload)

    def material_practice_retry_batch(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_retry_batch', payload)

    def material_practice_hint(self, payload: Mapping) -> dict:
        return _service_call(self, "practice", 'material_practice_hint', payload)

    def _material_practice_ai_selection(self, workflow='grading'):
        return _service_call(self, "practice", '_material_practice_ai_selection', workflow)

    def _call_material_practice_ai(self, messages, *, max_retries=1, cancel_check=None, workflow='grading', reasoning_effort=None, timing_callback=None):
        return _service_call(self, "practice", '_call_material_practice_ai', messages, max_retries=max_retries, cancel_check=cancel_check, workflow=workflow, reasoning_effort=reasoning_effort, timing_callback=timing_callback)
