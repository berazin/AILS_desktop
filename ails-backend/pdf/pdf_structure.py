"""PP-StructureV3 document analysis bridged into the AILS document model.

The analysis pipeline mirrors PaddleOCR's official PP-StructureV3 support:

* PP-DocLayoutV2 for layout detection, block classification and reading order
* PP-OCRv5 (server detector + per-language recognizer) for text
* table recognition and formula recognition only for detected table/formula
  blocks (PP-StructureV3 runs those modules region-conditionally)
* chart parsing, seal recognition, document unwarping and orientation
  classification stay disabled

No Markdown/JSON artifacts are produced: the raw pipeline result object is
converted here into the AILS page/block document model, and persistence is
owned by ``pdf_ocr`` (SQLite index + PDF embedded analysis payload written by
``pdf_analysis_metadata``).
"""

from __future__ import annotations

import copy
import importlib.metadata
import json
import logging
import math
import os
import re
import threading
from typing import Any, Callable

import pdf.paddlex_engine_compat as _paddlex_compat

_logger = logging.getLogger(__name__)


ANALYSIS_PIPELINE = "PP-StructureV3"
ANALYSIS_OCR_VERSION = "PP-OCRv5"
ANALYSIS_LAYOUT_MODEL = "PP-DocLayoutV2"
ANALYSIS_REGION_MODEL = "PP-DocBlockLayout"
ANALYSIS_DETECTION_MODEL = "PP-OCRv5_server_det"
# The PP-OCRv5 detector misses sparse body paragraphs on full-size book pages.
# A bounded whole-page input detects those lines while retaining small TOC rows.
ANALYSIS_TEXT_DET_LIMIT_SIDE_LEN = 1024
ANALYSIS_TEXT_DET_LIMIT_TYPE = "max"
# The official PaddleOCR model selection rule for lang=korean + PP-OCRv5
# resolves to (PP-OCRv5_server_det, korean_PP-OCRv5_mobile_rec); the
# recognizer is pinned per language in language_support, matching that rule.
ANALYSIS_RECOGNIZER_RULE = "paddleocr-official:lang+PP-OCRv5"
ANALYSIS_TABLE_MODELS = {
    "classification": "PP-LCNet_x1_0_table_cls",
    "wired_structure": "SLANeXt_wired",
    "wireless_structure": "SLANet_plus",
    "wired_cells": "RT-DETR-L_wired_table_cell_det",
    "wireless_cells": "RT-DETR-L_wireless_table_cell_det",
}
# The table sub-pipeline embeds its own OCR models for cell text.
ANALYSIS_TABLE_OCR_DETECTION_MODEL = "PP-OCRv5_server_det"
ANALYSIS_TABLE_OCR_RECOGNITION_MODEL = "PP-OCRv5_server_rec"
ANALYSIS_FORMULA_MODEL = "PP-FormulaNet_plus-L"
ANALYSIS_MANAGED_MODEL_ID = "ppstructure-v3-korean-onnx"
# No public ONNX package exists for the formula models yet (HuggingFace gates
# them and paddlex' ONNX_SUPPORTED_MODELS excludes them), so formula
# recognition stays requested-on but disabled until a manifest ships.
ANALYSIS_FORMULA_MANAGED_MODEL_ID = "ppstructure-v3-formula-onnx"

MANAGED_MODEL_SUBDIRS = (
    "layout",
    "region",
    "detector",
    "recognizer",
    "table_classifier",
    "wired_table_structure",
    "wireless_table_structure",
    "wired_table_cells",
    "wireless_table_cells",
)
_OPTIONAL_MODEL_SUBDIRS = ("formula",)

# Layout labels whose reading order is meaningless for document flow.
_ORDER_SKIP_LABELS = {"header", "footer", "header_image", "footer_image", "background"}


class StructureAnalysisUnavailableError(RuntimeError):
    """Raised when the PP-StructureV3 pipeline cannot run on this machine."""


def paddle_language(language: str) -> str:
    normalized = (language or "korean").strip().lower()
    return {
        "ko": "korean",
        "en": "en",
        "ja": "japan",
        "zh": "ch",
    }.get(normalized, normalized)


def _runtime_package_version(*distribution_names: str) -> str:
    for name in distribution_names:
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            continue
    return ""


def runtime_versions() -> dict:
    return {
        "paddleocr": _runtime_package_version("paddleocr"),
        "paddlex": _runtime_package_version("paddlex"),
        "onnxruntime": _runtime_package_version(
            "onnxruntime-windowsml",
            "onnxruntime-directml",
            "onnxruntime-openvino",
            "onnxruntime-gpu",
            "onnxruntime",
        ),
    }


def _presets():
    # Imported lazily to keep pdf_structure importable without pdf_ocr in
    # lightweight tooling; pdf_ocr owns the calibrated OCR presets.
    import pdf.pdf_ocr as pdf_ocr
    return pdf_ocr.OCR_MODEL_PRESETS


def _normalize_variant(model_variant: str | None) -> str:
    import pdf.pdf_ocr as pdf_ocr
    return pdf_ocr._normalize_ocr_model_variant(model_variant)


def _formula_model_dir(language: str) -> str:
    import pdf.pdf_ocr as pdf_ocr
    try:
        if language == "korean":
            from model_manager import get_model_manager

            candidate = get_model_manager().resolve(ANALYSIS_FORMULA_MANAGED_MODEL_ID) / "formula"
            return str(candidate) if (candidate / "inference.onnx").is_file() else ""
        return pdf_ocr._cached_onnx_model_dir(ANALYSIS_FORMULA_MODEL) or ""
    except Exception:
        return ""


