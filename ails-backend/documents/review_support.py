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
from documents.problem_grading_service import prepare_problem_grading, complete_problem_grading
from documents.problem_batch_grading import grade_problem_batch
from documents import answer_key_grading, answer_key_store
from documents.problem_batch_response_stream import BatchGradingCancelled
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

import chat.theory_search
import code_services.code_executor
import code_services.code_grading
import common
import documents.problem_manager
import documents.problem_review_gateway
import pdf.pdf_ocr
import pipeline_utils
import providers
import server_config






from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



import documents.problem_answering
