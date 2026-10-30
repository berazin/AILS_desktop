"""Read-only visibility for compact PDF search records; never rebuild an index."""


def visible_index_text(connection, path, page, text):
    from documents.answer_key_visibility import regions_for, redact_page
    regions = regions_for(path, page)
    if not regions:
        return str(text or "")
    if any(region.get("bbox") is None for region in regions):
        return ""
    rows = connection.execute(
        "SELECT text, left, top, right, bottom FROM pdf_ocr_words WHERE path = ? AND page = ? ORDER BY word_index",
        (path, page),
    ).fetchall()
    if not rows:
        return ""  # Bounds unavailable: never reuse the unredacted compact text.
    words = [dict(zip(("text", "left", "top", "right", "bottom"), row)) for row in rows]
    return redact_page(path, {"page": page, "text": text, "words": words, "blocks": []})["text"]


def visible_outline(path, outline):
    from documents.answer_key_visibility import hidden
    return [item for item in outline if not hidden(path, item.get("page") or 1)]
