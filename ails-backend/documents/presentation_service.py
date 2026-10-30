from __future__ import annotations

import os
import hashlib
import re
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from documents.presentation_conversion import run_presentation_conversion

from common import TEMP_DIR_NAME
import common
import pdf.pdf_viewer_data

def extract_pptx_text_for_viewer(file_path: str, max_chars: int = 60000) -> str:
    import xml.etree.ElementTree as ET

    slide_entries = []
    with zipfile.ZipFile(file_path) as archive:
        for name in archive.namelist():
            match = re.match(r"ppt/slides/slide(\d+)\.xml$", name)
            if match:
                slide_entries.append((int(match.group(1)), name))
        slide_entries.sort()

        parts = []
        for slide_number, name in slide_entries:
            try:
                root = ET.fromstring(archive.read(name))
            except Exception:
                continue
            texts = []
            for node in root.iter():
                if node.tag.endswith("}t") and node.text:
                    text = common.normalize_whitespace(node.text)
                    if text:
                        texts.append(text)
            if texts:
                parts.append(f"## Slide {slide_number}\n\n" + "\n\n".join(texts))
            if sum(len(part) for part in parts) >= max_chars:
                parts.append("\n\n_텍스트 미리보기는 일부만 표시되었습니다._")
                break
    return "\n\n".join(parts).strip()


def extract_legacy_ppt_text_for_viewer(file_path: str, max_chars: int = 60000) -> str:
    with open(file_path, "rb") as handle:
        data = handle.read()
    texts = []
    for pattern in (rb"(?:[\x20-\x7e]\x00){4,}", rb"[\x20-\x7e]{4,}"):
        for match in re.finditer(pattern, data):
            raw = match.group(0)
            encoding = "utf-16le" if b"\x00" in raw else "latin-1"
            text = common.normalize_whitespace(raw.decode(encoding, errors="ignore").replace("\x00", ""))
            if text and not re.fullmatch(r"[\W_]+", text):
                texts.append(text)
            if sum(len(item) for item in texts) >= max_chars:
                break
    seen = set()
    unique_texts = []
    for text in texts:
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        unique_texts.append(text)
    return "\n\n".join(unique_texts).strip()


