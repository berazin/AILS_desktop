from __future__ import annotations

from pdf.pdf_ocr_types import _model_limited_ocr_performance_profile

import hashlib
import gc
import json
import logging
import math
import multiprocessing
import os
import queue as queue_module
import re
import sqlite3
import statistics
import sys
import tempfile
import threading
import time
import importlib.util
import uuid
from collections import deque
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager, nullcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image

from common import resource_path
from language_support import (
    TRANSLATION_FONT_CANDIDATES,
    language_korean_name,
    normalize_app_language,
    paddle_recognition_model,
)
import contextvars
from model_manager import ModelUnavailableError, get_model_manager
from local_inference import GPU_SCHEDULER, GpuPriority, normalize_gpu_priority

_CURRENT_OCR_GPU_PRIORITY: contextvars.ContextVar[int] = contextvars.ContextVar(
    "_CURRENT_OCR_GPU_PRIORITY", default=int(GpuPriority.NORMAL)
)
import pdf.paddlex_engine_compat as _paddlex_compat
import pdf.pdf_analysis_metadata as _analysis_metadata
import pdf.pdf_structure as pdf_structure
from ocr_runtime import OCR_PROVIDER_PRIORITY, active_onnxruntime_provider, load_onnxruntime
from pdf.pdf_outline import (
    build_outline as _build_pdf_outline,
    chapter_number as _pdf_outline_chapter_number,
    chapter_title as _pdf_outline_chapter_title,
    choose_app_outline as _choose_app_pdf_outline,
    choose_outline as _choose_pdf_outline,
    entry_for_line as _pdf_outline_entry_for_line,
    native_outline_for_reader as _read_native_pdf_outline,
    toc_page_indexes as _pdf_toc_page_indexes,
)
from pdf.pdfium_runtime import locked_pdfium


from pdf.pdf_ocr_types import *



def _install_paddlex_offline_model_source_guard() -> None:
    _paddlex_compat.install_paddlex_offline_model_source_guard()


def _load_ocr_runtime():
    ort = _paddlex_compat.load_paddlex_runtime()
    from paddleocr import PaddleOCR
    from paddlex.inference import load_pipeline_config
    from paddlex.inference.models.engines.onnxruntime import ONNXRuntimeEngine
    from paddlex.inference.models.runners.onnxruntime_runner import ONNXRuntimeRunner

    return ort, PaddleOCR, load_pipeline_config, ONNXRuntimeEngine, ONNXRuntimeRunner


def validate_ocr_runtime() -> dict:
    ort, *_ = _load_ocr_runtime()
    from paddlex.utils.deps import require_extra

    require_extra("ocr-core")
    providers = list(ort.get_available_providers())
    if "CPUExecutionProvider" not in providers:
        raise RuntimeError("ONNX Runtime CPUExecutionProvider가 없습니다.")
    selected_provider = active_onnxruntime_provider()
    if selected_provider is None:
        raise RuntimeError("ONNX Runtime GPU OCR 공급자가 없습니다.")
    return {"providers": providers, "selected_provider": selected_provider}


OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION = "repeated_rotated_decoration"
OCR_MODEL_VARIANT_ALIASES = {
    "mobile": "small",
    "server": "medium",
}
OCR_DEPENDENCY_PACKAGES = (
    "paddleocr==3.7.0",
    "onnxruntime-gpu==1.29.0",
    "onnxruntime-openvino==1.24.1",
    "onnxruntime-directml==1.24.4",
)
# Calibrated against 객지2(자바).pdf. Each tier retains all 49 exercise
# labels in the regression pages and yields the same 434 recognized
# characters on the formerly under-detected page 47 when pages are isolated.
OCR_MODEL_PRESETS = {
    "tiny": {
        "render_scale": 5.30,
        "text_det_limit_side_len": 64,
        "text_det_limit_type": "min",
        "text_det_max_side_limit": 4000,
        "text_det_thresh": 0.15,
        "text_det_box_thresh": 0.35,
        "text_det_unclip_ratio": 1.40,
        "text_det_input_shape": None,
        "use_dilation": False,
        "score_mode": "fast",
        "max_candidates": 3000,
        "box_type": "quad",
        "isolate_pages": True,
        "max_batch_pages": 2,
    },
    "small": {
        "render_scale": 3.65,
        "text_det_limit_side_len": 64,
        "text_det_limit_type": "min",
        "text_det_max_side_limit": 4000,
        "text_det_thresh": 0.12,
        "text_det_box_thresh": 0.30,
        "text_det_unclip_ratio": 1.40,
        "text_det_input_shape": None,
        "use_dilation": False,
        "score_mode": "fast",
        "max_candidates": 3000,
        "box_type": "quad",
        "isolate_pages": True,
        "max_batch_pages": 4,
    },
    "medium": {
        "render_scale": 2.40,
        "text_det_limit_side_len": 64,
        "text_det_limit_type": "min",
        "text_det_max_side_limit": 4000,
        "text_det_thresh": 0.08,
        "text_det_box_thresh": 0.20,
        "text_det_unclip_ratio": 1.40,
        "text_det_input_shape": None,
        "use_dilation": False,
        "score_mode": "fast",
        "max_candidates": 3000,
        "box_type": "quad",
        "isolate_pages": True,
        "max_batch_pages": 8,
    },
}
_engine_lock = threading.Lock()
_inference_lock = threading.RLock()
_engines: dict[tuple[str, str], object] = {}

# Folder/batch OCR hold: engines stay cached across documents of one batch so
# each document does not pay model session creation again. Discard is
# deferred until the hold is released.
_engine_hold_lock = threading.Lock()
_engine_hold_depth = 0


@contextmanager
def _hold_ocr_engines():
    global _engine_hold_depth
    with _engine_hold_lock:
        _engine_hold_depth += 1
    try:
        yield
    finally:
        release_engines = False
        with _engine_hold_lock:
            _engine_hold_depth -= 1
            release_engines = _engine_hold_depth == 0
        if release_engines:
            release_all_ocr_engines()


def _engines_on_hold() -> bool:
    with _engine_hold_lock:
        return _engine_hold_depth > 0


def release_all_ocr_engines() -> None:
    with _engine_lock:
        keys = list(_engines)
    for language, model_variant in keys:
        _discard_engine(language, model_variant)
    pdf_structure.discard_structure_engine()
    discard_table = getattr(pdf_structure, "discard_table_engine", None)
    if discard_table is not None:
        discard_table()
    if os.environ.get("AILS_OCR_GPU_WORKER") != "1":
        # OpenVINO GPU work runs in the isolated worker process; clear its
        # engine caches too without restarting the worker.
        try:
            import pdf.ocr_gpu_worker as ocr_gpu_worker
            ocr_gpu_worker.release_gpu_worker_engines()
        except Exception:
            pass

_logger = logging.getLogger(__name__)
from pdf.pdf_file_state import _path_locks_guard, _path_locks, _lock_for_pdf, file_digest as _content_digest
_profile_store_lock = threading.Lock()
_ocr_job_condition = threading.Condition()
_ocr_job_queue: deque[str] = deque()
_ocr_job_cancel_events: dict[str, threading.Event] = {}
_active_ocr_job_id: str | None = None





@contextmanager
def _locked_ocr_pdf(path: str):
    with _lock_for_pdf(path):
        yield


def _normalize_ocr_job_id(job_id: str | None, *, generate: bool = True) -> str:
    value = str(job_id or "").strip()
    if not value and generate:
        value = uuid.uuid4().hex
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", value):
        raise ValueError("올바르지 않은 OCR 작업 ID입니다.")
    return value


def _raise_if_ocr_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise PdfOcrCancelledError("OCR 작업이 사용자 요청으로 중단되었습니다.")


