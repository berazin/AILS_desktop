"""Persisted varied review questions and conservative spaced mastery."""
from __future__ import annotations

import time

from .contracts import REVIEW_FORMS, parse_object, text
from .harness import InsightCancelled
from .store import new_id


def question_contract(raw):
    result = parse_object(raw)
    return {field: text(result.get(field), field, 6000) for field in ("question", "expected", "rubric")}


def grade_contract(raw):
    result = parse_object(raw)
    if type(result.get("understood")) is not bool:
        raise ValueError("이해도 판정이 누락됐습니다.")
    return {"understood": result["understood"], "feedback": text(result.get("feedback"), "피드백", 6000)}


def process_review(store, run, harness):
    payload = run["payload"]
    wrong = store.require("wrong", payload["wrong_id"])
    history = [store.require("review", key) for key in wrong["review_ids"]]
    if run["kind"] == "question":
        pending = next((row for row in history if not row.get("graded_at")), None)
        if pending:
            store.update_run(run["id"], outcome="question_ready", review_id=pending["id"])
            return
        if wrong["next_review"] > time.time():
            raise ValueError("다음 복습 시간이 아직 되지 않았습니다.")
        form = REVIEW_FORMS[len(history) % len(REVIEW_FORMS)]
        result = harness.ask("question", {"claim": wrong["claim"], "evidence": wrong["evidence"], "form": form,
                                           "previous_questions": [row["question"] for row in history[-6:]]}, question_contract)
        with store.transaction() as db:
            current = store.require("run", run["id"], db)
            if current.get("cancel_requested"):
                raise InsightCancelled("문제 저장 전에 취소되었습니다.")
            if current.get("review_id"):
                return
            latest = store.require("wrong", wrong["id"], db)
            if latest["review_ids"] != wrong["review_ids"]:
                raise ValueError("복습 기록이 변경됐습니다. 다시 열어주세요.")
            review = {**result, "id": new_id(), "wrong_id": wrong["id"], "form": form, "created_at": time.time()}
            store.put("review", review["id"], review, db)
            latest["review_ids"].append(review["id"])
            store.put("wrong", latest["id"], latest, db)
            current.update(outcome="question_ready", review_id=review["id"], state="done", phase="question_ready")
            store.put("run", run["id"], current, db)
        return
    review = store.require("review", payload["review_id"])
    if review["wrong_id"] != wrong["id"]:
        raise ValueError("복습 문항과 오개념이 일치하지 않습니다.")
    answer = text(payload.get("answer"), "답안", 10000)
    if review.get("graded_at"):
        if review["answer"] != answer:
            raise ValueError("이미 채점한 문항의 답안을 변경할 수 없습니다.")
        store.update_run(run["id"], outcome="graded", review_id=review["id"])
        return
    result = harness.ask("grade", {"question": review["question"], "expected": review["expected"],
                                    "rubric": review["rubric"], "answer": answer}, grade_contract)
    with store.transaction() as db:
        current = store.require("run", run["id"], db)
        if current.get("cancel_requested"):
            raise InsightCancelled("채점 적용 전에 취소되었습니다.")
        latest_review = store.require("review", review["id"], db)
        if latest_review.get("graded_at"):
            if latest_review["answer"] != answer:
                raise ValueError("다른 답안의 채점이 이미 적용됐습니다.")
            return
        now = time.time()
        latest_review.update(answer=answer, grading=result, graded_at=now)
        store.put("review", review["id"], latest_review, db)
        latest = store.require("wrong", wrong["id"], db)
        mastery = latest["mastery"]
        if result["understood"]:
            mastery["successes"] += 1
            mastery["forms"] = list(dict.fromkeys([*mastery["forms"], review["form"]]))
            if mastery["first_success"] is None:
                mastery["first_success"] = now
            # At least three forms, spaced sessions, and two elapsed days; one success never resolves it.
            if mastery["successes"] >= 3 and len(mastery["forms"]) >= 3 and now - mastery["first_success"] >= 2 * 86400:
                latest["status"] = "mastered"
            delay_days = (1, 3, 7, 14, 30)[min(mastery["successes"] - 1, 4)]
        else:
            mastery.update(successes=0, forms=[], first_success=None)
            latest["status"] = "learning"
            delay_days = 1
        latest["next_review"] = now + delay_days * 86400
        store.put("wrong", latest["id"], latest, db)
        current.update(outcome="graded", review_id=review["id"], state="done", phase="graded")
        store.put("run", run["id"], current, db)
