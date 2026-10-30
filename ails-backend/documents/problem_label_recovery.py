from __future__ import annotations

import re
from statistics import median
from typing import Any, Mapping

from documents.problem_number_ocr import classify_pdf_regions
from documents.problem_number_rules import is_page_furniture, is_number_column

from documents.problem_detection import (
    MAX_PROBLEM_NUMBER_GAP,
    _MISSING_NUMBER_EXCLUDED_LINE_PATTERN,
    _OCR_JOINED_DECIMAL_PROBLEM_PATTERN,
    _PROBLEM_GROUP_RANGE_PATTERN,
    _RUNNING_PAGE_HEADER_PATTERN,
    _left_problem_column_boundary,
    _line_text_left_of,
    _problem_match_in_line,
    _shared_group_prefix,
)

def _extract_problem_text(
    section_candidates: list[dict],
    index: int,
    pages_by_number: dict[int, dict],
) -> tuple[str, int, int]:
    current = section_candidates[index]
    following = section_candidates[index + 1] if index + 1 < len(section_candidates) else None
    end_page = int(following["page"]) if following else int(current["section_end_page"])
    shared_prefix, first_content_page = _shared_group_prefix(
        section_candidates, current, pages_by_number,
    )
    chunks: list[str] = [shared_prefix] if shared_prefix else []
    last_content_page = int(current["page"])
    reached_group_boundary = False
    for page_number in range(int(current["page"]), end_page + 1):
        page = pages_by_number.get(page_number)
        if not page:
            continue
        start_line = int(current["line_index"]) if page_number == int(current["page"]) else 0
        if following and page_number == int(following["page"]):
            end_line = int(following["line_index"])
        elif not following and page_number == int(current["section_end_page"]):
            boundary_top = float(current.get("section_end_top", 2.0))
            end_line = next(
                (line_index for line_index, line in enumerate(page["lines"]) if float(line.get("top", 0)) >= boundary_top),
                len(page["lines"]),
            )
        else:
            end_line = len(page["lines"])
        selected_lines = [
            line
            for line in page["lines"][start_line:end_line]
            if not is_page_furniture(line) and not (
                float(line.get("top", 0)) <= 0.09
                and len(str(line.get("text", "") or "").strip()) <= 140
                and _RUNNING_PAGE_HEADER_PATTERN.search(str(line.get("text", "") or ""))
            )
        ]
        label_left = float((current.get("label_bbox") or {}).get("left", 0) or 0)
        left_column_boundary = _left_problem_column_boundary(selected_lines, label_left)
        selected_text = []
        for line in selected_lines:
            line_text = str(line.get("text", ""))
            group_boundary = _PROBLEM_GROUP_RANGE_PATTERN.match(line_text)
            if (
                group_boundary
                and int(group_boundary.group("start")) == int(current["number"]) + 1
            ):
                reached_group_boundary = True
                break
            if left_column_boundary is not None:
                line_text = _line_text_left_of(line, left_column_boundary)
                if not line_text:
                    continue
            if current.get("detached_prefix"):
                words = sorted(
                    [
                        dict(word)
                        for word in line.get("words") or []
                        if isinstance(word, Mapping)
                    ],
                    key=lambda word: float(word.get("left", 0)),
                )
                content_threshold = max(0.22, label_left - 0.02)
                content_words = [
                    word
                    for word in words
                    if float(word.get("left", 0)) >= content_threshold
                ]
                margin_words = [
                    word
                    for word in words
                    if float(word.get("left", 0)) < content_threshold
                ]
                if (
                    content_words
                    and margin_words
                    and max(float(word.get("right", 0)) for word in margin_words)
                    + 0.012
                    <= min(float(word.get("left", 0)) for word in content_words)
                ):
                    line_text = " ".join(
                        str(word.get("text", "") or "").strip()
                        for word in content_words
                    ).strip()
            selected_text.append(line_text)
        if (
            page_number == int(current["page"])
            and (current.get("detached_prefix") or current.get("joined_numeric_body"))
            and current.get("matched_line_text")
            and selected_text
        ):
            selected_text[0] = str(current["matched_line_text"])
        if page_number == int(current["page"]) and selected_text:
            first_text = selected_text[0].lstrip()
            if current.get("strip_ambiguous_number_prefix"):
                first_text = re.sub(r"^\d{1,3}\.", "", first_text, count=1).lstrip()
            else:
                first_text = re.sub(
                    rf"^0*{int(current['number'])}\s*(?:[.)]\s*)?",
                    "",
                    first_text,
                    count=1,
                ).lstrip()
            selected_text[0] = f"{int(current['number'])}. {first_text}"
        if any(
            re.fullmatch(r"[*#@%]+", text.strip())
            for text in selected_text
        ):
            selected_text = [
                text
                for text in selected_text
                if not re.fullmatch(r"[*#@%]+", text.strip())
            ] + [
                text
                for text in selected_text
                if re.fullmatch(r"[*#@%]+", text.strip())
            ]
        text = "\n".join(selected_text).strip()
        if text:
            chunks.append(text)
            last_content_page = page_number
        if reached_group_boundary:
            break
    return "\n\n".join(chunks).strip()[:60_000], first_content_page, last_content_page


