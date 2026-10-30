from __future__ import annotations

import threading


class SummaryGenerationUnavailableError(RuntimeError):
    pass


class BackgroundEngine:
    """API-compatible no-op engine used by builds without summary generation."""

    def __init__(self):
        self.lock = threading.RLock()
        self.pending_tasks = []
        self.results_to_collect = []
        self.current_task_id = None
        self.cancel_current_requested = False
        self.status = {
            "is_running": False,
            "is_paused": False,
            "pause_reason": "",
            "current_title": "",
            "logs": [],
            "debug_events": [],
        }

    def _active_task_snapshots_unlocked(self):
        return []

    def active_task_snapshots(self):
        return []

    def add_task(self, _task, _config):
        raise SummaryGenerationUnavailableError(
            "이 에디션에는 정리본 생성 기능이 포함되어 있지 않습니다."
        )

    def remove_pending_task(self, _task_id):
        return None

    def request_cancel_current_task(self):
        return False

    def request_cancel_task(self, _task_id):
        return False

    def request_cancel_all(self):
        return False

    def request_pause(self, reason: str = "user"):
        del reason
        return False

    def request_pause_task(self, _task_id, reason: str = "user"):
        del reason
        return False

    def resume(self, reason: str = ""):
        del reason
        return False

    def resume_task(self, _task_id, reason: str = ""):
        del reason
        return False