@contextmanager
def _queued_ocr_job(
    job_id: str | None,
    emit: Callable[[dict], None] | None,
):
    global _active_ocr_job_id

    normalized = _normalize_ocr_job_id(job_id)
    cancel_event = threading.Event()
    with _ocr_job_condition:
        if normalized in _ocr_job_cancel_events:
            raise ValueError("같은 OCR 작업 ID가 이미 사용 중입니다.")
        _ocr_job_cancel_events[normalized] = cancel_event
        _ocr_job_queue.append(normalized)
        waiting_ahead = len(_ocr_job_queue) - 1 + int(_active_ocr_job_id is not None)

    try:
        if emit:
            emit({
                "type": "queue",
                "stage": "queued",
                "job_id": normalized,
                "position": waiting_ahead + 1,
                "waiting_ahead": waiting_ahead,
            })
        with _ocr_job_condition:
            while True:
                _raise_if_ocr_cancelled(cancel_event)
                if (
                    _active_ocr_job_id is None
                    and _ocr_job_queue
                    and _ocr_job_queue[0] == normalized
                ):
                    break
                _ocr_job_condition.wait(0.2)
            _ocr_job_queue.popleft()
            _active_ocr_job_id = normalized
        if emit:
            emit({"type": "queue", "stage": "running", "job_id": normalized})
        yield cancel_event
    finally:
        with _ocr_job_condition:
            if normalized in _ocr_job_queue:
                _ocr_job_queue.remove(normalized)
            if _active_ocr_job_id == normalized:
                _active_ocr_job_id = None
            _ocr_job_cancel_events.pop(normalized, None)
            _ocr_job_condition.notify_all()


def cancel_ocr_job(job_id: str | None) -> dict:
    normalized = _normalize_ocr_job_id(job_id, generate=False)
    deadline = time.monotonic() + 1.0
    with _ocr_job_condition:
        while normalized not in _ocr_job_cancel_events and time.monotonic() < deadline:
            _ocr_job_condition.wait(min(0.1, deadline - time.monotonic()))
        cancel_event = _ocr_job_cancel_events.get(normalized)
        if cancel_event is None:
            return {"job_id": normalized, "cancelled": False, "status": "not_found"}
        running = _active_ocr_job_id == normalized
        cancel_event.set()
        if not running and normalized in _ocr_job_queue:
            _ocr_job_queue.remove(normalized)
        _ocr_job_condition.notify_all()
        return {
            "job_id": normalized,
            "cancelled": True,
            "status": "cancel_pending" if running else "cancelled",
        }


def _source_identity(path: str) -> PdfSourceIdentity:
    stat = os.stat(path)
    return PdfSourceIdentity(stat.st_size, stat.st_mtime_ns, _content_digest(path))


def _create_source_snapshot(path: str) -> tuple[str, PdfSourceIdentity]:
    source = os.path.abspath(path)
    before = os.stat(source)
    fd, snapshot = tempfile.mkstemp(prefix="ails-ocr-source-", suffix=".pdf")
    digest = hashlib.sha256()
    copied = 0
    try:
        with open(source, "rb") as input_handle, os.fdopen(fd, "wb") as output_handle:
            fd = -1
            while True:
                chunk = input_handle.read(1024 * 1024)
                if not chunk:
                    break
                output_handle.write(chunk)
                digest.update(chunk)
                copied += len(chunk)
            output_handle.flush()
            os.fsync(output_handle.fileno())
        after = os.stat(source)
        if (
            before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or copied != after.st_size
        ):
            raise RuntimeError("OCR 준비 중 PDF가 변경되었습니다. 파일 저장이 끝난 뒤 다시 시도해 주세요.")
        return snapshot, PdfSourceIdentity(after.st_size, after.st_mtime_ns, digest.hexdigest())
    except Exception:
        if fd >= 0:
            os.close(fd)
        try:
            os.remove(snapshot)
        except OSError:
            pass
        raise


def _assert_source_unchanged(path: str, expected: PdfSourceIdentity):
    current = _source_identity(path)
    if current.size != expected.size or current.digest != expected.digest:
        raise RuntimeError("OCR 처리 중 원본 PDF가 변경되어 결과를 저장하지 않았습니다. 다시 시도해 주세요.")


def _available_ocr_execution_providers() -> set[str]:
    try:
        ort = load_onnxruntime()
        return set(ort.get_available_providers())
    except Exception:
        return set()


