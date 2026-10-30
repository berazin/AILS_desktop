"""Replay saved OCR words after a PDF/SQLite commit gap, without rerunning OCR."""
from contextlib import closing
from dataclasses import asdict
import hashlib
import json
import os

from pdf.pdf_refinement_recovery import _write, clear

_TABLES = ("pdf_ocr_documents", "pdf_ocr_pages", "pdf_ocr_words", "pdf_ocr_blocks")


def _journal(path):
    from pdf.pdf_commit_journal import journal_path
    return journal_path(path, "ocr")


def _database_digest(path, connection):
    digest = hashlib.sha256()
    for table in _TABLES:
        rows = connection.execute(f"SELECT * FROM {table} WHERE path = ?", (path,)).fetchall()
        for row in sorted(json.dumps(tuple(row), ensure_ascii=False) for row in rows):
            digest.update(table.encode("ascii") + b"\0" + row.encode("utf-8") + b"\n")
    return digest.hexdigest()


class IndexCommit:
    def __init__(self, path, record):
        self.path = path
        self.record = record

    def guard(self, connection):
        if _database_digest(self.path, connection) != self.record["before_index_digest"]:
            raise RuntimeError("Search index changed during OCR; preserving independent edits.")

    def receipt(self, connection):
        from pdf.pdf_grammar_refinement_commit import file_digest
        if file_digest(self.path) != self.record["generated_digest"]:
            raise RuntimeError("OCR 색인 저장 중 PDF가 변경되었습니다.")
        self.record["index_digest"] = _database_digest(self.path, connection)
        _write(_journal(self.path), self.record)

    def finish(self):
        clear(_journal(self.path))


def prepare(path, temporary, original_digest, pages, language, outline, page_sizes, analyses, native_page_texts):
    from pdf import pdf_ocr_search as search
    from pdf import pdf_structure
    from pdf.pdf_grammar_refinement_commit import file_digest
    if os.path.exists(_journal(path)):
        raise RuntimeError("이전 OCR 색인 저장의 복구가 필요합니다.")
    with open(temporary, "rb+") as stream:
        os.fsync(stream.fileno())
    with closing(search._connect()) as connection:
        before = _database_digest(path, connection)
    saved_analyses = []
    for index, analysis in enumerate(analyses or []):
        if analysis is None:
            saved_analyses.append(None)
            continue
        width, height = page_sizes[index] if page_sizes else (1, 1)
        blocks = pdf_structure.normalized_blocks(analysis, width, height)
        for block in blocks:
            original = analysis["blocks"][block["block_id"]]
            block["words"] = list(original.get("words") or [])
        saved_analyses.append({"blocks": blocks,
                               "words": [{"block_id": word.get("block_id")} for word in (analysis.get("words") or [])]})
    record = {"schema": 1, "path": path, "original_digest": original_digest,
              "generated_digest": file_digest(temporary), "before_index_digest": before, "index_digest": None,
              "payload": {"pages": [[asdict(word) for word in page] for page in pages],
                          "language": language, "outline": outline, "page_sizes": page_sizes,
                          "analyses": saved_analyses, "native_page_texts": native_page_texts}}
    _write(_journal(path), record)
    return IndexCommit(path, record)


def recover(path):
    from pdf import pdf_ocr_search as search
    from pdf.pdf_ocr_types import OcrWord
    from pdf.pdf_grammar_refinement_commit import file_digest
    journal = _journal(path)
    if not os.path.exists(journal):
        return False
    with open(journal, encoding="utf-8") as stream:
        record = json.load(stream)
    if record.get("schema") != 1 or record.get("path") != path:
        raise RuntimeError("OCR 색인 복구 기록을 확인할 수 없습니다.")
    current = file_digest(path)
    if current == record["original_digest"]:
        clear(journal)
        return True
    if current != record["generated_digest"]:
        raise RuntimeError("PDF가 변경되어 OCR 색인 자동 복구를 보류했습니다.")
    with closing(search._connect()) as connection:
        current_index = _database_digest(path, connection)
    commit = IndexCommit(path, record)
    if current_index != record["index_digest"]:
        if current_index != record["before_index_digest"]:
            raise RuntimeError("검색 DB가 변경되어 OCR 색인 자동 복구를 보류했습니다.")
        payload = record["payload"]
        native = payload.get("native_page_texts")
        search._store_index(path, [[OcrWord(**word) for word in page] for page in payload["pages"]],
                            payload["language"], payload["outline"], page_sizes=payload["page_sizes"],
                            analyses=payload["analyses"] or None,
                            native_page_texts={int(key): value for key, value in native.items()} if native else None,
                            commit_guard=commit.guard, commit_receipt=commit.receipt)
    commit.finish()
    return True
