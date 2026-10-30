from __future__ import annotations

import json
import math
import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Mapping, TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

from PIL import Image, ImageOps

from common import resource_path
from ocr_runtime import load_onnxruntime


MODEL_VARIANTS = ("tiny", "small", "medium")
DEFAULT_MODEL_VARIANT = "medium"
DEFAULT_INPUT_WIDTH = 96
DEFAULT_INPUT_HEIGHT = 48
DEFAULT_MIN_CONFIDENCE = 0.82
DEFAULT_MIN_MARGIN = 0.18

_session_lock = threading.RLock()


def _normalize_variant(value: str | None) -> str:
    variant = str(value or DEFAULT_MODEL_VARIANT).strip().lower()
    return variant if variant in MODEL_VARIANTS else DEFAULT_MODEL_VARIANT


def _model_root() -> Path:
    return Path(resource_path(os.path.join("models", "problem_number")))


def _asset_signature(path: Path) -> tuple[int, int]:
    try:
        stat = path.stat()
    except OSError:
        return 0, 0
    return int(stat.st_mtime_ns), int(stat.st_size)


@lru_cache(maxsize=4)
def _read_metadata(
    path_text: str,
    _mtime_ns: int,
    _size: int,
) -> dict[str, Any]:
    path = Path(path_text)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _metadata() -> dict[str, Any]:
    path = _model_root() / "metadata.json"
    return _read_metadata(str(path), *_asset_signature(path))


def model_path(model_variant: str | None = None) -> Path:
    variant = _normalize_variant(model_variant)
    return _model_root() / f"problem-number-{variant}.onnx"


def models_available() -> dict[str, bool]:
    return {
        variant: model_path(variant).is_file()
        for variant in MODEL_VARIANTS
    }


