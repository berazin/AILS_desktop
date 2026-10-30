from __future__ import annotations

import math
import re
import statistics
from collections.abc import Mapping
from dataclasses import dataclass

OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION = "repeated_rotated_decoration"


@dataclass(frozen=True)
class OcrWord:
    text: str
    left: float
    top: float
    right: float
    bottom: float
    confidence: float = 0.0


@dataclass(frozen=True)
class _RotatedTextRun:
    page_index: int
    word_indexes: tuple[int, ...]
    center_x: float
    center_y: float
    width: float
    height: float


def _analysis_quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    position = max(0.0, min(1.0, float(fraction))) * (len(ordered) - 1)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _analysis_page_size(
    words: list[OcrWord],
    page_size: tuple[float, float] | None,
) -> tuple[float, float]:
    if page_size is not None:
        width = float(page_size[0])
        height = float(page_size[1])
        if width > 0 and height > 0:
            return width, height
    maximum_right = max((float(word.right) for word in words), default=1.0)
    maximum_bottom = max((float(word.bottom) for word in words), default=1.0)
    if maximum_right <= 1.5 and maximum_bottom <= 1.5:
        return 1.0, 1.0
    return max(1.0, maximum_right), max(1.0, maximum_bottom)


def _detached_rotated_text_runs(
    words: list[OcrWord],
    page_index: int,
    page_size: tuple[float, float] | None,
) -> list[_RotatedTextRun]:
    """Return conservative vertical-text runs outside the page's body band.

    A tall OCR box anchors each run. This deliberately ignores aligned numeric
    columns and ambiguous one-off glyph stacks; those false negatives are safer
    than removing a real table heading from structural analysis.
    """

    if not words:
        return []
    page_width, page_height = _analysis_page_size(words, page_size)
    geometry = []
    for word in words:
        left = max(0.0, min(float(word.left) / page_width, 1.0))
        top = max(0.0, min(float(word.top) / page_height, 1.0))
        right = max(left, min(float(word.right) / page_width, 1.0))
        bottom = max(top, min(float(word.bottom) / page_height, 1.0))
        geometry.append({
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
            "width": max(1e-6, right - left),
            "height": max(1e-6, bottom - top),
            "center_x": (left + right) / 2.0,
        })

    median_height = max(0.002, statistics.median(item["height"] for item in geometry))
    horizontal_body_indexes = [
        index
        for index, (word, item) in enumerate(zip(words, geometry))
        if any(character.isalpha() for character in str(word.text or ""))
        and item["width"] / item["height"] >= 1.4
    ]
    if len(horizontal_body_indexes) < 2:
        return []
    body_left = _analysis_quantile(
        [geometry[index]["left"] for index in horizontal_body_indexes],
        0.10,
    )
    body_right = _analysis_quantile(
        [geometry[index]["right"] for index in horizontal_body_indexes],
        0.90,
    )

    candidate_indexes = []
    tall_anchor_indexes: set[int] = set()
    for index, (word, item) in enumerate(zip(words, geometry)):
        compact = re.sub(r"\s+", "", str(word.text or ""))
        if (
            not any(character.isalpha() for character in compact)
            or len(compact) > 12
            or item["width"] > max(0.10, median_height * 4.0)
            or item["height"] > 0.45
            or (item["right"] >= body_left and item["left"] <= body_right)
        ):
            continue
        candidate_indexes.append(index)
        if (
            item["height"] >= max(0.035, median_height * 2.8)
            and item["height"] / item["width"] >= 2.5
        ):
            tall_anchor_indexes.add(index)

    if not candidate_indexes:
        return []

    adjacency: dict[int, set[int]] = {index: set() for index in candidate_indexes}
    for offset, left_index in enumerate(candidate_indexes):
        left_item = geometry[left_index]
        for right_index in candidate_indexes[offset + 1:]:
            right_item = geometry[right_index]
            center_distance = abs(left_item["center_x"] - right_item["center_x"])
            if center_distance > max(0.012, median_height * 1.2):
                continue
            vertical_gap = max(
                0.0,
                max(left_item["top"], right_item["top"])
                - min(left_item["bottom"], right_item["bottom"]),
            )
            if vertical_gap > median_height * 5.0:
                continue
            adjacency[left_index].add(right_index)
            adjacency[right_index].add(left_index)

    runs = []
    remaining = set(candidate_indexes)
    while remaining:
        seed = min(remaining)
        component = set()
        pending = [seed]
        while pending:
            current = pending.pop()
            if current in component:
                continue
            component.add(current)
            pending.extend(adjacency[current] - component)
        remaining.difference_update(component)

        left = min(geometry[index]["left"] for index in component)
        top = min(geometry[index]["top"] for index in component)
        right = max(geometry[index]["right"] for index in component)
        bottom = max(geometry[index]["bottom"] for index in component)
        run_width = max(1e-6, right - left)
        run_height = max(1e-6, bottom - top)
        has_tall_anchor = bool(component & tall_anchor_indexes)
        fragmented_vertical_run = (
            len(component) >= 3
            and run_height >= max(0.055, median_height * 4.0)
            and run_height / run_width >= 3.0
        )
        if not has_tall_anchor and not fragmented_vertical_run:
            continue
        if run_height / run_width < 2.5:
            continue

        # A vertical label inside the horizontal body band is content until a
        # layout-aware consumer proves otherwise. This preserves table labels.
        if right >= body_left and left <= body_right:
            continue

        connected_to_content = False
        for index, item in enumerate(geometry):
            if index in component:
                continue
            vertical_overlap = max(0.0, min(bottom, item["bottom"]) - max(top, item["top"]))
            if vertical_overlap / max(min(run_height, item["height"]), 1e-6) < 0.4:
                continue
            horizontal_overlap = max(0.0, min(right, item["right"]) - max(left, item["left"]))
            if horizontal_overlap / max(min(run_width, item["width"]), 1e-6) >= 0.6:
                # A narrow OCR fragment inside the same vertical band is part
                # of the rotated run, even when it was recognized as a digit.
                continue
            if item["right"] < left:
                horizontal_gap = left - item["right"]
            elif item["left"] > right:
                horizontal_gap = item["left"] - right
            else:
                horizontal_gap = 0.0
            if horizontal_gap <= max(0.035, median_height * 4.0):
                connected_to_content = True
                break
        if connected_to_content:
            continue

        runs.append(_RotatedTextRun(
            page_index=page_index,
            word_indexes=tuple(sorted(component)),
            center_x=(left + right) / 2.0,
            center_y=(top + bottom) / 2.0,
            width=run_width,
            height=run_height,
        ))
    return runs