def structure_modules_config(language: str, model_variant: str | None = None) -> dict:
    """Canonical analysis configuration used for the config hash."""
    import pdf.pdf_ocr as pdf_ocr
    language = (language or pdf_ocr.DEFAULT_LANGUAGE).strip().lower()
    variant = _normalize_variant(model_variant)
    preset = _presets()[variant]
    versions = runtime_versions()
    formula_available = bool(_formula_model_dir(language))
    return {
        "schema_version": 1,
        "pipeline": ANALYSIS_PIPELINE,
        "paddleocr_version": versions["paddleocr"],
        "paddlex_version": versions["paddlex"],
        "onnxruntime_version": versions["onnxruntime"],
        "layout": {"model": ANALYSIS_LAYOUT_MODEL},
        "region_detection": {"model": ANALYSIS_REGION_MODEL, "enabled": True},
        "ocr": {
            "version": ANALYSIS_OCR_VERSION,
            "detector": ANALYSIS_DETECTION_MODEL,
            "recognizer": pdf_ocr.paddle_recognition_model(language),
            "recognizer_rule": ANALYSIS_RECOGNIZER_RULE,
            "render_scale": preset["render_scale"],
            "text_det_limit_side_len": ANALYSIS_TEXT_DET_LIMIT_SIDE_LEN,
            "text_det_limit_type": ANALYSIS_TEXT_DET_LIMIT_TYPE,
            "text_det_thresh": preset["text_det_thresh"],
            "text_det_box_thresh": preset["text_det_box_thresh"],
            "text_det_unclip_ratio": preset["text_det_unclip_ratio"],
            "text_det_max_side_limit": preset["text_det_max_side_limit"],
            "text_rec_score_thresh": 0.0,
            "preset_version": pdf_ocr.OCR_PRESET_VERSION,
        },
        "table": {
            "enabled": True,
            "models": dict(ANALYSIS_TABLE_MODELS),
            "ocr_detector": ANALYSIS_TABLE_OCR_DETECTION_MODEL,
            "ocr_recognizer": ANALYSIS_TABLE_OCR_RECOGNITION_MODEL,
        },
        "formula": {
            "enabled": formula_available,
            "model": ANALYSIS_FORMULA_MODEL,
            "manifest_model_id": ANALYSIS_FORMULA_MANAGED_MODEL_ID,
        },
        "disabled_modules": {
            "chart_recognition": True,
            "seal_recognition": True,
            "doc_orientation_classify": True,
            "doc_unwarping": True,
            "textline_orientation": True,
        },
    }


# ---------------------------------------------------------------------------
# Model resolution
# ---------------------------------------------------------------------------


def resolve_structure_model_dirs(language: str) -> dict[str, str]:
    """Resolve every structure model directory, or raise with a clear reason.

    Korean models come from the managed ModelManager manifest; other
    languages fall back to the PaddleX official-model cache exactly like the
    legacy OCR path. The optional formula model resolves to None when no
    manifest is installed instead of failing the whole pipeline.
    """
    import pdf.pdf_ocr as pdf_ocr
    from model_manager import ModelUnavailableError, get_model_manager

    language = (language or pdf_ocr.DEFAULT_LANGUAGE).strip().lower()
    dirs: dict[str, str] = {}
    if language == "korean":
        try:
            root = get_model_manager().resolve(ANALYSIS_MANAGED_MODEL_ID)
        except ModelUnavailableError as error:
            raise StructureAnalysisUnavailableError(str(error)) from error
        for subdir in MANAGED_MODEL_SUBDIRS:
            candidate = root / subdir
            if not (candidate / "inference.onnx").is_file():
                raise StructureAnalysisUnavailableError(
                    f"PP-StructureV3 모델 파일이 완전하지 않습니다 ({subdir}). 모델을 다시 내려받아 주세요."
                )
            dirs[subdir] = str(candidate)
    else:
        mapping = {
            "layout": ANALYSIS_LAYOUT_MODEL,
            "region": ANALYSIS_REGION_MODEL,
            "detector": ANALYSIS_DETECTION_MODEL,
            "recognizer": pdf_ocr.paddle_recognition_model(language),
            "table_classifier": ANALYSIS_TABLE_MODELS["classification"],
            "wired_table_structure": ANALYSIS_TABLE_MODELS["wired_structure"],
            "wireless_table_structure": ANALYSIS_TABLE_MODELS["wireless_structure"],
            "wired_table_cells": ANALYSIS_TABLE_MODELS["wired_cells"],
            "wireless_table_cells": ANALYSIS_TABLE_MODELS["wireless_cells"],
        }
        for subdir, model_name in mapping.items():
            cached = pdf_ocr._cached_onnx_model_dir(model_name)
            if not cached:
                raise StructureAnalysisUnavailableError(
                    f"PP-StructureV3 모델을 찾을 수 없습니다 ({model_name})."
                )
            dirs[subdir] = cached

    dirs["formula"] = _formula_model_dir(language)
    return dirs


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


def structure_engine_options(
    language: str,
    profile,
    model_dirs: dict[str, str],
    model_variant: str | None = None,
    tables: bool = True,
) -> dict:
    import pdf.pdf_ocr as pdf_ocr
    language = (language or pdf_ocr.DEFAULT_LANGUAGE).strip().lower()
    variant = _normalize_variant(model_variant or pdf_ocr.DEFAULT_OCR_MODEL_VARIANT)
    preset = _presets()[variant]
    formula_dir = model_dirs.get("formula") or ""
    options = {
        "layout_detection_model_name": ANALYSIS_LAYOUT_MODEL,
        "layout_detection_model_dir": model_dirs["layout"],
        "region_detection_model_name": ANALYSIS_REGION_MODEL,
        "region_detection_model_dir": model_dirs["region"],
        # Pinning the exact PP-OCRv5 model names is the official selection
        # rule for Korean (verified against paddleocr's PPStructureV3);
        # passing explicit names skips the lang/ocr_version resolution while
        # producing the identical detector/recognizer pair.
        "text_detection_model_name": ANALYSIS_DETECTION_MODEL,
        "text_detection_model_dir": model_dirs["detector"],
        "text_recognition_model_name": pdf_ocr.paddle_recognition_model(language),
        "text_recognition_model_dir": model_dirs["recognizer"],
        "table_classification_model_name": ANALYSIS_TABLE_MODELS["classification"],
        "table_classification_model_dir": model_dirs["table_classifier"],
        "wired_table_structure_recognition_model_name": ANALYSIS_TABLE_MODELS["wired_structure"],
        "wired_table_structure_recognition_model_dir": model_dirs["wired_table_structure"],
        "wireless_table_structure_recognition_model_name": ANALYSIS_TABLE_MODELS["wireless_structure"],
        "wireless_table_structure_recognition_model_dir": model_dirs["wireless_table_structure"],
        "wired_table_cells_detection_model_name": ANALYSIS_TABLE_MODELS["wired_cells"],
        "wired_table_cells_detection_model_dir": model_dirs["wired_table_cells"],
        "wireless_table_cells_detection_model_name": ANALYSIS_TABLE_MODELS["wireless_cells"],
        "wireless_table_cells_detection_model_dir": model_dirs["wireless_table_cells"],
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "use_seal_recognition": False,
        "use_chart_recognition": False,
        # Table models cost ~2/3 of the pipeline's creation time and most of
        # its memory; the light engine skips them and pages containing table
        # blocks are re-run through the full engine on demand.
        "use_table_recognition": bool(tables),
        "use_formula_recognition": bool(formula_dir),
        "use_region_detection": True,
        "text_det_limit_side_len": ANALYSIS_TEXT_DET_LIMIT_SIDE_LEN,
        "text_det_limit_type": ANALYSIS_TEXT_DET_LIMIT_TYPE,
        # Same calibrated DB post-processing values as the legacy path; the
        # tier render scale and these thresholds were tuned together.
        "text_det_thresh": preset["text_det_thresh"],
        "text_det_box_thresh": preset["text_det_box_thresh"],
        "text_det_unclip_ratio": preset["text_det_unclip_ratio"],
        "text_rec_score_thresh": 0.0,
        "engine": "onnxruntime",
        "engine_config": {"log_severity_level": 3},
        "device": _paddlex_compat.device_string_for_profile(profile),
    }
    if formula_dir:
        options["formula_recognition_model_name"] = ANALYSIS_FORMULA_MODEL
        options["formula_recognition_model_dir"] = formula_dir
    if profile is not None:
        # Same calibrated recognition batch as the legacy path; batch size
        # only changes throughput, never the recognized text, so it stays
        # out of the config hash.
        recognition_batch = getattr(profile, "recognition_batch", None)
        if recognition_batch:
            options["text_recognition_batch_size"] = max(1, int(recognition_batch))
    return options


