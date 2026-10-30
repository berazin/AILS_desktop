"""Fresh, request-local read views for saved questions and answer-key metadata."""
import os

from documents import answer_key_store as keys, answer_key_visibility as visibility


def raw_problem_states(pdf_path, base_dir):
    """Validate one catalog, then read each learner state exactly once."""
    from documents import problem_manager as store
    _, catalog = store._load_catalog(pdf_path, base_dir)
    if os.path.isfile(pdf_path) and catalog.get("pdf_fingerprint") and not store._catalog_matches_pdf(catalog, pdf_path):
        raise ValueError("PDF가 변경되었습니다. 문제를 다시 인식해 주세요.")
    return {item["id"]: store._state_response(store._validated_problem_state(item,
            store._read_json(store._state_path(base_dir, item))))
            for item in catalog.get("problems", []) if isinstance(item, dict)}


class ProblemPublicView:
    """Share immutable evidence reads only while assembling one public result."""
    def __init__(self, pdf_path, base_dir, *, data=None):
        from documents.answer_key_sources import read_only_json
        self.pdf_path, self.base_dir = pdf_path, base_dir
        self.data = read_only_json(keys.store_path(pdf_path, base_dir)) if data is None else data
        self.versions = {}
        self.redaction = visibility.problem_redaction_context(pdf_path, self.data)

    def apply(self, problem):
        key_status = keys.status(self.pdf_path, self.base_dir, problem, data=self.data, versions=self.versions)
        problem["answer_key"] = key_status
        if self.redaction is not None:
            problem = visibility.redact_problem(self.pdf_path, problem, context=self.redaction)
            problem["ai_hint"] = None
        from documents.problem_ai_grading import is_ai_evidence, evidence_is_current
        evidence = (problem.get("last_grading") or {}).get("evidence")
        stale_grading = (not evidence_is_current(evidence, problem, self.pdf_path) if is_ai_evidence(evidence)
                         else key_status["status"] != "confirmed")
        if evidence and stale_grading:
            from documents.problem_manager import STATUS_LABELS
            problem["last_grading"] = None
            problem["status"] = "in_progress"
            problem["status_label"] = STATUS_LABELS["in_progress"]
        return problem
