"""Summary task queueing, engine result collection, retries, and status payloads.

Extracted from api_server.py to isolate everything that drives the background
engine: task registration, result collection, retry candidates on disk, report
refreshing, and status endpoint payloads.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import time
import threading
from collections.abc import Mapping

import ai_model_selection
from documents.clsf_tools import organize_reports
from summary_generation.managed_sessions import ManagedStageSessions
from summary_generation.managed_costs import apply_settlements, merge_settlements, persist_settlement_result, prior_settlements, read_settlements, tag_managed_session
from common import (
    BASE_PROMPT_TEMPLATE,
    LOCAL_WHISPER_CPP_VULKAN_ENGINE,
    PROVIDER_GEMINI,
    STT_MODEL_DEFAULT,
    build_retry_result_content,
    clear_resume_state,
    collect_retry_entries_from_disk,
    infer_stt_provider,
    remove_retry_registry_entry,
    resolve_app_path,
)
from edition_manifest import (
    EditionFeatureDisabled,
    require_feature,
    require_local_stt_provider,
    require_summary_task,
    summary_task_allowed,
)
from pipeline_utils import (
    extract_youtube_sources,
    install_whisper_cpp_model,
    safe_float,
    safe_remove,
)
from retry_candidate_logs import normalize_retry_candidate_logs
from server_config import config_for_ui
from task_persistence import build_resume_state_path, load_resume_media, load_resume_state, save_resume_state

import ai_model_selection
import documents.material_workspace_support
import settings.model_support
import common
import edition_manifest
import pipeline_utils
import providers
import server_config



from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



# api_server에서 이동: 엔진 작업 상태·보고서 헬퍼
import common

def validate_video_summary_verification_config(config: Mapping) -> bool:
    enabled = bool(config.get("video_summary_verification_enabled", False))
    return enabled
UNSELECTED_FILE = "선택된 파일 없음"
def build_youtube_report_title(base_title: str, video_title: str, *, index: int | None = None, playlist: bool = False) -> str:
    base = common.sanitize_title(str(base_title or "").strip())
    if not base:
        return ""
    if ("_YT_" in base or "_\uc720\ud29c\ube0c_" in base) and not playlist:
        return base
    video = common.sanitize_title(str(video_title or "").strip()) or "YouTube"
    prefix = f"{int(index):02d}_" if playlist and index else ""
    return common.sanitize_title(f"{base}_YT_{prefix}{video}")
def is_unselected_file_value(value: str) -> bool:
    normalized = str(value or "").strip()
    return not normalized or normalized == UNSELECTED_FILE
STATUS_TIMESTAMP_RE = re.compile(r"^\[\d{2}:\d{2}:\d{2}\]\s*")


def clean_status_log_message(entry: object) -> str:
    message = STATUS_TIMESTAMP_RE.sub("", str(entry or "")).strip()
    message = re.sub(r"\s+", " ", message)
    if len(message) > 120:
        return message[:117].rstrip() + "..."
    return message


def clamp_progress(value: float, is_running: bool) -> int:
    percent = int(round(value))
    if is_running:
        return max(1, min(99, percent))
    return max(0, min(100, percent))


def estimate_status_progress(logs: list, is_running: bool) -> dict:
    if not is_running:
        return {"percent": 0, "label": "대기 중", "indeterminate": False}

    percent = 3.0
    label = "작업 준비 중"

    for raw in logs or []:
        message = clean_status_log_message(raw)
        if not message:
            continue

        video_match = re.search(
            r"영상 분석 진행:\s*([0-9]+(?:\.[0-9]+)?)%\s*\([^)]*장면\s*(\d+)개\)",
            message,
        )
        if video_match:
            video_percent = max(0.0, min(100.0, float(video_match.group(1))))
            percent = max(percent, 5.0 + video_percent * 0.30)
            label = f"영상 분석 {video_percent:.0f}% · 장면 {video_match.group(2)}개"
            continue

        chunk_match = re.search(r"요약 청크 (처리 중|완료):\s*(\d+)\s*/\s*(\d+)", message)
        if chunk_match:
            state, current_raw, total_raw = chunk_match.groups()
            current = max(1, int(current_raw))
            total = max(1, int(total_raw))
            done = current if state == "완료" else max(0, current - 1)
            percent = max(percent, 78.0 + (done / total) * 18.0)
            label = f"요약 청크 {current}/{total}"
            continue

        image_batch_match = re.search(r"이미지 분석 배치 처리 중:\s*(\d+)\s*\((\d+)장,\s*남은\s*(\d+)장\)", message)
        if image_batch_match:
            batch_index = max(1, int(image_batch_match.group(1)))
            current_count = max(1, int(image_batch_match.group(2)))
            remaining_count = max(0, int(image_batch_match.group(3)))
            processed_estimate = max(0, (batch_index - 1) * current_count)
            total_estimate = max(current_count, processed_estimate + current_count + remaining_count)
            percent = max(percent, 42.0 + (processed_estimate / total_estimate) * 28.0)
            label = f"이미지 분석 {batch_index}번째 배치"
            continue

        download_match = re.search(r"세그먼트 다운로드 시작:\s*\d+\s*~\s*\d+\s*\((\d+)개\)", message)
        if download_match:
            percent = max(percent, 5.0)
            label = f"세그먼트 다운로드 중 ({download_match.group(1)}개)"
            continue

        progress_steps = (
            ("작업 시작", 3.0, "작업 시작"),
            ("Media Foundation 영상 분석 시작", 5.0, "영상 분석 중"),
            ("공통 영상 분석 완료", 36.0, "영상 분석 완료"),
            ("세그먼트 다운로드 완료", 15.0, "세그먼트 다운로드 완료"),
            ("세그먼트 병합 시작", 18.0, "세그먼트 병합 중"),
            ("세그먼트 병합 완료", 22.0, "세그먼트 병합 완료"),
            ("장면 캡처 이미지 추출 중", 25.0, "장면 캡처 중"),
            ("STT용 오디오 정리 시작", 28.0, "STT 오디오 정리 중"),
            ("STT용 오디오 정리 완료", 34.0, "STT 오디오 정리 완료"),
            ("장면 캡처 완료", 36.0, "장면 캡처 완료"),
            ("음성 인식 실행 중", 45.0, "음성 인식 중"),
            ("STT 분석 시작", 45.0, "음성 인식 중"),
            ("음성 인식 완료", 64.0, "음성 인식 완료"),
            ("STT 완료", 66.0, "STT 완료"),
            ("이미지 분석 시작", 42.0, "이미지 분석 중"),
            ("장면 이미지 분석 완료", 70.0, "이미지 분석 완료"),
            ("PDF 이미지 분석 완료", 70.0, "이미지 분석 완료"),
            ("AI 요약 집필 준비 중", 75.0, "요약 준비 중"),
            ("청크 기반 요약을 시작", 78.0, "청크 기반 요약 중"),
            ("마지막 파트 보강 생성 중", 96.0, "마지막 파트 보강 중"),
            ("최종 정리본 저장", 98.0, "정리본 저장 중"),
            ("정리본 저장 완료", 99.0, "정리본 저장 완료"),
            ("이미지 링크 복구 작업 완료", 99.0, "이미지 링크 복구 완료"),
            ("LaTeX 문법 후처리 작업 완료", 99.0, "LaTeX 후처리 완료"),
            ("오류 발생", percent, "오류 발생"),
            ("취소", percent, "취소 처리 중"),
        )
        for needle, step_percent, step_label in progress_steps:
            if needle in message:
                percent = max(percent, step_percent)
                label = step_label
                break

    return {"percent": clamp_progress(percent, is_running), "label": label, "indeterminate": False}


import logging
_engine_logger = logging.getLogger(__name__)
