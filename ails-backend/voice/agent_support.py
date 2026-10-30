"""Dependencies of realtime voice workflows."""
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
import time

import common
import pipeline_utils
import voice.llama_cpp_voice_agent
from voice.voice_agent import (
    VOICE_TOOL_SCHEMAS,
    build_realtime_voice_messages,
    parse_streamed_voice_tool_call,
    voice_tool_schemas_for_rounds,
)
