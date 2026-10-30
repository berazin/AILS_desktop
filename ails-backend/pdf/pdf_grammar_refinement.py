"""Final CPU text postprocessing, after all OCR/layout/table passes."""

from pdf.pdf_ocr_spacing import restore_analysis_spacing, spacing_scope


def refine_ocr_pages(pages, analyses, *, page_indexes=None, emit=None, cancel_check=lambda: None):
    from pdf.pdf_ocr_document_terms_integration import prepare_document_context
    total = len(pages)
    indexes = list(range(total)) if page_indexes is None else list(page_indexes)
    inputs = [(index + 1, pages[index], analyses[index] if analyses and index < len(analyses) else None)
              for index in indexes]
    context = prepare_document_context(inputs, cancel_check=cancel_check)
    with spacing_scope(True):
        for index in indexes:
            words = pages[index]
            cancel_check()
            analysis = analyses[index] if analyses and index < len(analyses) else None
            if analysis is not None:
                restore_analysis_spacing(analysis, words, cancel_check=cancel_check, document_context=context)
            if emit:
                emit({"type": "finalizing", "stage": "grammar-refinement", "page": index + 1, "total": total})
    cancel_check()