_structure_engines: dict[tuple[str, str, bool], Any] = {}
_structure_engine_lock = threading.RLock()
_table_engines: dict[tuple[str, str], Any] = {}
_table_engine_lock = _structure_engine_lock

# Engine strategies:
#   "full"          — one engine with every module loaded; table recognition
#                     runs region-conditionally per page.
#   "light_upgrade" — start with the light engine (table models unloaded:
#                     ~2/3 of creation time, most of the memory), then re-run
#                     only pages whose layout contains table blocks through a
#                     full engine in a sequential swap.
STRATEGY_FULL = "full"
STRATEGY_LIGHT_UPGRADE = "light_upgrade"
# The full PP-StructureV3 stack is ~1GB of weights. Dedicated GPUs with this
# much device-local memory take the full engine directly; integrated /
# shared-memory GPUs (typical DirectML/OpenVINO setups) use the light engine
# because loading the table stack there produced repeated
# DXGI DEVICE_REMOVED (887A0005) resets during inference.
_MIN_DISCRETE_VRAM_BYTES = 6 * 1024 ** 3
_STRATEGY_OVERRIDE_ENV = "AILS_STRUCTURE_ENGINE_STRATEGY"


def engine_strategy(profile) -> str:
    """Pick the table-engine strategy from the machine's GPU class."""
    override = os.environ.get(_STRATEGY_OVERRIDE_ENV, "").strip().lower()
    if override in {STRATEGY_FULL, STRATEGY_LIGHT_UPGRADE}:
        return override
    provider = getattr(profile, "gpu_provider", None) if profile else None
    if provider == "CUDAExecutionProvider":
        return STRATEGY_FULL
    if provider in {"DmlExecutionProvider", "OpenVINOExecutionProvider"}:
        try:
            from hardware_capabilities import detect_vulkan_capabilities

            selected = detect_vulkan_capabilities().get("selected_device") or {}
            if (
                selected.get("device_type") == 2
                and int(selected.get("device_memory_bytes") or 0) >= _MIN_DISCRETE_VRAM_BYTES
            ):
                return STRATEGY_FULL
        except Exception:
            pass
        return STRATEGY_LIGHT_UPGRADE
    # CPU has no device-local memory limit; creation cost is the only trade.
    return STRATEGY_FULL


def _base_paddlex_config():
    """Default PP-StructureV3 YAML with AILS-disabled modules stripped out.

    The wrapper only forwards model names/dirs into the pipeline config; the
    ``use_textline_orientation`` flag of the embedded OCR sub-pipelines stays
    True in the shipped YAML and would eagerly download and load the
    textline orientation model even though AILS never uses it.
    """
    from paddlex.inference import load_pipeline_config

    config = load_pipeline_config(ANALYSIS_PIPELINE)
    general_ocr = config.setdefault("SubPipelines", {}).setdefault("GeneralOCR", {})
    general_ocr["use_textline_orientation"] = False
    table = config.setdefault("SubPipelines", {}).setdefault("TableRecognition", {})
    table.setdefault("SubPipelines", {}).setdefault("GeneralOCR", {})[
        "use_textline_orientation"
    ] = False
    return config


def create_structure_engine(language: str, profile=None, model_variant: str | None = None, tables: bool = True):
    """Instantiate and cache the PPStructureV3 pipeline for a language."""
    if os.name != "nt":
        raise StructureAnalysisUnavailableError("PP-StructureV3 분석은 Windows에서만 사용할 수 있습니다.")
    discard_table_engine(language)
    model_dirs = resolve_structure_model_dirs(language)
    # Must precede any paddlex import: paddlex reads this flag at module
    # import time to skip its connectivity probe.
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    ort = _paddlex_compat.load_paddlex_runtime()
    from paddleocr import PPStructureV3

    profile = profile or _default_profile()
    _paddlex_compat.install_onnxruntime_engine_patches(ort, profile)
    _paddlex_compat.configure_paddlex_logging()
    options = structure_engine_options(language, profile, model_dirs, model_variant, tables)
    options["paddlex_config"] = _base_paddlex_config()
    try:
        engine = PPStructureV3(**options)
    except UnicodeDecodeError as error:
        raise StructureAnalysisUnavailableError(
            "PP-StructureV3 모델 파일의 문자 인코딩을 읽지 못했습니다. 로컬 ONNX 모델 캐시를 확인해 주세요."
        ) from error
    _logger.info(
        "PP-StructureV3 engine created: lang=%s layout=%s det=%s rec=%s provider=%s pid=%d",
        language,
        ANALYSIS_LAYOUT_MODEL,
        ANALYSIS_DETECTION_MODEL,
        options["text_recognition_model_name"],
        getattr(profile, "gpu_provider", None) or "CPU",
        os.getpid(),
    )
    return engine


def _default_profile():
    import pdf.pdf_ocr as pdf_ocr
    return pdf_ocr.detect_ocr_performance_profile()


