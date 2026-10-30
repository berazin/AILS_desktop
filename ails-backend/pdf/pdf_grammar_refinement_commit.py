"""Commit derived PDF/SQLite updates with guarded restoration on DB failure."""

import logging
import os
import shutil
import tempfile


from pdf.pdf_file_state import file_digest


def _remove_backup(path):
    try:
        os.remove(path)
    except OSError as error:
        # Cleanup is outside the commit outcome: never undo a successful save.
        logging.getLogger(__name__).warning("문법정제 임시 백업 정리 실패: %s (%s)", path, error)


def commit_refinement(path, updates, fingerprint, cancel_check, persist, *, native_results=None):
    from pdf import pdf_ocr_search as search

    fd, backup = tempfile.mkstemp(prefix=f".{os.path.basename(path)}.ails-grammar-original-",
                                   suffix=".tmp.pdf", dir=os.path.dirname(path))
    os.close(fd)
    generated_digest = None
    generated_fingerprint = None
    original_digest = None
    connection = None
    rollback_ok = True
    committed = False
    journal = token = record = None
    try:
        shutil.copy2(path, backup)
        original_digest = file_digest(backup)
        if search._fingerprint(path) != fingerprint or file_digest(path) != original_digest:
            raise RuntimeError("후처리 중 PDF가 변경되어 결과를 적용하지 않았습니다.")
        cancel_check()
        from pdf import pdf_refinement_recovery as recovery
        token, journal, record = recovery.begin(path, backup, original_digest, updates)
        generated_digest = persist(path, updates, fingerprint, cancel_check, native_results=native_results)
        generated_fingerprint = search._fingerprint(path)
        if file_digest(path) != generated_digest:
            raise RuntimeError("문법정제 저장 직후 PDF가 변경되었습니다.")
        cancel_check()
        connection = search._connect()
        recovery.apply_record(path, connection, record)
        if search._fingerprint(path) != generated_fingerprint or file_digest(path) != generated_digest:
            raise RuntimeError("문법정제 저장 중 PDF가 변경되었습니다.")
        connection.commit()
        committed = True
    except BaseException as error:
        if connection is not None:
            try:
                connection.rollback()
            except Exception:
                rollback_ok = False
        try:
            current_digest = file_digest(path)
            if original_digest is None or (generated_digest is None and original_digest == current_digest):
                _remove_backup(backup)
                if journal is not None:
                    recovery.clear(journal)
            elif (generated_digest is not None and rollback_ok and current_digest == generated_digest
                  and search._fingerprint(path) == generated_fingerprint):
                os.replace(backup, path)
                if journal is not None:
                    recovery.clear(journal)
            else:
                raise RuntimeError(f"PDF 또는 검색 DB 상태가 달라 원본을 덮어쓰지 않았습니다. 원본 백업: {backup}") from error
        except OSError as recovery_error:
            raise RuntimeError(f"문법정제 저장 복구에 실패했습니다. 원본 백업: {backup}") from recovery_error
        raise
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception as error:
                logging.getLogger(__name__).warning("문법정제 DB 연결 정리 실패: %s", error)
        if committed:
            _remove_backup(backup)
            recovery.clear(journal)
        if token is not None:
            recovery.reset(token)
