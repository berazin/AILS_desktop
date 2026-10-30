"""Generated practice solving API, separate from AI-powered PDF grading."""

from __future__ import annotations

import os
import json
import time
from typing import Mapping

import common
import pipeline_utils
import providers
import ai_compliance
import edition_manifest
from ai_reasoning import byok_reasoning_options, gemini_reasoning_options
from documents.material_workspace_support import ensure_safe_material_path
from documents import material_practice_solving as solving
from documents.material_practice_service import practice_data_path
from documents.problem_answering import build_problem_hint_messages, build_answer_grading_messages
from code_services.code_grading import parse_grading_response
from markdown_latex_utils import normalize_latex_math_syntax


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
