"""Opt-in grammar refinement of an existing non-AILS PDF text layer."""

import json
from types import SimpleNamespace

from pdf.pdf_ocr_spacing import restore_analysis_spacing, spacing_scope

GRAMMAR_ATTACHMENT_NAME = "ails-grammar-refinement.json"


def refine_native_pages(pages, *, cancel_check, emit):
    updates, results = [], []
    for page in pages:
        cancel_check()
        words = [SimpleNamespace(**w) for w in page["words"]]
        if words:
            bbox = [min(w.left for w in words), min(w.top for w in words),
                    max(w.right for w in words), max(w.bottom for w in words)]
            analysis = {"blocks": [{"type": "text", "text_source": "non_ails_text",
                                    "bbox": bbox, "words": list(range(len(words)))}]}
            with spacing_scope(True):
                restore_analysis_spacing(analysis, words, cancel_check=cancel_check)
            if analysis.get("spacing_status") != "complete":
                raise RuntimeError(analysis.get("spacing_error") or "문법정제를 완료하지 못했습니다.")
            spacing = analysis["blocks"][0]["spacing"]
            if "".join(spacing["text"].split()) != "".join(page["text"].split()):
                raise ValueError("PDF 텍스트와 추출 단어가 달라 문법정제를 적용하지 않았습니다.")
            updates.append((page["page"], spacing["text"], {}))
            results.append({"page": page["page"], **spacing})
        emit({"type": "progress", "page": page["page"], "total": len(pages)})
    return updates, results


def apply_embedded_native_refinement(path, connection):
    """Keep a rebuilt native-text index consistent with its portable correction."""
    from pdf.pdf_password import open_pdf_reader
    from pdf.pdf_analysis_metadata import _decompress_payload, _header_from_value
    from pdf.pdf_grammar_refinement_metadata import GRAMMAR_METADATA_KEY

    with open(path, "rb") as source:
        reader = open_pdf_reader(source)
        record = _header_from_value((reader.metadata or {}).get(GRAMMAR_METADATA_KEY))
        if not record or record.get("status") != "complete" or not record.get("version"):
            return
        entries = (reader.attachments or {}).get(GRAMMAR_ATTACHMENT_NAME)
        if not entries:
            return
        entries = entries if isinstance(entries, list) else [entries]
        try:
            results = json.loads(_decompress_payload(bytes(entries[-1])).decode("utf-8"))
        except (ValueError, OSError, TypeError):
            return
        if not isinstance(results, list):
            return
        for result in results:
            if not isinstance(result, dict):
                continue
            original = connection.execute("SELECT text FROM pdf_ocr_pages WHERE path = ? AND page = ?",
                                          (path, result.get("page"))).fetchone()
            text = result.get("text")
            raw = result.get("raw_text")
            if (original and isinstance(text, str) and isinstance(raw, str)
                    and "".join(original[0].split()) == "".join(raw.split()) == "".join(text.split())):
                connection.execute("UPDATE pdf_ocr_pages SET text = ? WHERE path = ? AND page = ?",
                                   (text, path, result["page"]))
