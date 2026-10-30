"""Validated bulk round changes. Material sets commit once; PDF states roll back on write failure."""
from __future__ import annotations

import copy
from contextlib import ExitStack
from documents import practice_rounds as rounds


def validated_items(payload: dict, *, key: str) -> tuple[str, list[dict]]:
    mode, items = payload.get("mode"), payload.get("items")
    if mode not in {"wrong", "selected", "all"}:
        raise ValueError("다시 풀기 범위를 확인해 주세요.")
    if not isinstance(items, list) or not items or len(items) > 5000:
        raise ValueError("다시 풀 문제를 1~5000개 선택해 주세요.")
    ids = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get(key), str) or not item[key].strip():
            raise ValueError("다시 풀 문항 ID를 확인해 주세요.")
        ids.append(item[key])
    if len(set(ids)) != len(ids):
        raise ValueError("다시 풀 문항이 중복되었습니다.")
    return mode, items


def retry_material_questions(path: str, payload: dict) -> dict:
    from documents import material_practice_solving as material
    from documents.material_practice_lock import PRACTICE_SET_LOCK
    from documents.material_practice_service import _write_json_atomic, practice_data_path

    mode, items = validated_items(payload, key="question_id")
    with PRACTICE_SET_LOCK:
        data = material._load(path, require_valid=True)
        targets = []
        for item in items:
            question = material._question(data, item["question_id"])
            material._check_identity(data, question, {**item, "set_id": payload.get("set_id")})
            if mode == "wrong" and rounds.latest_correct(question) is not False:
                raise ValueError("오답 문항의 채점 상태가 변경되었습니다. 목록을 다시 열어 주세요.")
            targets.append(question)
        if mode == "all" and {item["id"] for item in targets} != {item["id"] for item in data["questions"]}:
            raise ValueError("문제 목록이 변경되었습니다. 전체 목록을 다시 열어 주세요.")
        changed = sum(material.restart_question(question, require_graded=False) for question in targets)
        data["last_question_id"] = targets[0]["id"]
        _write_json_atomic(practice_data_path(path), data)
        return {"set": material.get_practice_set(path)["set"], "target_ids": [item["id"] for item in targets], "changed_count": changed}


def retry_pdf_problems(pdf_path: str, base_dir: str, payload: dict) -> dict:
    from documents import problem_manager as manager
    from documents.problem_solve_rounds import restart_problem_state

    mode, items = validated_items(payload, key="problem_id")
    # _locked_problem holds the catalog lock as well as each state lock. Stable
    # ordering keeps scans, grading and overlapping bulk requests serialized.
    with ExitStack() as stack:
        locked = {}
        for item in sorted(items, key=lambda entry: entry["problem_id"]):
            descriptor, path = stack.enter_context(manager._locked_problem(pdf_path, base_dir, item["problem_id"]))
            original = manager._read_json(path)
            state = manager._validated_problem_state(descriptor, original)
            rounds.check_round(state, item.get("solve_round_id"))
            if mode == "wrong" and rounds.latest_correct(state) is not False:
                raise ValueError("오답 문항의 채점 상태가 변경되었습니다. 목록을 다시 열어 주세요.")
            locked[item["problem_id"]] = (path, original, state)
        if mode == "all":
            _, catalog = manager._load_catalog(pdf_path, base_dir)
            if set(locked) != {item["id"] for item in catalog.get("problems") or []}:
                raise ValueError("문제 목록이 변경되었습니다. 전체 목록을 다시 열어 주세요.")
        now = manager._utc_now()
        changed = []
        for item in items:
            path, _, state = locked[item["problem_id"]]
            updated = copy.deepcopy(state)
            if restart_problem_state(updated, base_dir, now, require_graded=False, draft_files=item.get("draft_files")):
                updated["updated_at"] = manager._iso_time(now)
                changed.append((path, updated))
                locked[item["problem_id"]] = (path, locked[item["problem_id"]][1], updated)
        written = []
        try:
            for path, updated in changed:
                written.append(path)
                manager._atomic_write_json(path, updated)
        except Exception as error:
            originals = {path: original for path, original, _ in locked.values()}
            failed = []
            for path in reversed(written):
                try:
                    manager._atomic_write_json(path, originals[path])
                except OSError:
                    failed.append(path)
            if failed:
                raise RuntimeError("다시 풀기 저장과 일부 상태 복구에 실패했습니다. 폴더 쓰기 권한을 확인해 주세요.") from error
            raise
    problems = [manager._answer_key_public_state(manager._state_response(locked[item["problem_id"]][2], now=now), pdf_path, base_dir) for item in items]
    return {"problems": problems, "target_ids": [item["problem_id"] for item in items], "changed_count": len(changed)}