def structure_engine(language: str, profile=None, model_variant: str | None = None, tables: bool = True):
    import pdf.pdf_ocr as pdf_ocr
    language = (language or pdf_ocr.DEFAULT_LANGUAGE).strip().lower()
    variant = _normalize_variant(model_variant or pdf_ocr.DEFAULT_OCR_MODEL_VARIANT)
    key = (language, variant, bool(tables))
    with _structure_engine_lock:
        engine = _structure_engines.get(key)
        if engine is None:
            engine = create_structure_engine(language, profile, variant, tables)
            _structure_engines[key] = engine
        return engine


def discard_structure_engine(language: str | None = None, tables: bool | None = None):
    """Drop cached engines; with ``tables`` set, only that flavor is dropped.

    Keeping two PP-StructureV3 engines resident at once exhausts DirectML
    memory on shared-memory GPUs (DXGI DEVICE_REMOVED), so callers swap the
    light and full engine sequentially via ``tables``.
    """
    import gc

    with _structure_engine_lock:
        if language is None:
            keys = list(_structure_engines)
        else:
            # Drop every variant of the language (legacy callers pass the
            # language only).
            keys = [key for key in _structure_engines if key[0] == language]
        if tables is not None:
            keys = [key for key in keys if key[2] == bool(tables)]
        for key in keys:
            engine = _structure_engines.pop(key, None)
            if engine is None:
                continue
            try:
                engine.close()
            except (AttributeError, RuntimeError):
                pass
            _paddlex_compat.release_paddlex_onnx_sessions(engine)
            del engine
    gc.collect()


def _pin_table_cell_ocr_models(
    config: dict, language: str, model_dirs: dict[str, str]
) -> None:
    """Pin the table sub-pipeline's embedded OCR models to managed files.

    PaddleOCR applies the managed detector/recognizer to
    ``SubPipelines.TableRecognition.SubPipelines.GeneralOCR`` whenever an
    engine is created through ``PPStructureV3``. The standalone table engine is
    created straight from this config, so it must pin the same pair itself;
    otherwise restoring that sub-pipeline would fall back to the model source.
    """
    import pdf.pdf_ocr as pdf_ocr
    general_ocr = config.setdefault("SubPipelines", {}).setdefault("GeneralOCR", {})
    modules = general_ocr.setdefault("SubModules", {})
    detection = modules.setdefault("TextDetection", {})
    detection["model_name"] = ANALYSIS_DETECTION_MODEL
    detection["model_dir"] = model_dirs["detector"]
    recognition = modules.setdefault("TextRecognition", {})
    recognition["model_name"] = pdf_ocr.paddle_recognition_model(language)
    recognition["model_dir"] = model_dirs["recognizer"]


def table_engine_config(model_dirs: dict[str, str], *, language: str) -> dict:
    """Return the standalone table pipeline with every managed model pinned."""
    config = copy.deepcopy(
        _base_paddlex_config()["SubPipelines"]["TableRecognition"]
    )
    config["use_doc_preprocessor"] = False
    config["use_layout_detection"] = False
    config["use_ocr_model"] = False
    mapping = {
        "TableClassification": "table_classifier",
        "WiredTableStructureRecognition": "wired_table_structure",
        "WirelessTableStructureRecognition": "wireless_table_structure",
        "WiredTableCellsDetection": "wired_table_cells",
        "WirelessTableCellsDetection": "wireless_table_cells",
    }
    modules = config.setdefault("SubModules", {})
    for module_name, directory_name in mapping.items():
        modules[module_name]["model_dir"] = model_dirs[directory_name]
    _pin_table_cell_ocr_models(config, language, model_dirs)
    return config


def restore_table_cell_ocr_pipeline(engine) -> bool:
    """Restore the OCR sub-pipeline PaddleX defers for table cell splitting.

    The shipped PP-StructureV3.yaml and ``table_engine_config`` both disable
    ``use_ocr_model``, so ``TableRecognitionPipelineV2`` keeps the embedded OCR
    config in ``general_ocr_config_bak`` instead of creating the sub-pipeline.
    Its cell-split pass (``use_ocr_results_with_table_cells``) nevertheless
    recognizes boxes that span several cells with
    ``general_ocr_pipeline.text_rec_model``, and the library's own lazy
    creation only runs for ``cells_split_ocr == False`` — a state its
    ``predict`` never leaves set. Without this restore a table page whose OCR
    box covers more than one cell fails with ``'NoneType' object has no
    attribute 'text_rec_model'``.

    Returns True when the sub-pipeline was created.
    """
    if bool(getattr(engine, "_multi_device_inference", False)):
        pipelines = list(getattr(engine, "_pipelines", ()) or ())
    else:
        internal = getattr(engine, "_pipeline", None)
        pipelines = [internal if internal is not None else engine]

    restored = False
    for pipeline in pipelines:
        if getattr(pipeline, "general_ocr_pipeline", None) is not None:
            continue
        general_ocr_config = getattr(pipeline, "general_ocr_config_bak", None)
        if not general_ocr_config:
            continue
        pipeline.general_ocr_pipeline = pipeline.create_pipeline(general_ocr_config)
        restored = True
    return restored


def create_table_engine(
    language: str,
    profile=None,
    model_variant: str | None = None,
):
    """Create the standalone table pipeline plus its cells-split OCR pair.

    ``table_engine_config`` pins the five table model directories and
    ``restore_table_cell_ocr_pipeline`` adds the embedded OCR sub-pipeline the
    cells-split pass needs.
    """
    if os.name != "nt":
        raise StructureAnalysisUnavailableError(
            "PP-StructureV3 표 분석은 Windows에서만 사용할 수 있습니다."
        )
    discard_structure_engine(language)
    model_dirs = resolve_structure_model_dirs(language)
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    ort = _paddlex_compat.load_paddlex_runtime()
    from paddlex.inference.pipelines import create_pipeline

    profile = profile or _default_profile()
    _paddlex_compat.install_onnxruntime_engine_patches(ort, profile)
    _paddlex_compat.configure_paddlex_logging()
    engine = create_pipeline(
        config=table_engine_config(model_dirs, language=language),
        device=_paddlex_compat.device_string_for_profile(profile),
        engine="onnxruntime",
        engine_config={"log_severity_level": 3},
    )
    restore_table_cell_ocr_pipeline(engine)
    _logger.info(
        "PP-StructureV3 table-only engine created: lang=%s variant=%s "
        "provider=%s pid=%d",
        language,
        _normalize_variant(model_variant),
        getattr(profile, "gpu_provider", None) or "CPU",
        os.getpid(),
    )
    return engine


