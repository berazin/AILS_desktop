"""HTTP composition for account-scoped Insight Books; domain rules live in documents."""
from __future__ import annotations

import hashlib
import os
import threading
from collections.abc import Mapping

import credential_store
from edition_manifest import require_feature

from documents.insight_book import runtime
from documents.insight_book.contracts import digest, settings, text
from documents.insight_book.prompts import messages
from documents.insight_book.retrieval import shared_encoder
from documents.insight_book.service import InsightBookService
from documents.insight_book.store import InsightStore
from documents.insight_book.access import InsightAccountAccess
from documents.insight_book.timing import measure_call, provider_timing_callback
from ai_reasoning import normalize_reasoning_effort

_access_initialization_lock = threading.RLock()


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
