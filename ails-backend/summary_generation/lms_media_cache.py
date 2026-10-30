"""Durable local copies of LMS videos, keyed by their source URL."""

from __future__ import annotations

import hashlib
import os
import shutil
import uuid
from pathlib import Path


def _cache_dir() -> Path:
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    root = Path(appdata) / "AILS" if appdata else Path.home() / ".local" / "share" / "AILS"
    return root / "lms_videos"


def _cache_stem(url: str) -> str:
    return hashlib.sha256(url.strip().encode("utf-8")).hexdigest()


def find_lms_video(url: str) -> str | None:
    directory = _cache_dir()
    if not directory.is_dir():
        return None
    for path in directory.glob(f"{_cache_stem(url)}.*"):
        if path.suffix.lower() in {".mp4", ".mkv", ".webm", ".ts"} and path.is_file() and path.stat().st_size > 0:
            return str(path)
    return None


def save_lms_video(url: str, source_path: str) -> str:
    existing = find_lms_video(url)
    if existing:
        return existing
    source = Path(source_path)
    if not source.is_file() or source.stat().st_size <= 0:
        raise ValueError("저장할 LMS 영상 파일이 비어 있습니다.")
    suffix = source.suffix.lower()
    if suffix not in {".mp4", ".mkv", ".webm", ".ts"}:
        raise ValueError("LMS 영상 파일 형식이 올바르지 않습니다.")
    directory = _cache_dir()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{_cache_stem(url)}{suffix}"
    temporary = directory / f".{_cache_stem(url)}.{uuid.uuid4().hex}.tmp"
    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return str(target)
