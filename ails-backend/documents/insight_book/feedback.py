"""Optional focused feedback contract; legacy paid gate responses remain readable."""
from .contracts import text


FIELDS = {
    "VERIFIED": ((), ("extension",)),
    "PARTIALLY_CORRECT": (("correction",), ("extension",)),
    "INCORRECT": (("reason", "concept"), ()),
    "UNCERTAIN": (("uncertainty", "check"), ()),
}


def validate_feedback(claim, row):
    if "summary" in claim:
        row["summary"] = text(claim["summary"], "주장 요약", 6000)
    if "feedback" not in claim:
        return  # Do not regenerate or rewrite stored responses using the old contract.
    feedback = claim["feedback"]
    required, optional = FIELDS[row["verdict"]]
    if not isinstance(feedback, dict) or set(feedback) - set(required + optional):
        raise ValueError("판정에 맞는 학습 피드백 항목만 제공해야 합니다.")
    row["summary"] = text(claim.get("summary"), "주장 요약", 6000)
    row["feedback"] = {field: text(feedback.get(field, ""), field, 6000, empty=field in optional)
                       for field in required + optional}
    if row["verdict"] == "INCORRECT" and row["feedback"]["concept"].strip() != row["corrected"].strip():
        raise ValueError("표시할 올바른 개념과 복습에 사용할 교정 내용이 일치해야 합니다.")
