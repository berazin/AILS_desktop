"""Work preflight disclosure: time/cost estimates, routing, and credit checks.

Extracted from api_server.py to isolate work preflight estimation into a
dedicated mixin.
"""

from __future__ import annotations

import math
import os
from collections.abc import Mapping
from http import HTTPStatus

from ai_model_selection import normalize_model_settings
from documents.document_translation_provider import DocumentTranslationOptions, TranslationGlossary
from language_support import normalize_app_language

import ai_model_selection
import accounts.auth_support
import settings.model_support
import documents.auto_review_support
import documents.problem_manager
import documents.problem_review_gateway
import edition_manifest
import pdf.pdf_ocr
import pdf.pdf_translation
import pipeline_utils
import voice.llama_cpp_voice_agent


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
