"""Bounded, read-only evidence lookup for one lecture verification job."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import stat
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .video_analysis import VideoAnalysisError, source_fingerprint


UNAVAILABLE_EVIDENCE_REPLY = '{"status":"error","evidence":[],"error":"evidence_unavailable"}'


def verification_lookup_limits(source_records: list[dict], stt_utterances: list[dict] | None = None) -> dict[str, int]:
    """Size per-job evidence budgets from valid timed utterances, with hard caps."""
    timed_ids = set()
    for item in source_records:
        if not isinstance(item, dict):
            continue
        source_id = item.get("source_id")
        start = item.get("start_seconds", item.get("start"))
        end = item.get("end_seconds", item.get("end"))
        if (isinstance(source_id, str) and re.fullmatch(r"T\d{4}", source_id)
                and all(isinstance(value, (int, float)) and not isinstance(value, bool)
                        and math.isfinite(value) for value in (start, end))
                and 0 <= start <= end):
            timed_ids.add(source_id)
    count = len(timed_ids)
    if not count and stt_utterances:
        count = sum(1 for item in stt_utterances if isinstance(item, dict)
                    and isinstance(item.get("text"), str) and item["text"].strip()
                    and all(isinstance(item.get(key), (int, float)) and not isinstance(item.get(key), bool)
                            and math.isfinite(item[key]) for key in ("start", "end"))
                    and 0 <= item["start"] <= item["end"])
    if not count:
        return {"timed_utterances": 0, "stt": 12, "frame": 4, "tool_rounds": 5}
    root = math.isqrt(count)
    ceil_root = root if root * root == count else root + 1
    return {"timed_utterances": count, "stt": min(64, max(4, 2 * ceil_root)),
            "frame": min(32, max(2, ceil_root)), "tool_rounds": min(24, max(5, ceil_root))}
_BLOCK_PATCH_REASONS = (
    "invalid_fields|empty_or_unchanged|too_large|internal_ids|link_destinations|"
    "heading_structure|code_fences|inline_delimiters|unbound_patch"
)
CORRECTION_PATTERN = re.compile(
    r"Correct verification response: (?:json_syntax|schema_shape|semantic_validation|tool_id|tool_request|tool_limit|validation_error) "
    r"at (?:result|tool_calls|(?:claims|issues|edits|findings)(?:\[\d{1,3}\])?(?:\.[a-z_]{1,32})?)\."
    r"(?: Allowed returned IDs for C\d{3,4}: (?:none|[STI]\d{4}(?:,[STI]\d{4}){0,23})\.)?"
    r"(?: Keep C\d{3,4} bound to its first STT lookup quote\.)?"
    r"(?: Include required claims: C\d{3,4}(?:,C\d{3,4}){0,11}\.)?"
    r"(?: Omit summary_quote after registration\.)?"
    r"(?: Use the exact registered draft quote for this finding\.)?"
    r"(?: Keep the edit inside one prose block and preserve complete inline code or math spans; otherwise (?:use unresolved|keep the problem) with edit null\.)?"
    r"(?: Preserve every finding and its fields except edit\. Adjust only the edit to preserve code, math and links\.)?"
    r"(?: Return one replace_block edit per affected B block, preserving links and Markdown\. If a prior finding was mistaken, explicitly return dismissed with a reason and edit null\.)?"
    r"(?: Block B\d{4,6} rejected: (?:" + _BLOCK_PATCH_REASONS + r")\.)?"
)


def verification_correction_message(code: str, error: Exception | None = None, *,
                                    claim_id: str = "", allowed_source_ids: list[str] | None = None,
                                    locked_claim_id: str = "", missing_lookup_claim_ids: list[str] | None = None) -> str:
    """Return only a bounded error code and field path, never model content."""
    path = "tool_calls" if code.startswith("tool_") else "result"
    if error is not None and code == "semantic_validation":
        match = re.search(r"\b(?:claims|issues|edits|findings)(?:\[\d{1,3}\])?(?:\.[a-z_]{1,32})?\b", str(error)[:256])
        if match:
            path = match.group(0)
    result = f"Correct verification response: {code} at {path}."
    if (code == "semantic_validation" and path.endswith(".source_ids")
            and re.fullmatch(r"C\d{3,4}", claim_id) and allowed_source_ids is not None):
        allowed = sorted({value for value in allowed_source_ids
                          if isinstance(value, str) and re.fullmatch(r"[STI]\d{4}", value)})[:24]
        result += f" Allowed returned IDs for {claim_id}: {','.join(allowed) if allowed else 'none'}."
    omit_registered_quote = (code == "semantic_validation" and path.endswith(".summary_quote")
                             and error is not None and "must be omitted after registration" in str(error))
    if (code == "semantic_validation" and path.endswith(".summary_quote")
            and re.fullmatch(r"C\d{3,4}", locked_claim_id) and not omit_registered_quote):
        result += f" Keep {locked_claim_id} bound to its first STT lookup quote."
    if code == "semantic_validation" and missing_lookup_claim_ids:
        missing = sorted({value for value in missing_lookup_claim_ids
                          if isinstance(value, str) and re.fullmatch(r"C\d{3,4}", value)})[:12]
        if missing:
            result += f" Include required claims: {','.join(missing)}."
    if omit_registered_quote:
        result += " Omit summary_quote after registration."
    if code == "semantic_validation" and path.endswith(".anchor_quote"):
        result += " Use the exact registered draft quote for this finding."
    if (code == "semantic_validation" and path.endswith(".edit")
            and error is not None and "unsafe_edit" in str(error)):
        if "block_patch" in str(error):
            result += (" Return one replace_block edit per affected B block, preserving links and Markdown. "
                       "If a prior finding was mistaken, explicitly return dismissed with a reason and edit null.")
            detail = re.search(r"\bblock_id=(B\d{4,6}) reason=(" + _BLOCK_PATCH_REASONS + r")\b", str(error)[:256])
            if detail:
                result += f" Block {detail[1]} rejected: {detail[2]}."
        else:
            result += (" Keep the edit inside one prose block and preserve complete inline code "
                       "or math spans; otherwise keep the problem with edit null.")
    return result


def is_safe_verification_correction_message(value: object) -> bool:
    return isinstance(value, str) and len(value) <= 400 and CORRECTION_PATTERN.fullmatch(value) is not None


def _canonical_private_phrase(value: str) -> str:
    # Treat every separator alike for privacy containment, including technical
    # punctuation. The verifier can rephrase an overblocked concept query.
    folded = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\W_]+", " ", folded).strip()


class InvalidEvidenceRequest(ValueError):
    evidence_status = "invalid_request"


class EvidenceLookupLimit(RuntimeError):
    evidence_status = "limit"


class EvidenceReadError(OSError):
    evidence_status = "error"


class VerificationClaimRegistry:
    """Assign stable claim IDs to exact summary spans before evidence lookup."""

    def __init__(self, summary_markdown: str) -> None:
        self._summary = summary_markdown
        self._by_span: dict[tuple[int, int], str] = {}
        self.claims: dict[str, dict] = {}

    def register(self, claims: list[dict]) -> str:
        if not isinstance(claims, list) or not 1 <= len(claims) <= 20:
            raise InvalidEvidenceRequest("Register 1 to 20 claims per call.")
        resolved = []
        for item in claims:
            if not isinstance(item, dict) or "summary_quote" not in item or set(item) - {"summary_quote", "occurrence"}:
                raise InvalidEvidenceRequest("Claim registration requires a quote.")
            quote, occurrence = item["summary_quote"], item.get("occurrence")
            if not isinstance(quote, str) or not 1 <= len(quote) <= 2000:
                raise InvalidEvidenceRequest("Invalid claim quote.")
            positions = [match.start() for match in re.finditer(re.escape(quote), self._summary)]
            if occurrence is None:
                if len(positions) != 1:
                    raise InvalidEvidenceRequest("Repeated claim quote requires an occurrence.")
                occurrence = 0
            if not isinstance(occurrence, int) or isinstance(occurrence, bool) or occurrence < 0:
                raise InvalidEvidenceRequest("Invalid claim occurrence.")
            if occurrence >= len(positions):
                raise InvalidEvidenceRequest("Claim quote occurrence is absent from summary.")
            start = positions[occurrence]
            resolved.append((quote, start, start + len(quote)))
        new_spans = {(start, end) for _, start, end in resolved if (start, end) not in self._by_span}
        if len(self.claims) + len(new_spans) > 1000:
            raise EvidenceLookupLimit("Claim registration limit reached.")
        registered = []
        for quote, start, end in resolved:
            span = (start, end)
            claim_id = self._by_span.get(span)
            if claim_id is None:
                claim_id = f"C{len(self.claims) + 1:03d}"
                self._by_span[span] = claim_id
                self.claims[claim_id] = {"summary_quote": quote, "start": start, "end": end}
            registered.append({"claim_id": claim_id, "summary_quote": quote})
        return json.dumps({"status": "registered", "claims": registered}, ensure_ascii=False)

    def quote(self, claim_id: str) -> str:
        claim = self.claims.get(claim_id)
        if claim is None:
            raise InvalidEvidenceRequest("Claim ID was not registered.")
        return claim["summary_quote"]


def register_concept_candidates(registry: VerificationClaimRegistry,
                                lookup: "VerificationEvidenceLookup",
                                candidates: list[dict], *, require_cached_frame: bool = False) -> dict[str, Any]:
    """Register suspected prose and return its local evidence in the same tool reply."""
    registered = json.loads(registry.register([
        {"summary_quote": item["summary_quote"]} for item in candidates
    ]))["claims"]
    results = []
    images = []
    for candidate, claim in zip(candidates, registered):
        claim_id = claim["claim_id"]
        t_ids = candidate["t_ids"]
        evidence_status = "missing"
        evidence = []
        frame_status = "not_requested"
        frame_evidence = []
        if t_ids:
            try:
                stt_reply = json.loads(lookup.lookup_stt(
                    claim_ids=[claim_id], summary_quote=claim["summary_quote"], t_ids=t_ids,
                ))
                evidence_status = stt_reply["status"]
                evidence = stt_reply.get("evidence") or []
            except (InvalidEvidenceRequest, EvidenceLookupLimit, EvidenceReadError) as error:
                evidence_status = error.evidence_status
        else:
            lookup.locator_status_by_claim[claim_id] = "missing_t_id"
        if candidate["needs_frame"]:
            frame_status = "missing"
            frame_t_id = next((item for item in t_ids if item.startswith("T")
                               and item in lookup.returned_stt_anchors_by_claim.get(claim_id, set())), None)
            if evidence_status == "found" and frame_t_id:
                try:
                    frame_reply = lookup.lookup_frame(
                        claim_ids=[claim_id], t_id=frame_t_id, _require_cache=require_cached_frame,
                    )
                    frame_data = json.loads(frame_reply["content"])
                    frame_status = frame_data.get("status", "missing")
                    frame_evidence = frame_data.get("evidence") or []
                    images.extend(frame_reply.get("image_parts") or [])
                except (InvalidEvidenceRequest, EvidenceLookupLimit, EvidenceReadError) as error:
                    frame_status = error.evidence_status
        results.append({"claim_id": claim_id, "summary_quote": claim["summary_quote"],
                        "stt_status": evidence_status, "stt_evidence": evidence,
                        "frame_status": frame_status, "frame_evidence": frame_evidence})
    status = "found" if any(item["stt_status"] == "found" for item in results) else "missing"
    return {"content": json.dumps({"status": status, "claims": results}, ensure_ascii=False),
            "image_parts": images, "evidence_status": status}


def _extract_video_frame(path: Path, seconds: float) -> tuple[bytes, float]:
    """Seek to one requested position; never run a full-video analysis here."""
    try:
        import cv2
    except ImportError as error:
        raise EvidenceReadError("Original video frame decoder is unavailable.") from error

    try:
        capture = cv2.VideoCapture(str(path))
    except (cv2.error, OSError) as error:
        raise EvidenceReadError("Original video cannot be opened.") from error
    try:
        if not capture.isOpened():
            raise EvidenceReadError("Original video cannot be opened.")
        capture.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
        ok, frame = capture.read()
        if not ok or frame is None:
            raise EvidenceReadError("Original video frame cannot be decoded.")
        actual = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if not math.isfinite(actual) or actual <= 0 and seconds > 0:
            frame_index, fps = capture.get(cv2.CAP_PROP_POS_FRAMES), capture.get(cv2.CAP_PROP_FPS)
            if fps > 0 and math.isfinite(fps) and math.isfinite(frame_index):
                actual = max(0.0, (frame_index - 1) / fps)
        if not math.isfinite(actual) or actual < 0 or actual == 0 and seconds > 0:
            raise EvidenceReadError("Original video frame time is invalid.")
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
        if not ok:
            raise EvidenceReadError("Original video frame cannot be encoded.")
        return encoded.tobytes(), actual
    except cv2.error as error:
        raise EvidenceReadError("Original video frame cannot be decoded.") from error
    finally:
        capture.release()


def _openai_web_citation_spans(payload: object) -> list[dict]:
    if not isinstance(payload, dict) or not isinstance(payload.get("output"), list):
        return []
    output = payload["output"]
    if not any(isinstance(item, dict) and item.get("type") == "web_search_call"
               and item.get("status") == "completed" for item in output):
        return []
    spans = []
    for item in output:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict) or content.get("type") != "output_text":
                continue
            answer = content.get("text")
            if not isinstance(answer, str):
                continue
            for annotation in content.get("annotations") or []:
                if not isinstance(annotation, dict) or annotation.get("type") != "url_citation":
                    continue
                start, end = annotation.get("start_index"), annotation.get("end_index")
                if (isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, int)
                        or not isinstance(end, int) or not 0 <= start < end <= len(answer)):
                    continue
                snippet = answer[start:end].strip()
                if snippet:
                    spans.append({"url": annotation.get("url"), "title": annotation.get("title"),
                                  "snippet": snippet})
    return spans


class VerificationEvidenceLookup:
    MAX_CALLS = 12
    MAX_FRAME_CALLS = 4
    MAX_RESULTS = 4
    MAX_STT_RECORDS = 20
    MAX_IMAGE_RESULTS = 2
    MAX_IMAGE_BYTES = 2_000_000
    MAX_WEB_CALLS = 4
    IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}

    def __init__(
        self,
        *,
        source_records: list[dict],
        image_records: list[dict],
        image_dir: str | Path,
        claim_ids: list[str] | None = None,
        image_meta: list[dict] | None = None,
        stt_utterances: list[dict] | None = None,
        summary_markdown: str = "",
        lecture_title: str = "",
        locator_hints: list[dict] | None = None,
        video_source_path: str | Path | None = None,
        video_fingerprint: str = "",
        allow_supplied_t_ids: bool = False,
        cancel_check=None,
    ) -> None:
        self._sources = list(source_records)
        self._timed_sources = [item for item in self._sources
                               if str(item.get("source_id") or "").startswith("T")]
        for item in ([] if self._timed_sources else (stt_utterances or [])):
            if not isinstance(item, dict) or not str(item.get("text") or "").strip():
                continue
            start, end = item.get("start"), item.get("end")
            if (isinstance(start, bool) or isinstance(end, bool)
                    or not isinstance(start, (int, float)) or not isinstance(end, (int, float))
                    or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start):
                continue
            self._timed_sources.append({
                "source_id": f"T{len(self._timed_sources) + 1:04d}", "text": str(item["text"]),
                "start_seconds": start, "end_seconds": end,
            })
        self.source_records = self._sources + [item for item in self._timed_sources if item not in self._sources]
        limits = verification_lookup_limits(self.source_records)
        self.MAX_CALLS = limits["stt"]
        self.MAX_FRAME_CALLS = limits["frame"]
        self._images = list(image_records)
        self._private_texts = [str(summary_markdown or ""), str(lecture_title or ""),
                               *(str(item.get("text") or "") for item in self.source_records)]
        self._lecture_title = str(lecture_title or "").strip().casefold()
        self._locator_hints = list(locator_hints or [])
        self.locator_status_by_claim: dict[str, str] = {}
        self.stt_lookup_claim_ids: set[str] = set()
        self.stt_quote_by_claim: dict[str, str] = {}
        self.timed_frame_lookup_claim_ids: set[str] = set()
        self.timed_frame_target_t_ids_by_claim: dict[str, set[str]] = {}
        self.returned_stt_anchors_by_claim: dict[str, set[str]] = {}
        self.returned_timed_frame_by_claim: dict[str, set[str]] = {}
        self.timed_frame_targets_by_image_by_claim: dict[str, dict[str, set[str]]] = {}
        self._image_dir = Path(image_dir).resolve()
        self._video_source_path = Path(video_source_path).resolve() if video_source_path else None
        self._video_fingerprint = str(video_fingerprint or "")
        self._allow_supplied_t_ids = bool(allow_supplied_t_ids)
        self._cancel_check = cancel_check
        # The verifier discovers its own IDs after receiving only the summary.
        # The old argument is accepted for callers in transition but is not an
        # allowlist and must not couple lookup to summary-generation claims.
        self._image_meta = {str(item.get("file_name") or ""): item for item in (image_meta or [])}
        self._calls = 0
        self._stt_calls = 0
        self._frame_calls = 0
        self.returned_evidence_by_claim: dict[str, set[str]] = {}
        self.returned_web_evidence_by_claim: dict[str, set[str]] = {}
        self.web_search_required_claims: set[str] = set()
        self.web_records: list[dict] = []
        self._web_calls = 0

    @staticmethod
    def validate_technical_query(query: object) -> str:
        if not isinstance(query, str) or query != query.strip() or not 2 <= len(query) <= 100:
            raise InvalidEvidenceRequest("Web query must be 2 to 100 characters.")
        without_standard_ids = re.sub(
            r"\b(?:RFC|ISO|IEC|IEEE|NIST)\s*[- ]?\d{3,5}(?:[-:.]\d+)?\b", "", query,
            flags=re.IGNORECASE,
        )
        if (len(query.split()) > 12 or "\n" in query or "\r" in query
                or re.search(r"https?://|www\.|@|[\"'<>]|(?:010|011|016|017|018|019)[\s-]?\d{3,4}[\s-]?\d{3,4}|(?:student|student.id|name|email|phone|학번|학생|이름|전화번호|연락처|휴대폰|휴대전화)", query, re.IGNORECASE)
                or re.search(r"\d{4,}", without_standard_ids)
                or re.search(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b", query)
                or not re.fullmatch(r"[\w\s.+/#():-]+", query, re.UNICODE)):
            raise InvalidEvidenceRequest("Web query must contain only a compact technical concept.")
        return query

    def validate_web_query(self, query: object) -> str:
        query = self.validate_technical_query(query)
        folded = _canonical_private_phrase(query)
        title = _canonical_private_phrase(self._lecture_title)
        if title and title in folded:
            raise InvalidEvidenceRequest("Web query contains a lecture title.")
        public_standard_id = re.fullmatch(
            r"(?:RFC|ISO|IEC|IEEE|NIST)\s*[- ]?\d{3,5}(?:[-:.]\d+)?", query, re.IGNORECASE,
        )
        if (not public_standard_id and any(folded in _canonical_private_phrase(text)
                                           for text in self._private_texts if text)):
            raise InvalidEvidenceRequest("Web query repeats private lecture material.")
        return query

    def has_returned_stt(self) -> bool:
        return any(any(source.startswith(("S", "T")) for source in ids)
                   for ids in self.returned_evidence_by_claim.values())

    def lookup_web(self, *, claim_ids: list[str], query: str, search) -> str:
        query = self.validate_web_query(query)
        if self._web_calls >= self.MAX_WEB_CALLS:
            raise EvidenceLookupLimit("Web lookup call limit reached.")
        self.note_web_search(claim_ids)
        self._web_calls += 1
        result = search(claim_ids, query)
        if not isinstance(result, dict):
            raise EvidenceReadError("Web lookup returned no result.")
        status = result.get("status")
        if status not in {"found", "missing", "error", "limit", "unavailable"}:
            raise EvidenceReadError("Web lookup returned an invalid status.")
        records = []
        if status == "found":
            if result.get("mode") == "managed":
                records = self.record_managed_worker_citations(claim_ids=claim_ids, worker_response=result.get("response"))
            elif result.get("mode") == "byok":
                response = result.get("response")
                spans = _openai_web_citation_spans(response)
                citations = [{**span, "claim_ids": claim_ids, "retrieved_at": datetime.now(timezone.utc).isoformat()}
                             for span in spans[:3]]
                records = self.record_web_citations(claim_ids=claim_ids, citations=citations,
                                                    provider_output=response)
            else:
                raise EvidenceReadError("Web lookup has no verified provider.")
        return json.dumps({"claim_ids": claim_ids, "status": "found" if records else ("missing" if status == "found" else status),
                           "evidence": records}, ensure_ascii=False)

    def note_concept_web(self, block_ids: list[str], query: str) -> str:
        """Authorize a technical search for existing summary blocks, without STT."""
        query = self.validate_web_query(query)
        blocks = self._private_texts[0].split("\n\n")
        if (not isinstance(block_ids, list) or not 1 <= len(block_ids) <= 4
                or len(block_ids) != len(set(block_ids)) or any(
                    not isinstance(block_id, str) or not re.fullmatch(r"B\d{4,}", block_id)
                    or not 0 <= int(block_id[1:]) - 1 < len(blocks)
                    for block_id in block_ids)):
            raise InvalidEvidenceRequest("Web lookup requires existing summary block IDs.")
        if self._web_calls >= self.MAX_WEB_CALLS:
            raise EvidenceLookupLimit("Web lookup call limit reached.")
        self.web_search_required_claims.update(block_ids)
        self._web_calls += 1
        return query

    def lookup_concept_web(self, *, block_ids: list[str], query: str, search) -> str:
        query = self.note_concept_web(block_ids, query)
        result = search(block_ids, query)
        if not isinstance(result, dict) or result.get("status") not in {
                "found", "missing", "error", "limit", "unavailable"}:
            raise EvidenceReadError("Web lookup returned an invalid result.")
        records = []
        if result["status"] == "found":
            if result.get("mode") == "managed":
                records = self.record_managed_worker_citations(
                    claim_ids=block_ids, worker_response=result.get("response"))
            elif result.get("mode") == "byok":
                response = result.get("response")
                spans = _openai_web_citation_spans(response)
                citations = [{**span, "claim_ids": block_ids,
                              "retrieved_at": datetime.now(timezone.utc).isoformat()}
                             for span in spans[:3]]
                if citations:
                    records = self.record_web_citations(
                        claim_ids=block_ids, citations=citations, provider_output=response)
            else:
                raise EvidenceReadError("Web lookup has no verified provider.")
        status = "found" if records else ("missing" if result["status"] == "found" else result["status"])
        return json.dumps({"block_ids": block_ids, "status": status, "evidence": records},
                          ensure_ascii=False)

    def replay_concept_web(self, *, block_ids: list[str], query: str,
                           status: str, records: list[dict]) -> str:
        self.note_concept_web(block_ids, query)
        if status not in {"found", "missing", "error", "limit", "unavailable"}:
            raise InvalidEvidenceRequest("Invalid saved web status.")
        if status == "found":
            if not isinstance(records, list) or not 1 <= len(records) <= 3:
                raise InvalidEvidenceRequest("Invalid saved web citations.")
            if self._record_verified_web_citations(claim_ids=block_ids, citations=records) != records:
                raise InvalidEvidenceRequest("Saved web citations changed.")
        elif records:
            raise InvalidEvidenceRequest("Non-found web result has saved citations.")
        return json.dumps({"block_ids": block_ids, "status": status, "evidence": records},
                          ensure_ascii=False)

    def replay_web(self, *, claim_ids: list[str], query: str, status: str,
                   records: list[dict]) -> str:
        self.validate_web_query(query)
        if self._web_calls >= self.MAX_WEB_CALLS:
            raise EvidenceLookupLimit("Web lookup replay exceeds call limit.")
        self.note_web_search(claim_ids)
        self._web_calls += 1
        if status not in {"found", "missing", "error", "limit", "unavailable"}:
            raise InvalidEvidenceRequest("Invalid saved web status.")
        if status == "found":
            if not isinstance(records, list) or not 1 <= len(records) <= 3:
                raise InvalidEvidenceRequest("Invalid saved web citations.")
            replayed = self._record_verified_web_citations(claim_ids=claim_ids, citations=records)
            if replayed != records or any(item.get("citation_verified") is not True for item in records):
                raise InvalidEvidenceRequest("Saved web citations differ from the original ledger.")
        elif records:
            raise InvalidEvidenceRequest("Non-found web result has saved citations.")
        return json.dumps({"claim_ids": claim_ids, "status": status, "evidence": records}, ensure_ascii=False)

    def note_web_search(self, claim_ids: list[str]) -> None:
        """Mark uncertain STT claims before a web attempt, including failed attempts."""
        if not isinstance(claim_ids, list) or not 1 <= len(claim_ids) <= 4 or any(
                not isinstance(item, str) or not re.fullmatch(r"C\d{3,4}", item)
                or not any(str(source).startswith(("S", "T")) for source in self.returned_evidence_by_claim.get(item, set()))
                for item in claim_ids):
            raise InvalidEvidenceRequest("Web lookup requires actual returned timed STT for each claim.")
        self.web_search_required_claims.update(claim_ids)

    def record_web_citations(self, *, claim_ids: list[str], citations: list[dict],
                             provider_output: dict | None = None) -> list[dict]:
        """BYOK path: validate citations against the trusted OpenAI Responses body."""
        spans = _openai_web_citation_spans(provider_output)
        if not spans:
            raise InvalidEvidenceRequest("OpenAI output has no completed web search with URL citations.")
        for citation in citations:
            if not isinstance(citation, dict):
                raise InvalidEvidenceRequest("Web citation must be an object.")
            if not any(citation.get("url") == span["url"] and citation.get("title") == span["title"]
                       and str(citation.get("snippet") or "").strip() == span["snippet"] for span in spans):
                raise InvalidEvidenceRequest("Web citation is absent from provider output.")
        return self._record_verified_web_citations(claim_ids=claim_ids, citations=citations)

    def record_managed_worker_citations(self, *, claim_ids: list[str], worker_response: dict) -> list[dict]:
        """Managed path: accept only a normalized response from authenticated Worker transport.

        The caller must use the existing managed AI authenticated HTTPS request
        and must not pass model-authored JSON here. The Worker is responsible
        for checking its raw OpenAI web_search_call and url_citation output.
        """
        if (not isinstance(worker_response, dict) or worker_response.get("status") != "found"
                or worker_response.get("provider") != "openai" or worker_response.get("tool") != "web_search"
                or not isinstance(worker_response.get("search_call_count"), int)
                or worker_response["search_call_count"] < 1):
            raise InvalidEvidenceRequest("Managed Worker web response has no verified search call.")
        return self._record_verified_web_citations(claim_ids=claim_ids,
                                                   citations=worker_response.get("sources"))

    def _record_verified_web_citations(self, *, claim_ids: list[str], citations: list[dict]) -> list[dict]:
        if not isinstance(claim_ids, list) or not 1 <= len(claim_ids) <= 4 or any(
                not isinstance(item, str) or not re.fullmatch(r"[CB]\d{3,4}", item) for item in claim_ids):
            raise InvalidEvidenceRequest("Web citations require 1 to 4 valid claim IDs.")
        if not isinstance(citations, list) or not 1 <= len(citations) <= 3:
            raise InvalidEvidenceRequest("Web citations must contain 1 to 3 results.")
        if not set(claim_ids).issubset(self.web_search_required_claims):
            raise InvalidEvidenceRequest("Web citations require a recorded eligible web lookup.")
        records = []
        for citation in citations:
            if not isinstance(citation, dict):
                raise InvalidEvidenceRequest("Web citation must be an object.")
            citation_claims = citation.get("claim_ids")
            if (not isinstance(citation_claims, list) or not citation_claims
                    or any(not isinstance(item, str) or item not in claim_ids for item in citation_claims)):
                raise InvalidEvidenceRequest("Web citation claim_ids must be a nonempty request subset.")
            url = str(citation.get("url") or "")
            title = str(citation.get("title") or "").strip()
            snippet = str(citation.get("snippet") or "").strip()
            if not re.fullmatch(r"https://[^\s<>()\[\]]+", url) or not title or not snippet or len(title) > 200 or len(snippet) > 800:
                raise InvalidEvidenceRequest("Web citation URL, title, or answer span is invalid.")
            source_id = f"W{len(self.web_records) + 1:04d}"
            record = {"source_id": source_id, "claim_ids": list(dict.fromkeys(citation_claims)),
                      "url": url, "title": title, "snippet": snippet,
                      "retrieved_at": str(citation.get("retrieved_at") or ""), "citation_verified": True}
            records.append(record)
        self.web_records.extend(records)
        for claim_id in claim_ids:
            self.returned_web_evidence_by_claim.setdefault(claim_id, set()).update(
                record["source_id"] for record in records if claim_id in record["claim_ids"])
        return records
    def _validate_call(self, claim_ids: list[str], keywords: str, start_seconds: float | None,
                       end_seconds: float | None, *, kind: str = "stt") -> list[str]:
        if not isinstance(claim_ids, list) or not claim_ids or len(claim_ids) > 4:
            raise InvalidEvidenceRequest("claim_ids must contain 1 to 4 claim IDs.")
        if any(not isinstance(claim_id, str) or not re.fullmatch(r"C\d{3,4}", claim_id) for claim_id in claim_ids):
            raise InvalidEvidenceRequest("claim_ids must use the verifier's C001 format.")
        if len(self.returned_evidence_by_claim.keys() | set(claim_ids)) > 1_000:
            raise InvalidEvidenceRequest("Evidence lookup exceeds the claim ID limit.")
        if not isinstance(keywords, str) or len(keywords) > 80:
            raise InvalidEvidenceRequest("keywords must contain at most 80 characters.")
        if start_seconds is not None and (isinstance(start_seconds, bool) or not isinstance(start_seconds, (int, float)) or not 0 <= start_seconds <= 100_000_000):
            raise InvalidEvidenceRequest("start_seconds is out of range.")
        if end_seconds is not None and (isinstance(end_seconds, bool) or not isinstance(end_seconds, (int, float)) or not 0 <= end_seconds <= 100_000_000):
            raise InvalidEvidenceRequest("end_seconds is out of range.")
        if start_seconds is not None and end_seconds is not None and end_seconds < start_seconds:
            raise InvalidEvidenceRequest("end_seconds precedes start_seconds.")
        if kind == "stt" and self._stt_calls >= self.MAX_CALLS:
            raise EvidenceLookupLimit("STT lookup call limit reached.")
        if kind == "frame" and self._frame_calls >= self.MAX_FRAME_CALLS:
            raise EvidenceLookupLimit("Frame lookup call limit reached.")
        if self._calls >= self.MAX_CALLS + self.MAX_FRAME_CALLS:
            raise EvidenceLookupLimit("Evidence lookup call limit reached.")
        self._calls += 1
        if kind == "frame":
            self._frame_calls += 1
        else:
            self._stt_calls += 1
        normalized = list(dict.fromkeys(claim_ids))
        for claim_id in normalized:
            self.returned_evidence_by_claim.setdefault(claim_id, set())
        return normalized

    @staticmethod
    def _matches_time(record: dict, start_seconds: float | None, end_seconds: float | None) -> bool:
        if start_seconds is None and end_seconds is None:
            return True
        raw_start = record.get("start_seconds", record.get("start", record.get("start_time", record.get("timestamp_seconds"))))
        raw_end = record.get("end_seconds", record.get("end", record.get("end_time", raw_start)))
        try:
            record_start, record_end = float(raw_start), float(raw_end)
        except (TypeError, ValueError):
            return False
        return (end_seconds is None or record_start <= end_seconds) and (start_seconds is None or record_end >= start_seconds)

    def lookup_stt(
        self,
        *,
        claim_ids: list[str],
        summary_quote: str = "",
        t_ids: list[str] | None = None,
        start_seconds: float | None = None,
        end_seconds: float | None = None,
        keywords: str | None = None,
    ) -> str:
        if (keywords is not None or not isinstance(summary_quote, str) or not summary_quote.strip()
                or summary_quote not in self._private_texts[0]):
            raise InvalidEvidenceRequest("STT lookup requires a literal summary_quote, not keywords.")
        if t_ids is None:
            t_ids = []
        elif not isinstance(t_ids, list) or not 1 <= len(t_ids) <= self.MAX_RESULTS or any(
                not isinstance(item, str) or not re.fullmatch(r"[ST]\d{4}", item) for item in t_ids):
            raise InvalidEvidenceRequest("STT source IDs are invalid.")
        if not t_ids and start_seconds is None and end_seconds is None:
            raise InvalidEvidenceRequest("STT lookup requires source IDs or a time range.")
        if (t_ids and (start_seconds is not None or end_seconds is not None)) or not isinstance(claim_ids, list) or len(claim_ids) != 1:
            raise InvalidEvidenceRequest("STT lookup accepts one claim and either IDs or a time range.")
        prior_quote = self.stt_quote_by_claim.get(claim_ids[0]) if isinstance(claim_ids[0], str) else None
        if prior_quote is not None and prior_quote != summary_quote:
            raise InvalidEvidenceRequest("Claim ID is already bound to another literal summary quote.")
        claim_ids = self._validate_call(claim_ids, "", start_seconds, end_seconds)
        claim_id = claim_ids[0]
        self.stt_quote_by_claim.setdefault(claim_id, summary_quote)
        self.stt_lookup_claim_ids.add(claim_id)
        # Accept only a unique literal relationship between the verifier's quote
        # and a writer quote. Neither hint text nor its IDs prove the claim.
        matched_hints = [hint for hint in self._locator_hints if isinstance(hint, dict)
                         and isinstance(hint.get("summary_quote"), str)
                         and (summary_quote in hint["summary_quote"] or hint["summary_quote"] in summary_quote)
                         and self._private_texts[0].count(hint["summary_quote"]) == 1
                         and self._private_texts[0].count(summary_quote) == 1]
        matched_hints = [hint for hint in matched_hints if hint["summary_quote"] in self._private_texts[0]]
        if len(matched_hints) > 1 and t_ids:
            matched_hints = [hint for hint in matched_hints
                             if set(t_ids) <= set(hint.get("t_ids") or [])]
        hinted_ids = matched_hints[0].get("t_ids", []) if len(matched_hints) == 1 else []
        records = self._timed_sources if self._timed_sources else self._sources
        source_index = {str(item.get("source_id")): index for index, item in enumerate(records)}
        if not hinted_ids:
            self.locator_status_by_claim[claim_id] = "missing_t_id"
            return json.dumps({"claim_ids": claim_ids, "status": "missing", "evidence": []})
        if any(item not in source_index for item in hinted_ids):
            self.locator_status_by_claim[claim_id] = "mismatched_t_id"
            return json.dumps({"claim_ids": claim_ids, "status": "missing", "evidence": []})
        if t_ids and any(item not in source_index for item in t_ids):
            self.locator_status_by_claim[claim_id] = "mismatched_t_id"
            return json.dumps({"claim_ids": claim_ids, "status": "missing", "evidence": []})
        if t_ids and any(item not in hinted_ids for item in t_ids):
            self.locator_status_by_claim[claim_id] = "mismatched_t_id"
            return json.dumps({"claim_ids": claim_ids, "status": "missing", "evidence": []})
        if not t_ids and (start_seconds is not None or end_seconds is not None):
            attached = set()
            for item in hinted_ids:
                index = source_index[item]
                attached.update(range(max(0, index - 2), min(len(records), index + 3)))
            t_ids = [str(records[index]["source_id"]) for index in sorted(attached)
                     if self._matches_time(records[index], start_seconds, end_seconds)][:self.MAX_RESULTS]
            if not t_ids:
                self.locator_status_by_claim[claim_id] = "mismatched_t_id"
                return json.dumps({"claim_ids": claim_ids, "status": "missing", "evidence": []})
        # A returned utterance is a candidate. Only the verifier can judge its
        # semantic relevance after reading the tool reply.
        self.locator_status_by_claim[claim_id] = "not_checked"
        matches = []
        anchor_indexes = [source_index[item] for item in dict.fromkeys(t_ids) if item in source_index]
        if self._timed_sources:
            included = set()
            for index in anchor_indexes:
                included.update(range(max(0, index - 2), min(len(records), index + 3)))
            if start_seconds is not None or end_seconds is not None:
                included.intersection_update(attached)
            selected = sorted(included)
            if len(selected) > self.MAX_STT_RECORDS:
                selected = sorted(set(anchor_indexes) | set(selected[:self.MAX_STT_RECORDS - len(anchor_indexes)]))
        else:
            selected = anchor_indexes
        anchors = set(anchor_indexes)
        for index in selected:
            record = records[index]
            matches.append({
                "source_id": str(record["source_id"]),
                "start_seconds": record.get("start_seconds", record.get("start", record.get("start_time"))),
                "end_seconds": record.get("end_seconds", record.get("end", record.get("end_time"))),
                "text": str(record["text"])[:500],
                "role": "anchor" if index in anchors else "context",
            })
        for claim_id in claim_ids:
            self.returned_evidence_by_claim[claim_id].update(item["source_id"] for item in matches)
            self.returned_stt_anchors_by_claim.setdefault(claim_id, set()).update(
                item["source_id"] for item in matches if item["role"] == "anchor"
            )
        return json.dumps({"claim_ids": claim_ids, "status": "found" if matches else "missing", "evidence": matches}, ensure_ascii=False)

    def lookup_frame(
        self,
        *,
        claim_ids: list[str],
        keywords: str = "",
        start_seconds: float | None = None,
        end_seconds: float | None = None,
        t_id: str | None = None,
        _require_cache: bool = False,
    ) -> dict[str, Any]:
        if t_id is not None:
            if (not isinstance(t_id, str) or not re.fullmatch(r"T\d{4}", t_id)
                    or keywords or start_seconds is not None or end_seconds is not None
                    or len(claim_ids) != 1):
                raise InvalidEvidenceRequest("Timed frame lookup requires one T anchor only.")
            claim_ids = self._validate_call(claim_ids, "", None, None, kind="frame")
            self.timed_frame_lookup_claim_ids.add(claim_ids[0])
            return self._lookup_timed_frame(claim_ids[0], t_id, require_cache=_require_cache)
        if not isinstance(keywords, str) or (not keywords.strip() and start_seconds is None and end_seconds is None):
            raise InvalidEvidenceRequest("Frame lookup requires keywords or a time range.")
        claim_ids = self._validate_call(claim_ids, keywords, start_seconds, end_seconds, kind="frame")
        if (self._allow_supplied_t_ids
                and start_seconds is not None and end_seconds is not None
                and len(claim_ids) == 1):
            return self._lookup_original_frame_at_time(
                claim_ids[0], start_seconds, end_seconds, require_cache=_require_cache)
        terms = keywords.casefold().split()
        evidence = []
        image_parts = []
        candidates = []
        for index, record in enumerate(self._images):
            source_id = str(record.get("source_id") or "")
            name = str(record.get("file_name") or "")
            if not source_id.startswith("I") or not name or Path(name).name != name:
                continue
            meta = self._image_meta.get(name, {})
            if not self._matches_time(meta, start_seconds, end_seconds):
                continue
            search_text = f"{record.get('caption', '')} {name}".casefold()
            score = sum(term in search_text for term in terms)
            if terms and not score:
                continue
            candidates.append((score, index, record, meta))
        if terms:
            candidates.sort(key=lambda item: (-item[0], item[1]))
        for _score, _index, record, meta in candidates:
            source_id = str(record["source_id"])
            name = str(record["file_name"])
            path = (self._image_dir / name).resolve()
            if path.parent != self._image_dir or path.suffix.lower() not in self.IMAGE_TYPES:
                continue
            try:
                frame_stat = path.stat()
            except FileNotFoundError:
                continue
            except OSError as error:
                raise EvidenceReadError("Frame could not be read.") from error
            if not stat.S_ISREG(frame_stat.st_mode):
                continue
            if frame_stat.st_size > self.MAX_IMAGE_BYTES:
                raise EvidenceLookupLimit("Frame exceeds the image size limit.")
            try:
                data = path.read_bytes()
            except OSError as error:
                raise EvidenceReadError("Frame could not be read.") from error
            if len(data) > self.MAX_IMAGE_BYTES:
                raise EvidenceLookupLimit("Frame exceeds the image size limit.")
            evidence.append({
                "source_id": source_id,
                "timestamp_seconds": meta.get("start_time", meta.get("timestamp_seconds")),
            })
            image_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:{self.IMAGE_TYPES[path.suffix.lower()]};base64,{base64.b64encode(data).decode('ascii')}"},
            })
            if len(evidence) >= self.MAX_IMAGE_RESULTS:
                break
        for claim_id in claim_ids:
            self.returned_evidence_by_claim[claim_id].update(item["source_id"] for item in evidence)
        return {"content": json.dumps({"claim_ids": claim_ids, "status": "found" if evidence else "missing", "evidence": evidence}, ensure_ascii=False), "image_parts": image_parts}

    def _lookup_original_frame_at_time(self, claim_id: str, start: float, end: float,
                                       *, require_cache: bool) -> dict[str, Any]:
        def missing():
            return {"content": json.dumps({"claim_ids": [claim_id], "status": "missing", "evidence": []}),
                    "image_parts": []}

        if (not all(math.isfinite(value) for value in (start, end))
                or start < 0 or end < start or end - start > 30):
            raise InvalidEvidenceRequest("Original frame range must be within 30 seconds.")
        source = self._video_source_path
        if source is None or not source.is_file() or not self._video_fingerprint:
            return missing()
        midpoint = (start + end) / 2
        try:
            if source_fingerprint(source) != self._video_fingerprint:
                return missing()
            if callable(self._cancel_check):
                self._cancel_check()
            cache_dir = self._image_dir / ".verification_frames"
            key = hashlib.sha256(
                f"{source}\0{self._video_fingerprint}\0{midpoint:.6f}".encode("utf-8")
            ).hexdigest()
            source_id = "I" + str(int(key[:12], 16)).zfill(15)
            image_path = cache_dir / f"{key}.jpg"
            meta_path = cache_dir / f"{key}.json"
            if meta_path.is_file() and image_path.is_file():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                data = self._read_frame_bytes(image_path)
                if (data is not None and meta.get("source_path") == str(source)
                        and meta.get("video_fingerprint") == self._video_fingerprint
                        and meta.get("target_seconds") == midpoint
                        and meta.get("source_id") == source_id
                        and meta.get("sha256") == hashlib.sha256(data).hexdigest()
                        and isinstance(meta.get("actual_seconds"), (int, float))
                        and start <= meta["actual_seconds"] <= end):
                    return self._frame_reply(claim_id, source_id, meta["actual_seconds"],
                                             data, ".jpg", "")
            if require_cache:
                return missing()
            data, actual = _extract_video_frame(source, midpoint)
            if source_fingerprint(source) != self._video_fingerprint or not start <= actual <= end:
                return missing()
            if len(data) > self.MAX_IMAGE_BYTES:
                raise EvidenceLookupLimit("Frame exceeds the image size limit.")
            cache_dir.mkdir(parents=True, exist_ok=True)
            image_tmp = image_path.with_suffix(".jpg.tmp")
            meta_tmp = meta_path.with_suffix(".json.tmp")
            image_tmp.write_bytes(data)
            os.replace(image_tmp, image_path)
            meta_tmp.write_text(json.dumps({"source_path": str(source),
                "video_fingerprint": self._video_fingerprint, "target_seconds": midpoint,
                "actual_seconds": actual, "source_id": source_id,
                "sha256": hashlib.sha256(data).hexdigest()}), encoding="utf-8")
            os.replace(meta_tmp, meta_path)
            return self._frame_reply(claim_id, source_id, actual, data, ".jpg", "")
        except EvidenceLookupLimit:
            raise
        except (OSError, ValueError, TypeError, VideoAnalysisError) as error:
            raise EvidenceReadError("Original video frame cannot be read.") from error

    def _lookup_timed_frame(self, claim_id: str, t_id: str, *, require_cache: bool) -> dict[str, Any]:
        def missing():
            return {"content": json.dumps({"claim_ids": [claim_id], "status": "missing", "evidence": []}),
                    "image_parts": []}

        utterance = next((item for item in self._timed_sources if item.get("source_id") == t_id), None)
        if utterance is None:
            return missing()
        if (not self._allow_supplied_t_ids
                and t_id not in self.returned_evidence_by_claim.get(claim_id, set())):
            return missing()
        # A returned context T is enough: the verifier explicitly selects it
        # as the frame target for this claim without another STT request.
        self.timed_frame_target_t_ids_by_claim.setdefault(claim_id, set()).add(t_id)
        if not self._video_fingerprint:
            return missing()
        if callable(self._cancel_check):
            self._cancel_check()
        # The writer's canonical T records keep the normalized STT fields
        # (start/end); legacy callers may supply start_seconds/end_seconds.
        start = float(utterance.get("start_seconds", utterance.get("start")))
        end = float(utterance.get("end_seconds", utterance.get("end")))
        midpoint = (start + end) / 2
        source = self._video_source_path
        if source is not None and source.is_file() and self._video_fingerprint:
            try:
                if source_fingerprint(source) != self._video_fingerprint:
                    return missing()
            except (OSError, VideoAnalysisError) as error:
                raise EvidenceReadError("Original video fingerprint cannot be read.") from error

        # These are copies of original video frames, not model scene captions.
        candidates = []
        for record in self._images:
            name = str(record.get("file_name") or "")
            meta = self._image_meta.get(name)
            if not meta or Path(name).name != name or not str(record.get("source_id") or "").startswith("I"):
                continue
            try:
                instant = float(meta.get("start_time"))
                finish = float(meta.get("end_time"))
            except (TypeError, ValueError):
                continue
            if (math.isfinite(instant) and instant == finish and start <= instant <= end
                    and meta.get("source_fingerprint") == self._video_fingerprint
                    and meta.get("source_path") == (str(source) if source else "")):
                candidates.append((abs(instant - midpoint), name, instant, record))
        for _distance, name, instant, record in sorted(candidates):
            path = (self._image_dir / name).resolve()
            if path.parent != self._image_dir:
                continue
            data = self._read_frame_bytes(path)
            if data is not None:
                if callable(self._cancel_check):
                    self._cancel_check()
                return self._frame_reply(claim_id, str(record["source_id"]), instant, data, path.suffix.lower(), t_id)

        if source is None or not source.is_file() or not self._video_fingerprint:
            return missing()
        cache_dir = self._image_dir / ".verification_frames"
        key = hashlib.sha256(f"{source}\0{self._video_fingerprint}\0{midpoint:.6f}".encode("utf-8")).hexdigest()
        source_id = "I" + str(int(key[:12], 16)).zfill(15)
        image_path = cache_dir / f"{key}.jpg"
        meta_path = cache_dir / f"{key}.json"
        try:
            if meta_path.is_file() and image_path.is_file():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                data = self._read_frame_bytes(image_path)
                if (data is not None and meta.get("source_path") == str(source)
                        and meta.get("video_fingerprint") == self._video_fingerprint
                        and meta.get("target_seconds") == midpoint
                        and meta.get("source_id") == source_id
                        and meta.get("sha256") == hashlib.sha256(data).hexdigest()
                        and isinstance(meta.get("actual_seconds"), (int, float))
                        and math.isfinite(meta["actual_seconds"])):
                    if callable(self._cancel_check):
                        self._cancel_check()
                    return self._frame_reply(claim_id, source_id, meta["actual_seconds"], data, ".jpg", t_id)
            if require_cache:
                return missing()
            data, actual = _extract_video_frame(source, midpoint)
            if callable(self._cancel_check):
                self._cancel_check()
            if source_fingerprint(source) != self._video_fingerprint:
                return missing()
            if len(data) > self.MAX_IMAGE_BYTES:
                raise EvidenceLookupLimit("Frame exceeds the image size limit.")
            if not start <= actual <= end:
                return missing()
            cache_dir.mkdir(parents=True, exist_ok=True)
            image_tmp = image_path.with_suffix(".jpg.tmp")
            meta_tmp = meta_path.with_suffix(".json.tmp")
            image_tmp.write_bytes(data)
            os.replace(image_tmp, image_path)
            meta_tmp.write_text(json.dumps({"source_path": str(source),
                "video_fingerprint": self._video_fingerprint, "target_seconds": midpoint,
                "actual_seconds": actual, "source_id": source_id,
                "sha256": hashlib.sha256(data).hexdigest()}), encoding="utf-8")
            os.replace(meta_tmp, meta_path)
            return self._frame_reply(claim_id, source_id, actual, data, ".jpg", t_id)
        except EvidenceLookupLimit:
            raise
        except (OSError, ValueError, TypeError, VideoAnalysisError) as error:
            raise EvidenceReadError("Original video frame cannot be read.") from error

    def _read_frame_bytes(self, path: Path) -> bytes | None:
        if path.suffix.lower() not in self.IMAGE_TYPES:
            return None
        try:
            frame_stat = path.stat()
            if not stat.S_ISREG(frame_stat.st_mode):
                return None
            if frame_stat.st_size > self.MAX_IMAGE_BYTES:
                raise EvidenceLookupLimit("Frame exceeds the image size limit.")
            data = path.read_bytes()
        except FileNotFoundError:
            return None
        except OSError as error:
            raise EvidenceReadError("Frame could not be read.") from error
        if len(data) > self.MAX_IMAGE_BYTES:
            raise EvidenceLookupLimit("Frame exceeds the image size limit.")
        return data

    def _frame_reply(self, claim_id: str, source_id: str, instant: float,
                     data: bytes, suffix: str, target_t_id: str) -> dict[str, Any]:
        self.returned_evidence_by_claim.setdefault(claim_id, set()).add(source_id)
        self.returned_timed_frame_by_claim.setdefault(claim_id, set()).add(source_id)
        if target_t_id:
            self.timed_frame_targets_by_image_by_claim.setdefault(claim_id, {}).setdefault(source_id, set()).add(target_t_id)
        if not any(item.get("source_id") == source_id for item in self.source_records):
            self.source_records.append({"source_id": source_id, "timestamp_seconds": instant})
        return {"content": json.dumps({"claim_ids": [claim_id], "status": "found",
                "evidence": [{"source_id": source_id, "timestamp_seconds": instant}]}),
                "image_parts": [{"type": "image_url", "image_url": {"url":
                    f"data:{self.IMAGE_TYPES[suffix]};base64,{base64.b64encode(data).decode('ascii')}"}}]}
