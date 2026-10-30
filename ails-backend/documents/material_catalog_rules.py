"""Catalog names, ordering and directory rules."""
from system_storage import resolve_system_path
from system_storage import visible_data_folder
from system_storage import visible_data_folder_name
import os
import re

REPORT_SUFFIX = "정리본.md"


LECTURE_REPORT_RE = re.compile(r"^(?P<prefix>.+)_(?P<week>\d+)\uc8fc\ucc28(?P<sequence>\d+)(?:[\s_]*(?:\uc0c1\uc138(?:\s*\uc815\ub9ac)?|\uc694\uc57d(?:\s*\uc815\ub9ac)?))?(?:\uc815\ub9ac\ubcf8)*\.md$", re.IGNORECASE)


NEW_LECTURE_REPORT_RE = re.compile(r"^(?P<week>\d+)\uc8fc\ucc28(?P<sequence>\d+)\.md$", re.IGNORECASE)


WEEK_DIR_RE = re.compile(r"^(?P<week>\d+)\uc8fc\ucc28$", re.IGNORECASE)


def iter_report_markdown_paths(base_dir: str):
    ignored_dirs = {"_images", "_resume", "_link", "__pycache__"}
    if not base_dir or not os.path.isdir(base_dir):
        return []
    report_paths = []
    for root, dirs, files in os.walk(base_dir):
        dirs[:] = [name for name in dirs if visible_data_folder(os.path.join(root, name))]
        for file_name in files:
            if file_name.lower().endswith(".md"):
                report_paths.append(os.path.join(root, file_name))
    report_paths.sort(key=lambda path: os.path.getmtime(path), reverse=True)
    return report_paths


def sanitize_markdown_link_title(title: str) -> str:
    cleaned = re.sub(r"[\r\n\t\[\]\(\),]+", " ", str(title or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:80].strip() or "챗봇 답변"


def is_visible_lecture_folder(name: str) -> bool:
    normalized = str(name or "")
    return visible_data_folder_name(normalized)


def natural_sort_key(s: str) -> list:
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', str(s or ""))]


def ensure_safe_material_dir(dir_path: str, base_dir: str, *, allow_base: bool = True) -> str:
    base = os.path.abspath(str(base_dir or "").strip())
    if not base or not os.path.isdir(base):
        raise FileNotFoundError("Lecture material base folder was not found.")
    raw_path = str(dir_path or "").strip()
    normalized = resolve_system_path(os.path.abspath(raw_path)) if raw_path else base
    if not normalized or not os.path.isdir(normalized):
        raise FileNotFoundError("Lecture material folder was not found.")
    try:
        common = os.path.commonpath([normalized, base])
    except ValueError:
        common = ""
    if common != base:
        raise ValueError("Only folders inside the lecture material base folder can be used.")
    if not allow_base and os.path.normcase(normalized) == os.path.normcase(base):
        raise ValueError("The base lecture material folder cannot be used for this action.")
    return normalized
