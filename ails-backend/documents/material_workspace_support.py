"""Lecture material listing, editing, trash handling, and practice generation.

Extracted from api_server.py to isolate lecture-material browsing, file and
folder operations, and practice quiz generation into a dedicated mixin.
"""

from __future__ import annotations

# Compatibility exports; document policies are owned by the document domain.
from documents.material_file_policy import MATERIAL_FILE_EXTENSIONS, EDITABLE_MATERIAL_EXTENSIONS, PRESENTATION_EXTENSIONS, ensure_safe_material_path, material_file_kind_from_ext
from documents.material_sources import MARKDOWN_IMAGE_RE, HTML_IMAGE_RE, OBSIDIAN_IMAGE_RE, MARKDOWN_LINK_RE, rewrite_report_image_sources, rewrite_report_markdown_links, rewrite_report_sources, title_from_report_path

import json
import errno
import os
import re
import shutil
import stat
import threading
import time
import uuid
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
from urllib.parse import quote, unquote

from pdf.viewer_support import load_pdf_text_cache, pdf_file_fingerprint
from common import PROVIDER_GEMINI, resolve_app_path
from documents.material_practice_service import (
    distribute_practice_counts,
    format_practice_markdown,
    material_practice_output_dir,
    practice_data_path,
    practice_set_summary,
    publish_practice_set,
    report_image_dir_names,
    sanitize_material_child_name,
    unique_material_path,
    validate_generated_quiz,
)
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.material_image_move import move_material_with_images
from documents.material_transfer import transfer_entries
from documents.material_creation import create_material_file, validate_material_creation_parent
from documents.material_directory_listing import can_descend_material_directory, list_material_directory
from documents.material_problem_progress import annotate_material_problem_progress
from system_storage import (IMAGE_DIR_NAMES, resolve_system_path, canonical_data_folder_name,
                            visible_data_folder, visible_data_folder_name)
from code_services.notebook_service import format_notebook_json, notebook_json_to_markdown, read_notebook_json_file
from documents.paperback_document import PAPERBACK_EXTENSIONS
from pipeline_utils import build_quiz_source_text, build_runtime_summary_config
from documents.presentation_service import (
    convert_presentation_to_pdf,
    extract_presentation_pdf_data,
    libreoffice_status,
    presentation_pdf_cache_path,
    read_presentation_text_for_viewer,
)

import ai_model_selection
import ai_compliance
import pdf.viewer_support
import chat.theory_search
import documents.material_practice_service
import documents.material_practice_context
import documents.paperback_document
import documents.presentation_service
import pipeline_utils
import providers
import edition_manifest


from documents.practice_generation import _PRACTICE_EVENT_INIT_LOCK


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



# api_server에서 이동: 강의자료 경로·보고서 헬퍼


































































































































from documents.material_catalog_rules import LECTURE_REPORT_RE, NEW_LECTURE_REPORT_RE, REPORT_SUFFIX, WEEK_DIR_RE, ensure_safe_material_dir, is_visible_lecture_folder, iter_report_markdown_paths, natural_sort_key, sanitize_markdown_link_title

from documents.material_file_moves import material_restore_metadata_path, move_material_to_trash, move_material_with_practice, read_material_restore_metadata, remove_material_restore_metadata, write_material_restore_metadata
