"""Serialize paired practice markdown and question-state file mutations."""

from __future__ import annotations

import threading

PRACTICE_SET_LOCK = threading.RLock()
