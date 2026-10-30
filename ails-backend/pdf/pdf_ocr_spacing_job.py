"""Reapply spacing to saved OCR boxes; persist only AILS text/provenance."""

import hashlib
import json
import os
from types import SimpleNamespace

from pdf.pdf_ocr_spacing import restore_analysis_spacing, spacing_scope


def reprocess_index_spacing(path, *, include_non_ails=False, password=None, source="", cancel_check=lambda: None, emit=lambda event: None):
    from pdf import pdf_ocr_search as search
    from pdf.pdf_ocr import _locked_ocr_pdf
    from pdf.pdf_password import pdf_password_scope
    from pdf.pdf_work_files import is_pdf_work_temp

    path = os.path.abspath(path)
    if is_pdf_work_temp(path):
        return {"skipped": True, "reason": "internal_pdf_temp"}
    with _locked_ocr_pdf(path), pdf_password_scope(path, password):
        from pdf.pdf_ocr_index_recovery import recover as recover_ocr
        recover_ocr(path)
        from pdf.pdf_refinement_recovery import recover
        recover(path)
        from pdf.pdf_grammar_refinement_metadata import read_refinement_metadata, refinement_is_current
        cancel_check()
        if refinement_is_current(read_refinement_metadata(path)):
            return {"skipped": True, "reason": "grammar_refinement_current"}
        status = search.pdf_ocr_status(path, rebuild_native_index=False)
        is_ails = bool(status.get("ocr_embedded"))
        from documents.presentation_processing_policy import is_presentation_pdf
        if is_presentation_pdf(path, source) and not is_ails:
            # Native slide text must never enter the non-AILS grammar branch.
            # OCR's final stage refines only the selected textless slides; later
            # reprocessing uses saved OCR blocks and already skips native ones.
            return {"skipped": True, "reason": "presentation_native_text"}
        if not is_ails and not include_non_ails:
            return {"skipped": True, "reason": "ails_ocr_metadata_required"}
        if not status.get("has_text"):
            return {"skipped": True, "reason": "text_layer_required"}
        if is_ails and not status.get("indexed"):
            return {"skipped": True, "reason": "saved_ocr_required"}
        fingerprint = search._fingerprint(path)
        pages = search.indexed_pdf_pages(path, status)
        if is_ails:
            from pdf.pdf_ocr_spacing_geometry import restore_ocr_pixel_geometry
            pages = restore_ocr_pixel_geometry(path, pages)
        updates = []
        native_results = None
        if not is_ails:
            from pdf.pdf_grammar_refinement_native import refine_native_pages
            updates, native_results = refine_native_pages(pages, cancel_check=cancel_check, emit=emit)
        page_inputs = []
        unlinked_prose = False
        for page in pages if is_ails else []:
            cancel_check()
            words = [SimpleNamespace(**w) for w in page["words"]]
            words_by_block = {}
            for index, word in enumerate(words):
                words_by_block.setdefault(getattr(word, "block_id", None), []).append(index)
            blocks = []
            for saved in page["blocks"]:
                if saved["type"] != "text" or saved.get("text_source") == "native":
                    continue
                indexes = words_by_block.get(saved["block_id"], [])
                if not indexes:
                    unlinked_prose = unlinked_prose or bool(str(saved.get("text") or "").strip())
                    continue
                bbox = [saved[k] for k in ("left", "top", "right", "bottom")]
                blocks.append({"type": "text", "text_source": saved.get("text_source"),
                               "baseline_text": saved["text"],
                               "bbox": bbox, "words": list(indexes), "block_id": saved["block_id"]})
            page_inputs.append((page, words, {"blocks": blocks}, words_by_block))
        if unlinked_prose:
            return {"skipped": True, "reason": "saved_ocr_word_linkage_required"}
        context = None
        if is_ails:
            from pdf.pdf_ocr_document_terms_integration import prepare_document_context
            context = prepare_document_context([(page["page"], words, analysis)
                                                for page, words, analysis, _indexes in page_inputs], cancel_check=cancel_check)
        for page, words, analysis, words_by_block in page_inputs:
            cancel_check()
            blocks = analysis["blocks"]
            if blocks:
                with spacing_scope(True):
                    restore_analysis_spacing(analysis, words, cancel_check=cancel_check, document_context=context)
                if analysis.get("spacing_status") != "complete":
                    raise RuntimeError(analysis.get("spacing_error") or "Kiwi 후처리를 완료하지 못했습니다.")
                corrected = {b["block_id"]: b["spacing"] for b in blocks}
                from pdf import pdf_structure
                reading_blocks = []
                for saved in page["blocks"]:
                    result = corrected.get(saved["block_id"])
                    indexes = words_by_block.get(saved["block_id"], [])
                    reading_blocks.append({**saved, "words": indexes,
                                           "spacing": result or saved.get("spacing")})
                text = pdf_structure.reading_order_text({"blocks": reading_blocks}, words)
                compact = lambda value: "".join(value.split())
                if compact(text) != compact(page["text"]):
                    raise ValueError("저장된 페이지와 OCR 블록 문자가 달라 문법정제를 적용하지 않았습니다.")
                updates.append((page["page"], text, corrected))
            emit({"type": "progress", "page": page["page"], "total": len(pages)})
        cancel_check()
        if search._fingerprint(path) != fingerprint:
            raise RuntimeError("후처리 중 PDF가 변경되어 결과를 적용하지 않았습니다.")
        if not updates:
            return {"skipped": True, "reason": "saved_prose_required"}
        from pdf.pdf_grammar_refinement_commit import commit_refinement
        commit_refinement(path, updates, fingerprint, cancel_check, _persist_refinement, native_results=native_results)
        return {"skipped": False, "pages": len(updates)}