def table_engine(
    language: str,
    profile=None,
    model_variant: str | None = None,
):
    import pdf.pdf_ocr as pdf_ocr
    language = (language or pdf_ocr.DEFAULT_LANGUAGE).strip().lower()
    variant = _normalize_variant(
        model_variant or pdf_ocr.DEFAULT_OCR_MODEL_VARIANT
    )
    key = (language, variant)
    with _table_engine_lock:
        engine = _table_engines.get(key)
        if engine is None:
            engine = create_table_engine(language, profile, variant)
            _table_engines[key] = engine
        return engine


def discard_table_engine(language: str | None = None) -> None:
    import gc

    with _table_engine_lock:
        keys = (
            list(_table_engines)
            if language is None
            else [key for key in _table_engines if key[0] == language]
        )
        for key in keys:
            engine = _table_engines.pop(key, None)
            if engine is None:
                continue
            try:
                engine.close()
            except (AttributeError, RuntimeError):
                pass
            _paddlex_compat.release_paddlex_onnx_sessions(engine)
            del engine
    gc.collect()


def actual_model_names(language: str) -> dict:
    """Names of the models the pipeline actually pinned for this language."""
    import pdf.pdf_ocr as pdf_ocr
    return {
        "pipeline": ANALYSIS_PIPELINE,
        "layout": ANALYSIS_LAYOUT_MODEL,
        "region_detection": ANALYSIS_REGION_MODEL,
        "ocr_version": ANALYSIS_OCR_VERSION,
        "detector": ANALYSIS_DETECTION_MODEL,
        "recognizer": pdf_ocr.paddle_recognition_model(language),
        "table": dict(ANALYSIS_TABLE_MODELS),
        "table_ocr_detector": ANALYSIS_TABLE_OCR_DETECTION_MODEL,
        "table_ocr_recognizer": ANALYSIS_TABLE_OCR_RECOGNITION_MODEL,
        "formula": ANALYSIS_FORMULA_MODEL,
    }


# ---------------------------------------------------------------------------
# Result extraction
# ---------------------------------------------------------------------------


def _payload_mapping(result: Any) -> dict:
    """Return the per-image result dict from a paddlex/paddleocr result."""
    if result is None:
        return {}
    if isinstance(result, dict):
        inner = result.get("res")
        return inner if isinstance(inner, dict) else result
    getter = getattr(result, "get", None)
    if callable(getter):
        try:
            inner = getter("res", None)
        except Exception:
            inner = None
        if isinstance(inner, dict) and ("layout_det_res" in inner or "parsing_res_list" in inner):
            return inner
        if "layout_det_res" in result or "parsing_res_list" in result:
            return result
    return dict(getattr(result, "__dict__", {}) or {})


def page_result_payload(result: Any) -> dict:
    """Detach the serializable per-page mapping from a PaddleX result wrapper."""
    return dict(_payload_mapping(result))


def enrich_table_payload(engine, image_array, payload: dict) -> dict:
    """Run only table models using layout/OCR outputs from the light phase."""
    import numpy as np

    overall_ocr_res = copy.deepcopy(payload.get("overall_ocr_res") or {})
    overall_ocr_res.setdefault("dt_polys", [])
    overall_ocr_res.setdefault("rec_texts", [])
    overall_ocr_res.setdefault("rec_scores", [])
    overall_ocr_res.setdefault("rec_polys", [])
    rec_boxes = overall_ocr_res.get("rec_boxes")
    if rec_boxes is None:
        rec_boxes = np.empty((0, 4), dtype=np.float32)
        overall_ocr_res["rec_boxes"] = rec_boxes

    def append_content(box, text: str, score: float) -> None:
        x_min, y_min, x_max, y_max = list(map(int, box))
        polygon = [
            (x_min, y_min),
            (x_max, y_min),
            (x_max, y_max),
            (x_min, y_max),
        ]
        overall_ocr_res["dt_polys"].append(polygon)
        overall_ocr_res["rec_texts"].append(text)
        current_boxes = overall_ocr_res["rec_boxes"]
        new_box = np.asarray([[x_min, y_min, x_max, y_max]])
        if getattr(current_boxes, "size", 0) == 0:
            overall_ocr_res["rec_boxes"] = new_box
        else:
            overall_ocr_res["rec_boxes"] = np.vstack((current_boxes, new_box))
        overall_ocr_res["rec_polys"].append(polygon)
        overall_ocr_res["rec_scores"].append(score)

    for formula in payload.get("formula_res_list") or []:
        formula_text = str(formula.get("rec_formula") or "")
        if not formula_text.startswith("$") or not formula_text.endswith("$"):
            formula_text = f"${formula_text}$"
        append_content(formula["dt_polys"], formula_text, 1.0)

    for image in payload.get("imgs_in_doc") or []:
        image_path = str(image.get("path") or "")
        append_content(
            image["coordinate"],
            '<div style="text-align: center;">'
            f'<img src="{image_path}" alt="Image" /></div>',
            float(image.get("score") or 0.0),
        )

    prediction = engine.predict(
        image_array,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_layout_detection=False,
        use_ocr_model=False,
        overall_ocr_res=overall_ocr_res,
        layout_det_res=payload.get("layout_det_res"),
        cell_sort_by_y_projection=True,
        use_wired_table_cells_trans_to_html=False,
        use_wireless_table_cells_trans_to_html=False,
        use_table_orientation_classify=False,
        use_ocr_results_with_table_cells=True,
        use_e2e_wired_table_rec_model=False,
        use_e2e_wireless_table_rec_model=False,
    )
    result = next(iter(prediction), None)
    table_payload = _payload_mapping(result)
    enriched = dict(payload)
    enriched["table_res_list"] = list(table_payload.get("table_res_list") or [])
    return enriched


def _float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _bbox_list(value) -> list[float]:
    if value is None:
        return [0.0, 0.0, 0.0, 0.0]
    try:
        items = list(value)
    except TypeError:
        return [0.0, 0.0, 0.0, 0.0]
    if len(items) < 4:
        return [0.0, 0.0, 0.0, 0.0]
    return [_float(items[0]), _float(items[1]), _float(items[2]), _float(items[3])]


