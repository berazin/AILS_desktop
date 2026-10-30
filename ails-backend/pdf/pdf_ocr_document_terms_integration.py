"""Job-scoped raw document evidence; no persistent state or corrected inputs."""
from dataclasses import asdict, dataclass
from types import MappingProxyType
import sqlite3

from .pdf_ocr_document_terms import RawBlock, Evidence, build_evidence, apply_evidence
from .pdf_grammar_refinement_metadata import GRAMMAR_REFINEMENT_VERSION, KIWI_VERSION


@dataclass(frozen=True)
class DocumentContext:
    evidence: Evidence
    blocks: object
    kiwi_future: object = None


def prepare_document_context(page_inputs, *, cancel_check=None):
    from . import pdf_ocr_spacing as spacing
    raw_blocks, mapping = [], {}
    for page, words, analysis in page_inputs:
        if cancel_check:
            cancel_check()
        for block in (analysis or {}).get("blocks", []):
            if block.get("type") != "text" or block.get("text_source") == "native":
                continue
            raw = RawBlock(page, str(block.get("block_id", len(raw_blocks))),
                           tuple(line["text"] for line in spacing._lines(words, block.get("words") or [])))
            raw_blocks.append(raw)
            mapping[id(block)] = (block, raw)
    if not raw_blocks:
        return DocumentContext(Evidence("skipped", "no_eligible_prose", None), MappingProxyType(mapping))
    future = spacing.prepare_spacing()
    # Initialization precedes this work on the same executor. Never submit and
    # wait recursively from the page worker.
    evidence = spacing._executor.submit(_prepare, tuple(raw_blocks), future, cancel_check).result()
    return DocumentContext(evidence, MappingProxyType(mapping), future)


def _prepare(blocks, future, cancel_check):
    from .pdf_ocr_spacing import _protected_boundaries
    if cancel_check:
        cancel_check()
    try:
        kiwi = future.result()
        if not callable(getattr(kiwi, "extract_words", None)) or not callable(getattr(kiwi, "tokenize", None)):
            return Evidence("unavailable", "missing_extractor", None)
        from .pdf_ocr_terminology import get_term_dictionary
        dictionary = get_term_dictionary()
    except InterruptedError:
        raise
    except (OSError, UnicodeError, RuntimeError, ImportError, sqlite3.Error) as error:
        if cancel_check:
            cancel_check()
        return Evidence("unavailable", "preparation:" + type(error).__name__, None)
    try:
        return build_evidence(blocks, dictionary, kiwi, protected_boundaries=_protected_boundaries,
                              extraction_revision=f"policy={GRAMMAR_REFINEMENT_VERSION};kiwi={KIWI_VERSION};model=cong-global;workers=1;extract=min_cnt:3,max_word_len:16",
                              cancel_check=cancel_check)
    except MemoryError:
        if cancel_check:
            cancel_check()
        return Evidence("unavailable", "preparation:MemoryError", None)


def apply_document_context(context, block, spacing, kiwi, *, cancel_check=None):
    from .pdf_ocr_spacing import _protected_boundaries
    entry = context.blocks.get(id(block))
    if entry is None or entry[0] is not block:
        raise ValueError("block does not belong to this document job")
    raw = entry[1]
    if raw.text != spacing["raw_text"]:
        raise ValueError("raw OCR changed after document evidence preparation")
    application = apply_evidence(context.evidence, raw, spacing["text"], kiwi,
                                 protected_boundaries=_protected_boundaries, cancel_check=cancel_check)
    diagnostics = context.evidence.diagnostics()
    if application.status == "unavailable":
        diagnostics = dict(status="unavailable", reason=application.reason, revision=None, candidate_count=0)
    diagnostics.update(applied_count=application.applied_count,
                       changes=[asdict(change) for change in application.changes])
    spacing["document_terms"] = diagnostics
    spacing["text"] = application.text


def finalize_document_spacing(spacing, kiwi):
    """Validate final output and keep document application diagnostics truthful."""
    from .pdf_ocr_spacing import _compact, _protected_boundaries
    from .pdf_ocr_punctuation import correct_punctuation
    raw = spacing["raw_text"]
    result = correct_punctuation(spacing["text"], kiwi, _protected_boundaries(raw))
    if _compact(result) != _compact(raw):
        raise ValueError("final spacing changed OCR characters")
    raw_positions = [i for i, c in enumerate(raw) if not c.isspace()]
    positions = [i for i, c in enumerate(result) if not c.isspace()]
    for boundary in _protected_boundaries(raw):
        if 0 < boundary < len(raw_positions):
            a, b = raw_positions[boundary - 1] + 1, raw_positions[boundary]
            c, d = positions[boundary - 1] + 1, positions[boundary]
            if raw[a:b] != result[c:d]:
                raise ValueError("final spacing changed protected OCR interior")
    diagnostics = spacing.get("document_terms")
    if diagnostics is not None:
        surviving = []
        for change in diagnostics["changes"]:
            first, last = change["compact_start"], change["compact_end"]
            start, end = positions[first], positions[last - 1] + 1
            after = result[start:end]
            if after != change["before"]:
                surviving.append({**change, "after": after, "output_start": start, "output_end": end})
        diagnostics.update(changes=surviving, applied_count=len(surviving))
    spacing["text"] = result
    spacing["status"] = "corrected" if result != raw else "preserved"
    spacing["edits"] = ([{"source_word_indexes": spacing["source_word_indexes"],
                         "output_start": 0, "output_end": len(result)}]
                        if result != raw else [])
