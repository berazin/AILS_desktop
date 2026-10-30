"""Keep derived text recovery records beside the user's existing search index."""
import hashlib
import os


def journal_path(path, kind):
    from pdf.pdf_ocr_search import _database_path
    identity = hashlib.sha256(os.path.normcase(os.path.abspath(path)).encode("utf-8")).hexdigest()
    return os.path.join(os.path.dirname(_database_path()), "commit-recovery", f"{identity}.{kind}.json")