def read_presentation_text_for_viewer(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    try:
        content = extract_pptx_text_for_viewer(file_path) if ext == ".pptx" else extract_legacy_ppt_text_for_viewer(file_path)
    except Exception as error:
        content = f"_PPT 텍스트 미리보기를 생성하지 못했습니다: {error}_"
    return content or "_이 프레젠테이션에서 추출 가능한 텍스트를 찾지 못했습니다._"


def find_libreoffice_executable() -> str:
    candidates = [
        shutil.which("soffice"),
        shutil.which("soffice.exe"),
        os.path.expandvars(r"%ProgramFiles%\LibreOffice\program\soffice.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\LibreOffice\program\soffice.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\LibreOffice\program\soffice.exe"),
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return os.path.abspath(candidate)
    return ""


def libreoffice_status() -> dict:
    executable = find_libreoffice_executable()
    return {
        "installed": bool(executable),
        "path": executable,
        "install_supported": sys.platform.startswith("win") and bool(shutil.which("winget")),
        "package_id": "TheDocumentFoundation.LibreOffice",
    }


def install_libreoffice_with_winget(timeout_seconds: int = 1800) -> dict:
    if not sys.platform.startswith("win"):
        raise RuntimeError("LibreOffice 자동 설치는 현재 Windows winget 환경에서만 지원됩니다.")
    winget = shutil.which("winget")
    if not winget:
        raise RuntimeError("winget을 찾을 수 없어 LibreOffice를 자동 설치할 수 없습니다.")
    before = find_libreoffice_executable()
    if before:
        return {"installed": True, "path": before, "already_installed": True}
    command = [
        winget,
        "install",
        "--id",
        "TheDocumentFoundation.LibreOffice",
        "-e",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
    ]
    completed = subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout_seconds,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    executable = find_libreoffice_executable()
    if completed.returncode != 0 and not executable:
        output = (completed.stdout or "").strip()
        raise RuntimeError(f"LibreOffice 설치에 실패했습니다. winget 종료 코드 {completed.returncode}: {output[-1000:]}")
    return {"installed": bool(executable), "path": executable, "output": (completed.stdout or "")[-2000:]}


def presentation_pdf_cache_path(file_path: str) -> str:
    normalized = os.path.abspath(file_path)
    stat_info = os.stat(normalized)
    identity = hashlib.sha256(os.path.normcase(normalized).encode("utf-8")).hexdigest()[:16]
    safe_name = identity + "_" + re.sub(r"[^a-zA-Z0-9_.-]+", "_", os.path.basename(normalized))
    stamp = f"{stat_info.st_mtime_ns}_{stat_info.st_size}"
    cache_dir = os.path.join(TEMP_DIR_NAME, "presentation_pdf_cache")
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, f"{safe_name}.{stamp}.pdf")


_PRESENTATION_CONVERT_STATES_LOCK = threading.Lock()
_PRESENTATION_CONVERT_STATES: dict[str, dict] = {}
_PRESENTATION_CONVERT_PATH_LOCKS: dict[str, threading.Lock] = {}
PRESENTATION_CONVERT_WAIT_TIMEOUT_SECONDS = 190


def _presentation_convert_path_lock(path: str) -> threading.Lock:
    with _PRESENTATION_CONVERT_STATES_LOCK:
        lock = _PRESENTATION_CONVERT_PATH_LOCKS.get(path)
        if lock is None:
            lock = threading.Lock()
            _PRESENTATION_CONVERT_PATH_LOCKS[path] = lock
        return lock


def _set_presentation_convert_state(path: str, **fields) -> None:
    with _PRESENTATION_CONVERT_STATES_LOCK:
        state = _PRESENTATION_CONVERT_STATES.setdefault(path, {})
        state.update(fields)


def presentation_convert_status(file_path: str) -> dict:
    normalized = os.path.abspath(file_path)
    try:
        cache_ready = _presentation_cache_pdf_usable(presentation_pdf_cache_path(normalized))
    except OSError:
        cache_ready = False
    with _PRESENTATION_CONVERT_STATES_LOCK:
        state = dict(_PRESENTATION_CONVERT_STATES.get(normalized) or {})
    started_at = float(state.get("started_at") or 0.0)
    ended_at = float(state.get("finished_at") or time.time())
    elapsed = max(0.0, ended_at - started_at) if started_at else 0.0
    state_name = str(state.get("state") or ("ready" if cache_ready else "idle"))
    return {
        "active": state_name == "converting",
        "state": state_name,
        "elapsed_seconds": round(elapsed, 1),
        "error": str(state.get("error") or ""),
        "cache_ready": cache_ready,
    }


def _presentation_cache_pdf_usable(path: str) -> bool:
    # Failed exports can leave empty or non-PDF files behind.
    try:
        with open(path, "rb") as stream:
            return stream.read(5) == b"%PDF-"
    except OSError:
        return False


def convert_presentation_to_pdf(file_path: str) -> str:
    executable = find_libreoffice_executable()
    if not executable:
        raise RuntimeError("LIBREOFFICE_REQUIRED: PPT/PPTX 렌더링에는 LibreOffice가 필요합니다.")
    normalized = os.path.abspath(file_path)
    target_pdf = presentation_pdf_cache_path(normalized)
    if _presentation_cache_pdf_usable(target_pdf):
        _set_presentation_convert_state(normalized, state="ready", finished_at=time.time(), error="")
        return target_pdf
    # The same document shares one export; different documents own isolated jobs.
    convert_lock = _presentation_convert_path_lock(normalized)
    if not convert_lock.acquire(timeout=PRESENTATION_CONVERT_WAIT_TIMEOUT_SECONDS):
        raise RuntimeError("다른 PPT/PPTX 변환이 완료되지 않아 대기 시간이 초과되었습니다.")
    try:
        target_pdf = presentation_pdf_cache_path(normalized)
        if _presentation_cache_pdf_usable(target_pdf):
            _set_presentation_convert_state(normalized, state="ready", finished_at=time.time(), error="")
            return target_pdf
        _set_presentation_convert_state(normalized, state="converting", started_at=time.time(), finished_at=0, error="")
        try:
            run_presentation_conversion(executable, normalized, target_pdf)
        except Exception as error:
            _set_presentation_convert_state(normalized, state="failed", finished_at=time.time(), error=str(error)[:300])
            raise
        _set_presentation_convert_state(normalized, state="ready", finished_at=time.time())
        return target_pdf
    finally:
        convert_lock.release()


def extract_presentation_pdf_data(rendered_pdf_path: str) -> dict:
    """변환된 슬라이드 PDF의 페이지 텍스트를 디스크 캐시와 함께 추출한다.

    변환 결과 파일명에 원본 mtime_크기가 포함되어 원본이 바뀌면 캐시 키가 자동으로 바뀐다.
    """
    normalized = os.path.abspath(rendered_pdf_path)
    fingerprint = pdf.pdf_viewer_data.pdf_file_fingerprint(normalized)
    cached = pdf.pdf_viewer_data.load_pdf_text_cache(normalized, fingerprint)
    if cached is not None:
        return cached
    pdf_data = pdf.pdf_viewer_data.extract_pdf_viewer_data(normalized)
    try:
        pdf.pdf_viewer_data.save_pdf_text_cache(normalized, fingerprint, pdf_data)
    except Exception:
        pass
    return pdf_data


