"""Shared OCR types, exceptions, and constants.

Extracted from pdf_ocr.py to break circular import dependencies across
pdf_ocr submodules.
"""

from __future__ import annotations

import ctypes
from dataclasses import dataclass
from typing import Sequence


OCR_METADATA_KEY = "/AILSFullOCR"
OCR_LANGUAGE_KEY = "/AILSOCRLanguage"
OCR_ENGINE_KEY = "/AILSOCREngine"
OCR_MODEL_KEY = "/AILSOCRModel"
OCR_DETECTION_MODEL_KEY = "/AILSOCRDetectionModel"
OCR_RECOGNITION_MODEL_KEY = "/AILSOCRRecognitionModel"
OCR_PRESET_VERSION_KEY = "/AILSOCRPresetVersion"
OCR_OUTLINE_SOURCE_KEY = "/AILSOutlineSource"
OCR_VERSION = "ails-ppstructurev3-ppocrv5-onnx-v2"
OCR_PRESET_VERSION = 2
OCR_WORD_INDEX_VERSION = 4
OUTLINE_INDEX_VERSION = 11
BOOKMARK_VERSION = 4
OCR_PERFORMANCE_PROFILE_VERSION = 2
OCR_BENCHMARK_ALGORITHM_VERSION = 4
OCR_MODEL_SELECTION_POLICY_VERSION = 2
OCR_MODEL_BENCHMARK_VERSION = 1
OCR_BENCHMARK_DOCUMENT_VERSION = 1
DEFAULT_LANGUAGE = "korean"
DEFAULT_OCR_MODEL_VARIANT = "small"
AUTO_OCR_MODEL_VARIANT = "auto"
OCR_MODEL_VARIANTS = {"tiny", "small", "medium"}
OCR_MODEL_VARIANT_ORDER = ("tiny", "small", "medium")
OCR_MANAGED_MODEL_IDS = {
    "tiny": "paddleocr-v6-tiny-korean-onnx",
    "small": "paddleocr-v6-small-korean-onnx",
    "medium": "paddleocr-v6-medium-korean-onnx",
}

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

OCR_PROVIDER_PRIORITY = (
    "CUDAExecutionProvider",
    "OpenVINOExecutionProvider",
    "DmlExecutionProvider",
)


class PdfOcrUnavailableError(RuntimeError):
    pass


class DmlOcrExecutionError(PdfOcrUnavailableError):
    pass


class PdfOcrCancelledError(PdfOcrUnavailableError):
    pass


@dataclass
class OcrWord:
    text: str
    left: float
    top: float
    right: float
    bottom: float
    confidence: float = 0.0


@dataclass(frozen=True)
class OcrPerformanceProfile:
    logical_cpus: int
    total_memory_gb: float
    available_memory_gb: float
    gpu_provider: str | None
    batch_pages: int
    detector_batch: int
    recognition_batch: int
    render_workers: int
    prefetch_pages: int


@dataclass(frozen=True)
class PdfSourceIdentity:
    size: int
    mtime_ns: int
    digest: str


class MemoryStatus(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_ulong),
        ("memory_load", ctypes.c_ulong),
        ("total_phys", ctypes.c_ulonglong),
        ("avail_phys", ctypes.c_ulonglong),
        ("total_page_file", ctypes.c_ulonglong),
        ("avail_page_file", ctypes.c_ulonglong),
        ("total_virtual", ctypes.c_ulonglong),
        ("avail_virtual", ctypes.c_ulonglong),
        ("avail_extended_virtual", ctypes.c_ulonglong),
    ]


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


def _model_limited_ocr_performance_profile(
    profile: OcrPerformanceProfile,
    model_variant: str,
) -> OcrPerformanceProfile:
    normalized = _normalize_ocr_model_variant(model_variant)
    batch_pages = _ocr_batch_pages(profile, normalized)
    detector_batch = (
        1
        if OCR_MODEL_PRESETS[normalized]["isolate_pages"]
        else max(1, min(profile.detector_batch, batch_pages))
    )
    return OcrPerformanceProfile(
        logical_cpus=profile.logical_cpus,
        total_memory_gb=profile.total_memory_gb,
        available_memory_gb=profile.available_memory_gb,
        gpu_provider=profile.gpu_provider,
        batch_pages=batch_pages,
        detector_batch=detector_batch,
        recognition_batch=max(1, min(128, profile.recognition_batch)),
        render_workers=1,
        prefetch_pages=batch_pages * 2,
    )
