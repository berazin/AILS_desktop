"""Existing authenticated local API boundary for per-source grading background."""
import os
from collections.abc import Mapping

from documents.practice_grading_context import read_context, save_context


def handle_practice_grading_context(state, method, payload):
    if not isinstance(payload, Mapping):
        raise ValueError("채점 문맥 요청은 객체여야 합니다.")
    kind = payload.get("kind")
    path = payload.get("path", "")
    base_dir = payload.get("base_dir", "")
    if kind == "material":
        path = state._practice_path(path)
    elif kind == "pdf":
        if not isinstance(path, str) or not path.lower().endswith(".pdf") or not os.path.isfile(path):
            raise ValueError("문제풀이 PDF를 확인해 주세요.")
    else:
        raise ValueError("지원하지 않는 문제풀이 자료입니다.")
    if method == "GET":
        return {"context": read_context(kind, path, base_dir)}
    return {"context": save_context(kind, path, base_dir, text=payload.get("text"), expected_revision=payload.get("expected_revision"))}
