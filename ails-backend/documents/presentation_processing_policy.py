"""Identify cached presentation PDFs without changing ordinary PDF policy."""

import os

import common


def is_presentation_pdf(path: str, source: str = "") -> bool:
    normalized = os.path.normcase(os.path.realpath(path))
    extension = os.path.splitext(normalized)[1].casefold()
    if extension != ".pdf":
        return False
    if source == "presentation":
        return True
    # The converter keeps both existing and new exports in this cache. Compare
    # path boundaries so an ordinary PDF in a similarly named folder is allowed.
    cache = os.path.normcase(os.path.realpath(os.path.join(common.TEMP_DIR_NAME, "presentation_pdf_cache")))
    try:
        return os.path.commonpath((normalized, cache)) == cache
    except ValueError:
        return False
