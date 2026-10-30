from __future__ import annotations

import hashlib
import json
import math
import os
import re
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Mapping, Sequence
from documents import practice_rounds

from code_services.code_grading import (
    build_grading_state_patch,
    normalize_grading_attempt_id,
    normalize_grading_revision,
)
from code_services.code_executor import CODE_PROJECT_MARKER
from pdf.pdf_ocr import (
    OCR_ANALYSIS_ROLE_REPEATED_ROTATED_DECORATION,
    indexed_pdf_pages,
    mark_indexed_pdf_analysis_roles,
    pdf_ocr_status,
)
import pdf.pdf_structure as pdf_structure
from documents.problem_answering import (
    ANSWER_TYPE_CODE,
    ANSWER_TYPE_MULTIPLE_CHOICE,
    ANSWER_TYPE_SHORT_ANSWER,
    ANSWER_TYPE_OX,
    ANSWER_TYPE_UNKNOWN,
    CLASSIFIER_VERSION,
    MAX_ANSWER_CHARS,
    MAX_CHOICES,
    MAX_PROBLEM_CHARS,
    classify_problem_answer_type,
    normalize_answer_type,
    normalize_draft_answer,
)


PROBLEM_STATE_FILE = ".ails-problem.json"
HIDDEN_PROBLEM_DIR = ".ails-problems"
CATALOG_VERSION = 25
# Version 14 introduced the descriptor and state contract still used here.
# Later catalog revisions invalidate detector output without changing that
# contract, so they remain safe to show until fresh analysis replaces them.
OLDEST_DISPLAYABLE_CATALOG_VERSION = 14
STATE_VERSION = 5
MAX_CHAPTER_NUMBER = 30
MAX_PROBLEM_NUMBER_GAP = 6
MAX_HINT_CHARS = 4_000
MAX_PROBLEM_CODE_BLOCKS = 16
VALID_STATUSES = {"not_started", "in_progress", "completed", "retry"}
STATE_PROGRESS_KEYS = (
    "status",
    "elapsed_seconds",
    "timer_started_at",
    "last_attempt_at",
    "wrong_count",
    "ai_hint_used",
    "ai_hint",
    "last_grading",
    "core_concepts",
    "search_keywords",
    "related_theory",
    "mistake_notes",
    "retry_due_at",
    "grading_revision",
    "pending_grading",
    "last_applied_grading_attempt_id",
    "last_applied_grading_revision",
    "answer_type_override",
    "draft_answer",
    "solve_round_number", "solve_history", "solve_submission", "solve_workspace_path", "solve_current_snapshot",
)
STATUS_LABELS = {
    "not_started": "미시작",
    "in_progress": "진행 중",
    "completed": "✓ 완료",
    "retry": "★ 다시 풀기",
}
KIND_FOLDERS = {
    "practice": "연습 문제",
    "lab": "실습 문제",
    "quiz": "퀴즈",
}

_state_locks_guard = threading.Lock()
_state_locks: dict[str, threading.RLock] = {}


from documents.problem_detection import (
    KIND_FOLDERS,
    MAX_CHAPTER_NUMBER,
    MAX_PROBLEM_NUMBER_GAP,
    _SECTION_PATTERN,
    _SECTION_HEADING_PATTERN,
    _PRACTICE_SECTION_TITLE_PATTERN,
    _LAB_SECTION_TITLE_PATTERN,
    _QUIZ_SECTION_TITLE_PATTERN,
    _PROBLEM_PROMPT_PATTERN,
    _PROBLEM_PATTERNS,
    _PROBLEM_GROUP_RANGE_PATTERN,
    _OCR_JOINED_PROBLEM_PATTERN,
    _OCR_JOINED_DECIMAL_PROBLEM_PATTERN,
    _OCR_SPACED_PROBLEM_PATTERN,
    _OCR_SPACED_NUMERIC_BODY_PATTERN,
    _OUTLINE_SECTION_PATTERN,
    _BODY_SECTION_HEADING_PATTERN,
    _KOREAN_CHAPTER_PATTERN,
    _ENGLISH_CHAPTER_PATTERN,
    _TRAILING_CHAPTER_DECORATION,
    _TRAILING_OCR_CHAPTER_FRAGMENT,
    _TOC_PAGE_PATTERN,
    _TOC_NUMBERED_LINE_PATTERN,
    _ANSWER_KEY_HEADING_PATTERN,
    _RUNNING_PAGE_HEADER_PATTERN,
    _MISSING_NUMBER_EXCLUDED_LINE_PATTERN,
    _canonical_chapter_title,
    _chapter_number,
    _word_lines,
    _reading_order_lines,
    _check_time_headers_and_clean_lines,
    _visual_check_time_labels,
    _prefix_bbox,
    _problem_match,
    _normalized_problem_section_title,
    _named_problem_section_kind,
    _candidate_problem_prompt,
    _looks_like_problem_prompt,
    _problem_candidate_key,
    _problem_match_in_line,
    _toc_page_numbers,
    _chapter_markers,
    _chapter_for,
    _is_body_section_heading,
    classify_code_problem,
    _starter_file,
    _shared_group_prefix,
    _left_problem_column_boundary,
    _line_text_left_of,
    problem_review_ocr_context,
    _extract_problem_text,
    _problem_label_geometry,
    _same_problem_number_column,
    _problem_sequence,
    _recover_missing_problem_labels,
    _problem_seed,
    _joined_numeric_body_candidates,
    _detect_pdf_problems_once,
)
import documents.problem_detection as problem_detection


from documents.problem_detection import detect_pdf_problems

_INVALID_PATH_CHARS = re.compile(r"[<>:\"/\\|?*\x00-\x1f]")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_time(value: datetime | None = None) -> str:
    current = value or _utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_time(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _safe_base_dir(base_dir: str) -> str:
    value = str(base_dir or "").strip()
    if not value:
        raise ValueError("base_dir is required.")
    normalized = os.path.abspath(os.path.expanduser(value))
    os.makedirs(normalized, exist_ok=True)
    return normalized


def _safe_relative_path(value: str) -> str:
    normalized = str(value or "").replace("\\", "/").strip().strip("/")
    parts = [part for part in normalized.split("/") if part not in {"", ".", ".."}]
    if not parts or len(parts) != len(normalized.split("/")):
        raise ValueError("Invalid problem folder path.")
    return "/".join(parts)


def _inside_base(base_dir: str, relative_path: str) -> str:
    base = _safe_base_dir(base_dir)
    relative = _safe_relative_path(relative_path)
    target = os.path.abspath(os.path.join(base, *relative.split("/")))
    if os.path.normcase(os.path.commonpath([base, target])) != os.path.normcase(base):
        raise ValueError("Problem path must stay inside base_dir.")
    return target


def _sanitize_folder_name(value: str, fallback: str) -> str:
    name = _INVALID_PATH_CHARS.sub(" ", str(value or ""))
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = fallback
    if name.upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}:
        name = f"{name}_"
    return name[:96].rstrip(" .") or fallback



def _pdf_fingerprint(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _catalog_matches_pdf(catalog: Mapping[str, Any], pdf_path: str) -> bool:
    stored_fingerprint = str(catalog.get("pdf_fingerprint", "") or "")
    if not stored_fingerprint or not os.path.isfile(pdf_path):
        return False
    stat = os.stat(pdf_path)
    try:
        if int(catalog.get("pdf_size")) == stat.st_size and int(catalog.get("pdf_mtime_ns")) == stat.st_mtime_ns:
            return True
    except (TypeError, ValueError):
        pass
    return _pdf_fingerprint(pdf_path) == stored_fingerprint


def _catalog_path(base_dir: str, pdf_path: str) -> str:
    key = hashlib.sha256(os.path.normcase(os.path.abspath(pdf_path)).encode("utf-8", errors="replace")).hexdigest()[:32]
    return os.path.join(_safe_base_dir(base_dir), HIDDEN_PROBLEM_DIR, f"{key}.json")


def _path_lock(path: str) -> threading.RLock:
    key = os.path.normcase(os.path.abspath(path))
    with _state_locks_guard:
        return _state_locks.setdefault(key, threading.RLock())


def _read_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}


