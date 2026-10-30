"""Apply the existing material-file access boundary before evidence navigation."""
from chat.answer_evidence import evidence_for_chunks, resolve_evidence


def answer_evidence_request(config, payload, *, anchor=False):
    from documents.material_workspace_support import ensure_safe_material_path
    raw = payload if anchor else payload.get("evidence")
    if not isinstance(raw, dict):
        return {"status": "unavailable", "reason": "검증 가능한 근거 정보가 없습니다."}
    try:
        path = ensure_safe_material_path(raw.get("path", ""), str(config.get("md_save_path") or ""))
    except FileNotFoundError:
        return {"evidence": [], "status": "missing", "reason": "원문 파일 또는 학습자료 폴더를 찾을 수 없습니다."}
    if anchor:
        return {"evidence": evidence_for_chunks(path, [{"page": payload.get("page")}])}
    # Preserve the source identity exactly; validation above only checks access.
    return resolve_evidence(raw)
