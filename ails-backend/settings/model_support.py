"""Model option catalogs, edition STT filtering, and connection self-tests.

Extracted from api_server.py to isolate model option exposure and provider
connection checks into a dedicated mixin.
"""

from __future__ import annotations

import base64
import os
from collections.abc import Mapping

from ai_compliance import compliance_metadata, require_external_provider_consent
from ai_model_selection import (
    VERIFICATION_MANAGED_MODELS,
    VISION_MANAGED_MODELS,
    migrate_legacy_model_selection,
    normalize_model_settings,
    preview_model_selections,
    resolve_model_selection,
)
from common import (
    DEEPSEEK_DEFAULT_BASE_URL,
    DEEPSEEK_DEFAULT_MODEL,
    GROQ_DEFAULT_BASE_URL,
    GROQ_DEFAULT_SUMMARY_MODEL,
    LMSTUDIO_DEFAULT_BASE_URL,
    LOCAL_DIRECTML_ENGINE,
    LOCAL_FASTER_WHISPER_ENGINE,
    LOCAL_OPENVINO_ENGINE,
    LOCAL_WHISPER_CPP_VULKAN_ENGINE,
    PROVIDER_CUSTOM,
    PROVIDER_DEEPGRAM,
    PROVIDER_DEEPSEEK,
    PROVIDER_DISABLED,
    PROVIDER_GEMINI,
    PROVIDER_GROQ,
    PROVIDER_LMSTUDIO,
    STT_MODEL_DEFAULT,
    STT_PROVIDER_OPTIONS,
    infer_stt_provider,
    resolve_faster_whisper_model_source,
)
from edition_manifest import (
    allowed_local_stt_providers,
    feature_enabled,
    require_directml_whisper_model,
    require_faster_whisper_model,
    require_local_stt_provider,
    require_whisper_cpp_model,
)
from pipeline_utils import call_openai_compatible_chat, validate_whisper_cpp_vulkan_runtime

import ai_model_selection
import accounts.auth_support
import documents.auto_review_support
import documents.problem_review_gateway
import edition_manifest
import pipeline_utils
import providers
import server_config


def available_stt_provider_options() -> list[str]:
    if not server_config.summary_stt_enabled():
        return []
    allowed_local = set(allowed_local_stt_providers())
    return [
        provider
        for provider in STT_PROVIDER_OPTIONS
        if (provider in providers.LOCAL_STT_PROVIDERS)
        and (provider not in providers.LOCAL_STT_PROVIDERS or provider in allowed_local)
    ]


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



# api_server에서 이동: 오프라인 STT 모델 선택·설치 헬퍼
import common
import edition_manifest
import hardware_capabilities
import pdf.pdf_ocr
import pipeline_utils
import voice.voice_recognition

WHISPER_CPP_VULKAN_MODEL_ORDER = (
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3-turbo-q5_0",
    "large-v3-turbo-q8_0",
    "large-v3-turbo-fp16",
    "large-v3-q5_0",
    "large-v3-fp16",
)


def select_video_whisper_cpp_model(profile=None, models=None) -> str:
    """Select the strongest allowed Vulkan model that fits host memory."""
    detected = profile or pdf.pdf_ocr.detect_ocr_performance_profile()
    available = set(models if models is not None else edition_manifest.whisper_cpp_model_options())
    if not available:
        raise ValueError("이 배포판에는 사용할 수 있는 로컬 STT 모델이 없습니다.")
    if (
        detected.logical_cpus >= 8
        and detected.total_memory_gb >= 16.0
        and detected.available_memory_gb >= 6.0
    ):
        preferred = "large-v3-turbo-q5_0"
    elif (
        detected.logical_cpus >= 6
        and detected.total_memory_gb >= 12.0
        and detected.available_memory_gb >= 4.0
    ):
        preferred = "medium"
    elif (
        detected.logical_cpus >= 4
        and detected.total_memory_gb >= 8.0
        and detected.available_memory_gb >= 2.5
    ):
        preferred = "small"
    elif detected.total_memory_gb >= 6.0 and detected.available_memory_gb >= 1.5:
        preferred = "base"
    else:
        preferred = "tiny"
    preferred_index = WHISPER_CPP_VULKAN_MODEL_ORDER.index(preferred)
    for model_id in reversed(WHISPER_CPP_VULKAN_MODEL_ORDER[: preferred_index + 1]):
        if model_id in available:
            return model_id
    raise ValueError("현재 PC에서 자동 선택할 수 있는 로컬 STT 모델이 없습니다.")


