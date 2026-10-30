"""Local solving state for newly generated, structured practice sets."""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping

from documents.material_practice_service import _write_json_atomic, load_practice_set, practice_data_path, ensure_summary_review_set
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.material_practice_local_grading import compare_reference_answer
from documents import practice_rounds as rounds


def _load(path: str, *, require_valid: bool = False) -> dict:
    data = load_practice_set(path)
    if data is None:
        raise FileNotFoundError("풀이 가능한 새 연습문제 데이터를 찾을 수 없습니다.")
    if require_valid and not data.get("valid"):
        raise ValueError("연습문제 형식 오류를 고친 뒤 다시 풀어 주세요: " + "; ".join(data.get("errors") or []))
    return data


def question_version(question: Mapping[str, Any]) -> str:
    graded_fields = {key: question.get(key) for key in ("question", "options", "answer_option_id", "answer_type", "reference_answer", "explanation")}
    encoded = json.dumps(graded_fields, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _question(data: dict, question_id: str) -> dict:
    for question in data.get("questions") or []:
        if question.get("id") == question_id:
            return question
    raise ValueError("문항을 찾을 수 없습니다. 문제 목록을 새로고침해 주세요.")


def _check_identity(data: dict, question: dict, payload: Mapping[str, Any]) -> None:
    if str(payload.get("set_id") or "") != str(data.get("set_id") or ""):
        raise ValueError("연습문제 세트가 바뀌었습니다. 다시 열어 주세요.")
    if str(payload.get("question_version") or "") != question_version(question):
        raise ValueError("문항이 수정되었습니다. 다시 열어 주세요.")
    if type(payload.get("question_revision")) is not int or payload["question_revision"] != int(question.get("revision") or 0):
        raise ValueError("풀이 상태가 변경되었습니다. 문제를 다시 열어 주세요.")


def _selected_option(question: dict, value: Any, *, allow_empty: bool = False) -> str:
    selected = str(value or "").strip()
    if allow_empty and not selected:
        return ""
    if selected not in {str(option.get("id")) for option in question.get("options") or []}:
        raise ValueError("보기를 선택해 주세요.")
    return selected


def _elapsed_seconds(question: dict, now: float) -> int:
    timer = question.get("timer") or {}
    elapsed = max(0.0, float(timer.get("elapsed_seconds") or 0))
    started = timer.get("started_at")
    if started is not None:
        elapsed += max(0.0, now - float(started))
    return int(elapsed)


def _public_question(question: dict, *, now: float) -> dict:
    current = question.get("current_result")
    displayed_current = {**current, "explanation": question.get("explanation", "")} if isinstance(current, dict) else None
    attempts = question.get("attempts") or []
    if not current:
        # Retain progress without revealing a previous correct choice on retry.
        attempts = [
            {key: attempt.get(key) for key in ("id", "graded_at", "elapsed_seconds")}
            for attempt in attempts
        ]
    result = {
        **rounds.metadata(question),
        "id": question["id"],
        "ordinal": question.get("ordinal"),
        "question": question.get("question", ""),
        "options": question.get("options") or [],
        "source_file": question.get("source_file", ""),
        "question_version": question_version(question),
        "question_revision": int(question.get("revision") or 0),
        "selected_option_id": question.get("selected_option_id") or "",
        "answer_type": question.get("answer_type") or "multiple_choice",
        "answer_text": question.get("answer_text") or "",
        "elapsed_seconds": _elapsed_seconds(question, now),
        "timer_running": (question.get("timer") or {}).get("started_at") is not None,
        "attempts": attempts,
        "current_result": displayed_current,
        "ai_hint": question.get("ai_hint"),
    }
    if current:
        result["answer_option_id"] = question.get("answer_option_id", "")
        if question.get("answer_type") == "short_answer":
            result["reference_answer"] = question.get("reference_answer", "")
        result["explanation"] = question.get("explanation", "")
    return result


def get_practice_set(path: str) -> dict:
    with PRACTICE_SET_LOCK:
        ensure_summary_review_set(path)
        data = _load(path)
        now = time.time()
        questions = [_public_question(question, now=now) for question in data.get("questions") or []]
        return {"set": {
            "set_id": data["set_id"],
            "valid": bool(data.get("valid")),
            "errors": data.get("errors") or [],
            "question_count": len(questions),
            "completed_count": sum(bool(question["current_result"]) for question in questions),
            "questions": questions,
            "last_question_id": data.get("last_question_id", ""),
        }}


def _mutate(path: str, payload: Mapping[str, Any], change) -> dict:
    with PRACTICE_SET_LOCK:
        data = _load(path, require_valid=True)
        question = _question(data, str(payload.get("question_id") or ""))
        _check_identity(data, question, payload)
        response, should_save = change(question)
        if should_save:
            data["last_question_id"] = question["id"]
            latest = _load(path, require_valid=True)
            if latest.get("markdown_sha256") != data.get("markdown_sha256") or latest.get("set_id") != data.get("set_id"):
                raise ValueError("연습문제 파일이 변경되었습니다. 다시 열어 주세요.")
            _write_json_atomic(practice_data_path(path), data)
        return {"question": _public_question(question, now=time.time()), **response}


def save_practice_answer(path: str, payload: Mapping[str, Any]) -> dict:
    def change(question: dict) -> tuple[dict, bool]:
        if question.get("current_result"):
            raise ValueError("채점된 문항입니다. 다시 풀기를 시작해 주세요.")
        if question.get("answer_type") == "short_answer":
            question["answer_text"] = _answer_text(payload)
        else:
            selected = _selected_option(question, payload.get("selected_option_id"), allow_empty=True)
            question["selected_option_id"] = selected
        return {}, True
    return _mutate(path, payload, change)


def update_practice_timer(path: str, payload: Mapping[str, Any]) -> dict:
    action = str(payload.get("action") or "")
    if action not in {"start", "pause"}:
        raise ValueError("타이머 동작은 start 또는 pause여야 합니다.")

    def change(question: dict) -> tuple[dict, bool]:
        if question.get("current_result"):
            raise ValueError("채점된 문항입니다. 다시 풀기를 시작해 주세요.")
        now = time.time()
        timer = question.setdefault("timer", {"elapsed_seconds": 0, "started_at": None})
        if action == "start" and timer.get("started_at") is None:
            timer["started_at"] = now
        elif action == "pause" and timer.get("started_at") is not None:
            timer["elapsed_seconds"] = _elapsed_seconds(question, now)
            timer["started_at"] = None
        return {}, True
    return _mutate(path, payload, change)


def grade_practice_answer(path: str, payload: Mapping[str, Any]) -> dict:
    """Compare stored IDs only; this function never resolves an AI provider."""

    attempt_id = str(payload.get("attempt_id") or "").strip()
    try:
        uuid.UUID(attempt_id)
    except (ValueError, AttributeError):
        raise ValueError("유효한 시도 ID가 필요합니다.") from None

    def change(question: dict) -> tuple[dict, bool]:
        selected = _selected_option(question, payload.get("selected_option_id"))
        for attempt in question.get("attempts") or []:
            if attempt.get("id") == attempt_id:
                if attempt.get("selected_option_id") != selected:
                    raise ValueError("이미 사용한 시도 ID의 답안이 다릅니다.")
                if question.get("current_result") != attempt:
                    raise ValueError("이전 시도 ID는 다시 사용할 수 없습니다. 새 시도로 제출해 주세요.")
                return {"grading": attempt, "duplicate": True, "stale": question.get("current_result") != attempt}, False
        if question.get("current_result"):
            raise ValueError("이미 채점된 문항입니다. 다시 풀기를 시작해 주세요.")
        now = time.time()
        elapsed = _elapsed_seconds(question, now)
        attempt = {
            "id": attempt_id,
            "question_version": question_version(question),
            "question_revision": int(question.get("revision") or 0),
            "selected_option_id": selected,
            "answer_option_id": question["answer_option_id"],
            "correct": selected == question["answer_option_id"],
            "explanation": question.get("explanation", ""),
            "elapsed_seconds": elapsed,
            "graded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        question.setdefault("attempts", []).append(attempt)
        question["selected_option_id"] = selected
        question["current_result"] = attempt
        question["timer"] = {"elapsed_seconds": elapsed, "started_at": None}
        question.pop("solve_current_snapshot", None)
        question["solve_current_snapshot"] = rounds.snapshot(question, elapsed=elapsed, material=True)
        return {"grading": attempt, "duplicate": False, "stale": False}, True

    return _mutate(path, payload, change)


def _answer_text(payload: Mapping[str, Any]) -> str:
    value = payload.get("answer_text", "")
    if not isinstance(value, str) or len(value) > 20_000:
        raise ValueError("답안은 20,000자 이내의 텍스트로 입력해 주세요.")
    return value.strip()


def grade_practice_submission(path: str, payload: Mapping[str, Any], grade_text, *, check_text_grading=None) -> dict:
    """Compare locally first; journal remaining subjective calls before network I/O."""
    answer = _answer_text(payload)
    attempt_id = str(payload.get("attempt_id") or "")
    uuid.UUID(attempt_id)
    with PRACTICE_SET_LOCK:
        data = _load(path, require_valid=True)
        question = _question(data, str(payload.get("question_id") or ""))
        _check_identity(data, question, payload)
        if question.get("answer_type") != "short_answer":
            return grade_practice_answer(path, payload)
        if not answer:
            raise ValueError("주관식 답안을 입력해 주세요.")
        for attempt in question.get("attempts") or []:
            if attempt.get("id") == attempt_id:
                if attempt.get("answer_text") != answer or question.get("current_result") != attempt:
                    raise ValueError("이전 시도 ID는 다른 답안이나 재도전에 사용할 수 없습니다.")
                return {"question": _public_question(question, now=time.time()), "grading": attempt, "duplicate": True, "stale": False}
        if question.get("current_result"):
            raise ValueError("이미 채점된 문항입니다. 다시 풀기를 시작해 주세요.")
        calls = data.setdefault("grading_calls", {})
        saved = calls.get(attempt_id)
        binding = {"question_id": question["id"], "version": question_version(question),
                   "revision": int(question.get("revision") or 0), "answer_text": answer}
        if saved and saved.get("binding") != binding:
            raise ValueError("이미 사용한 시도 ID의 답안이 다릅니다.")
        if saved and "result" not in saved:
            raise ValueError("이 채점 요청이 진행 중이거나 결과가 확인되지 않았습니다. 잠시 후 다시 열어 확인해 주세요.")
        if not saved:
            local_result = compare_reference_answer(answer, question.get("reference_answer"))
            if local_result is None and check_text_grading is not None:
                check_text_grading()
            if any(call.get("status") == "pending" and all(
                    call.get("binding", {}).get(key) == binding[key]
                    for key in ("question_id", "version", "revision")) for call in calls.values()):
                raise ValueError("이 문항의 AI 채점이 진행 중입니다.")
            calls[attempt_id] = {"binding": binding, "status": "pending"}
            if local_result is None:
                from documents.practice_grading_context import grading_snapshot
                calls[attempt_id]["grading_context"] = grading_snapshot("material", path)
            if local_result is not None:
                saved = calls[attempt_id]
                saved.update(status="received", result=local_result)
            question["answer_text"] = answer
            _write_json_atomic(practice_data_path(path), data)
        grading_input = {"problem_text": question["question"], "answer_type": "short_answer",
                         "answer_text": answer, "reference_answer": question.get("reference_answer", ""),
                         "explanation": question.get("explanation", "")}
        if calls[attempt_id].get("grading_context"):
            grading_input["grading_context"] = calls[attempt_id]["grading_context"]
    if saved:
        result = saved["result"]
    else:
        try:
            result = grade_text(grading_input)
        except Exception:
            with PRACTICE_SET_LOCK:
                latest = _load(path)
                if latest.get("set_id") == data["set_id"]:
                    latest["grading_calls"][attempt_id]["status"] = "failed"
                    _write_json_atomic(practice_data_path(path), latest)
            raise
        # Preserve the paid result even if the question changed while awaiting AI.
        with PRACTICE_SET_LOCK:
            latest = _load(path)
            if latest.get("set_id") != data["set_id"]:
                raise ValueError("채점 중 연습문제 세트가 바뀌었습니다.")
            latest["grading_calls"][attempt_id].update(status="received", result=result)
            _write_json_atomic(practice_data_path(path), latest)

    def apply(question: dict) -> tuple[dict, bool]:
        if question.get("answer_text") != answer:
            raise ValueError("채점 중 답안이 변경되었습니다. 현재 답안을 다시 제출해 주세요.")
        current = question.get("current_result")
        if current:
            if current.get("id") == attempt_id:
                return {"grading": current, "duplicate": True, "stale": False}, False
            raise ValueError("이미 다른 답안으로 채점되었습니다.")
        now = time.time()
        attempt = {**result, "id": attempt_id, "question_version": question_version(question),
                   "question_revision": int(question.get("revision") or 0), "answer_text": answer,
                   "explanation": question.get("explanation", ""), "elapsed_seconds": _elapsed_seconds(question, now),
                   "graded_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        question.setdefault("attempts", []).append(attempt)
        question["current_result"] = attempt
        question["timer"] = {"elapsed_seconds": attempt["elapsed_seconds"], "started_at": None}
        question.pop("solve_current_snapshot", None)
        question["solve_current_snapshot"] = rounds.snapshot(question, elapsed=attempt["elapsed_seconds"], material=True)
        return {"grading": attempt, "duplicate": False, "stale": False}, True
    return _mutate(path, payload, apply)


def restart_question(question: dict, *, require_graded: bool = True) -> bool:
    if require_graded and not question.get("current_result"):
        raise ValueError("채점 후 다시 풀기를 시작해 주세요.")
    if not rounds.has_progress(question, material=True):
        return False
    rounds.advance(question, rounds.snapshot(question, elapsed=_elapsed_seconds(question, time.time()), material=True))
    question["revision"] = int(question.get("revision") or 0) + 1
    question["current_result"] = None
    question["selected_option_id"] = ""
    question["answer_text"] = ""
    question["timer"] = {"elapsed_seconds": 0, "started_at": None}
    return True


def retry_practice_question(path: str, payload: Mapping[str, Any]) -> dict:
    def change(question: dict) -> tuple[dict, bool]:
        return {}, restart_question(question)
    return _mutate(path, payload, change)


def practice_history(path: str, payload: Mapping[str, Any]) -> dict:
    with PRACTICE_SET_LOCK:
        data = _load(path)
        question = _question(data, str(payload.get("question_id") or ""))
        _check_identity(data, question, payload)
        return {"rounds": rounds.history(question, elapsed=_elapsed_seconds(question, time.time()), material=True)}


def select_practice_question(path: str, payload: Mapping[str, Any]) -> dict:
    return _mutate(path, payload, lambda _question: ({}, True))


def get_practice_hint_input(path: str, payload: Mapping[str, Any]) -> dict:
    with PRACTICE_SET_LOCK:
        data = _load(path, require_valid=True)
        question = _question(data, str(payload.get("question_id") or ""))
        _check_identity(data, question, payload)
        selected = question.get("selected_option_id")
        selected_index = next(
            (index for index, option in enumerate(question["options"]) if option["id"] == selected), None,
        )
        return {
            "problem_text": question["question"],
            "answer_type": question.get("answer_type") or "multiple_choice",
            "answer_text": question.get("answer_text", ""),
            "choices": [option["text"] for option in question["options"]],
            "selected_choice": selected_index,
            "hint": question.get("ai_hint"),
        }


def save_practice_hint(path: str, payload: Mapping[str, Any], hint: str, provider: str, model: str) -> dict:
    def change(question: dict) -> tuple[dict, bool]:
        question["ai_hint"] = {"text": hint, "provider": provider, "model": model}
        return {}, True
    return _mutate(path, payload, change)
