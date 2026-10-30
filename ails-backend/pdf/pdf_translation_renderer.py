from __future__ import annotations

import logging
import math
import os
import tempfile
import threading
from collections.abc import Sequence
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np


from pdf.pdf_ocr import _normalized_page_geometry
from pdf.pdfium_runtime import locked_pdfium
from language_support import (
    TRANSLATION_FONT_CANDIDATES,
    language_display_name,
    language_korean_name,
    normalize_app_language,
)

_logger = logging.getLogger(__name__)
_font_registration_lock = threading.Lock()


def _emit(emit: Callable[[dict[str, Any]], None] | None, event: dict[str, Any]) -> None:
    if emit is not None:
        emit(event)


def _check_cancel(cancel_check: Callable[[], None] | None) -> None:
    if cancel_check is not None:
        cancel_check()


def _font_paths(target_language: str = "korean") -> tuple[Path, Path, Path]:
    target_language = normalize_app_language(target_language)
    fonts_root = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    candidates = TRANSLATION_FONT_CANDIDATES[target_language]

    def resolve(names: tuple[str, ...]) -> Path:
        for name in names:
            path = fonts_root / name
            if path.is_file():
                return path
        raise FileNotFoundError(
            f"{language_korean_name(target_language)} 번역 글꼴을 찾을 수 없습니다: {names[0]}"
        )

    regular = resolve(candidates[0])
    bold = resolve(candidates[1])
    serif = resolve(candidates[2])
    return regular, bold, serif


def _register_fonts(target_language: str = "korean") -> tuple[str, str, str]:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    target_language = normalize_app_language(target_language)
    # reportlab caches fonts by name, so keep one family per language to avoid
    # rendering with a stale font file when the target language changes.
    suffix = target_language.capitalize()
    names = (f"AILS{suffix}", f"AILS{suffix}Bold", f"AILS{suffix}Serif")
    paths = _font_paths(target_language)
    with _font_registration_lock:
        registered = set(pdfmetrics.getRegisteredFontNames())
        for name, path in zip(names, paths):
            if name not in registered:
                pdfmetrics.registerFont(TTFont(name, str(path)))
    return names


def _render_pdfium_page(document: Any, page_index: int, scale: float) -> Any:
    with locked_pdfium():
        page = document[page_index]
        bitmap = None
        image = None
        try:
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            return image.convert("RGB").copy()
        finally:
            if image is not None:
                image.close()
            if bitmap is not None:
                bitmap.close()
            page.close()


def _sample_background_color(
    pixels: np.ndarray,
    bbox: list[float],
    page_width: float,
    page_height: float,
) -> tuple[float, float, float]:
    import numpy as np
    height, width = pixels.shape[:2]
    scale_x = width / max(page_width, 1.0)
    scale_y = height / max(page_height, 1.0)
    x0 = max(0, int((float(bbox[0]) - 1.0) * scale_x))
    y0 = max(0, int((float(bbox[1]) - 1.0) * scale_y))
    x1 = min(width, max(x0 + 1, int((float(bbox[2]) + 1.0) * scale_x) + 1))
    y1 = min(height, max(y0 + 1, int((float(bbox[3]) + 1.0) * scale_y) + 1))
    region = pixels[y0:y1, x0:x1, :3].reshape(-1, 3)
    if not len(region):
        return (1.0, 1.0, 1.0)
    quantized = region // 16
    bins, counts = np.unique(quantized, axis=0, return_counts=True)
    dominant = bins[int(np.argmax(counts))]
    selected = region[np.all(quantized == dominant, axis=1)]
    color = np.median(selected if len(selected) else region, axis=0)
    return tuple(float(channel) / 255.0 for channel in color)


