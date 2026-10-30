"""PDF round transitions and explicit history lookup; originals stay untouched."""
from __future__ import annotations

import os
import uuid
import tempfile
from documents import practice_rounds as rounds


def _save_code_drafts(state: dict, base_dir: str, files: list) -> None:
    from documents import problem_manager as manager
    from code_services.code_executor import _safe_file_name, RESERVED_CODE_PROJECT_FILES

    problem = manager._state_response(state)
    if problem["answer_type"] != "code":
        raise ValueError("코드 문항의 답안 파일만 저장할 수 있습니다.")
    if not isinstance(files, list) or len(files) > 200:
        raise ValueError("코드 답안 파일 목록을 확인해 주세요.")
    root = manager._inside_base(base_dir, problem["folder_path"])
    if os.path.commonpath([os.path.realpath(base_dir), os.path.realpath(root)]) != os.path.realpath(base_dir):
        raise ValueError("코드 문제 폴더가 저장 폴더 밖을 가리킵니다.")
    planned = []
    for file in files:
        if not isinstance(file, dict):
            raise ValueError("코드 답안 파일을 확인해 주세요.")
        raw_name = str(file.get("name") or "")
        name = _safe_file_name(raw_name)
        if name.replace("\\", "/") != raw_name.replace("\\", "/"):
            raise ValueError("코드 답안 파일 이름을 확인해 주세요.")
        if name.lower() in {item.lower() for item in RESERVED_CODE_PROJECT_FILES}:
            raise ValueError("문제 메타데이터는 답안으로 저장할 수 없습니다.")
        target = os.path.join(root, name)
        if os.path.commonpath([os.path.realpath(root), os.path.realpath(target)]) != os.path.realpath(root):
            raise ValueError("코드 답안이 문제 폴더 밖을 가리킵니다.")
        code = file.get("code")
        if not isinstance(code, str):
            raise ValueError("코드 답안은 텍스트여야 합니다.")
        planned.append((target, code))
    # Validate the entire batch before writing; preserve every unsubmitted file.
    for target, code in planned:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".solve-draft-", dir=os.path.dirname(target))
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
                handle.write(code)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def save_code_drafts(pdf_path: str, base_dir: str, problem_id: str, expected_round_id: str, files: list) -> dict:
    from documents import problem_manager as manager
    def save(state, _now):
        rounds.check_round(state, expected_round_id)
        _save_code_drafts(state, base_dir, files)
        return state
    return manager._mutate_problem(pdf_path, base_dir, problem_id, save)


def restart_problem_state(state: dict, base_dir: str, now, *, require_graded: bool = True, draft_files=None) -> bool:
    from documents import problem_manager as manager
    if require_graded and not state.get("last_grading"):
        raise ValueError("채점 후 다시 풀기를 시작해 주세요.")
    if draft_files:
        _save_code_drafts(state, base_dir, draft_files)
    is_code = manager._state_response(state)["answer_type"] == "code"
    progress = rounds.has_progress(state)
    if is_code and not state.get("last_grading"):
        from code_services.code_executor import RESERVED_CODE_PROJECT_FILES
        root = manager._inside_base(base_dir, state.get("solve_workspace_path") or state["folder_path"])
        if os.path.commonpath([os.path.realpath(base_dir), os.path.realpath(root)]) != os.path.realpath(base_dir):
            raise ValueError("코드 문제 폴더가 저장 폴더 밖을 가리킵니다.")
        files = []
        if os.path.isdir(root):
            for entry in os.scandir(root):
                if entry.is_dir(follow_symlinks=False):
                    progress = True
                    continue
                if entry.name in RESERVED_CODE_PROJECT_FILES or not entry.is_file(follow_symlinks=False):
                    continue
                if entry.stat().st_size:
                    progress = True
                    if entry.stat().st_size <= 80_000:
                        try:
                            with open(entry.path, encoding="utf-8") as handle:
                                text = handle.read()
                            if "\0" not in text:
                                files.append({"name": entry.name, "code": text})
                        except UnicodeError:
                            continue
        if files:
            state["solve_submission"] = {"files": files}
    if not progress:
        return False
    record = rounds.snapshot(state, elapsed=manager._state_response(state, now=now)["effective_elapsed_seconds"])
    rounds.advance(state, record)
    if is_code:
        relative = f".ails-problems/round-workspaces/{state['id']}/round-{rounds.round_number(state)}-{uuid.uuid4().hex}"
        target = manager._inside_base(base_dir, relative)
        base_real, target_real = os.path.realpath(base_dir), os.path.realpath(target)
        if os.path.commonpath([base_real, target_real]) != base_real:
            raise ValueError("코드 회차 폴더가 저장 폴더 밖을 가리킵니다.")
        manager._ensure_code_folder(base_dir, {**state, "folder_path": relative})
        state["solve_workspace_path"] = relative
    state.update(status="in_progress", elapsed_seconds=0, timer_started_at=None,
                 last_grading=None, pending_grading=None, ai_hint_used=False,
                 draft_answer={"answer_text": "", "selected_choice": None, "updated_at": manager._iso_time(now)},
                 core_concepts=[], search_keywords=[], related_theory=[],
                 grading_revision=manager._grading_revision(state) + 1,
                 last_applied_grading_attempt_id=None, last_applied_grading_revision=0)
    return True


def retry_problem(pdf_path: str, base_dir: str, problem_id: str, expected_round_id: str, draft_files=None) -> dict:
    from documents import problem_manager as manager
    def retry(state, now):
        rounds.check_round(state, expected_round_id)
        restart_problem_state(state, base_dir, now, draft_files=draft_files)
        return state
    return manager._mutate_problem(pdf_path, base_dir, problem_id, retry)


def problem_history(pdf_path: str, base_dir: str, problem_id: str) -> dict:
    from documents import problem_manager as manager

    with manager._locked_problem(pdf_path, base_dir, problem_id) as (descriptor, path):
        state = manager._validated_problem_state(descriptor, manager._read_json(path))
        return {"rounds": rounds.history(state, elapsed=manager._state_response(state)["effective_elapsed_seconds"])}
