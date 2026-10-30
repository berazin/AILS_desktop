"""PDF viewer text extraction, preview caching, and pypdf log filtering.

Extracted from api_server.py to isolate PDF viewer data preparation into a
dedicated mixin.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from pathlib import Path

import chat
import pdf.pdf_viewer_data

_logger = logging.getLogger(__name__)


# 뷰어 데이터·텍스트 캐시·비밀번호 오류는 pdf 패키지(pdf_viewer_data) 소유다.
from pdf.pdf_viewer_data import (  # noqa: E402
    PDF_TEXT_CACHE_VERSION,
    PDF_TEXT_PREVIEW_MAX_CHARS,
    PDF_TEXT_PREVIEW_MAX_PAGES,
    PdfPasswordInvalidError,
    PdfPasswordRequiredError,
    extract_pdf_viewer_data,
    install_pypdf_wrong_pointing_log_filter,
    load_pdf_text_cache,
    pdf_file_fingerprint,
    pdf_text_cache_dir,
    pdf_text_cache_path,
    save_pdf_text_cache,
)

from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



# api_server에서 이동: PDF 페이지 수·썸네일·잠금 해제
def read_pdf_page_count(file_path: str) -> int:
    import pypdfium2 as pdfium
    from pdf.pdfium_runtime import locked_pdfium

    normalized = os.path.abspath(file_path)
    with locked_pdfium():
        document = None
        try:
            try:
                document = pdfium.PdfDocument(normalized)
            except Exception as error:
                if "password" in str(error).lower():
                    raise PdfPasswordRequiredError() from error
                raise
            return max(0, len(document))
        finally:
            if document is not None:
                document.close()


# Preserve the public import used by HTTP covers and existing tests.
from pdf.pdf_page_rendering import render_pdf_thumbnail_png


def unlock_pdf_file(file_path: str, password: str) -> bool:
    from pypdf import PdfReader, PdfWriter

    normalized = os.path.abspath(file_path)
    temp_path = f"{normalized}.ails-unlocked.tmp.pdf"
    try:
        reader = PdfReader(normalized)
        if not reader.is_encrypted:
            return False
        if not str(password or ""):
            raise PdfPasswordRequiredError()
        if not reader.decrypt(str(password)):
            raise PdfPasswordInvalidError()
        if os.path.exists(temp_path):
            os.remove(temp_path)
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        with open(temp_path, "wb") as output:
            writer.write(output)
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise
    os.replace(temp_path, normalized)
    return True