def _sample_foreground_color(
    pixels: np.ndarray,
    bbox: list[float],
    page_width: float,
    page_height: float,
    background: tuple[float, float, float],
) -> tuple[float, float, float]:
    import numpy as np
    height, width = pixels.shape[:2]
    scale_x = width / max(page_width, 1.0)
    scale_y = height / max(page_height, 1.0)
    x0 = max(0, int(float(bbox[0]) * scale_x))
    y0 = max(0, int(float(bbox[1]) * scale_y))
    x1 = min(width, max(x0 + 1, int(float(bbox[2]) * scale_x) + 1))
    y1 = min(height, max(y0 + 1, int(float(bbox[3]) * scale_y) + 1))
    region = pixels[y0:y1, x0:x1, :3].reshape(-1, 3).astype(np.float32)
    if not len(region):
        return (0.0, 0.0, 0.0)
    background_rgb = np.array(background, dtype=np.float32) * 255.0
    distance = np.linalg.norm(region - background_rgb, axis=1)
    foreground = region[distance >= max(28.0, float(np.percentile(distance, 90)))]
    if not len(foreground):
        return (0.0, 0.0, 0.0)
    color = np.median(foreground, axis=0)
    return tuple(float(channel) / 255.0 for channel in color)


def _font_fit(
    text: str,
    font_name: str,
    original_size: float,
    available_width: float,
) -> tuple[float, float, float]:
    from reportlab.pdfbase import pdfmetrics
    original_size = max(3.8, float(original_size))
    natural_width = max(0.01, pdfmetrics.stringWidth(text, font_name, original_size))
    width_ratio = min(1.0, max(0.01, available_width) / natural_width)
    minimum_horizontal_scale = 0.60
    if width_ratio >= minimum_horizontal_scale:
        font_size = original_size
        horizontal_scale = width_ratio * 100.0
    else:
        font_size = max(3.8, original_size * width_ratio / minimum_horizontal_scale)
        fitted_width = max(0.01, pdfmetrics.stringWidth(text, font_name, font_size))
        horizontal_scale = min(100.0, max(35.0, available_width / fitted_width * 100.0))
    fitted_width = max(0.01, pdfmetrics.stringWidth(text, font_name, font_size))
    rendered_width = fitted_width * horizontal_scale / 100.0
    return font_size, horizontal_scale, rendered_width


def _safe_metadata(metadata: Mapping[str, Any]) -> dict[str, str]:
    return {
        str(key): str(value)
        for key, value in metadata.items()
        if str(key).startswith("/") and value is not None
    }