def _repeated_rotated_decoration_word_indexes(
    pages: list[list[OcrWord]],
    page_sizes: list[tuple[float, float]] | None = None,
) -> set[tuple[int, int]]:
    """Find only repeated, detached 90-degree text used as page decoration."""

    runs = []
    for page_index, words in enumerate(pages):
        page_size = page_sizes[page_index] if page_sizes and page_index < len(page_sizes) else None
        runs.extend(_detached_rotated_text_runs(words, page_index, page_size))
    if len(runs) < 3:
        return set()

    def canonical_y(run: _RotatedTextRun, mirror_facing_page: bool) -> float:
        if mirror_facing_page and run.center_x >= 0.5:
            return 1.0 - run.center_y
        return run.center_y

    def compatible_with_group(
        run: _RotatedTextRun,
        group: list[_RotatedTextRun],
        mirror_facing_page: bool,
    ) -> bool:
        run_edge = min(run.center_x, 1.0 - run.center_x)
        run_y = canonical_y(run, mirror_facing_page)
        for member in group:
            member_edge = min(member.center_x, 1.0 - member.center_x)
            member_y = canonical_y(member, mirror_facing_page)
            height_ratio = run.height / max(member.height, 1e-6)
            if (
                abs(run_edge - member_edge) > 0.025
                or abs(run_y - member_y) > 0.05
                or abs(run.width - member.width) > 0.025
                or not 0.5 <= height_ratio <= 2.0
            ):
                return False
        return True

    # Facing pages either keep a side label at the same height or rotate its
    # layout by 180 degrees. Complete-link clusters prevent gradual positional
    # drift from chaining unrelated top and bottom margin labels together.
    groups: list[list[_RotatedTextRun]] = []
    for mirror_facing_page in (False, True):
        mode_groups: list[list[_RotatedTextRun]] = []
        ordered_runs = sorted(
            runs,
            key=lambda run: (
                canonical_y(run, mirror_facing_page),
                min(run.center_x, 1.0 - run.center_x),
                run.page_index,
            ),
        )
        for run in ordered_runs:
            compatible_groups = [
                group
                for group in mode_groups
                if compatible_with_group(run, group, mirror_facing_page)
            ]
            if compatible_groups:
                max(compatible_groups, key=len).append(run)
            else:
                mode_groups.append([run])
        groups.extend(mode_groups)

    excluded: set[tuple[int, int]] = set()
    for group in groups:
        page_numbers = sorted({run.page_index for run in group})
        if len(page_numbers) < 3:
            continue
        span = page_numbers[-1] - page_numbers[0] + 1
        density = len(page_numbers) / max(span, 1)
        maximum_gap = max(
            (right - left for left, right in zip(page_numbers, page_numbers[1:])),
            default=0,
        )
        if density < 0.5 and not (len(page_numbers) >= 5 and maximum_gap <= 6):
            continue
        for run in group:
            excluded.update((run.page_index, word_index) for word_index in run.word_indexes)
    return excluded


def mark_indexed_pdf_analysis_roles(indexed_pages: list[dict]) -> list[dict]:
    """Return a deep-enough copy with non-destructive structural-analysis roles."""

    copied_pages = []
    ocr_pages = []
    for source_page in indexed_pages:
        copied_words = [
            dict(word)
            for word in source_page.get("words", [])
            if isinstance(word, Mapping)
        ]
        copied_page = dict(source_page)
        copied_page["words"] = copied_words
        copied_pages.append(copied_page)
        ocr_pages.append([
            OcrWord(
                str(word.get("text", "") or ""),
                float(word.get("left", 0) or 0),
                float(word.get("top", 0) or 0),
                float(word.get("right", 0) or 0),
                float(word.get("bottom", 0) or 0),
                float(word.get("confidence", 0) or 0),
            )
            for word in copied_words
        ])
    excluded = _repeated_rotated_decoration_word_indexes(
        ocr_pages,
        [(1.0, 1.0) for _page in ocr_pages],
    )
    for page_index, page in enumerate(copied_pages):
        for word_index, word in enumerate(page["words"]):
            if word.get("analysis_role") == OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION:
                word.pop("analysis_role", None)
            if (page_index, word_index) in excluded:
                word["analysis_role"] = OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION
    return copied_pages


def _pages_for_structural_analysis(
    pages: list[list[OcrWord]],
    page_sizes: list[tuple[float, float]] | None = None,
) -> list[list[OcrWord]]:
    excluded = _repeated_rotated_decoration_word_indexes(pages, page_sizes)
    return [
        [word for word_index, word in enumerate(words) if (page_index, word_index) not in excluded]
        for page_index, words in enumerate(pages)
    ]

