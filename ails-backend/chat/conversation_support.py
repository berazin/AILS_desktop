"""Chatbot, OpenAI/DeepSeek streaming responses, and code sandbox AI assist.

Extracted from api_server.py to isolate conversational agent endpoints and
LLM context preparation into a dedicated mixin.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from typing import Callable, Any
from collections.abc import Mapping
from contextlib import nullcontext

from language_support import (
    language_display_name,
    language_output_directive,
    normalize_app_language,
)
from markdown_latex_utils import normalize_latex_math_syntax, normalize_markdown_image_link_sizes
from common import (
    CUSTOM_MODEL_OPTION,
    DEEPSEEK_DEFAULT_BASE_URL,
    GROQ_DEFAULT_BASE_URL,
    LMSTUDIO_DEFAULT_BASE_URL,
    PROVIDER_CUSTOM,
    PROVIDER_DEEPSEEK,
    PROVIDER_GEMINI,
    PROVIDER_GROQ,
    PROVIDER_LMSTUDIO,
    resolve_app_path,
    sanitize_title,
)
from voice.llama_cpp_voice_agent import VOICE_AGENT_RUNTIME
from voice.local_model_catalog import LOCAL_CONTEXT, model_spec
from pipeline_utils import call_openai_compatible_chat
from pdf.pdf_ocr import pdf_ocr_status, region_text as extract_indexed_pdf_region_text
from chat.theory_search import enqueue_document_index, prioritize_chatbot, search_document_context
from chat.research_images import image_messages, results_for_model, supports_vision
from chat.local_answer_stream import LocalAnswerStream
from chat.request_timing import ChatbotRequestTiming
from chat.latency_spans import capture, measured, span
from chat.reasoning import question_reasoning_effort, chatbot_reasoning_options, chatbot_managed_options
from chat.text_verbosity import question_text_verbosity, chatbot_text_options
from ai_reasoning import gemini_reasoning_options
from voice.voice_agent import (
    append_tool_rounds,
    chatbot_selected_categories,
    chatbot_tool_schemas_for_rounds,
    parse_streamed_voice_tool_call,
)

import ai_model_selection
from local_api_contract import UI_ORIGIN_ENV
import documents.material_workspace_support
import chat.theory_search
import common
import edition_manifest
import providers
import server_config
import voice.llama_cpp_voice_agent

from chat.chatbot_context import (
    CHATBOT_PROFILE_HOME,
    CHATBOT_PROFILE_DOCUMENT,
    reduce_tool_rounds_for_model,
    tool_schema_tokens,
    tool_rounds_tokens,
    estimate_tokens,
    turn_fingerprint,
    input_budget_limits,
    select_rag_excerpts,
    section_budget,
    CHATBOT_DYNAMIC_LABEL_RESERVE_TOKENS,
    CHATBOT_SERIALIZATION_OVERHEAD_TOKENS,
    CHATBOT_SECTION_DEFAULT_TOKENS,
    CHATBOT_RAG_TOP_K,
    CHATBOT_RAG_TYPICAL_TOKENS,
    CHATBOT_RAG_EXCERPT_MAX_TOKENS,
    CHATBOT_TURN_CACHE_MAX_ENTRIES,
    CHATBOT_TURN_CACHE_TTL_SECONDS,
    ChatbotTurnCache,
    ContextBudgetExceeded,
    excerpt_overlaps_selection,
    fit_history_messages,
    CHATBOT_DEFAULT_INPUT_BUDGET_TOKENS,
    CHATBOT_MAX_INPUT_TOKENS,
    CHATBOT_OUTPUT_RESERVE_TOKENS,
    CHATBOT_CONTEXT_HEADROOM_TOKENS,
    CHATBOT_CURRENT_ROUND_RESULT_BUDGET_TOKENS,
    CHATBOT_HISTORY_ROUND_RESULT_BUDGET_TOKENS,
    truncate_to_tokens,
)

from chat.practice_tutor_context import prepare_practice_tutor_payload

_logger = logging.getLogger(__name__)


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



# HTTP Request routing contract notes:
# Handled via api_request_handler.AILSRequestHandler:
# - "/api/pdf/translate/cancel": handled with PdfTranslationCancelled and {"type": "cancelled", "error": str(error)}

def _normalized_ui_origin() -> str:
    raw = str(os.environ.get(UI_ORIGIN_ENV) or "").strip().rstrip("/").lower()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    return ""
