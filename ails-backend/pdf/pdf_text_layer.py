from __future__ import annotations

import os
import sys
import tempfile
from io import BytesIO
from pathlib import Path


from common import resource_path
from language_support import (
    TRANSLATION_FONT_CANDIDATES,
    language_korean_name,
    normalize_app_language,
)
from pdf.pdfium_runtime import locked_pdfium
import pdf.pdf_ocr as pdf_ocr
DEFAULT_LANGUAGE = "korean"

def _font_path(language: str = DEFAULT_LANGUAGE) -> str:
    font_names = TRANSLATION_FONT_CANDIDATES[normalize_app_language(language or DEFAULT_LANGUAGE)][0]
    candidates = []
    for font_name in font_names:
        candidates.extend([
            resource_path(os.path.join("tools", "fonts", font_name)),
            os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", font_name),
            rf"C:\Windows\Fonts\{font_name}",
        ])
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    raise pdf_ocr.PdfOcrUnavailableError(
        f"{language_korean_name(language)} PDF 텍스트 레이어용 글꼴을 찾지 못했습니다."
    )


def _pdf_has_signature(reader) -> bool:
    def resolve(value):
        return value.get_object() if hasattr(value, "get_object") else value

    root = resolve(reader.trailer.get("/Root", {}))
    permissions = resolve(root.get("/Perms", {})) if hasattr(root, "get") else {}
    if hasattr(permissions, "get") and permissions.get("/DocMDP") is not None:
        return True
    acro_form = resolve(root.get("/AcroForm", {})) if hasattr(root, "get") else {}
    fields = list(acro_form.get("/Fields", [])) if hasattr(acro_form, "get") else []
    while fields:
        field = resolve(fields.pop())
        if not hasattr(field, "get"):
            continue
        if str(field.get("/FT", "")) == "/Sig" and field.get("/V") is not None:
            return True
        fields.extend(field.get("/Kids", []))
    return False


def _new_sibling_pdf_temp(path: str, purpose: str) -> str:
    source = Path(path)
    fd, temp_path = tempfile.mkstemp(
        prefix=f".{source.name}.ails-{purpose}-",
        suffix=".tmp.pdf",
        dir=str(source.parent),
    )
    try:
        os.close(fd)
        return temp_path
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise


def _validate_pdf_output(path: str, expected_pages: int):
    import pypdfium2 as pdfium
    from pypdf import PdfReader

    reader = PdfReader(path)
    if len(reader.pages) != expected_pages:
        raise RuntimeError("OCR 결과 PDF의 페이지 수가 원본과 일치하지 않습니다.")
    metadata = reader.metadata or {}
    if str(metadata.get(pdf_ocr.OCR_METADATA_KEY, "")) != pdf_ocr.OCR_VERSION:
        raise RuntimeError("OCR 결과 PDF에 완료 정보가 기록되지 않았습니다.")

    with locked_pdfium():
        document = pdfium.PdfDocument(path)
        try:
            if len(document) != expected_pages:
                raise RuntimeError("PDFium 검증에서 페이지 수가 일치하지 않습니다.")
            for page_index in range(expected_pages):
                page = document[page_index]
                bitmap = None
                image = None
                try:
                    bitmap = page.render(scale=0.1)
                    image = bitmap.to_pil()
                    image.load()
                finally:
                    if image is not None:
                        image.close()
                    if bitmap is not None:
                        bitmap.close()
                    page.close()
        finally:
            document.close()


def _inverse_ctm(ctm: tuple[float, float, float, float, float, float]) -> tuple[float, float, float, float, float, float]:
    a, b, c, d, e, f = ctm
    determinant = a * d - b * c
    if abs(determinant) < 1e-12:
        raise RuntimeError("PDF 페이지 변환 행렬을 역변환할 수 없습니다.")
    return (
        d / determinant,
        -b / determinant,
        -c / determinant,
        a / determinant,
        (c * f - d * e) / determinant,
        (b * e - a * f) / determinant,
    )


def _apply_ctm(
    ctm: tuple[float, float, float, float, float, float] | list[float],
    x: float,
    y: float,
) -> tuple[float, float]:
    a, b, c, d, e, f = (float(value) for value in ctm)
    return a * x + c * y + e, b * x + d * y + f


