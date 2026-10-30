"""Restore the geometry used to assemble the persisted OCR page text."""

import math


def restore_ocr_pixel_geometry(path, pages):
    from pdf.pdf_analysis_metadata import read_analysis_metadata
    from pdf.pdf_password import open_pdf_reader

    with open(path, "rb") as source:
        stored = read_analysis_metadata(open_pdf_reader(source)) or {}
    sizes = {}
    for page in (stored.get("payload") or {}).get("pages", []):
        width, height = page.get("width"), page.get("height")
        if width is None or height is None:
            continue
        width, height = float(width), float(height)
        if not all(math.isfinite(v) and v > 0 for v in (width, height)):
            raise ValueError("저장된 OCR 페이지의 이미지 크기가 올바르지 않습니다.")
        sizes[page["page"]] = (width, height)

    def scaled(box, width, height):
        # Division into 0..1 coordinates can break equal line centers and
        # threshold ties. Recover pixel coordinates before regrouping words.
        return {**box, **{key: round(box[key] * scale, 6)
                        for key, scale in (("left", width), ("right", width),
                                           ("top", height), ("bottom", height))}}

    return [{**page,
             "words": [scaled(word, *sizes[page["page"]]) for word in page["words"]],
             "blocks": [scaled(block, *sizes[page["page"]]) for block in page["blocks"]]}
            if page["page"] in sizes else page for page in pages]
