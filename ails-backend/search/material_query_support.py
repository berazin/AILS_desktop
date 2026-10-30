"""Cross-material search API methods (title/body keywords + semantic vectors)."""

from __future__ import annotations

from collections.abc import Mapping

import chat.theory_search
from pdf.pdf_ocr_search import search_materials as search_materials_keyword
from documents.material_search_service import MaterialSearchService


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
