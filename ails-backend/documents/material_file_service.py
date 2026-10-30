"""Document read/save rules, independent of ApiState and HTTP request handling.

Only PDF extraction and catalog notifications are injected application operations.
The service can operate against a temporary folder without starting AI or Electron.
"""
from __future__ import annotations

import json
import os
from collections.abc import Callable
from contextlib import nullcontext
from urllib.parse import quote

from documents.material_file_policy import MATERIAL_FILE_EXTENSIONS, EDITABLE_MATERIAL_EXTENSIONS, PRESENTATION_EXTENSIONS, ensure_safe_material_path, material_file_kind_from_ext
from documents.material_sources import title_from_report_path, rewrite_report_sources
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.paperback_document import PAPERBACK_EXTENSIONS
from pdf.pdf_viewer_data import pdf_file_fingerprint, load_pdf_text_cache
import documents.paperback_document


class MaterialFileService:
    def __init__(self, *, get_base_dir: Callable[[], str],
                 start_pdf_text_extraction: Callable[[str], dict],
                 ready_pdf_text_payload: Callable[..., dict],
                 read_pdf_page_count: Callable[[str], int],
                 on_saved: Callable[[str], None],
                 on_text_ready: Callable[[str], None] = lambda path: None):
        self.get_base_dir = get_base_dir
        self.start_pdf_text_extraction = start_pdf_text_extraction
        self.ready_pdf_text_payload = ready_pdf_text_payload
        self.read_pdf_page_count = read_pdf_page_count
        self.on_saved = on_saved
        self.on_text_ready = on_text_ready

    def read(self, file_path: str):
        from ide_policy import require_document
        require_document(file_path)
        normalized = os.path.abspath(str(file_path or "").strip())
        if not os.path.isfile(normalized):
            raise FileNotFoundError("강의자료 파일을 찾을 수 없습니다.")
        ext = os.path.splitext(normalized)[1].lower()
        if ext not in MATERIAL_FILE_EXTENSIONS:
            raise ValueError("지원하는 강의자료 파일만 열 수 있습니다.")
        if ext == ".md":
            base_dir = self.get_base_dir()
            normalized = ensure_safe_material_path(normalized, base_dir, allow_external=True)
        title = title_from_report_path(normalized)
        if ext == '.txt':
            with open(normalized, 'r', encoding='utf-8-sig', errors='replace') as handle:
                content = handle.read()
            return {'id': normalized, 'title': title, 'kind': 'txt', 'content': content,
                    'raw_content': content, 'file_path': normalized, 'read_only': True}
        if ext in {'.docx', '.xlsx', '.csv', '.hwp', '.hwpx', '.html', '.htm'}:
            from documents.office_files import resolve_path
            normalized = str(resolve_path(normalized, self.get_base_dir()))
            return {'id': normalized, 'title': title, 'kind': ext[1:], 'content': '',
                    'file_path': normalized, 'read_only': False}
        if ext == ".md":
            from documents.material_practice_service import practice_set_summary
            with open(normalized, "r", encoding="utf-8", errors="replace") as handle:
                content = handle.read()
            return {
                "id": normalized,
                "title": title,
                "kind": "md",
                "content": rewrite_report_sources(content, normalized),
                "raw_content": content,
                "file_path": normalized,
                **({"practice_set": summary} if (summary := practice_set_summary(normalized)) is not None else {}),
            }
        if ext == ".ipynb":
            from code_services.notebook_service import read_notebook_json_file, format_notebook_json, notebook_json_to_markdown
            raw_content = read_notebook_json_file(normalized)
            content = notebook_json_to_markdown(raw_content)
            formatted_raw_content = format_notebook_json(raw_content)
            return {
                "id": normalized,
                "title": title,
                "kind": "ipynb",
                "content": rewrite_report_sources(content, normalized),
                "raw_content": formatted_raw_content,
                "file_path": normalized,
            }
        if ext in PAPERBACK_EXTENSIONS:
            document_model, content = documents.paperback_document.read_paperback_document(normalized)
            return {
                "id": normalized,
                "title": str(document_model.get("metadata", {}).get("title") or title),
                "kind": material_file_kind_from_ext(ext),
                "content": content,
                "file_path": normalized,
                "read_only": True,
                "document_model": document_model,
            }
        if ext in PRESENTATION_EXTENSIONS:
            from documents.presentation_service import read_presentation_text_for_viewer, convert_presentation_to_pdf, extract_presentation_pdf_data, libreoffice_status, find_libreoffice_executable
            content = f"# {title}\n\n" + read_presentation_text_for_viewer(normalized)
            payload = {
                "id": normalized,
                "title": title,
                "kind": material_file_kind_from_ext(ext),
                "content": content,
                "raw_content": content,
                "file_path": normalized,
                "file_url": f"/api/files?path={quote(normalized)}",
                "read_only": True,
            }
            if find_libreoffice_executable():
                try:
                    rendered_pdf_path = convert_presentation_to_pdf(normalized)
                    pdf_data = extract_presentation_pdf_data(rendered_pdf_path)
                    # Optional indexing belongs to the application work queue.
                    try:
                        self.on_text_ready(rendered_pdf_path)
                    except Exception:
                        pass
                    payload.update(
                        {
                            "rendered_file_path": rendered_pdf_path,
                            "page_count": pdf_data.get("page_count", 0),
                            "page_texts": pdf_data.get("page_texts", []),
                            "requires_libreoffice": False,
                        }
                    )
                except Exception as error:
                    payload["render_error"] = str(error)
            else:
                payload["requires_libreoffice"] = True
                payload["libreoffice_install_supported"] = libreoffice_status().get("install_supported", False)
            return payload
        fingerprint = pdf_file_fingerprint(normalized)
        pdf_data = load_pdf_text_cache(normalized, fingerprint)
        if pdf_data is not None:
            extraction = self.ready_pdf_text_payload(pdf_data, cached=True)
        else:
            pdf_data = {
                "content": "",
                "page_count": self.read_pdf_page_count(normalized),
                "page_texts": [],
            }
            extraction = self.start_pdf_text_extraction(normalized)
        return {
            "id": normalized,
            "title": title,
            "kind": "pdf",
            "content": pdf_data.get("content", ""),
            "page_count": pdf_data.get("page_count", 0),
            "page_texts": pdf_data.get("page_texts", []),
            "file_path": normalized,
            "file_url": f"/api/files?path={quote(normalized)}",
            "read_only": True,
            "text_extraction_status": extraction.get("status", "pending"),
            "text_extraction_cached": bool(extraction.get("cached", False)),
            "text_extraction_error": str(extraction.get("error", "") or ""),
        }

    def save(self, payload: dict):
        from ide_policy import require_document
        require_document(payload.get("path") or payload.get("file_path"))
        file_path = str(payload.get("path", "") or payload.get("file_path", "") or "").strip()
        normalized = os.path.abspath(file_path)
        if not normalized or not os.path.isfile(normalized):
            raise FileNotFoundError("저장할 정리본 파일을 찾을 수 없습니다.")
        ext = os.path.splitext(normalized)[1].lower()
        if ext not in EDITABLE_MATERIAL_EXTENSIONS:
            raise ValueError("MD 또는 ipynb 파일만 편집 저장할 수 있습니다.")
        if ext == ".md":
            from documents.material_practice_service import sync_practice_markdown, practice_set_summary
            base_dir = self.get_base_dir()
            normalized = ensure_safe_material_path(normalized, base_dir, allow_external=True)
        content = str(payload.get("content", "") or "")
        if ext == ".ipynb":
            from code_services.notebook_service import format_notebook_json
            try:
                content = format_notebook_json(content)
            except json.JSONDecodeError as error:
                raise ValueError(f"ipynb JSON 형식이 올바르지 않습니다: {error.msg}") from error
        with (PRACTICE_SET_LOCK if ext == ".md" else nullcontext()):
            if not os.path.isfile(normalized):
                raise FileNotFoundError("저장할 정리본 파일을 찾을 수 없습니다.")
            with open(normalized, "w", encoding="utf-8", errors="replace") as handle:
                handle.write(content)
            practice_set = (
                sync_practice_markdown(normalized, content)
                if ext == ".md" else None
            )
        self.on_saved(normalized)
        result = self.read(normalized)
        if practice_set is not None:
            result["practice_set"] = practice_set_summary(normalized)
        return result
