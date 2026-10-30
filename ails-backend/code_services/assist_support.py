"""AI code review and edit workflows for the code sandbox."""

from __future__ import annotations

import json
import os
import re

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
)
from language_support import language_display_name
from pipeline_utils import call_openai_compatible_chat
import providers


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