def _normalized_page_geometry_with_transform(
    page,
) -> tuple[
    float,
    float,
    float,
    float,
    float,
    float,
    tuple[float, float, float, float, float, float],
    tuple[float, float, float, float, float, float],
]:
    from pypdf import Transformation

    media_box = page.mediabox
    center_x = float(media_box.left + media_box.width / 2)
    center_y = float(media_box.bottom + media_box.height / 2)
    transform = Transformation().translate(-center_x, -center_y).rotate(-int(page.rotation or 0) % 360)
    media_points = [
        transform.apply_on((float(media_box.left), float(media_box.bottom))),
        transform.apply_on((float(media_box.left), float(media_box.top))),
        transform.apply_on((float(media_box.right), float(media_box.bottom))),
        transform.apply_on((float(media_box.right), float(media_box.top))),
    ]
    transform = transform.translate(
        -min(point[0] for point in media_points),
        -min(point[1] for point in media_points),
    )
    normalized_media_points = [transform.apply_on(point) for point in (
        (float(media_box.left), float(media_box.bottom)),
        (float(media_box.left), float(media_box.top)),
        (float(media_box.right), float(media_box.bottom)),
        (float(media_box.right), float(media_box.top)),
    )]
    crop_box = page.cropbox
    normalized_crop_points = [transform.apply_on(point) for point in (
        (float(crop_box.left), float(crop_box.bottom)),
        (float(crop_box.left), float(crop_box.top)),
        (float(crop_box.right), float(crop_box.bottom)),
        (float(crop_box.right), float(crop_box.top)),
    )]
    media_width = max(point[0] for point in normalized_media_points) - min(point[0] for point in normalized_media_points)
    media_height = max(point[1] for point in normalized_media_points) - min(point[1] for point in normalized_media_points)
    crop_left = min(point[0] for point in normalized_crop_points)
    crop_bottom = min(point[1] for point in normalized_crop_points)
    crop_width = max(point[0] for point in normalized_crop_points) - crop_left
    crop_height = max(point[1] for point in normalized_crop_points) - crop_bottom
    forward_ctm = tuple(float(value) for value in transform.ctm)
    return media_width, media_height, crop_left, crop_bottom, crop_width, crop_height, forward_ctm, _inverse_ctm(forward_ctm)


def _normalized_page_geometry(page) -> tuple[float, float, float, float, float, float, tuple[float, float, float, float, float, float]]:
    geometry = _normalized_page_geometry_with_transform(page)
    return (*geometry[:6], geometry[7])


def _remove_hidden_text_layer(page, writer) -> None:
    """Remove prior invisible OCR text while retaining visible page content."""
    from pypdf.generic import ContentStream, NameObject

    contents = page.get_contents()
    if contents is None:
        return
    stream = ContentStream(contents, writer)
    render_mode = 0
    saved_modes: list[int] = []
    kept = []
    removed = False
    for operands, operator in stream.operations:
        if operator == b"q":
            saved_modes.append(render_mode)
        elif operator == b"Q":
            render_mode = saved_modes.pop() if saved_modes else 0
        elif operator == b"Tr" and operands:
            render_mode = int(operands[0])
        if operator in {b"Tj", b"TJ", b"'", b'"'} and render_mode == 3:
            removed = True
            continue
        kept.append((operands, operator))
    if removed:
        stream.operations = kept
        page[NameObject("/Contents")] = writer._add_object(stream)


