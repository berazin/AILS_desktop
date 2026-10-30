"""Automatically connect unambiguous answers contained in the problem PDF."""
import time

from documents import answer_key_store as keys, problem_manager as problems
from documents.answer_key_links import build_link
from documents.answer_key_sources import PARSER_VERSION, digest, file_version
from documents.answer_key_validity import same_grading_content

AUTO_CONNECT_VERSION = 1


def _source_question_unchanged(problem):
    if not problem.get("problem_edit"):
        return True
    original = problem.get("paddleocr_original")
    if not isinstance(original, dict):
        return False
    source = {**problem, **{key: original[key] for key in ("problem_text", "number", "page", "page_end", "choices") if key in original}}
    return same_grading_content(source, problem)


def _summary(data, state, *, newly_connected=0, cached=False):
    return {"status": state["status"], "reason": state.get("reason", ""), "newly_connected": newly_connected,
            "automatic_count": sum(link.get("verified_by") == "automatic" and link.get("status") == "confirmed" for link in data.get("links", {}).values()),
            "review_count": len(state.get("held", {})), "cached": cached}


def ensure_auto_connections(pdf_path, base_dir, *, catalog=None):
    catalog = catalog if catalog is not None else problems.list_pdf_problems(pdf_path, base_dir)
    if not catalog.get("scanned") or not catalog.get("problems"):
        return {"status": "skipped", "newly_connected": 0, "automatic_count": 0, "review_count": 0, "cached": False}
    path = keys.store_path(pdf_path, base_dir)
    # This separate lock also serializes discovery, without locking the answer
    # store while opening PDFium. Manual editing remains available during reads.
    with problems._path_lock(path + ".auto"):
        version = file_version(pdf_path)
        with problems._path_lock(path):
            from documents.problem_catalog_snapshot import raw_problem_states
            current = raw_problem_states(pdf_path, base_dir)
            data = keys.refresh_locked(problems._read_json(path), pdf_path, base_dir, current_problems=current)
        excluded = set(data.get("auto_connect_excluded", []))
        current = {item["id"]: current[item["id"]] for item in catalog["problems"] if item["id"] in current}
        eligible = {ident for ident in current if ident not in excluded and ident not in data.get("links", {})}
        if not eligible:
            return _summary(data, {"status": "skipped"}, cached=True)
        signature = digest({"pdf": version, "parser": PARSER_VERSION, "auto": AUTO_CONNECT_VERSION,
                            "problems": {ident: keys.problem_version(item) for ident, item in current.items()}, "excluded": sorted(excluded)})
        cached = data.get("auto_connect", {})
        if cached.get("signature") == signature and (cached.get("status") != "unreadable" or time.time() - cached.get("checked_at", 0) < 30):
            return _summary(data, cached, cached=True)
        try:
            preview = keys.preview({"pdf_path": pdf_path, "base_dir": base_dir, "source_path": pdf_path,
                                    "auto_detect": True, "hide_answers": True})
        except Exception as error:
            preview = {"status": "unreadable", "reason": str(error), "rows": [], "candidates": []}
        state = {"signature": signature, "source_version": version, "checked_at": time.time(), "held": {},
                 "status": "not_found" if (preview.get("discovery") or {}).get("status") == "not_found" else "unreadable",
                 "reason": preview.get("reason", "")}
        with problems._path_lock(path):
            data = keys.refresh_locked(problems._read_json(path), pdf_path, base_dir)
            if file_version(pdf_path) != version:
                return {"status": "unreadable", "reason": "자동 연결 중 PDF가 변경됐습니다. 문제 목록을 다시 불러와 주세요.",
                        "newly_connected": 0, "automatic_count": 0, "review_count": 0, "cached": False}
            candidates = {item["id"]: item for item in preview["candidates"]}
            prepared = []
            for row in preview["rows"]:
                ident = row["problem_id"]
                if ident not in eligible or ident in data.get("auto_connect_excluded", []) or ident in data.get("links", {}):
                    continue
                batch = row.get("batch", {})
                if not batch.get("ready"):
                    state["held"][ident] = batch.get("reason") or "정답 대응 확인 필요"
                    continue
                problem = keys.raw_problem(pdf_path, base_dir, ident)
                if keys.problem_version(problem) != row["problem_version"]:
                    state["held"][ident] = "자동 연결 중 문제 내용이 변경됐습니다."
                    continue
                if not _source_question_unchanged(problem):
                    state["held"][ident] = "PDF 원문과 질문·보기가 달라 정답 대응을 직접 확인해야 합니다."
                    continue
                candidate = candidates[batch["candidate_id"]]
                policy = keys.policy_from_payload(candidate, {}, problem)
                prepared.append(build_link(problem, candidate, preview["source"], pdf_path, policy, keys.subquestions(problem),
                    verified_by="automatic", note="동일 PDF의 텍스트 답지에서 문항 번호·소문항과 유일한 정답을 자동 대응했습니다."))
            if preview["status"] == "ready":
                state["status"] = "partial" if state["held"] else "ready"
                state["reason"] = "확인이 필요한 정답 후보가 있습니다." if state["held"] else "PDF 안의 답지를 자동으로 연결했습니다."
            data["auto_connect"] = state
            keys.save_confirmed_links(data, pdf_path, base_dir, prepared)
            return _summary(data, state, newly_connected=len(prepared))


def study_problems(pdf_path, base_dir, *, scan=False, chapter_name="", reuse_cached=True):
    catalog = problems.scan_pdf_problems(pdf_path, base_dir, chapter_name=chapter_name, reuse_cached=reuse_cached) if scan else problems.list_pdf_problems(pdf_path, base_dir)
    automatic = ensure_auto_connections(pdf_path, base_dir, catalog=catalog)
    if catalog.get("problems"):
        catalog["problems"] = problems.list_pdf_problems(pdf_path, base_dir)["problems"]
    return {**catalog, "answer_key_auto": automatic}
