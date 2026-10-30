"""Compare stored practice answers without inferring semantic equivalence."""

from __future__ import annotations

import unicodedata


def compare_reference_answer(answer: str, reference_answer: object) -> dict | None:
    if not isinstance(reference_answer, str) or not reference_answer.strip() or not answer.strip():
        return None
    # Preserve case, inner whitespace, punctuation, signs and units for AI review.
    submitted = unicodedata.normalize("NFC", answer.strip())
    reference = unicodedata.normalize("NFC", reference_answer.strip())
    if submitted != reference:
        return None
    return {
        "correct": True,
        "verdict": "correct",
        "feedback": "저장된 모범 답안과 일치합니다.",
        "provider": "모범 답안 로컬 비교",
        "model": "deterministic",
    }
