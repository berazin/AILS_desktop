"""Compose existing retrieval, scoped document reading, rendering and arithmetic."""
from pathlib import Path

import common
from chat.research_images import page_image, supports_vision
from chat.safe_calculator import calculate
from documents.research_documents import document_outline, grep_search, read_context, safe_path


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
