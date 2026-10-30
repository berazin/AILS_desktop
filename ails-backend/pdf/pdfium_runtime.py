from __future__ import annotations

import threading
from contextlib import contextmanager


_pdfium_process_lock = threading.RLock()


@contextmanager
def locked_pdfium():
    """Serialize every PDFium call in this backend process.

    PDFium is not thread-safe. The backend is a ThreadingHTTPServer, so page
    previews, region OCR, and full-document OCR must share one process-wide
    lock rather than protecting only their own request.
    """
    with _pdfium_process_lock:
        yield