def _normalize_bbox(bbox: list[float], width: float, height: float) -> list[float]:
    if width <= 0 or height <= 0:
        return [0.0, 0.0, 0.0, 0.0]
    return [
        max(0.0, min(1.0, bbox[0] / width)),
        max(0.0, min(1.0, bbox[1] / height)),
        max(0.0, min(1.0, bbox[2] / width)),
        max(0.0, min(1.0, bbox[3] / height)),
    ]


def _layout_entries(layout_det_res: Any) -> list[dict]:
    boxes = []
    if isinstance(layout_det_res, dict):
        boxes = layout_det_res.get("boxes") or []
    elif layout_det_res is not None:
        boxes = getattr(layout_det_res, "boxes", None) or []
    entries = []
    for box in boxes:
        if isinstance(box, dict):
            coordinate = _bbox_list(box.get("coordinate"))
            label = str(box.get("label", "") or "").strip().lower()
            score = _float(box.get("score"), 0.0)
            order = box.get("order")
            order_value: int | None
            if order is None:
                order_value = None
            else:
                try:
                    order_value = int(order)
                except (TypeError, ValueError):
                    order_value = None
        else:
            values = list(box)
            if len(values) < 5:
                continue
            coordinate = _bbox_list(values[:4])
            score = _float(values[4], 0.0)
            label = ""
            order_value = None
            if len(values) > 5:
                try:
                    label = str(values[5]).strip().lower()
                except Exception:
                    label = ""
            if len(values) > 6 and values[6] is not None:
                try:
                    order_value = int(values[6])
                except (TypeError, ValueError):
                    order_value = None
        entries.append({
            "bbox": coordinate,
            "label": label,
            "confidence": score,
            "order": order_value,
        })
    return entries


def _ocr_entries(overall_ocr_res: Any) -> list[dict]:
    texts: list = []
    scores: list = []
    boxes: list = []
    if isinstance(overall_ocr_res, dict):
        texts = overall_ocr_res.get("rec_texts") or []
        scores = overall_ocr_res.get("rec_scores") or []
        # rec_boxes is a numpy array (possibly empty); prefer it over the
        # quad polys when it is populated. ``len()`` is checked without an
        # ``or []`` because truth-testing an ndarray raises.
        rec_boxes = overall_ocr_res.get("rec_boxes")
        rec_polys = overall_ocr_res.get("rec_polys")
        try:
            boxes = rec_boxes if (rec_boxes is not None and len(rec_boxes)) else rec_polys
        except TypeError:
            boxes = rec_polys
        if boxes is None:
            boxes = []
    entries = []
    for index, text in enumerate(texts):
        if index >= len(boxes):
            break
        normalized_text = str(text or "").strip()
        if not normalized_text:
            continue
        score = _float(scores[index], 0.0) if index < len(scores) else 0.0
        entries.append({
            "text": normalized_text,
            "bbox": _bbox_list(boxes[index]),
            "confidence": score,
        })
    return entries


def _point_in_bbox(x: float, y: float, bbox: list[float]) -> bool:
    return bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]


def _box_area(bbox: list[float]) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def _parsing_content_map(parsing_res_list: Any) -> dict[tuple[int, int, int, int], dict]:
    contents: dict[tuple[int, int, int, int], dict] = {}
    if not isinstance(parsing_res_list, list):
        return contents
    for block in parsing_res_list:
        if not isinstance(block, dict):
            continue
        bbox = _bbox_list(block.get("block_bbox"))
        key = tuple(int(round(value)) for value in bbox)
        contents[key] = {
            "text": str(block.get("block_content", "") or ""),
            "label": str(block.get("block_label", "") or "").strip().lower(),
        }
    return contents