def _problem_label_geometry(candidate: Mapping[str, Any]) -> tuple[float, float]:
    box = candidate.get("label_bbox") or {}
    left = float(box.get("left", candidate.get("left", 0)) or 0)
    height = max(
        0.001,
        float(box.get("bottom", 0) or 0) - float(box.get("top", 0) or 0),
    )
    return left, height


def _same_problem_number_column(
    candidate: Mapping[str, Any],
    seed: Mapping[str, Any],
    *,
    minimum_left_tolerance: float = 0.0,
    reference_height: float | None = None,
) -> bool:
    """Keep exercise labels in the seed label's visual column and font band."""

    candidate_left, candidate_height = _problem_label_geometry(candidate)
    seed_left, seed_height = _problem_label_geometry(seed)
    left_tolerance = max(
        minimum_left_tolerance,
        0.016,
        min(0.045, seed_height * 1.15),
    )
    height_ratio = candidate_height / max(0.001, reference_height or seed_height)
    return abs(candidate_left - seed_left) <= left_tolerance and 0.55 <= height_ratio <= 1.8


def _problem_sequence(candidates: list[dict], seed: Mapping[str, Any]) -> list[dict]:
    """Select top-level problem labels while allowing a later real duplicate.

    Numbered requirements inside a problem are usually indented from the exercise
    number column. If OCR/layout ambiguity admits one anyway, a later occurrence of
    the same number in the canonical column replaces it and truncates the nested run.
    """

    sequence: list[dict] = []
    number_indexes: dict[int, int] = {}
    started = False
    last_number = 0
    page_anchors = {int(seed["page"]): seed}
    accepted_heights: list[float] = []
    for candidate_index, candidate in enumerate(candidates):
        number = int(candidate["number"])
        if not started:
            if candidate is not seed:
                continue
            started = True
        if candidate is not seed:
            candidate_page = int(candidate["page"])
            page_anchor = page_anchors.get(candidate_page)
            if page_anchor is None:
                if number <= last_number or (last_number and number > last_number + MAX_PROBLEM_NUMBER_GAP):
                    continue
                reference_height = median(accepted_heights) if accepted_heights else None
                matches_nearby_column = _same_problem_number_column(
                    candidate,
                    seed,
                    minimum_left_tolerance=0.06,
                    reference_height=reference_height,
                )
                candidate_left, _candidate_height = _problem_label_geometry(candidate)
                seed_left, _seed_height = _problem_label_geometry(seed)
                matches_alternating_book_column = (
                    number == last_number + 1
                    and (
                        (candidate_left <= 0.12 and seed_left >= 0.18)
                        or (candidate_left >= 0.18 and seed_left <= 0.12)
                    )
                    and _same_problem_number_column(
                        candidate,
                        seed,
                        minimum_left_tolerance=0.3,
                        reference_height=reference_height,
                    )
                )
                if not matches_nearby_column and not matches_alternating_book_column:
                    matches_page_run = (
                        number == last_number + 1
                        and float(candidate.get("top", 1)) <= 0.25
                        and _same_problem_number_column(
                            candidate,
                            seed,
                            minimum_left_tolerance=0.3,
                            reference_height=reference_height,
                        )
                    )
                    run_length = 1
                    expected_number = number
                    if matches_page_run:
                        for following in candidates[candidate_index + 1:]:
                            if int(following["page"]) != candidate_page:
                                break
                            if not _same_problem_number_column(following, candidate):
                                continue
                            following_number = int(following["number"])
                            if following_number == expected_number + 1:
                                run_length += 1
                                expected_number = following_number
                            elif following_number > expected_number:
                                break
                    minimum_run_length = 3 if last_number >= 4 else 4
                    if not matches_page_run or run_length < minimum_run_length:
                        continue
                page_anchors[candidate_page] = candidate
            elif not _same_problem_number_column(candidate, page_anchor):
                continue

        duplicate_index = number_indexes.get(number)
        if duplicate_index is not None:
            existing_left, _existing_height = _problem_label_geometry(sequence[duplicate_index])
            candidate_left, _candidate_height = _problem_label_geometry(candidate)
            seed_left, _seed_height = _problem_label_geometry(seed)
            if (
                abs(candidate_left - seed_left) + 0.004
                >= abs(existing_left - seed_left)
            ):
                continue
            # The earlier same-number label was part of the preceding problem's
            # numbered body. Resume from the later label in the real number column.
            sequence = sequence[:duplicate_index]
            number_indexes = {int(item["number"]): index for index, item in enumerate(sequence)}
            last_number = int(sequence[-1]["number"]) if sequence else 0
            page_anchors = {int(seed["page"]): seed}
            accepted_heights = []
            for item in sequence:
                page_anchors.setdefault(int(item["page"]), item)
                accepted_heights.append(_problem_label_geometry(item)[1])
        elif number <= last_number:
            continue

        if last_number and number > last_number + MAX_PROBLEM_NUMBER_GAP:
            continue
        sequence.append(candidate)
        number_indexes[number] = len(sequence) - 1
        last_number = number
        accepted_heights.append(_problem_label_geometry(candidate)[1])
    return sequence


