"""AutoReviewJobs: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from documents.auto_review_support import (
    AUTO_APPLY_CONFIDENCE,
    Mapping,
    PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES,
    PDF_PROBLEM_AUTO_REVIEW_DEFAULT_RESERVE_USD,
    PDF_PROBLEM_AUTO_REVIEW_MAX_WORKERS,
    PDF_PROBLEM_AUTO_REVIEW_RETRYABLE_STATUSES,
    PDF_PROBLEM_MANAGED_ESTIMATE_USD_PER_PAGE,
    PDF_PROBLEM_REVIEW_ROUTE_VERSION,
    ThreadPoolExecutor,
    _INTERNAL_GATEWAY_REVIEW,
    _is_current_problem_review_route,
    _pdf_auto_review_logger,
    accounts,
    ai_compliance,
    as_completed,
    documents,
    edition_manifest,
    hashlib,
    os,
    pdf_problem_catalog_review_revision,
    read_pdf_problem_auto_review_job,
    safe_float,
    threading,
    time,
    uuid,
    voice,
    write_pdf_problem_auto_review_job,
)
from jobs.context import contextual_call


@dataclass(frozen=True)
class AutoReviewJobsPorts:
    acquire_managed_ai_session: Callable[..., Any]
    finish_managed_ai_session: Callable[..., Any]
    local_provider_model: Callable[..., Any]
    managed_problem_review_policy: Callable[..., Any]
    review_pdf_problem_local: Callable[..., Any]
    review_pdf_problem_multimodal: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]
    get_config: Callable[..., Any]


class AutoReviewJobs:
    def __init__(self, ports: AutoReviewJobsPorts):
        self._ports = ports
        self.acquire_managed_ai_session = ports.acquire_managed_ai_session
        self.finish_managed_ai_session = ports.finish_managed_ai_session
        self.local_provider_model = ports.local_provider_model
        self.managed_problem_review_policy = ports.managed_problem_review_policy
        self.review_pdf_problem_local = ports.review_pdf_problem_local
        self.review_pdf_problem_multimodal = ports.review_pdf_problem_multimodal
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai
        self.pdf_problem_auto_review_lock = threading.RLock()
        self.pdf_problem_auto_review_jobs = {}
        self.pdf_problem_auto_review_cancel_events = {}
        self.pdf_problem_auto_review_threads = {}
        self._closed = False

    @property
    def config(self):
        return self._ports.get_config()

    def close(self):
        with self.pdf_problem_auto_review_lock:
            self._closed = True
            for event in self.pdf_problem_auto_review_cancel_events.values():
                event.set()
            workers = list(self.pdf_problem_auto_review_threads.values())
        deadline = time.monotonic() + 3.0
        for worker in workers:
            if worker is not threading.current_thread():
                worker.join(max(0.0, deadline - time.monotonic()))

    def _ensure_pdf_problem_auto_review_state(self):
        if not hasattr(self, "pdf_problem_auto_review_lock"):
            self.pdf_problem_auto_review_lock = threading.RLock()
        if not hasattr(self, "pdf_problem_auto_review_jobs"):
            self.pdf_problem_auto_review_jobs = {}
        if not hasattr(self, "pdf_problem_auto_review_cancel_events"):
            self.pdf_problem_auto_review_cancel_events = {}
        if not hasattr(self, "pdf_problem_auto_review_threads"):
            self.pdf_problem_auto_review_threads = {}

    @staticmethod
    def _pdf_problem_auto_review_key(pdf_path: str, base_dir: str) -> str:
        normalized = "\0".join((
            os.path.normcase(os.path.abspath(pdf_path)),
            os.path.normcase(os.path.abspath(base_dir)),
        ))
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def _update_pdf_problem_auto_review_job(
        self,
        key: str,
        job_id: str,
        **changes,
    ) -> dict:
        self._ensure_pdf_problem_auto_review_state()
        with self.pdf_problem_auto_review_lock:
            current = self.pdf_problem_auto_review_jobs.get(key)
            if not isinstance(current, Mapping) or str(current.get("job_id", "")) != job_id:
                return dict(current or {})
            updated = {**current, **changes, "updated_at": time.time()}
            self.pdf_problem_auto_review_jobs[key] = updated
            write_pdf_problem_auto_review_job(
                str(updated["base_dir"]),
                str(updated["pdf_path"]),
                updated,
            )
            return dict(updated)

    def pdf_problem_auto_review_status(self, payload: Mapping) -> dict:
        self._ensure_pdf_problem_auto_review_state()
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        base_dir_text = str(payload.get("base_dir", "") or "").strip()
        if not pdf_path or not base_dir_text:
            raise ValueError("pdf_path and base_dir are required.")
        base_dir = os.path.abspath(base_dir_text)
        key = self._pdf_problem_auto_review_key(pdf_path, base_dir)
        with self.pdf_problem_auto_review_lock:
            current = self.pdf_problem_auto_review_jobs.get(key)
            if isinstance(current, Mapping) and not _is_current_problem_review_route(current):
                self.pdf_problem_auto_review_jobs.pop(key, None)
                current = None
            if isinstance(current, Mapping):
                current = dict(current)
                if str(current.get("status", "")) in PDF_PROBLEM_AUTO_REVIEW_RETRYABLE_STATUSES:
                    current["retry_available"] = int(current.get("retry_count") or 0) < 1
                return current
            persisted = read_pdf_problem_auto_review_job(base_dir, pdf_path)
            if not persisted:
                return {
                    "status": "idle",
                    "pdf_path": pdf_path,
                    "base_dir": base_dir,
                    "mode": "benchmark",
                    "budget_unlimited": False,
                    "page_total": 0,
                    "page_processed": 0,
                    "problem_total": 0,
                    "spent_usd": 0.0,
                    "budget_usd": max(0.01, min(
                        documents.problem_review_gateway.MAX_BENCHMARK_COST_USD,
                        safe_float(self.config.get("problem_review_budget_usd"), documents.problem_review_gateway.MAX_BENCHMARK_COST_USD),
                    )),
                }
            if not _is_current_problem_review_route(persisted):
                return {
                    "status": "idle",
                    "pdf_path": pdf_path,
                    "base_dir": base_dir,
                    "mode": "production",
                    "budget_unlimited": True,
                    "page_total": 0,
                    "page_processed": 0,
                    "problem_total": 0,
                    "spent_usd": 0.0,
                    "budget_usd": None,
                    "primary_model": documents.problem_review_gateway.PRIMARY_REVIEW_MODEL,
                    "secondary_model": documents.problem_review_gateway.SECONDARY_REVIEW_MODEL,
                    "fallback_model": documents.problem_review_gateway.FALLBACK_REVIEW_MODEL,
                    "route_version": PDF_PROBLEM_REVIEW_ROUTE_VERSION,
                    "superseded_job_id": str(persisted.get("job_id", "") or ""),
                    "superseded_primary_model": str(persisted.get("primary_model", "") or ""),
                }
            if str(persisted.get("status", "")) in PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES:
                persisted = {
                    **persisted,
                    "status": "interrupted",
                    "completed_at": time.time(),
                    "error": "The backend stopped before this review job finished; it was not restarted automatically.",
                    "updated_at": time.time(),
                }
                write_pdf_problem_auto_review_job(base_dir, pdf_path, persisted)
            if str(persisted.get("status", "")) in PDF_PROBLEM_AUTO_REVIEW_RETRYABLE_STATUSES:
                persisted = {
                    **persisted,
                    "retry_available": int(persisted.get("retry_count") or 0) < 1,
                }
            self.pdf_problem_auto_review_jobs[key] = dict(persisted)
            return dict(persisted)

    def start_pdf_problem_auto_review(self, payload: Mapping) -> dict:
        """Start review for immutable OCR revision.

        Direct callers default to benchmark mode for safe tests. The app sends
        production mode explicitly: no benchmark cap and one worker per page.
        """
        self._ensure_pdf_problem_auto_review_state()
        with self.pdf_problem_auto_review_lock:
            if self._closed:
                raise RuntimeError("Auto review service has closed")
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        base_dir_text = str(payload.get("base_dir", "") or "").strip()
        if not os.path.isfile(pdf_path):
            raise FileNotFoundError(pdf_path)
        if not base_dir_text:
            raise ValueError("base_dir is required.")
        base_dir = os.path.abspath(base_dir_text)
        review_engine = str(payload.get("review_engine") or "cloud").strip().casefold()
        if review_engine not in {"local", "cloud"}:
            raise ValueError("review_engine must be local or cloud.")
        local_model_id = (
            voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(
                payload.get("local_problem_review_model", self.config.get("local_problem_review_model"))
            )
            if review_engine == "local"
            else ""
        )
        access_mode = "local"
        review_policy = {
            "policy_revision": 0,
            "primary_model": local_model_id,
            "secondary_model": "",
            "fallback_model": "",
            "confidence_threshold": 0.0,
        }
        if review_engine == "cloud":
            access_mode = "managed" if self.workflow_uses_managed_ai("problem_review") else "personal"
            personal_api_key = ""
            if access_mode == "personal" and not personal_api_key:
                raise ValueError("Personal review credentials are no longer supported.")
            review_policy = {
                "policy_revision": 0,
                "primary_model": (
                    self.local_provider_model("problem_review")[1]
                    if access_mode == "personal" else documents.problem_review_gateway.PRIMARY_REVIEW_MODEL
                ),
                "secondary_model": documents.problem_review_gateway.SECONDARY_REVIEW_MODEL,
                "fallback_model": documents.problem_review_gateway.FALLBACK_REVIEW_MODEL,
                "confidence_threshold": AUTO_APPLY_CONFIDENCE,
            }
            if access_mode == "managed":
                review_policy = self.managed_problem_review_policy()
        else:
            local_status = voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.status(local_model_id)
            if not local_status.get("runtime_ready"):
                raise RuntimeError(str(local_status.get("runtime_error") or "llama.cpp Vulkan 실행 파일이 없습니다."))
            if not local_status.get("ready"):
                model_label = str(local_status.get("model_label") or "Qwen3")
                raise RuntimeError(f"{model_label} 로컬 문제 검수 모델을 먼저 다운로드해 주세요.")
        mode = str(payload.get("mode") or "benchmark").strip().casefold()
        if mode not in {"benchmark", "production"}:
            raise ValueError("mode must be benchmark or production.")
        budget_unlimited = review_engine == "local" or mode == "production"
        review_queue_only = bool(payload.get("review_queue_only"))
        requested_page = max(0, int(payload.get("page") or 0))
        if requested_page and not edition_manifest.LOCAL_AI_SETTINGS_ENABLED:
            raise ValueError("Page-specific image review is available in the developer edition only.")
        if requested_page and review_queue_only:
            raise ValueError("Page-specific review cannot be combined with review_queue_only.")
        run_scope = f"page:{requested_page}" if requested_page else ("review_queue" if review_queue_only else "all")
        if edition_manifest.canonical_edition_id() == "commercial" and review_queue_only:
            raise ValueError("Commercial edition allows one AI problem review per OCR revision.")
        catalog = documents.problem_manager.list_pdf_problems(pdf_path, base_dir)
        problems = [item for item in catalog.get("problems", []) if isinstance(item, Mapping)]
        if not catalog.get("scanned") or catalog.get("stale"):
            raise RuntimeError("A current PaddleOCR problem catalog is required before automatic review.")
        revision = pdf_problem_catalog_review_revision(catalog)
        key = self._pdf_problem_auto_review_key(pdf_path, base_dir)
        budget = None if budget_unlimited else max(0.01, min(
            documents.problem_review_gateway.MAX_BENCHMARK_COST_USD,
            safe_float(self.config.get("problem_review_budget_usd"), documents.problem_review_gateway.MAX_BENCHMARK_COST_USD),
        ))
        review_queue_items = [
            item for item in documents.problem_review_gateway.list_review_queue(base_dir, pdf_path)
            if isinstance(item, Mapping)
        ]
        pending_queue_problem_ids = {
            str(item.get("problem_id", "") or "")
            for item in review_queue_items
            if str(item.get("status", "") or "") == "needs_user_review"
        }
        selected_problems = (
            [problem for problem in problems if str(problem.get("id", "") or "") in pending_queue_problem_ids]
            if review_queue_only
            else problems
        )
        if requested_page:
            selected_problems = [
                problem for problem in selected_problems
                if int(problem.get("page") or 1) <= requested_page <= int(problem.get("page_end") or problem.get("page") or 1)
            ]
        if review_queue_only and not selected_problems:
            raise ValueError("There are no pending review-queue problems to reprocess.")
        problem_ids_by_page: dict[int, list[str]] = {}
        page_seeds = {}
        for problem in selected_problems:
            page = max(1, int(problem.get("page") or 1))
            problem_id = str(problem.get("id", "") or "")
            if not problem_id:
                continue
            page_seeds.setdefault(page, problem_id)
            problem_ids_by_page.setdefault(page, []).append(problem_id)
        page_seeds = {page: problem_id for page, problem_id in page_seeds.items() if problem_id}
        all_page_seeds = dict(sorted(page_seeds.items()))
        legacy_queue_problem_ids = {
            str(item.get("problem_id", "") or "")
            for item in review_queue_items
            if not isinstance(item.get("secondary_review"), Mapping)
        }
        legacy_queue_pages = {
            max(1, int(problem.get("page") or 1))
            for problem in problems
            if str(problem.get("id", "") or "") in legacy_queue_problem_ids
        }
        retry_failed = bool(payload.get("retry_failed"))

        with self.pdf_problem_auto_review_lock:
            if self._closed:
                raise RuntimeError("Auto review service has closed")
            current = self.pdf_problem_auto_review_jobs.get(key)
            if not isinstance(current, Mapping):
                current = read_pdf_problem_auto_review_job(base_dir, pdf_path)
            resume = {
                "page_processed": 0,
                "problem_processed": 0,
                "applied_problem_count": 0,
                "queued_problem_count": 0,
                "application_error_count": 0,
                "spent_usd": 0.0,
                "retry_count": 0,
                "retry_of_job_id": "",
            }
            same_mode = bool(current.get("budget_unlimited", False)) == budget_unlimited if isinstance(current, Mapping) else False
            same_route = bool(
                isinstance(current, Mapping)
                and _is_current_problem_review_route(current)
                and int(current.get("policy_revision") or 0) == int(review_policy["policy_revision"])
                and str(current.get("primary_model") or "") == review_policy["primary_model"]
                and str(current.get("secondary_model") or "") == review_policy["secondary_model"]
                and str(current.get("fallback_model") or "") == review_policy["fallback_model"]
                and safe_float(current.get("confidence_threshold"), -1.0)
                == review_policy["confidence_threshold"]
            )
            same_access_mode = (
                str(current.get("model_route_mode") or current.get("ai_gateway_access_mode") or "personal") == access_mode
                if isinstance(current, Mapping)
                else False
            )
            same_scope = (
                str(current.get("run_scope", "all") or "all") == run_scope
                if isinstance(current, Mapping)
                else False
            )
            same_engine = (
                str(current.get("review_engine") or "cloud") == review_engine
                if isinstance(current, Mapping)
                else False
            )
            current_status = str(current.get("status", "") or "") if isinstance(current, Mapping) else ""
            if (
                review_engine == "cloud"
                and edition_manifest.canonical_edition_id() == "commercial"
                and isinstance(current, Mapping)
                and current.get("catalog_revision") == revision
                and str(current.get("review_engine") or "cloud") == "cloud"
            ):
                current = dict(current)
                current["deduplicated"] = True
                self.pdf_problem_auto_review_jobs[key] = current
                return current
            if (
                review_engine == "cloud"
                and not review_queue_only
                and isinstance(current, Mapping)
                and same_mode
                and not same_route
                and legacy_queue_pages
            ):
                page_seeds = {
                    page: problem_id
                    for page, problem_id in all_page_seeds.items()
                    if page in legacy_queue_pages
                }
                all_page_seeds = dict(page_seeds)
            if (
                isinstance(current, Mapping)
                and current.get("catalog_revision") == revision
                and same_mode
                and same_route
                and same_engine
                and same_access_mode
                and same_scope
                and (not review_queue_only or current_status in PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES)
            ):
                current = dict(current)
                can_retry = (
                    retry_failed
                    and current_status in PDF_PROBLEM_AUTO_REVIEW_RETRYABLE_STATUSES
                    and int(current.get("retry_count") or 0) < 1
                )
                if can_retry:
                    processed_pages = max(0, min(len(all_page_seeds), int(current.get("page_processed") or 0)))
                    page_seeds = dict(list(all_page_seeds.items())[processed_pages:])
                    resume = {
                        "page_processed": processed_pages,
                        "problem_processed": max(0, int(current.get("problem_processed") or 0)),
                        "applied_problem_count": max(0, int(current.get("applied_problem_count") or 0)),
                        "queued_problem_count": max(0, int(current.get("queued_problem_count") or 0)),
                        "application_error_count": max(0, int(current.get("application_error_count") or 0)),
                        "spent_usd": max(0.0, safe_float(current.get("spent_usd"), 0.0)),
                        "retry_count": int(current.get("retry_count") or 0) + 1,
                        "retry_of_job_id": str(current.get("job_id", "") or ""),
                    }
                    if not page_seeds:
                        current["deduplicated"] = True
                        current["retry_available"] = False
                        self.pdf_problem_auto_review_jobs[key] = current
                        return current
                elif current_status in PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES:
                    thread = self.pdf_problem_auto_review_threads.get(key)
                    if thread is None or not thread.is_alive():
                        current.update({
                            "status": "interrupted",
                            "completed_at": time.time(),
                            "error": "The prior review worker is no longer running; automatic restart was suppressed.",
                            "updated_at": time.time(),
                        })
                        write_pdf_problem_auto_review_job(base_dir, pdf_path, current)
                    current["deduplicated"] = True
                    self.pdf_problem_auto_review_jobs[key] = current
                    return current
                else:
                    current["deduplicated"] = True
                    current["retry_available"] = int(current.get("retry_count") or 0) < 1
                    self.pdf_problem_auto_review_jobs[key] = current
                    return current

            running_thread = self.pdf_problem_auto_review_threads.get(key)
            if running_thread is not None and running_thread.is_alive():
                raise RuntimeError("A prior catalog revision is still being reviewed; cancel it before starting a new revision.")

            now = time.time()
            job_id = uuid.uuid4().hex
            job = {
                "schema_version": 1,
                "job_id": job_id,
                "status": "queued" if page_seeds else "completed",
                "pdf_path": pdf_path,
                "base_dir": base_dir,
                "mode": mode,
                "review_engine": review_engine,
                "run_scope": run_scope,
                "requested_page": requested_page or None,
                "budget_unlimited": budget_unlimited,
                "model_route_mode": access_mode,
                "catalog_revision": revision,
                "pdf_fingerprint": str(catalog.get("pdf_fingerprint", "") or ""),
                "created_at": now,
                "updated_at": now,
                "completed_at": now if not page_seeds else None,
                "page_total": len(all_page_seeds),
                "page_processed": resume["page_processed"],
                "problem_total": (
                    len(selected_problems)
                    if review_queue_only
                    else sum(
                        int(problem.get("page") or 1) in all_page_seeds
                        for problem in problems
                    )
                ),
                "review_problem_ids": [
                    problem_id
                    for page in sorted(problem_ids_by_page)
                    for problem_id in problem_ids_by_page[page]
                ] if review_queue_only else [],
                "problem_processed": resume["problem_processed"],
                "applied_problem_count": resume["applied_problem_count"],
                "queued_problem_count": resume["queued_problem_count"],
                "application_error_count": resume["application_error_count"],
                "failed_page_count": 0,
                "current_page": None,
                "spent_usd": resume["spent_usd"],
                "budget_usd": budget,
                "reserved_next_call_usd": 0.0 if budget_unlimited else min(budget, PDF_PROBLEM_AUTO_REVIEW_DEFAULT_RESERVE_USD),
                "policy_revision": review_policy["policy_revision"],
                "primary_model": review_policy["primary_model"],
                "secondary_model": review_policy["secondary_model"],
                "fallback_model": review_policy["fallback_model"],
                "route_version": PDF_PROBLEM_REVIEW_ROUTE_VERSION,
                "confidence_threshold": review_policy["confidence_threshold"],
                "cancel_requested": False,
                "errors": [],
                "deduplicated": False,
                "retry_count": resume["retry_count"],
                "retry_of_job_id": resume["retry_of_job_id"],
                "retry_available": False,
                "parallel_workers": (
                    1
                    if review_engine == "local"
                    else max(1, len(page_seeds))
                    if budget_unlimited
                    else min(PDF_PROBLEM_AUTO_REVIEW_MAX_WORKERS, max(1, len(page_seeds)))
                ),
            }
            self.pdf_problem_auto_review_jobs[key] = job
            write_pdf_problem_auto_review_job(base_dir, pdf_path, job)
            if not page_seeds:
                return dict(job)
            cancel_event = threading.Event()
            self.pdf_problem_auto_review_cancel_events[key] = cancel_event
            worker = threading.Thread(
                target=contextual_call(self._run_pdf_problem_auto_review),
                args=(
                    key,
                    job_id,
                    revision,
                    page_seeds,
                    problem_ids_by_page if review_queue_only or review_engine == "local" else {},
                    cancel_event,
                    access_mode,
                    max(0.01, len(page_seeds) * PDF_PROBLEM_MANAGED_ESTIMATE_USD_PER_PAGE),
                ),
                daemon=True,
                name=f"ails-problem-review-{job_id[:8]}",
            )
            self.pdf_problem_auto_review_threads[key] = worker
            try:
                worker.start()
            except Exception as error:
                self.pdf_problem_auto_review_threads.pop(key, None)
                self.pdf_problem_auto_review_cancel_events.pop(key, None)
                job = {
                    **job,
                    "status": "failed",
                    "completed_at": time.time(),
                    "updated_at": time.time(),
                    "errors": [{"error": str(error)[:1_000]}],
                    "retry_available": True,
                }
                self.pdf_problem_auto_review_jobs[key] = job
                write_pdf_problem_auto_review_job(base_dir, pdf_path, job)
                raise
            return dict(job)

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
        managed_session_id = ""
        job: Mapping = {}
        spent = 0.0
        errors = []
        page_processed = 0
        problem_processed = 0
        applied_count = 0
        queued_count = 0
        application_error_count = 0
        failed_pages = 0
        terminal_status = "failed"
        try:
            job = self._update_pdf_problem_auto_review_job(key, job_id, status="running", started_at=time.time())
            review_policy = {
                "policy_revision": int(job.get("policy_revision") or 0),
                "primary_model": str(job.get("primary_model") or documents.problem_review_gateway.PRIMARY_REVIEW_MODEL),
                "secondary_model": str(job.get("secondary_model") or documents.problem_review_gateway.SECONDARY_REVIEW_MODEL),
                "fallback_model": str(job.get("fallback_model") or documents.problem_review_gateway.FALLBACK_REVIEW_MODEL),
                "confidence_threshold": safe_float(
                    job.get("confidence_threshold"),
                    AUTO_APPLY_CONFIDENCE,
                ),
            }
            review_engine = str(job.get("review_engine") or "cloud")
            if review_engine == "local":
                vercel_gateway_api_key = ""
            elif access_mode == "managed":
                managed_session = self.acquire_managed_ai_session(
                    managed_estimated_cost_usd,
                    policy_revision=review_policy["policy_revision"],
                )
                for key_name in (
                    "policy_revision",
                    "primary_model",
                    "secondary_model",
                    "fallback_model",
                    "confidence_threshold",
                ):
                    if managed_session[key_name] != review_policy[key_name]:
                        raise accounts.auth_support.ManagedAuthError("작업 시작 후 관리자 문제 검수 정책이 변경되었습니다. 다시 시작해 주세요.")
                vercel_gateway_api_key = managed_session["token"]
                managed_session_id = managed_session["session_id"]
                review_policy["gateway_url"] = managed_session["gateway_url"]
            else:
                raise ValueError("Personal review credentials are no longer supported.")
                if not vercel_gateway_api_key:
                    raise RuntimeError("Vercel AI Gateway API Key is required for personal problem review mode.")
            pdf_path = str(job.get("pdf_path", "") or "")
            base_dir = str(job.get("base_dir", "") or "")
            spent = max(0.0, safe_float(job.get("spent_usd"), 0.0))
            observed_costs = []
            page_processed = max(0, int(job.get("page_processed") or 0))
            problem_processed = max(0, int(job.get("problem_processed") or 0))
            applied_count = max(0, int(job.get("applied_problem_count") or 0))
            queued_count = max(0, int(job.get("queued_problem_count") or 0))
            application_error_count = max(0, int(job.get("application_error_count") or 0))
            terminal_status = "completed"
            budget = (
                float("inf")
                if bool(job.get("budget_unlimited", False))
                else safe_float(job.get("budget_usd"), documents.problem_review_gateway.MAX_BENCHMARK_COST_USD)
            )
            state_lock = threading.RLock()
            reservation_state = {"reserved": 0.0}

            def review_one_page(page_item):
                page, problem_id = page_item
                if cancel_event.is_set():
                    return {"kind": "cancelled", "page": page, "problem_id": problem_id}
                current_catalog = documents.problem_manager.list_pdf_problems(pdf_path, base_dir)
                if pdf_problem_catalog_review_revision(current_catalog) != revision:
                    return {
                        "kind": "stale",
                        "page": page,
                        "problem_id": problem_id,
                        "error": "PaddleOCR problem catalog changed while automatic review was running.",
                    }
                if review_engine == "local":
                    try:
                        result = self.review_pdf_problem_local({
                            "pdf_path": pdf_path,
                            "base_dir": base_dir,
                            "problem_id": problem_id,
                            "_problem_ids": list(problem_ids_by_page.get(page, [])),
                            "_cancel_event": cancel_event,
                            "_local_model_id": review_policy["primary_model"],
                        })
                        return {
                            "kind": "success",
                            "page": page,
                            "problem_id": problem_id,
                            "result": result,
                            "page_cost": 0.0,
                        }
                    except Exception as error:
                        return {
                            "kind": "error",
                            "page": page,
                            "problem_id": problem_id,
                            "error": str(error)[:1_000],
                        }
                ai_compliance.require_external_ai_consent(
                    "/api/pdf/problems/multimodal-review/auto/start",
                    self.config,
                    ai_compliance.compliance_metadata(edition_manifest.EDITION_MANIFEST),
                )
                with state_lock:
                    reserve = max(
                        0.01,
                        min(
                            0.25,
                            max(observed_costs) * 1.5
                            if observed_costs
                            else min(PDF_PROBLEM_AUTO_REVIEW_DEFAULT_RESERVE_USD, budget / max(1, len(page_seeds))),
                        ),
                    )
                    if spent + reservation_state["reserved"] + reserve > budget:
                        return {"kind": "budget_exhausted", "page": page, "problem_id": problem_id}
                    reservation_state["reserved"] += reserve
                try:
                    result = self.review_pdf_problem_multimodal({
                        "pdf_path": pdf_path,
                        "base_dir": base_dir,
                        "problem_id": problem_id,
                        "_problem_ids": list(problem_ids_by_page.get(page, [])),
                        "_cancel_event": cancel_event,
                        "_gateway_api_key": vercel_gateway_api_key,
                        "_review_policy": review_policy,
                        "_internal_review_token": _INTERNAL_GATEWAY_REVIEW,
                    })
                    usage = result.get("usage") if isinstance(result.get("usage"), Mapping) else {}
                    call_count = max(0, int(usage.get("call_count") or 0))
                    page_cost = max(0.0, safe_float(usage.get("total_cost_usd"), 0.0))
                    if call_count and usage.get("cost_accounting_complete", True) is False:
                        response_errors = usage.get("response_errors")
                        detail = ""
                        if isinstance(response_errors, list) and response_errors:
                            detail = f" Details: {str(response_errors[0])[:500]}"
                        raise RuntimeError(
                            "AI gateway returned no usable cost accounting; further automatic calls were stopped."
                            + detail
                        )
                    return {
                        "kind": "success",
                        "page": page,
                        "problem_id": problem_id,
                        "result": result,
                        "page_cost": page_cost,
                    }
                except Exception as error:
                    return {
                        "kind": "error",
                        "page": page,
                        "problem_id": problem_id,
                        "error": str(error)[:1_000],
                    }
                finally:
                    with state_lock:
                        reservation_state["reserved"] = max(0.0, reservation_state["reserved"] - reserve)

            max_workers = (
                1
                if review_engine == "local"
                else max(1, len(page_seeds))
                if bool(job.get("budget_unlimited", False))
                else min(PDF_PROBLEM_AUTO_REVIEW_MAX_WORKERS, max(1, len(page_seeds)))
            )
            with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ails-review-page") as executor:
                futures = [executor.submit(contextual_call(review_one_page, item)) for item in sorted(page_seeds.items())]
                for future in as_completed(futures):
                    outcome = future.result()
                    kind = outcome.get("kind")
                    if kind == "success":
                        result = outcome["result"]
                        page_cost = float(outcome.get("page_cost") or 0.0)
                        spent += page_cost
                        if page_cost > 0:
                            observed_costs.append(page_cost)
                        page_processed += 1
                        problem_processed += max(0, int(result.get("page_problem_count") or 0))
                        applied_count += max(0, int(result.get("applied_problem_count") or 0))
                        queued_count += max(0, int(result.get("queued_problem_count") or 0))
                        page_application_errors = result.get("application_errors")
                        if isinstance(page_application_errors, list):
                            application_error_count += len(page_application_errors)
                        if spent > budget:
                            terminal_status = "budget_exhausted"
                            cancel_event.set()
                    elif kind == "error":
                        failed_pages += 1
                        error_text = str(outcome.get("error") or "page review failed")
                        errors.append({"page": outcome.get("page"), "problem_id": outcome.get("problem_id"), "error": error_text})
                        if "cost accounting" in error_text.lower():
                            terminal_status = "budget_accounting_error"
                            cancel_event.set()
                    elif kind == "stale":
                        terminal_status = "stale"
                        errors.append({"page": outcome.get("page"), "problem_id": outcome.get("problem_id"), "error": outcome.get("error")})
                        cancel_event.set()
                    elif kind == "budget_exhausted":
                        terminal_status = "budget_exhausted"
                    elif kind == "cancelled" and terminal_status == "completed":
                        terminal_status = "cancelled"
                    self._update_pdf_problem_auto_review_job(
                        key,
                        job_id,
                        page_processed=page_processed,
                        problem_processed=problem_processed,
                        applied_problem_count=applied_count,
                        queued_problem_count=queued_count,
                        application_error_count=application_error_count,
                        failed_page_count=failed_pages,
                        spent_usd=round(spent, 8),
                        errors=list(errors),
                    )
            if cancel_event.is_set() and terminal_status == "completed":
                terminal_status = "cancelled"
            if terminal_status == "completed" and (errors or application_error_count):
                terminal_status = "completed_with_errors" if page_processed else "failed"
        except Exception as error:
            errors.append({"error": str(error)[:1_000]})
            terminal_status = "cancelled" if cancel_event.is_set() else "failed"
        finally:
            if managed_session_id:
                try:
                    self.finish_managed_ai_session(managed_session_id)
                except Exception as error:
                    errors.append({"error": f"Managed AI session finish failed: {str(error)[:800]}"})
                    if terminal_status == "completed":
                        terminal_status = "completed_with_errors"
            try:
                self._update_pdf_problem_auto_review_job(
                    key,
                    job_id,
                    status=terminal_status,
                    current_page=None,
                    completed_at=time.time(),
                    page_processed=page_processed,
                    problem_processed=problem_processed,
                    applied_problem_count=applied_count,
                    queued_problem_count=queued_count,
                    application_error_count=application_error_count,
                    failed_page_count=failed_pages,
                    spent_usd=round(spent, 8),
                    errors=list(errors),
                    retry_available=(
                        terminal_status in PDF_PROBLEM_AUTO_REVIEW_RETRYABLE_STATUSES
                        and int(job.get("retry_count") or 0) < 1
                    ),
                )
            except Exception:
                _pdf_auto_review_logger.exception("Could not persist terminal PDF problem review status for job %s", job_id)
            finally:
                with self.pdf_problem_auto_review_lock:
                    current_thread = self.pdf_problem_auto_review_threads.get(key)
                    if current_thread is threading.current_thread():
                        self.pdf_problem_auto_review_threads.pop(key, None)
                        self.pdf_problem_auto_review_cancel_events.pop(key, None)

    def cancel_pdf_problem_auto_review(self, payload: Mapping) -> dict:
        self._ensure_pdf_problem_auto_review_state()
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        base_dir_text = str(payload.get("base_dir", "") or "").strip()
        if not base_dir_text:
            raise ValueError("base_dir is required.")
        base_dir = os.path.abspath(base_dir_text)
        key = self._pdf_problem_auto_review_key(pdf_path, base_dir)
        with self.pdf_problem_auto_review_lock:
            event = self.pdf_problem_auto_review_cancel_events.get(key)
            current = self.pdf_problem_auto_review_jobs.get(key)
            if event is None or not isinstance(current, Mapping):
                return {**self.pdf_problem_auto_review_status(payload), "cancelled": False}
            event.set()
            updated = {
                **current,
                "status": "cancel_pending",
                "cancel_requested": True,
                "updated_at": time.time(),
            }
            self.pdf_problem_auto_review_jobs[key] = updated
            write_pdf_problem_auto_review_job(base_dir, pdf_path, updated)
            return {**updated, "cancelled": True}

    def cancel_all_pdf_problem_auto_reviews(self) -> int:
        self._ensure_pdf_problem_auto_review_state()
        with self.pdf_problem_auto_review_lock:
            items = list(self.pdf_problem_auto_review_cancel_events.items())
            for key, event in items:
                event.set()
                current = self.pdf_problem_auto_review_jobs.get(key)
                if isinstance(current, Mapping):
                    updated = {
                        **current,
                        "status": "cancel_pending",
                        "cancel_requested": True,
                        "updated_at": time.time(),
                    }
                    self.pdf_problem_auto_review_jobs[key] = updated
                    write_pdf_problem_auto_review_job(
                        str(updated["base_dir"]), str(updated["pdf_path"]), updated,
                    )
            return len(items)
