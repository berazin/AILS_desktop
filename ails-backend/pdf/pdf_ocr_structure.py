"""PP-StructureV3 document structure and table analysis pipeline.

Extracted from pdf_ocr.py to isolate PP-Structure layout detection, table
parsing, and reading order extraction.
"""

from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from typing import Callable, Any

import pdf.pdf_structure as pdf_structure
import pdf.pdf_analysis_metadata as _analysis_metadata
from local_inference import GPU_SCHEDULER
from pdf.pdf_outline import toc_page_indexes as _pdf_toc_page_indexes

from pdf.pdf_ocr_postprocess import (
    _correct_ocr_page_words,
    _deduplicate_ocr_words,
)

from pdf.pdf_ocr import (
    DEFAULT_LANGUAGE,
    DEFAULT_OCR_MODEL_VARIANT,
    DmlOcrExecutionError,
    OcrPerformanceProfile,
    OcrWord,
    PdfOcrCancelledError,
    _CURRENT_OCR_GPU_PRIORITY,
    _inference_lock,
    _is_dml_execution_error,
    _ocr_batch_pages,
    _ocr_render_scale,
    _raise_if_ocr_cancelled,
    _render_pdf_pages,
)

_logger = logging.getLogger(__name__)


def _active_structure_predict_page(*args, **kwargs):
    import sys
    mod = sys.modules.get('pdf.pdf_ocr')
    fn = getattr(mod, "_structure_predict_page", None) if mod is not None else None
    if fn is not None and fn is not _structure_predict_page:
        return fn(*args, **kwargs)
    return _structure_predict_page(*args, **kwargs)

def _active_render_pdf_pages(*args, **kwargs):
    import sys
    mod = sys.modules.get('pdf.pdf_ocr')
    fn = getattr(mod, "_render_pdf_pages", None) if mod is not None else None
    if fn is not None and fn is not _render_pdf_pages:
        return fn(*args, **kwargs)
    return _render_pdf_pages(*args, **kwargs)

def structure_analysis_enabled() -> bool:
    """PP-StructureV3 analysis is the required document OCR pipeline."""
    return True


def _analyze_pdf_pages_structure(
    render_source: str,
    total: int,
    profile: OcrPerformanceProfile,
    language: str,
    model_variant: str,
    emit: Callable[[dict], None] | None,
    cancel_event: threading.Event | None = None,
    page_indexes: list[int] | None = None,
) -> tuple[list[list[OcrWord]], list[tuple[int, int]], list[dict]]:
    # Every native OCR backend can block inside inference. Keep CPU, DirectML
    # and OpenVINO in the same disposable process so cancellation is bounded.
    if os.environ.get("AILS_OCR_GPU_WORKER") != "1":
        import pdf.ocr_gpu_worker as ocr_gpu_worker
        request = {
            "render_source": render_source,
            "total": total,
            "profile": profile,
            "language": language,
            "model_variant": model_variant,
            "page_indexes": page_indexes,
            "priority": _CURRENT_OCR_GPU_PRIORITY.get(),
        }
        try:
            with GPU_SCHEDULER.acquire(
                "ocr",
                priority=_CURRENT_OCR_GPU_PRIORITY.get(),
                cancel_check=lambda: _raise_if_ocr_cancelled(cancel_event),
            ):
                return ocr_gpu_worker.analyze_in_gpu_worker(
                    request,
                    emit=emit,
                    cancel_event=cancel_event,
                )
        except ocr_gpu_worker.GpuOcrWorkerCancelled as error:
            raise PdfOcrCancelledError(
                "OCR 작업이 사용자 요청으로 중단되었습니다."
            ) from error
    return _analyze_pdf_pages_structure_inline(
        render_source,
        total,
        profile,
        language,
        model_variant,
        emit,
        cancel_event,
        page_indexes=page_indexes,
    )


