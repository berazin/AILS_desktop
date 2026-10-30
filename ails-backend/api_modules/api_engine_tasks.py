"""Compatibility exports. Implementation belongs to jobs.summary_task_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("jobs.summary_task_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class EngineTasksMixin:
    """Stable API methods delegating to the tasks service."""
    def is_task_active_for_title(self, title: str) -> bool:
        return _service_call(self, "tasks", 'is_task_active_for_title', title)

    def mark_result_as_running(self, title: str):
        return _service_call(self, "tasks", 'mark_result_as_running', title)

    def refresh_reports_from_disk(self):
        return _service_call(self, "tasks", 'refresh_reports_from_disk')

    def refresh_retry_candidates_from_disk(self):
        return _service_call(self, "tasks", 'refresh_retry_candidates_from_disk')

    def refresh_disk_indexes(self):
        return _service_call(self, "tasks", 'refresh_disk_indexes')

    def collect_engine_results(self):
        return _service_call(self, "tasks", 'collect_engine_results')

    def request_managed_settlement_refresh(self):
        return _service_call(self, "tasks", 'request_managed_settlement_refresh')

    def refresh_pending_managed_settlements(self, candidates):
        return _service_call(self, "tasks", 'refresh_pending_managed_settlements', candidates)

    def queue_url_task(self, payload: dict) -> int:
        return _service_call(self, "tasks", 'queue_url_task', payload)

    def queue_youtube_task(self, payload: dict) -> list[int]:
        return _service_call(self, "tasks", 'queue_youtube_task', payload)

    def queue_audio_task(self, payload: dict) -> list[int]:
        return _service_call(self, "tasks", 'queue_audio_task', payload)

    def queue_video_task(self, payload: dict, task_type: str) -> int:
        return _service_call(self, "tasks", 'queue_video_task', payload, task_type)

    def download_video_whisper_model(self, payload: dict, emit):
        return _service_call(self, "tasks", 'download_video_whisper_model', payload, emit)

    def summary_task_config(self) -> dict:
        return _service_call(self, "tasks", 'summary_task_config')

    def video_verification_model_identity(self, selection: Mapping | None=None) -> dict:
        return _service_call(self, "tasks", 'video_verification_model_identity', selection)

    def video_stt_cleanup_model_identity(self, selection: Mapping | None=None) -> dict:
        return _service_call(self, "tasks", 'video_stt_cleanup_model_identity', selection)

    def video_summary_model_identity(self, selection: Mapping | None=None) -> dict:
        return _service_call(self, "tasks", 'video_summary_model_identity', selection)

    def video_task_config(self, task: Mapping) -> dict:
        return _service_call(self, "tasks", 'video_task_config', task)

    def import_markdown(self, payload: dict) -> dict:
        return _service_call(self, "tasks", 'import_markdown', payload)

    def retry_candidates(self, *, scan_disk: bool=False):
        return _service_call(self, "tasks", 'retry_candidates', scan_disk=scan_disk)

    def prepare_retry_task(self, retry_task: dict) -> dict:
        return _service_call(self, "tasks", 'prepare_retry_task', retry_task)

    def retry_failed_task(self, title: str) -> int:
        return _service_call(self, "tasks", 'retry_failed_task', title)

    def retry_all_failed_tasks(self) -> dict:
        return _service_call(self, "tasks", 'retry_all_failed_tasks')

    def delete_retry_candidate(self, title: str) -> dict:
        return _service_call(self, "tasks", 'delete_retry_candidate', title)

    def organize_report_files(self) -> dict:
        return _service_call(self, "tasks", 'organize_report_files')

    def current_semester_folder_name(self) -> str:
        return _service_call(self, "tasks", 'current_semester_folder_name')

    @staticmethod
    def _fingerprint_parts(parts: list[tuple]) -> str:
        return _import_module("jobs.summary_task_service").SummaryTaskService._fingerprint_parts(parts)

    def status_static_fingerprints(self) -> dict:
        return _service_call(self, "tasks", 'status_static_fingerprints')

    def build_status_payload(self, *, scan_disk: bool=False, lite: bool=False):
        return _service_call(self, "tasks", 'build_status_payload', scan_disk=scan_disk, lite=lite)

    def report_summaries(self, session_only=False):
        return _service_call(self, "tasks", 'report_summaries', session_only)
