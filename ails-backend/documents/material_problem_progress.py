"""Read saved problem progress for the visible directory, without scanning PDFs."""
from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from collections.abc import Mapping

from documents import material_practice_service, practice_rounds, problem_manager
from system_storage import resolve_system_path

logger = logging.getLogger(__name__)


def document_problem_base(path: str) -> str:
    """Match the document/semester storage used by useCodeSandboxWorkspace."""
    document = Path(os.path.abspath(path))
    parts = document.parts
    for index, part in enumerate(parts[:-1]):
        if re.fullmatch(r"\d+\s*학년\s*\d+\s*학기", part.strip()) and index + 2 < len(parts):
            return resolve_system_path(str(Path(*parts[:index + 2]) / ".codes"))
    return resolve_system_path(str(document.parent / f".{document.stem}.codes"))


def _solved(problem: Mapping) -> bool:
    # A wrong submission is still a solved question. Drafts, timers and hints
    # alone are not submissions; starting another round keeps previous work.
    return (problem.get("status") == "completed"
            or type(problem.get("last_solve_correct")) is bool
            or practice_rounds.latest_correct(problem) is not None)


def _saved_pdf_progress(path: str, storage: str) -> dict | None:
    # Counters must not build public question bodies, redact answer text, or
    # revalidate answer-key sources. Those reads belong to the solving view.
    _, catalog = problem_manager._load_catalog(path, storage)
    version = int(catalog.get("schema_version") or 0)
    if version and not problem_manager._catalog_matches_pdf(catalog, path):
        return None
    if 0 < version < problem_manager.OLDEST_DISPLAYABLE_CATALOG_VERSION:
        return None
    problems = [item for item in catalog.get("problems", []) if isinstance(item, Mapping)]
    if not problems:
        return None
    solved = 0
    for descriptor in problems:
        state = problem_manager._read_json(problem_manager._state_path(storage, descriptor))
        if state and not problem_manager._problem_identity_matches(state, descriptor):
            raise ValueError("문제 상태 파일이 다른 PDF 또는 문제에 속합니다.")
        solved += _solved(state)
    return {"solved": solved, "total": len(problems)}


def material_problem_progress(path: str, kind: str) -> dict | None:
    if kind.lower() == "pdf":
        storage = document_problem_base(path)
        # Listing must not create a project for a document never analyzed.
        if not os.path.isdir(os.path.join(storage, problem_manager.HIDDEN_PROBLEM_DIR)):
            return None
        return _saved_pdf_progress(path, storage)
    elif kind.lower() == "md":
        data = material_practice_service.load_practice_set(path)
        problems = data.get("questions", []) if data and data.get("valid") else []
    else:
        return None
    if not problems:
        return None
    return {"solved": sum(_solved(problem) for problem in problems), "total": len(problems)}


def annotate_material_problem_progress(directory: dict) -> dict:
    """The input is a fresh shallow listing; never enumerate its descendants."""
    for folder in directory.get("folders", []):
        for file in folder.get("files", []):
            try:
                progress = material_problem_progress(file["file_path"], file["kind"])
                if progress is not None:
                    file["problem_progress"] = progress
            except (OSError, ValueError, KeyError, TypeError):
                logger.warning("Cannot read saved problem progress for %s", file.get("file_path"), exc_info=True)
                file["problem_progress_error"] = "문제 풀이 기록을 불러오지 못했습니다."
    return directory