def _supplement_toc_outline_words(
    render_source: str,
    pages: list[list[OcrWord]],
    analyses: list[dict | None],
    engine,
    render_scale: float,
    cancel_event: threading.Event | None,
) -> None:
    """Read the upper half of TOC pages at full OCR resolution for bookmarks.

    A whole-page detector can miss small TOC rows. These extra readings never
    replace the page words used by the PDF text layer or search index.
    """
    import numpy as np

    toc_indexes = _pdf_toc_page_indexes(pages)
    if not toc_indexes:
        return
    pipeline = engine.paddlex_pipeline
    pipeline = getattr(pipeline, "_pipeline", pipeline)
    if not hasattr(pipeline, "general_ocr_pipeline"):
        pipeline = pipeline._pipelines[0]
    for page_index in toc_indexes:
        _raise_if_ocr_cancelled(cancel_event)
        rendered = _active_render_pdf_pages(render_source, [page_index], render_scale)
        image = rendered[0][1]
        try:
            crop_bottom = max(1, int(image.height * 0.55))
            crop = image.crop((0, 0, image.width, crop_bottom))
            try:
                result = next(iter(pipeline.general_ocr_pipeline(
                    np.asarray(crop), use_textline_orientation=False,
                )), None)
            finally:
                crop.close()
            entries = pdf_structure._ocr_entries(pdf_structure.page_result_payload(result))
            if entries and analyses[page_index] is not None:
                analyses[page_index]["outline_crop_bottom"] = crop_bottom
                analyses[page_index]["outline_words"] = entries
        finally:
            image.close()


def _analyze_pdf_pages_structure_inline(
    render_source: str,
    total: int,
    profile: OcrPerformanceProfile,
    language: str,
    model_variant: str,
    emit: Callable[[dict], None] | None,
    cancel_event: threading.Event | None = None,
    page_indexes: list[int] | None = None,
) -> tuple[list[list[OcrWord]], list[tuple[int, int]], list[dict]]:
    """Run PP-StructureV3 per page with the shared render prefetch pipeline.

    One rendered bitmap per page feeds layout detection, reading order, OCR
    and (on table pages) table analysis. The pass starts with the light
    engine (table models unloaded: they cost ~2/3 of engine creation and
    most of its memory); pages whose layout contains table blocks then reuse
    those results in a table-only engine after a sequential swap. Returns (words per
    page, image sizes, page analyses) with analyses carrying blocks/words in
    pixel coordinates. ``page_indexes`` restricts analysis to a subset
    (선택적 OCR); the remaining pages stay empty.
    """
    _raise_if_ocr_cancelled(cancel_event)
    # Hardware-based engine choice: dedicated GPUs take the full engine
    # directly, shared-memory GPUs start light and upgrade for table pages.
    strategy = pdf_structure.engine_strategy(profile)
    tables_pass = strategy == pdf_structure.STRATEGY_FULL
    pages: list[list[OcrWord]] = [[] for _ in range(total)]
    image_sizes: list[tuple[int, int]] = [(1, 1) for _ in range(total)]
    analyses: list[dict | None] = [None for _ in range(total)]
    table_payloads: dict[int, dict] = {}
    batch_pages = _ocr_batch_pages(profile, model_variant)
    analyze_indexes = (
        list(range(total))
        if page_indexes is None
        else [index for index in page_indexes if 0 <= index < total]
    )
    page_groups = [
        analyze_indexes[start : start + batch_pages]
        for start in range(0, len(analyze_indexes), batch_pages)
    ]
    render_scale = _ocr_render_scale(model_variant)
    import numpy as np

    scheduler = (
        GPU_SCHEDULER.acquire("ocr", priority=_CURRENT_OCR_GPU_PRIORITY.get())
        if profile is not None and profile.gpu_provider
        else nullcontext()
    )
    current_future = None
    engine = None
    try:
        with scheduler, _inference_lock:
            engine = pdf_structure.structure_engine(
                language,
                profile,
                model_variant,
                tables=tables_pass,
            )
            with ThreadPoolExecutor(max_workers=profile.render_workers, thread_name_prefix="ails-ocr-render") as executor:
                current_future = (
                    executor.submit(_active_render_pdf_pages, render_source, page_groups[0], render_scale)
                    if page_groups
                    else None
                )
                for group_index, _page_indexes in enumerate(page_groups):
                    _raise_if_ocr_cancelled(cancel_event)
                    rendered = current_future.result()
                    _raise_if_ocr_cancelled(cancel_event)
                    next_indexes = page_groups[group_index + 1] if group_index + 1 < len(page_groups) else []
                    current_future = (
                        executor.submit(_active_render_pdf_pages, render_source, next_indexes, render_scale)
                        if next_indexes
                        else None
                    )
                    try:
                        for page_index, image in rendered:
                            image_array = np.asarray(image.convert("RGB"))
                            if tables_pass:
                                analysis = _active_structure_predict_page(
                                    engine,
                                    image_array,
                                    image.width,
                                    image.height,
                                    tables=True,
                                )
                            else:
                                predicted = _active_structure_predict_page(
                                    engine,
                                    image_array,
                                    image.width,
                                    image.height,
                                    tables=False,
                                    return_payload=True,
                                )
                                if (
                                    isinstance(predicted, tuple)
                                    and len(predicted) == 2
                                ):
                                    analysis, payload = predicted
                                else:
                                    analysis, payload = predicted, {}
                                if any(
                                    block.get("type") == "table"
                                    for block in analysis.get("blocks") or []
                                ):
                                    table_payloads[page_index] = payload
                            words = _finalize_structure_words(analysis, image.width, image.height)
                            pages[page_index] = words
                            image_sizes[page_index] = image.size
                            analyses[page_index] = analysis
                            if emit:
                                emit({
                                    "type": "progress",
                                    "page": page_index + 1,
                                    "total": total,
                                    "text": pdf_structure.reading_order_text(analysis, words),
                                })
                    except Exception as error:
                        if _is_dml_execution_error(error, profile):
                            raise DmlOcrExecutionError(
                                "DirectML GPU가 구조 분석 중 재설정되었습니다."
                            ) from error
                        raise
                    finally:
                        for _, image in rendered:
                            image.close()
            _supplement_toc_outline_words(
                render_source, pages, analyses, engine, render_scale, cancel_event,
            )
    except Exception:
        if current_future is not None:
            current_future.cancel()
        raise
    # Keep analyses aligned with page indexes even for a degenerate page.
    analyses = [
        analysis or {"width": 1, "height": 1, "blocks": [], "words": []}
        for analysis in analyses
    ]
    if (
        strategy == pdf_structure.STRATEGY_LIGHT_UPGRADE
        and table_payloads
    ):
        del engine
        _upgrade_structure_table_pages(
            render_source,
            pages,
            image_sizes,
            analyses,
            table_payloads,
            profile,
            language,
            model_variant,
            render_scale,
            np,
            emit,
            cancel_event,
        )
    return pages, image_sizes, analyses