def _ocr_module_available(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def ocr_dependency_status() -> dict:
    """Return the small, user-safe prerequisite status used before OCR."""
    providers = _available_ocr_execution_providers()
    paddleocr_installed = _ocr_module_available("paddleocr")
    paddlex_installed = _ocr_module_available("paddlex")
    runtime_error = ""
    if paddleocr_installed and paddlex_installed:
        try:
            validate_ocr_runtime()
        except Exception as error:
            runtime_error = str(getattr(error, "name", "") or type(error).__name__)
            paddleocr_installed = False
            paddlex_installed = False
    selected_provider = next((name for name in OCR_PROVIDER_PRIORITY if name in providers), None)
    missing: list[str] = []
    if not paddleocr_installed or not paddlex_installed:
        missing.append("PaddleOCR")
    if selected_provider is None:
        missing.append("GPU OCR 런타임")
    return {
        "ready": not missing,
        "missing": missing,
        "paddleocr_installed": paddleocr_installed,
        "paddlex_installed": paddlex_installed,
        "selected_provider": selected_provider or "CPUExecutionProvider",
        "cuda_installed": "CUDAExecutionProvider" in providers,
        "openvino_installed": "OpenVINOExecutionProvider" in providers,
        "directml_installed": "DmlExecutionProvider" in providers,
        "onnxruntime_installed": bool(providers),
        "installable": False,
        "runtime_packaged": True,
        "runtime_error": runtime_error,
        "packages": list(OCR_DEPENDENCY_PACKAGES),
    }


def install_ocr_dependencies(confirmed: bool = False) -> dict:
    """Runtime code is packaged; downloading Python packages is forbidden."""
    raise PdfOcrUnavailableError(
        "OCR 실행 코드가 앱 패키지에 없습니다. AILS를 다시 설치하거나 업데이트해 주세요."
    )


def _configure_ocr_dependency_logging():
    _paddlex_compat.configure_paddlex_logging()


def _paddle_ocr_options(
    language: str,
    profile: OcrPerformanceProfile | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
) -> dict:
    model_variant = _normalize_ocr_model_variant(model_variant)
    preset = OCR_MODEL_PRESETS[model_variant]
    detection_model = f"PP-OCRv6_{model_variant}_det"
    # PaddleOCR 3.7 does not ship a Korean PP-OCRv6 recognizer, so each
    # language pins its own recognizer (see language_support). The size
    # choice changes only the PP-OCRv6 detection model.
    recognition_model = paddle_recognition_model(language)
    options = {
        "text_detection_model_name": detection_model,
        "text_recognition_model_name": recognition_model,
        "engine": "onnxruntime",
        # ORT severity 3 suppresses non-fatal graph optimizer warnings while
        # preserving ERROR and FATAL output in the backend console.
        "engine_config": {"log_severity_level": 3},
        "device": (
            "gpu"
            if profile is not None and profile.gpu_provider in {
                "DmlExecutionProvider",
                "CUDAExecutionProvider",
                "OpenVINOExecutionProvider",
            }
            else "cpu"
        ),
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "text_det_limit_side_len": preset["text_det_limit_side_len"],
        "text_det_limit_type": preset["text_det_limit_type"],
        # These DB post-processing values are calibrated together with the
        # tier-specific render scale; problem analysis applies stricter
        # spatial and sequence filters after OCR.
        "text_det_thresh": preset["text_det_thresh"],
        "text_det_box_thresh": preset["text_det_box_thresh"],
        "text_det_unclip_ratio": preset["text_det_unclip_ratio"],
        "text_det_input_shape": preset["text_det_input_shape"],
        "text_rec_score_thresh": 0.0,
    }
    if profile is not None:
        options["text_recognition_batch_size"] = profile.recognition_batch
    return options


def _normalize_ocr_model_variant(model_variant: str | None) -> str:
    normalized = str(model_variant or DEFAULT_OCR_MODEL_VARIANT).strip().lower()
    normalized = OCR_MODEL_VARIANT_ALIASES.get(normalized, normalized)
    if normalized not in OCR_MODEL_VARIANTS:
        raise ValueError("지원하지 않는 PaddleOCR 모델 종류입니다.")
    return normalized


def _ocr_render_scale(model_variant: str) -> float:
    return float(OCR_MODEL_PRESETS[_normalize_ocr_model_variant(model_variant)]["render_scale"])


def _ocr_batch_pages(profile: OcrPerformanceProfile, model_variant: str) -> int:
    preset = OCR_MODEL_PRESETS[_normalize_ocr_model_variant(model_variant)]
    return max(1, min(int(profile.batch_pages), int(preset["max_batch_pages"])))




def _ocr_model_names(language: str, model_variant: str) -> tuple[str, str]:
    options = _paddle_ocr_options(language, model_variant=model_variant)
    return options["text_detection_model_name"], options["text_recognition_model_name"]


STRUCTURE_MANAGED_MODEL_ID = "ppstructure-v3-korean-onnx"


def _managed_model_id_for_pipeline(pipeline: str, variant: str) -> str:
    if pipeline == "legacy":
        return OCR_MANAGED_MODEL_IDS[variant]
    return STRUCTURE_MANAGED_MODEL_ID


def ocr_model_status(
    language: str = DEFAULT_LANGUAGE,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
    pipeline: str = "structure",
) -> dict:
    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    normalized = _normalize_ocr_model_variant(model_variant)
    if language != "korean":
        # Managed manifests are Korean-only; other languages download their
        # recognizer through the PaddleX cache on first use.
        return {
            "managed": False,
            "ready": True,
            "download_required": False,
            "update_available": False,
            "model_id": "",
            "file_size": 0,
        }
    status = get_model_manager().status(
        _managed_model_id_for_pipeline(str(pipeline or "structure"), normalized)
    )
    return {"managed": True, **status}


def install_ocr_model(
    confirmed: bool,
    language: str = DEFAULT_LANGUAGE,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
    emit: Callable[[dict], None] | None = None,
    cancel_event: threading.Event | None = None,
    pipeline: str = "structure",
) -> dict:
    if confirmed is not True:
        raise ValueError("AI 모델 다운로드는 사용자 확인 후에만 실행할 수 있습니다.")
    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    normalized = _normalize_ocr_model_variant(model_variant)
    if language != "korean":
        raise PdfOcrUnavailableError(
            "모델 관리 다운로드는 한국어 OCR만 지원합니다. 영어·일본어·중국어 모델은 첫 OCR 실행 시 자동으로 내려받습니다."
        )
    status = get_model_manager().install(
        _managed_model_id_for_pipeline(str(pipeline or "structure"), normalized),
        progress=emit,
        cancel_check=cancel_event.is_set if cancel_event is not None else None,
    )
    with _engine_lock:
        _engines.clear()
    pdf_structure.discard_structure_engine(language)
    return {"managed": True, **status}


def _managed_ocr_model_dirs(language: str, model_variant: str) -> tuple[str, str]:
    if language != "korean":
        detection_model, recognition_model = _ocr_model_names(language, model_variant)
        detection_dir = _cached_onnx_model_dir(detection_model)
        recognition_dir = _cached_onnx_model_dir(recognition_model)
        if not detection_dir or not recognition_dir:
            raise PdfOcrUnavailableError(
                f"{language_korean_name(language)} OCR 모델 파일을 찾을 수 없습니다."
            )
        return detection_dir, recognition_dir
    try:
        root = get_model_manager().resolve(
            OCR_MANAGED_MODEL_IDS[_normalize_ocr_model_variant(model_variant)]
        )
    except ModelUnavailableError as error:
        raise PdfOcrUnavailableError(str(error)) from error
    return str(root / "detector"), str(root / "recognizer")


def _ocr_engine_name(model_variant: str) -> str:
    normalized = _normalize_ocr_model_variant(model_variant)
    return f"PaddleOCR V6 {normalized.capitalize()} Detection ONNX / Windows ML"


def _cached_onnx_model_dir(model_name: str) -> str | None:
    cache_root = os.environ.get(
        "PADDLE_PDX_CACHE_HOME",
        os.path.join(os.path.expanduser("~"), ".paddlex"),
    )
    candidate = os.path.join(cache_root, "official_models", f"{model_name}_onnx")
    required_files = ("inference.onnx", "inference.yml")
    if all(os.path.isfile(os.path.join(candidate, name)) for name in required_files):
        return candidate
    return None


def _emit_first_use_download_notice(
    emit: Callable[[dict], None] | None,
    language: str,
) -> None:
    """Warn the client when a non-Korean recognizer still needs downloading.

    PaddleX fetches non-Korean recognizers on first engine creation without a
    progress callback, so surface an explicit one-time notice event instead of
    leaving the first OCR run silently slow.
    """
    if emit is None:
        return
    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    if language == "korean":
        return
    recognition_model = paddle_recognition_model(language)
    if _cached_onnx_model_dir(recognition_model) is not None:
        return
    emit({
        "type": "model_first_use",
        "language": language,
        "model": recognition_model,
        "message": (
            f"{language_korean_name(language)} OCR 인식 모델을 처음 사용합니다. "
            "백그라운드에서 내려받는 동안 몇 분 걸릴 수 있습니다."
        ),
    })


def _apply_ocr_batch_config(config: dict, profile: OcrPerformanceProfile) -> dict:
    config["batch_size"] = profile.detector_batch
    submodules = config.setdefault("SubModules", {})
    submodules.setdefault("TextDetection", {})["batch_size"] = profile.detector_batch
    submodules.setdefault("TextRecognition", {})["batch_size"] = profile.recognition_batch
    return config


def _dml_device_id() -> int:
    return _paddlex_compat.dml_device_id()


def _cuda_device_id() -> int:
    return _paddlex_compat.cuda_device_id()


def _ocr_provider_device_id(provider: str | None) -> int:
    return _paddlex_compat.provider_device_id(provider)


def _ocr_provider_options(provider: str | None) -> dict:
    return _paddlex_compat.provider_options(provider)


def _log_ocr_engine_info(
    model_variant: str,
    detection_model: str,
    recognition_model: str,
    gpu_provider: str | None,
):
    device_id = _ocr_provider_device_id(gpu_provider)
    _logger.info(
        "OCR engine created: variant=%s det=%s rec=%s provider=%s device_id=%d pid=%d",
        model_variant, detection_model, recognition_model,
        gpu_provider or "CPU", device_id, os.getpid(),
    )


def _apply_ocr_detector_postprocess_config(engine, model_variant: str):
    preset = OCR_MODEL_PRESETS[_normalize_ocr_model_variant(model_variant)]
    try:
        postprocess = engine.paddlex_pipeline.text_det_model.post_op
    except AttributeError:
        return
    postprocess.use_dilation = bool(preset["use_dilation"])
    postprocess.score_mode = str(preset["score_mode"])
    postprocess.max_candidates = int(preset["max_candidates"])
    postprocess.box_type = str(preset["box_type"])


def _create_engine(
    language: str,
    profile: OcrPerformanceProfile | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
):
    if os.name != "nt":
        raise PdfOcrUnavailableError("Windows ML OCR은 Windows에서만 사용할 수 있습니다.")
    model_variant = _normalize_ocr_model_variant(model_variant)
    detection_model_dir, recognition_model_dir = _managed_ocr_model_dirs(
        language,
        model_variant,
    )
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    try:
        ort, PaddleOCR, load_pipeline_config, _ONNXRuntimeEngine, _ONNXRuntimeRunner = (
            _load_ocr_runtime()
        )
    except Exception as error:
        _logger.exception("Failed to import the packaged PaddleOCR runtime")
        missing = str(getattr(error, "name", "") or type(error).__name__)
        raise PdfOcrUnavailableError(
            f"PaddleOCR 실행 모듈을 불러오지 못했습니다 ({missing}). "
            "AILS를 다시 설치하거나 업데이트해 주세요."
        ) from error

    providers = set(ort.get_available_providers())
    profile = profile or detect_ocr_performance_profile()
    if profile.gpu_provider and profile.gpu_provider not in providers:
        raise PdfOcrUnavailableError(
            "선택한 GPU OCR 공급자를 더 이상 사용할 수 없습니다. CPU 실행 여부를 다시 확인해 주세요."
        )
    if profile.gpu_provider is None and "CPUExecutionProvider" not in providers:
        raise PdfOcrUnavailableError("ONNX Runtime CPU OCR 공급자를 찾지 못했습니다.")

    _configure_ocr_dependency_logging()
    _paddlex_compat.install_onnxruntime_engine_patches(ort, profile)

    preset = OCR_MODEL_PRESETS[model_variant]
    pipeline_config = _apply_ocr_batch_config(load_pipeline_config("OCR"), profile)
    pipeline_config.setdefault("SubModules", {}).setdefault("TextDetection", {})[
        "max_side_limit"
    ] = int(preset["text_det_max_side_limit"])
    options = _paddle_ocr_options(language, profile, model_variant)
    detection_model = str(options["text_detection_model_name"])
    recognition_model = str(options["text_recognition_model_name"])
    options["text_detection_model_dir"] = detection_model_dir
    options["text_recognition_model_dir"] = recognition_model_dir
    options["paddlex_config"] = pipeline_config
    try:
        engine = PaddleOCR(**options)
    except UnicodeDecodeError as error:
        raise PdfOcrUnavailableError(
            "PaddleOCR 모델 파일 또는 변환 도구의 문자 인코딩을 읽지 못했습니다. "
            "로컬 ONNX 모델 캐시를 다시 확인해 주세요."
        ) from error
    _apply_ocr_detector_postprocess_config(engine, model_variant)
    _log_ocr_engine_info(
        model_variant, detection_model, recognition_model,
        profile.gpu_provider if profile else None,
    )
    return engine


def _set_engine_batches(engine, profile: OcrPerformanceProfile):
    try:
        pipeline = engine.paddlex_pipeline
        pipeline.batch_sampler.batch_size = profile.detector_batch
        pipeline.text_det_model.batch_sampler.batch_size = profile.detector_batch
        pipeline.text_rec_model.batch_sampler.batch_size = profile.recognition_batch
    except AttributeError:
        # Tests and compatibility wrappers may expose only the public predict API.
        pass


def _discard_engine(language: str, model_variant: str):
    key = (language or DEFAULT_LANGUAGE, _normalize_ocr_model_variant(model_variant))
    with _engine_lock:
        engine = _engines.pop(key, None)
    if engine is not None:
        try:
            engine.close()
        except (AttributeError, RuntimeError):
            pass
        _paddlex_compat.release_paddlex_onnx_sessions(engine)
        del engine
    gc.collect()


def _is_dml_execution_error(error: Exception, profile: OcrPerformanceProfile | None) -> bool:
    if not profile or profile.gpu_provider != "DmlExecutionProvider":
        return False
    if isinstance(error, UnicodeDecodeError):
        # ONNX Runtime can mask the localized DXGI error text with this decode
        # failure while converting a DirectML exception to a Python exception.
        _logger.error(
            "DML UnicodeDecodeError (likely DXGI): pid=%d tid=%s device_id=%d",
            os.getpid(), threading.current_thread().ident, _dml_device_id(),
        )
        return True
    message = str(error).lower()
    is_dml = any(
        marker in message
        for marker in (
            "887a0005",
            "887a0006",
            "dml execution provider",
            "dmlexecutionprovider",
            "mloperatorauthorimpl",
            "executekernel",
            "device removed",
            "device hung",
            "dxgi_error",
        )
    )
    if is_dml:
        _logger.error(
            "DML execution error detected: %s pid=%d tid=%s device_id=%d error=%s",
            type(error).__name__, os.getpid(),
            threading.current_thread().ident, _dml_device_id(),
            str(error)[:300],
        )
    return is_dml


def _engine(
    language: str,
    profile: OcrPerformanceProfile | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
):
    language = language or DEFAULT_LANGUAGE
    model_variant = _normalize_ocr_model_variant(model_variant)
    key = (language, model_variant)
    with _engine_lock:
        if key not in _engines:
            _engines[key] = _create_engine(language, profile, model_variant)
        engine = _engines[key]
        if profile is not None:
            _set_engine_batches(engine, profile)
        return engine


class _PaddleXCrossPageUnavailable(RuntimeError):
    """The installed OCR wrapper cannot expose the local PaddleX fast path."""


def _model_batch_size(model, default: int = 1) -> int:
    sampler = getattr(model, "batch_sampler", None)
    try:
        return max(1, int(getattr(sampler, "batch_size", default)))
    except (TypeError, ValueError):
        return max(1, int(default))


def _cross_page_paddlex_pipeline(engine):
    pipeline = getattr(engine, "paddlex_pipeline", None)
    if pipeline is None:
        raise _PaddleXCrossPageUnavailable("PaddleX pipeline is not exposed")
    try:
        required = (
            pipeline.img_reader,
            pipeline.text_det_model,
            pipeline.text_rec_model,
            pipeline.get_text_det_params,
            pipeline._sort_boxes,
            pipeline._crop_by_polys,
        )
        if any(item is None for item in required):
            raise AttributeError("missing PaddleX OCR component")
        if pipeline.use_doc_preprocessor or pipeline.use_textline_orientation:
            raise _PaddleXCrossPageUnavailable(
                "cross-page recognition requires disabled orientation preprocessing"
            )
        if pipeline.text_type != "general" or pipeline.return_word_box:
            raise _PaddleXCrossPageUnavailable(
                "cross-page recognition only supports general text without word boxes"
            )
    except _PaddleXCrossPageUnavailable:
        raise
    except AttributeError as error:
        raise _PaddleXCrossPageUnavailable(
            "installed PaddleX OCR internals are incompatible"
        ) from error
    return pipeline


def _detect_cross_page_polys(pipeline, page_images: list) -> list[list]:
    """Detect in same-shaped page batches and restore the caller's page order."""
    if not page_images:
        return []
    detector = pipeline.text_det_model
    detector_batch = _model_batch_size(detector)
    text_det_params = pipeline.get_text_det_params()
    groups: dict[tuple[int, ...], list[tuple[int, object]]] = {}
    for page_index, image in enumerate(page_images):
        shape = tuple(int(value) for value in getattr(image, "shape", ()))
        if len(shape) != 3:
            raise ValueError("OCR page image must be a three-dimensional array")
        groups.setdefault(shape, []).append((page_index, image))

    detected: list[list | None] = [None] * len(page_images)
    for entries in groups.values():
        batch_results = list(
            detector(
                [image for _, image in entries],
                batch_size=detector_batch,
                **text_det_params,
            )
        )
        if len(batch_results) != len(entries):
            raise RuntimeError("PaddleX text detector returned an unexpected page count")
        for (page_index, _), result in zip(entries, batch_results):
            data = _result_payload(result)
            data = data.get("res", data)
            polys = data.get("dt_polys")
            if polys is None:
                raise RuntimeError("PaddleX text detector result has no polygons")
            detected[page_index] = list(pipeline._sort_boxes(polys))

    if any(polys is None for polys in detected):
        raise RuntimeError("PaddleX text detector did not return every page")
    return [polys for polys in detected if polys is not None]


def _recognition_result_text_score(result) -> tuple[str, float]:
    data = _result_payload(result)
    data = data.get("res", data)
    text = data.get("rec_text", "")
    if isinstance(text, (list, tuple)):
        text = text[0] if text else ""
    text = str(text or "").strip()
    raw_score = data.get("rec_score", 0)
    try:
        score = float(raw_score)
    except (TypeError, ValueError):
        try:
            score = float(raw_score.reshape(-1)[0])
        except (AttributeError, IndexError, TypeError, ValueError):
            score = 0.0
    return text, score


def _recognize_text_crops_double_buffered(
    recognizer,
    crops: list,
    batch_size: int,
) -> list[tuple[str, float]]:
    """Overlap CPU crop preprocessing with one DirectML recognition session."""
    if not crops:
        return []
    try:
        import numpy as np

        pre_tfs = recognizer.pre_tfs
        read_images = pre_tfs["Read"]
        resize_images = pre_tfs["ReisizeNorm"]
        to_batch = pre_tfs["ToBatch"]
        runner = recognizer.runner
        post_op = recognizer.post_op
    except (AttributeError, KeyError, TypeError):
        results = list(
            recognizer(crops, batch_size=batch_size, return_word_box=False)
        )
        return [_recognition_result_text_score(result) for result in results]

    batches = [
        crops[start:start + batch_size]
        for start in range(0, len(crops), batch_size)
    ]

    def prepare(batch_crops: list):
        raw_images = read_images(imgs=batch_crops)
        ratios = [
            int(image.shape[1]) / float(int(image.shape[0]))
            for image in raw_images
        ]
        resized = resize_images(imgs=raw_images)
        inputs = to_batch(imgs=resized)
        return inputs, ratios, max([320 / 48, *ratios])

    recognized: list[tuple[str, float]] = []
    with ThreadPoolExecutor(
        max_workers=1,
        thread_name_prefix="ails-ocr-recognition-preprocess",
    ) as executor:
        prepared_future = executor.submit(prepare, batches[0])
        for batch_index in range(len(batches)):
            inputs, ratios, max_ratio = prepared_future.result()
            prepared_future = (
                executor.submit(prepare, batches[batch_index + 1])
                if batch_index + 1 < len(batches)
                else None
            )
            predictions = runner(x=inputs)
            texts, scores = post_op(
                predictions,
                return_word_box=False,
                wh_ratio_list=ratios,
                max_wh_ratio=max_ratio,
            )
            recognized.extend(
                (str(text or "").strip(), float(score))
                for text, score in zip(texts, scores)
            )
    return recognized


def _recognize_batch_cross_page(engine, image_arrays: list) -> list[list[OcrWord]]:
    """Recognize all detected line crops through one cross-page model queue."""
    pipeline = _cross_page_paddlex_pipeline(engine)
    page_images = list(pipeline.img_reader(image_arrays))
    if len(page_images) != len(image_arrays):
        raise RuntimeError("PaddleX image reader returned an unexpected page count")
    page_polys = _detect_cross_page_polys(pipeline, page_images)

    crop_refs = []
    for page_index, (page_image, polys) in enumerate(zip(page_images, page_polys)):
        crops = list(pipeline._crop_by_polys(page_image, polys))
        if len(crops) != len(polys):
            raise RuntimeError("PaddleX crop count does not match detected polygons")
        for poly, crop in zip(polys, crops):
            shape = getattr(crop, "shape", ())
            size = int(getattr(crop, "size", 0))
            if size <= 0 or len(shape) < 2 or int(shape[0]) <= 0 or int(shape[1]) <= 0:
                continue
            crop_refs.append({
                "page_index": page_index,
                "poly": poly,
                "image": crop,
                "ratio": int(shape[1]) / float(int(shape[0])),
            })

    if not crop_refs:
        return [[] for _ in page_images]

    # PaddleX sorts each page's crops by aspect ratio. Sorting the one combined
    # queue keeps similarly-sized lines in a model batch; the references restore
    # the original page/polygon association after recognition.
    sorted_refs = sorted(crop_refs, key=lambda item: item["ratio"])
    recognizer = pipeline.text_rec_model
    recognition_batch = _model_batch_size(recognizer)
    recognition_results = _recognize_text_crops_double_buffered(
        recognizer,
        [item["image"] for item in sorted_refs],
        recognition_batch,
    )
    if len(recognition_results) != len(sorted_refs):
        raise RuntimeError("PaddleX text recognizer returned an unexpected crop count")

    threshold = float(getattr(pipeline, "text_rec_score_thresh", 0) or 0)
    pages: list[list[OcrWord]] = [[] for _ in page_images]
    for item, (text, score) in zip(sorted_refs, recognition_results):
        if not text or score < threshold:
            continue
        text = _correct_ocr_confusable_text(text, score)
        points = list(item["poly"])
        if not points:
            continue
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        pages[int(item["page_index"])].append(
            OcrWord(text, min(xs), min(ys), max(xs), max(ys), score)
        )

    return [_deduplicate_ocr_words(words) for words in pages]


def _recognize(
    image: Image.Image,
    language: str,
    profile: OcrPerformanceProfile | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
) -> list[OcrWord]:
    import numpy as np

    image_array = np.asarray(image.convert("RGB"))
    try:
        scheduler = (
            GPU_SCHEDULER.acquire("ocr", priority=_CURRENT_OCR_GPU_PRIORITY.get())
            if profile is not None and profile.gpu_provider
            else nullcontext()
        )
        with scheduler:
            with _inference_lock:
                prediction = _engine(language, profile, model_variant).predict(image_array)
                result = next(iter(prediction), None)
    except Exception as error:
        if _is_dml_execution_error(error, profile):
            raise DmlOcrExecutionError(
                "DirectML GPU가 OCR 연산 중 재설정되었습니다."
            ) from error
        raise
    return _words_from_result(result)


def _recognize_batch(
    images: list[Image.Image],
    language: str,
    profile: OcrPerformanceProfile | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
) -> list[list[OcrWord]]:
    if not images:
        return []
    model_variant = _normalize_ocr_model_variant(model_variant)
    if len(images) > 1 and OCR_MODEL_PRESETS[model_variant]["isolate_pages"]:
        # Recognition crop widths otherwise depend on which neighboring pages
        # share the cross-page queue. Isolating each page keeps the calibrated
        # result stable regardless of render batch composition.
        return [
            _recognize(image, language, profile, model_variant)
            for image in images
        ]
    if len(images) == 1:
        return [_recognize(images[0], language, profile, model_variant)]
    import numpy as np

    try:
        image_arrays = [np.asarray(image.convert("RGB")) for image in images]
        scheduler = (
            GPU_SCHEDULER.acquire("ocr", priority=_CURRENT_OCR_GPU_PRIORITY.get())
            if profile is not None and profile.gpu_provider
            else nullcontext()
        )
        with scheduler:
            with _inference_lock:
                engine = _engine(language, profile, model_variant)
                try:
                    return _recognize_batch_cross_page(engine, image_arrays)
                except _PaddleXCrossPageUnavailable:
                    prediction = list(engine.predict(image_arrays))
        if len(prediction) != len(images):
            raise RuntimeError("OCR 배치 결과의 페이지 수가 일치하지 않습니다.")
        return [_words_from_result(result) for result in prediction]
    except DmlOcrExecutionError:
        raise
    except Exception as error:
        if _is_dml_execution_error(error, profile):
            raise DmlOcrExecutionError(
                "DirectML GPU가 OCR 배치 연산 중 재설정되었습니다."
            ) from error
        midpoint = max(1, len(images) // 2)
        return _recognize_batch(images[:midpoint], language, profile, model_variant) + _recognize_batch(
            images[midpoint:], language, profile, model_variant
        )


def _render_pdf_page(path: str, page_index: int, scale: float = 2.5) -> Image.Image:
    import pypdfium2 as pdfium

    with locked_pdfium():
        document = pdfium.PdfDocument(path)
        page = None
        try:
            page = document[page_index]
            bitmap = page.render(scale=scale)
            pil_image = bitmap.to_pil()
            try:
                return pil_image.convert("RGB")
            finally:
                pil_image.close()
                bitmap.close()
        finally:
            if page is not None:
                page.close()
            document.close()


def _render_pdf_pages(path: str, page_indexes: list[int], scale: float = 2.5) -> list[tuple[int, Image.Image]]:
    import pypdfium2 as pdfium

    with locked_pdfium():
        document = pdfium.PdfDocument(path)
        rendered = []
        try:
            for page_index in page_indexes:
                page = document[page_index]
                try:
                    bitmap = page.render(scale=scale)
                    pil_image = bitmap.to_pil()
                    try:
                        image = pil_image.convert("RGB")
                    finally:
                        pil_image.close()
                        bitmap.close()
                    rendered.append((page_index, image))
                finally:
                    page.close()
            return rendered
        except Exception:
            for _, image in rendered:
                image.close()
            raise
        finally:
            document.close()


def _normalize_pdf_for_pdfium(path: str) -> tuple[str, int]:
    import pypdfium2 as pdfium
    from pypdf import PdfReader, PdfWriter

    fd, normalized_path = tempfile.mkstemp(prefix="ails-ocr-normalized-", suffix=".pdf")
    try:
        os.close(fd)
        fd = -1
        reader = PdfReader(path)
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        with open(normalized_path, "wb") as output:
            writer.write(output)
        with locked_pdfium():
            document = pdfium.PdfDocument(normalized_path)
            try:
                return normalized_path, len(document)
            finally:
                document.close()
    except Exception:
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            os.remove(normalized_path)
        except OSError:
            pass
        raise


def _prepare_pdfium_source(path: str) -> tuple[str, int, str | None]:
    import pypdfium2 as pdfium

    try:
        with locked_pdfium():
            document = pdfium.PdfDocument(path)
            try:
                return path, len(document), None
            finally:
                document.close()
    except Exception as format_error:
        try:
            normalized_path, page_count = _normalize_pdf_for_pdfium(path)
            return normalized_path, page_count, normalized_path
        except Exception as normalized_error:
            raise RuntimeError(
                f"PDF 구조를 읽지 못했습니다. PDFium: {format_error}; pypdf 정규화: {normalized_error}"
            ) from normalized_error


def _recognize_pdf_pages(
    render_source: str,
    total: int,
    profile: OcrPerformanceProfile,
    language: str,
    model_variant: str,
    emit: Callable[[dict], None] | None,
    cancel_event: threading.Event | None = None,
) -> tuple[list[list[OcrWord]], list[tuple[int, int]]]:
    _raise_if_ocr_cancelled(cancel_event)
    pages: list[list[OcrWord]] = [[] for _ in range(total)]
    image_sizes: list[tuple[int, int]] = [(1, 1) for _ in range(total)]
    batch_pages = _ocr_batch_pages(profile, model_variant)
    page_groups = [
        list(range(start, min(start + batch_pages, total)))
        for start in range(0, total, batch_pages)
    ]
    render_scale = _ocr_render_scale(model_variant)
    current_future = None
    try:
        with ThreadPoolExecutor(max_workers=profile.render_workers, thread_name_prefix="ails-ocr-render") as executor:
            current_future = (
                executor.submit(_render_pdf_pages, render_source, page_groups[0], render_scale)
                if page_groups
                else None
            )
            for group_index, _page_indexes in enumerate(page_groups):
                _raise_if_ocr_cancelled(cancel_event)
                rendered = current_future.result()
                _raise_if_ocr_cancelled(cancel_event)
                next_indexes = page_groups[group_index + 1] if group_index + 1 < len(page_groups) else []
                current_future = (
                    executor.submit(_render_pdf_pages, render_source, next_indexes, render_scale)
                    if next_indexes
                    else None
                )
                try:
                    recognized = _recognize_batch(
                        [image for _, image in rendered], language, profile, model_variant
                    )
                    _raise_if_ocr_cancelled(cancel_event)
                    if len(recognized) != len(rendered):
                        raise RuntimeError("OCR 결과의 페이지 수가 렌더링한 페이지 수와 일치하지 않습니다.")
                    for (page_index, image), words in zip(rendered, recognized):
                        words = _correct_ocr_page_words(words, image.width, image.height)
                        pages[page_index] = words
                        image_sizes[page_index] = image.size
                        if emit:
                            emit({"type": "progress", "page": page_index + 1, "total": total, "text": _page_text(words)})
                finally:
                    for _, image in rendered:
                        image.close()
    except Exception:
        if current_future is not None:
            current_future.cancel()
        raise
    return pages, image_sizes


def run_full_pdf_ocr(
    path: str,
    language: str = DEFAULT_LANGUAGE,
    emit: Callable[[dict], None] | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
    job_id: str | None = None,
    force: bool = False,
    priority: int | str | None = None,
    only_textless_pages: bool = False,
) -> dict:
    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    normalized = os.path.abspath(path)
    from documents.presentation_processing_policy import is_presentation_pdf
    presentation_pdf = is_presentation_pdf(normalized)
    only_textless_pages = only_textless_pages or presentation_pdf
    model_variant = _normalize_ocr_model_variant(model_variant)
    if not os.path.isfile(normalized):
        raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")
    prio = normalize_gpu_priority(priority, default=GpuPriority.NORMAL)
    token = _CURRENT_OCR_GPU_PRIORITY.set(prio)
    try:
        with _queued_ocr_job(job_id, emit) as cancel_event:
            with _locked_ocr_pdf(normalized):
                status = pdf_ocr_status(normalized)
                needs_ocr = status.get("needs_ocr") if "needs_ocr" in status else not status.get("has_text")
                if not needs_ocr and not force and not only_textless_pages:
                    result = {
                        **status,
                        "skipped": True,
                        "skip_reason": "text_layer_exists",
                    }
                    if emit:
                        emit({"type": "skipped", "reason": "text_layer_exists", "result": result})
                        emit({"type": "done", "result": result})
                    return result
                textless_indexes: list[int] | None = None
                if only_textless_pages:
                    # 프레젠테이션 변환 PDF 등 텍스트 레이어가 있는 슬라이드는
                    # 원본 텍스트를 그대로 두고 텍스트 없는 슬라이드만 OCR한다.
                    textless_indexes = pdf_pages_missing_text_layer(
                        normalized, minimum_characters=1,
                    )
                    if not textless_indexes:
                        result = {
                            **status,
                            "skipped": True,
                            "skip_reason": "text_layer_exists",
                        }
                        if emit:
                            emit({"type": "skipped", "reason": "text_layer_exists", "result": result})
                            emit({"type": "done", "result": result})
                        return result
                return _run_full_pdf_ocr_locked(
                    normalized,
                    language,
                    emit,
                    model_variant,
                    cancel_event,
                    textless_indexes=textless_indexes,
                    preflight_status=status,
                )
    finally:
        _CURRENT_OCR_GPU_PRIORITY.reset(token)


def run_pdf_ocr_batch(
    paths: list[str],
    language: str = DEFAULT_LANGUAGE,
    emit: Callable[[dict], None] | None = None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
    job_id: str | None = None,
) -> dict:
    from documents.presentation_processing_policy import is_presentation_pdf
    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    _emit_first_use_download_notice(emit, language)
    normalized_paths = list(dict.fromkeys(os.path.abspath(path) for path in paths))
    for path in normalized_paths:
        if not os.path.isfile(path):
            raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")
    model_variant = _normalize_ocr_model_variant(model_variant)
    result = {
        "total": len(normalized_paths),
        "completed": 0,
        "skipped_text": 0,
        "failed": 0,
        "errors": [],
    }
    if emit:
        emit({"type": "batch", "stage": "start", **result})

    with _queued_ocr_job(job_id, emit) as cancel_event:
        # Keep the OCR/structure engines cached across the batch's documents;
        # model session creation dominates small PDFs otherwise.
        with _hold_ocr_engines():
            for file_index, path in enumerate(normalized_paths, start=1):
                _raise_if_ocr_cancelled(cancel_event)
                file_name = os.path.basename(path)
                with _locked_ocr_pdf(path):
                    status = pdf_ocr_status(path)
                    textless_indexes = (
                        pdf_pages_missing_text_layer(path, minimum_characters=1)
                        if is_presentation_pdf(path) else None
                    )
                    if textless_indexes == [] or (textless_indexes is None and status.get("has_text")):
                        result["skipped_text"] += 1
                        if emit:
                            emit({
                                "type": "file_skipped",
                                "reason": "text_layer_exists",
                                "file_index": file_index,
                                "file_total": len(normalized_paths),
                                "path": path,
                                "file_name": file_name,
                            })
                        continue
                    if emit:
                        emit({
                            "type": "file_start",
                            "file_index": file_index,
                            "file_total": len(normalized_paths),
                            "path": path,
                            "file_name": file_name,
                        })

                    def emit_file(event: dict):
                        if not emit:
                            return
                        payload = {
                            **event,
                            "file_index": file_index,
                            "file_total": len(normalized_paths),
                            "path": path,
                            "file_name": file_name,
                        }
                        if event.get("type") == "done":
                            payload["type"] = "file_done"
                        emit(payload)

                    try:
                        scope_options = {} if textless_indexes is None else {"textless_indexes": textless_indexes}
                        _run_full_pdf_ocr_locked(
                            path,
                            language,
                            emit_file,
                            model_variant,
                            cancel_event,
                            preflight_status=status,
                            **scope_options,
                        )
                        result["completed"] += 1
                    except PdfOcrCancelledError:
                        raise
                    except Exception as error:
                        result["failed"] += 1
                        result["errors"].append({"path": path, "error": str(error)})
                        if emit:
                            emit({
                                "type": "file_error",
                                "file_index": file_index,
                                "file_total": len(normalized_paths),
                                "path": path,
                                "file_name": file_name,
                                "error": str(error),
                            })

    if emit:
        emit({"type": "done", "result": result})
    return result


def _run_full_pdf_ocr_locked(
    normalized: str,
    language: str,
    emit: Callable[[dict], None] | None,
    model_variant: str = DEFAULT_OCR_MODEL_VARIANT,
    cancel_event: threading.Event | None = None,
    textless_indexes: list[int] | None = None,
    preflight_status: dict | None = None,
) -> dict:
    from pypdf import PdfReader

    _emit_first_use_download_notice(emit, language)
    status = preflight_status if preflight_status is not None else pdf_ocr_status(normalized)
    repair_index_only = bool(status.get("index_repair_required"))
    source_snapshot = None
    render_temp = None
    output_temp = None
    cleanup_paths: list[str] = []
    engine_released = False
    index_commit = None
    try:
        _raise_if_ocr_cancelled(cancel_event)
        source_snapshot, source_identity = _create_source_snapshot(normalized)
        cleanup_paths.append(source_snapshot)
        snapshot_reader = PdfReader(source_snapshot)
        native_page_texts: dict[int, str] | None = None
        native_pages = None
        native_sizes = None
        try:
            if snapshot_reader.is_encrypted:
                raise PdfOcrUnavailableError("암호화된 PDF는 잠금을 해제한 뒤 전체 OCR을 실행해 주세요.")
            if _pdf_has_signature(snapshot_reader):
                raise PdfOcrUnavailableError("전자 서명된 PDF는 서명을 무효화할 수 있어 OCR 결과를 원본에 저장할 수 없습니다.")
            if textless_indexes is not None:
                # OCR하지 않는 슬라이드는 원본 텍스트를 검색 색인에 반영한다.
                textless_set = set(textless_indexes)
                native_page_texts = {}
                for page_index, page in enumerate(snapshot_reader.pages):
                    if page_index in textless_set:
                        continue
                    try:
                        text = (page.extract_text() or "").strip()
                    except Exception:
                        text = ""
                    if text:
                        native_page_texts[page_index + 1] = text
                from pdf.pdf_native_text import native_text_pages
                native_pages, native_sizes = native_text_pages(
                    source_snapshot, snapshot_reader,
                    page_indexes=[page - 1 for page in native_page_texts], visible_only=True,
                )
        finally:
            snapshot_stream = getattr(snapshot_reader, "stream", None)
            if snapshot_stream is not None and hasattr(snapshot_stream, "close"):
                snapshot_stream.close()

        # Read the private snapshot directly when PDFium accepts it. Normalize
        # malformed PDFs only as a fallback; rewriting a large valid book here
        # delays the first OCR progress event and duplicates hundreds of MB.
        render_source, total, render_temp = _prepare_pdfium_source(source_snapshot)
        if render_temp:
            cleanup_paths.append(render_temp)

        profile = _load_calibrated_ocr_performance_profile(
            detect_ocr_performance_profile(),
            language,
            model_variant,
        )
        detection_model = pdf_structure.ANALYSIS_DETECTION_MODEL
        recognition_model = paddle_recognition_model(language)
        if emit:
            emit({
                "type": "profile",
                "total": total,
                "batch_pages": _ocr_batch_pages(profile, model_variant),
                "detector_batch": profile.detector_batch,
                "recognition_batch": profile.recognition_batch,
                "render_workers": profile.render_workers,
                "prefetch_pages": profile.prefetch_pages,
                "gpu_provider": profile.gpu_provider,
                "logical_cpus": profile.logical_cpus,
                "total_memory_gb": profile.total_memory_gb,
                "available_memory_gb": profile.available_memory_gb,
                "model_variant": model_variant,
                "detection_model": detection_model,
                "recognition_model": recognition_model,
                "pipeline": pdf_structure.ANALYSIS_PIPELINE,
            })

        pages = None
        image_sizes = None
        analyses = None
        try:
            pages, image_sizes, analyses = _analyze_pdf_pages_structure(
                render_source, total, profile, language, model_variant, emit, cancel_event,
                page_indexes=textless_indexes,
            )
        except DmlOcrExecutionError as error:
            retry_profile = _safe_dml_profile(profile)
            pdf_structure.discard_structure_engine(language)
            if emit:
                emit({"type": "retry", "reason": "dml-device-reset", "page": 0, "total": total})
                emit({
                    "type": "profile",
                    "total": total,
                    "batch_pages": _ocr_batch_pages(retry_profile, model_variant),
                    "detector_batch": retry_profile.detector_batch,
                    "recognition_batch": retry_profile.recognition_batch,
                    "render_workers": retry_profile.render_workers,
                    "prefetch_pages": retry_profile.prefetch_pages,
                    "gpu_provider": retry_profile.gpu_provider,
                    "logical_cpus": retry_profile.logical_cpus,
                    "total_memory_gb": retry_profile.total_memory_gb,
                    "available_memory_gb": retry_profile.available_memory_gb,
                    "model_variant": model_variant,
                    "detection_model": detection_model,
                    "recognition_model": recognition_model,
                    "pipeline": pdf_structure.ANALYSIS_PIPELINE,
                })
            try:
                pages, image_sizes, analyses = _analyze_pdf_pages_structure(
                    render_source, total, retry_profile, language, model_variant, emit, cancel_event,
                    page_indexes=textless_indexes,
                )
                profile = retry_profile
            except DmlOcrExecutionError as retry_error:
                pdf_structure.discard_structure_engine(language)
                raise PdfOcrUnavailableError(
                    "DirectML GPU가 두 번 연속 재설정되어 OCR을 중단했습니다. "
                    "다른 GPU 작업을 종료하거나 그래픽 드라이버를 확인한 뒤 다시 시도해 주세요."
                ) from retry_error
            except Exception as retry_error:
                pdf_structure.discard_structure_engine(language)
                raise PdfOcrUnavailableError(
                    f"PP-StructureV3 문서 구조 분석 재시도 중 오류가 발생했습니다: {retry_error}"
                ) from retry_error
        except Exception as error:
            if "data format error" in str(error).lower():
                retry_temp, retry_count = _normalize_pdf_for_pdfium(source_snapshot)
                if retry_count != total:
                    try:
                        os.remove(retry_temp)
                    except OSError:
                        pass
                    raise RuntimeError("PDF 정규화 후 페이지 수가 일치하지 않습니다.") from error
                old_render_temp = render_temp
                render_temp = retry_temp
                render_source = retry_temp
                cleanup_paths.append(retry_temp)
                if old_render_temp:
                    try:
                        os.remove(old_render_temp)
                    except OSError:
                        pass
                if emit:
                    emit({"type": "retry", "reason": "pdfium-format", "page": 0, "total": total})
                try:
                    pages, image_sizes, analyses = _analyze_pdf_pages_structure(
                        render_source, total, profile, language, model_variant, emit, cancel_event,
                        page_indexes=textless_indexes,
                    )
                except Exception as retry_error:
                    pdf_structure.discard_structure_engine(language)
                    raise PdfOcrUnavailableError(
                        f"PDFium 정규화 후 PP-StructureV3 분석에 실패했습니다: {retry_error}"
                    ) from retry_error
            else:
                pdf_structure.discard_structure_engine(language)
                raise PdfOcrUnavailableError(
                    f"PP-StructureV3 문서 구조 분석에 실패했습니다: {error}"
                ) from error

        # Full-document OCR can leave large DirectML allocations resident.
        # Release them before the CPU-heavy PDF merge and indexing stages,
        # unless a batch/folder run is holding the engines for reuse.
        if not _engines_on_hold():
            _discard_engine(language, model_variant)
            pdf_structure.discard_structure_engine(language)
        engine_released = True
        _raise_if_ocr_cancelled(cancel_event)
        if native_pages is not None:
            for page_number in native_page_texts:
                index = page_number - 1
                pages[index] = native_pages[index]
                image_sizes[index] = native_sizes[index]
                # Some analyzer paths fill unprocessed slots with empty dicts.
                # Only real OCR pages belong to the embedded OCR provenance.
                analyses[index] = None
        from pdf.pdf_grammar_refinement import refine_ocr_pages
        refine_ocr_pages(pages, analyses, page_indexes=textless_indexes, emit=emit,
                         cancel_check=lambda: _raise_if_ocr_cancelled(cancel_event))
        analysis_header = None
        analysis_payload = None
        valid_analyses = [a for a in (analyses or []) if a is not None]
        if valid_analyses:
            analysis_header, analysis_payload = _structure_analysis_payload(
                normalized, analyses, language, model_variant, profile
            )
        parsed_outline = _outline_for_pages(pages, image_sizes, analyses)
        source_reader = PdfReader(source_snapshot)
        try:
            source_metadata = source_reader.metadata or {}
            outline = _choose_pdf_outline(
                _native_outline_for_reader(source_reader),
                parsed_outline,
                is_ails_ocr=bool(source_metadata.get(OCR_METADATA_KEY)),
                source_hint=str(
                    source_metadata.get(OCR_OUTLINE_SOURCE_KEY, "") or ""
                ).strip().lower(),
            )
        finally:
            source_stream = getattr(source_reader, "stream", None)
            if source_stream is not None and hasattr(source_stream, "close"):
                source_stream.close()
        if not repair_index_only:
            output_temp = _new_sibling_pdf_temp(normalized, "ocr-commit")
            cleanup_paths.append(output_temp)
            if emit:
                emit({
                    "type": "finalizing",
                    "stage": "writing-pdf",
                    "page": total,
                    "total": total,
                })
            scope_options = {} if textless_indexes is None else {"page_indexes": textless_indexes}
            _write_embedded_text_pdf(
                source_snapshot, output_temp, pages, image_sizes, language, outline,
                model_variant, analysis_header, analysis_payload,
                **scope_options,
            )
            _raise_if_ocr_cancelled(cancel_event)
            _assert_source_unchanged(normalized, source_identity)
            from pdf.pdf_ocr_index_recovery import prepare as prepare_index_commit
            index_commit = prepare_index_commit(normalized, output_temp, source_identity.digest, pages, language,
                                                outline, image_sizes, analyses, native_page_texts)
            _assert_source_unchanged(normalized, source_identity)
            _raise_if_ocr_cancelled(cancel_event)
            os.replace(output_temp, normalized)

        warnings = []
        if emit:
            emit({
                "type": "finalizing",
                "stage": "indexing",
                "page": total,
                "total": total,
            })
        try:
            _store_index(
                normalized,
                pages,
                language,
                outline,
                page_sizes=image_sizes,
                analyses=analyses,
                native_page_texts=native_page_texts,
                **({"commit_guard": index_commit.guard, "commit_receipt": index_commit.receipt} if index_commit is not None else {}),
            )
            if index_commit is not None:
                index_commit.finish()
        except Exception as index_error:
            warnings.append(f"검색 색인은 다음에 PDF를 열 때 다시 생성됩니다: {index_error}")

        engine_label = "AILS PP-StructureV3 / PP-OCRv5 ONNX"
        result = {
            "path": normalized,
            "page_count": len(pages),
            "language": language,
            "engine": engine_label,
            "model_variant": model_variant,
            "detection_model": detection_model,
            "recognition_model": recognition_model,
            "outline": outline,
            "performance": {
                "batch_pages": _ocr_batch_pages(profile, model_variant),
                "detector_batch": profile.detector_batch,
                "recognition_batch": profile.recognition_batch,
                "render_workers": profile.render_workers,
                "gpu_provider": profile.gpu_provider,
                "logical_cpus": profile.logical_cpus,
                "total_memory_gb": profile.total_memory_gb,
                "available_memory_gb": profile.available_memory_gb,
            },
        }
        if analysis_header is not None:
            result["pipeline"] = pdf_structure.ANALYSIS_PIPELINE
            result["analysis"] = {
                "schema_version": analysis_header.get("schema_version"),
                "config_hash": analysis_header.get("config_hash"),
                "created_at": analysis_header.get("created_at"),
                "models": analysis_header.get("models"),
            }
        if warnings:
            result["warnings"] = warnings
        if emit:
            emit({"type": "done", "result": result})
        return result
    finally:
        if not engine_released and not _engines_on_hold():
            _discard_engine(language, model_variant)
            pdf_structure.discard_structure_engine(language)
        for temp_path in reversed(cleanup_paths):
            try:
                os.remove(temp_path)
            except OSError:
                pass



# ---------------------------------------------------------------------------
# Re-exported search and SQLite index symbols from pdf_ocr_search
# ---------------------------------------------------------------------------
from pdf.pdf_ocr_search import (
    _database_path,
    _connect,
    _fingerprint,
    _reader_has_text_layer,
    pdf_has_text_layer,
    pdf_pages_missing_text_layer,
    _upgrade_word_index_from_rows,
    _analysis_config_hashes,
    pdf_ocr_status,
    is_path_ocr_excluded,
    inspect_pdf_ocr_folder,
    _rebuild_index_from_embedded,
    _page_text,
    _reconstruct_indexed_region_text,
    _native_outline_for_reader,
    _toc_chapter_number,
    _toc_chapter_title,
    _toc_entry_for_line,
    _toc_entries_for_words,
    _outline_for_pages,
    _parsed_outline_from_index,
    _outline_state_path,
    _versioned_outline,
    _refresh_outline_from_index,
    _store_index,
    search_pdf,
    indexed_pdf_pages,
    indexed_pdf_page,
    indexed_pdf_search_pages,
    region_text,
)

from pdf.pdf_analysis_roles import (
    OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION,
    _RotatedTextRun,
    _analysis_page_size,
    _analysis_quantile,
    _detached_rotated_text_runs,
    _pages_for_structural_analysis,
    _repeated_rotated_decoration_word_indexes,
    mark_indexed_pdf_analysis_roles,
)

from pdf.pdf_text_layer import (
    _font_path,
    _pdf_has_signature,
    _new_sibling_pdf_temp,
    _validate_pdf_output,
    _inverse_ctm,
    _apply_ctm,
    _normalized_page_geometry_with_transform,
    _normalized_page_geometry,
    _remove_hidden_text_layer,
    _write_embedded_text_pdf,
    _embed_text_layer,
)
from pdf.pdf_ocr_benchmark import (
    detect_ocr_performance_profile,
    select_ocr_model_variant,
    resolve_ocr_model_variant,
    _performance_profile_store_path,
    ensure_ocr_benchmark_document,
    _runtime_package_version,
    _ocr_benchmark_pipeline_payload,
    _profile_store_base_key,
    _profile_store_key,
    _profile_payload,
    _read_raw_performance_profile_store,
    _read_performance_profile_store,
    _has_ocr_performance_overrides,
    _saved_profile_matches_hardware,
    _profile_from_performance_record,
    _load_calibrated_ocr_performance_profile,
    _write_performance_profile_store,
    _save_calibrated_ocr_performance_profile,
    _model_selection_store_key,
    _benchmarked_ocr_model_record,
    _save_benchmarked_ocr_model_variant,
    _performance_record_identity,
    _performance_measurement_payload,
    _find_previous_performance_record,
    ocr_performance_profile_status,
    _safe_dml_profile,
    _calibration_profile,
    _benchmark_page_indexes,
    _ocr_benchmark_words_digest,
    _ocr_benchmark_number_signature,
    _recognize_benchmark_pages_once,
    _run_ocr_benchmark,
    _ocr_benchmark_worker,
    _benchmark_ocr_profile_spawned,
    _benchmark_ocr_profile,
    _ocr_benchmark_candidates,
    benchmark_ocr_performance_profile,
    _select_benchmarked_ocr_model,
    benchmark_ocr_models_and_profiles,
    measure_optimal_ocr_performance_profile,
)

from pdf.pdf_ocr_structure import (
    structure_analysis_enabled,
    _analyze_pdf_pages_structure,
    _supplement_toc_outline_words,
    _analyze_pdf_pages_structure_inline,
    _structure_predict_page,
    _finalize_structure_words,
    _upgrade_structure_table_pages,
    _structure_analysis_payload,
)

from pdf.pdf_ocr_postprocess import (
    _OCR_CONFUSABLE_WORDS,
    _OCR_CONFUSABLE_TOKEN_PATTERN,
    _OCR_OBJECTIVE_COLUMN_CUE_PATTERN,
    _result_payload,
    _ocr_word_area,
    _ocr_word_intersection,
    _ocr_words_are_duplicates,
    _deduplicate_ocr_words,
    _ocr_confusable_candidates,
    _correct_ocr_confusable_text,
    _correct_ocr_page_words,
    _words_from_result,
)
