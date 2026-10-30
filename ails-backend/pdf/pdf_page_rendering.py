"""Shared bounded PDFium page rendering for covers and research images."""
import os


def render_pdf_thumbnail_png(file_path: str, page_number: int, target_width: int) -> bytes:
    import pypdfium2 as pdfium
    from io import BytesIO
    from PIL import Image
    from pdf.pdfium_runtime import locked_pdfium

    with locked_pdfium():
        document = pdfium.PdfDocument(os.path.abspath(file_path))
        page = bitmap = image = None
        try:
            if not 1 <= page_number <= len(document):
                raise ValueError("PDF page is out of range")
            page = document.get_page(page_number - 1)
            page_width, page_height = page.get_size()
            if page_width <= 0 or page_height <= 0:
                raise ValueError("Invalid PDF page size")
            scale = min(target_width / page_width, 1600 / page_height)
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            desired = (max(1, round(page_width * scale)), max(1, round(page_height * scale)))
            if image.size != desired:
                resized = image.resize(desired, Image.Resampling.LANCZOS)
                image.close()
                image = resized
            output = BytesIO()
            image.save(output, format="PNG")
            return output.getvalue()
        finally:
            if image is not None: image.close()
            if bitmap is not None: bitmap.close()
            if page is not None: page.close()
            document.close()
