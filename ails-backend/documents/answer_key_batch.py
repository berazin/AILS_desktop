"""Document-wide answer mapping and one explicit confirmation for selected rows."""
from collections import Counter


def annotate_rows(rows, candidates, current_problems, validate_policy):
    by_id = {item["id"]: item for item in candidates}
    problems = {item["id"]: item for item in current_problems}
    proposed = []
    for row in rows:
        candidate = by_id.get(row["candidate_ids"][0]) if len(row["candidate_ids"]) == 1 else None
        reason = "정답 없음" if not row["candidate_ids"] else "중복 번호 · 정답 선택 필요"
        ready = False
        if candidate:
            reason = ""
            problem = problems[row["problem_id"]]
            if candidate.get("continues_after_page"):
                reason = "다음 페이지에 이어지는 답 확인 필요"
            elif candidate.get("method") == "saved_ocr" or candidate.get("confidence", 1) < .95:
                reason = "OCR 판독 확인 필요"
            else:
                try:
                    validate_policy(candidate, {}, problem)
                    ready = True
                except ValueError as error:
                    reason = str(error)
            proposed.append(candidate["id"] if ready else None)
        else:
            proposed.append(None)
        row["batch"] = {"candidate_id": candidate["id"] if candidate else "", "ready": ready, "reason": reason}
    counts = Counter(item for item in proposed if item)
    for row in rows:
        item = row["batch"]
        if item["ready"] and counts[item["candidate_id"]] > 1:
            item.update(ready=False, reason="여러 문제가 같은 정답 후보와 겹칩니다.")
    return rows


def confirm_batch(payload):
    from documents import answer_key_store as keys
    items = payload.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 1000:
        raise ValueError("연결할 문제를 1~1,000개 선택해 주세요.")
    if any(not isinstance(item, dict) or not isinstance(item.get("problem_id"), str) or not item["problem_id"] for item in items):
        raise ValueError("연결할 문제 목록이 잘못되었습니다.")
    ids = [item["problem_id"] for item in items]
    if len(set(ids)) != len(ids):
        raise ValueError("같은 문제를 중복해서 연결할 수 없습니다.")
    candidate_ids = [item.get("candidate_id") for item in items]
    if any(not isinstance(value, str) or not value for value in candidate_ids) or len(set(candidate_ids)) != len(candidate_ids):
        raise ValueError("문제마다 서로 다른 정답 후보를 선택해 주세요.")
    pdf_path, base_dir = payload["pdf_path"], payload["base_dir"]
    path = keys.store_path(pdf_path, base_dir)
    common = {key: payload.get(key) for key in ("preview_id", "verified", "edition_verified", "verification_note")}
    if common["verified"] is not True or common["edition_verified"] is not True or not str(common["verification_note"] or "").strip():
        raise ValueError("선택한 문제의 대응 목록과 원본 답지를 확인해 주세요.")
    with keys.problems._path_lock(path):
        data = keys.refresh_locked(keys.problems._read_json(path), pdf_path, base_dir)
        # Validate every row before changing any links or grading state.
        links = []
        policy_fields = ("answer", "criteria", "kind", "accepted_answers", "absolute_tolerance")
        for index, item in enumerate(items):
            try:
                old = data.get("links", {}).get(item["problem_id"])
                preview = data.get("previews", {}).get(common["preview_id"], {})
                same = old and old.get("status") == "confirmed" and old["source"] == preview.get("source") and old["candidate_id"] == item["candidate_id"] and old["problem_version"] == item.get("problem_version")
                defaults = {key: old["policy"][key] for key in policy_fields if key in old["policy"]} if same else {}
                prepared = keys.prepare_confirmed_link(data, pdf_path, base_dir, item["problem_id"], {**defaults, **item, **common})
                if same and prepared["policy"] == old["policy"]:
                    prepared = {**old, "problem_id": item["problem_id"]}
                links.append(prepared)
            except ValueError as error:
                raise ValueError(f"선택 목록의 {index + 1}번째 문제: {error}") from error
        keys.save_confirmed_links(data, pdf_path, base_dir, links)
        return {"status": "confirmed", "count": len(links), "problems": [keys.problems.get_pdf_problem(pdf_path, base_dir, problem_id) for problem_id in ids]}
