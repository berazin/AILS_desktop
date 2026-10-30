"""AutoReviewService: feature operations and owned state."""
from __future__ import annotations
from documents.auto_review_jobs import AutoReviewJobs, AutoReviewJobsPorts
from documents.local_problem_review import LocalProblemReview, LocalProblemReviewPorts
from documents.multimodal_review import MultimodalReview, MultimodalReviewPorts
from documents.review_records import ReviewRecords, ReviewRecordsPorts
from jobs.context import contextual_call
from documents.auto_review_support import (Any, Callable, Mapping, dataclass, threading)
from documents.auto_review_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class AutoReviewServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    acquire_managed_ai_session: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    finish_managed_ai_session: Callable[..., Any]
    local_provider_model: Callable[..., Any]
    managed_problem_review_policy: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class AutoReviewService:
    def close(self):
        return self._jobs.close()

    def __init__(self, ports: AutoReviewServicePorts):
        self._ports = ports
        self.acquire_managed_ai_session = ports.acquire_managed_ai_session
        self.finish_managed_ai_session = ports.finish_managed_ai_session
        self.local_provider_model = ports.local_provider_model
        self.managed_problem_review_policy = ports.managed_problem_review_policy
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

        self._jobs = AutoReviewJobs(AutoReviewJobsPorts(
            acquire_managed_ai_session=lambda *args, **kwargs: self.acquire_managed_ai_session(*args, **kwargs),
            finish_managed_ai_session=lambda *args, **kwargs: self.finish_managed_ai_session(*args, **kwargs),
            local_provider_model=lambda *args, **kwargs: self.local_provider_model(*args, **kwargs),
            managed_problem_review_policy=lambda *args, **kwargs: self.managed_problem_review_policy(*args, **kwargs),
            review_pdf_problem_local=lambda *args, **kwargs: self.review_pdf_problem_local(*args, **kwargs),
            review_pdf_problem_multimodal=lambda *args, **kwargs: self.review_pdf_problem_multimodal(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: self.workflow_uses_managed_ai(*args, **kwargs),
            get_config=lambda: self.config,
        ))
        self._local = LocalProblemReview(LocalProblemReviewPorts(
            get_config=lambda: self.config,
        ))
        self._multimodal = MultimodalReview(MultimodalReviewPorts(
            acquire_managed_ai_session=lambda *args, **kwargs: self.acquire_managed_ai_session(*args, **kwargs),
            finish_managed_ai_session=lambda *args, **kwargs: self.finish_managed_ai_session(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: self.workflow_uses_managed_ai(*args, **kwargs),
        ))
        self._records = ReviewRecords(ReviewRecordsPorts(
        ))

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def _ensure_pdf_problem_auto_review_state(self):
        return self._jobs._ensure_pdf_problem_auto_review_state()

    @staticmethod
    def _pdf_problem_auto_review_key(pdf_path: str, base_dir: str) -> str:
        return AutoReviewJobs._pdf_problem_auto_review_key(pdf_path, base_dir)

    def _update_pdf_problem_auto_review_job(
        self,
        key: str,
        job_id: str,
        **changes,
    ) -> dict:
        return self._jobs._update_pdf_problem_auto_review_job(key, job_id, **changes)

    def pdf_problem_auto_review_status(self, payload: Mapping) -> dict:
        return self._jobs.pdf_problem_auto_review_status(payload)

    def start_pdf_problem_auto_review(self, payload: Mapping) -> dict:
        return self._jobs.start_pdf_problem_auto_review(payload)

    def review_pdf_problem_local(self, payload: Mapping) -> dict:
        return self._local.review_pdf_problem_local(payload)

    def _run_pdf_problem_auto_review(
        self,
        key: str,
        job_id: str,
        revision: str,
        page_seeds: Mapping[int, str],
        problem_ids_by_page: Mapping[int, list[str]],
        cancel_event: threading.Event,
        access_mode: str,
        managed_estimated_cost_usd: float,
    ) -> None:
        return self._jobs._run_pdf_problem_auto_review(key, job_id, revision, page_seeds, problem_ids_by_page, cancel_event, access_mode, managed_estimated_cost_usd)

    def cancel_pdf_problem_auto_review(self, payload: Mapping) -> dict:
        return self._jobs.cancel_pdf_problem_auto_review(payload)

    def cancel_all_pdf_problem_auto_reviews(self) -> int:
        return self._jobs.cancel_all_pdf_problem_auto_reviews()

    def review_pdf_problem_multimodal(self, payload: dict):
        return self._multimodal.review_pdf_problem_multimodal(payload)

    def _review_pdf_problem_multimodal_with_key(self, payload: dict):
        return self._multimodal._review_pdf_problem_multimodal_with_key(payload)

    def get_pdf_problem_multimodal_review(self, payload: dict):
        return self._records.get_pdf_problem_multimodal_review(payload)

    def list_pdf_problem_multimodal_review_queue(self, payload: dict):
        return self._records.list_pdf_problem_multimodal_review_queue(payload)

    def resolve_pdf_problem_multimodal_review_queue(self, payload: dict):
        return self._records.resolve_pdf_problem_multimodal_review_queue(payload)

    def list_pdf_problem_multimodal_gold_samples(self, payload: dict):
        return self._records.list_pdf_problem_multimodal_gold_samples(payload)

    def save_pdf_problem_multimodal_gold_sample(self, payload: dict):
        return self._records.save_pdf_problem_multimodal_gold_sample(payload)

    @property
    def pdf_problem_auto_review_lock(self):
        return self._jobs.pdf_problem_auto_review_lock

    @pdf_problem_auto_review_lock.setter
    def pdf_problem_auto_review_lock(self, value):
        self._jobs.pdf_problem_auto_review_lock = value

    @property
    def pdf_problem_auto_review_jobs(self):
        return self._jobs.pdf_problem_auto_review_jobs

    @pdf_problem_auto_review_jobs.setter
    def pdf_problem_auto_review_jobs(self, value):
        self._jobs.pdf_problem_auto_review_jobs = value

    @property
    def pdf_problem_auto_review_cancel_events(self):
        return self._jobs.pdf_problem_auto_review_cancel_events

    @pdf_problem_auto_review_cancel_events.setter
    def pdf_problem_auto_review_cancel_events(self, value):
        self._jobs.pdf_problem_auto_review_cancel_events = value

    @property
    def pdf_problem_auto_review_threads(self):
        return self._jobs.pdf_problem_auto_review_threads

    @pdf_problem_auto_review_threads.setter
    def pdf_problem_auto_review_threads(self, value):
        self._jobs.pdf_problem_auto_review_threads = value