def _write_embedded_text_pdf(
    source: str,
    destination: str,
    pages: list[list[pdf_ocr.OcrWord]],
    image_sizes: list[tuple[int, int]],
    language: str,
    outline: list[dict],
    model_variant: str = pdf_ocr.DEFAULT_OCR_MODEL_VARIANT,
    analysis_header: dict | None = None,
    analysis_payload: dict | None = None,
    *,
    page_indexes: list[int] | None = None,
):
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    language = normalize_app_language(language or DEFAULT_LANGUAGE)
    font_path = _font_path(language)
    # reportlab caches fonts by name, so keep one name per language to avoid
    # registering a stale font file when the language changes mid-process.
    font_name = f"AILSOCRText_{language.capitalize()}"
    if font_name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(font_name, font_path))

    reader = PdfReader(source)
    if reader.is_encrypted:
        raise pdf_ocr.PdfOcrUnavailableError("암호화된 PDF는 잠금을 해제한 뒤 전체 OCR을 실행해 주세요.")
    if _pdf_has_signature(reader):
        raise pdf_ocr.PdfOcrUnavailableError("전자 서명된 PDF는 서명을 무효화할 수 있어 OCR 결과를 원본에 저장할 수 없습니다.")
    if len(reader.pages) != len(pages) or len(reader.pages) != len(image_sizes):
        raise RuntimeError("OCR 페이지 수가 원본 PDF와 일치하지 않습니다.")

    existing_outline_source = str(
        (reader.metadata or {}).get(pdf_ocr.OCR_OUTLINE_SOURCE_KEY, "") or ""
    ).strip().lower()
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    if existing_outline_source == "generated":
        from pypdf.generic import NameObject
        writer._root_object.pop(NameObject("/Outlines"), None)
    selected = set(range(len(pages))) if page_indexes is None else set(page_indexes)
    for page_index, output_page in enumerate(writer.pages):
        if page_index in selected:
            _remove_hidden_text_layer(output_page, writer)
    page_geometries = [_normalized_page_geometry(output_page) for output_page in writer.pages]

    overlay_buffer = BytesIO()
    first_media_width, first_media_height = page_geometries[0][:2] if page_geometries else (612.0, 792.0)
    overlay_canvas = canvas.Canvas(overlay_buffer, pagesize=(first_media_width, first_media_height), pageCompression=1)
    for page_index, words in enumerate(pages):
        media_width, media_height, crop_left, crop_bottom, width, height, _inverse = page_geometries[page_index]
        overlay_canvas.setPageSize((media_width, media_height))
        image_width, image_height = image_sizes[page_index]
        scale_x = width / max(image_width, 1)
        scale_y = height / max(image_height, 1)
        for word in words:
            left = crop_left + word.left * scale_x
            bottom = crop_bottom + height - word.bottom * scale_y
            word_width = max(1.0, (word.right - word.left) * scale_x)
            word_height = max(4.0, (word.bottom - word.top) * scale_y)
            font_size = max(4.0, word_height * 0.72)
            natural_width = max(0.01, pdfmetrics.stringWidth(word.text, font_name, font_size))
            horizontal_scale = max(10.0, min(1000.0, word_width / natural_width * 100.0))
            text = overlay_canvas.beginText()
            text.setTextOrigin(left, bottom + max(0.5, word_height * 0.12))
            text.setFont(font_name, font_size)
            text.setHorizScale(horizontal_scale)
            text.setTextRenderMode(3)
            text.textOut(word.text)
            overlay_canvas.drawText(text)
        overlay_canvas.showPage()
    overlay_canvas.save()
    overlay_buffer.seek(0)
    overlay_reader = PdfReader(overlay_buffer)
    for page_index, output_page in enumerate(writer.pages):
        if page_index not in selected:
            continue
        overlay_page = overlay_reader.pages[page_index]
        inverse_transform = page_geometries[page_index][-1]
        output_page.merge_transformed_page(overlay_page, inverse_transform, over=True, expand=False)

    model_variant = pdf_ocr._normalize_ocr_model_variant(model_variant)
    detection_model, recognition_model = pdf_ocr._ocr_model_names(language, model_variant)
    engine_label = (
        "AILS PP-StructureV3 / PP-OCRv5 ONNX"
        if analysis_header is not None
        else pdf_ocr._ocr_engine_name(model_variant)
    )
    if analysis_header is not None:
        models = analysis_header.get("models") or {}
        detection_model = str(models.get("detector") or detection_model)
        recognition_model = str(models.get("recognizer") or recognition_model)
    metadata = dict(reader.metadata or {})
    metadata.update({
        pdf_ocr.OCR_METADATA_KEY: pdf_ocr.OCR_VERSION,
        pdf_ocr.OCR_LANGUAGE_KEY: language,
        pdf_ocr.OCR_ENGINE_KEY: engine_label,
        pdf_ocr.OCR_MODEL_KEY: model_variant,
        pdf_ocr.OCR_DETECTION_MODEL_KEY: detection_model,
        pdf_ocr.OCR_RECOGNITION_MODEL_KEY: recognition_model,
        pdf_ocr.OCR_PRESET_VERSION_KEY: str(pdf_ocr.OCR_PRESET_VERSION),
        "/Producer": "AILS PaddleOCR / Windows ML",
    })
    if existing_outline_source == "generated":
        metadata.pop(pdf_ocr.OCR_OUTLINE_SOURCE_KEY, None)
    if analysis_header is not None and analysis_payload is not None:
        # The PP-StructureV3 document model rides inside the PDF as an
        # embedded private stream; the original page content is untouched.
        pdf_ocr._analysis_metadata.attach_analysis(
            writer,
            metadata,
            analysis_header,
            pdf_ocr._analysis_metadata.serialize_analysis_payload(analysis_payload),
        )
    else:
        writer.add_metadata(metadata)
    if existing_outline_source == "generated":
        from pypdf.generic import NameObject
        writer._info.get_object().pop(NameObject(pdf_ocr.OCR_OUTLINE_SOURCE_KEY), None)
    try:
        with open(destination, "wb") as handle:
            writer.write(handle)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        overlay_buffer.close()
        stream = getattr(reader, "stream", None)
        if stream is not None and hasattr(stream, "close"):
            stream.close()
    _validate_pdf_output(destination, len(pages))


def _embed_text_layer(path: str, pages: list[list[pdf_ocr.OcrWord]], image_sizes: list[tuple[int, int]], language: str, outline: list[dict]):
    source = os.path.abspath(path)
    output_temp = _new_sibling_pdf_temp(source, "ocr-output")
    try:
        _write_embedded_text_pdf(source, output_temp, pages, image_sizes, language, outline)
        os.replace(output_temp, source)
    finally:
        try:
            os.remove(output_temp)
        except OSError:
            pass


