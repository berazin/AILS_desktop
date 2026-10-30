"""Per-job PDF credentials; never persist passwords or remove encryption."""

import os
from contextlib import contextmanager
from contextvars import ContextVar

_credential = ContextVar("pdf_job_credential", default=None)


class PdfPasswordRequiredError(ValueError):
    def __init__(self):
        super().__init__("PDF 비밀번호를 입력해 주세요.")


class PdfPasswordInvalidError(PdfPasswordRequiredError):
    def __init__(self):
        ValueError.__init__(self, "PDF 비밀번호가 올바르지 않습니다. 다시 입력해 주세요.")


@contextmanager
def pdf_password_scope(path, password):
    token = _credential.set((os.path.normcase(os.path.abspath(path)), password))
    try:
        yield
    finally:
        _credential.reset(token)


def open_pdf_reader(source):
    from pypdf import PdfReader

    reader = PdfReader(source)
    if not reader.is_encrypted:
        return reader
    name = source if isinstance(source, (str, os.PathLike)) else getattr(source, "name", "")
    credential = _credential.get()
    password = credential[1] if credential and name and os.path.normcase(os.path.abspath(name)) == credential[0] else None
    if reader.decrypt(password if password is not None else ""):
        return reader
    if password is None:
        raise PdfPasswordRequiredError()
    raise PdfPasswordInvalidError()


@contextmanager
def open_pdfium_document(path):
    """Read encrypted PDFs using the same temporary job credential as pypdf."""
    import pypdfium2 as pdfium
    from pdf.pdfium_runtime import locked_pdfium

    credential = _credential.get()
    password = credential[1] if credential and os.path.normcase(os.path.abspath(path)) == credential[0] else None
    with locked_pdfium():
        document = pdfium.PdfDocument(path, password=password)
        try:
            yield document
        finally:
            document.close()


def preserve_pdf_encryption(writer, reader):
    if not reader.is_encrypted:
        return
    # pypdf 6.14.2 clone_from preserves /ID but does not copy encryption.
    # Reuse the unlocked key and original dictionary: both passwords, cipher,
    # permissions and metadata-encryption flag remain unchanged. No plaintext
    # PDF is written. These private fields are covered by encrypted-PDF tests.
    encryption = reader._encryption
    if encryption is None or not encryption.is_decrypted():
        raise PdfPasswordRequiredError()
    writer._encryption = encryption
    entry = reader.trailer["/Encrypt"].clone(writer)
    if entry.indirect_reference is None:
        writer._add_object(entry)
    writer._encrypt_entry = entry