def _recover_missing_problem_labels(
    sequence: list[dict],
    pages_by_number: Mapping[int, Mapping[str, Any]],
    header: Mapping[str, Any],
    all_candidates: list[dict] | None = None,
    *,
    pdf_path: str | None = None,
    model_variant: str | None = None,
) -> list[dict]:
    """Recover a faint number only from a matching numbered-problem layout."""

    if not sequence:
        return []

    candidate_pool = all_candidates or sequence
    page_label_lefts: dict[int, list[float]] = {}
    accepted_heights = []
    for candidate in candidate_pool:
        left, height = _problem_label_geometry(candidate)
        if left <= 0.095 or left >= 0.22:
            page_label_lefts.setdefault(int(candidate["page"]), []).append(left)
    for candidate in sequence:
        _left, height = _problem_label_geometry(candidate)
        accepted_heights.append(height)
    reference_height = median(accepted_heights)

    segments: list[tuple[tuple[int, int], tuple[int, int], int, int]] = []
    first = sequence[0]
    first_number = int(first["number"])
    if 1 < first_number <= 4:
        segments.append((
            (int(header["page"]), int(header["line_index"])),
            (int(first["page"]), int(first["line_index"])),
            1,
            first_number - 1,
        ))
    for current, following in zip(sequence, sequence[1:]):
        missing_count = int(following["number"]) - int(current["number"]) - 1
        if 1 <= missing_count <= MAX_PROBLEM_NUMBER_GAP - 1:
            segments.append((
                (int(current["page"]), int(current["line_index"])),
                (int(following["page"]), int(following["line_index"])),
                int(current["number"]) + 1,
                missing_count,
            ))

    # A missing label can also truncate the accepted sequence. Recover that
    # tail only when the raw candidates resume with a consecutive run in a
    # canonical book column, as on a following right-hand page.
    last = sequence[-1]
    last_position = (int(last["page"]), int(last["line_index"]))
    last_number = int(last["number"])
    for candidate_index, candidate in enumerate(candidate_pool):
        candidate_position = (
            int(candidate["page"]),
            int(candidate["line_index"]),
        )
        candidate_number = int(candidate["number"])
        missing_count = candidate_number - last_number - 1
        candidate_left, _candidate_height = _problem_label_geometry(candidate)
        if (
            candidate_position <= last_position
            or not 1 <= missing_count <= MAX_PROBLEM_NUMBER_GAP - 1
            or not (candidate_left <= 0.095 or candidate_left >= 0.22)
        ):
            continue
        run_length = 1
        expected_number = candidate_number
        for following in candidate_pool[candidate_index + 1:]:
            following_number = int(following["number"])
            if not _same_problem_number_column(following, candidate):
                continue
            if following_number == expected_number + 1:
                run_length += 1
                expected_number = following_number
            elif following_number > expected_number:
                break
        if run_length < 2:
            continue
        segments.append((
            last_position,
            candidate_position,
            last_number + 1,
            missing_count,
        ))
        break

    recovered: list[dict] = []
    used_locations: set[tuple[int, int]] = set()
    for start, end, first_missing_number, missing_count in segments:
        expected_numbers = list(
            range(first_missing_number, first_missing_number + missing_count)
        )
        existing_expected_candidates = [
            candidate
            for candidate in candidate_pool
            if start
            < (int(candidate["page"]), int(candidate["line_index"]))
            < end
            and int(candidate["number"]) in expected_numbers
            and (
                _problem_label_geometry(candidate)[0] <= 0.095
                or _problem_label_geometry(candidate)[0] >= 0.22
            )
        ]
        existing_numbers = {
            int(candidate["number"]) for candidate in existing_expected_candidates
        }
        numbers_to_recover = [
            number for number in expected_numbers if number not in existing_numbers
        ]
        if not numbers_to_recover:
            continue
        search_start = start
        search_end = end
        lower_candidates = [
            candidate
            for candidate in existing_expected_candidates
            if int(candidate["number"]) < min(numbers_to_recover)
        ]
        upper_candidates = [
            candidate
            for candidate in existing_expected_candidates
            if int(candidate["number"]) > max(numbers_to_recover)
        ]
        if lower_candidates:
            lower = max(lower_candidates, key=lambda item: int(item["number"]))
            search_start = (int(lower["page"]), int(lower["line_index"]))
        if upper_candidates:
            upper = min(upper_candidates, key=lambda item: int(item["number"]))
            search_end = (int(upper["page"]), int(upper["line_index"]))
        plausible = []
        for page_number in range(search_start[0], search_end[0] + 1):
            label_left_values = page_label_lefts.get(page_number)
            page = pages_by_number.get(page_number)
            if not label_left_values or not page:
                continue
            label_left = median(label_left_values)
            lines = list(page.get("lines") or [])
            start_line = search_start[1] + 1 if page_number == search_start[0] else 0
            end_line = search_end[1] if page_number == search_end[0] else len(lines)
            for line_index in range(start_line, end_line):
                line = lines[line_index]
                text = str(line.get("text", "") or "").strip()
                if (
                    len(text) < 15
                    or not 0.09 < float(line.get("top", 0)) < 0.92
                    or _MISSING_NUMBER_EXCLUDED_LINE_PATTERN.match(text)
                ):
                    continue
                problem_match, _problem_line = _problem_match_in_line(line)
                if problem_match:
                    continue
                ambiguous_number_match = _OCR_JOINED_DECIMAL_PROBLEM_PATTERN.match(text)
                ambiguous_number = (
                    int(ambiguous_number_match.group("number"))
                    if ambiguous_number_match
                    else None
                )
                if (
                    ambiguous_number is not None
                    and ambiguous_number not in numbers_to_recover
                ):
                    continue
                box = line.get("bbox") or {}
                line_height = max(
                    0.001,
                    float(box.get("bottom", 0)) - float(box.get("top", 0)),
                )
                if not 0.5 <= line_height / max(0.001, reference_height) <= 2.0:
                    continue
                previous_bottom = (
                    float((lines[line_index - 1].get("bbox") or {}).get(
                        "bottom",
                        lines[line_index - 1].get("top", 0),
                    ))
                    if line_index
                    else 0.0
                )
                vertical_gap = float(line.get("top", 0)) - previous_bottom
                if vertical_gap < (0.012 if ambiguous_number is not None else 0.02):
                    continue
                if ambiguous_number is not None:
                    aligned_words = [
                        word
                        for word in line.get("words") or []
                        if abs(float(word.get("left", 0)) - label_left) <= 0.02
                    ]
                else:
                    aligned_words = [
                        word
                        for word in line.get("words") or []
                        if label_left + 0.018
                        <= float(word.get("left", 0))
                        <= label_left + 0.075
                    ]
                if not aligned_words:
                    continue
                content_left = min(float(word.get("left", 0)) for word in aligned_words)
                plausible.append({
                    "page": page_number,
                    "top": float(line.get("top", 0)),
                    "line_index": line_index,
                    "label_left": label_left,
                    "content_left": content_left,
                    "bottom": float(box.get("bottom", float(line.get("top", 0)) + line_height)),
                    "ambiguous_number": ambiguous_number,
                })

        plausible.sort(key=lambda item: (int(item["page"]), float(item["top"])))
        plausible = [
            item
            for item in plausible
            if (int(item["page"]), int(item["line_index"])) not in used_locations
        ]
        if pdf_path and plausible:
            try:
                from documents.problem_number_ocr import classify_pdf_regions

                visual_regions = []
                for item in plausible:
                    label_left = float(item["label_left"])
                    visual_regions.append({
                        "page": int(item["page"]),
                        "bbox": {
                            "left": max(0.0, label_left),
                            "top": max(0.0, float(item["top"])),
                            "right": 1.0,
                            "bottom": min(1.0, float(item["bottom"])),
                            "_problem_number_digits": 2,
                        },
                    })
                visual_results = classify_pdf_regions(
                    pdf_path,
                    visual_regions,
                    model_variant=model_variant,
                )
                for item, visual_result in zip(plausible, visual_results):
                    item["visual_number_available"] = bool(
                        visual_result.get("available")
                    )
                    item["visual_number"] = visual_result.get("number")
                    item["visual_predicted_class"] = visual_result.get(
                        "predicted_class"
                    )
                    item["visual_number_confidence"] = float(
                        visual_result.get("confidence", 0) or 0
                    )
                    item["visual_number_margin"] = float(
                        visual_result.get("margin", 0) or 0
                    )
            # This model is a recall-only fallback. A missing runtime asset,
            # unreadable scan, or inference failure must preserve the existing
            # structural recovery behavior instead of aborting problem loading.
            except Exception:
                pass
        explicit = [
            item for item in plausible if item["ambiguous_number"] is not None
        ]
        explicit_numbers = [int(item["ambiguous_number"]) for item in explicit]
        if (
            len(explicit_numbers) != len(set(explicit_numbers))
            or any(number not in numbers_to_recover for number in explicit_numbers)
        ):
            continue
        remaining_numbers = [
            number for number in numbers_to_recover if number not in explicit_numbers
        ]
        visual_by_number = {}
        for item in plausible:
            if item["ambiguous_number"] is not None:
                continue
            visual_number = item.get("visual_number")
            if visual_number not in remaining_numbers:
                continue
            existing = visual_by_number.get(int(visual_number))
            if (
                existing is None
                or float(item.get("visual_number_confidence", 0))
                > float(existing.get("visual_number_confidence", 0))
            ):
                visual_by_number[int(visual_number)] = item
        explicit_by_number = {
            int(item["ambiguous_number"]): item
            for item in explicit
        }

        def ordered_assignments(selected_visual):
            visually_assigned_locations = {
                (int(item["page"]), int(item["line_index"]))
                for item in selected_visual.values()
            }
            unassigned_numbers = [
                number
                for number in remaining_numbers
                if number not in selected_visual
            ]
            structural = (
                [
                    item
                    for item in plausible
                    if item["ambiguous_number"] is None
                    and (
                        int(item["page"]),
                        int(item["line_index"]),
                    ) not in visually_assigned_locations
                ]
                if unassigned_numbers
                else []
            )
            if len(structural) != len(unassigned_numbers):
                return None
            structural_items = iter(structural)
            candidate_assignments = [
                (
                    number,
                    explicit_by_number.get(number)
                    or selected_visual.get(number)
                    or next(structural_items),
                )
                for number in numbers_to_recover
            ]
            locations = [
                (int(item["page"]), int(item["line_index"]))
                for _number, item in candidate_assignments
            ]
            return (
                candidate_assignments
                if locations == sorted(locations)
                else None
            )

        assignments = ordered_assignments(visual_by_number)
        if assignments is None and visual_by_number:
            # A false-positive visual prediction must not make an otherwise
            # exact structural recovery fail. Use visual evidence only when
            # it forms a complete one-to-one monotonic mapping.
            assignments = ordered_assignments({})
        if assignments is None:
            continue
        for number, item in assignments:
            location = (int(item["page"]), int(item["line_index"]))
            used_locations.add(location)
            recovered.append({
                "page": int(item["page"]),
                "top": float(item["top"]),
                "line_index": int(item["line_index"]),
                "number": number,
                "label_bbox": {
                    "left": max(0.0, float(item["label_left"])),
                    "top": max(0.0, float(item["top"])),
                    "right": min(
                        1.0,
                        max(float(item["label_left"]) + 0.015, float(item["content_left"]) - 0.004),
                    ),
                    "bottom": min(1.0, float(item["bottom"])),
                },
                "detached_prefix": float(item["label_left"]) >= 0.22,
                "number_recovered": True,
                "strip_ambiguous_number_prefix": item["ambiguous_number"] is not None,
            })

    return recovered


