"""PDF-embedded AILS document analysis storage.

The PP-StructureV3 analysis payload (per-page layout blocks, reading order,
OCR words, table/formula results) is stored *inside the PDF itself* as an
embedded file stream, with a small provenance header in the document Info
dictionary. No sidecar JSON/Markdown files are produced.

The payload is gzip-compressed JSON; keeping the compressed bytes as the
attachment content bounds the size impact on large textbooks while staying a
plain, readable-with-any-tool private application stream.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from datetime import datetime, timezone

ANALYSIS_METADATA_KEY = "/AILSAnalysis"
ANALYSIS_ATTACHMENT_NAME = "ails-analysis.json"
ANALYSIS_PAYLOAD_ENCODING = "gzip+json"
ANALYSIS_SCHEMA_VERSION = 1


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_config_hash(config: dict) -> str:
    """Stable sha256 over the canonical JSON of the analysis configuration."""
    encoded = json.dumps(
        config,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_analysis_header(config: dict, models: dict | None = None) -> dict:
    return {
        "schema_version": ANALYSIS_SCHEMA_VERSION,
        "pipeline": str(config.get("pipeline", "")),
        "payload_encoding": ANALYSIS_PAYLOAD_ENCODING,
        "created_at": utc_now_iso(),
        "config_hash": compute_config_hash(config),
        "models": dict(models or {}),
    }


def serialize_analysis_payload(payload: dict) -> bytes:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    compressed = gzip.compress(encoded, compresslevel=6)
    return compressed


def payload_digest(compressed: bytes) -> str:
    return hashlib.sha256(compressed).hexdigest()


def attach_analysis(writer, metadata: dict, header: dict, compressed_payload: bytes) -> dict:
    """Write the analysis header + embedded payload onto a pypdf writer.

    The header is stored twice on purpose: the Info dict entry carries the
    config hash and payload digest for cheap staleness checks, and the full
    payload rides in the embedded file stream. ``metadata`` is the document
    metadata mapping the caller is about to persist; the analysis entry is
    merged into it and ``writer.add_metadata`` is called here.
    """
    header = dict(header)
    header["payload_sha256"] = payload_digest(compressed_payload)
    header["payload_bytes"] = len(compressed_payload)
    for attachment in list(writer.attachment_list):
        if attachment.name == ANALYSIS_ATTACHMENT_NAME:
            attachment.delete()
    writer.add_attachment(ANALYSIS_ATTACHMENT_NAME, compressed_payload)
    from pdf.pdf_grammar_refinement_metadata import GRAMMAR_METADATA_KEY
    writer.add_metadata({
        **(metadata or {}),
        ANALYSIS_METADATA_KEY: json.dumps(header, ensure_ascii=False, separators=(",", ":")),
        **({GRAMMAR_METADATA_KEY: json.dumps(header["grammar_refinement"], ensure_ascii=False)}
           if "grammar_refinement" in header else {}),
    })
    return header


def _decompress_payload(compressed: bytes) -> bytes:
    if compressed[:2] == b"\x1f\x8b":
        return gzip.decompress(compressed)
    return compressed


def _header_from_value(raw: str | bytes | None) -> dict | None:
    text = raw
    if isinstance(text, bytes):
        try:
            text = text.decode("utf-8")
        except UnicodeDecodeError:
            return None
    text = str(text or "").strip()
    if not text:
        return None
    try:
        header = json.loads(text)
    except json.JSONDecodeError:
        return None
    return header if isinstance(header, dict) else None


def read_analysis_header(path_or_reader) -> dict | None:
    """Read only the Info-dict analysis header, without touching the payload.

    ``pdf_ocr_status`` runs on every viewer status poll, so it must not pay
    the gzip decompression + JSON parse of the full embedded payload. The
    header alone answers pipeline/version/config_hash questions; use
    ``read_analysis_metadata`` when the payload itself is needed.
    """
    from pypdf import PdfReader

    reader = path_or_reader
    close = False
    if not hasattr(reader, "metadata"):
        reader = PdfReader(path_or_reader)
        close = True
    try:
        return _header_from_value((reader.metadata or {}).get(ANALYSIS_METADATA_KEY))
    finally:
        if close:
            stream = getattr(reader, "stream", None)
            if stream is not None and hasattr(stream, "close"):
                stream.close()


def read_analysis_metadata(path_or_reader) -> dict | None:
    """Read the embedded analysis (header + payload) from a PDF.

    Accepts either a filesystem path or an open ``pypdf.PdfReader``. Returns
    None when the PDF was analyzed by a legacy pipeline or carries no AILS
    analysis payload.
    """
    from pypdf import PdfReader

    reader = path_or_reader
    close = False
    if not hasattr(reader, "attachments"):
        reader = PdfReader(path_or_reader)
        close = True
    try:
        header = _header_from_value((reader.metadata or {}).get(ANALYSIS_METADATA_KEY))
        if header is None:
            return None
        attachments = getattr(reader, "attachments", None) or {}
        payload_entry = attachments.get(ANALYSIS_ATTACHMENT_NAME)
        # Older re-OCR runs could leave several attachments with this name.
        # The Info header identifies the current one by its digest.
        candidates = payload_entry if isinstance(payload_entry, (list, tuple)) else [payload_entry]
        stored_digest = str(header.get("payload_sha256", "") or "")
        compressed = next(
            (
                item for item in candidates
                if item is not None
                and (not stored_digest or payload_digest(bytes(item)) == stored_digest)
            ),
            None,
        )
        if compressed is None:
            return {"header": header, "payload": None, **({"corrupt": True} if payload_entry is not None else {})}
        compressed_bytes = bytes(compressed)
        try:
            decoded = json.loads(_decompress_payload(compressed_bytes).decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return {"header": header, "payload": None, "corrupt": True}
        return {"header": header, "payload": decoded}
    finally:
        if close:
            stream = getattr(reader, "stream", None)
            if stream is not None and hasattr(stream, "close"):
                stream.close()


def analysis_config_matches(path: str, current_hash: str) -> bool:
    """True when the embedded analysis was produced with the same config."""
    analysis = read_analysis_metadata(path)
    if not analysis or not analysis.get("header"):
        return False
    return str(analysis["header"].get("config_hash", "")) == str(current_hash)