@lru_cache(maxsize=len(MODEL_VARIANTS) * 2)
def _read_session(
    model_variant: str,
    path_text: str,
    _mtime_ns: int,
    _size: int,
):
    ort = load_onnxruntime()

    path = Path(path_text)
    if not path.is_file():
        raise FileNotFoundError(path)
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
    options.inter_op_num_threads = 1
    return ort.InferenceSession(
        str(path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )


def _session(model_variant: str):
    path = model_path(model_variant)
    return _read_session(
        model_variant,
        str(path),
        *_asset_signature(path),
    )


def clear_model_cache() -> None:
    with _session_lock:
        _read_session.cache_clear()
        _read_metadata.cache_clear()


def _ink_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    import numpy as np
    grayscale = image.convert("L")
    try:
        array = np.asarray(grayscale)
    finally:
        grayscale.close()
    ys, xs = np.where(array < 245)
    if not len(xs) or not len(ys):
        return 0, 0, image.width, image.height
    padding = max(1, int(round(min(image.size) * 0.08)))
    return (
        max(0, int(xs.min()) - padding),
        max(0, int(ys.min()) - padding),
        min(image.width, int(xs.max()) + padding + 1),
        min(image.height, int(ys.max()) + padding + 1),
    )


def preprocess_crop(
    image: Image.Image,
    *,
    width: int = DEFAULT_INPUT_WIDTH,
    height: int = DEFAULT_INPUT_HEIGHT,
) -> np.ndarray:
    import numpy as np
    source = ImageOps.autocontrast(image.convert("L"), cutoff=0)
    try:
        crop_box = _ink_bbox(source)
        cropped = source.crop(crop_box)
        try:
            maximum_width = max(1, int(width) - 12)
            maximum_height = max(1, int(height) - 10)
            scale = min(
                maximum_width / max(1, cropped.width),
                maximum_height / max(1, cropped.height),
            )
            target_width = max(
                1,
                min(maximum_width, int(round(cropped.width * scale))),
            )
            target_height = max(
                1,
                min(maximum_height, int(round(cropped.height * scale))),
            )
            resized = cropped.resize(
                (target_width, target_height),
                Image.Resampling.LANCZOS,
            )
        finally:
            cropped.close()
        try:
            canvas = Image.new("L", (int(width), int(height)), 255)
            canvas.paste(
                resized,
                (
                    (int(width) - resized.width) // 2,
                    (int(height) - resized.height) // 2,
                ),
            )
            array = np.asarray(canvas, dtype=np.float32)
        finally:
            resized.close()
            canvas.close()
    finally:
        source.close()
    return ((255.0 - array) / 255.0)[None, :, :]


def _softmax(logits: np.ndarray) -> np.ndarray:
    import numpy as np
    values = np.asarray(logits, dtype=np.float32)
    values = values - np.max(values, axis=1, keepdims=True)
    exponentials = np.exp(values)
    return exponentials / np.maximum(
        np.sum(exponentials, axis=1, keepdims=True),
        np.finfo(np.float32).tiny,
    )


def classify_crops(
    crops: Iterable[Image.Image],
    *,
    model_variant: str | None = None,
    minimum_confidence: float | None = None,
    minimum_margin: float | None = None,
) -> list[dict[str, Any]]:
    import numpy as np
    crop_list = list(crops)
    if not crop_list:
        return []
    variant = _normalize_variant(model_variant)
    metadata = _metadata()
    input_metadata = (
        metadata.get("input")
        if isinstance(metadata.get("input"), Mapping)
        else {}
    )
    width = max(1, int(input_metadata.get("width") or DEFAULT_INPUT_WIDTH))
    height = max(1, int(input_metadata.get("height") or DEFAULT_INPUT_HEIGHT))
    classes = metadata.get("classes")
    if not isinstance(classes, list) or not classes:
        classes = list(range(23))
    model_metadata = (
        metadata.get("models", {}).get(variant, {})
        if isinstance(metadata.get("models"), Mapping)
        else {}
    )
    acceptance = (
        model_metadata.get("acceptance")
        if isinstance(model_metadata, Mapping)
        and isinstance(model_metadata.get("acceptance"), Mapping)
        else {}
    )
    effective_minimum_confidence = float(
        minimum_confidence
        if minimum_confidence is not None
        else acceptance.get("minimum_confidence", DEFAULT_MIN_CONFIDENCE)
    )
    effective_minimum_margin = float(
        minimum_margin
        if minimum_margin is not None
        else acceptance.get("minimum_margin", DEFAULT_MIN_MARGIN)
    )

    try:
        with _session_lock:
            session = _session(variant)
        inputs = np.stack(
            [
                preprocess_crop(crop, width=width, height=height)
                for crop in crop_list
            ],
            axis=0,
        ).astype(np.float32, copy=False)
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: inputs})
    except (FileNotFoundError, ImportError, OSError, RuntimeError, ValueError):
        return [
            {
                "available": False,
                "accepted": False,
                "number": None,
                "confidence": 0.0,
                "margin": 0.0,
                "model_variant": variant,
            }
            for _crop in crop_list
        ]
    if not outputs:
        raise RuntimeError("Problem-number OCR returned no output.")
    probabilities = _softmax(np.asarray(outputs[0]))
    if probabilities.shape[0] != len(crop_list):
        raise RuntimeError("Problem-number OCR returned an unexpected batch size.")

    results = []
    for row in probabilities:
        order = np.argsort(row)[::-1]
        class_index = int(order[0])
        runner_up_index = int(order[1]) if len(order) > 1 else class_index
        confidence = float(row[class_index])
        margin = float(row[class_index] - row[runner_up_index])
        label = int(classes[class_index])
        accepted = bool(
            label != 0
            and confidence >= effective_minimum_confidence
            and margin >= effective_minimum_margin
        )
        results.append({
            "available": True,
            "accepted": accepted,
            "number": label if accepted else None,
            "predicted_class": label,
            "confidence": confidence,
            "margin": margin,
            "minimum_confidence": effective_minimum_confidence,
            "minimum_margin": effective_minimum_margin,
            "model_variant": variant,
        })
    return results


def _normalized_region(
    region: Mapping[str, Any],
) -> tuple[float, float, float, float]:
    left = max(0.0, min(1.0, float(region.get("left", 0) or 0)))
    top = max(0.0, min(1.0, float(region.get("top", 0) or 0)))
    right = max(left, min(1.0, float(region.get("right", left) or left)))
    bottom = max(top, min(1.0, float(region.get("bottom", top) or top)))
    return left, top, right, bottom


def problem_number_pixel_region(
    image_size: tuple[int, int],
    region: Mapping[str, Any],
    *,
    digit_count: int = 2,
) -> tuple[int, int, int, int]:
    """Create the canonical problem-number crop used by training and runtime."""

    image_width, image_height = map(int, image_size)
    left, top, raw_right, bottom = _normalized_region(region)
    left *= image_width
    top *= image_height
    raw_right *= image_width
    bottom *= image_height
    glyph_height = max(8.0, bottom - top)
    expected_width = glyph_height * (
        0.62 * max(2, int(digit_count)) + 0.52
    )
    right = min(raw_right, left + expected_width)
    if right - left < glyph_height * 0.45:
        right = min(image_width, left + expected_width)
    horizontal_pad = glyph_height * 0.18
    vertical_pad = glyph_height * 0.22
    return (
        max(0, int(math.floor(left - horizontal_pad))),
        max(0, int(math.floor(top - vertical_pad))),
        min(image_width, int(math.ceil(right + horizontal_pad))),
        min(image_height, int(math.ceil(bottom + vertical_pad))),
    )


def classify_pdf_regions(
    pdf_path: str,
    regions: Iterable[Mapping[str, Any]],
    *,
    model_variant: str | None = None,
    render_scale: float = 3.5,
    minimum_confidence: float | None = None,
    minimum_margin: float | None = None,
) -> list[dict[str, Any]]:
    requests = [dict(region) for region in regions]
    if not requests:
        return []
    if not model_path(model_variant).is_file():
        return [
            {
                "available": False,
                "accepted": False,
                "number": None,
                "confidence": 0.0,
                "margin": 0.0,
                "model_variant": _normalize_variant(model_variant),
            }
            for _request in requests
        ]

    from pdf.pdf_ocr import _render_pdf_page

    page_groups: dict[int, list[tuple[int, Mapping[str, Any]]]] = {}
    for index, request in enumerate(requests):
        page_number = max(1, int(request.get("page") or 1))
        raw_box = request.get("bbox")
        box = raw_box if isinstance(raw_box, Mapping) else request
        page_groups.setdefault(page_number, []).append((index, box))

    results: list[dict[str, Any] | None] = [None] * len(requests)
    for page_number, page_requests in sorted(page_groups.items()):
        image = _render_pdf_page(
            os.path.abspath(pdf_path),
            page_number - 1,
            scale=max(1.0, float(render_scale)),
        )
        crops = []
        try:
            for _index, box in page_requests:
                digit_count = int(box.get("_problem_number_digits", 0) or 0)
                if digit_count:
                    pixel_box = problem_number_pixel_region(
                        image.size,
                        box,
                        digit_count=digit_count,
                    )
                else:
                    left, top, right, bottom = _normalized_region(box)
                    pixel_box = (
                        max(0, int(math.floor(left * image.width))),
                        max(0, int(math.floor(top * image.height))),
                        min(image.width, int(math.ceil(right * image.width))),
                        min(image.height, int(math.ceil(bottom * image.height))),
                    )
                if pixel_box[2] <= pixel_box[0]:
                    pixel_box = (
                        pixel_box[0],
                        pixel_box[1],
                        min(image.width, pixel_box[0] + 1),
                        pixel_box[3],
                    )
                if pixel_box[3] <= pixel_box[1]:
                    pixel_box = (
                        pixel_box[0],
                        pixel_box[1],
                        pixel_box[2],
                        min(image.height, pixel_box[1] + 1),
                    )
                crops.append(image.crop(pixel_box).convert("L"))
            page_results = classify_crops(
                crops,
                model_variant=model_variant,
                minimum_confidence=minimum_confidence,
                minimum_margin=minimum_margin,
            )
            for (index, _box), result in zip(page_requests, page_results):
                results[index] = result
        finally:
            for crop in crops:
                crop.close()
            image.close()

    unavailable = {
        "available": False,
        "accepted": False,
        "number": None,
        "confidence": 0.0,
        "margin": 0.0,
        "model_variant": _normalize_variant(model_variant),
    }
    return [
        dict(result) if isinstance(result, Mapping) else dict(unavailable)
        for result in results
    ]


__all__ = [
    "MODEL_VARIANTS",
    "classify_crops",
    "classify_pdf_regions",
    "clear_model_cache",
    "model_path",
    "models_available",
    "preprocess_crop",
]
