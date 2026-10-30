"""Realtime voice agent and video AI calls with managed/BYOK routing.

Extracted from api_server.py to isolate voice agent streaming and warmup plus
video summary, image analysis, visual event, and verification calls into a
dedicated mixin.
"""

from __future__ import annotations

import os
import json
import re
import time
import uuid

from ai_request_limits import AI_REQUEST_MAX_INPUT_TOKENS, estimate_request_tokens, prepare_generation_request
import ai_compliance
import edition_manifest
from collections.abc import Mapping
from contextlib import nullcontext

from common import PROVIDER_GEMINI, append_status_log
from pipeline_utils import (
    TaskCancelledError,
    build_image_caption_instruction,
    build_image_data_url,
    build_runtime_summary_config,
    call_gemini_image_caption_batch_with_cache,
    parse_image_caption_json_response,
)
from summary_generation.managed_costs import tag_managed_session
from summary_generation.managed_sessions import managed_video_action
from summary_generation.verification_evidence import (
    UNAVAILABLE_EVIDENCE_REPLY, _openai_web_citation_spans, verification_correction_message,
    VerificationEvidenceLookup,
)
from voice.voice_agent import (
    VOICE_TOOL_SCHEMAS,
    build_realtime_voice_messages,
    parse_streamed_voice_tool_call,
    voice_tool_schemas_for_rounds,
)

import common
import pipeline_utils
import providers
import voice.llama_cpp_voice_agent


def parse_verifier_json(content):
    """Accept one fenced JSON object when a provider ignores response_format."""
    try:
        return json.loads(content)
    except (TypeError, ValueError):
        if not isinstance(content, str):
            raise
        fenced = re.findall(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", content, re.IGNORECASE)
        if len(fenced) != 1:
            raise
        return json.loads(fenced[0])


VERIFICATION_CORRECTION_MESSAGE = verification_correction_message("validation_error")


def _video_visual_cache_prefix(messages, model_name):
    """Cache shared instructions/images, not the changing speech suffix.

    GPT-5.6/6 need explicit boundaries for independent requests. Other models
    retain their automatic caching without receiving OpenAI-only parameters.
    The builders put shared frame messages before the last user message only
    when those frames are reused across multiple speech parts.
    """
    model = str(model_name or "").removeprefix("openai/")
    if not re.fullmatch(r"gpt-(?:5\.6|6(?:\.\d+)?)-(?:luna|sol|astra)(?:-\d{4}-\d{2}-\d{2})?", model):
        return messages, {}
    if len(messages) < 2 or messages[0].get("role") != "system":
        return messages, {}
    prefix_count = 1
    if (len(messages) > 2 and messages[1].get("role") == "user"
            and messages[2].get("role") == "user"
            and isinstance(messages[1].get("content"), list) and messages[1]["content"]
            and messages[1]["content"][-1].get("type") == "image_url"):
        prefix_count = 2
    prepared = []
    for message in messages[:prefix_count]:
        content = message.get("content")
        if not isinstance(content, list) or not content:
            return messages, {}
        prepared.append({**message, "content": [*content[:-1], {
            **content[-1], "prompt_cache_breakpoint": {"mode": "explicit"},
        }]})
    return [*prepared, *messages[prefix_count:]], {"prompt_cache_options": {"mode": "explicit"}}


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
