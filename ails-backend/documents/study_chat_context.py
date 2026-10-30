"""Optional immutable context metadata on the existing study chat turn."""
from __future__ import annotations

import json
import logging
from collections.abc import Mapping


def encode_study_chat_context(value) -> str:
    if value is None:
        return ""
    if not isinstance(value, Mapping):
        raise ValueError("practice_context must be an object.")
    encoded = json.dumps(dict(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(encoded) > 1_000_000:
        raise ValueError("practice_context is too large.")
    return encoded


def decode_study_chat_context(value: str) -> dict | None:
    try:
        context = json.loads(value)
        if isinstance(context, dict):
            return context
    except (TypeError, ValueError):
        pass
    logging.getLogger(__name__).warning("Study chat context metadata could not be decoded")
    return None
