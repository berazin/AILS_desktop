"""Read workspace document text without starting OCR, conversion, or AI models."""
from __future__ import annotations

import json
import os
from pathlib import Path

from documents.paperback_document import PAPERBACK_EXTENSIONS
from system_storage import DATA_INTERNAL_DIRS, visible_data_folder

TEXT_EXTENSIONS = {".md", ".txt", ".ipynb"}
PRESENTATION_EXTENSIONS = {".ppt", ".pptx"}
MATERIAL_EXTENSIONS = TEXT_EXTENSIONS | PRESENTATION_EXTENSIONS | PAPERBACK_EXTENSIONS | {".pdf"}
CODE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".c", ".h", ".cpp", ".hpp", ".cs", ".java", ".rs", ".go", ".sql", ".html", ".css", ".r", ".m", ".sh", ".ps1"}


def inside_root(path: str, root: str) -> bool:
    """Check a path against the already resolved workspace root."""
    try:
        base = os.path.normcase(os.path.abspath(root))
        return os.path.commonpath([os.path.normcase(os.path.realpath(path)), base]) == base
    except (OSError, ValueError):
        return False


def workspace_paths(root: str, *, include_code: bool = False):
    from ide_policy import file_allowed
    # Match the materials tree's visible folders; do not traverse trash, sidecars,
    # generated code folders, or junctions pointing outside the workspace.
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(name for name in dirs if name
                         and (not name.startswith(".") and name.casefold() not in DATA_INTERNAL_DIRS if include_code
                              else visible_data_folder(os.path.join(directory, name)))
                         and inside_root(os.path.join(directory, name), root))
        for name in sorted(files, key=str.casefold):
            path = os.path.join(directory, name)
            if (not name.startswith(".") and Path(name).suffix.casefold() in (MATERIAL_EXTENSIONS | CODE_EXTENSIONS if include_code else MATERIAL_EXTENSIONS)
                    and file_allowed(path) and inside_root(path, root) and os.path.isfile(path)):
                yield path


def document_text(path: str) -> str:
    from ide_policy import require_document
    require_document(path)
    from documents.answer_key_visibility import hidden
    if hidden(path):
        return ""
    extension = Path(path).suffix.casefold()
    if extension in {".md", ".txt"} | CODE_EXTENSIONS:
        return Path(path).read_text(encoding="utf-8-sig", errors="replace")
    if extension == ".ipynb":
        notebook = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        if not isinstance(notebook, dict) or not isinstance(notebook.get("cells"), list):
            return ""
        parts = []
        for cell in notebook["cells"]:
            if not isinstance(cell, dict):
                continue
            source = cell.get("source", "")
            if isinstance(source, list):
                parts.append("".join(item for item in source if isinstance(item, str)))
            elif isinstance(source, str):
                parts.append(source)
        return "\n".join(parts)
    if extension in PAPERBACK_EXTENSIONS:
        # Only reuse a current viewer cache. Search must not run a native parser.
        from documents.paperback_document import read_cached_paperback_document
        cached = read_cached_paperback_document(path)
        return cached[1] if cached else ""
    return ""


def pdf_sources(paths: list[str]) -> dict[str, str]:
    """Map indexed PDF paths to workspace paths (including converted slides)."""
    result = {}
    for path in paths:
        extension = Path(path).suffix.casefold()
        if extension == ".pdf":
            result[path] = path
        elif extension in PRESENTATION_EXTENSIONS:
            from documents.presentation_service import presentation_pdf_cache_path
            try:
                cached = presentation_pdf_cache_path(path)
                if os.path.isfile(cached):
                    result[cached] = path
            except OSError:
                continue
    return result