def select_voice_whisper_cpp_model(capabilities=None, profile=None, models=None) -> str:
    """Choose offline voice STT model; CPU-only hosts always use Base."""
    available = set(models if models is not None else edition_manifest.whisper_cpp_model_options())
    if "base" not in available:
        raise ValueError("오프라인 보이스 STT에는 Whisper Base 모델이 필요합니다.")
    detected = capabilities if capabilities is not None else hardware_capabilities.detect_vulkan_capabilities()
    device = detected.get("selected_device") or {}
    device_type = int(device.get("device_type") or -1)
    if not detected.get("available") or device_type not in {1, 2}:
        return "base"

    memory = int(device.get("device_memory_bytes") or 0)
    host = profile or pdf.pdf_ocr.detect_ocr_performance_profile()
    if (
        device_type == 2
        and memory >= 8 * 1024 ** 3
        and host.total_memory_gb >= 16.0
        and host.available_memory_gb >= 6.0
    ):
        preferred = "large-v3-turbo-q5_0"
    elif (
        device_type == 2
        and memory >= 6 * 1024 ** 3
        and host.total_memory_gb >= 12.0
        and host.available_memory_gb >= 4.0
    ):
        preferred = "medium"
    elif host.total_memory_gb >= 8.0 and host.available_memory_gb >= 2.5:
        preferred = "small"
    else:
        preferred = "base"
    preferred_index = WHISPER_CPP_VULKAN_MODEL_ORDER.index(preferred)
    for model_id in reversed(WHISPER_CPP_VULKAN_MODEL_ORDER[1 : preferred_index + 1]):
        if model_id in available:
            return model_id
    return "base"


def supports_two_pass_voice(profile=None) -> bool:
    host = profile or pdf.pdf_ocr.detect_ocr_performance_profile()
    return bool(
        host.logical_cpus >= 6
        and host.total_memory_gb >= 12.0
        and host.available_memory_gb >= 4.0
    )


def offline_voice_whisper_status() -> dict:
    capabilities = hardware_capabilities.detect_vulkan_capabilities()
    host = pdf.pdf_ocr.detect_ocr_performance_profile()
    device = capabilities.get("selected_device") or {}
    use_vulkan = bool(capabilities.get("available") and int(device.get("device_type") or -1) in {1, 2})
    model_id = select_voice_whisper_cpp_model(capabilities=capabilities, profile=host)
    model = pipeline_utils.whisper_cpp_model_status(model_id)
    # Non-Korean languages skip the sherpa streaming pass entirely: the
    # verified zipformer exports are incompatible with the pinned runtime, so
    # those sessions run whisper.cpp only (language set via -l).
    two_pass = supports_two_pass_voice(host) and voice.voice_recognition.VOICE_RECOGNITION_SERVICE.streaming_supported()
    sherpa = voice.voice_recognition.VOICE_RECOGNITION_SERVICE.status() if two_pass else None
    runtime_ready = os.path.isfile(os.path.join(common.WHISPER_CPP_TOOL_DIR, "whisper-cli.exe"))
    model_ready = bool(model.get("ready"))
    runtime_error = ""
    if not runtime_ready:
        runtime_error = "whisper.cpp 실행 코드가 없습니다. AILS를 다시 설치하거나 업데이트해 주세요."
    elif not model_ready and not model.get("download_required"):
        runtime_error = f"패키지에 Whisper {model_id} 모델이 없습니다. AILS를 다시 설치하거나 업데이트해 주세요."
    elif sherpa and not sherpa.get("runtime_ready"):
        runtime_error = str(sherpa.get("runtime_error") or "Sherpa-ONNX 실행 코드가 없습니다.")
    return {
        **model,
        "ready": runtime_ready and model_ready and (not sherpa or bool(sherpa.get("ready"))),
        "runtime_ready": runtime_ready and (not sherpa or bool(sherpa.get("runtime_ready"))),
        "runtime_version": "whisper.cpp",
        "core_version": "",
        "runtime_error": runtime_error,
        "download_required": bool(model.get("download_required") or (sherpa and sherpa.get("download_required"))),
        "file_size": int(model.get("file_size") or 0) + int((sherpa or {}).get("file_size") or 0),
        "selected_model": model_id,
        "two_pass": two_pass,
        "first_pass": "Sherpa-ONNX" if two_pass else "",
        "backend": (
            f"Sherpa-ONNX + whisper.cpp {'Vulkan' if use_vulkan else 'CPU'}"
            if two_pass
            else f"whisper.cpp {'Vulkan' if use_vulkan else 'CPU'}"
        ),
        "execution_provider": "Vulkan" if use_vulkan else "CPU",
        "use_vulkan": use_vulkan,
        "precision": "GGML",
        "vad": "AILS VAD",
    }


