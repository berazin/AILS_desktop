"""PDF study records and per-document reading state persistence.

Extracted from api_server.py to isolate the .ails state directory, PDF outline
status, last-page state, and the sqlite-backed study store into one mixin.
"""

from __future__ import annotations
from chat.practice_tutor_context import normalize_practice_context

import os
from collections.abc import Mapping
from pathlib import Path

from common import resolve_app_path
from documents.study_manager import StudyStore
import pdf


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
