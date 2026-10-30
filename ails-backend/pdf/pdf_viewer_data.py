"""PDF 뷰어 데이터 추출과 텍스트 캐시.

api_modules/api_pdf_viewer.py와 documents/presentation_service.py가 함께 쓰는
PDF 도메인 로직. API 계층이 아니라 pdf 패키지에 두어 기능 패키지가 API 계층을
참조하지 않도록 한다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from pathlib import Path


class PdfPasswordRequiredError(RuntimeError):
    code = "PDF_PASSWORD_REQUIRED"

    def __init__(self):
        super().__init__("PDF_PASSWORD_REQUIRED: 이 PDF는 비밀번호가 필요합니다.")


class PdfPasswordInvalidError(RuntimeError):
    code = "PDF_PASSWORD_INVALID"

    def __init__(self):
        super().__init__("PDF_PASSWORD_INVALID: PDF 비밀번호가 올바르지 않습니다.")

PDF_TEXT_CACHE_VERSION = 1
PDF_TEXT_PREVIEW_MAX_PAGES = 80
PDF_TEXT_PREVIEW_MAX_CHARS = 60000

PYPDF_WRONG_POINTING_PREFIX = "Ignoring wrong pointing object "
PYPDF_WRONG_POINTING_OFFSET_ZERO_SUFFIX = " (offset 0)"
_pypdf_wrong_pointing_filter_lock = threading.Lock()
_pypdf_wrong_pointing_filter_installed = False


class _WrongPointingObjectOffsetZeroFilter(logging.Filter):
    """pypdf already recovered these objects; keep only that handled warning quiet."""

    def filter(self, record):
        message = record.getMessage()
        return not (
            message.startswith(PYPDF_WRONG_POINTING_PREFIX)
            and message.endswith(PYPDF_WRONG_POINTING_OFFSET_ZERO_SUFFIX)
        )


def install_pypdf_wrong_pointing_log_filter() -> None:
    """Register once at backend init so OCR status, outline, search and background
    indexing threads stop repeating the same handled recovery warning."""
    global _pypdf_wrong_pointing_filter_installed
    with _pypdf_wrong_pointing_filter_lock:
        if _pypdf_wrong_pointing_filter_installed:
            return
        logging.getLogger("pypdf._reader").addFilter(_WrongPointingObjectOffsetZeroFilter())
        _pypdf_wrong_pointing_filter_installed = True


def extract_pdf_viewer_data(
    file_path: str,
    max_pages: int = PDF_TEXT_PREVIEW_MAX_PAGES,
    max_chars: int = PDF_TEXT_PREVIEW_MAX_CHARS,
    *,
    raise_errors: bool = False,
) -> dict:
    try:
        from pypdf import PdfReader
    except Exception:
        if raise_errors:
            raise
        return {"content": "", "page_count": 0, "page_texts": []}
    normalized = os.path.abspath(file_path)
    parts = []
    page_texts = []
    page_count = 0
    extracted_chars = 0
    try:
        reader = PdfReader(normalized)
        if reader.is_encrypted:
            raise PdfPasswordRequiredError()
        page_count = len(reader.pages)
        for page_index in range(min(page_count, max_pages)):
            text = (reader.pages[page_index].extract_text() or "").strip()
            page_texts.append(text)
            if text:
                part = f"## Page {page_index + 1}\n\n{text}"
                parts.append(part)
                extracted_chars += len(part)
            if extracted_chars >= max_chars:
                parts.append("\n\n_텍스트 미리보기는 일부만 표시되었습니다._")
                break
    except (PdfPasswordRequiredError, PdfPasswordInvalidError):
        raise
    except Exception:
        if raise_errors:
            raise
        return {"content": "", "page_count": 0, "page_texts": []}
    return {"content": "\n\n".join(parts).strip(), "page_count": page_count, "page_texts": page_texts}


def pdf_file_fingerprint(file_path: str) -> dict:
    file_stat = os.stat(os.path.abspath(file_path))
    return {
        "size": int(file_stat.st_size),
        "mtime_ns": int(file_stat.st_mtime_ns),
    }


def pdf_text_cache_dir() -> str:
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
    cache_dir = os.path.join(appdata, "AILS", "pdf_text_cache")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def pdf_text_cache_path(file_path: str) -> str:
    normalized = os.path.normcase(os.path.abspath(file_path))
    digest = hashlib.sha256(normalized.encode("utf-8", errors="surrogatepass")).hexdigest()
    return os.path.join(pdf_text_cache_dir(), f"{digest}.json")


def load_pdf_text_cache(file_path: str, fingerprint: dict | None = None) -> dict | None:
    normalized = os.path.abspath(file_path)
    expected_fingerprint = fingerprint or pdf_file_fingerprint(normalized)
    try:
        with open(pdf_text_cache_path(normalized), "r", encoding="utf-8") as handle:
            cached = json.load(handle)
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(cached, dict):
        return None
    if cached.get("version") != PDF_TEXT_CACHE_VERSION:
        return None
    if cached.get("fingerprint") != expected_fingerprint:
        return None
    content = cached.get("content")
    page_texts = cached.get("page_texts")
    page_count = cached.get("page_count")
    if not isinstance(content, str) or not isinstance(page_texts, list):
        return None
    if not all(isinstance(text, str) for text in page_texts):
        return None
    try:
        normalized_page_count = max(0, int(page_count))
    except (TypeError, ValueError):
        return None
    return {
        "content": content,
        "page_count": normalized_page_count,
        "page_texts": page_texts,
    }


def save_pdf_text_cache(file_path: str, fingerprint: dict, pdf_data: dict) -> str:
    normalized = os.path.abspath(file_path)
    if pdf_file_fingerprint(normalized) != fingerprint:
        raise RuntimeError("PDF changed while text was being extracted.")
    destination = pdf_text_cache_path(normalized)
    temporary = f"{destination}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
    raw_page_texts = pdf_data.get("page_texts", [])
    payload = {
        "version": PDF_TEXT_CACHE_VERSION,
        "fingerprint": fingerprint,
        "page_count": max(0, int(pdf_data.get("page_count", 0) or 0)),
        "content": str(pdf_data.get("content", "") or ""),
        "page_texts": [
            str(text or "")
            for text in (raw_page_texts if isinstance(raw_page_texts, list) else [])
        ],
    }
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        try:
            if os.path.exists(temporary):
                os.remove(temporary)
        except OSError:
            pass
    return destination
