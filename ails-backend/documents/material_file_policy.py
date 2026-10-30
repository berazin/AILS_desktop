"""Supported document formats and the existing workspace/external-file boundary."""

from __future__ import annotations

import os
from system_storage import resolve_system_path
from documents.paperback_document import PAPERBACK_EXTENSIONS

MATERIAL_FILE_EXTENSIONS = {".md", ".txt", ".pdf", ".ipynb", ".ppt", ".pptx", ".docx", ".xlsx", ".csv", ".hwp", ".hwpx", ".html", ".htm", *PAPERBACK_EXTENSIONS}

EDITABLE_MATERIAL_EXTENSIONS = {".md", ".ipynb"}

from edition_manifest import feature_enabled as _feature_enabled

if not _feature_enabled("ide"):
    MATERIAL_FILE_EXTENSIONS.discard(".ipynb")
    EDITABLE_MATERIAL_EXTENSIONS.discard(".ipynb")

PRESENTATION_EXTENSIONS = {".ppt", ".pptx"}

def material_file_kind_from_ext(ext: str) -> str:
    return ext.lower().lstrip(".") or "file"

def ensure_safe_material_path(file_path: str, base_dir: str, *, allow_external: bool = False) -> str:
    normalized = resolve_system_path(os.path.abspath(str(file_path or "").strip()))
    base = os.path.abspath(str(base_dir or "").strip())
    from documents.external_documents import is_external_document
    if allow_external and is_external_document(normalized) and os.path.splitext(normalized)[1].lower() in MATERIAL_FILE_EXTENSIONS:
        return normalized
    if not base or not os.path.isdir(base):
        raise FileNotFoundError("강의자료 저장 폴더를 찾을 수 없습니다.")
    if not normalized or not os.path.isfile(normalized):
        raise FileNotFoundError("강의자료 파일을 찾을 수 없습니다.")
    try:
        common = os.path.commonpath([normalized, base])
    except ValueError:
        common = ""
    if common != base:
        raise ValueError("강의자료 저장 폴더 안의 파일만 변경할 수 있습니다.")
    if os.path.normcase(os.path.commonpath([os.path.realpath(normalized), os.path.realpath(base)])) != os.path.normcase(os.path.realpath(base)):
        raise ValueError("강의자료 저장 폴더 안의 파일만 변경할 수 있습니다.")
    if os.path.splitext(normalized)[1].lower() not in MATERIAL_FILE_EXTENSIONS:
        raise ValueError("지원하는 강의자료 파일만 변경할 수 있습니다.")
    return normalized
