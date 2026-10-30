from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import uuid
from documents import practice_rounds

from common import sanitize_title
from json_repair_utils import repair_json_like_text

def sanitize_material_child_name(name: str, *, allow_extension: bool = False) -> str:
    child_name = str(name or "").strip()
    if not child_name:
        raise ValueError("Name is required.")
    if os.path.basename(child_name) != child_name:
        raise ValueError("Enter a name only, not a path.")
    if child_name in {".", ".."}:
        raise ValueError("This name cannot be used.")
    invalid_chars = set('<>:"/\\|?*')
    if any(ch in invalid_chars for ch in child_name):
        raise ValueError("The name contains a character that cannot be used in a file or folder name.")
    if not allow_extension and "." in child_name:
        raise ValueError("Folder names cannot contain dots.")
    return child_name


def unique_material_path(directory: str, file_name: str) -> str:
    root, ext = os.path.splitext(file_name)
    candidate = os.path.join(directory, file_name)
    index = 2
    while os.path.exists(candidate) or os.path.exists(practice_data_path(candidate)):
        candidate = os.path.join(directory, f"{root}_{index}{ext}")
        index += 1
    return candidate


PRACTICE_FORMAT_VERSION = 1
OPTION_IDS = ("1", "2", "3", "4")


def _markdown_digest(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def practice_data_path(markdown_path: str) -> str:
    """Keep generated data beside its MD without exposing it as a material."""
    directory, name = os.path.split(os.path.abspath(markdown_path))
    return os.path.join(directory, f".{name}.practice.json")


def load_practice_set(markdown_path: str) -> dict | None:
    path = practice_data_path(markdown_path)
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or data.get("version") != PRACTICE_FORMAT_VERSION:
        raise ValueError("Unsupported practice set format.")
    markdown_hash = _markdown_digest(markdown_path)
    if data.get("markdown_sha256") != markdown_hash:
        data["valid"] = False
        data["errors"] = ["Practice markdown changed; save it in AILS to sync before solving."]
    return data


def practice_set_summary(markdown_path: str) -> dict | None:
    if not os.path.isfile(practice_data_path(markdown_path)):
        return None
    try:
        data = load_practice_set(markdown_path)
        return {
            "set_id": data["set_id"],
            "valid": bool(data.get("valid")),
            "question_count": len(data.get("questions", [])),
            "errors": data.get("errors", []),
        }
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        return {"valid": False, "question_count": 0, "errors": [f"Practice data cannot be read: {error}"]}


def _normalized_text(value: str) -> str:
    return " ".join(str(value or "").split()).casefold()


def validate_generated_quiz(item: dict, source_text: str, source_file: str) -> tuple[dict | None, str | None]:
    question = str(item.get("question") or "").strip()
    answer = str(item.get("answer") or "").strip()
    explanation = str(item.get("explanation") or "").strip()
    excerpt = str(item.get("source_excerpt") or "").strip()
    raw_options = item.get("options")
    if not question or not explanation or not excerpt:
        return None, "question, explanation, and source_excerpt are required"
    if not isinstance(raw_options, list) or len(raw_options) != 4:
        return None, "exactly four options are required"
    options = [str(option or "").strip() for option in raw_options]
    if any("\n" in option or "\r" in option for option in options) or "\n" in excerpt or "\r" in excerpt:
        return None, "options and source_excerpt must each be a single line"
    normalized_options = [_normalized_text(option) for option in options]
    if any(not option for option in normalized_options) or len(set(normalized_options)) != 4:
        return None, "options must be nonempty and unique"
    answer_matches = [index for index, option in enumerate(normalized_options) if option == _normalized_text(answer)]
    if len(answer_matches) != 1:
        return None, "answer must match exactly one option"
    if excerpt not in source_text:
        return None, "source_excerpt is absent from the selected markdown"
    # An exact answer phrase in the cited source is a conservative, checkable link.
    if _normalized_text(answer) not in _normalized_text(excerpt):
        return None, "the cited source does not contain the correct answer"
    return {
        "id": uuid.uuid4().hex,
        "ordinal": 0,
        "question": question,
        "options": [{"id": option_id, "text": option} for option_id, option in zip(OPTION_IDS, options)],
        "answer_option_id": OPTION_IDS[answer_matches[0]],
        "explanation": explanation,
        "source_file": source_file,
        "source_excerpt": excerpt,
        "attempts": [],
        "current_result": None,
    }, None


def _write_json_atomic(path: str, data: dict) -> None:
    directory = os.path.dirname(path)
    descriptor, temp_path = tempfile.mkstemp(prefix=".practice-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def publish_practice_set(markdown_path: str, markdown: str, quizzes: list[dict], context_usage: dict | None = None) -> dict:
    """Publish both files, removing only this new pair if the second write fails."""
    if not quizzes:
        raise ValueError("No valid practice questions were generated.")
    path = os.path.abspath(markdown_path)
    data_path = practice_data_path(path)
    if os.path.exists(path) or os.path.exists(data_path):
        raise FileExistsError("Practice output already exists.")
    questions = []
    for ordinal, item in enumerate(quizzes, 1):
        question = dict(item)
        question["ordinal"] = ordinal
        question["revision"] = 0
        questions.append(question)
    data = {
        "version": PRACTICE_FORMAT_VERSION,
        "set_id": uuid.uuid4().hex,
        "valid": True,
        "errors": [],
        "questions": questions,
        "archived_questions": [],
        "context_usage": context_usage or {},
        "markdown_sha256": "",
    }
    # O_EXCL avoids replacing a user's file in a concurrent generation.
    with open(path, "x", encoding="utf-8") as handle:
        handle.write(markdown)
    try:
        data["markdown_sha256"] = _markdown_digest(path)
        _write_json_atomic(data_path, data)
    except Exception:
        os.unlink(path)
        raise
    return data


def _quiz_blocks(markdown: str) -> list[str]:
    return re.split(r"(?m)^## 문제\s+\d+\s*$", markdown)[1:]


def parse_practice_markdown(markdown: str) -> tuple[list[dict], list[str]]:
    blocks = _quiz_blocks(markdown)
    if not blocks:
        return [], ["No '## 문제 N' sections were found."]
    questions = []
    errors = []
    for ordinal, block in enumerate(blocks, 1):
        lines = block.splitlines()
        source_file = ""
        excerpt = ""
        question_lines = []
        options = []
        option_numbers = []
        answer = ""
        explanation_lines = []
        in_callout = False
        in_explanation = False
        item_id = ""
        for line in lines:
            stripped = line.strip()
            id_match = re.fullmatch(r"<!-- ails-practice-id:([a-f0-9]{32}) -->", stripped)
            if id_match:
                item_id = id_match.group(1)
            elif stripped.startswith("- 출처:"):
                source_file = stripped.partition(":")[2].strip()
            elif stripped.startswith("- 근거:"):
                excerpt = stripped.partition(":")[2].strip()
            elif stripped.startswith("> [!정답확인]"):
                in_callout = True
            elif in_callout:
                body = stripped.removeprefix(">").strip()
                if body.startswith("- 정답:"):
                    answer = body.partition(":")[2].strip()
                    in_explanation = False
                elif body.startswith("- 해설:"):
                    explanation_lines.append(body.partition(":")[2].strip())
                    in_explanation = True
                elif in_explanation and body:
                    explanation_lines.append(body)
            else:
                option_match = re.match(r"^([1-4])\.\s+(.+)$", stripped)
                if option_match:
                    option_numbers.append(option_match.group(1))
                    options.append(option_match.group(2))
                elif stripped:
                    question_lines.append(stripped)
        question = "\n".join(question_lines).strip()
        explanation = "\n".join(explanation_lines).strip()
        if (not question or option_numbers != list(OPTION_IDS) or
                len({_normalized_text(x) for x in options}) != 4 or not answer or not explanation or not excerpt):
            errors.append(f"Problem {ordinal}: question, four unique numbered options, answer, explanation, or source excerpt is missing.")
            continue
        match = [index for index, option in enumerate(options) if _normalized_text(option) == _normalized_text(answer)]
        if len(match) != 1:
            errors.append(f"Problem {ordinal}: answer must match exactly one option.")
            continue
        questions.append({
            "id": item_id,
            "ordinal": ordinal,
            "question": question,
            "options": [{"id": key, "text": value} for key, value in zip(OPTION_IDS, options)],
            "answer_option_id": OPTION_IDS[match[0]],
            "explanation": explanation,
            "source_file": source_file,
            "source_excerpt": excerpt,
        })
    return questions, errors


def sync_practice_markdown(markdown_path: str, markdown: str) -> dict | None:
    """Reconcile an edited generated MD; invalid edits suspend grading."""
    data = load_practice_set(markdown_path)
    if data is None:
        return None
    is_review = data.get("kind") == "summary_review"
    if is_review:
        from documents.summary_review_questions import parse_summary_review_questions
        parsed, errors = parse_summary_review_questions(markdown)
    else:
        parsed, errors = parse_practice_markdown(markdown)
    old_questions = data.get("questions", [])
    archived_questions = data.get("archived_questions", [])
    if not is_review and len(parsed) != len(_quiz_blocks(markdown)):
        errors.append("At least one problem could not be parsed.")
    ids = [item["id"] for item in parsed if item.get("id")]
    if len(ids) != len(set(ids)):
        errors.append("Duplicate problem IDs were found.")
    if errors:
        for question in old_questions:
            practice_rounds.archive_material_change(question)
            question["revision"] = int(question.get("revision") or 0) + 1
            question["current_result"] = None
            question["selected_option_id"] = ""
            question["answer_text"] = ""
            question["timer"] = {"elapsed_seconds": 0, "started_at": None}
            question["ai_hint"] = None
        data["valid"] = False
        data["errors"] = errors
        data["markdown_sha256"] = _markdown_digest(markdown_path)
        _write_json_atomic(practice_data_path(markdown_path), data)
        return data
    old_by_id = {item["id"]: item for item in [*old_questions, *archived_questions]}
    updated = []
    for item in parsed:
        old = old_by_id.get(item["id"])
        if old is None:
            item.update(id=uuid.uuid4().hex, attempts=[], current_result=None, revision=0)
        else:
            item["id"] = old["id"]
            item["attempts"] = old.get("attempts", [])
            graded_fields = ("question", "options", "answer_option_id", "explanation", "source_file", "source_excerpt", "answer_type", "reference_answer")
            changed = any(item.get(key) != old.get(key) for key in graded_fields)
            if changed:
                practice_rounds.archive_material_change(old)
            for key in ("solve_history", "solve_round_number", "solve_current_snapshot"):
                if key in old:
                    item[key] = old[key]
            item["revision"] = int(old.get("revision") or 0) + (1 if changed else 0)
            item["current_result"] = None if changed else old.get("current_result")
            item["selected_option_id"] = "" if changed else old.get("selected_option_id", "")
            item["answer_text"] = "" if changed else old.get("answer_text", "")
            item["timer"] = {"elapsed_seconds": 0, "started_at": None} if changed else old.get("timer", {"elapsed_seconds": 0, "started_at": None})
            item["ai_hint"] = None if changed else old.get("ai_hint")
        updated.append(item)
    active_ids = {item["id"] for item in updated}
    data["archived_questions"] = [item for item in old_by_id.values() if item["id"] not in active_ids]
    data["questions"] = updated
    data["valid"] = bool(updated) and not errors
    data["errors"] = errors or ([] if updated else ["No valid practice questions remain."])
    data["markdown_sha256"] = _markdown_digest(markdown_path)
    _write_json_atomic(practice_data_path(markdown_path), data)
    return data


def ensure_summary_review_set(markdown_path: str) -> None:
    """Index an existing summary only when opened for solving, preserving its MD."""
    from documents.summary_review_questions import parse_summary_review_questions
    data = load_practice_set(markdown_path)
    if data is not None and (data.get("kind") != "summary_review" or data.get("markdown_sha256") == _markdown_digest(markdown_path)):
        return
    with open(markdown_path, encoding="utf-8-sig") as handle:
        markdown = handle.read()
    if data is not None:
        sync_practice_markdown(markdown_path, markdown)
        return
    questions, errors = parse_summary_review_questions(markdown)
    if not questions:
        raise FileNotFoundError("; ".join(errors))
    if errors:
        raise ValueError("; ".join(errors))
    for question in questions:
        question.update(attempts=[], current_result=None, revision=0)
    _write_json_atomic(practice_data_path(markdown_path), {
        "version": PRACTICE_FORMAT_VERSION, "kind": "summary_review",
        "set_id": uuid.uuid4().hex, "valid": True, "errors": [],
        "questions": questions, "archived_questions": [],
        "markdown_sha256": _markdown_digest(markdown_path),
    })


TEXTBOOK_FOLDER_NAME = "\uad50\uc7ac"


def is_semester_material_folder_name(name: str) -> bool:
    return bool(re.fullmatch(r"\s*\d+\ud559\ub144\s*\d+\ud559\uae30\s*", str(name or "")))


def material_course_dir_for_path(path: str, base_dir: str) -> str:
    normalized = os.path.abspath(str(path or "").strip())
    if os.path.isfile(normalized):
        normalized = os.path.dirname(normalized)
    base = os.path.abspath(str(base_dir or "").strip())
    try:
        relative = os.path.relpath(normalized, base)
    except ValueError:
        return normalized
    if relative in {"", "."}:
        return normalized

    parts = [part for part in relative.split(os.sep) if part and part != "."]
    if not parts:
        return normalized

    for index, part in enumerate(parts):
        if part == TEXTBOOK_FOLDER_NAME:
            return os.path.join(base, *parts[:index]) if index > 0 else base

    course_part_count = 2 if len(parts) >= 2 and is_semester_material_folder_name(parts[0]) else 1
    return os.path.join(base, *parts[:course_part_count])


def material_practice_output_dir(folder_path: str, base_dir: str, source_paths: list[str] | None = None) -> str:
    candidates = [path for path in (source_paths or []) if str(path or "").strip()] or [folder_path]
    course_dirs = []
    seen = set()
    for candidate in candidates:
        course_dir = material_course_dir_for_path(candidate, base_dir)
        key = os.path.normcase(os.path.abspath(course_dir))
        if key in seen:
            continue
        seen.add(key)
        course_dirs.append(course_dir)

    if len(course_dirs) == 1:
        course_dir = course_dirs[0]
    else:
        course_dir = material_course_dir_for_path(folder_path, base_dir)

    output_dir = os.path.join(course_dir, TEXTBOOK_FOLDER_NAME)
    os.makedirs(output_dir, exist_ok=True)
    return output_dir


def report_image_dir_names(report_title: str) -> list[str]:
    names = []
    raw = str(report_title or "").strip()
    candidates = [raw, sanitize_title(raw)]
    if raw.endswith("정리본"):
        trimmed = raw[:-len("정리본")].strip()
        candidates.extend([trimmed, sanitize_title(trimmed)])
    if raw.endswith("상세정리본"):
        legacy = raw[:-len("상세정리본")].strip() + " 상세 정리"
        candidates.extend([legacy, sanitize_title(legacy)])
    for title in candidates:
        if not title:
            continue
        name = f".{sanitize_title(title)}.images"
        if name not in names:
            names.append(name)
        raw_name = f"{title}_images"
        if raw_name not in names:
            names.append(raw_name)
        legacy_name = f"{sanitize_title(title)}_images"
        if legacy_name not in names:
            names.append(legacy_name)
    return names


def parse_quiz_response_items(response_text: str) -> list[dict]:
    cleaned = re.sub(r"```(?:json)?|```", "", str(response_text or ""), flags=re.IGNORECASE).strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        parsed = json.loads(repair_json_like_text(cleaned))
    if isinstance(parsed, dict):
        for key in ("quizzes", "questions", "items"):
            value = parsed.get(key)
            if isinstance(value, list):
                parsed = value
                break
    if not isinstance(parsed, list):
        raise ValueError("Quiz model response was not a JSON array.")
    return [item for item in parsed if isinstance(item, dict)]


def distribute_practice_counts(total_count: int, report_count: int) -> list[int]:
    if report_count <= 0:
        return []
    if total_count <= 0:
        return [1] * report_count
    if total_count < report_count:
        # Still query every selected report once, then trim the merged result to the requested total.
        return [1] * report_count
    base_count, remainder = divmod(total_count, report_count)
    return [base_count + (1 if index < remainder else 0) for index in range(report_count)]


def practice_callout_field_lines(label: str, value: str, fallback: str) -> list[str]:
    normalized = str(value or "").strip()
    parts = normalized.splitlines() if normalized else [fallback]
    first = parts[0].strip() or fallback
    lines = [f"- {label}: {first}"]
    for part in parts[1:]:
        stripped = part.rstrip()
        lines.append(f"  {stripped}" if stripped else "")
    return lines


def practice_answer_callout_lines(answer: str, explanation: str) -> list[str]:
    body_lines = [
        "[!정답확인]- 정답 및 해설",
        "",
        *practice_callout_field_lines("정답", answer, "(정답 없음)"),
        "",
        *practice_callout_field_lines("해설", explanation, "(해설 없음)"),
    ]
    return [f"> {line}" if line else ">" for line in body_lines]


def format_practice_markdown(title: str, source_names: list[str], quizzes: list[dict], runtime_info: dict) -> str:
    lines = [
        f"# {title}",
        "",
        "## 생성 정보",
        "",
        f"- 대상 정리본: {', '.join(source_names)}",
        f"- 생성 모델: {runtime_info.get('model') or 'unknown'}",
        f"- 병렬 요청 수: {runtime_info.get('request_count') or len(source_names)}",
        f"- 생성 개수: {len(quizzes)}",
        "",
    ]
    errors = runtime_info.get("errors") if isinstance(runtime_info.get("errors"), list) else []
    if errors:
        lines.extend(["## 생성 중 일부 실패", ""])
        for error in errors[:5]:
            lines.append(f"- {error}")
        lines.append("")
    for index, quiz in enumerate(quizzes, start=1):
        question = str(quiz.get("question", "") or "").strip()
        options = quiz.get("options")
        answer = str(quiz.get("answer", "") or "").strip()
        explanation = str(quiz.get("explanation", "") or "").strip()
        source_file = str(quiz.get("source_file", "") or "").strip()
        source_excerpt = str(quiz.get("source_excerpt", "") or "").strip()
        question_id = str(quiz.get("id", "") or "").strip()
        lines.extend([f"## 문제 {index}", ""])
        if question_id:
            lines.extend([f"<!-- ails-practice-id:{question_id} -->", ""])
        if source_file:
            lines.extend([f"- 출처: {source_file}", ""])
        if source_excerpt:
            lines.extend([f"- 근거: {source_excerpt}", ""])
        lines.extend([question or "(문제 내용 없음)", ""])
        if isinstance(options, list) and options:
            for option_index, option in enumerate(options, start=1):
                option_text = option.get("text", "") if isinstance(option, dict) else option
                if isinstance(option, dict) and str(option.get("id")) == str(quiz.get("answer_option_id")):
                    answer = str(option_text).strip()
                lines.append(f"{option_index}. {str(option_text).strip()}")
            lines.append("")
        lines.extend(practice_answer_callout_lines(answer, explanation))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


