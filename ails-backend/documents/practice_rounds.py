"""Persistent solve rounds, separate from individual grading request IDs."""
from __future__ import annotations

import copy
from typing import Mapping


def round_number(state: Mapping) -> int:
    legacy = len(state.get("attempts") or []) + (0 if state.get("current_result") else 1)
    return max(1, int(state.get("solve_round_number") or legacy or 1))


def round_id(state: Mapping) -> str:
    return f"{state['id']}:{round_number(state)}"


def check_round(state: Mapping, expected: str | None) -> None:
    # First-round legacy clients remain compatible. Later rounds must bind writes.
    if (expected is not None or round_number(state) > 1) and expected != round_id(state):
        raise ValueError("풀이 회차가 변경되었습니다. 문제를 다시 열어 주세요.")


def metadata(state: Mapping) -> dict:
    return {"solve_round_id": round_id(state), "solve_round_number": round_number(state),
            "last_solve_correct": latest_correct(state),
            "solve_history_count": max(len(state.get("attempts") or []), len(state.get("solve_history") or []) + bool(state.get("last_grading") or state.get("current_result")))}


def latest_correct(state: Mapping) -> bool | None:
    candidates = [state.get("current_result"), state.get("last_grading")]
    candidates.extend(item.get("grading") for item in reversed(state.get("solve_history") or []))
    candidates.extend(reversed(state.get("attempts") or []))
    for result in candidates:
        if isinstance(result, Mapping) and type(result.get("correct")) is bool:
            return result["correct"]
    return None


def has_progress(state: Mapping, *, material: bool = False) -> bool:
    draft = state if material else state.get("draft_answer") or {}
    timer = state.get("timer") or {} if material else state
    return bool(state.get("current_result") or state.get("last_grading") or state.get("pending_grading")
                or draft.get("answer_text") or draft.get("selected_option_id") or draft.get("selected_choice") is not None
                or timer.get("elapsed_seconds") or timer.get("started_at") or timer.get("timer_started_at")
                or state.get("ai_hint_used"))


def snapshot(state: Mapping, *, elapsed: int, material: bool = False) -> dict:
    if state.get("solve_current_snapshot"):
        return copy.deepcopy(state["solve_current_snapshot"])
    result = state.get("current_result") if material else state.get("last_grading")
    draft = state if material else state.get("draft_answer") or {}
    submitted = state.get("solve_submission") or {}
    options = state.get("options") or []
    selected = (result or {}).get("selected_option_id", draft.get("selected_option_id"))
    choice = submitted.get("selected_choice", draft.get("selected_choice"))
    choices = state.get("choices") or []
    selected_answer = next((item["text"] for item in options if item["id"] == selected), "")
    if not material and isinstance(choice, int) and 0 <= choice < len(choices):
        selected_answer = choices[choice]
    return copy.deepcopy({
        "id": round_id(state), "number": round_number(state),
        "question_text": state.get("question" if material else "problem_text", ""),
        "answer_type": state.get("answer_type") or ("code" if state.get("is_code_problem") else "short_answer"),
        "answer_text": (result or {}).get("answer_text", submitted.get("answer_text", draft.get("answer_text", ""))),
        "selected_answer": selected_answer, "selected_choice": choice,
        "files": submitted.get("files") or [],
        "workspace_path": state.get("solve_workspace_path") or state.get("folder_path"),
        "elapsed_seconds": elapsed, "graded_at": (result or {}).get("graded_at") or (result or {}).get("submitted_at") or state.get("last_attempt_at"),
        "grading": result, "ai_hint_used": bool(state.get("ai_hint_used")),
    })


def advance(state: dict, record: dict) -> None:
    history = state.setdefault("solve_history", [])
    if not any(item["id"] == record["id"] for item in history):
        history.append(record)
    state["solve_round_number"] = record["number"] + 1
    state.pop("solve_submission", None)
    state.pop("solve_current_snapshot", None)


def archive_material_change(question: dict) -> None:
    """Keep the submitted version when MD synchronization replaces a question."""
    if question.get("current_result"):
        elapsed = int(question["current_result"].get("elapsed_seconds") or 0)
        advance(question, snapshot(question, elapsed=elapsed, material=True))


def history(state: Mapping, *, elapsed: int, material: bool = False) -> list[dict]:
    records = copy.deepcopy(state.get("solve_history") or [])
    if state.get("current_result" if material else "last_grading"):
        records.append(snapshot(state, elapsed=elapsed, material=material))
    # Existing material attempts predate round snapshots; retain the known data.
    if material:
        known = {((item.get("grading") or {}).get("id")) for item in records}
        legacy = []
        for index, attempt in enumerate(state.get("attempts") or [], 1):
            if attempt.get("id") not in known:
                legacy.append({"id": attempt["id"], "number": index,
                               "answer_text": attempt.get("answer_text", ""),
                               "selected_answer": attempt.get("selected_option_id", ""),
                               "elapsed_seconds": attempt.get("elapsed_seconds", 0),
                               "graded_at": attempt.get("graded_at"), "grading": copy.deepcopy(attempt)})
        records = legacy + records
    return records