def render_layout_pdf(
    source_path: Path,
    output_path: Path,
    layout: dict[str, Any],
    translated: dict[str, Any],
    *,
    emit: Callable[[dict[str, Any]], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
    target_language: str = "korean",
) -> list[dict[str, Any]]:
    import numpy as np
    from reportlab.pdfgen import canvas
    import pypdfium2 as pdfium
    from pypdf import PdfReader, PdfWriter
    target_language = normalize_app_language(target_language)
    regular_name, bold_name, serif_name = _register_fonts(target_language)
    translated_pages = {
        int(item["source_page"]): item for item in translated["pages"]
    }
    selected_pages = [int(page["source_page"]) for page in layout["pages"]]
    source_reader = PdfReader(str(source_path))
    with locked_pdfium():
        source_document = pdfium.PdfDocument(str(source_path))
    overlay_buffer = BytesIO()
    first = layout["pages"][0]
    overlay_canvas = canvas.Canvas(
        overlay_buffer,
        pagesize=(float(first["media_width"]), float(first["media_height"])),
        pageCompression=1,
    )
    checks: list[dict[str, Any]] = []
    total = len(layout["pages"])
    try:
        for output_index, page_data in enumerate(layout["pages"], start=1):
            _check_cancel(cancel_check)
            source_page = int(page_data["source_page"])
            overlay_canvas.setPageSize(
                (float(page_data["media_width"]), float(page_data["media_height"]))
            )
            translations = translated_pages[source_page]["translations"]
            translated_lines = [
                line for line in page_data["lines"] if line["id"] in translations
            ]
            image = _render_pdfium_page(source_document, source_page - 1, 2.0)
            try:
                pixels = np.asarray(image)
                line_checks: list[dict[str, Any]] = []
                prepared: list[tuple[dict[str, Any], tuple[float, float, float], tuple[float, float, float]]] = []
                for line in translated_lines:
                    background = _sample_background_color(
                        pixels,
                        line["bbox"],
                        float(page_data["width"]),
                        float(page_data["height"]),
                    )
                    foreground = _sample_foreground_color(
                        pixels,
                        line["bbox"],
                        float(page_data["width"]),
                        float(page_data["height"]),
                        background,
                    )
                    prepared.append((line, background, foreground))
                    bbox = line["bbox"]
                    left = float(page_data["crop_left"]) + float(bbox[0]) - 1.2
                    bottom = (
                        float(page_data["crop_bottom"])
                        + float(page_data["height"])
                        - float(bbox[3])
                        - 1.2
                    )
                    overlay_canvas.setFillColorRGB(*background)
                    overlay_canvas.rect(
                        left,
                        bottom,
                        max(1.0, float(bbox[2]) - float(bbox[0]) + 2.4),
                        max(1.0, float(bbox[3]) - float(bbox[1]) + 2.4),
                        stroke=0,
                        fill=1,
                    )

                for line, _background, foreground in prepared:
                    korean = str(translations[line["id"]])
                    bbox = line["bbox"]
                    font_name = (
                        serif_name
                        if line.get("serif")
                        else bold_name if line.get("bold") else regular_name
                    )
                    available_width = max(1.0, float(line["available_right"]) - float(bbox[0]))
                    font_size, horizontal_scale, rendered_width = _font_fit(
                        korean,
                        font_name,
                        float(line["font_size"]),
                        available_width,
                    )
                    display_x = float(bbox[0])
                    if line.get("alignment") == "center":
                        display_x = (float(bbox[0]) + float(bbox[2]) - rendered_width) / 2
                    display_x = max(0.5, min(display_x, float(page_data["width"]) - rendered_width - 0.5))
                    line_height = max(1.0, float(bbox[3]) - float(bbox[1]))
                    baseline = (
                        float(page_data["crop_bottom"])
                        + float(page_data["height"])
                        - float(bbox[3])
                        + max(0.5, line_height * 0.16)
                    )
                    text_object = overlay_canvas.beginText()
                    text_object.setTextOrigin(float(page_data["crop_left"]) + display_x, baseline)
                    text_object.setFont(font_name, font_size)
                    text_object.setHorizScale(horizontal_scale)
                    text_object.setFillColorRGB(*foreground)
                    text_object.textOut(korean)
                    overlay_canvas.drawText(text_object)
                    line_checks.append({
                        "id": line["id"],
                        "source": line["text"],
                        "translation": korean,
                        "font_size": round(font_size, 3),
                        "font_scale": round(font_size / max(float(line["font_size"]), 0.01), 4),
                        "horizontal_scale": round(horizontal_scale / 100.0, 4),
                        "bbox": line["bbox"],
                        "rendered_bbox": [
                            round(display_x, 3),
                            round(float(bbox[1]), 3),
                            round(display_x + rendered_width, 3),
                            round(float(bbox[3]), 3),
                        ],
                    })
            finally:
                image.close()
            overlay_canvas.showPage()
            checks.append({
                "source_page": source_page,
                "output_page": output_index,
                "translated_line_count": len(line_checks),
                "lines": line_checks,
            })
            _emit(emit, {
                "type": "render_progress",
                "page": source_page,
                "completed": output_index,
                "total": total,
            })
        overlay_canvas.save()
        overlay_buffer.seek(0)
        overlay_reader = PdfReader(overlay_buffer)
        writer = PdfWriter()
        full_document = selected_pages == list(range(1, len(source_reader.pages) + 1))
        if full_document:
            writer.clone_document_from_reader(source_reader)
        else:
            for source_page in selected_pages:
                writer.add_page(source_reader.pages[source_page - 1])
            writer.add_metadata(_safe_metadata(source_reader.metadata or {}))

        for output_index, page_data in enumerate(layout["pages"]):
            writer.pages[output_index].merge_transformed_page(
                overlay_reader.pages[output_index],
                tuple(float(value) for value in page_data["inverse_transform"]),
                over=True,
                expand=False,
            )
        metadata = _safe_metadata(source_reader.metadata or {})
        original_title = metadata.get("/Title", source_path.stem)
        metadata.update({
            "/Title": f"{original_title} ({language_korean_name(target_language)} 번역)",
            "/AILSTranslation": f"DeepSeek {language_display_name(target_language)} layout-preserving translation",
            "/AILSTranslationEngine": "pypdfium2 + pypdf + ReportLab",
        })
        writer.add_metadata(metadata)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{output_path.stem}-",
            suffix=".pdf",
            dir=str(output_path.parent),
        )
        os.close(fd)
        temporary_path = Path(temporary_name)
        try:
            with temporary_path.open("wb") as handle:
                writer.write(handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, output_path)
        finally:
            temporary_path.unlink(missing_ok=True)
    finally:
        overlay_buffer.close()
        with locked_pdfium():
            source_document.close()
        stream = getattr(source_reader, "stream", None)
        if stream is not None and hasattr(stream, "close"):
            stream.close()
    return checks