def _problem_seed(candidates: list[dict], header: Mapping[str, Any]) -> dict | None:
    header_page = int(header["page"])
    if not bool(header.get("is_heading")):
        return None
    preferred = next(
        (
            item
            for item in candidates
            if int(item["number"]) in {1, 2}
            and int(item["page"]) in {header_page, header_page + 1}
        ),
        None,
    )
    if preferred:
        return preferred

    # OCR occasionally drops the first one or two exercise labels. Recover only
    # from a real section-title line, and only when the first recognized label
    # is still a low number very close to that heading. The selected label then
    # establishes the unchanged column/font guard used by _problem_sequence.
    nearby = [
        item
        for item in candidates
        if header_page <= int(item["page"]) <= header_page + 2
    ]
    if not nearby:
        return None
    first = nearby[0]
    return first if 1 <= int(first["number"]) <= 4 else None


def _joined_numeric_body_candidates(candidates: list[dict]) -> list[dict]:
    """Split a detached OCR token such as ``62차원`` into label 6 + ``2차원``.

    All possible numeric-prefix splits are retained as alternatives. The normal
    section sequence then accepts only the one consecutive with surrounding
    problem labels, so a real problem 62 remains 62 after problem 61.
    """

    alternatives: list[dict] = []
    for candidate in candidates:
        if not candidate.get("detached_prefix") and not is_number_column(_problem_label_geometry(candidate)[0]):
            continue
        text = str(
            candidate.get("matched_line_text")
            or candidate.get("source_text")
            or ""
        ).strip()
        match = re.match(r"^(?P<digits>[1-9]\d{1,5})(?=[A-Za-z가-힣#])", text)
        if not match:
            continue
        digits = match.group("digits")
        if int(digits) != int(candidate.get("number", 0) or 0):
            continue
        for split_at in range(1, len(digits)):
            number = int(digits[:split_at])
            if not 1 <= number <= 30:
                continue
            if not candidate.get("detached_prefix"):
                position = (int(candidate["page"]), float(candidate["top"]))
                before = [item for item in candidates if (int(item["page"]), float(item["top"])) < position]
                after = [item for item in candidates if position < (int(item["page"]), float(item["top"]))
                         and int(item["page"]) <= int(candidate["page"]) + 1]
                if not before or int(before[-1]["number"]) != number - 1 or not any(int(item["number"]) == number + 1 for item in after):
                    continue
            repaired = dict(candidate)
            repaired["number"] = number
            repaired["matched_line_text"] = (
                f"{number}. {digits[split_at:]}{text[len(digits):]}"
            )
            repaired["number_recovered"] = True
            repaired["joined_numeric_body"] = True
            label_box = dict(candidate.get("label_bbox") or {})
            if label_box:
                left = float(label_box.get("left", 0) or 0)
                right = float(label_box.get("right", left) or left)
                label_box["right"] = left + (right - left) * split_at / len(digits)
                repaired["label_bbox"] = label_box
            alternatives.append(repaired)
    return alternatives


