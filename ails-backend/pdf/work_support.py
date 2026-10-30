"""PDF document processing, OCR, translation, and local model management.

Extracted from api_server.py to isolate PDF work handlers into a dedicated mixin.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Mapping
from dataclasses import asdict
from http import HTTPStatus
from pathlib import Path
from typing import Callable, Any

from language_support import normalize_app_language
from ai_compliance import AIConsentRequired, compliance_metadata, require_external_ai_consent
from background_document_work import coerce_config_bool
from common import PROVIDER_DEEPSEEK, resolve_app_path
from documents.document_translation_provider import (
    AILSGatewayTranslationProvider,
    OpenAICompatibleTranslationProvider,
    PROMPT_VERSION as DOCUMENT_TRANSLATION_PROMPT_VERSION,
    TranslationGlossary,
)
from voice.llama_cpp_voice_agent import VOICE_AGENT_RUNTIME
from pipeline_utils import install_whisper_cpp_model, whisper_cpp_model_status
from documents.problem_manager import scan_pdf_problems
from pdf.pdf_ocr import (
    DEFAULT_LANGUAGE,
    DEFAULT_OCR_MODEL_VARIANT,
    benchmark_ocr_models_and_profiles,
    cancel_ocr_job,
    ensure_ocr_benchmark_document,
    inspect_pdf_ocr_folder,
    install_ocr_model,
    measure_optimal_ocr_performance_profile,
    ocr_model_status,
    ocr_performance_profile_status,
    pdf_ocr_status,
    resolve_ocr_model_variant,
    run_full_pdf_ocr,
    run_pdf_ocr_batch,
)
from pdf.pdf_translation import (
    LAYOUT_VERSION as TRANSLATION_LAYOUT_VERSION,
    PdfTranslationCancelled,
    deepseek_config_from_mapping,
    source_identity,
    pdf_translation_progress_status,
    register_translation_cancel,
    release_translation_cancel,
    request_translation_cancel,
    run_pdf_translation,
)

import ai_model_selection
import documents.material_workspace_support
import accounts.auth_support
import settings.model_support
import edition_manifest
import voice.llama_cpp_voice_agent

_logger = logging.getLogger(__name__)


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
