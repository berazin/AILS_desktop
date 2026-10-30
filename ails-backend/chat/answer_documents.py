"""AnswerDocuments: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from chat.conversation_support import (
    Mapping,
    chat,
    documents,
    extract_indexed_pdf_region_text,
    normalize_latex_math_syntax,
    normalize_markdown_image_link_sizes,
    os,
    pdf_ocr_status,
    resolve_app_path,
    sanitize_title,
)


@dataclass(frozen=True)
class AnswerDocumentsPorts:
    append_idle_log: Callable[..., Any]
    collect_engine_results: Callable[..., Any]
    refresh_reports_from_disk: Callable[..., Any]
    get_config: Callable[..., Any]
    get_lock: Callable[..., Any]
    get_processed_results: Callable[..., Any]


class AnswerDocuments:
    def __init__(self, ports: AnswerDocumentsPorts):
        self._ports = ports
        self.append_idle_log = ports.append_idle_log
        self.collect_engine_results = ports.collect_engine_results
        self.refresh_reports_from_disk = ports.refresh_reports_from_disk

    @property
    def config(self):
        return self._ports.get_config()

    @property
    def lock(self):
        return self._ports.get_lock()

    @property
    def processed_results(self):
        return self._ports.get_processed_results()

    def extract_pdf_ocr_region(self, payload: dict):
        file_path = os.path.abspath(str(payload.get("path", "") or ""))
        page = int(payload.get("page") or 1)
        if not pdf_ocr_status(file_path).get("has_text"):
            raise ValueError("텍스트 레이어가 없는 PDF에서는 영역 텍스트를 가져올 수 없습니다.")
        result = extract_indexed_pdf_region_text(file_path, page, payload.get("region") or {})
        result["ai_reviewed"] = False
        return result

    def save_chatbot_answer(self, payload: dict):
        title = documents.material_workspace_support.sanitize_markdown_link_title(payload.get("title", "") or "챗봇 답변")
        answer = normalize_latex_math_syntax(str(payload.get("answer", "") or "")).strip()
        target_path = str(payload.get("target_file_path", "") or "").strip()
        insert_line_index = payload.get("insert_line_index")
        if not answer:
            raise ValueError("저장할 답변이 없습니다.")
        week_dir = os.path.dirname(os.path.abspath(target_path)) if target_path else resolve_app_path(self.config.get("md_save_path", ""))
        if not week_dir:
            raise ValueError("저장 폴더를 찾을 수 없습니다.")
        # 챗봇 답변 md는 해당 주차 폴더의 _link 하위 폴더에 배치
        base_dir = os.path.join(week_dir, ".link")
        os.makedirs(base_dir, exist_ok=True)
        safe_name = sanitize_title(title) or "chatbot-answer"
        output_path = os.path.join(base_dir, f"{safe_name}.md")
        index = 2
        while os.path.exists(output_path):
            output_path = os.path.join(base_dir, f"{safe_name}_{index}.md")
            index += 1
        with open(output_path, "w", encoding="utf-8", errors="replace") as handle:
            handle.write(f"# {title}\n\n{answer}\n")
        link_target = os.path.relpath(output_path, os.path.dirname(os.path.abspath(target_path))) if target_path else output_path
        markdown_link = f"[{title}]({link_target.replace(os.sep, '/')})"
        updated_content = None
        updated_raw_content = None
        normalized_target = os.path.abspath(target_path) if target_path else ""
        if normalized_target and os.path.isfile(normalized_target) and os.path.splitext(normalized_target)[1].lower() == ".md":
            try:
                line_index = int(insert_line_index)
            except Exception:
                line_index = None
            if line_index is not None:
                with open(normalized_target, "r", encoding="utf-8", errors="replace") as handle:
                    raw_content = handle.read()
                lines = raw_content.splitlines()
                target_index = max(0, min(line_index, len(lines)))
                insertion = ["", markdown_link, ""]
                next_lines = lines[:target_index] + insertion + lines[target_index:]
                next_raw = "\n".join(next_lines).strip() + "\n"
                with open(normalized_target, "w", encoding="utf-8", errors="replace") as handle:
                    handle.write(next_raw)
                updated_content = documents.material_workspace_support.rewrite_report_sources(next_raw, normalized_target)
                updated_raw_content = next_raw
        return {
            "title": title,
            "file_path": output_path,
            "markdown_link": markdown_link,
            "updated_content": updated_content,
            "updated_raw_content": updated_raw_content,
        }

    def get_report(self, title: str):
        self.collect_engine_results()
        self.refresh_reports_from_disk()
        with self.lock:
            data = self.processed_results.get(title)
            if not data:
                raise KeyError(title)
            file_path = data.get("file_path", "")
            raw_content = data.get("content", "")
            content = documents.material_workspace_support.rewrite_report_sources(raw_content, file_path)
            return {
                "id": title,
                "title": title,
                "content": content,
                "raw_content": raw_content,
                "model": data.get("model", ""),
                "status": data.get("status", "success"),
                "file_path": file_path,
                "usage_summary": data.get("usage_summary"),
            }

    def latex_postprocess_reports(self):
        base_dir = str(self.config.get("md_save_path", "") or "").strip()
        if not base_dir or not os.path.isdir(base_dir):
            raise ValueError("저장 폴더를 찾을 수 없습니다.")
        updated = 0
        unchanged = 0
        failed = []
        for report_path in documents.material_workspace_support.iter_report_markdown_paths(base_dir):
            try:
                with open(report_path, "r", encoding="utf-8", errors="replace") as handle:
                    original = handle.read()
                processed = normalize_latex_math_syntax(original)
                processed = normalize_markdown_image_link_sizes(processed)
                if processed != original:
                    with open(report_path, "w", encoding="utf-8", errors="replace") as handle:
                        handle.write(processed)
                    updated += 1
                else:
                    unchanged += 1
            except Exception as error:
                failed.append({"path": report_path, "reason": str(error)})
        self.refresh_reports_from_disk()
        self.append_idle_log(f"LaTeX 후처리 완료: 수정 {updated}개, 변경 없음 {unchanged}개, 실패 {len(failed)}개")
        return {"updated": updated, "unchanged": unchanged, "failed": failed}

    def search_context(self, payload: Mapping) -> dict:
        document_id = documents.material_workspace_support.ensure_safe_material_path(
            str(payload.get("document_id") or ""),
            str(self.config.get("md_save_path") or ""),
            allow_external=True,
        )
        return chat.theory_search.search_document_context(
            document_id,
            action=str(payload.get("action") or "search"),
            query=str(payload.get("query") or ""),
            textbook_terms=str(payload.get("textbook_terms") or ""),
            top_k=min(int(payload.get("top_k") or 5), 5),
            retrieval_state=payload.get("retrieval_state") if isinstance(payload.get("retrieval_state"), Mapping) else None,
        )
