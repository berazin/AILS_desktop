"""Compatibility exports. Implementation belongs to lms.course_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("lms.course_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class ApiLmsCourseMixin:
    """Stable API methods delegating to the lms_courses service."""
    def queue_eclass_vod_task(self, payload: dict, *, ensure_login: bool=True, academic_period: tuple[int, int] | None=None) -> int:
        return _service_call(self, "lms_courses", 'queue_eclass_vod_task', payload, ensure_login=ensure_login, academic_period=academic_period)

    def scan_lms_course_and_enqueue(self, payload: dict) -> dict:
        return _service_call(self, "lms_courses", 'scan_lms_course_and_enqueue', payload)

    def _lms_scheduled_titles(self) -> set[str]:
        return _service_call(self, "lms_courses", '_lms_scheduled_titles')

    def _enqueue_lms_vod_tasks(self, pending_vod_tasks, course_details, *, grade, semester, scheduled_titles):
        return _service_call(self, "lms_courses", '_enqueue_lms_vod_tasks', pending_vod_tasks, course_details, grade=grade, semester=semester, scheduled_titles=scheduled_titles)

    def _scan_lms_course_and_enqueue_internal(self, payload: dict) -> dict:
        return _service_call(self, "lms_courses", '_scan_lms_course_and_enqueue_internal', payload)
