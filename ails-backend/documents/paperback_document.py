"""Paperback sidecar adapter for non-PDF reading documents."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence

PAPERBACK_EXTENSIONS = frozenset({".epub", ".mobi", ".azw", ".azw3", ".fb2", ".txt", ".rtf"})
PAPERBACK_CACHE_VERSION = 1
# Earlier RTF parsing could cache an empty body when \pard was absent. Keep
# other formats' caches, but require RTF to be read by the corrected parser.
_FORMAT_CACHE_VERSIONS = {".rtf": 2}
MAX_SOURCE_BYTES = 512 * 1024 * 1024
MAX_MODEL_BYTES = 128 * 1024 * 1024
MAX_SECTIONS = 100_000
MAX_BLOCKS = 1_000_000


class PaperbackDocumentError(RuntimeError):
    pass


def _parser_command() -> list[str]:
    filename = "ails-paperback-prototype.exe" if os.name == "nt" else "ails-paperback-prototype"
    # Resource lookup must also work in the one-shot viewer without importing
    # common's AI/image/network dependency graph.
    backend = Path(__file__).resolve().parents[1]
    resources = Path(sys.executable).parent if getattr(sys, 'frozen', False) else backend.parent
    candidates = (
        resources / "_internal" / "tools" / "paperback" / filename,
        resources / "tools" / "paperback" / filename,
        backend / "tools" / "paperback" / filename,
        Path(__file__).resolve().parents[1]
        / "build"
        / "paperback_document_model"
        / "release"
        / filename,
        Path(__file__).resolve().parents[1]
        / "native"
        / "paperback-document-model"
        / "target"
        / "release"
        / filename,
    )
    for candidate in candidates:
        if candidate.is_file():
            return [str(candidate)]
    raise PaperbackDocumentError(
        "Paperback 문서 파서를 찾을 수 없습니다. 정식 패키지에는 파서가 포함되어야 합니다."
    )


def _cache_root(cache_dir: str | os.PathLike[str] | None) -> Path:
    if cache_dir is not None:
        return Path(cache_dir)
    local = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return Path(local) / "AILS" / "document_model_cache"


def _fingerprint(path: Path) -> dict[str, int | str]:
    stat = path.stat()
    return {
        "version": _FORMAT_CACHE_VERSIONS.get(path.suffix.lower(), PAPERBACK_CACHE_VERSION),
        "path": os.path.normcase(str(path.resolve())),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def _cache_path(path: Path, cache_dir: str | os.PathLike[str] | None) -> Path:
    digest = hashlib.sha256(os.path.normcase(str(path.resolve())).encode("utf-8")).hexdigest()
    return _cache_root(cache_dir) / f"{digest}.json"


def _validate_location(value: object) -> dict:
    if not isinstance(value, dict) or value.get("kind") not in {"pdf", "reflow"}:
        raise PaperbackDocumentError("문서 위치 정보가 올바르지 않습니다.")
    if value["kind"] == "reflow":
        required = {"section_index", "element", "offset", "length", "native_offset", "native_unit"}
    else:
        required = {"page", "x", "y", "width", "height"}
    if not required.issubset(value):
        raise PaperbackDocumentError("문서 위치 정보가 불완전합니다.")
    return value


def validate_document_model(value: object, source_path: Path) -> dict:
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise PaperbackDocumentError("지원하지 않는 AILS Document Model입니다.")
    metadata = value.get("metadata")
    toc = value.get("toc")
    sections = value.get("sections")
    if not isinstance(metadata, dict) or not isinstance(toc, list) or not isinstance(sections, list):
        raise PaperbackDocumentError("AILS Document Model 구조가 올바르지 않습니다.")
    if len(sections) > MAX_SECTIONS:
        raise PaperbackDocumentError("문서 섹션 수가 안전 한도를 초과했습니다.")
    if not isinstance(metadata.get("title", ""), str) or not isinstance(metadata.get("creators", []), list):
        raise PaperbackDocumentError("문서 메타데이터가 올바르지 않습니다.")
    metadata["source_path"] = str(source_path)

    block_count = 0
    for index, section in enumerate(sections):
        if not isinstance(section, dict) or not isinstance(section.get("blocks"), list):
            raise PaperbackDocumentError(f"{index + 1}번 섹션 구조가 올바르지 않습니다.")
        _validate_location(section.get("location"))
        block_count += len(section["blocks"])
        if block_count > MAX_BLOCKS:
            raise PaperbackDocumentError("문서 블록 수가 안전 한도를 초과했습니다.")
        for block in section["blocks"]:
            if not isinstance(block, dict) or block.get("type") not in {"heading", "paragraph", "image", "table"}:
                raise PaperbackDocumentError("지원하지 않는 문서 블록입니다.")
            _validate_location(block.get("location"))
            block_type = block["type"]
            if block_type in {"heading", "paragraph"} and not isinstance(block.get("text"), str):
                raise PaperbackDocumentError("문서 텍스트 블록이 올바르지 않습니다.")
            if block_type == "table":
                rows = block.get("rows")
                if not isinstance(rows, list) or any(
                    not isinstance(row, list) or any(not isinstance(cell, str) for cell in row)
                    for row in rows
                ):
                    raise PaperbackDocumentError("문서 표 블록이 올바르지 않습니다.")

    toc_count = 0
    stack = [(item, 1) for item in toc]
    while stack:
        item, depth = stack.pop()
        toc_count += 1
        if toc_count > MAX_SECTIONS or depth > 32 or not isinstance(item, dict):
            raise PaperbackDocumentError("문서 목차가 안전 한도를 초과했습니다.")
        _validate_location(item.get("location"))
        children = item.get("children", [])
        if not isinstance(children, list):
            raise PaperbackDocumentError("문서 목차 구조가 올바르지 않습니다.")
        stack.extend((child, depth + 1) for child in children)
    return value


def document_model_to_markdown(document: dict) -> str:
    metadata = document["metadata"]
    lines = [f"# {metadata.get('title') or '제목 없음'}"]
    creators = [str(value).strip() for value in metadata.get("creators", []) if str(value).strip()]
    if creators:
        lines.extend(("", f"저자: {', '.join(creators)}"))
    for section in document["sections"]:
        for block in section["blocks"]:
            block_type = block["type"]
            if block_type == "heading":
                level = min(6, max(1, int(block.get("level", 1))))
                lines.extend(("", f"{'#' * level} {block['text'].strip()}"))
            elif block_type == "paragraph" and block["text"].strip():
                lines.extend(("", block["text"].strip()))
            elif block_type == "image":
                label = str(block.get("alt") or block.get("source_ref") or "이미지").strip()
                lines.extend(("", f"> 이미지: {label}"))
            elif block_type == "table":
                rows = [[str(cell).replace("|", "\\|") for cell in row] for row in block["rows"] if isinstance(row, list)]
                if rows:
                    width = max(len(row) for row in rows)
                    normalized = [row + [""] * (width - len(row)) for row in rows]
                    lines.extend(("", f"| {' | '.join(normalized[0])} |", f"| {' | '.join(['---'] * width)} |"))
                    lines.extend(f"| {' | '.join(row)} |" for row in normalized[1:])
                elif str(block.get("text", "")).strip():
                    lines.extend(("", str(block["text"]).strip()))
    return "\n".join(lines).strip() + "\n"


def read_cached_paperback_document(
    file_path: str | os.PathLike[str],
    *,
    cache_dir: str | os.PathLike[str] | None = None,
) -> tuple[dict, str] | None:
    """Read an existing, current viewer cache without invoking the native parser."""
    path = Path(file_path).resolve()
    try:
        cached = json.loads(_cache_path(path, cache_dir).read_text(encoding="utf-8"))
        if cached.get("fingerprint") == _fingerprint(path):
            document = validate_document_model(cached.get("document"), path)
            return document, document_model_to_markdown(document)
    except (OSError, ValueError, PaperbackDocumentError, AttributeError):
        pass
    return None


def read_paperback_document(
    file_path: str | os.PathLike[str],
    *,
    parser_command: Sequence[str] | None = None,
    cache_dir: str | os.PathLike[str] | None = None,
) -> tuple[dict, str]:
    path = Path(file_path).resolve()
    if not path.is_file() or path.suffix.lower() not in PAPERBACK_EXTENSIONS:
        raise PaperbackDocumentError("지원하는 비-PDF 문서 파일이 아닙니다.")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise PaperbackDocumentError("문서 파일이 안전 한도를 초과했습니다.")
    fingerprint = _fingerprint(path)
    cache_path = _cache_path(path, cache_dir)
    cached = read_cached_paperback_document(path, cache_dir=cache_dir)
    if cached is not None:
        return cached

    command = list(parser_command or _parser_command())
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        try:
            completed = subprocess.run(
                [*command, str(path)],
                stdout=stdout,
                stderr=stderr,
                timeout=120,
                check=False,
                creationflags=creation_flags,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise PaperbackDocumentError(f"문서 파서를 실행하지 못했습니다: {error}") from error
        stdout.seek(0, os.SEEK_END)
        if stdout.tell() > MAX_MODEL_BYTES:
            raise PaperbackDocumentError("변환된 문서 모델이 안전 한도를 초과했습니다.")
        stdout.seek(0)
        if completed.returncode != 0:
            stderr.seek(0)
            detail = stderr.read(8192).decode("utf-8", errors="replace").strip()
            raise PaperbackDocumentError(f"문서 변환에 실패했습니다: {detail or completed.returncode}")
        try:
            document = validate_document_model(json.load(stdout), path)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PaperbackDocumentError(f"문서 파서 응답이 올바른 JSON이 아닙니다: {error}") from error

    temp_path: Path | None = None
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f"{cache_path.name}.", suffix=".tmp", dir=cache_path.parent
        )
        os.close(descriptor)
        temp_path = Path(temp_name)
        temp_path.write_text(
            json.dumps({"fingerprint": fingerprint, "document": document}, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(temp_path, cache_path)
    except OSError:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
    return document, document_model_to_markdown(document)