def install_offline_voice_models(confirmed: bool, emit=None) -> dict:
    if confirmed is not True:
        raise ValueError("오프라인 보이스 모델 다운로드는 사용자 확인 후에만 실행할 수 있습니다.")
    status = offline_voice_whisper_status()
    if status["two_pass"]:
        sherpa = voice.voice_recognition.VOICE_RECOGNITION_SERVICE.status()
        if not sherpa["ready"]:
            voice.voice_recognition.VOICE_RECOGNITION_SERVICE.install_model(True, emit)
    whisper = pipeline_utils.whisper_cpp_model_status(status["selected_model"])
    if not whisper["ready"]:
        pipeline_utils.install_whisper_cpp_model(status["selected_model"], confirmed=True, emit=emit)
    return offline_voice_whisper_status()
TEST_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAKAAAABgCAIAAAAVRe7OAAADcklEQVR4nO3cPUvrUADG8fYqBEXQyZfoB3ATLYLldKmJGR0EBSfFRRfFwQ/gKro4iKDSIjiK0K2iCBWruDi2gpsR8WWoDiUYhHOHA4eLXJLg7fV6nz6/6fQkkQN/j5FAGpdSxgjXj3+9APq7GBgcA4NjYHAMDI6BwTEwOAYGx8DgGoMPx+Pxr1oJfV7A40ju4PrewQqfV39boX9iuYPBMTA4BgbHwOAYGBwDg2NgcAwMjoHBMTA4BgbHwOAYGBwDg2NgcAwMjoHBMTA4BgbHwOAYGBwDg2NgcAwMjoHB1Tjwzs6OYRiPj4/qY1tb24eBdnV15ThOOp0eGRlxXVfPZ7PZRCKRTCYTicTu7u6Hy13X7e/vf3h4qO2ykclAUc751ejo6NLSUiaTUR9bW1s/DLS+vj7XdaWU+/v7ExMTajKfzwshKpWKlLJSqQghjo6O9OWe5wkhLi4uoq8HXmigWgauVquWZV1fX4+NjYUG7urqurm5kVL6vn96eqomLcs6Pz/X5xSLRdu29eVTU1Pb29sRF1MnYl8Z+ODgYHV1VUo5MDDw9vYWHDibzXZ2ds7MzJycnOhJ0zQ9z9MfPc8zTVNdvr6+Pjs7G3El9SMWFqiW9+BcLre3tzc0NHR/f18oFIJPnp6eLpVKqVRqcXFxeXn5t+dIKdXbc77vb2xs8Nb7GX/4C6K9v78nk0k1zufzCwsLATv46empWCzqcUdHhxrbtq3npZRnZ2eO40gpW1paXl9fbdve3NyMspj6EQsLVLPAhUJhbm5OjavVam9vb0Dg5+fn7u7u29tbKWW5XB4cHFTzh4eHQoiXlxf9T9bx8bG+3HVd0zRLpVKU9dSJWFigSC+AR5HL5YaHh9W4ubm5vb29XC7ro77vp1IpNRZCrKysbG1tjY+PNzU1NTQ0ZDIZdchxnLu7u3Q6bRiG7/vz8/OWZekf0tPTs7a2Njk5eXl5aRhGrVaOLR789r66BfIN/28rNBCfZIFjYHAMDI6BwTEwOAYGx8DgGBgcA4NjYHAMDI6BwTEwOAYGx8DgGBgcA4NjYHAMDI6BwTEwOAYGx8DgGBgcA4NjYHAMDI6BwTEwOAYGx8DgGBgcA4NjYHAMDI6BwTEwOAYG1xj9u3rof8QdXN9fhEb/O+5gcAwMjoHBMTA4BgbHwOAYGBwDx7D9BDBx+JGHeHoPAAAAAElFTkSuQmCC"