def _persist_refinement(path, updates, fingerprint, cancel_check, *, native_results=None):
    """Clone all PDF objects; change only AILS provenance/analysis attachments."""
    import tempfile
    from pypdf import PdfWriter
    from pdf.pdf_password import open_pdf_reader, preserve_pdf_encryption
    from pdf import pdf_analysis_metadata as metadata
    from pdf import pdf_ocr_search as search
    from pdf.pdf_ocr import _pdf_has_signature
    from pdf.pdf_grammar_refinement_metadata import GRAMMAR_METADATA_KEY, grammar_metadata

    fd, temporary = tempfile.mkstemp(prefix=".ails-grammar-", suffix=".pdf", dir=os.path.dirname(path))
    os.close(fd)
    try:
        with open(path, "rb") as source:
            reader = open_pdf_reader(source)
            if _pdf_has_signature(reader):
                raise ValueError("서명된 PDF에는 문법정제를 저장할 수 없습니다.")
            writer = PdfWriter(clone_from=reader)
            try:
                refinement = grammar_metadata(["complete"])
                stored = metadata.read_analysis_metadata(reader)
                if native_results is not None:
                    from pdf.pdf_grammar_refinement_native import GRAMMAR_ATTACHMENT_NAME
                    for attachment in list(writer.attachment_list):
                        if attachment.name == GRAMMAR_ATTACHMENT_NAME:
                            attachment.delete()
                    writer.add_attachment(GRAMMAR_ATTACHMENT_NAME, metadata.serialize_analysis_payload(native_results))
                elif not stored or not stored.get("payload"):
                    raise ValueError("문서 구조 메타데이터가 없어 문법정제를 저장할 수 없습니다.")
                payload = stored["payload"] if stored and stored.get("payload") else {"pages": []}
                corrected = {page: blocks for page, _text, blocks in updates}
                page_texts = {page: text for page, text, _blocks in updates}
                matched = set()
                for page in payload.get("pages", []):
                    blocks = corrected.get(page.get("page"), {})
                    for block in page.get("blocks", []):
                        result = blocks.get(block.get("block_id"))
                        if result:
                            stored_text = str(block.get("text", "") or "")
                            if stored_text and "".join(stored_text.split()) != "".join(result["text"].split()):
                                raise ValueError("PDF 구조 메타데이터와 OCR 색인 블록 문자가 일치하지 않습니다.")
                            block.update(spacing=result, text=result["text"])
                            matched.add((page["page"], block["block_id"]))
                    if blocks:
                        page["text"] = page_texts[page["page"]]
                        contents = reader.pages[page["page"] - 1].get_contents()
                        page["refinement_stream_sha256"] = hashlib.sha256(
                            contents.get_data() if contents is not None else b"").hexdigest()
                        extracted = reader.pages[page["page"] - 1].extract_text()
                        page["refinement_extracted_nonspace_sha256"] = hashlib.sha256(
                            "".join(extracted.split()).encode("utf-8")).hexdigest()
                        page["spacing_status"] = "complete"
                        page.pop("spacing_error", None)
                expected = {(page, block_id) for page, blocks in corrected.items() for block_id in blocks}
                if matched != expected:
                    raise ValueError("PDF 구조 메타데이터와 OCR 색인 블록이 일치하지 않습니다.")
                if native_results is None:
                    payload["grammar_refinement"] = refinement
                    header = {**stored["header"], "grammar_refinement": refinement}
                    metadata.attach_analysis(writer, dict(reader.metadata or {}), header,
                                             metadata.serialize_analysis_payload(payload))
                writer.add_metadata({GRAMMAR_METADATA_KEY: json.dumps(refinement, ensure_ascii=False)})
                preserve_pdf_encryption(writer, reader)
                with open(temporary, "wb") as output:
                    writer.write(output)
                    output.flush()
                    os.fsync(output.fileno())
            finally:
                writer.close()
        cancel_check()
        if search._fingerprint(path) != fingerprint:
            raise RuntimeError("후처리 중 PDF가 변경되어 결과를 적용하지 않았습니다.")
        from pdf.pdf_grammar_refinement_commit import file_digest
        generated_digest = file_digest(temporary)
        from pdf.pdf_refinement_recovery import prepared, verify_original
        prepared(path, generated_digest)
        verify_original(path)
        os.replace(temporary, path)
        return generated_digest
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)
