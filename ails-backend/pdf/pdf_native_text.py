"""Native PDF word boxes measured from glyphs, in displayed-page coordinates."""

import math
from contextlib import closing

from pdf.page_transform import PageTransform
from pdf.pdf_ocr_types import OcrWord
from pdf.pdf_password import open_pdfium_document


NATIVE_TEXT_WORD_INDEX_VERSION = 6


def required_word_index_version(source: str, ocr_version: int) -> int:
    return NATIVE_TEXT_WORD_INDEX_VERSION if source == "native_text" else ocr_version


def _page_words(text_page, transform: PageTransform, *, visible_only=False) -> list[OcrWord]:
    import pypdfium2 as pdfium
    # PDFium text offsets use UTF-16 and can differ from glyph indices (inserted
    # spaces, ligatures, supplementary characters). Resolve each offset explicitly.
    text = text_page.get_text_range(errors="surrogatepass")
    words = []
    characters, boxes = [], []
    offset = 0

    def flush():
        if characters and boxes:
            words.append(OcrWord(
                "".join(characters), min(b[0] for b in boxes), min(b[1] for b in boxes),
                max(b[2] for b in boxes), max(b[3] for b in boxes), 1.0,
            ))
        characters.clear()
        boxes.clear()

    count = text_page.count_chars()
    for char in text:
        units = len(char.encode("utf-16-le", errors="surrogatepass")) // 2
        indices = {pdfium.raw.FPDFText_GetCharIndexFromTextIndex(text_page, offset + unit)
                   for unit in range(units)}
        offset += units
        if char.isspace():
            flush()
            continue
        char_boxes = []
        for index in indices:
            if not 0 <= index < count:
                continue
            if visible_only:
                text_object = pdfium.raw.FPDFText_GetTextObject(text_page, index)
                if text_object and pdfium.raw.FPDFTextObj_GetTextRenderMode(text_object) in (3, 7):
                    continue
            box = transform.pdf_bbox_to_canonical(text_page.get_charbox(index))
            if all(math.isfinite(value) for value in box) and box[2] > box[0] and box[3] > box[1]:
                # Exclude glyphs outside the visible crop; never stretch a token
                # across hidden content or a column/page boundary.
                clipped = (max(0.0, box[0]), max(0.0, box[1]),
                           min(transform.width, box[2]), min(transform.height, box[3]))
                if clipped[2] > clipped[0] and clipped[3] > clipped[1]:
                    char_boxes.append(clipped)
        if not char_boxes:
            flush()
            continue
        characters.append(char)
        boxes.extend(char_boxes)
    flush()
    # PDFium provides reading order. Tight glyph tops vary with ascenders even
    # on one baseline; sorting those tops reverses partial text selections.
    return words


def native_text_pages(path: str, reader, *, page_indexes=None, visible_only=False) -> tuple[list[list[OcrWord]], list[tuple[float, float]]]:
    pages, sizes = [], []
    selected = None if page_indexes is None else set(page_indexes)
    # Opening, text extraction and disposal all share the backend PDFium lock.
    with open_pdfium_document(path) as document:
        if len(document) != len(reader.pages):
            raise ValueError("PDF text extraction page count does not match")
        for index, source_page in enumerate(reader.pages):
            transform = PageTransform.from_page(source_page)
            if selected is None or index in selected:
                with closing(document[index]) as page, closing(page.get_textpage()) as text_page:
                    pages.append(_page_words(text_page, transform, visible_only=visible_only))
            else:
                pages.append([])
            sizes.append((transform.width, transform.height))
    return pages, sizes


def visible_native_index_words(path: str, page_number: int) -> list[OcrWord]:
    """Recover a native page's missing boxes without inventing hidden OCR boxes."""
    from pdf.pdf_password import open_pdf_reader

    with open(path, "rb") as source:
        reader = open_pdf_reader(source)
        pages, sizes = native_text_pages(path, reader, page_indexes=[page_number - 1], visible_only=True)
    width, height = sizes[page_number - 1]
    return [OcrWord(word.text, word.left / width, word.top / height,
                    word.right / width, word.bottom / height, word.confidence)
            for word in pages[page_number - 1]]
