"""Durable derived-index replay; a restart never overwrites the user's PDF."""
from contextlib import closing
from contextvars import ContextVar
import json
import logging
import os
import tempfile

_active = ContextVar("pdf_refinement_transaction", default=None)


def _journal_path(path):
    from pdf.pdf_commit_journal import journal_path
    return journal_path(path, "grammar")


def _write(path, record):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".ails-grammar-journal-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(record, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def begin(path, backup, original_digest, updates):
    from pdf import pdf_ocr_search as search
    journal = _journal_path(path)
    if os.path.exists(journal):
        raise RuntimeError("이전 PDF 문법정제 저장의 복구가 필요합니다.")
    pages = []
    with closing(search._connect()) as connection:
        document = connection.execute("SELECT fingerprint FROM pdf_ocr_documents WHERE path = ?", (path,)).fetchone()
        if not document:
            raise RuntimeError("PDF 검색 색인이 없어 문법정제를 저장하지 않았습니다.")
        for number, text, corrected in updates:
            old = connection.execute("SELECT text FROM pdf_ocr_pages WHERE path = ? AND page = ?", (path, number)).fetchone()
            if not old:
                raise RuntimeError("PDF 페이지 검색 색인이 없어 문법정제를 저장하지 않았습니다.")
            blocks = []
            for block_id, result in corrected.items():
                previous = connection.execute("SELECT text, spacing_json FROM pdf_ocr_blocks WHERE path = ? AND page = ? AND block_id = ?",
                                              (path, number, block_id)).fetchone()
                if not previous:
                    raise RuntimeError("PDF 블록 검색 색인이 없어 문법정제를 저장하지 않았습니다.")
                blocks.append({"id": block_id, "before": list(previous),
                               "after": [result["text"], json.dumps(result, ensure_ascii=False)]})
            pages.append({"page": number, "before": old[0], "after": text, "blocks": blocks})
    record = {"schema": 1, "path": path, "backup": os.path.basename(backup),
              "original_digest": original_digest, "original_fingerprint": document[0],
              "generated_digest": None, "pages": pages}
    with open(backup, "rb+") as stream:
        os.fsync(stream.fileno())
    _write(journal, record)
    return _active.set((journal, record)), journal, record


def prepared(path, digest):
    active = _active.get()
    if active is None:
        return
    journal, record = active
    if record["path"] != path:
        raise RuntimeError("PDF 문법정제 저장 대상이 변경되었습니다.")
    record["generated_digest"] = digest
    _write(journal, record)


def verify_original(path):
    from pdf.pdf_grammar_refinement_commit import file_digest
    active = _active.get()
    if active and file_digest(path) != active[1]["original_digest"]:
        raise RuntimeError("문법정제 저장 직전에 PDF가 변경되었습니다.")


def reset(token):
    _active.reset(token)


def clear(journal):
    try:
        os.remove(journal)
    except FileNotFoundError:
        pass
    except OSError as error:
        logging.getLogger(__name__).warning("문법정제 복구 기록 정리 실패: %s", error)


def apply_record(path, connection, record):
    from pdf import pdf_ocr_search as search
    if not connection.in_transaction:
        connection.execute("BEGIN IMMEDIATE")
    fingerprint = search._fingerprint(path)
    document = connection.execute("SELECT fingerprint FROM pdf_ocr_documents WHERE path = ?", (path,)).fetchone()
    if not document or document[0] not in (record["original_fingerprint"], fingerprint):
        raise RuntimeError("검색 DB가 변경되어 PDF 문법정제 복구를 보류했습니다.")
    # Validate every row before changing any of them. Preserve independent edits.
    for page in record["pages"]:
        row = connection.execute("SELECT text FROM pdf_ocr_pages WHERE path = ? AND page = ?", (path, page["page"])).fetchone()
        if not row or row[0] not in (page["before"], page["after"]):
            raise RuntimeError("검색 본문이 변경되어 PDF 문법정제 복구를 보류했습니다.")
        for block in page["blocks"]:
            row = connection.execute("SELECT text, spacing_json FROM pdf_ocr_blocks WHERE path = ? AND page = ? AND block_id = ?",
                                     (path, page["page"], block["id"])).fetchone()
            if not row or list(row) not in (block["before"], block["after"]):
                raise RuntimeError("검색 블록이 변경되어 PDF 문법정제 복구를 보류했습니다.")
    for page in record["pages"]:
        connection.execute("UPDATE pdf_ocr_pages SET text = ? WHERE path = ? AND page = ?", (page["after"], path, page["page"]))
        for block in page["blocks"]:
            connection.execute("UPDATE pdf_ocr_blocks SET text = ?, spacing_json = ? WHERE path = ? AND page = ? AND block_id = ?",
                               (*block["after"], path, page["page"], block["id"]))
    connection.execute("UPDATE pdf_ocr_documents SET fingerprint = ?, content_digest = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?",
                       (fingerprint, search._content_digest(path), path))


def recover(path):
    from pdf import pdf_ocr_search as search
    from pdf.pdf_grammar_refinement_commit import file_digest, _remove_backup
    journal = _journal_path(path)
    if not os.path.exists(journal):
        return False
    with open(journal, encoding="utf-8") as stream:
        record = json.load(stream)
    backup_name = record.get("backup", "")
    if (record.get("schema") != 1 or record.get("path") != path
            or os.path.basename(backup_name) != backup_name
            or not backup_name.startswith(f".{os.path.basename(path)}.ails-grammar-original-")):
        raise RuntimeError("PDF 문법정제 복구 기록을 확인할 수 없습니다.")
    backup = os.path.join(os.path.dirname(path), backup_name)
    if os.path.isfile(backup) and (os.path.islink(backup) or file_digest(backup) != record["original_digest"]):
        raise RuntimeError("원본 백업이 변경되어 PDF 문법정제 복구를 보류했습니다.")
    digest = file_digest(path)
    if digest == record["generated_digest"]:
        with closing(search._connect()) as connection:
            try:
                apply_record(path, connection, record)
                if file_digest(path) != digest:
                    raise RuntimeError("복구 중 PDF가 변경되었습니다.")
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
    elif digest != record["original_digest"]:
        raise RuntimeError(f"PDF가 변경되어 자동 복구를 보류했습니다. 원본 백업: {backup}")
    # Successful SQLite commit or unchanged original: no PDF replacement here.
    if os.path.exists(backup):
        _remove_backup(backup)
    clear(journal)
    return True