def _table_json(value):
    if hasattr(value, "tolist"):
        value = value.tolist()
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (list, tuple)):
        return [_table_json(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _table_json(item) for key, item in value.items()}
    return None


def _table_normalized_boxes(boxes, width, height):
    def normalize(box):
        if not isinstance(box, list):
            return None
        if len(box) == 4 and all(isinstance(point, list) and len(point) == 2 for point in box):
            return [[scale(point[0], width), scale(point[1], height)] for point in box]
        if len(box) in (4, 8):
            return [scale(value, width if index % 2 == 0 else height) for index, value in enumerate(box)]
        return None

    def scale(value, extent):
        return value / extent if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    return [normalize(box) for box in boxes] if isinstance(boxes, list) else None


def _table_geometry(table_item, width, height):
    added = {}
    if "cell_box_list" in table_item:
        boxes = _table_json(table_item["cell_box_list"])
        added.update(cell_box_list=boxes, normalized_cell_box_list=_table_normalized_boxes(boxes, width, height))
    prediction = table_item.get("table_ocr_pred")
    if isinstance(prediction, dict):
        ocr = {key: _table_json(prediction[key]) for key in ("rec_boxes", "rec_texts", "rec_scores", "confidences")
               if key in prediction}
        if "rec_boxes" in ocr:
            ocr["normalized_rec_boxes"] = _table_normalized_boxes(ocr["rec_boxes"], width, height)
        if "confidences" not in ocr and "rec_scores" in ocr:
            ocr["confidences"] = _table_json(ocr["rec_scores"])
        added["table_ocr_pred"] = ocr
    if added:
        added.update(coordinate_space="image_pixels", image_width=width, image_height=height)
    return added


def extract_page_analysis(
    result: Any,
    image_width: int,
    image_height: int,
) -> dict:
    """Convert one PP-StructureV3 page result into the AILS document model."""
    payload = _payload_mapping(result)
    layout_entries = _layout_entries(payload.get("layout_det_res"))
    ocr_entries = _ocr_entries(payload.get("overall_ocr_res"))
    table_items = payload.get("table_res_list") or []
    formula_items = payload.get("formula_res_list") or []
    parsing_contents = _parsing_content_map(payload.get("parsing_res_list"))

    width = max(1, int(image_width))
    height = max(1, int(image_height))

    # Layout blocks carry the model's own reading order; header/footer style
    # labels get None and sort after the ordered flow.
    ordered = [entry for entry in layout_entries if entry["order"] is not None]
    ordered.sort(key=lambda entry: entry["order"])
    unordered = [entry for entry in layout_entries if entry["order"] is None]

    blocks: list[dict] = []
    table_index = 0
    formula_index = 0
    for source in ordered + unordered:
        bbox = source["bbox"]
        label = source["label"]
        content = parsing_contents.get(
            tuple(int(round(value)) for value in bbox), {}
        ).get("text", "")
        block = {
            "type": label,
            "bbox": bbox,
            "normalized_bbox": _normalize_bbox(bbox, width, height),
            "confidence": source["confidence"],
            "reading_order": source["order"],
            "text": content,
            "text_source": "ocr",
            "words": [],
        }
        if label == "table" and table_index < len(table_items):
            table_item = table_items[table_index] if isinstance(table_items[table_index], dict) else {}
            block["table"] = {
                "html": str(table_item.get("pred_html", "") or ""),
                "region_id": table_item.get("table_region_id"),
                **_table_geometry(table_item, width, height),
            }
            if not block["text"]:
                block["text"] = block["table"]["html"]
            table_index += 1
        elif label == "formula" and formula_index < len(formula_items):
            formula_item = formula_items[formula_index] if isinstance(formula_items[formula_index], dict) else {}
            block["formula"] = {
                "latex": str(formula_item.get("rec_formula", "") or ""),
                "region_id": formula_item.get("formula_region_id"),
            }
            if not block["text"]:
                block["text"] = block["formula"]["latex"]
            formula_index += 1
        blocks.append(block)

    # OCR boxes that fall outside every layout block become trailing
    # other_text blocks so no recognized text is lost from the model.
    for entry in ocr_entries:
        center_x = (entry["bbox"][0] + entry["bbox"][2]) / 2
        center_y = (entry["bbox"][1] + entry["bbox"][3]) / 2
        if any(_point_in_bbox(center_x, center_y, block["bbox"]) for block in blocks):
            continue
        bbox = entry["bbox"]
        blocks.append({
            "type": "other_text",
            "bbox": bbox,
            "normalized_bbox": _normalize_bbox(bbox, width, height),
            "confidence": None,
            "reading_order": None,
            "text": entry["text"],
            "text_source": "ocr",
            "words": [],
        })

    # Sequential fallback reading order for blocks the layout model left
    # unordered, and per-block OCR confidence from the assigned words.
    known_orders = [
        block["reading_order"] for block in blocks if block["reading_order"] is not None
    ]
    fallback_sequence = max(known_orders) if known_orders else 0
    for block in blocks:
        if block["reading_order"] is None:
            fallback_sequence += 1
            block["reading_order"] = fallback_sequence

    analysis = {
        "width": width,
        "height": height,
        "blocks": blocks,
        "words": [
            {
                "text": entry["text"],
                "bbox": entry["bbox"],
                "confidence": entry["confidence"],
                "block_id": None,
            }
            for entry in ocr_entries
        ],
    }
    return assign_words_to_blocks(analysis, words_to_ocr_words(analysis))


def assign_words_to_blocks(page_analysis: dict, words) -> dict:
    """Recompute the word→block assignment from a final word list.

    Callers that reorder or drop words (confusable-text correction,
    deduplication) invoke this after post-processing so block word indexes
    and per-block confidences stay aligned with the words that end up in the
    persisted index.
    """
    blocks = page_analysis.get("blocks") or []
    for block in blocks:
        block["words"] = []
    assignment: list[int | None] = []
    for word_index, word in enumerate(words):
        center_x = (word.left + word.right) / 2
        center_y = (word.top + word.bottom) / 2
        best_index = None
        best_area = None
        for block_index, block in enumerate(blocks):
            if _point_in_bbox(center_x, center_y, block["bbox"]):
                area = _box_area(block["bbox"])
                if best_area is None or area < best_area:
                    best_area = area
                    best_index = block_index
        assignment.append(best_index)
        if best_index is not None:
            blocks[best_index]["words"].append(word_index)
    for block in blocks:
        scores = [words[i].confidence for i in block["words"] if 0 <= i < len(words)]
        block["text_confidence"] = (
            sum(scores) / len(scores) if scores else None
        )
    page_analysis["words"] = [
        {
            "text": word.text,
            "bbox": [word.left, word.top, word.right, word.bottom],
            "confidence": word.confidence,
            "block_id": assignment[index],
        }
        for index, word in enumerate(words)
    ]
    return page_analysis


def normalized_blocks(page_analysis: dict, image_width: int, image_height: int) -> list[dict]:
    """Serialization-ready block rows for the SQLite index / metadata."""
    width = max(1, int(image_width))
    height = max(1, int(image_height))
    rows = []
    for block_id, block in enumerate(page_analysis.get("blocks", [])):
        rows.append({
            "block_id": block_id,
            "type": block["type"],
            "bbox": block["bbox"],
            "normalized_bbox": _normalize_bbox(block["bbox"], width, height),
            "reading_order": block["reading_order"],
            "confidence": block["confidence"],
            "text": block["spacing"]["text"] if (block.get("spacing") or {}).get("status") == "corrected" else block["text"],
            "text_source": block.get("text_source") or "ocr",
            "text_confidence": block.get("text_confidence"),
            "table": block.get("table"),
            "formula": block.get("formula"),
            "spacing": block.get("spacing"),
        })
    return rows


def words_to_ocr_words(page_analysis: dict):
    """Pixel-space word list matching pdf_ocr.OcrWord expectations."""
    import pdf.pdf_ocr as pdf_ocr
    return [
        pdf_ocr.OcrWord(
            text=word["text"],
            left=word["bbox"][0],
            top=word["bbox"][1],
            right=word["bbox"][2],
            bottom=word["bbox"][3],
            confidence=word["confidence"],
        )
        for word in page_analysis.get("words", [])
    ]


def reading_order_text(page_analysis: dict, words) -> str:
    """Page text assembled block-by-block in reading order.

    ``words`` are pdf_ocr.OcrWord instances in pixel coordinates aligned with
    the analysis word indexes. Falls back to plain geometric ordering when a
    page has no usable block data.
    """
    import statistics

    import pdf.pdf_ocr as pdf_ocr
    blocks = page_analysis.get("blocks") or []
    word_list = list(words or [])
    if not blocks or not word_list:
        return pdf_ocr._page_text(word_list)
    ordered_blocks = sorted(
        enumerate(blocks),
        key=lambda item: (
            0 if _layout_label_orders_first(item[1].get("type")) else 1,
            item[1].get("reading_order") if item[1].get("reading_order") is not None else 10**6,
        ),
    )
    pieces: list[str] = []
    for _, block in ordered_blocks:
        spacing = block.get("spacing")
        if isinstance(spacing, dict) and spacing.get("text"):
            pieces.append(spacing["text"])
            continue
        indexes = block.get("words") or []
        block_words = [word_list[i] for i in indexes if 0 <= i < len(word_list)]
        if not block_words:
            content = str(block.get("text") or "").strip()
            if content:
                pieces.append(content)
            continue
        pieces.append(pdf_ocr._page_text(block_words))
    return "\n".join(piece for piece in pieces if piece)


def _layout_label_orders_first(label: str | None) -> int:
    return 0 if str(label or "") not in _ORDER_SKIP_LABELS else 1


# ---------------------------------------------------------------------------
# Native text combination
# ---------------------------------------------------------------------------


def extract_native_page_words(reader, page_index: int) -> list[dict]:
    """Normalized 0..1 word boxes for a page's native text layer.

    Uses the same text-matrix reverse mapping as the embedded-layer index
    rebuild, so positions line up with viewer coordinates.
    """
    words: list[dict] = []
    page = reader.pages[page_index]

    def visitor(text, cm, tm, font_dict, font_size):
        text = str(text or "")
        if not text.strip():
            return
        try:
            font_size = float(font_size or 0)
        except (TypeError, ValueError):
            font_size = 0
        if font_size <= 0:
            return
        try:
            page_height = float(page.mediabox.height)
        except Exception:
            page_height = 0.0
        if page_height <= 0:
            return
        x = float(tm[4])
        y_from_bottom = float(tm[5])
        top = 1.0 - (y_from_bottom + font_size * 1.22) / page_height
        bottom = 1.0 - (y_from_bottom - font_size * 0.17) / page_height
        words.append({
            "text": text,
            "left": max(0.0, min(1.0, x / max(1e-6, float(page.mediabox.width)))),
            "top": top,
            "bottom": bottom,
        })

    page.extract_text(visitor_text=visitor)
    return [word for word in words if word["text"].strip()]


def combine_native_blocks(
    page_analysis: dict,
    native_words: list[dict],
    *,
    min_coverage: float = 0.5,
) -> dict:
    """Prefer native text per block when the native layer covers it.

    Layout blocks whose area is mostly covered by native words get
    ``text_source="native"`` and block text rebuilt from the native words;
    everything else keeps the PP-OCRv5 result. Structure and reading order
    always come from PP-StructureV3.
    """
    if not native_words:
        return page_analysis
    width = max(1, int(page_analysis.get("width") or 1))
    height = max(1, int(page_analysis.get("height") or 1))
    native_pixel = []
    for word in native_words:
        left = float(word.get("left", 0.0))
        top = float(word.get("top", 0.0))
        right = float(word.get("right", left))
        bottom = float(word.get("bottom", top))
        native_pixel.append({
            "text": word["text"],
            "bbox": [left * width, top * height, right * width, bottom * height],
        })
    for block in page_analysis.get("blocks", []):
        bbox = block["bbox"]
        block_area = max(1e-6, _box_area(bbox))
        inside = []
        covered = 0.0
        for word in native_pixel:
            word_bbox = word["bbox"]
            center_x = (word_bbox[0] + word_bbox[2]) / 2
            center_y = (word_bbox[1] + word_bbox[3]) / 2
            if _point_in_bbox(center_x, center_y, bbox):
                inside.append(word)
                intersection_w = min(bbox[2], word_bbox[2]) - max(bbox[0], word_bbox[0])
                intersection_h = min(bbox[3], word_bbox[3]) - max(bbox[1], word_bbox[1])
                if intersection_w > 0 and intersection_h > 0:
                    covered += intersection_w * intersection_h
        if inside and covered / block_area >= min_coverage:
            block["text_source"] = "native"
            block["native_words"] = [word["text"] for word in inside]
    return page_analysis


# ---------------------------------------------------------------------------
# Problem-number sequence inspection
# ---------------------------------------------------------------------------

_PROBLEM_NUMBER_TOKEN = re.compile(r"^\(?(\d{1,3})[.):]?$")
_MAX_SEQUENCE_GAP = 6


def problem_number_sequence_gaps(found_numbers: list[int]) -> list[dict]:
    """Report missing numbers inside consecutive problem-number sequences.

    ``[1, 2, 3, 5, 6]`` yields one candidate for number 4 between 3 and 5.
    Purely informational: rerunning OCR on the flagged region stays a
    separate, explicit step (``rerun_region_ocr``).
    """
    numbers = sorted({int(value) for value in found_numbers if 0 < int(value) < 1000})
    gaps: list[dict] = []
    for previous, following in zip(numbers, numbers[1:]):
        difference = following - previous
        if 2 <= difference <= _MAX_SEQUENCE_GAP:
            for missing in range(previous + 1, following):
                gaps.append({
                    "missing": missing,
                    "after": previous,
                    "before": following,
                })
    return gaps


def rerun_region_ocr(
    path: str,
    page: int,
    normalized_region: list[float],
    language: str = "korean",
    *,
    scale_multiplier: float = 2.0,
    profile=None,
    model_variant: str | None = None,
):
    """Targeted high-resolution re-OCR of one page region.

    Reserved as the second-pass hook for missing problem numbers: crops the
    page at the base render scale, upscales the crop and runs the legacy
    single-image recognizer so callers can compare both passes. Coordinates
    of the returned words are mapped back to full-page pixel space.
    """
    import pdf.pdf_ocr as pdf_ocr
    scale = pdf_ocr._ocr_render_scale(model_variant or pdf_ocr.DEFAULT_OCR_MODEL_VARIANT)
    rendered = pdf_ocr._render_pdf_page(path, int(page), scale=scale)
    left = max(0, min(rendered.width - 1, int(normalized_region[0] * rendered.width)))
    top = max(0, min(rendered.height - 1, int(normalized_region[1] * rendered.height)))
    right = max(left + 1, min(rendered.width, int(normalized_region[2] * rendered.width)))
    bottom = max(top + 1, min(rendered.height, int(normalized_region[3] * rendered.height)))
    crop = rendered.crop((left, top, right, bottom))
    multiplier = max(1.0, float(scale_multiplier))
    if multiplier > 1.0:
        from PIL import Image

        crop = crop.resize(
            (int(crop.width * multiplier), int(crop.height * multiplier)),
            Image.Resampling.LANCZOS,
        )
    crop_words = pdf_ocr._recognize(crop, language, profile=profile, model_variant=model_variant)
    placed = []
    for word in crop_words:
        placed.append(pdf_ocr.OcrWord(
            text=word.text,
            left=left + word.left / multiplier,
            top=top + word.top / multiplier,
            right=left + word.right / multiplier,
            bottom=top + word.bottom / multiplier,
            confidence=word.confidence,
        ))
    return placed