def _atomic_write_json(path: str, value: Mapping[str, Any], *, compact: bool = False):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{os.path.basename(path)}-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            if compact:
                handle.write(json.dumps(dict(value), ensure_ascii=False, separators=(",", ":")))
            else:
                json.dump(dict(value), handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        for attempt in range(12):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                if attempt >= 11:
                    raise
                time.sleep(min(0.75, 0.05 * (attempt + 1)))
    finally:
        try:
            os.remove(temporary)
        except OSError:
            pass




def _normalized_problem_code_blocks(value: Any, *, strict: bool = False) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        if strict:
            raise ValueError("code must be an array of code-box strings.")
        return []
    blocks = []
    for item in value:
        block = str(item or "")
        if not block.strip():
            continue
        if len(block) > MAX_PROBLEM_CHARS:
            if strict:
                raise ValueError(
                    f"Each problem code box must be {MAX_PROBLEM_CHARS:,} characters or less."
                )
            block = block[:MAX_PROBLEM_CHARS]
        blocks.append(block)
        if len(blocks) > MAX_PROBLEM_CODE_BLOCKS:
            if strict:
                raise ValueError(
                    f"A problem may contain at most {MAX_PROBLEM_CODE_BLOCKS} code boxes."
                )
            return blocks[:MAX_PROBLEM_CODE_BLOCKS]
    return blocks


def _normalized_problem_code_positions(
    value: Any,
    problem_text: Any,
    code: Sequence[str],
    *,
    strict: bool = False,
) -> list[int]:
    if value is None:
        return [len(str(problem_text or ""))] * len(code)
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        if strict:
            raise ValueError("code_positions must be an array of character offsets.")
        return [len(str(problem_text or ""))] * len(code)
    try:
        positions = [max(0, min(len(str(problem_text or "")), int(item))) for item in value]
    except (TypeError, ValueError, OverflowError):
        if strict:
            raise ValueError("code_positions contains an invalid offset.")
        return [len(str(problem_text or ""))] * len(code)
    if len(positions) != len(code):
        if strict:
            raise ValueError("code_positions must have one offset per code box.")
        return [len(str(problem_text or ""))] * len(code)
    return positions


def _default_state(problem: Mapping[str, Any], now: datetime | None = None) -> dict:
    return {
        "schema_version": STATE_VERSION,
        **{key: problem.get(key) for key in (
            "id", "pdf_fingerprint", "chapter", "chapter_folder", "kind", "kind_label", "number",
            "folder_name",
            "page", "page_end", "label_bbox", "problem_text", "is_code_problem", "classification_reason",
            "answer_type_prediction", "choices", "code", "code_positions", "workspace_path",
            "folder_path", "project_name", "state_relative_path", "starter_file",
            "problem_edit", "paddleocr_original",
        )},
        "status": "not_started",
        "elapsed_seconds": 0,
        "timer_started_at": None,
        "last_attempt_at": None,
        "wrong_count": 0,
        "ai_hint_used": False,
        "ai_hint": None,
        "last_grading": None,
        "grading_revision": 0,
        "pending_grading": None,
        "last_applied_grading_attempt_id": None,
        "last_applied_grading_revision": 0,
        "answer_type_override": None,
        "draft_answer": {
            "answer_text": "",
            "selected_choice": None,
            "updated_at": None,
        },
        "core_concepts": [],
        "search_keywords": [],
        "related_theory": [],
        "mistake_notes": [],
        "retry_due_at": None,
        "updated_at": _iso_time(now),
    }


def _normalized_answer_type_prediction(problem: Mapping[str, Any]) -> dict[str, Any]:
    raw_prediction = problem.get("answer_type_prediction")
    if not isinstance(raw_prediction, Mapping):
        raw_prediction = {}
    fallback_value = (
        ANSWER_TYPE_CODE
        if bool(problem.get("is_code_problem"))
        else ANSWER_TYPE_UNKNOWN
    )
    try:
        value = normalize_answer_type(raw_prediction.get("value") or fallback_value)
    except ValueError:
        value = fallback_value
    try:
        confidence = float(raw_prediction.get("confidence", 1.0 if value == ANSWER_TYPE_CODE else 0.0) or 0.0)
    except (TypeError, ValueError, OverflowError):
        confidence = 0.0
    if not math.isfinite(confidence):
        confidence = 0.0
    reason = str(
        raw_prediction.get("reason")
        or problem.get("classification_reason")
        or ""
    ).strip()
    prediction = {
        "value": value,
        "confidence": max(0.0, min(1.0, confidence)),
    }
    if reason:
        prediction["reason"] = reason
    classifier_version = str(raw_prediction.get("classifier_version", "") or "").strip()
    if classifier_version:
        prediction["classifier_version"] = classifier_version
    if value in {ANSWER_TYPE_SHORT_ANSWER, ANSWER_TYPE_UNKNOWN} and classifier_version != CLASSIFIER_VERSION:
        refreshed = classify_problem_answer_type(problem.get("problem_text", ""))
        if refreshed["value"] == ANSWER_TYPE_OX:
            prediction = {key: refreshed[key] for key in ("value", "confidence", "reason", "classifier_version")}
    return prediction


def _normalized_answer_type_override(value: Any) -> str | None:
    if value is None or not str(value).strip():
        return None
    try:
        return normalize_answer_type(value)
    except ValueError:
        return None


def _effective_answer_type(problem: Mapping[str, Any]) -> str:
    override = _normalized_answer_type_override(problem.get("answer_type_override"))
    if override:
        return override
    return str(_normalized_answer_type_prediction(problem)["value"])


def _normalized_draft_answer(state: Mapping[str, Any]) -> dict[str, Any]:
    raw_draft = state.get("draft_answer")
    if not isinstance(raw_draft, Mapping):
        raw_draft = {
            "answer_text": state.get("answer_text", ""),
            "selected_choice": state.get("selected_choice"),
        }
    try:
        normalized = normalize_draft_answer(raw_draft)
    except ValueError:
        normalized = {
            "answer_text": str(raw_draft.get("answer_text", "") or "")[:MAX_ANSWER_CHARS],
            "selected_choice": None,
        }
    updated_at = str(raw_draft.get("updated_at", "") or "").strip() or None
    return {
        **normalized,
        "updated_at": updated_at,
    }


def _normalized_ai_hint(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    text = str(value.get("text", "") or "").strip()[:MAX_HINT_CHARS]
    if not text:
        return None
    return {
        "text": text,
        "provider": str(value.get("provider", "") or "").strip()[:200],
        "model": str(value.get("model", "") or "").strip()[:200],
        "generated_at": str(value.get("generated_at", "") or "").strip() or None,
    }


def _draft_answer_hash(answer_type: str, draft: Mapping[str, Any]) -> str | None:
    # O/X reclassification keeps the same stored text submission identity.
    if answer_type == ANSWER_TYPE_OX:
        answer_type = ANSWER_TYPE_SHORT_ANSWER
    if answer_type not in {ANSWER_TYPE_MULTIPLE_CHOICE, ANSWER_TYPE_SHORT_ANSWER}:
        return None
    payload = {
        "answer_type": answer_type,
        "answer_text": str(draft.get("answer_text", "") or ""),
        "selected_choice": draft.get("selected_choice"),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8", errors="surrogatepass")).hexdigest()


def _problem_workspace_path(problem: Mapping[str, Any]) -> str:
    current = str(problem.get("workspace_path") or problem.get("folder_path") or "").strip()
    if current:
        return _safe_relative_path(current)
    chapter_folder = _sanitize_folder_name(
        str(problem.get("chapter_folder") or problem.get("chapter") or ""),
        "챕터",
    )
    folder_name = _sanitize_folder_name(
        str(problem.get("folder_name") or KIND_FOLDERS.get(str(problem.get("kind")), "")),
        "연습 문제",
    )
    try:
        number = max(1, int(problem.get("number") or 1))
    except (TypeError, ValueError):
        number = 1
    return _safe_relative_path(f"{chapter_folder}/{folder_name}/{number}번 문제")


def _state_path(base_dir: str, descriptor: Mapping[str, Any]) -> str:
    return _inside_base(base_dir, str(descriptor.get("state_relative_path", "")))


def _problem_identity_matches(state: Mapping[str, Any], descriptor: Mapping[str, Any]) -> bool:
    state_id = str(state.get("id", "") or "")
    descriptor_id = str(descriptor.get("id", "") or "")
    state_fingerprint = str(state.get("pdf_fingerprint", "") or "")
    descriptor_fingerprint = str(descriptor.get("pdf_fingerprint", "") or "")
    return bool(
        state_id
        and descriptor_id
        and state_fingerprint
        and descriptor_fingerprint
        and state_id == descriptor_id
        and state_fingerprint == descriptor_fingerprint
    )


def _problem_location_key(
    problem: Mapping[str, Any],
) -> tuple[str, str, int, int, int, int] | None:
    fingerprint = str(problem.get("pdf_fingerprint", "") or "")
    kind = str(problem.get("kind", "") or "")
    if kind == "check":
        kind = "quiz"
    try:
        page = int(problem.get("page"))
        number = int(problem.get("number"))
    except (TypeError, ValueError):
        return None
    if not fingerprint or kind not in KIND_FOLDERS or page < 1 or number < 1:
        return None
    box = problem.get("label_bbox") or {}
    try:
        left = round(float(box.get("left", 0) or 0) * 1_000)
        top = round(float(box.get("top", 0) or 0) * 1_000)
    except (AttributeError, TypeError, ValueError):
        return None
    return fingerprint, kind, page, number, left, top


def _problem_location_matches(first: Mapping[str, Any], second: Mapping[str, Any]) -> bool:
    first_key = _problem_location_key(first)
    return first_key is not None and first_key == _problem_location_key(second)


def _validated_problem_state(
    descriptor: Mapping[str, Any],
    raw_state: Mapping[str, Any] | None,
    *,
    now: datetime | None = None,
    allow_location_migration: bool = False,
) -> dict:
    if not raw_state:
        return _default_state(descriptor, now=now)
    if not _problem_identity_matches(raw_state, descriptor) and not (
        allow_location_migration and _problem_location_matches(raw_state, descriptor)
    ):
        raise ValueError("문제 상태 파일이 다른 PDF 또는 문제에 속합니다. PDF 문제를 다시 인식해 주세요.")
    state = _default_state(descriptor, now=now)
    for key in (*STATE_PROGRESS_KEYS, "updated_at"):
        if key in raw_state:
            state[key] = raw_state[key]
    state["schema_version"] = STATE_VERSION
    state["answer_type_prediction"] = _normalized_answer_type_prediction(descriptor)
    state["answer_type_override"] = _normalized_answer_type_override(
        state.get("answer_type_override")
    )
    if "draft_answer" not in raw_state and (
        "answer_text" in raw_state or "selected_choice" in raw_state
    ):
        state["draft_answer"] = _normalized_draft_answer(raw_state)
    else:
        state["draft_answer"] = _normalized_draft_answer(state)
    state["ai_hint"] = _normalized_ai_hint(state.get("ai_hint"))
    state["choices"] = [
        str(item).strip()
        for item in (descriptor.get("choices") or [])
        if str(item or "").strip()
    ][:MAX_CHOICES]
    state["code"] = _normalized_problem_code_blocks(descriptor.get("code"))
    state["code_positions"] = _normalized_problem_code_positions(
        descriptor.get("code_positions"), descriptor.get("problem_text"), state["code"],
    )
    try:
        state["workspace_path"] = _problem_workspace_path(descriptor)
    except ValueError:
        state["workspace_path"] = None
    return state


def _folder_can_store_problem(
    base_dir: str,
    folder_path: str,
    problem: Mapping[str, Any],
    *,
    trusted_previous_path: bool = False,
) -> bool:
    target = _inside_base(base_dir, folder_path)
    state_path = os.path.join(target, PROBLEM_STATE_FILE)
    if os.path.isfile(state_path):
        state = _read_json(state_path)
        return bool(state) and (
            _problem_identity_matches(state, problem)
            or _problem_location_matches(state, problem)
        )
    if not os.path.exists(target):
        return True
    # Never claim an existing directory without a matching managed state file.
    # Even an empty directory may belong to the user.
    return False


def _allocate_code_problem_storage(
    base_dir: str,
    problem: dict,
    pdf_path: str,
    previous_descriptor: Mapping[str, Any] | None,
):
    clean_path = str(problem.get("folder_path") or "").replace("\\", "/").strip("/")
    if not clean_path:
        return

    previous_path = ""
    if previous_descriptor and _problem_location_matches(previous_descriptor, problem):
        previous_path = str(previous_descriptor.get("folder_path") or "").replace("\\", "/").strip("/")

    candidates: list[tuple[str, bool]] = []
    candidates.append((clean_path, False))

    parent, clean_name = clean_path.rsplit("/", 1) if "/" in clean_path else ("", clean_path)
    pdf_label = _sanitize_folder_name(Path(pdf_path).stem, "PDF")[:36].rstrip(" .") or "PDF"
    fingerprint = str(problem.get("pdf_fingerprint", "") or "")
    problem_id = str(problem.get("id", "") or "")
    collision_name = _sanitize_folder_name(
        f"{clean_name} ({pdf_label}-{fingerprint[:8]})",
        f"{clean_name}-{fingerprint[:8]}",
    )
    collision_path = f"{parent}/{collision_name}" if parent else collision_name
    candidates.append((collision_path, False))
    id_name = _sanitize_folder_name(
        f"{clean_name} ({pdf_label}-{fingerprint[:8]}-{problem_id[:6]})",
        f"{clean_name}-{problem_id[:12]}",
    )
    id_path = f"{parent}/{id_name}" if parent else id_name
    candidates.append((id_path, False))
    for index in range(2, 100):
        numbered_name = _sanitize_folder_name(f"{id_name}-{index}", f"{clean_name}-{index}")
        candidates.append((f"{parent}/{numbered_name}" if parent else numbered_name, False))
    if previous_path:
        candidates.append((previous_path, True))

    seen: set[str] = set()
    for candidate, trusted_previous in candidates:
        normalized = _safe_relative_path(candidate)
        key = os.path.normcase(normalized.replace("/", os.sep))
        if key in seen:
            continue
        seen.add(key)
        try:
            available = _folder_can_store_problem(
                base_dir,
                normalized,
                problem,
                trusted_previous_path=trusted_previous,
            )
        except ValueError:
            available = False
        if not available:
            continue
        problem["folder_path"] = normalized
        problem["workspace_path"] = normalized
        problem["project_name"] = normalized
        problem["state_relative_path"] = f"{normalized}/{PROBLEM_STATE_FILE}"
        return
    raise FileExistsError("문제 폴더 충돌을 피할 안전한 경로를 만들지 못했습니다.")


def _prune_empty_managed_ancestors(base_dir: str, start_directory: str):
    base = _safe_base_dir(base_dir)
    current = os.path.abspath(start_directory)
    while os.path.normcase(current) != os.path.normcase(base):
        try:
            if os.path.normcase(os.path.commonpath([base, current])) != os.path.normcase(base):
                return
            os.rmdir(current)
        except OSError:
            return
        current = os.path.dirname(current)


def _migrate_code_problem_folder(
    base_dir: str,
    previous_descriptor: Mapping[str, Any] | None,
    problem: Mapping[str, Any],
):
    from edition_manifest import feature_enabled
    if not feature_enabled("ide"):
        return
    if not previous_descriptor or not _problem_location_matches(previous_descriptor, problem):
        return
    previous_path = str(previous_descriptor.get("folder_path") or "").replace("\\", "/").strip("/")
    target_path = str(problem.get("folder_path") or "").replace("\\", "/").strip("/")
    if not previous_path or not target_path or previous_path == target_path:
        return

    source = _inside_base(base_dir, previous_path)
    target = _inside_base(base_dir, target_path)
    if not os.path.isdir(source):
        return
    source_state = _read_json(os.path.join(source, PROBLEM_STATE_FILE))
    if (
        not os.path.isfile(os.path.join(source, CODE_PROJECT_MARKER))
        or not source_state
        or not _problem_location_matches(source_state, problem)
    ):
        # The directory is not verifiably managed by this exact problem.
        return
    if os.path.exists(target):
        target_state = _read_json(os.path.join(target, PROBLEM_STATE_FILE))
        if target_state and _problem_location_matches(target_state, problem):
            raise FileExistsError(
                "같은 문제의 이전 폴더와 새 폴더가 모두 존재합니다. 사용자 코드를 보호하기 위해 자동 병합하지 않았습니다."
            )
        raise FileExistsError("교정된 문제 폴더 경로가 이미 사용 중입니다.")

    os.makedirs(os.path.dirname(target), exist_ok=True)
    os.replace(source, target)
    _prune_empty_managed_ancestors(base_dir, os.path.dirname(source))


def _remove_migrated_state_file(
    base_dir: str,
    old_state_path: str,
    new_state_path: str,
    problem: Mapping[str, Any],
):
    if os.path.normcase(os.path.abspath(old_state_path)) == os.path.normcase(os.path.abspath(new_state_path)):
        return
    if os.path.basename(os.path.dirname(old_state_path)) != HIDDEN_PROBLEM_DIR:
        # A former code project may contain user source beside its state file.
        # Keep that managed folder intact when classification changes.
        return
    old_state = _read_json(old_state_path)
    if not old_state or not _problem_location_matches(old_state, problem):
        return
    try:
        os.remove(old_state_path)
    except OSError:
        return
    _prune_empty_managed_ancestors(base_dir, os.path.dirname(old_state_path))


def _state_response(state: Mapping[str, Any], now: datetime | None = None) -> dict:
    result = dict(state)
    result.update(practice_rounds.metadata(state))
    result.pop("solve_history", None)
    result.pop("solve_submission", None)
    result.pop("solve_current_snapshot", None)
    if state.get("solve_workspace_path"):
        result["folder_path"] = state["solve_workspace_path"]
        result["project_name"] = state["solve_workspace_path"]
        result["workspace_path"] = state["solve_workspace_path"]
    prediction = _normalized_answer_type_prediction(result)
    override = _normalized_answer_type_override(result.get("answer_type_override"))
    answer_type = override or str(prediction["value"])
    draft_answer = _normalized_draft_answer(result)
    result["answer_type_prediction"] = prediction
    result["answer_type_override"] = override
    result["answer_type"] = answer_type
    result["is_code_problem"] = answer_type == ANSWER_TYPE_CODE
    result["draft_answer"] = draft_answer
    result["current_answer_hash"] = _draft_answer_hash(answer_type, draft_answer)
    # Top-level aliases keep older API callers compatible while draft_answer is
    # the canonical persisted shape.
    result["answer_text"] = draft_answer["answer_text"]
    result["selected_choice"] = draft_answer["selected_choice"]
    result["choices"] = [
        str(item).strip()
        for item in (result.get("choices") or [])
        if str(item or "").strip()
    ][:MAX_CHOICES]
    result["code"] = _normalized_problem_code_blocks(result.get("code"))
    result["code_positions"] = _normalized_problem_code_positions(
        result.get("code_positions"), result.get("problem_text"), result["code"],
    )
    problem_edit = result.get("problem_edit")
    edit_metadata = (
        problem_edit.get("metadata")
        if isinstance(problem_edit, Mapping) and isinstance(problem_edit.get("metadata"), Mapping)
        else {}
    )
    edit_source = str(problem_edit.get("source", "") or "") if isinstance(problem_edit, Mapping) else ""
    resolution_kind = str(edit_metadata.get("resolution_kind", "") or "")
    if resolution_kind == "user_review":
        result["practice_content_source"] = "user_review"
    elif resolution_kind == "unresolved_safety":
        result["practice_content_source"] = "paddleocr"
    elif edit_source == "ai":
        result["practice_content_source"] = "ai_review"
    elif edit_source == "user":
        result["practice_content_source"] = "user_edit"
    else:
        result["practice_content_source"] = "paddleocr"
    try:
        result["workspace_path"] = _problem_workspace_path(result)
    except ValueError:
        result["workspace_path"] = None
    status = str(result.get("status", "not_started") or "not_started")
    if status not in VALID_STATUSES:
        status = "not_started"
    elapsed = max(0, int(result.get("elapsed_seconds", 0) or 0))
    started = _parse_time(result.get("timer_started_at"))
    current = now or _utc_now()
    effective_elapsed = elapsed
    if started:
        effective_elapsed += max(0, int((current - started).total_seconds()))
    result["status"] = status
    result["status_label"] = STATUS_LABELS[status]
    result["elapsed_seconds"] = elapsed
    result["effective_elapsed_seconds"] = effective_elapsed
    result["wrong_count"] = max(0, int(result.get("wrong_count", 0) or 0))
    result["ai_hint_used"] = bool(result.get("ai_hint_used", False))
    result["ai_hint"] = _normalized_ai_hint(result.get("ai_hint"))
    return result


def _ensure_code_folder(base_dir: str, problem: Mapping[str, Any]):
    from edition_manifest import feature_enabled
    if not feature_enabled("ide"):
        return
    folder_path = problem.get("folder_path")
    if not folder_path:
        return
    target = _inside_base(base_dir, str(folder_path))
    os.makedirs(target, exist_ok=True)
    marker = os.path.join(target, CODE_PROJECT_MARKER)
    if not os.path.exists(marker):
        Path(marker).touch()
    starter = str(problem.get("starter_file") or "").strip()
    if starter:
        starter_path = os.path.join(target, starter)
        if not os.path.exists(starter_path):
            Path(starter_path).touch()


def scan_pdf_problems(
    pdf_path: str,
    base_dir: str,
    chapter_name: str = "",
    reuse_cached: bool = False,
) -> dict:
    base = _safe_base_dir(base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    analysis_lock_path = f"{_catalog_path(base, normalized_pdf)}.analysis"
    with _path_lock(analysis_lock_path):
        return _scan_pdf_problems_locked(
            normalized_pdf,
            base,
            chapter_name=chapter_name,
            reuse_cached=reuse_cached,
        )


def _scan_pdf_problems_locked(
    pdf_path: str,
    base_dir: str,
    chapter_name: str = "",
    reuse_cached: bool = False,
) -> dict:
    base = _safe_base_dir(base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    if reuse_cached:
        catalog_path = _catalog_path(base, normalized_pdf)
        with _path_lock(catalog_path):
            cached_catalog = _read_json(catalog_path)
            try:
                cached_version = int(cached_catalog.get("schema_version", 0) or 0)
            except (TypeError, ValueError):
                cached_version = 0
            if (
                cached_version >= CATALOG_VERSION
                and _catalog_matches_pdf(cached_catalog, normalized_pdf)
                and all((item.get("answer_type_prediction") or {}).get("classifier_version") == CLASSIFIER_VERSION
                        for item in cached_catalog.get("problems", []))
            ):
                cached_result = list_pdf_problems(normalized_pdf, base)
                cached_result["analysis_source"] = "saved"
                cached_result["analyzed_at"] = cached_catalog.get("analyzed_at") or cached_catalog.get("updated_at")
                return cached_result

    detection = detect_pdf_problems(pdf_path, chapter_name=chapter_name)
    catalog_path = _catalog_path(base, detection["pdf_path"])
    allocation_lock_path = os.path.join(base, HIDDEN_PROBLEM_DIR, ".storage-allocation")
    with _path_lock(catalog_path):
        with _path_lock(allocation_lock_path):
            previous_catalog = _read_json(catalog_path)
            previous_by_location = {
                key: item
                for item in previous_catalog.get("problems", [])
                if isinstance(item, Mapping)
                for key in [_problem_location_key(item)]
                if key is not None
            }
            previous_by_id = {
                str(item.get("id", "")): item
                for item in previous_catalog.get("problems", [])
                if isinstance(item, Mapping) and str(item.get("id", "")).strip()
            }
            synchronized = []
            for raw_problem in detection["problems"]:
                problem = dict(raw_problem)
                old_descriptor = (
                    previous_by_location.get(_problem_location_key(problem))
                    or previous_by_id.get(str(problem.get("id", "")))
                )
                saved_edit = old_descriptor.get("problem_edit") if old_descriptor else None
                if isinstance(saved_edit, Mapping):
                    saved_fields = saved_edit.get("fields")
                    if isinstance(saved_fields, Mapping):
                        for key in ("problem_text", "number", "page", "page_end", "choices", "code", "code_positions"):
                            if key in saved_fields:
                                problem[key] = saved_fields[key]
                        classification = classify_problem_answer_type(problem.get("problem_text", ""))
                        problem["answer_type_prediction"] = {
                            key: classification.get(key)
                            for key in ("value", "confidence", "reason", "classifier_version")
                            if classification.get(key) is not None
                        }
                        problem["classification_reason"] = str(classification.get("reason", "") or "")
                        problem["is_code_problem"] = (
                            problem["answer_type_prediction"].get("value") == ANSWER_TYPE_CODE
                        )
                        problem["problem_edit"] = dict(saved_edit)
                old_state = {}
                if old_descriptor:
                    old_state = _read_json(_state_path(base, old_descriptor))
                answer_type_override = _normalized_answer_type_override(
                    old_state.get("answer_type_override")
                )
                effective_answer_type = (
                    answer_type_override
                    or str(_normalized_answer_type_prediction(problem)["value"])
                )
                has_existing_workspace = bool(
                    old_descriptor
                    and str(old_descriptor.get("folder_path") or "").strip()
                )
                if effective_answer_type == ANSWER_TYPE_CODE or has_existing_workspace:
                    problem["folder_path"] = _problem_workspace_path(problem)
                    problem["project_name"] = problem["folder_path"]
                    problem["state_relative_path"] = (
                        f"{problem['folder_path']}/{PROBLEM_STATE_FILE}"
                    )
                else:
                    problem["folder_path"] = None
                    problem["project_name"] = None
                    problem["state_relative_path"] = (
                        f"{problem['chapter_folder']}/{problem['folder_name']}/"
                        f"{HIDDEN_PROBLEM_DIR}/{problem['id']}.json"
                    )
                problem["is_code_problem"] = effective_answer_type == ANSWER_TYPE_CODE
                _allocate_code_problem_storage(base, problem, detection["pdf_path"], old_descriptor)
                _migrate_code_problem_folder(base, old_descriptor, problem)
                _ensure_code_folder(base, problem)
                state_path = _state_path(base, problem)
                migrated_state_path = ""
                with _path_lock(state_path):
                    current = _read_json(state_path)
                    if current and not (
                        _problem_identity_matches(current, problem)
                        or _problem_location_matches(current, problem)
                    ):
                        raise ValueError("할당된 문제 폴더에 다른 PDF의 상태 파일이 있습니다.")
                    if not current and old_descriptor:
                        old_state_path = _state_path(base, old_descriptor)
                        old_state = _read_json(old_state_path)
                        if old_state and _problem_location_matches(old_state, problem):
                            current = old_state
                            migrated_state_path = old_state_path
                    state = _validated_problem_state(
                        problem,
                        current,
                        allow_location_migration=True,
                    )
                    state["updated_at"] = _iso_time()
                    _atomic_write_json(state_path, state)
                if migrated_state_path:
                    _remove_migrated_state_file(
                        base,
                        migrated_state_path,
                        state_path,
                        problem,
                    )
                synchronized.append(dict(problem))

            analyzed_at = _iso_time()
            catalog = {
                "schema_version": CATALOG_VERSION,
                "pdf_path": detection["pdf_path"],
                "pdf_fingerprint": detection["pdf_fingerprint"],
                "pdf_size": detection["pdf_size"],
                "pdf_mtime_ns": detection["pdf_mtime_ns"],
                "page_count": detection["page_count"],
                "analyzed_at": analyzed_at,
                "updated_at": analyzed_at,
                "problems": synchronized,
                "sequence_gaps": detection.get("sequence_gaps") or [],
            }
            _atomic_write_json(catalog_path, catalog)
    result = list_pdf_problems(detection["pdf_path"], base)
    result["analysis_source"] = "new"
    result["analyzed_at"] = analyzed_at
    return result


def _load_catalog(pdf_path: str, base_dir: str) -> tuple[str, dict]:
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    path = _catalog_path(base_dir, normalized_pdf)
    catalog = _read_json(path)
    if not catalog:
        return path, {"pdf_path": normalized_pdf, "problems": []}
    if os.path.normcase(os.path.abspath(str(catalog.get("pdf_path", "")))) != os.path.normcase(normalized_pdf):
        raise ValueError("Stored problem catalog does not match this PDF.")
    return path, catalog


def list_pdf_problems(pdf_path: str, base_dir: str) -> dict:
    _catalog_path_value, catalog = _load_catalog(pdf_path, base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    try:
        catalog_version = int(catalog.get("schema_version", 0) or 0)
    except (TypeError, ValueError):
        catalog_version = 0
    if catalog.get("schema_version") and os.path.isfile(normalized_pdf):
        if not _catalog_matches_pdf(catalog, normalized_pdf):
            current_fingerprint = _pdf_fingerprint(normalized_pdf)
            return {
                "pdf_path": normalized_pdf,
                "pdf_fingerprint": current_fingerprint,
                "page_count": 0,
                "scanned": False,
                "stale": True,
                "analysis_source": "missing",
                "problems": [],
            }
    catalog_is_stale = 0 < catalog_version < CATALOG_VERSION
    if catalog_is_stale and catalog_version < OLDEST_DISPLAYABLE_CATALOG_VERSION:
        return {
            "pdf_path": normalized_pdf,
            "pdf_fingerprint": catalog.get("pdf_fingerprint"),
            "page_count": int(catalog.get("page_count", 0) or 0),
            "scanned": False,
            "stale": True,
            "analysis_source": "missing",
            "problems": [],
        }
    from documents.problem_catalog_snapshot import ProblemPublicView
    public_view = ProblemPublicView(pdf_path, base_dir) if catalog.get("problems") else None
    problems = []
    for descriptor in catalog.get("problems", []):
        if not isinstance(descriptor, Mapping):
            continue
        state = _validated_problem_state(descriptor, _read_json(_state_path(base_dir, descriptor)))
        problems.append(public_view.apply(_state_response(state)))
    return {
        "pdf_path": normalized_pdf,
        "pdf_fingerprint": catalog.get("pdf_fingerprint"),
        "page_count": int(catalog.get("page_count", 0) or 0),
        "scanned": catalog_version >= CATALOG_VERSION,
        "stale": catalog_is_stale,
        "analysis_source": (
            "saved" if catalog_version >= CATALOG_VERSION
            else "stale" if catalog_is_stale
            else "missing"
        ),
        "analyzed_at": catalog.get("analyzed_at") or catalog.get("updated_at"),
        "problems": problems,
    }


def _load_problem(pdf_path: str, base_dir: str, problem_id: str) -> tuple[dict, str]:
    _catalog_path_value, catalog = _load_catalog(pdf_path, base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    if os.path.isfile(normalized_pdf) and catalog.get("pdf_fingerprint"):
        if not _catalog_matches_pdf(catalog, normalized_pdf):
            raise ValueError("PDF가 변경되었습니다. 문제를 다시 인식해 주세요.")
    wanted = str(problem_id or "").strip()
    descriptor = next(
        (dict(item) for item in catalog.get("problems", []) if isinstance(item, Mapping) and str(item.get("id", "")) == wanted),
        None,
    )
    if not descriptor:
        raise KeyError("Problem was not found. Scan this PDF again.")
    return descriptor, _state_path(base_dir, descriptor)


@contextmanager
def _locked_problem(pdf_path: str, base_dir: str, problem_id: str):
    base = _safe_base_dir(base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    catalog_path = _catalog_path(base, normalized_pdf)
    with _path_lock(catalog_path):
        descriptor, state_path = _load_problem(normalized_pdf, base, problem_id)
        with _path_lock(state_path):
            yield descriptor, state_path


def get_pdf_problem(pdf_path: str, base_dir: str, problem_id: str) -> dict:
    descriptor, state_path = _load_problem(pdf_path, base_dir, problem_id)
    state = _validated_problem_state(descriptor, _read_json(state_path))
    return _answer_key_public_state(_state_response(state), pdf_path, base_dir)


def update_problem_content(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
    *,
    problem_text: Any,
    number: Any,
    page: Any,
    page_end: Any,
    choices: Any = None,
    code: Any = None,
    code_positions: Any = None,
    edit_source: str = "user",
    edit_metadata: Mapping[str, Any] | None = None,
) -> dict:
    base = _safe_base_dir(base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    catalog_path = _catalog_path(base, normalized_pdf)
    current_time = _utc_now()
    wanted = str(problem_id or "").strip()
    text = str(problem_text or "").strip()
    if not text:
        raise ValueError("문제 본문을 입력해 주세요.")
    if len(text) > MAX_PROBLEM_CHARS:
        raise ValueError(f"문제 본문은 {MAX_PROBLEM_CHARS:,}자 이하로 입력해 주세요.")

    def normalized_integer(value: Any, field: str, minimum: int, maximum: int) -> int:
        if isinstance(value, bool):
            raise ValueError(f"{field} 값이 올바르지 않습니다.")
        try:
            normalized = int(value)
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError(f"{field} 값이 올바르지 않습니다.") from error
        if normalized < minimum or normalized > maximum:
            raise ValueError(f"{field} 값이 허용 범위를 벗어났습니다.")
        return normalized

    normalized_number = normalized_integer(number, "문제 번호", 1, 9_999)
    source = str(edit_source or "user").strip().lower()
    if source not in {"user", "ai"}:
        source = "user"

    with _path_lock(catalog_path):
        catalog = _read_json(catalog_path)
        if not catalog:
            raise KeyError("Problem was not found. Scan this PDF again.")
        if os.path.normcase(os.path.abspath(str(catalog.get("pdf_path", "")))) != os.path.normcase(normalized_pdf):
            raise ValueError("Stored problem catalog does not match this PDF.")
        if os.path.isfile(normalized_pdf) and not _catalog_matches_pdf(catalog, normalized_pdf):
            raise ValueError("PDF가 변경되었습니다. 문제를 다시 인식해 주세요.")
        try:
            page_count = max(1, int(catalog.get("page_count") or 1))
        except (TypeError, ValueError, OverflowError):
            page_count = 1
        normalized_page = normalized_integer(page, "시작 페이지", 1, page_count)
        normalized_page_end = normalized_integer(page_end, "끝 페이지", normalized_page, page_count)

        descriptor_index = next(
            (
                index
                for index, item in enumerate(catalog.get("problems", []))
                if isinstance(item, Mapping) and str(item.get("id", "")) == wanted
            ),
            None,
        )
        if descriptor_index is None:
            raise KeyError("Problem was not found. Scan this PDF again.")
        descriptor = dict(catalog["problems"][descriptor_index])
        state_path = _state_path(base, descriptor)
        with _path_lock(state_path):
            current_state = _validated_problem_state(
                descriptor,
                _read_json(state_path),
                now=current_time,
            )
            classification = classify_problem_answer_type(text)
            if choices is None:
                normalized_choices = list(classification.get("choices") or [])
            else:
                if not isinstance(choices, Sequence) or isinstance(choices, (str, bytes)):
                    raise ValueError("선택지는 배열 형식이어야 합니다.")
                normalized_choices = []
                for item in choices:
                    choice = str(item or "").strip()[:4_000]
                    # Each array position is a numbered option, even when its
                    # text repeats or differs only by case (for example Java).
                    if choice:
                        normalized_choices.append(choice)
                    if len(normalized_choices) >= MAX_CHOICES:
                        break
            normalized_code = (
                _normalized_problem_code_blocks(descriptor.get("code"))
                if code is None
                else _normalized_problem_code_blocks(code, strict=True)
            )
            normalized_code_positions = _normalized_problem_code_positions(
                descriptor.get("code_positions") if code_positions is None else code_positions,
                text,
                normalized_code,
                strict=code_positions is not None,
            )

            normalized_edit_metadata = dict(edit_metadata) if isinstance(edit_metadata, Mapping) else {}
            next_descriptor = dict(descriptor)
            next_descriptor.update({
                "problem_text": text,
                "number": normalized_number,
                "page": normalized_page,
                "page_end": normalized_page_end,
                "classification_reason": str(classification.get("reason", "") or ""),
                "answer_type_prediction": {
                    key: classification.get(key)
                    for key in ("value", "confidence", "reason", "classifier_version")
                    if classification.get(key) is not None
                },
                "choices": normalized_choices,
                "code": normalized_code,
                "code_positions": normalized_code_positions,
                "is_code_problem": classification.get("value") == ANSWER_TYPE_CODE,
                "problem_edit": {
                    "source": source,
                    "updated_at": _iso_time(current_time),
                    "metadata": normalized_edit_metadata,
                    "fields": {
                        "problem_text": text,
                        "number": normalized_number,
                        "page": normalized_page,
                        "page_end": normalized_page_end,
                        "choices": normalized_choices,
                        "code": normalized_code,
                        "code_positions": normalized_code_positions,
                    },
                },
            })
            if not str(next_descriptor.get("starter_file") or "").strip():
                next_descriptor["starter_file"] = _starter_file(text)

            next_state = _validated_problem_state(
                next_descriptor,
                current_state,
                now=current_time,
            )
            draft = dict(next_state.get("draft_answer") or {})
            selected_choice = draft.get("selected_choice")
            if selected_choice is not None and normalized_choices:
                try:
                    selected_is_invalid = int(selected_choice) >= len(normalized_choices)
                except (TypeError, ValueError, OverflowError):
                    selected_is_invalid = True
                if selected_is_invalid:
                    draft["selected_choice"] = None
                    draft["updated_at"] = _iso_time(current_time)
                    next_state["draft_answer"] = draft
            next_state["updated_at"] = _iso_time(current_time)
            _atomic_write_json(state_path, next_state)

            catalog["updated_at"] = _iso_time(current_time)
            catalog["problems"][descriptor_index] = next_descriptor
            _atomic_write_json(catalog_path, catalog)
    return _answer_key_public_state(_state_response(next_state, now=current_time), pdf_path, base_dir)


def apply_reviewed_problem_content(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
    *,
    problem_text: Any,
    number: Any,
    page: Any,
    page_end: Any,
    choices: Any,
    code: Any,
    code_positions: Any = None,
    answer_type: Any,
    selected_source: str,
    resolution_kind: str,
    audit_reference: str = "",
    selected_model: str = "",
    review_stage: str = "",
    expected_content: Mapping[str, Any] | None = None,
) -> dict:
    """Write only practice-catalog overlay; never mutate PaddleOCR text/index/boxes."""
    normalized_source = str(selected_source or "").strip().lower()
    if normalized_source not in {"paddleocr", "local", "nano", "luna", "gemini"}:
        raise ValueError("selected_source must be paddleocr, local, nano, luna, or gemini.")
    normalized_resolution = str(resolution_kind or "").strip().lower()
    if normalized_resolution not in {"automatic", "user_review", "unresolved_safety"}:
        raise ValueError("resolution_kind must be automatic, user_review, or unresolved_safety.")
    if normalized_resolution == "unresolved_safety" and normalized_source != "paddleocr":
        raise ValueError("unresolved_safety requires paddleocr selected_source.")
    normalized_stage = str(review_stage or "").strip().lower()
    if normalized_stage not in {"", "paddleocr", "local", "primary", "secondary", "fallback"}:
        raise ValueError("Unsupported review_stage.")
    normalized_answer_type = normalize_answer_type(answer_type)
    base = _safe_base_dir(base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    catalog_path = _catalog_path(base, normalized_pdf)
    # Compare and commit under the same catalog lock. The API's earlier
    # freshness check gives fast page-level failure; this check closes the
    # threaded-request gap immediately before mutation.
    with _path_lock(catalog_path):
        previous = get_pdf_problem(normalized_pdf, base, problem_id)
        if isinstance(expected_content, Mapping):
            freshness_fields = (
                "problem_text", "number", "page", "page_end", "choices", "code",
                "code_positions", "answer_type",
            )

            def freshness_value(item: Mapping[str, Any], field: str):
                if field == "answer_type":
                    return normalize_answer_type(item.get(field))
                if field in {"choices", "code", "code_positions"}:
                    return list(item.get(field) or [])
                return item.get(field)

            if any(
                freshness_value(previous, field) != freshness_value(expected_content, field)
                for field in freshness_fields
            ):
                raise RuntimeError(
                    "Practice problem changed after AI review started. Reload before applying the proposal."
                )
        previous_answer_type = normalize_answer_type(previous.get("answer_type"))
        if (
            normalized_resolution == "unresolved_safety"
            and previous.get("practice_content_source") in {"user_edit", "user_review"}
        ):
            return previous
        # Provision/validate answer-type storage first. A code-folder collision
        # therefore cannot leave reviewed text partially committed.
        update_problem_answer_type(
            normalized_pdf,
            base,
            problem_id,
            normalized_answer_type,
        )
        try:
            return update_problem_content(
                normalized_pdf,
                base,
                problem_id,
                problem_text=problem_text,
                number=number,
                page=page,
                page_end=page_end,
                choices=choices,
                code=code,
                code_positions=code_positions,
                edit_source="user" if normalized_resolution == "user_review" else "ai",
                edit_metadata={
                    "storage_boundary": "practice_catalog_only",
                    "selected_source": normalized_source,
                    "resolution_kind": normalized_resolution,
                    "audit_reference": str(audit_reference or ""),
                    "selected_model": str(selected_model or "").strip(),
                    "review_stage": normalized_stage,
                },
            )
        except Exception:
            if previous_answer_type != normalized_answer_type:
                try:
                    update_problem_answer_type(
                        normalized_pdf,
                        base,
                        problem_id,
                        previous_answer_type,
                    )
                except Exception:
                    pass
            raise


def _mutate_problem(pdf_path: str, base_dir: str, problem_id: str, callback, now: datetime | None = None) -> dict:
    current_time = now or _utc_now()
    # A rescan can migrate a descriptor to a different state path. Keep the
    # catalog lock until the state write finishes so a concurrent mutation
    # cannot recreate the old path after the rescan committed.
    with _locked_problem(pdf_path, base_dir, problem_id) as (descriptor, state_path):
        state = _validated_problem_state(descriptor, _read_json(state_path), now=current_time)
        updated = callback(dict(state), current_time)
        if not isinstance(updated, Mapping):
            raise TypeError("Problem mutation must return a state object.")
        value = dict(updated)
        value["updated_at"] = _iso_time(current_time)
        _atomic_write_json(state_path, value)
    return _answer_key_public_state(_state_response(value, now=current_time), pdf_path, base_dir)


def update_problem_status(pdf_path: str, base_dir: str, problem_id: str, status: str) -> dict:
    normalized_status = str(status or "").strip()
    if normalized_status not in VALID_STATUSES:
        raise ValueError("status must be not_started, in_progress, completed, or retry.")
    return _mutate_problem(
        pdf_path,
        base_dir,
        problem_id,
        lambda state, _now: {**state, "status": normalized_status},
    )


def _set_answer_type_override(state: dict, answer_type: str) -> dict:
    state["answer_type_override"] = answer_type
    return state


def _provision_problem_workspace(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
) -> dict:
    base = _safe_base_dir(base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    catalog_path = _catalog_path(base, normalized_pdf)
    allocation_lock_path = os.path.join(base, HIDDEN_PROBLEM_DIR, ".storage-allocation")
    current_time = _utc_now()

    with _path_lock(catalog_path):
        with _path_lock(allocation_lock_path):
            catalog = _read_json(catalog_path)
            if not catalog:
                raise KeyError("Problem was not found. Scan this PDF again.")
            if os.path.normcase(os.path.abspath(str(catalog.get("pdf_path", "")))) != os.path.normcase(normalized_pdf):
                raise ValueError("Stored problem catalog does not match this PDF.")
            if os.path.isfile(normalized_pdf) and not _catalog_matches_pdf(catalog, normalized_pdf):
                raise ValueError("PDF가 변경되었습니다. 문제를 다시 인식해 주세요.")

            wanted = str(problem_id or "").strip()
            descriptor_index = next(
                (
                    index
                    for index, item in enumerate(catalog.get("problems", []))
                    if isinstance(item, Mapping) and str(item.get("id", "")) == wanted
                ),
                None,
            )
            if descriptor_index is None:
                raise KeyError("Problem was not found. Scan this PDF again.")
            descriptor = dict(catalog["problems"][descriptor_index])
            if str(descriptor.get("folder_path") or "").strip():
                # Another request provisioned the workspace while this request
                # was waiting for the catalog lock.
                return _mutate_problem(
                    normalized_pdf,
                    base,
                    wanted,
                    lambda state, _now: _set_answer_type_override(
                        state,
                        ANSWER_TYPE_CODE,
                    ),
                    now=current_time,
                )

            old_state_path = _state_path(base, descriptor)
            with _path_lock(old_state_path):
                old_state = _validated_problem_state(
                    descriptor,
                    _read_json(old_state_path),
                    now=current_time,
                )

                next_descriptor = dict(descriptor)
                next_descriptor["folder_path"] = _problem_workspace_path(descriptor)
                next_descriptor["project_name"] = next_descriptor["folder_path"]
                next_descriptor["state_relative_path"] = (
                    f"{next_descriptor['folder_path']}/{PROBLEM_STATE_FILE}"
                )
                next_descriptor["is_code_problem"] = True
                if not str(next_descriptor.get("starter_file") or "").strip():
                    next_descriptor["starter_file"] = _starter_file(
                        str(next_descriptor.get("problem_text", "") or "")
                    )
                _allocate_code_problem_storage(
                    base,
                    next_descriptor,
                    normalized_pdf,
                    descriptor,
                )
                new_state_path = _state_path(base, next_descriptor)
                with _path_lock(new_state_path):
                    next_state = _validated_problem_state(
                        next_descriptor,
                        old_state,
                        now=current_time,
                        allow_location_migration=True,
                    )
                    next_state["answer_type_override"] = ANSWER_TYPE_CODE
                    next_state["updated_at"] = _iso_time(current_time)
                    _atomic_write_json(new_state_path, next_state)
                    _ensure_code_folder(base, next_descriptor)

                catalog["updated_at"] = _iso_time(current_time)
                catalog["problems"][descriptor_index] = next_descriptor
                _atomic_write_json(catalog_path, catalog)
                _remove_migrated_state_file(
                    base,
                    old_state_path,
                    new_state_path,
                    next_descriptor,
                )
    return _answer_key_public_state(_state_response(next_state, now=current_time), pdf_path, base_dir)


def update_problem_answer_type(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
    answer_type: str,
) -> dict:
    normalized_type = normalize_answer_type(answer_type)
    base = _safe_base_dir(base_dir)
    normalized_pdf = os.path.abspath(str(pdf_path or ""))
    catalog_path = _catalog_path(base, normalized_pdf)
    with _path_lock(catalog_path):
        descriptor, state_path = _load_problem(normalized_pdf, base, problem_id)
        if normalized_type == ANSWER_TYPE_CODE and not str(descriptor.get("folder_path") or "").strip():
            return _provision_problem_workspace(normalized_pdf, base, problem_id)

        if normalized_type == ANSWER_TYPE_CODE:
            target = _inside_base(base, str(descriptor.get("folder_path") or ""))
            if os.path.exists(target):
                if not os.path.isdir(target):
                    raise FileExistsError("문제 코드 작업 경로가 폴더가 아닙니다.")
                if not os.path.isfile(state_path) or not _folder_can_store_problem(
                    base,
                    str(descriptor.get("folder_path") or ""),
                    descriptor,
                    trusted_previous_path=True,
                ):
                    raise FileExistsError(
                        "문제 코드 폴더를 안전하게 확인할 수 없습니다. 문제를 다시 인식해 주세요."
                    )

        result = _mutate_problem(
            normalized_pdf,
            base,
            problem_id,
            lambda state, _now: _set_answer_type_override(state, normalized_type),
        )
        if normalized_type == ANSWER_TYPE_CODE:
            _ensure_code_folder(base, result)
        return result


def save_problem_answer(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
    answer_text: str = "",
    selected_choice: int | None = None,
    expected_round_id: str | None = None,
) -> dict:
    normalized_draft = normalize_draft_answer({
        "answer_text": answer_text,
        "selected_choice": selected_choice,
    })

    def save_answer(state: dict, current: datetime) -> dict:
        practice_rounds.check_round(state, expected_round_id)
        response = _state_response(state, now=current)
        answer_type = str(response.get("answer_type") or ANSWER_TYPE_UNKNOWN)
        if answer_type == ANSWER_TYPE_CODE:
            raise ValueError("Code answers are stored in the problem workspace.")
        selected = normalized_draft["selected_choice"]
        choices = list(response.get("choices") or [])
        if selected is not None:
            if answer_type != ANSWER_TYPE_MULTIPLE_CHOICE:
                raise ValueError("selected_choice is only valid for a multiple-choice problem.")
            if choices and selected >= len(choices):
                raise ValueError("selected_choice is outside the available choices.")
            if not choices and selected >= MAX_CHOICES:
                raise ValueError("selected_choice is outside the supported fallback choices.")
        state["draft_answer"] = {
            **normalized_draft,
            "updated_at": _iso_time(current),
        }
        return state

    return _mutate_problem(
        pdf_path,
        base_dir,
        problem_id,
        save_answer,
    )


def start_problem_timer(pdf_path: str, base_dir: str, problem_id: str, now: datetime | None = None, *, expected_round_id: str | None = None) -> dict:
    def start(state: dict, current: datetime):
        practice_rounds.check_round(state, expected_round_id)
        if state.get("timer_started_at"):
            return state
        state["timer_started_at"] = _iso_time(current)
        state["last_attempt_at"] = _iso_time(current)
        state["status"] = "in_progress"
        return state

    return _mutate_problem(pdf_path, base_dir, problem_id, start, now=now)


def _stop_running_timer(state: dict, current: datetime) -> dict:
    started = _parse_time(state.get("timer_started_at"))
    if started:
        delta = max(0, int((current - started).total_seconds()))
        state["elapsed_seconds"] = max(0, int(state.get("elapsed_seconds", 0) or 0)) + delta
        state["timer_started_at"] = None
    return state


def stop_problem_timer(pdf_path: str, base_dir: str, problem_id: str, now: datetime | None = None, *, expected_round_id: str | None = None) -> dict:
    def stop(state, current):
        practice_rounds.check_round(state, expected_round_id)
        return _stop_running_timer(state, current)
    return _mutate_problem(pdf_path, base_dir, problem_id, stop, now=now)


def mark_problem_hint_used(pdf_path: str, base_dir: str, problem_id: str, *, expected_round_id: str | None = None) -> dict:
    def mark(state, _now):
        practice_rounds.check_round(state, expected_round_id)
        return {**state, "ai_hint_used": True}
    return _mutate_problem(
        pdf_path,
        base_dir,
        problem_id,
        mark,
    )


def save_problem_hint(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
    hint_text: str,
    *,
    provider: str = "",
    model: str = "",
    now: datetime | None = None,
    expected_round_id: str | None = None,
) -> dict:
    text = str(hint_text or "").strip()[:MAX_HINT_CHARS]
    if not text:
        raise ValueError("Hint text is required.")

    def save_hint(state: dict, current: datetime) -> dict:
        practice_rounds.check_round(state, expected_round_id)
        state["ai_hint_used"] = True
        state["ai_hint"] = {
            "text": text,
            "provider": str(provider or "").strip()[:200],
            "model": str(model or "").strip()[:200],
            "generated_at": _iso_time(current),
        }
        return state

    return _mutate_problem(
        pdf_path,
        base_dir,
        problem_id,
        save_hint,
        now=now,
    )


def validate_problem_project(problem: Mapping[str, Any], project_name: str):
    expected = str(problem.get("folder_path") or "").replace("\\", "/").strip("/")
    actual = str(project_name or "").replace("\\", "/").strip("/")
    if _effective_answer_type(problem) != ANSWER_TYPE_CODE or not expected:
        raise ValueError("Only code-writing problems can be graded in the code editor.")
    if os.path.normcase(expected) != os.path.normcase(actual):
        raise ValueError("The selected code project does not match this problem folder.")


def _grading_revision(state: Mapping[str, Any]) -> int:
    values = (
        state.get("grading_revision", 0),
        state.get("last_applied_grading_revision", 0),
        (state.get("pending_grading") or {}).get("revision", 0)
        if isinstance(state.get("pending_grading"), Mapping)
        else 0,
    )
    revisions = []
    for value in values:
        try:
            revisions.append(max(0, int(value or 0)))
        except (TypeError, ValueError, OverflowError):
            revisions.append(0)
    return max(revisions, default=0)


def _grading_attempt_response(
    state: Mapping[str, Any],
    *,
    attempt_id: str,
    revision: int,
    submission_status: str,
    now: datetime,
) -> dict:
    pending = state.get("pending_grading")
    last_grading = state.get("last_grading")
    if isinstance(pending, Mapping):
        submitted_at = str(pending.get("submitted_at", "") or "")
    elif isinstance(last_grading, Mapping):
        submitted_at = str(last_grading.get("submitted_at", "") or "")
    else:
        submitted_at = ""
    return {
        "attempt_id": attempt_id,
        "revision": revision,
        "submitted_at": submitted_at,
        "submission_status": submission_status,
        "problem": _state_response(state, now=now),
    }


def begin_problem_grading(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
    *,
    attempt_id: str | None = None,
    submission_hash: str | None = None,
    expected_round_id: str | None = None,
    submission: Mapping[str, Any] | None = None,
    now: datetime | None = None,
) -> dict:
    """Freeze solve time and register the newest AI grading submission atomically."""

    normalized_attempt_id = normalize_grading_attempt_id(attempt_id)
    current_time = now or _utc_now()
    with _locked_problem(pdf_path, base_dir, problem_id) as (descriptor, state_path):
        state = _validated_problem_state(descriptor, _read_json(state_path), now=current_time)
        practice_rounds.check_round(state, expected_round_id)
        last_applied_id = str(state.get("last_applied_grading_attempt_id", "") or "")
        if last_applied_id == normalized_attempt_id:
            revision = max(1, _grading_revision({
                "grading_revision": state.get("last_applied_grading_revision", 0),
            }))
            return _grading_attempt_response(
                state,
                attempt_id=normalized_attempt_id,
                revision=revision,
                submission_status="already_applied",
                now=current_time,
            )

        pending = state.get("pending_grading")
        if isinstance(pending, Mapping) and str(pending.get("attempt_id", "") or "") == normalized_attempt_id:
            revision = normalize_grading_revision(pending.get("revision"))
            return _grading_attempt_response(
                state,
                attempt_id=normalized_attempt_id,
                revision=revision,
                submission_status="already_pending",
                now=current_time,
            )

        revision = _grading_revision(state) + 1
        submitted_at = _iso_time(current_time)
        state = _stop_running_timer(state, current_time)
        state["grading_revision"] = revision
        state["pending_grading"] = {
            "attempt_id": normalized_attempt_id,
            "revision": revision,
            "submitted_at": submitted_at,
            "submission_hash": str(submission_hash or "").strip() or None,
            "submission": dict(submission or state.get("draft_answer") or {}),
        }
        state["last_attempt_at"] = submitted_at
        state["updated_at"] = submitted_at
        _atomic_write_json(state_path, state)
    return _grading_attempt_response(
        state,
        attempt_id=normalized_attempt_id,
        revision=revision,
        submission_status="started",
        now=current_time,
    )


def apply_problem_grading(
    pdf_path: str,
    base_dir: str,
    problem_id: str,
    grading_result: Mapping[str, Any],
    *,
    provider: str = "",
    model: str = "",
    related_theory: list[Mapping[str, Any]] | None = None,
    mistake_source: str = "grading",
    attempt_id: str | None = None,
    revision: int | None = None,
    expected_answer_hash: str | None = None,
    answer_key_evidence: Mapping[str, Any] | None = None,
    now: datetime | None = None,
) -> dict:
    current_time = now or _utc_now()
    if (attempt_id is None) != (revision is None):
        raise ValueError("attempt_id and revision must be provided together.")
    if attempt_id is None:
        attempt = begin_problem_grading(pdf_path, base_dir, problem_id, now=current_time)
        normalized_attempt_id = attempt["attempt_id"]
        normalized_revision = attempt["revision"]
    else:
        normalized_attempt_id = normalize_grading_attempt_id(attempt_id)
        normalized_revision = normalize_grading_revision(revision)

    with _locked_problem(pdf_path, base_dir, problem_id) as (descriptor, state_path):
        state = _validated_problem_state(descriptor, _read_json(state_path), now=current_time)
        last_applied_id = str(state.get("last_applied_grading_attempt_id", "") or "")
        last_applied_revision = _grading_revision({
            "grading_revision": state.get("last_applied_grading_revision", 0),
        })
        if last_applied_id == normalized_attempt_id and last_applied_revision == normalized_revision:
            application_status = "duplicate"
        else:
            pending = state.get("pending_grading")
            pending_id = str(pending.get("attempt_id", "") or "") if isinstance(pending, Mapping) else ""
            try:
                pending_revision = normalize_grading_revision(pending.get("revision")) if isinstance(pending, Mapping) else 0
            except ValueError:
                pending_revision = 0
            if (
                _grading_revision(state) != normalized_revision
                or pending_id != normalized_attempt_id
                or pending_revision != normalized_revision
                or (expected_answer_hash is not None
                    and _state_response(state, now=current_time).get("current_answer_hash") != expected_answer_hash)
            ):
                application_status = "stale"
            else:
                submitted_at = pending.get("submitted_at")
                state["solve_submission"] = dict(pending.get("submission") or state.get("draft_answer") or {})
                state.update(build_grading_state_patch(
                    grading_result,
                    state,
                    now=submitted_at or current_time,
                    provider=provider,
                    model=model,
                    related_theory=related_theory,
                    mistake_source=mistake_source,
                    attempt_id=normalized_attempt_id,
                    revision=normalized_revision,
                    submitted_at=submitted_at,
                ))
                submission_hash = str(pending.get("submission_hash", "") or "").strip()
                if submission_hash and isinstance(state.get("last_grading"), Mapping):
                    state["last_grading"] = {
                        **dict(state["last_grading"]),
                        "submission_hash": submission_hash,
                    }
                if answer_key_evidence is not None:
                    state["last_grading"]["evidence"] = dict(answer_key_evidence)
                state["pending_grading"] = None
                state["last_applied_grading_attempt_id"] = normalized_attempt_id
                state["last_applied_grading_revision"] = normalized_revision
                state.pop("solve_current_snapshot", None)
                state["solve_current_snapshot"] = practice_rounds.snapshot(_state_response(state, now=current_time) | {"solve_submission": state.get("solve_submission")}, elapsed=state["elapsed_seconds"])
                state["updated_at"] = _iso_time(current_time)
                _atomic_write_json(state_path, state)
                application_status = "applied"

    response = _state_response(state, now=current_time)
    response["grading_application"] = {
        "status": application_status,
        "attempt_id": normalized_attempt_id,
        "revision": normalized_revision,
    }
    return response


__all__ = [
    "HIDDEN_PROBLEM_DIR",
    "PROBLEM_STATE_FILE",
    "STATUS_LABELS",
    "apply_problem_grading",
    "apply_reviewed_problem_content",
    "begin_problem_grading",
    "classify_code_problem",
    "detect_pdf_problems",
    "get_pdf_problem",
    "list_pdf_problems",
    "mark_problem_hint_used",
    "problem_review_ocr_context",
    "save_problem_answer",
    "save_problem_hint",
    "scan_pdf_problems",
    "start_problem_timer",
    "stop_problem_timer",
    "update_problem_answer_type",
    "update_problem_status",
    "validate_problem_project",
]


import sys
import types


class _ProblemManagerModule(types.ModuleType):
    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        if name in {"_chapter_markers", "pdf_ocr_status", "indexed_pdf_pages", "classify_code_problem"}:
            if "problem_detection" in globals():
                setattr(problem_detection, name, value)


sys.modules[__name__].__class__ = _ProblemManagerModule


def _answer_key_public_state(problem, pdf_path, base_dir):
    from documents.problem_catalog_snapshot import ProblemPublicView
    return ProblemPublicView(pdf_path, base_dir).apply(problem)


def invalidate_answer_key_grading(pdf_path, base_dir, problem_id, reason):
    def invalidate(state, current):
        last = state.get("last_grading") or {}
        from documents.problem_ai_grading import is_ai_evidence
        if last.get("evidence") and not is_ai_evidence(last["evidence"]):
            state["invalidated_grading"] = {"reason": reason, "evidence": last["evidence"], "at": _iso_time(current)}
            if last.get("correct") is False:
                state["wrong_count"] = max(0, int(state.get("wrong_count") or 0) - 1)
            state["last_grading"] = None
            state["status"] = "in_progress"
            state["related_theory"] = []
            state["mistake_notes"] = [item for item in state.get("mistake_notes", []) if item.get("created_at") != last.get("submitted_at")]
        state["pending_grading"] = None
        state["last_applied_grading_attempt_id"] = None
        state["last_applied_grading_revision"] = None
        state["grading_revision"] = _grading_revision(state) + 1
        return state
    return _mutate_problem(pdf_path, base_dir, problem_id, invalidate)