def _structure_predict_page(
    engine,
    image_array,
    image_width: int,
    image_height: int,
    *,
    tables: bool,
    return_payload: bool = False,
):
    """One page through PP-StructureV3, converted to the AILS document model.

    Orientation modules stay off: AILS renders upright bitmaps, and enabling
    table orientation classify would lazily download PP-LCNet_x1_0_doc_ori on
    the first table.
    """
    prediction = engine.predict(
        image_array,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        use_table_orientation_classify=False,
        use_table_recognition=tables,
    )
    result = next(iter(prediction), None)
    payload = pdf_structure.page_result_payload(result)
    analysis = pdf_structure.extract_page_analysis(
        payload,
        image_width,
        image_height,
    )
    if return_payload:
        return analysis, payload
    return analysis


def _finalize_structure_words(analysis, image_width, image_height):
    """Post-process the analysis word list in place; returns the final words.

    ``assign_words_to_blocks`` mutates ``analysis`` (block word indexes and
    per-block confidences) to match the corrected/deduplicated list.
    """
    words = pdf_structure.words_to_ocr_words(analysis)
    words = _correct_ocr_page_words(words, image_width, image_height)
    words = _deduplicate_ocr_words(words)
    pdf_structure.assign_words_to_blocks(analysis, words)
    return words