def _translation_change_bbox(line: Mapping[str, Any]) -> tuple[float, float, float, float]:
    bbox = line["bbox"]
    rendered_bbox = line.get("rendered_bbox") or bbox
    return (
        min(float(bbox[0]), float(rendered_bbox[0])),
        min(float(bbox[1]), float(rendered_bbox[1])),
        max(float(bbox[2]), float(rendered_bbox[2])),
        max(float(bbox[3]), float(rendered_bbox[3])),
    )


def pixel_preservation_check(
    source_path: Path,
    output_path: Path,
    layout: dict[str, Any],
    checks: list[dict[str, Any]],
    *,
    emit: Callable[[dict[str, Any]], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> list[dict[str, Any]]:
    import numpy as np
    import pypdfium2 as pdfium
    with locked_pdfium():
        source_document = pdfium.PdfDocument(str(source_path))
        output_document = pdfium.PdfDocument(str(output_path))
    try:
        total = len(layout["pages"])
        for output_index, (page_data, check) in enumerate(zip(layout["pages"], checks)):
            _check_cancel(cancel_check)
            source_page = int(page_data["source_page"])
            source_image = _render_pdfium_page(source_document, source_page - 1, 0.8)
            output_image = _render_pdfium_page(output_document, output_index, 0.8)
            try:
                source_pixels = np.asarray(source_image).astype(np.int16)
                output_pixels = np.asarray(output_image).astype(np.int16)
                height = min(source_pixels.shape[0], output_pixels.shape[0])
                width = min(source_pixels.shape[1], output_pixels.shape[1])
                source_pixels = source_pixels[:height, :width, :3]
                output_pixels = output_pixels[:height, :width, :3]
                mask = np.zeros((height, width), dtype=bool)
                scale_x = width / max(float(page_data["width"]), 1.0)
                scale_y = height / max(float(page_data["height"]), 1.0)
                for line in check["lines"]:
                    left, top, right, bottom = _translation_change_bbox(line)
                    x0 = max(0, int((left - 2.0) * scale_x))
                    y0 = max(0, int((top - 2.0) * scale_y))
                    x1 = min(width, int((right + 2.0) * scale_x) + 1)
                    y1 = min(height, int((bottom + 2.0) * scale_y) + 1)
                    mask[y0:y1, x0:x1] = True
                difference = np.abs(source_pixels - output_pixels).mean(axis=2)
                outside = difference[~mask]
                check["outside_translation_mae"] = round(
                    float(outside.mean()) if outside.size else 0.0,
                    4,
                )
                check["source_render_size"] = [int(width), int(height)]
                check["output_render_size"] = [
                    int(output_pixels.shape[1]),
                    int(output_pixels.shape[0]),
                ]
            finally:
                source_image.close()
                output_image.close()
            _emit(emit, {
                "type": "verify_progress",
                "page": source_page,
                "completed": output_index + 1,
                "total": total,
            })
    finally:
        with locked_pdfium():
            source_document.close()
            output_document.close()
    return checks


