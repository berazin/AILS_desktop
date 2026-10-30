from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
import re
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Mapping

from markdown_latex_utils import normalize_latex_math_syntax
from pipeline_utils import safe_float
from pdf.pdf_ocr import indexed_pdf_page
from chat.theory_search import hybrid_search_pdf
from documents.problem_review_gateway import (
    AUTO_APPLY_CONFIDENCE,
    FALLBACK_REVIEW_MODEL,
    GEMINI_FLASH_LITE,
    LUNA_MEDIUM,
    MAX_BENCHMARK_COST_USD,
    GatewayResponseError,
    PRIMARY_REVIEW_MODEL,
    SECONDARY_REVIEW_MODEL,
    choose_model as choose_review_model,
    get_review as get_problem_review,
    list_gold_samples,
    list_review_queue,
    mark_review_applied,
    mark_review_application_failed,
    mark_review_status,
    normalize_gemini_flash_lite_model,
    remove_review_queue_item,
    record_review_queue_resolution,
    review_page_batch,
    save_gold_sample,
    upsert_review_queue_item,
    validated_review_resolution_content,
)
from code_services.code_grading import build_grading_messages, parse_grading_response
from code_services.code_executor import get_code_project_files
from documents.problem_answering import (
    ANSWER_TYPE_CODE,
    ANSWER_TYPE_SHORT_ANSWER,
    build_answer_grading_messages,
    build_local_problem_proofread_messages,
    build_problem_hint_messages,
    build_problem_review_messages,
    normalize_answer_type,
    parse_local_problem_proofread_response,
    parse_problem_review_response,
)
from documents.problem_manager import (
    apply_problem_grading,
    apply_reviewed_problem_content,
    begin_problem_grading,
    get_pdf_problem,
    list_pdf_problems,
    problem_review_ocr_context,
    save_problem_answer,
    save_problem_hint,
    validate_problem_project,
)

import ai_compliance
import accounts.auth_support
import documents.problem_manager
import documents.problem_review_gateway
import edition_manifest
import pdf.pdf_ocr
import pipeline_utils
import voice.llama_cpp_voice_agent


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading




# api_server에서 이동: PDF 문제 자동 검수 작업 저장·라우트 상수
import hashlib
import logging
import threading
import uuid
from pathlib import Path
import voice.llama_cpp_voice_agent

_pdf_auto_review_logger = logging.getLogger(__name__)

PDF_PROBLEM_AUTO_REVIEW_DEFAULT_RESERVE_USD = 0.05
# Recent 184-page production reviews cost about $0.44. A one-cent/page request
# leaves conservative room for confidence fallbacks; the server adds headroom.
PDF_PROBLEM_MANAGED_ESTIMATE_USD_PER_PAGE = 0.01
PDF_PROBLEM_AUTO_REVIEW_MAX_WORKERS = 8
PDF_PROBLEM_MODEL_FORMAT_MAX_RETRIES = 3
PDF_PROBLEM_REVIEW_ROUTE_VERSION = 3
PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES = frozenset({"queued", "running", "cancel_pending"})
PDF_PROBLEM_AUTO_REVIEW_RETRYABLE_STATUSES = frozenset({
    "failed", "completed_with_errors", "interrupted", "stale", "cancelled", "budget_accounting_error",
})
_pdf_problem_auto_review_file_lock = threading.RLock()
_INTERNAL_GATEWAY_REVIEW = object()
def _is_current_problem_review_route(job: Mapping) -> bool:
    if str(job.get("review_engine") or "cloud") == "local":
        return bool(
            str(job.get("route_version") or "") == str(PDF_PROBLEM_REVIEW_ROUTE_VERSION)
            and str(job.get("primary_model") or "") in voice.llama_cpp_voice_agent.LOCAL_PROBLEM_REVIEW_MODEL_IDS
        )
    models = (
        str(job.get("primary_model", "") or ""),
        str(job.get("secondary_model", "") or ""),
        str(job.get("fallback_model", "") or ""),
    )
    try:
        threshold = float(job.get("confidence_threshold", documents.problem_review_gateway.AUTO_APPLY_CONFIDENCE))
    except (TypeError, ValueError):
        return False
    return bool(
        str(job.get("route_version") or "") == str(PDF_PROBLEM_REVIEW_ROUTE_VERSION)
        and len(set(models)) == 3
        and set(models).issubset(documents.problem_review_gateway.MANAGED_REVIEW_MODELS)
        and 0.0 <= threshold <= 1.0
    )
def pdf_problem_auto_review_job_path(base_dir: str, pdf_path: str) -> Path:
    key = hashlib.sha256(os.path.abspath(pdf_path).encode("utf-8")).hexdigest()[:32]
    return Path(base_dir) / ".ails-problems" / "multimodal-review" / key / "auto-review-job.json"


def read_pdf_problem_auto_review_job(base_dir: str, pdf_path: str) -> dict:
    try:
        value = json.loads(pdf_problem_auto_review_job_path(base_dir, pdf_path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_pdf_problem_auto_review_job(base_dir: str, pdf_path: str, job: Mapping) -> bool:
    """Persist job with Windows/OneDrive transient-lock retry.

    A cloud-sync/indexer can briefly hold destination during `os.replace`.
    Do not abort 184-page review for one state-file persistence collision.
    """
    destination = pdf_problem_auto_review_job_path(base_dir, pdf_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(
        f"{destination.name}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        with _pdf_problem_auto_review_file_lock:
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(dict(job), handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            for attempt in range(12):
                try:
                    os.replace(temporary, destination)
                    return True
                except PermissionError:
                    if attempt >= 11:
                        _pdf_auto_review_logger.warning("Could not persist PDF problem review job after Windows file-lock retries: %s", destination)
                        return False
                    time.sleep(min(0.75, 0.05 * (attempt + 1)))
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
    return False


def pdf_problem_catalog_review_revision(catalog: Mapping) -> str:
    """Hash only immutable PaddleOCR candidates, never mutable practice overlays."""
    revision_problems = []
    for problem in catalog.get("problems", []):
        if not isinstance(problem, Mapping):
            continue
        source = (
            problem.get("paddleocr_original")
            if isinstance(problem.get("paddleocr_original"), Mapping)
            else problem
        )
        revision_problems.append({
            "id": str(problem.get("id", "") or ""),
            "pdf_fingerprint": str(problem.get("pdf_fingerprint", "") or ""),
            "chapter": str(problem.get("chapter", "") or ""),
            "kind": str(problem.get("kind", "") or ""),
            "label_bbox": dict(problem.get("label_bbox") or {})
            if isinstance(problem.get("label_bbox"), Mapping) else {},
            "number": int(source.get("number") or problem.get("number") or 0),
            "page": int(source.get("page") or problem.get("page") or 0),
            "page_end": int(source.get("page_end") or problem.get("page_end") or 0),
            "problem_text": str(source.get("problem_text", "") or ""),
            "choices": [str(item) for item in (source.get("choices") or [])],
            "code": [str(item) for item in (source.get("code") or [])],
            "code_positions": [int(item) for item in (source.get("code_positions") or [])],
            "answer_type": str(source.get("answer_type", "unknown") or "unknown"),
        })
    revision_problems.sort(key=lambda item: (item["page"], item["number"], item["id"]))
    encoded = json.dumps({
        "pdf_fingerprint": str(catalog.get("pdf_fingerprint", "") or ""),
        "problems": revision_problems,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
import documents.problem_review_gateway


import language_support
import documents.problem_answering