def _upgrade_structure_table_pages(
    render_source: str,
    pages: list[list[OcrWord]],
    image_sizes: list[tuple[int, int]],
    analyses: list[dict],
    table_payloads: dict[int, dict],
    profile: OcrPerformanceProfile,
    language: str,
    model_variant: str,
    render_scale: float,
    np,
    emit: Callable[[dict], None] | None,
    cancel_event: threading.Event | None = None,
) -> None:
    """Enrich pages with table blocks through the table-only engine.

    The light engine has no table models, so its table blocks carry layout
    boxes but no HTML. Release it before creating the table-only engine and
    reuse its OCR/layout payload without rerunning those core models.
    """
    table_pages = sorted(table_payloads)
    if not table_pages:
        return
    _raise_if_ocr_cancelled(cancel_event)
    scheduler = (
        GPU_SCHEDULER.acquire("ocr", priority=_CURRENT_OCR_GPU_PRIORITY.get())
        if profile is not None and profile.gpu_provider
        else nullcontext()
    )
    if emit:
        emit({
            "type": "structure_table_pass",
            "pages": len(table_pages),
            "page_numbers": [index + 1 for index in table_pages],
        })
    with scheduler, _inference_lock:
        pdf_structure.discard_structure_engine(language, tables=False)
        engine = pdf_structure.table_engine(language, profile, model_variant)
        rendered = _active_render_pdf_pages(render_source, table_pages, render_scale)
        try:
            for page_index, image in rendered:
                _raise_if_ocr_cancelled(cancel_event)
                try:
                    image_array = np.asarray(image.convert("RGB"))
                    payload = pdf_structure.enrich_table_payload(
                        engine,
                        image_array,
                        table_payloads[page_index],
                    )
                    analysis = pdf_structure.extract_page_analysis(
                        payload,
                        image.width,
                        image.height,
                    )
                    words = _finalize_structure_words(analysis, image.width, image.height)
                    pages[page_index] = words
                    image_sizes[page_index] = image.size
                    analyses[page_index] = analysis
                except Exception as error:
                    if _is_dml_execution_error(error, profile):
                        raise DmlOcrExecutionError(
                            "DirectML GPU가 표 분석 중 재설정되었습니다."
                        ) from error
                    raise
        finally:
            for _, image in rendered:
                image.close()


def _structure_analysis_payload(
    normalized: str,
    analyses: list[dict | None],
    language: str,
    model_variant: str,
    profile: OcrPerformanceProfile,
) -> tuple[dict, dict]:
    """Build the embedded document-model payload and provenance header."""
    image_sizes = [
        (max(1, int((analysis or {}).get("width") or 1)), max(1, int((analysis or {}).get("height") or 1)))
        for analysis in analyses
    ]
    pages_payload = []
    for page_number, analysis in enumerate(analyses, start=1):
        if analysis is None:
            continue
        blocks = pdf_structure.normalized_blocks(analysis, *image_sizes[page_number - 1])
        pages_payload.append({
            "page": page_number,
            "width": image_sizes[page_number - 1][0],
            "height": image_sizes[page_number - 1][1],
            "blocks": blocks,
            "spacing_status": analysis.get("spacing_status"),
            **({"spacing_error": analysis["spacing_error"]} if analysis.get("spacing_error") else {}),
        })
    config = pdf_structure.structure_modules_config(language, model_variant)
    models = pdf_structure.actual_model_names(language)
    table_page_count = sum(
        1
        for analysis in analyses if analysis is not None
        if any(block.get("table") for block in analysis.get("blocks") or [])
    )
    header = _analysis_metadata.build_analysis_header(config, models)
    from pdf.pdf_grammar_refinement_metadata import grammar_metadata
    refinement = grammar_metadata(a.get("spacing_status") for a in analyses if a is not None)
    header["grammar_refinement"] = refinement
    payload = {
        "schema_version": _analysis_metadata.ANALYSIS_SCHEMA_VERSION,
        "pipeline": pdf_structure.ANALYSIS_PIPELINE,
        "path": os.path.basename(normalized),
        "language": language,
        "model_variant": model_variant,
        "gpu_provider": getattr(profile, "gpu_provider", None) if profile else None,
        "engine_strategy": pdf_structure.engine_strategy(profile),
        "table_pages": table_page_count,
        "config": config,
        "models": models,
        "grammar_refinement": refinement,
        "pages": pages_payload,
    }
    return header, payload
