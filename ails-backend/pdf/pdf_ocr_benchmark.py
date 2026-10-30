"""OCR performance profiling and model benchmarking.

Extracted from pdf_ocr.py to isolate hardware profiling, benchmarking,
and model selection logic into an independent module.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import multiprocessing
import os
import queue as queue_module
import re
import statistics
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Any

from PIL import Image, ImageDraw, ImageFont

import logging
from language_support import normalize_app_language

_logger = logging.getLogger(__name__)

# Import needed symbols from pdf_ocr (or types)
# Note: Since this module is imported at the bottom of pdf_ocr,
# importing symbols directly from pdf_ocr is completely safe.
from pdf.pdf_ocr_types import (
    AUTO_OCR_MODEL_VARIANT,
    DEFAULT_LANGUAGE,
    DEFAULT_OCR_MODEL_VARIANT,
    DmlOcrExecutionError,
    OCR_BENCHMARK_ALGORITHM_VERSION,
    OCR_BENCHMARK_DOCUMENT_VERSION,
    OCR_MODEL_BENCHMARK_VERSION,
    OCR_MODEL_PRESETS,
    OCR_MODEL_SELECTION_POLICY_VERSION,
    OCR_MODEL_VARIANT_ORDER,
    OCR_PERFORMANCE_PROFILE_VERSION,
    OCR_PRESET_VERSION,
    OCR_PROVIDER_PRIORITY,
    OCR_VERSION,
    OcrPerformanceProfile,
    OcrWord,
    PdfOcrCancelledError,
    PdfOcrUnavailableError,
    MemoryStatus,
    _normalize_ocr_model_variant,
    _ocr_render_scale,
    _ocr_batch_pages,
    _model_limited_ocr_performance_profile,
)


def __getattr__(name: str) -> Any:
    import pdf.pdf_ocr as pdf_ocr
    return getattr(pdf_ocr, name)


_profile_store_lock = threading.Lock()

def _core_ocr():
    import pdf.pdf_ocr as pdf_ocr
    return pdf_ocr

def _available_ocr_execution_providers(*args, **kwargs):
    return _core_ocr()._available_ocr_execution_providers(*args, **kwargs)

def _create_source_snapshot(*args, **kwargs):
    return _core_ocr()._create_source_snapshot(*args, **kwargs)

def _discard_engine(*args, **kwargs):
    return _core_ocr()._discard_engine(*args, **kwargs)

def _dml_device_id(*args, **kwargs):
    return _core_ocr()._dml_device_id(*args, **kwargs)

def _locked_ocr_pdf(*args, **kwargs):
    return _core_ocr()._locked_ocr_pdf(*args, **kwargs)

def _ocr_model_names(*args, **kwargs):
    return _core_ocr()._ocr_model_names(*args, **kwargs)

def _ocr_provider_device_id(*args, **kwargs):
    return _core_ocr()._ocr_provider_device_id(*args, **kwargs)

def _prepare_pdfium_source(*args, **kwargs):
    return _core_ocr()._prepare_pdfium_source(*args, **kwargs)

def _queued_ocr_job(*args, **kwargs):
    return _core_ocr()._queued_ocr_job(*args, **kwargs)

def _raise_if_ocr_cancelled(*args, **kwargs):
    return _core_ocr()._raise_if_ocr_cancelled(*args, **kwargs)

def _recognize_batch(*args, **kwargs):
    return _core_ocr()._recognize_batch(*args, **kwargs)

def _render_pdf_page(*args, **kwargs):
    return _core_ocr()._render_pdf_page(*args, **kwargs)

def _render_pdf_pages(*args, **kwargs):
    return _core_ocr()._render_pdf_pages(*args, **kwargs)

def install_ocr_model(*args, **kwargs):
    return _core_ocr().install_ocr_model(*args, **kwargs)

def ocr_dependency_status(*args, **kwargs):
    return _core_ocr().ocr_dependency_status(*args, **kwargs)

def ocr_model_status(*args, **kwargs):
    return _core_ocr().ocr_model_status(*args, **kwargs)



def _active_detect_ocr_performance_profile() -> OcrPerformanceProfile:
    import sys
    mod = sys.modules.get('pdf.pdf_ocr')
    target = getattr(mod, "detect_ocr_performance_profile", None) if mod is not None else None
    if target is not None and target is not detect_ocr_performance_profile:
        return target()
    return detect_ocr_performance_profile()

def detect_ocr_performance_profile() -> OcrPerformanceProfile:
    logical_cpus = max(1, os.cpu_count() or 1)
    available_memory = 0
    total_memory = 0
    if os.name == "nt":
        try:
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("length", ctypes.c_ulong),
                    ("memory_load", ctypes.c_ulong),
                    ("total_physical", ctypes.c_ulonglong),
                    ("available_physical", ctypes.c_ulonglong),
                    ("total_page_file", ctypes.c_ulonglong),
                    ("available_page_file", ctypes.c_ulonglong),
                    ("total_virtual", ctypes.c_ulonglong),
                    ("available_virtual", ctypes.c_ulonglong),
                    ("available_extended_virtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                available_memory = int(status.available_physical)
                total_memory = int(status.total_physical)
        except Exception:
            available_memory = 0
    if not available_memory:
        try:
            available_memory = int(os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"))
            total_memory = int(os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"))
        except (AttributeError, OSError, ValueError):
            available_memory = 8 * 1024**3
            total_memory = available_memory
    if not total_memory:
        total_memory = available_memory

    providers = _available_ocr_execution_providers()
    gpu_provider = next((name for name in OCR_PROVIDER_PRIORITY if name in providers), None)
    available_memory_gb = available_memory / 1024**3
    total_memory_gb = total_memory / 1024**3
    if gpu_provider and available_memory_gb >= 8:
        batch_pages = 10
    elif gpu_provider and available_memory_gb >= 4:
        batch_pages = 6
    elif gpu_provider and available_memory_gb >= 2:
        batch_pages = 3
    else:
        batch_pages = 2 if logical_cpus >= 8 else 1
    # Large DirectML matrix batches can reset the Windows GPU device even when
    # shared memory is plentiful. Keep the first attempt moderately parallel
    # and retain a smaller automatic retry profile below.
    if gpu_provider == "DmlExecutionProvider" and total_memory_gb >= 24 and available_memory_gb >= 8:
        detector_batch = 2
        recognition_batch = 16
    elif gpu_provider == "CUDAExecutionProvider" and total_memory_gb >= 24 and available_memory_gb >= 8:
        detector_batch = 4
        recognition_batch = 64
    elif gpu_provider and available_memory_gb >= 8:
        detector_batch = 2
        recognition_batch = 32
    elif gpu_provider and available_memory_gb >= 4:
        detector_batch = 2
        recognition_batch = 16
    else:
        detector_batch = 1
        recognition_batch = 8
    # PDFium 문서 접근은 동일 프로세스의 여러 스레드에서 병렬화하면
    # 긴 문서에서 간헐적으로 FPDF_ERR_FORMAT을 낼 수 있다. 전용 렌더
    # 스레드 하나가 다음 배치를 준비하고 GPU OCR과 겹쳐 실행한다.
    render_workers = 1
    env_batch = os.environ.get("AILS_OCR_BATCH_PAGES")
    batch_pages = max(1, min(10, int(env_batch) if env_batch else batch_pages))
    env_det = os.environ.get("AILS_OCR_DETECTOR_BATCH")
    detector_batch = max(
        1,
        min(batch_pages, 4, int(env_det) if env_det else detector_batch),
    )
    env_rec = os.environ.get("AILS_OCR_RECOGNITION_BATCH")
    recognition_batch = max(
        1,
        min(128, int(env_rec) if env_rec else recognition_batch),
    )
    return OcrPerformanceProfile(
        logical_cpus=logical_cpus,
        total_memory_gb=round(total_memory_gb, 1),
        available_memory_gb=round(available_memory_gb, 1),
        gpu_provider=gpu_provider,
        batch_pages=batch_pages,
        detector_batch=detector_batch,
        recognition_batch=recognition_batch,
        render_workers=render_workers,
        prefetch_pages=batch_pages * 2,
    )


def select_ocr_model_variant(
    profile: OcrPerformanceProfile | None = None,
) -> str:
    """Select a canonical PP-OCRv6 tier from stable hardware limits."""

    detected = profile or detect_ocr_performance_profile()
    accelerated = detected.gpu_provider in {
        "DmlExecutionProvider",
        "CUDAExecutionProvider",
        "OpenVINOExecutionProvider",
    }
    if (
        accelerated
        and detected.logical_cpus >= 8
        and detected.total_memory_gb >= 16.0
        and detected.available_memory_gb >= 6.0
    ):
        return "medium"
    if (
        accelerated
        and detected.logical_cpus >= 4
        and detected.total_memory_gb >= 8.0
        and detected.available_memory_gb >= 2.5
    ):
        return "small"
    return "tiny"


def resolve_ocr_model_variant(
    model_variant: str | None,
    emit: Callable[[dict], None] | None = None,
    *,
    allow_cpu: bool = False,
    language: str = DEFAULT_LANGUAGE,
) -> str:
    """Resolve ``auto`` at the API boundary and emit the selected tier."""

    requested = str(model_variant or AUTO_OCR_MODEL_VARIANT).strip().lower()
    profile = _active_detect_ocr_performance_profile()
    if profile.gpu_provider not in {
        "DmlExecutionProvider",
        "CUDAExecutionProvider",
        "OpenVINOExecutionProvider",
    }:
        providers = _available_ocr_execution_providers()
        if "CPUExecutionProvider" not in providers:
            raise PdfOcrUnavailableError(
                "ONNX Runtime CPU OCR 공급자를 찾지 못했습니다. OCR 런타임을 다시 설치해 주세요."
            )
        if not allow_cpu:
            raise PdfOcrUnavailableError(
                "GPU 가속을 사용할 수 없습니다. 사용자 동의 후 CPU OCR로 다시 요청해 주세요."
            )
    model_record = (
        _benchmarked_ocr_model_record(profile, language)
        if requested in {"", AUTO_OCR_MODEL_VARIANT}
        else None
    )
    selected = (
        model_record["model_variant"]
        if model_record
        else select_ocr_model_variant(profile)
        if requested in {"", AUTO_OCR_MODEL_VARIANT}
        else _normalize_ocr_model_variant(requested)
    )
    if emit:
        emit({
            "type": "model_selection",
            "selection_mode": (
                "automatic"
                if requested in {"", AUTO_OCR_MODEL_VARIANT}
                else "explicit"
            ),
            "selection_policy_version": OCR_MODEL_SELECTION_POLICY_VERSION,
            "selection_source": "benchmark" if model_record else "hardware",
            "model_variant": selected,
            "gpu_provider": profile.gpu_provider or "CPUExecutionProvider",
            "cpu_fallback": profile.gpu_provider is None,
            "logical_cpus": profile.logical_cpus,
            "total_memory_gb": profile.total_memory_gb,
            "available_memory_gb": profile.available_memory_gb,
        })
    return selected


def _performance_profile_store_path() -> str:
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir()
    directory = os.path.join(appdata, "AILS")
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, "ocr_performance_profiles.json")


def ensure_ocr_benchmark_document() -> str:
    """Create a stable image-only benchmark PDF when the user has no PDF."""
    from PIL import ImageDraw, ImageFont

    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir()
    directory = os.path.join(appdata, "AILS", "benchmark")
    os.makedirs(directory, exist_ok=True)
    target = os.path.join(directory, f"ocr-benchmark-v{OCR_BENCHMARK_DOCUMENT_VERSION}.pdf")
    if os.path.isfile(target):
        return target

    try:
        font = ImageFont.truetype("arial.ttf", 32)
        small_font = ImageFont.truetype("arial.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
        small_font = font

    pages: list[Image.Image] = []
    temporary = f"{target}.{uuid.uuid4().hex}.tmp.pdf"
    try:
        for page_number in range(1, 10):
            page = Image.new("RGB", (900, 1200), "white")
            draw = ImageDraw.Draw(page)
            draw.text((60, 50), f"AILS OCR BATCH TEST {page_number:02d}", fill="black", font=font)
            for row in range(22):
                problem_number = (page_number - 1) * 22 + row + 1
                draw.text(
                    (70, 125 + row * 44),
                    f"{problem_number}. Algorithm data structure 12345 sample text",
                    fill="black",
                    font=small_font,
                )
            pages.append(page)
        pages[0].save(
            temporary,
            "PDF",
            resolution=144.0,
            save_all=True,
            append_images=pages[1:],
        )
        os.replace(temporary, target)
        return target
    finally:
        for page in pages:
            page.close()
        try:
            if os.path.exists(temporary):
                os.remove(temporary)
        except OSError:
            pass


def _runtime_package_version(*distribution_names: str) -> str:
    try:
        from importlib import metadata
    except ImportError:
        return ""
    for name in distribution_names:
        try:
            return metadata.version(name)
        except metadata.PackageNotFoundError:
            continue
    return ""


def _ocr_benchmark_pipeline_payload(language: str, model_variant: str) -> dict:
    normalized = _normalize_ocr_model_variant(model_variant)
    detection_model, recognition_model = _ocr_model_names(language, normalized)
    pipeline = {
        "benchmark_algorithm_version": OCR_BENCHMARK_ALGORITHM_VERSION,
        "ocr_version": OCR_VERSION,
        "preset_version": OCR_PRESET_VERSION,
        "language": language,
        "model_variant": normalized,
        "detection_model": detection_model,
        "recognition_model": recognition_model,
        "engine": "onnxruntime",
        "paddleocr_version": _runtime_package_version("paddleocr"),
        "paddlex_version": _runtime_package_version("paddlex"),
        "onnxruntime_version": _runtime_package_version(
            "onnxruntime-windowsml",
            "onnxruntime-directml",
            "onnxruntime-openvino",
            "onnxruntime-gpu",
            "onnxruntime",
        ),
        "preset": dict(OCR_MODEL_PRESETS[normalized]),
    }
    encoded = json.dumps(
        pipeline,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    pipeline["fingerprint"] = hashlib.sha256(encoded).hexdigest()[:24]
    return pipeline


def _profile_store_base_key(
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
) -> str:
    provider = profile.gpu_provider or "CPUExecutionProvider"
    device_id = _ocr_provider_device_id(provider)
    return f"{language}:{_normalize_ocr_model_variant(model_variant)}:{provider}:{device_id}"


def _profile_store_key(language: str, model_variant: str, profile: OcrPerformanceProfile) -> str:
    pipeline = _ocr_benchmark_pipeline_payload(language, model_variant)
    return (
        f"{_profile_store_base_key(language, model_variant, profile)}:"
        f"{pipeline['fingerprint']}"
    )


def _profile_payload(profile: OcrPerformanceProfile) -> dict:
    return {
        "logical_cpus": profile.logical_cpus,
        "total_memory_gb": profile.total_memory_gb,
        "available_memory_gb": profile.available_memory_gb,
        "gpu_provider": profile.gpu_provider,
        "batch_pages": profile.batch_pages,
        "detector_batch": profile.detector_batch,
        "recognition_batch": profile.recognition_batch,
        "render_workers": profile.render_workers,
        "prefetch_pages": profile.prefetch_pages,
    }


def _read_raw_performance_profile_store() -> dict:
    try:
        with open(_performance_profile_store_path(), "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return {"version": None, "profiles": {}, "model_selections": {}}
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("profiles"), dict)
    ):
        return {"version": None, "profiles": {}, "model_selections": {}}
    if not isinstance(payload.get("model_selections"), dict):
        payload["model_selections"] = {}
    return payload


def _read_performance_profile_store() -> dict:
    payload = _read_raw_performance_profile_store()
    if payload.get("version") != OCR_PERFORMANCE_PROFILE_VERSION:
        return {
            "version": OCR_PERFORMANCE_PROFILE_VERSION,
            "profiles": {},
            "model_selections": {},
        }
    return payload


def _has_ocr_performance_overrides() -> bool:
    return any(
        str(os.environ.get(name, "") or "").strip()
        for name in (
            "AILS_OCR_BATCH_PAGES",
            "AILS_OCR_DETECTOR_BATCH",
            "AILS_OCR_RECOGNITION_BATCH",
        )
    )


def _saved_profile_matches_hardware(
    saved: dict,
    detected: OcrPerformanceProfile,
) -> bool:
    try:
        saved_cpus = int(saved.get("logical_cpus", 0))
        saved_memory = float(saved.get("total_memory_gb", 0))
        saved_provider = saved.get("gpu_provider")
    except (TypeError, ValueError):
        return False
    return (
        saved_provider == detected.gpu_provider
        and saved_cpus == detected.logical_cpus
        and abs(saved_memory - detected.total_memory_gb) <= 1.0
    )


def _profile_from_performance_record(
    record: dict,
    detected: OcrPerformanceProfile,
    language: str,
    model_variant: str,
) -> OcrPerformanceProfile | None:
    if not isinstance(record, dict) or not isinstance(record.get("profile"), dict):
        return None
    expected_pipeline = _ocr_benchmark_pipeline_payload(language, model_variant)
    pipeline = record.get("pipeline")
    if (
        not isinstance(pipeline, dict)
        or pipeline.get("fingerprint") != expected_pipeline["fingerprint"]
    ):
        return None
    saved = record["profile"]
    if not _saved_profile_matches_hardware(saved, detected):
        return None
    try:
        batch_pages = max(1, min(10, int(saved.get("batch_pages", detected.batch_pages))))
        detector_batch = max(1, min(batch_pages, 4, int(saved.get("detector_batch", 1))))
        recognition_batch = max(1, min(128, int(saved.get("recognition_batch", 8))))
    except (TypeError, ValueError):
        return None
    return _model_limited_ocr_performance_profile(
        OcrPerformanceProfile(
            logical_cpus=detected.logical_cpus,
            total_memory_gb=detected.total_memory_gb,
            available_memory_gb=detected.available_memory_gb,
            gpu_provider=detected.gpu_provider,
            batch_pages=batch_pages,
            detector_batch=detector_batch,
            recognition_batch=recognition_batch,
            render_workers=1,
            prefetch_pages=batch_pages * 2,
        ),
        model_variant,
    )


def _load_calibrated_ocr_performance_profile(
    detected: OcrPerformanceProfile,
    language: str,
    model_variant: str,
) -> OcrPerformanceProfile:
    detected = _model_limited_ocr_performance_profile(detected, model_variant)
    if _has_ocr_performance_overrides():
        return detected
    with _profile_store_lock:
        record = _read_performance_profile_store().get("profiles", {}).get(
            _profile_store_key(language, model_variant, detected)
        )
    return (
        _profile_from_performance_record(
            record,
            detected,
            language,
            model_variant,
        )
        or detected
    )


def _write_performance_profile_store(store: dict) -> str:
    destination = _performance_profile_store_path()
    fd, temporary = tempfile.mkstemp(
        prefix="ocr-performance-",
        suffix=".json",
        dir=os.path.dirname(destination),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            fd = -1
            json.dump(store, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    except Exception:
        if fd >= 0:
            os.close(fd)
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise
    return destination


def _save_calibrated_ocr_performance_profile(
    profile: OcrPerformanceProfile,
    language: str,
    model_variant: str,
    seconds_per_page: float,
) -> str:
    model_variant = _normalize_ocr_model_variant(model_variant)
    profile = _model_limited_ocr_performance_profile(profile, model_variant)
    with _profile_store_lock:
        store = _read_performance_profile_store()
        store["profiles"][_profile_store_key(language, model_variant, profile)] = {
            "profile": _profile_payload(profile),
            "pipeline": _ocr_benchmark_pipeline_payload(language, model_variant),
            "seconds_per_page": round(max(0.0, float(seconds_per_page)), 4),
            "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        return _write_performance_profile_store(store)


def _model_selection_store_key(language: str, profile: OcrPerformanceProfile) -> str:
    provider = profile.gpu_provider or "CPUExecutionProvider"
    device_id = _ocr_provider_device_id(provider)
    return f"{language}:{provider}:{device_id}"


def _benchmarked_ocr_model_record(
    profile: OcrPerformanceProfile,
    language: str,
) -> dict | None:
    with _profile_store_lock:
        record = _read_performance_profile_store().get("model_selections", {}).get(
            _model_selection_store_key(language, profile)
        )
    if not isinstance(record, dict):
        return None
    if record.get("benchmark_version") != OCR_MODEL_BENCHMARK_VERSION:
        return None
    hardware = record.get("hardware")
    if not isinstance(hardware, dict) or not _saved_profile_matches_hardware(hardware, profile):
        return None
    pipelines = record.get("pipelines")
    expected_pipelines = {
        variant: _ocr_benchmark_pipeline_payload(language, variant)["fingerprint"]
        for variant in OCR_MODEL_VARIANT_ORDER
    }
    if pipelines != expected_pipelines:
        return None
    try:
        selected = _normalize_ocr_model_variant(record.get("model_variant"))
    except ValueError:
        return None
    return {**record, "model_variant": selected}


def _save_benchmarked_ocr_model_variant(
    profile: OcrPerformanceProfile,
    language: str,
    selected: str,
    candidates: list[dict],
    reason: str,
) -> str:
    selected = _normalize_ocr_model_variant(selected)
    measured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    record = {
        "benchmark_version": OCR_MODEL_BENCHMARK_VERSION,
        "model_variant": selected,
        "reason": reason,
        "hardware": _profile_payload(profile),
        "pipelines": {
            variant: _ocr_benchmark_pipeline_payload(language, variant)["fingerprint"]
            for variant in OCR_MODEL_VARIANT_ORDER
        },
        "candidates": candidates,
        "measured_at": measured_at,
    }
    with _profile_store_lock:
        store = _read_performance_profile_store()
        store["model_selections"][_model_selection_store_key(language, profile)] = record
        return _write_performance_profile_store(store)


def _performance_record_identity(key: str, record: dict) -> dict:
    parts = str(key or "").split(":")
    pipeline = record.get("pipeline") if isinstance(record, dict) else None
    saved_profile = record.get("profile") if isinstance(record, dict) else None
    pipeline = pipeline if isinstance(pipeline, dict) else {}
    saved_profile = saved_profile if isinstance(saved_profile, dict) else {}
    language = str(pipeline.get("language") or (parts[0] if parts else "") or "")
    raw_variant = str(
        pipeline.get("model_variant")
        or (parts[1] if len(parts) > 1 else "")
        or ""
    )
    try:
        model_variant = _normalize_ocr_model_variant(raw_variant)
    except ValueError:
        model_variant = raw_variant
    provider = str(
        saved_profile.get("gpu_provider")
        or (parts[2] if len(parts) > 2 else "CPUExecutionProvider")
        or "CPUExecutionProvider"
    )
    try:
        device_id = int(parts[3]) if len(parts) > 3 else 0
    except (TypeError, ValueError):
        device_id = 0
    return {
        "language": language,
        "model_variant": model_variant,
        "gpu_provider": provider,
        "device_id": device_id,
    }


def _performance_measurement_payload(
    key: str,
    record: dict,
    current_model_variant: str,
) -> dict:
    identity = _performance_record_identity(key, record)
    saved = record.get("profile") if isinstance(record, dict) else None
    pipeline = record.get("pipeline") if isinstance(record, dict) else None
    saved = saved if isinstance(saved, dict) else {}
    pipeline = pipeline if isinstance(pipeline, dict) else {}

    def integer(name: str, default: int) -> int:
        try:
            return max(1, int(saved.get(name, default)))
        except (TypeError, ValueError):
            return default

    def number(value, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    try:
        seconds_per_page = max(0.0, float(record.get("seconds_per_page", 0.0)))
    except (AttributeError, TypeError, ValueError):
        seconds_per_page = 0.0
    raw_batch_pages = integer("batch_pages", 1)
    normalized_current = _normalize_ocr_model_variant(current_model_variant)
    effective_batch_pages = min(
        raw_batch_pages,
        int(OCR_MODEL_PRESETS[normalized_current]["max_batch_pages"]),
    )
    return {
        **identity,
        "batch_pages": raw_batch_pages,
        "effective_batch_pages": max(1, effective_batch_pages),
        "detector_batch": integer("detector_batch", 1),
        "recognition_batch": integer("recognition_batch", 8),
        "render_workers": integer("render_workers", 1),
        "seconds_per_page": round(seconds_per_page, 4),
        "measured_at": str(record.get("measured_at", "") or ""),
        "logical_cpus": integer("logical_cpus", 1),
        "total_memory_gb": number(saved.get("total_memory_gb", 0.0)),
        "detection_model": str(pipeline.get("detection_model", "") or ""),
        "recognition_model": str(pipeline.get("recognition_model", "") or ""),
        "ocr_version": str(pipeline.get("ocr_version", "") or ""),
        "preset_version": pipeline.get("preset_version"),
        "benchmark_algorithm_version": pipeline.get("benchmark_algorithm_version"),
        "pipeline_fingerprint": str(pipeline.get("fingerprint", "") or ""),
        "render_scale": number(
            (pipeline.get("preset") or {}).get("render_scale", 0.0)
            if isinstance(pipeline.get("preset"), dict)
            else 0.0
        ),
    }


def _find_previous_performance_record(
    store: dict,
    language: str,
    model_variant: str,
    detected: OcrPerformanceProfile,
) -> tuple[str, dict] | None:
    profiles = store.get("profiles") if isinstance(store, dict) else None
    if not isinstance(profiles, dict):
        return None
    matches: list[tuple[tuple[int, int, int, str], str, dict]] = []
    expected_provider = detected.gpu_provider or "CPUExecutionProvider"
    expected_variant = _normalize_ocr_model_variant(model_variant)
    for key, record in profiles.items():
        if not isinstance(record, dict):
            continue
        identity = _performance_record_identity(str(key), record)
        if identity["language"] != language:
            continue
        saved = record.get("profile")
        hardware_match = int(
            isinstance(saved, dict)
            and _saved_profile_matches_hardware(saved, detected)
        )
        provider_match = int(identity["gpu_provider"] == expected_provider)
        model_match = int(identity["model_variant"] == expected_variant)
        measured_at = str(record.get("measured_at", "") or "")
        matches.append(
            (
                (model_match, provider_match, hardware_match, measured_at),
                str(key),
                record,
            )
        )
    if not matches:
        return None
    _, key, record = max(matches, key=lambda item: item[0])
    return key, record


def ocr_performance_profile_status(
    language: str = DEFAULT_LANGUAGE,
    model_variant: str = AUTO_OCR_MODEL_VARIANT,
) -> dict:
    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    detected = _active_detect_ocr_performance_profile()
    requested = str(model_variant or AUTO_OCR_MODEL_VARIANT).strip().lower()
    model_selection = (
        _benchmarked_ocr_model_record(detected, language)
        if requested in {"", AUTO_OCR_MODEL_VARIANT}
        else None
    )
    if requested in {"", AUTO_OCR_MODEL_VARIANT}:
        selected = (
            model_selection["model_variant"]
            if model_selection
            else select_ocr_model_variant(detected)
        )
    else:
        selected = _normalize_ocr_model_variant(requested)
    selected = _normalize_ocr_model_variant(selected)
    pipeline = _ocr_benchmark_pipeline_payload(language, selected)
    default_profile = _model_limited_ocr_performance_profile(detected, selected)
    dependencies = ocr_dependency_status()
    model = ocr_model_status(language, selected)
    available_provider = detected.gpu_provider in {
        "DmlExecutionProvider",
        "CUDAExecutionProvider",
        "OpenVINOExecutionProvider",
    }
    cpu_available = "CPUExecutionProvider" in _available_ocr_execution_providers()
    response = {
        "state": "missing" if available_provider and dependencies["ready"] else "unavailable",
        "exists": False,
        "compatible": False,
        "applied": False,
        "language": language,
        "model_variant": selected,
        "detection_model": pipeline["detection_model"],
        "recognition_model": pipeline["recognition_model"],
        "ocr_version": pipeline["ocr_version"],
        "preset_version": pipeline["preset_version"],
        "benchmark_algorithm_version": pipeline["benchmark_algorithm_version"],
        "pipeline_fingerprint": pipeline["fingerprint"],
        "render_scale": float(pipeline["preset"]["render_scale"]),
        "gpu_provider": detected.gpu_provider or "CPUExecutionProvider",
        "cpu_available": cpu_available,
        "dependencies": dependencies,
        "model": model,
        "dml_device_id": (
            _dml_device_id()
            if detected.gpu_provider == "DmlExecutionProvider"
            else 0
        ),
        "default_profile": _profile_payload(default_profile),
        "measurement": None,
        "stale_reason": "",
        "overridden": _has_ocr_performance_overrides(),
        "model_selection": model_selection,
    }
    with _profile_store_lock:
        raw_store = _read_raw_performance_profile_store()
        current_store = (
            raw_store
            if raw_store.get("version") == OCR_PERFORMANCE_PROFILE_VERSION
            else {"version": OCR_PERFORMANCE_PROFILE_VERSION, "profiles": {}}
        )
        record = current_store.get("profiles", {}).get(
            _profile_store_key(language, selected, detected)
        )
    compatible_profile = _profile_from_performance_record(
        record,
        detected,
        language,
        selected,
    )
    if compatible_profile is not None:
        response.update({
            "state": "available" if available_provider and dependencies["ready"] else "unavailable",
            "exists": True,
            "compatible": True,
            "applied": not response["overridden"],
            "measurement": _performance_measurement_payload(
                _profile_store_key(language, selected, detected),
                record,
                selected,
            ),
        })
        return response

    previous = _find_previous_performance_record(
        raw_store,
        language,
        selected,
        detected,
    )
    if previous is None:
        return response
    previous_key, previous_record = previous
    previous_identity = _performance_record_identity(
        previous_key,
        previous_record,
    )
    previous_pipeline = previous_record.get("pipeline")
    previous_saved = previous_record.get("profile")
    if previous_identity["model_variant"] != selected:
        stale_reason = "model_changed"
    elif not isinstance(previous_pipeline, dict) or not previous_pipeline.get("fingerprint"):
        stale_reason = "missing_v6_fingerprint"
    elif not isinstance(previous_saved, dict) or not _saved_profile_matches_hardware(
        previous_saved,
        detected,
    ):
        stale_reason = "hardware_changed"
    else:
        stale_reason = "pipeline_changed"
    response.update({
        "state": "incompatible" if available_provider and dependencies["ready"] else "unavailable",
        "exists": True,
        "measurement": _performance_measurement_payload(
            previous_key,
            previous_record,
            selected,
        ),
        "stale_reason": stale_reason,
    })
    return response



def _safe_dml_profile(profile: OcrPerformanceProfile) -> OcrPerformanceProfile:
    return OcrPerformanceProfile(
        logical_cpus=profile.logical_cpus,
        total_memory_gb=profile.total_memory_gb,
        available_memory_gb=profile.available_memory_gb,
        gpu_provider=profile.gpu_provider,
        batch_pages=min(profile.batch_pages, 3),
        detector_batch=1,
        recognition_batch=min(profile.recognition_batch, 8),
        render_workers=1,
        prefetch_pages=min(profile.batch_pages, 3) * 2,
    )


def _calibration_profile(
    profile: OcrPerformanceProfile,
    *,
    batch_pages: int,
    detector_batch: int,
    recognition_batch: int,
) -> OcrPerformanceProfile:
    batch_pages = max(1, min(batch_pages, profile.batch_pages))
    return OcrPerformanceProfile(
        logical_cpus=profile.logical_cpus,
        total_memory_gb=profile.total_memory_gb,
        available_memory_gb=profile.available_memory_gb,
        gpu_provider=profile.gpu_provider,
        batch_pages=batch_pages,
        detector_batch=max(1, min(detector_batch, batch_pages)),
        recognition_batch=max(1, recognition_batch),
        render_workers=1,
        prefetch_pages=batch_pages * 2,
    )




def _benchmark_page_indexes(total_pages: int, sample_count: int) -> list[int]:
    total_pages = max(1, int(total_pages))
    sample_count = max(1, min(int(sample_count), total_pages))
    if sample_count == total_pages:
        return list(range(total_pages))
    return [
        min(total_pages - 1, int((index + 0.5) * total_pages / sample_count))
        for index in range(sample_count)
    ]


def _ocr_benchmark_words_digest(pages: list[list[OcrWord]]) -> str:
    payload = [
        [
            (
                word.text,
                round(float(word.left), 2),
                round(float(word.top), 2),
                round(float(word.right), 2),
                round(float(word.bottom), 2),
            )
            for word in words
        ]
        for words in pages
    ]
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _ocr_benchmark_number_signature(pages: list[list[OcrWord]]) -> tuple[str, int]:
    tokens = [
        f"{page_index}:{token}"
        for page_index, words in enumerate(pages)
        for word in words
        for token in re.findall(r"\d+|[①-⑳]", word.text)
    ]
    encoded = json.dumps(tokens, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest(), len(tokens)


def _recognize_benchmark_pages_once(
    render_source: str,
    page_indexes: list[int],
    render_scale: float,
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
) -> list[list[OcrWord]]:
    page_groups = [
        page_indexes[start:start + profile.batch_pages]
        for start in range(0, len(page_indexes), profile.batch_pages)
    ]
    recognized_pages: list[list[OcrWord]] = []
    current_future = None
    try:
        with ThreadPoolExecutor(
            max_workers=profile.render_workers,
            thread_name_prefix="ails-ocr-benchmark-render",
        ) as executor:
            current_future = (
                executor.submit(
                    _render_pdf_pages,
                    render_source,
                    page_groups[0],
                    render_scale,
                )
                if page_groups
                else None
            )
            for group_index in range(len(page_groups)):
                rendered = current_future.result()
                next_group = (
                    page_groups[group_index + 1]
                    if group_index + 1 < len(page_groups)
                    else []
                )
                current_future = (
                    executor.submit(
                        _render_pdf_pages,
                        render_source,
                        next_group,
                        render_scale,
                    )
                    if next_group
                    else None
                )
                try:
                    words_by_page = _recognize_batch(
                        [image for _, image in rendered],
                        language,
                        profile,
                        model_variant,
                    )
                    if len(words_by_page) != len(rendered):
                        raise RuntimeError(
                            "OCR 벤치마크 결과의 페이지 수가 일치하지 않습니다."
                        )
                    recognized_pages.extend(words_by_page)
                finally:
                    for _, image in rendered:
                        image.close()
    except Exception:
        if current_future is not None:
            current_future.cancel()
        raise
    return recognized_pages


def _run_ocr_benchmark(
    render_source: str,
    page_indexes: list[int],
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
    repeats: int,
    stop_if_slower_than: float | None = None,
) -> dict:
    render_scale = _ocr_render_scale(model_variant)
    try:
        warmup_image = _render_pdf_page(
            render_source,
            page_indexes[0],
            scale=render_scale,
        )
        try:
            _recognize_batch(
                [warmup_image],
                language,
                profile,
                model_variant,
            )
        finally:
            warmup_image.close()

        samples: list[float] = []
        digests: list[str] = []
        word_counts: list[int] = []
        number_signatures: list[str] = []
        number_counts: list[int] = []
        for _ in range(repeats):
            started_at = time.perf_counter()
            recognized_pages = _recognize_benchmark_pages_once(
                render_source,
                page_indexes,
                render_scale,
                language,
                model_variant,
                profile,
            )
            elapsed = max(0.001, time.perf_counter() - started_at)
            seconds_per_page = elapsed / max(1, len(page_indexes))
            samples.append(seconds_per_page)
            digests.append(_ocr_benchmark_words_digest(recognized_pages))
            word_counts.append(sum(len(words) for words in recognized_pages))
            number_signature, number_count = _ocr_benchmark_number_signature(recognized_pages)
            number_signatures.append(number_signature)
            number_counts.append(number_count)
            if (
                stop_if_slower_than is not None
                and len(samples) >= 2
                and statistics.median(samples) > stop_if_slower_than
            ):
                return {
                    "ok": True,
                    "early_stopped": True,
                    "samples": samples,
                    "pages": len(page_indexes),
                    "digests": digests,
                    "word_counts": word_counts,
                    "number_signatures": number_signatures,
                    "number_counts": number_counts,
                }
        return {
            "ok": True,
            "samples": samples,
            "pages": len(page_indexes),
            "digests": digests,
            "word_counts": word_counts,
            "number_signatures": number_signatures,
            "number_counts": number_counts,
        }
    except BaseException as error:
        import traceback as _tb
        error_detail = (
            "DirectML GPU benchmark failed"
            if isinstance(error, (UnicodeDecodeError, DmlOcrExecutionError))
            else str(error)
        )
        return {
            "ok": False,
            "error_type": type(error).__name__,
            "error": error_detail,
            "model_variant": model_variant,
            "batch_pages": profile.batch_pages,
            "detector_batch": profile.detector_batch,
            "recognition_batch": profile.recognition_batch,
            "gpu_provider": profile.gpu_provider,
            "dml_device_id": _dml_device_id(),
            "pid": os.getpid(),
            "thread_id": threading.current_thread().ident,
            "traceback": _tb.format_exc(),
        }
    finally:
        _discard_engine(language, model_variant)


def _ocr_benchmark_worker(
    result_queue,
    render_source: str,
    page_indexes: list[int],
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
    repeats: int,
    stop_if_slower_than: float | None,
):
    result_queue.put(
        _run_ocr_benchmark(
            render_source,
            page_indexes,
            language,
            model_variant,
            profile,
            repeats,
            stop_if_slower_than,
        )
    )


def _benchmark_ocr_profile_spawned(
    render_source: str,
    page_indexes: list[int],
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
    repeats: int,
    timeout_seconds: float = 240.0,
    cancel_event: threading.Event | None = None,
    stop_if_slower_than: float | None = None,
) -> dict:
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue(maxsize=1)
    process = context.Process(
        target=_ocr_benchmark_worker,
        args=(
            result_queue,
            render_source,
            page_indexes,
            language,
            model_variant,
            profile,
            repeats,
            stop_if_slower_than,
        ),
        daemon=True,
    )
    try:
        process.start()
        deadline = time.monotonic() + timeout_seconds
        while process.is_alive() and time.monotonic() < deadline:
            if cancel_event is not None and cancel_event.is_set():
                process.terminate()
                process.join(10)
                return {"ok": False, "cancelled": True}
            process.join(min(0.1, max(0.0, deadline - time.monotonic())))
        if process.is_alive():
            process.terminate()
            process.join(10)
            return {
                "ok": False,
                "error_type": "TimeoutError",
                "error": "OCR benchmark timed out",
            }
        try:
            result = result_queue.get(timeout=2)
        except queue_module.Empty:
            result = {
                "ok": False,
                "error_type": "WorkerExitError",
                "error": f"OCR benchmark worker exited with code {process.exitcode}",
            }
        return result
    finally:
        if process.is_alive():
            process.terminate()
            process.join(10)
        result_queue.close()
        result_queue.join_thread()


_FROZEN_BENCHMARK_INLINE_RETRY_ERRORS = {
    "FileNotFoundError",
    "ImportError",
    "ModuleNotFoundError",
    "OSError",
    "PdfOcrUnavailableError",
    "PermissionError",
    "WorkerExitError",
}


def _benchmark_ocr_profile(
    render_source: str,
    page_indexes: list[int],
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
    repeats: int,
    timeout_seconds: float = 240.0,
    cancel_event: threading.Event | None = None,
    stop_if_slower_than: float | None = None,
) -> dict:
    try:
        result = _benchmark_ocr_profile_spawned(
            render_source,
            page_indexes,
            language,
            model_variant,
            profile,
            repeats,
            timeout_seconds,
            cancel_event,
            stop_if_slower_than,
        )
    except OSError as error:
        result = {
            "ok": False,
            "error_type": type(error).__name__,
            "error": str(error),
        }

    error_type = str(result.get("error_type", "") or "")
    if (
        getattr(sys, "frozen", False)
        and not result.get("ok")
        and not result.get("cancelled")
        and error_type in _FROZEN_BENCHMARK_INLINE_RETRY_ERRORS
    ):
        _logger.warning(
            "Frozen OCR benchmark worker initialization failed (%s: %s). "
            "Retrying the candidate in the backend process.",
            error_type or "?",
            result.get("error", "?"),
        )
        inline_result = _run_ocr_benchmark(
            render_source,
            page_indexes,
            language,
            model_variant,
            profile,
            repeats,
            stop_if_slower_than,
        )
        inline_result["execution_mode"] = "frozen-inline-retry"
        return inline_result
    return result




def _ocr_benchmark_candidates(
    profile: OcrPerformanceProfile,
    model_variant: str,
) -> list[OcrPerformanceProfile]:
    model_variant = _normalize_ocr_model_variant(model_variant)
    profile = _model_limited_ocr_performance_profile(profile, model_variant)
    recognition_batches = [8]
    if profile.total_memory_gb >= 12 and profile.available_memory_gb >= 3:
        recognition_batches.append(16)
    if (
        profile.gpu_provider is not None
        and profile.total_memory_gb >= 20
        and profile.available_memory_gb >= 6
    ):
        recognition_batches.append(32)
    if profile.recognition_batch not in recognition_batches:
        recognition_batches.append(profile.recognition_batch)
    recognition_batches = sorted(set(recognition_batches))

    page_batches: list[int] = []
    page_batch = 1
    while page_batch <= profile.batch_pages:
        page_batches.append(page_batch)
        page_batch *= 2
    if page_batches[-1] != profile.batch_pages:
        page_batches.append(profile.batch_pages)
    detector_batches = [1]
    if (
        not OCR_MODEL_PRESETS[model_variant]["isolate_pages"]
        and profile.batch_pages >= 2
    ):
        detector_batches.append(2)

    candidates: list[OcrPerformanceProfile] = []
    for page_batch in page_batches:
        for recognition_batch in recognition_batches:
            for detector_batch in detector_batches:
                candidate = _calibration_profile(
                    profile,
                    batch_pages=page_batch,
                    detector_batch=detector_batch,
                    recognition_batch=recognition_batch,
                )
                candidate = _model_limited_ocr_performance_profile(
                    candidate,
                    model_variant,
                )
                if candidate not in candidates:
                    candidates.append(candidate)
    return sorted(
        candidates,
        key=lambda candidate: (
            candidate.batch_pages
            * candidate.detector_batch
            * candidate.recognition_batch,
            candidate.recognition_batch,
            candidate.detector_batch,
            candidate.batch_pages,
        ),
    )


def benchmark_ocr_performance_profile(
    render_source: str,
    total_pages: int,
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
    emit: Callable[[dict], None] | None = None,
    repeats: int = 3,
    cancel_event: threading.Event | None = None,
    sample_page_indexes: list[int] | None = None,
) -> tuple[OcrPerformanceProfile, dict]:
    model_variant = _normalize_ocr_model_variant(model_variant)
    profile = _model_limited_ocr_performance_profile(profile, model_variant)
    candidates = _ocr_benchmark_candidates(profile, model_variant)
    repeats = max(1, min(3, int(repeats)))
    if not candidates:
        raise PdfOcrUnavailableError("측정할 수 있는 OCR 배치 후보가 없습니다.")

    _discard_engine(language, model_variant)
    if emit:
        emit({
            "type": "benchmark",
            "stage": "start",
            "candidate_total": len(candidates),
            "repeat_total": repeats,
        })

    if sample_page_indexes is None:
        maximum_page_batch = max(candidate.batch_pages for candidate in candidates)
        sample_page_indexes = _benchmark_page_indexes(
            total_pages,
            min(total_pages, maximum_page_batch + 1),
        )
    else:
        sample_page_indexes = [
            int(index)
            for index in sample_page_indexes
            if 0 <= int(index) < total_pages
        ]
        if not sample_page_indexes:
            raise ValueError("OCR 배치 검사 표본 페이지가 없습니다.")
    successful: list[dict] = []
    all_results: list[dict] = []
    early_stopped_candidates = 0
    reference_digest: str | None = None
    try:
        if emit:
            emit({
                "type": "benchmark",
                "stage": "warming_up",
                "candidate_total": len(candidates),
                "repeat_total": repeats,
                "sample_pages": len(sample_page_indexes),
            })

        for candidate_index, candidate in enumerate(candidates, start=1):
            _raise_if_ocr_cancelled(cancel_event)
            if emit:
                emit({
                    "type": "benchmark",
                    "stage": "testing",
                    "candidate": candidate_index,
                    "candidate_total": len(candidates),
                    "repeat": 0,
                    "repeat_total": repeats,
                    "batch_pages": candidate.batch_pages,
                    "detector_batch": candidate.detector_batch,
                    "recognition_batch": candidate.recognition_batch,
                    "sample_pages": len(sample_page_indexes),
                })
            outcome = _benchmark_ocr_profile(
                render_source,
                sample_page_indexes,
                language,
                model_variant,
                candidate,
                repeats,
                cancel_event=cancel_event,
                stop_if_slower_than=(
                    min(item["score"] for item in successful) * 1.05
                    if successful
                    else None
                ),
            )
            if outcome.get("cancelled"):
                raise PdfOcrCancelledError("OCR 배치 검사가 사용자 요청으로 중단되었습니다.")
            if outcome.get("early_stopped"):
                samples = [
                    max(0.0001, float(value))
                    for value in outcome.get("samples", [])
                ]
                stopped = {
                    "batch_pages": candidate.batch_pages,
                    "detector_batch": candidate.detector_batch,
                    "recognition_batch": candidate.recognition_batch,
                    "seconds_per_page": round(statistics.median(samples), 4),
                    "ok": False,
                    "error_type": "InefficientCandidate",
                }
                early_stopped_candidates += 1
                all_results.append(stopped)
                if emit:
                    emit({
                        "type": "benchmark",
                        "stage": "early_stopped",
                        "candidate": candidate_index,
                        "candidate_total": len(candidates),
                        **stopped,
                    })
                continue
            if not outcome.get("ok"):
                failure = {
                    "batch_pages": candidate.batch_pages,
                    "detector_batch": candidate.detector_batch,
                    "recognition_batch": candidate.recognition_batch,
                    "ok": False,
                    "error_type": str(outcome.get("error_type", "OcrBenchmarkError")),
                    "error": str(outcome.get("error", "") or ""),
                }
                all_results.append(failure)
                _logger.warning(
                    "OCR benchmark candidate %d/%d failed: %s %s "
                    "(variant=%s bp=%d db=%d rb=%d)",
                    candidate_index,
                    len(candidates),
                    outcome.get("error_type", "?"),
                    outcome.get("error", "?"),
                    model_variant,
                    candidate.batch_pages,
                    candidate.detector_batch,
                    candidate.recognition_batch,
                )
                if emit:
                    emit({
                        "type": "benchmark",
                        "stage": "failed",
                        "candidate": candidate_index,
                        "candidate_total": len(candidates),
                        **failure,
                    })
                continue

            try:
                samples = [
                    max(0.0001, float(value))
                    for value in outcome.get("samples", [])
                ]
            except (TypeError, ValueError):
                samples = []
            digests = [
                str(value)
                for value in outcome.get("digests", [])
                if str(value)
            ]
            word_counts = [int(value) for value in outcome.get("word_counts", [])]
            number_signatures = [
                str(value)
                for value in outcome.get("number_signatures", [])
                if str(value)
            ]
            number_counts = [int(value) for value in outcome.get("number_counts", [])]
            if (
                not samples
                or len(set(digests)) != 1
                or len(set(word_counts)) != 1
                or len(set(number_signatures)) != 1
                or len(set(number_counts)) != 1
            ):
                failure = {
                    "batch_pages": candidate.batch_pages,
                    "detector_batch": candidate.detector_batch,
                    "recognition_batch": candidate.recognition_batch,
                    "ok": False,
                    "error_type": "InconsistentOcrOutput",
                }
                all_results.append(failure)
                if emit:
                    emit({
                        "type": "benchmark",
                        "stage": "failed",
                        "candidate": candidate_index,
                        "candidate_total": len(candidates),
                        **failure,
                    })
                continue
            candidate_digest = digests[0]
            if reference_digest is None:
                reference_digest = candidate_digest
            elif candidate_digest != reference_digest:
                failure = {
                    "batch_pages": candidate.batch_pages,
                    "detector_batch": candidate.detector_batch,
                    "recognition_batch": candidate.recognition_batch,
                    "ok": False,
                    "error_type": "OcrOutputMismatch",
                }
                all_results.append(failure)
                if emit:
                    emit({
                        "type": "benchmark",
                        "stage": "failed",
                        "candidate": candidate_index,
                        "candidate_total": len(candidates),
                        **failure,
                    })
                continue
            for repeat_index, seconds_per_page in enumerate(samples, start=1):
                if emit:
                    emit({
                        "type": "benchmark",
                        "stage": "sample",
                        "candidate": candidate_index,
                        "candidate_total": len(candidates),
                        "repeat": repeat_index,
                        "repeat_total": len(samples),
                        "seconds_per_page": round(seconds_per_page, 4),
                    })
            score = statistics.median(samples)
            result = {
                "batch_pages": candidate.batch_pages,
                "detector_batch": candidate.detector_batch,
                "recognition_batch": candidate.recognition_batch,
                "seconds_per_page": round(score, 4),
                "word_count": word_counts[0],
                "number_signature": number_signatures[0],
                "number_count": number_counts[0],
                "ok": True,
            }
            successful.append({"profile": candidate, "score": score, "result": result})
            all_results.append(result)
            if emit:
                emit({
                    "type": "benchmark",
                    "stage": "candidate_done",
                    "candidate": candidate_index,
                    "candidate_total": len(candidates),
                    **result,
                })
    finally:
        _discard_engine(language, model_variant)

    if not successful:
        last_failure = next(
            (result for result in reversed(all_results) if not result.get("ok")),
            {},
        )
        failure_detail = str(last_failure.get("error", "") or "").strip()
        if failure_detail:
            raise PdfOcrUnavailableError(
                "OCR 배치 측정 프로세스를 실행하지 못했습니다. "
                f"{last_failure.get('error_type', 'OcrBenchmarkError')}: {failure_detail}"
            )
        raise PdfOcrUnavailableError(
            "안전하게 실행된 OCR 배치가 없습니다. 다른 GPU 작업을 종료한 뒤 다시 측정해 주세요."
        )

    best_score = min(item["score"] for item in successful)
    near_best = [item for item in successful if item["score"] <= best_score * 1.01]
    selected_entry = min(
        near_best,
        key=lambda item: (
            item["profile"].batch_pages
            * item["profile"].detector_batch
            * item["profile"].recognition_batch,
            item["score"],
        ),
    )
    selected = selected_entry["profile"]
    seconds_per_page = float(selected_entry["score"])
    pipeline = _ocr_benchmark_pipeline_payload(language, model_variant)
    result = {
        "language": language,
        "model_variant": model_variant,
        "profile": _profile_payload(selected),
        "seconds_per_page": round(seconds_per_page, 4),
        "sample_pages": len(sample_page_indexes),
        "pipeline": pipeline,
        "candidates": all_results,
        "stopped_inefficient_candidates": early_stopped_candidates,
        "word_count": selected_entry["result"]["word_count"],
        "number_signature": selected_entry["result"]["number_signature"],
        "number_count": selected_entry["result"]["number_count"],
    }
    if emit:
        emit({
            "type": "benchmark",
            "stage": "done",
            "model_variant": result["model_variant"],
            **_profile_payload(selected),
            "seconds_per_page": round(seconds_per_page, 4),
            "sample_pages": len(sample_page_indexes),
            "detection_model": pipeline["detection_model"],
            "recognition_model": pipeline["recognition_model"],
            "render_scale": float(pipeline["preset"]["render_scale"]),
            "pipeline_fingerprint": pipeline["fingerprint"],
            "benchmark_algorithm_version": OCR_BENCHMARK_ALGORITHM_VERSION,
        })
    return selected, result


def _select_benchmarked_ocr_model(results: list[dict]) -> tuple[dict, str]:
    successful = [result for result in results if result.get("ok")]
    if not successful:
        raise PdfOcrUnavailableError("안전하게 실행된 OCR 모델이 없습니다.")
    signatures = {result.get("number_signature") for result in successful}
    if len(signatures) != 1:
        return max(
            successful,
            key=lambda result: (
                int(result.get("number_count", 0)),
                int(result.get("word_count", 0)),
                OCR_MODEL_VARIANT_ORDER.index(result["model_variant"]),
                -float(result["seconds_per_page"]),
            ),
        ), "number_disagreement_most_detected"
    fastest = min(float(result["seconds_per_page"]) for result in successful)
    near_fastest = [
        result
        for result in successful
        if float(result["seconds_per_page"]) <= fastest * 1.05
    ]
    return max(
        near_fastest,
        key=lambda result: OCR_MODEL_VARIANT_ORDER.index(result["model_variant"]),
    ), "matching_numbers_speed_within_5_percent"


def benchmark_ocr_models_and_profiles(
    render_source: str,
    total_pages: int,
    language: str,
    detected: OcrPerformanceProfile,
    emit: Callable[[dict], None] | None = None,
    cancel_event: threading.Event | None = None,
    install_missing_models: bool = False,
) -> dict:
    if language != "korean":
        raise PdfOcrUnavailableError("모델 자동 비교는 현재 한국어 OCR만 지원합니다.")
    maximum_page_batch = max(
        candidate.batch_pages
        for variant in OCR_MODEL_VARIANT_ORDER
        for candidate in _ocr_benchmark_candidates(detected, variant)
    )
    sample_page_indexes = _benchmark_page_indexes(
        total_pages,
        min(total_pages, maximum_page_batch + 1),
    )
    model_results: list[dict] = []
    for model_index, variant in enumerate(OCR_MODEL_VARIANT_ORDER, start=1):
        _raise_if_ocr_cancelled(cancel_event)
        if emit:
            emit({
                "type": "model_benchmark",
                "stage": "model_start",
                "model_variant": variant,
                "model_index": model_index,
                "model_total": len(OCR_MODEL_VARIANT_ORDER),
            })
        try:
            status = ocr_model_status(language, variant, pipeline="legacy")
            if not status.get("ready"):
                if not install_missing_models:
                    raise PdfOcrUnavailableError(
                        f"{variant} OCR 모델 다운로드 확인이 필요합니다."
                    )
                install_ocr_model(
                    True,
                    language,
                    variant,
                    emit,
                    cancel_event,
                    pipeline="legacy",
                )
            selected_profile, result = benchmark_ocr_performance_profile(
                render_source,
                total_pages,
                language,
                variant,
                detected,
                emit,
                cancel_event=cancel_event,
                sample_page_indexes=sample_page_indexes,
            )
            _save_calibrated_ocr_performance_profile(
                selected_profile,
                language,
                variant,
                float(result["seconds_per_page"]),
            )
            model_result = {
                "ok": True,
                "model_variant": variant,
                "profile": _profile_payload(selected_profile),
                "seconds_per_page": float(result["seconds_per_page"]),
                "word_count": int(result["word_count"]),
                "number_count": int(result["number_count"]),
                "number_signature": str(result["number_signature"]),
            }
            model_results.append(model_result)
            if emit:
                emit({
                    "type": "model_benchmark",
                    "stage": "model_done",
                    "model_index": model_index,
                    "model_total": len(OCR_MODEL_VARIANT_ORDER),
                    **model_result,
                })
        except PdfOcrCancelledError:
            raise
        except Exception as error:
            _raise_if_ocr_cancelled(cancel_event)
            failure = {
                "ok": False,
                "model_variant": variant,
                "error": str(error),
            }
            model_results.append(failure)
            if emit:
                emit({
                    "type": "model_benchmark",
                    "stage": "model_failed",
                    "model_index": model_index,
                    "model_total": len(OCR_MODEL_VARIANT_ORDER),
                    **failure,
                })

    selected, reason = _select_benchmarked_ocr_model(model_results)
    persisted_candidates = [
        {
            key: value
            for key, value in result.items()
            if key not in {"number_signature"}
        }
        for result in model_results
    ]
    profile_path = _save_benchmarked_ocr_model_variant(
        detected,
        language,
        selected["model_variant"],
        persisted_candidates,
        reason,
    )
    final_result = {
        "language": language,
        "model_variant": selected["model_variant"],
        "profile": selected["profile"],
        "seconds_per_page": round(float(selected["seconds_per_page"]), 4),
        "sample_pages": len(sample_page_indexes),
        "model_candidates": persisted_candidates,
        "model_selection_reason": reason,
        "profile_path": profile_path,
    }
    if emit:
        emit({
            "type": "model_benchmark",
            "stage": "selected",
            "model_index": OCR_MODEL_VARIANT_ORDER.index(selected["model_variant"]) + 1,
            "model_total": len(OCR_MODEL_VARIANT_ORDER),
            **final_result,
            **selected["profile"],
        })
    return final_result



def measure_optimal_ocr_performance_profile(
    path: str,
    language: str = DEFAULT_LANGUAGE,
    emit: Callable[[dict], None] | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
    job_id: str | None = None,
    install_missing_models: bool = False,
) -> dict:
    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    normalized = os.path.abspath(path)
    requested_model = str(model_variant or AUTO_OCR_MODEL_VARIANT).strip().lower()
    compare_models = requested_model in {"", AUTO_OCR_MODEL_VARIANT}
    if not compare_models:
        requested_model = _normalize_ocr_model_variant(requested_model)
    if not os.path.isfile(normalized):
        raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")

    cleanup_paths: list[str] = []
    with _queued_ocr_job(job_id, emit) as cancel_event:
        with _locked_ocr_pdf(normalized):
            try:
                _raise_if_ocr_cancelled(cancel_event)
                source_snapshot, _source_identity_before = _create_source_snapshot(normalized)
                cleanup_paths.append(source_snapshot)
                render_source, total_pages, render_temp = _prepare_pdfium_source(source_snapshot)
                if render_temp:
                    cleanup_paths.append(render_temp)
                if total_pages < 1:
                    raise PdfOcrUnavailableError("페이지가 없는 PDF에서는 OCR 배치를 측정할 수 없습니다.")

                detected = _active_detect_ocr_performance_profile()
                if compare_models:
                    result = benchmark_ocr_models_and_profiles(
                        render_source,
                        total_pages,
                        language,
                        detected,
                        emit,
                        cancel_event,
                        install_missing_models,
                    )
                else:
                    selected, result = benchmark_ocr_performance_profile(
                        render_source,
                        total_pages,
                        language,
                        requested_model,
                        detected,
                        emit,
                        cancel_event=cancel_event,
                    )
                    _raise_if_ocr_cancelled(cancel_event)
                    result["profile_path"] = _save_calibrated_ocr_performance_profile(
                        selected,
                        language,
                        requested_model,
                        float(result["seconds_per_page"]),
                    )
                if emit:
                    emit({"type": "done", "result": result})
                return result
            finally:
                for variant in (
                    OCR_MODEL_VARIANT_ORDER if compare_models else (requested_model,)
                ):
                    _discard_engine(language, variant)
                for temp_path in reversed(cleanup_paths):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass


