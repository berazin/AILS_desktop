from __future__ import annotations

from collections import Counter
from typing import Any, Iterable, Mapping

import numpy as np
from PIL import Image

import documents.problem_number_ocr as problem_number_ocr


# Page 567 contains a visually valid "5" whose anti-aliased coral square has
# a 0.5965 fill ratio at the production 1.8x render scale.  Keep a small
# margin below that audited sample; page/header and body-row matching provide
# the surrounding false-positive guards.
DEFAULT_MINIMUM_FILL_DENSITY = 0.59
DEFAULT_CPP_MINIMUM_FILL_DENSITY = 0.55

# Pillow represents hue on 0..255 while OpenCV represents it on 0..179.
# 31 is the Pillow equivalent of the upper hue bound (22) used while
# visually auditing the Java CHECK TIME pages.
_MAX_CORAL_HUE = 31
_MIN_CORAL_SATURATION = 90
_MIN_CORAL_VALUE = 150
_MAX_CPP_ORANGE_HUE = 40
_MIN_CPP_ORANGE_SATURATION = 70
_MIN_CPP_ORANGE_VALUE = 120
_MAX_CPP_GRAY_SATURATION = 55
_MIN_CPP_GRAY_VALUE = 50
_MAX_CPP_GRAY_VALUE = 230


def _coral_mask(image: Image.Image) -> np.ndarray:
    hsv_image = image.convert("HSV")
    try:
        hsv = np.asarray(hsv_image)
    finally:
        hsv_image.close()
    return (
        (hsv[:, :, 0] <= _MAX_CORAL_HUE)
        & (hsv[:, :, 1] >= _MIN_CORAL_SATURATION)
        & (hsv[:, :, 2] >= _MIN_CORAL_VALUE)
    )


def _cpp_badge_masks(image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    hsv_image = image.convert("HSV")
    try:
        hsv = np.asarray(hsv_image)
    finally:
        hsv_image.close()
    orange = (
        (hsv[:, :, 0] <= _MAX_CPP_ORANGE_HUE)
        & (hsv[:, :, 1] >= _MIN_CPP_ORANGE_SATURATION)
        & (hsv[:, :, 2] >= _MIN_CPP_ORANGE_VALUE)
    )
    gray = (
        (hsv[:, :, 1] <= _MAX_CPP_GRAY_SATURATION)
        & (hsv[:, :, 2] >= _MIN_CPP_GRAY_VALUE)
        & (hsv[:, :, 2] <= _MAX_CPP_GRAY_VALUE)
    )
    return orange, gray


def _connected_components(
    mask: np.ndarray,
) -> list[tuple[int, int, int, int, int]]:
    """Return 8-connected components as x, y, width, height, area."""

    parents: list[int] = []
    ranks: list[int] = []
    runs: list[tuple[int, int, int, int]] = []

    def make_set() -> int:
        identifier = len(parents)
        parents.append(identifier)
        ranks.append(0)
        return identifier

    def find(identifier: int) -> int:
        root = identifier
        while parents[root] != root:
            root = parents[root]
        while parents[identifier] != identifier:
            parent = parents[identifier]
            parents[identifier] = root
            identifier = parent
        return root

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root == second_root:
            return
        if ranks[first_root] < ranks[second_root]:
            first_root, second_root = second_root, first_root
        parents[second_root] = first_root
        if ranks[first_root] == ranks[second_root]:
            ranks[first_root] += 1

    previous_runs: list[tuple[int, int, int]] = []
    for y, row in enumerate(np.asarray(mask, dtype=bool)):
        indexes = np.flatnonzero(row)
        if indexes.size:
            boundaries = np.flatnonzero(np.diff(indexes) > 1) + 1
            groups = np.split(indexes, boundaries)
            current_runs = [
                (int(group[0]), int(group[-1]) + 1, make_set())
                for group in groups
            ]
        else:
            current_runs = []

        previous_index = 0
        for start, stop, identifier in current_runs:
            while (
                previous_index < len(previous_runs)
                and previous_runs[previous_index][1] < start
            ):
                previous_index += 1
            overlap_index = previous_index
            while (
                overlap_index < len(previous_runs)
                and previous_runs[overlap_index][0] <= stop
            ):
                previous_start, previous_stop, previous_identifier = (
                    previous_runs[overlap_index]
                )
                if previous_stop >= start and previous_start <= stop:
                    union(identifier, previous_identifier)
                overlap_index += 1
            runs.append((y, start, stop, identifier))
        previous_runs = current_runs

    stats: dict[int, list[int]] = {}
    for y, start, stop, identifier in runs:
        root = find(identifier)
        area = stop - start
        if root not in stats:
            stats[root] = [start, y, stop, y + 1, area]
            continue
        component = stats[root]
        component[0] = min(component[0], start)
        component[1] = min(component[1], y)
        component[2] = max(component[2], stop)
        component[3] = max(component[3], y + 1)
        component[4] += area

    return [
        (
            left,
            top,
            right - left,
            bottom - top,
            area,
        )
        for left, top, right, bottom, area in stats.values()
    ]


def _component_candidates(
    image: Image.Image,
    *,
    minimum_fill_density: float,
) -> list[dict[str, Any]]:
    width, height = image.size
    if width <= 0 or height <= 0:
        return []

    candidates: list[dict[str, Any]] = []
    for x, y, component_width, component_height, area in (
        _connected_components(_coral_mask(image))
    ):
        left = x / width
        top = y / height
        normalized_width = component_width / width
        normalized_height = component_height / height
        fill_density = area / max(1, component_width * component_height)
        if not (
            (
                0.048 <= left <= 0.105
                or 0.265 <= left <= 0.305
            )
            and 0.013 <= normalized_width <= 0.026
            and 0.010 <= normalized_height <= 0.022
            and fill_density >= float(minimum_fill_density)
            and 0.08 <= top <= 0.93
        ):
            continue

        padding = max(
            3,
            int(round(min(component_width, component_height) * 0.2)),
        )
        crop = image.crop((
            max(0, x - padding),
            max(0, y - padding),
            min(width, x + component_width + padding),
            min(height, y + component_height + padding),
        )).convert("L")
        candidates.append({
            "bbox": {
                "left": left,
                "top": top,
                "right": (x + component_width) / width,
                "bottom": (y + component_height) / height,
            },
            "pixel_bbox": [
                x,
                y,
                x + component_width,
                y + component_height,
            ],
            "fill_density": float(fill_density),
            "crop": crop,
        })

    candidates.sort(
        key=lambda item: (
            float(item["bbox"]["top"]),
            float(item["bbox"]["left"]),
        )
    )
    return candidates


def _normalized_vertical_ranges(
    vertical_ranges: Iterable[tuple[float, float]] | None,
) -> list[tuple[float, float]] | None:
    if vertical_ranges is None:
        return None
    normalized = []
    for raw_top, raw_bottom in vertical_ranges:
        top = max(0.0, min(1.0, float(raw_top)))
        bottom = max(0.0, min(1.0, float(raw_bottom)))
        if bottom > top:
            normalized.append((top, bottom))
    return normalized


def _candidate_in_scope(
    bbox: Mapping[str, Any],
    *,
    vertical_ranges: list[tuple[float, float]] | None,
    bbox_region: Mapping[str, Any] | None,
) -> bool:
    center_x = (
        float(bbox.get("left", 0.0))
        + float(bbox.get("right", 0.0))
    ) / 2.0
    center_y = (
        float(bbox.get("top", 0.0))
        + float(bbox.get("bottom", 0.0))
    ) / 2.0
    if vertical_ranges is not None and not any(
        top <= center_y <= bottom
        for top, bottom in vertical_ranges
    ):
        return False
    if bbox_region is None:
        return True
    left = max(0.0, min(1.0, float(bbox_region.get("left", 0.0) or 0.0)))
    top = max(0.0, min(1.0, float(bbox_region.get("top", 0.0) or 0.0)))
    raw_right = bbox_region.get("right", 1.0)
    raw_bottom = bbox_region.get("bottom", 1.0)
    right = max(
        0.0,
        min(1.0, float(1.0 if raw_right is None else raw_right)),
    )
    bottom = max(
        0.0,
        min(1.0, float(1.0 if raw_bottom is None else raw_bottom)),
    )
    return left <= center_x <= right and top <= center_y <= bottom


def _cpp_component_candidates(
    image: Image.Image,
    *,
    minimum_fill_density: float,
    vertical_ranges: Iterable[tuple[float, float]] | None,
    bbox_region: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    width, height = image.size
    if width <= 0 or height <= 0:
        return []

    normalized_ranges = _normalized_vertical_ranges(vertical_ranges)
    masks = zip(("orange", "gray"), _cpp_badge_masks(image))
    candidates: list[dict[str, Any]] = []
    for badge_style, mask in masks:
        for x, y, component_width, component_height, area in (
            _connected_components(mask)
        ):
            left = x / width
            top = y / height
            normalized_width = component_width / width
            normalized_height = component_height / height
            pixel_aspect_ratio = component_width / max(1, component_height)
            fill_density = area / max(1, component_width * component_height)
            if not (
                0.26 <= left <= 0.32
                and 0.014 <= normalized_width <= 0.028
                and 0.010 <= normalized_height <= 0.022
                and 0.65 <= pixel_aspect_ratio <= 1.45
                and fill_density >= float(minimum_fill_density)
                and 0.08 <= top <= 0.93
            ):
                continue

            bbox = {
                "left": left,
                "top": top,
                "right": (x + component_width) / width,
                "bottom": (y + component_height) / height,
            }
            if not _candidate_in_scope(
                bbox,
                vertical_ranges=normalized_ranges,
                bbox_region=bbox_region,
            ):
                continue

            padding = max(
                3,
                int(
                    round(
                        min(component_width, component_height) * 0.2
                    )
                ),
            )
            crop = image.crop((
                max(0, x - padding),
                max(0, y - padding),
                min(width, x + component_width + padding),
                min(height, y + component_height + padding),
            )).convert("L")
            candidates.append({
                "bbox": bbox,
                "pixel_bbox": [
                    x,
                    y,
                    x + component_width,
                    y + component_height,
                ],
                "fill_density": float(fill_density),
                "pixel_aspect_ratio": float(pixel_aspect_ratio),
                "badge_style": badge_style,
                "crop": crop,
            })

    candidates.sort(
        key=lambda item: (
            float(item["bbox"]["top"]),
            float(item["bbox"]["left"]),
        )
    )
    return candidates


def _calibrated_consensus(
    per_variant: Mapping[str, list[Mapping[str, Any]]],
    index: int,
) -> tuple[int, int, dict[str, dict[str, Any]]] | None:
    predictions: dict[str, dict[str, Any]] = {}
    raw_votes: list[int] = []
    accepted_votes: list[int] = []
    for variant in problem_number_ocr.MODEL_VARIANTS:
        variant_results = per_variant.get(variant, [])
        if index >= len(variant_results):
            continue
        result = variant_results[index]
        if not bool(result.get("available")):
            continue
        predicted_class = int(result.get("predicted_class", -1))
        accepted = bool(result.get("accepted"))
        predictions[variant] = {
            "predicted_class": predicted_class,
            "accepted": accepted,
            "confidence": float(result.get("confidence", 0.0) or 0.0),
            "margin": float(result.get("margin", 0.0) or 0.0),
        }
        raw_votes.append(predicted_class)
        if accepted:
            accepted_votes.append(predicted_class)

    accepted_counts = Counter(accepted_votes)
    if accepted_counts:
        number, vote_count = accepted_counts.most_common(1)[0]
        if vote_count >= 2 and 1 <= number <= 9:
            return int(number), int(vote_count), predictions

    # A calibrated threshold can be slightly conservative on a faint glyph.
    # Permit a 2/3 raw consensus only when at least one model independently
    # accepted that same number. This recovers audited low-contrast labels
    # without restoring the previous zero-threshold voting behavior.
    raw_counts = Counter(raw_votes)
    if raw_counts:
        number, vote_count = raw_counts.most_common(1)[0]
        if (
            vote_count >= 2
            and number in accepted_votes
            and 1 <= number <= 9
        ):
            return int(number), int(vote_count), predictions
    return None


def detect_coral_problem_numbers(
    image: Image.Image,
    *,
    minimum_fill_density: float = DEFAULT_MINIMUM_FILL_DENSITY,
) -> list[dict[str, Any]]:
    """Detect and classify Java CHECK TIME coral problem-number labels.

    Bounding boxes are normalized to the input image dimensions. A candidate
    is returned only when at least two of the Tiny, Small, and Medium models
    predict the same single-digit problem number.
    """

    candidates = _component_candidates(
        image,
        minimum_fill_density=minimum_fill_density,
    )
    if not candidates:
        return []

    crops = [candidate["crop"] for candidate in candidates]
    try:
        per_variant = {
            variant: problem_number_ocr.classify_crops(
                crops,
                model_variant=variant,
            )
            for variant in problem_number_ocr.MODEL_VARIANTS
        }

        detected: list[dict[str, Any]] = []
        for index, candidate in enumerate(candidates):
            consensus = _calibrated_consensus(per_variant, index)
            if consensus is None:
                continue
            number, vote_count, predictions = consensus

            detected.append({
                "bbox": dict(candidate["bbox"]),
                "pixel_bbox": list(candidate["pixel_bbox"]),
                "number": int(number),
                "fill_density": float(candidate["fill_density"]),
                "vote_count": int(vote_count),
                "model_predictions": predictions,
            })
        return detected
    finally:
        for crop in crops:
            crop.close()


def detect_cpp_check_problem_numbers(
    image: Image.Image,
    *,
    vertical_ranges: Iterable[tuple[float, float]] | None = None,
    bbox_region: Mapping[str, Any] | None = None,
    minimum_fill_density: float = DEFAULT_CPP_MINIMUM_FILL_DENSITY,
) -> list[dict[str, Any]]:
    """Detect C++ CHECK TIME gray or orange square number badges.

    ``vertical_ranges`` and ``bbox_region`` use normalized page coordinates.
    Callers can pass either or both to restrict detection to a known CHECK
    block and avoid unrelated decorative squares elsewhere on the page.
    """

    candidates = _cpp_component_candidates(
        image,
        minimum_fill_density=minimum_fill_density,
        vertical_ranges=vertical_ranges,
        bbox_region=bbox_region,
    )
    if not candidates:
        return []

    crops = [candidate["crop"] for candidate in candidates]
    try:
        per_variant = {
            variant: problem_number_ocr.classify_crops(
                crops,
                model_variant=variant,
            )
            for variant in problem_number_ocr.MODEL_VARIANTS
        }

        detected: list[dict[str, Any]] = []
        for index, candidate in enumerate(candidates):
            consensus = _calibrated_consensus(per_variant, index)
            if consensus is None:
                continue
            number, vote_count, predictions = consensus

            detected.append({
                "bbox": dict(candidate["bbox"]),
                "pixel_bbox": list(candidate["pixel_bbox"]),
                "number": int(number),
                "fill_density": float(candidate["fill_density"]),
                "pixel_aspect_ratio": float(
                    candidate["pixel_aspect_ratio"]
                ),
                "badge_style": str(candidate["badge_style"]),
                "vote_count": int(vote_count),
                "model_predictions": predictions,
            })
        return detected
    finally:
        for crop in crops:
            crop.close()


__all__ = [
    "DEFAULT_CPP_MINIMUM_FILL_DENSITY",
    "DEFAULT_MINIMUM_FILL_DENSITY",
    "detect_coral_problem_numbers",
    "detect_cpp_check_problem_numbers",
]
