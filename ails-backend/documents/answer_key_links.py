"""Shared evidence shape for user-confirmed and same-PDF automatic links."""
from documents.answer_key_sources import digest, file_version, normalized_path
from documents.answer_key_validity import problem_snapshot, problem_version


def build_link(problem, candidate, source, pdf_path, policy, parts, *, verified_by, note):
    link = {"status": "confirmed", "source": source, "candidate_id": candidate["id"],
            "original_candidate": candidate, "policy": policy,
            "problem_source": {"path": normalized_path(pdf_path), "version": file_version(pdf_path),
                               "page": problem["page"], "page_end": problem["page_end"],
                               "label_bbox": problem.get("label_bbox"), "chapter": problem["chapter"],
                               "number": problem["number"], "subquestions": sorted(parts)},
            "problem_version": problem_version(problem), "problem_snapshot": problem_snapshot(problem),
            "verified_by": verified_by, "verification_note": note[:2000]}
    link["revision"] = digest(link)
    link["problem_id"] = problem["id"]
    return link
