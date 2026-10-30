"""LMS course discovery, report deduplication and staged VOD registration.

Browser/authentication lifetime stays in ApiLmsBrowserMixin. Scan pages are
closed before queued workers can reuse its CDP session.
"""

from __future__ import annotations

import os
import re
from typing import Mapping
from urllib.parse import urljoin, urlparse

from common import LOCAL_WHISPER_CPP_VULKAN_ENGINE
from edition_manifest import require_feature, require_local_stt_provider
from pipeline_utils import safe_float, validate_whisper_cpp_vulkan_runtime
from server_config import save_config
from lms_resources import download_lms_resource
from web_media_downloader import get_lms_browser_cdp_ws_url
import jobs.summary_task_support
import documents.material_workspace_support
import settings.model_support
import edition_manifest

def _lms_report_title_key(title):
    """Compare persisted task/report titles across the summary suffix migration."""
    normalized = str(title or "").strip()
    if normalized.endswith(".md"):
        normalized = normalized[:-3]
    match = re.search(r"\s+(상세|요약)(?:\s*정리(?:본)?)+$", normalized)
    if match:
        return normalized[:match.start()] + f" {match[1]}정리본"
    return normalized


def existing_lms_reports(base_dir, detail_mode, incomplete_titles=()):
    """Recognize saved report names without changing or reorganizing the files."""
    reports = set()
    incomplete = {_lms_report_title_key(title) for title in incomplete_titles}
    named_report = re.compile(
        r"^(?P<prefix>.+)_(?P<week>\d+)주차(?P<sequence>\d+)"
        r"[\s_]+(?P<mode>상세(?:\s*정리)?|요약(?:\s*정리)?)(?:정리본)*\.md$"
    )
    materials = documents.material_workspace_support
    for root, dirs, files in os.walk(base_dir) if base_dir else ():
        dirs[:] = [name for name in dirs if not name.startswith((".", "_"))]
        for filename in files:
            path = os.path.join(root, filename)
            if _lms_report_title_key(materials.title_from_report_path(path)) in incomplete:
                continue
            match = named_report.match(filename)
            if match:
                mode_is_detailed = match["mode"].startswith("상세")
                if (detail_mode == "detailed") != mode_is_detailed:
                    continue
            match = match or materials.LECTURE_REPORT_RE.match(filename)
            short_match = materials.NEW_LECTURE_REPORT_RE.match(filename)
            if not match and not short_match:
                continue
            try:
                if os.path.getsize(path) == 0:
                    continue
            except OSError:
                continue
            if match:
                prefix = match["prefix"]
            else:
                parts = os.path.relpath(root, base_dir).split(os.sep)
                if parts == ["."]:
                    continue
                prefix = parts[-2] if len(parts) >= 2 else parts[0]
                match = short_match
            reports.add((prefix, int(match["week"]), int(match["sequence"])))
    return reports


def lms_scan_academic_period(payload: Mapping, config: Mapping) -> tuple[int, int]:
    try:
        grade_value = payload.get("grade") if payload.get("grade") is not None else config.get("current_grade", 2)
        semester_value = payload.get("semester") if payload.get("semester") is not None else config.get("current_semester", 1)
        grade = int(grade_value)
        semester = int(semester_value)
    except (TypeError, ValueError) as error:
        raise ValueError("LMS 대상 학년과 학기는 숫자여야 합니다.") from error
    if not 1 <= grade <= 6:
        raise ValueError("LMS 대상 학년은 1~6학년이어야 합니다.")
    if semester not in {1, 2}:
        raise ValueError("LMS 대상 학기는 1학기 또는 2학기여야 합니다.")
    return grade, semester



from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading
