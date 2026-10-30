"""Submission snapshots and result application shared by single and batch grading."""
from __future__ import annotations
import hashlib
import json
from typing import Mapping
import chat.theory_search
import code_services.code_executor
import code_services.code_grading
import documents.problem_answering
import documents.problem_manager
from documents.problem_answering import ANSWER_TYPE_CODE, ANSWER_TYPE_SHORT_ANSWER, normalize_answer_type

def prepare_problem_grading(payload: dict, language=None) -> dict:
    pdf_path = payload.get("pdf_path", "")
    base_dir = payload.get("base_dir", "")
    problem_id = payload.get("problem_id", "")
    problem = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, problem_id)
    from documents.practice_rounds import check_round
    check_round(problem, payload.get("solve_round_id"))
    requested_attempt_id = str(payload.get("attempt_id", "") or "").strip()
    last_grading = problem.get("last_grading")
    if (
        requested_attempt_id
        and isinstance(last_grading, Mapping)
        and str(last_grading.get("attempt_id", "") or "") == requested_attempt_id
    ):
        previous = dict(last_grading)
        try:
            previous_revision = max(1, int(previous.get("revision", 1) or 1))
        except (TypeError, ValueError, OverflowError):
            previous_revision = 1
        return {
            **previous,
            "problem": problem,
            "status": problem.get("status"),
            "status_label": problem.get("status_label"),
            "related_theory": list(problem.get("related_theory") or []),
            "attempt_id": requested_attempt_id,
            "revision": previous_revision,
            "application_status": "duplicate",
            "applied": False,
        }
    answer_type = normalize_answer_type(
        problem.get("answer_type")
        or (ANSWER_TYPE_CODE if problem.get("is_code_problem") else ANSWER_TYPE_SHORT_ANSWER)
    )
    files = payload.get("files") if isinstance(payload.get("files"), list) else []
    active_file = ""
    active_code = ""

    if answer_type == ANSWER_TYPE_CODE:
        project_name = str(payload.get("project_name", "") or "").strip()
        documents.problem_manager.validate_problem_project(problem, project_name)
        if not files:
            stored = code_services.code_executor.get_code_project_files(base_dir=base_dir, project_name=project_name)
            if stored.get("success"):
                files = stored.get("files") or []
        active_file = str(payload.get("active_file_name") or payload.get("file_name") or "").strip()
        if not active_file and files:
            active_file = str(files[0].get("name", "") or "")
        active_code = str(payload.get("code", "") or "")
        if not active_code:
            selected = next(
                (
                    item
                    for item in files
                    if str(item.get("name", "") or "").replace("\\", "/")
                    == active_file.replace("\\", "/")
                ),
                None,
            )
            if selected:
                active_code = str(selected.get("code", "") or "")
        grading_messages = code_services.code_grading.build_grading_messages({
            "problem_text": problem.get("problem_text", ""),
            "file_name": active_file,
            "code": active_code,
            "files": files,
            "language": payload.get("language", "plaintext"),
            "run_result": payload.get("run_result"),
        }, language=language)
    else:
        nested_answer = payload.get("answer")
        if not isinstance(nested_answer, Mapping):
            nested_answer = {}
        has_answer_payload = any(
            key in nested_answer or key in payload
            for key in ("answer_text", "selected_choice")
        )
        if has_answer_payload:
            answer_text = (
                nested_answer.get("answer_text")
                if "answer_text" in nested_answer
                else payload.get("answer_text", "")
            )
            selected_choice = (
                nested_answer.get("selected_choice")
                if "selected_choice" in nested_answer
                else payload.get("selected_choice")
            )
            problem = documents.problem_manager.save_problem_answer(
                pdf_path,
                base_dir,
                problem_id,
                answer_text=answer_text,
                selected_choice=selected_choice,
                **({"expected_round_id": problem["solve_round_id"]} if problem.get("solve_round_id") else {}),
            )

        persisted_answer = problem.get("draft_answer")
        if not isinstance(persisted_answer, Mapping):
            persisted_answer = {}
        grading_messages = documents.problem_answering.build_answer_grading_messages({
            "problem_text": problem.get("problem_text", ""),
            "answer_type": answer_type,
            "choices": problem.get("choices") or [],
            "answer_text": persisted_answer.get(
                "answer_text",
                problem.get("answer_text", ""),
            ),
            "selected_choice": persisted_answer.get(
                "selected_choice",
                problem.get("selected_choice"),
            ),
        }, language=language)

    from documents.practice_grading_context import grading_snapshot, include_grading_context
    context = grading_snapshot("pdf", pdf_path, base_dir)
    grading_messages = include_grading_context(grading_messages, context)

    # Register a grading attempt only after the complete submission has been
    # normalized. Invalid or incomplete answers must not stop a running timer
    # or leave a pending grading revision behind.
    if answer_type == ANSWER_TYPE_CODE:
        submission_payload = {
            "answer_type": answer_type,
            "files": sorted(
                (
                    {
                        "name": str(item.get("name", "") or "").replace("\\", "/"),
                        "code": str(item.get("code", "") or ""),
                    }
                    for item in files
                    if isinstance(item, Mapping)
                ),
                key=lambda item: item["name"].casefold(),
            ),
        }
        submission_hash = hashlib.sha256(
            json.dumps(
                submission_payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8", errors="surrogatepass")
        ).hexdigest()
    else:
        submission_hash = str(problem.get("current_answer_hash", "") or "")
    grading_attempt = documents.problem_manager.begin_problem_grading(
        pdf_path,
        base_dir,
        problem_id,
        attempt_id=payload.get("attempt_id"),
        submission_hash=submission_hash,
        expected_round_id=problem.get("solve_round_id"),
        submission={"files": files} if answer_type == ANSWER_TYPE_CODE else problem.get("draft_answer"),
    )
    problem = grading_attempt["problem"]
    attempt_id = grading_attempt["attempt_id"]
    grading_revision = grading_attempt["revision"]
    if grading_attempt["submission_status"] == "already_applied":
        previous = dict(problem.get("last_grading") or {})
        return {
            **previous,
            "problem": problem,
            "status": problem.get("status"),
            "status_label": problem.get("status_label"),
            "related_theory": list(problem.get("related_theory") or []),
            "attempt_id": attempt_id,
            "revision": grading_revision,
            "application_status": "duplicate",
            "applied": False,
        }

    return {"payload": dict(payload), "problem": problem, "messages": grading_messages, "grading_context": context, "attempt_id": attempt_id, "revision": grading_revision, "submission_status": grading_attempt["submission_status"]}


def complete_problem_grading(prepared: dict, grading: dict, *, provider_label: str, model_name: str, usage=None, observe_grading=None, on_warning=None) -> dict:
    payload = prepared["payload"]
    problem = prepared["problem"]
    pdf_path = payload.get("pdf_path", "")
    base_dir = payload.get("base_dir", "")
    problem_id = payload.get("problem_id", "")
    attempt_id = prepared["attempt_id"]
    grading_revision = prepared["revision"]
    theory_results = []
    theory_search_meta = {}
    theory_search_warning = ""
    try:
        theory_search = chat.theory_search.hybrid_search_pdf(
            pdf_path,
            core_concepts=grading.get("core_concepts") or grading.get("suggestions") or [problem.get("chapter", "")],
            search_keywords=grading.get("search_keywords") or grading.get("core_concepts") or [],
            exercise_page=int(problem.get("page") or 1),
            exercise_page_end=int(problem.get("page_end") or problem.get("page") or 1),
            problem_chapter=str(problem.get("chapter") or ""),
            limit=6,
        )
        theory_results = list(theory_search.get("results") or [])
        theory_search_meta = {
            key: theory_search.get(key)
            for key in ("weights", "chapter", "embedding_backend", "degraded")
            if key in theory_search
        }
    except Exception as search_error:
        theory_search_warning = str(search_error)
    persisted_theory = theory_results if not theory_search_warning else list(problem.get("related_theory") or [])
    run_result = payload.get("run_result") if isinstance(payload.get("run_result"), dict) else {}
    run_action = str(run_result.get("action") or "").strip().lower()
    mistake_source = (
        "test" if run_action == "test"
        else "compile" if run_action == "build"
        else "run" if run_result.get("success") is False
        else "grading"
    )
    updated_problem = documents.problem_manager.apply_problem_grading(
        pdf_path,
        base_dir,
        problem_id,
        grading,
        provider=provider_label,
        model=model_name,
        related_theory=persisted_theory,
        mistake_source=mistake_source,
        attempt_id=attempt_id,
        revision=grading_revision,
        **({"expected_answer_hash": prepared["expected_answer_hash"]} if prepared.get("expected_answer_hash") else {}),
    )
    grading_application = dict(updated_problem.get("grading_application") or {})
    result = {
        **grading,
        "provider": provider_label,
        "model": model_name,
        "problem": updated_problem,
        "status": updated_problem.get("status"),
        "status_label": updated_problem.get("status_label"),
        "related_theory": persisted_theory,
        "theory_search": theory_search_meta,
        "attempt_id": attempt_id,
        "revision": grading_revision,
        "application_status": grading_application.get("status", "stale"),
        "applied": grading_application.get("status") == "applied",
    }
    if theory_search_warning:
        result["theory_search_warning"] = theory_search_warning
    if usage:
        result["usage"] = usage
    if observe_grading is not None and result["applied"]:
        try:
            rows = observe_grading(str(updated_problem.get("chapter") or "일반"),
                [*(grading.get("core_concepts") or []), *(grading.get("search_keywords") or [])], bool(grading.get("correct")))
            result["mastery_updates"] = [row.to_api() for row in rows]
        except Exception as error:
            if on_warning is not None:
                on_warning(f"학습 수준 갱신 실패: {error}")
    return result
