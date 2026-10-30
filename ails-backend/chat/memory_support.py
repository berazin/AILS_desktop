"""Local-first user memory API methods."""

from __future__ import annotations

from chat.latency_spans import measured

import threading
from collections.abc import Mapping
from typing import Any

from chat.context_composer import DEFAULT_MODEL_CONTEXT_LIMIT_TOKENS, normalize_budgets
from chat.memory_settings import normalize_memory_settings
from edition_manifest import feature_enabled, require_feature
import server_config


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
