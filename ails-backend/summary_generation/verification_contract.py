"""Verification schemas and bounded, replayable checkpoint contracts."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from common import re
from .claim_verification import parse_verification_result
from .verification_evidence import VerificationEvidenceLookup
from .integrated_chunk_verification import (
    mark_unassessed_candidates,
    parse_integrated_chunk_result,
    parse_concept_only_result,
    parse_fidelity_comparison_result,
)


VIDEO_CONTRADICTION_INSPECTION_ENABLED = False


CONCEPT_VERIFICATION_CONTRACT_VERSION = 19


FIDELITY_VERIFICATION_CONTRACT_VERSION = 25


CONCEPT_ONLY_CONTRACT_VERSION = 22


def fidelity_invalid_tools_resolved(rounds, outcomes):
    """An invalid first-pass tool request needs a later matching successful call."""
    by_call = {(item.get("round_index"), item.get("tool_call_id")): item
               for item in outcomes if isinstance(item, dict)}
    invalid = []
    valid = []
    for index, round_entry in enumerate(rounds):
        if not isinstance(round_entry, dict):
            return False
        if round_entry.get("invalid_request") and not round_entry.get("tool_calls"):
            return False
        for call in round_entry.get("tool_calls") or []:
            function = call.get("function") if isinstance(call, dict) else None
            if not isinstance(function, dict):
                return False
            name = function.get("name")
            try:
                args = json.loads(function.get("arguments") or "")
            except (TypeError, ValueError):
                args = None
            identity = None
            if isinstance(args, dict):
                if isinstance(args.get("claim_ids"), list) and args["claim_ids"]:
                    target = (args.get("t_id"), tuple(args.get("t_ids") or []),
                              args.get("start_seconds"), args.get("end_seconds"),
                              args.get("keywords"), args.get("query"))
                    identity = (name, tuple(args["claim_ids"]), target)
                elif name == "register_claims" and isinstance(args.get("claims"), list):
                    quotes = [item.get("summary_quote") for item in args["claims"]
                              if isinstance(item, dict)]
                    if quotes and len(quotes) == len(args["claims"]) and all(
                            isinstance(quote, str) and quote for quote in quotes):
                        identity = (name, tuple(quotes))
            outcome = by_call.get((index, call.get("id"))) or {}
            if (call.get("id") in round_entry.get("invalid_tool_call_ids", [])
                    or outcome.get("evidence_status") == "invalid_request"):
                invalid.append((index, identity))
            elif (outcome.get("completed")
                  and outcome.get("evidence_status") in ({"found"} if name == "register_claims"
                                                         else {"found", "missing"})
                  and identity is not None):
                valid.append((index, identity))
    known_calls = {(index, call.get("id")) for index, round_entry in enumerate(rounds)
                   for call in round_entry.get("tool_calls") or [] if isinstance(call, dict)}
    if any(item.get("evidence_status") == "invalid_request"
           and (item.get("round_index"), item.get("tool_call_id")) not in known_calls
           for item in outcomes if isinstance(item, dict)):
        return False
    return all(identity is not None and any(later > index and matched == identity
                                            for later, matched in valid)
               for index, identity in invalid)


_STT_ID_PARAMETERS = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "claim_ids": {"type": "array", "minItems": 1, "maxItems": 1,
                      "items": {"type": "string", "pattern": "^C[0-9]{3,4}$"}},
        "t_ids": {"type": "array", "minItems": 1, "maxItems": 4,
                  "items": {"type": "string", "pattern": "^[ST][0-9]{4}$"}},
    }, "required": ["claim_ids", "t_ids"],
}


_STT_TIME_PARAMETERS = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "claim_ids": _STT_ID_PARAMETERS["properties"]["claim_ids"],
        "start_seconds": {"type": "number"}, "end_seconds": {"type": "number"},
    }, "required": ["claim_ids", "start_seconds", "end_seconds"],
}


VERIFICATION_TOOL_SCHEMAS = [
    {"type": "function", "function": {"name": "register_claims",
        "description": "Register exact summary spans and receive stable claim IDs before evidence lookup.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {
            "claims": {"type": "array", "minItems": 1, "maxItems": 20, "items": {
                "type": "object", "additionalProperties": False, "properties": {
                    "summary_quote": {"type": "string", "minLength": 1, "maxLength": 2000},
                    "occurrence": {"type": "integer", "minimum": 0},
                }, "required": ["summary_quote"]}},
        }, "required": ["claims"]}}},
    {"type": "function", "function": {"name": "lookup_stt_by_id",
        "description": "Read a T/S utterance and its local context using writer ID hints only.",
        "parameters": _STT_ID_PARAMETERS}},
    {"type": "function", "function": {"name": "lookup_stt_by_time",
        "description": "Read utterances within a time range near a writer ID hint; send no IDs.",
        "parameters": _STT_TIME_PARAMETERS}},
    {"type": "function", "function": {"name": "lookup_frame",
        "description": "View original video frames for claims that require visual evidence.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {
            "claim_ids": {"type": "array", "minItems": 1, "maxItems": 4, "items": {"type": "string", "pattern": "^C[0-9]{3,4}$"}},
            "keywords": {"type": "string", "maxLength": 80},
            "start_seconds": {"type": "number"}, "end_seconds": {"type": "number"},
        }, "required": ["claim_ids"]}}},
    {"type": "function", "function": {"name": "lookup_frame_by_t_id",
        "description": "View one original frame at a previously returned T utterance's midpoint; send no keywords or time range.",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {
            "claim_ids": {"type": "array", "minItems": 1, "maxItems": 1, "items": {"type": "string", "pattern": "^C[0-9]{3,4}$"}},
            "t_id": {"type": "string", "pattern": "^T[0-9]{4}$"},
        }, "required": ["claim_ids", "t_id"]}}},
]


CONCEPT_CANDIDATE_TOOL_SCHEMA = {"type": "function", "function": {
    "name": "register_concept_candidates",
    "description": "Register suspected summary spans and T/S IDs; AILS immediately returns STT context and requested original frames.",
    "parameters": {"type": "object", "additionalProperties": False, "properties": {
        "candidates": {"type": "array", "minItems": 1, "maxItems": 20, "items": {
            "type": "object", "additionalProperties": False, "properties": {
                "summary_quote": {"type": "string", "minLength": 1, "maxLength": 2000},
                "t_ids": {"type": "array", "maxItems": 4,
                          "items": {"type": "string", "pattern": "^[ST][0-9]{4}$"}},
                "reason": {"type": "string", "minLength": 1, "maxLength": 300},
                "needs_frame": {"type": "boolean"},
            }, "required": ["summary_quote", "t_ids", "reason", "needs_frame"]}},
    }, "required": ["candidates"]},
}}


CONCEPT_REVIEW_TOOLS = [CONCEPT_CANDIDATE_TOOL_SCHEMA, next(
    item for item in VERIFICATION_TOOL_SCHEMAS
    if item["function"]["name"] == "lookup_frame_by_t_id"
)]


WEB_VERIFICATION_TOOL_SCHEMA = {"type": "function", "function": {
    "name": "lookup_web",
    "description": "After returned STT is technically uncertain, search a rephrased generic concept query; never copy a lecture phrase.",
    "parameters": {"type": "object", "additionalProperties": False, "properties": {
        "claim_ids": {"type": "array", "minItems": 1, "maxItems": 4,
                      "items": {"type": "string", "pattern": "^C[0-9]{3,4}$"}},
        "query": {"type": "string", "minLength": 2, "maxLength": 100},
        "reason_code": {"type": "string", "enum": ["technical_accuracy_uncertain"]},
    }, "required": ["claim_ids", "query", "reason_code"]},
}}


CONCEPT_WEB_TOOL_SCHEMA = {"type": "function", "function": {
    "name": "lookup_concept_web",
    "description": "Search a generic technical concept for current summary blocks only.",
    "parameters": {"type": "object", "additionalProperties": False, "properties": {
        "block_ids": {"type": "array", "minItems": 1, "maxItems": 4,
                      "items": {"type": "string", "pattern": "^B[0-9]{4}$"}},
        "query": {"type": "string", "minLength": 2, "maxLength": 100},
    }, "required": ["block_ids", "query"]},
}}


def _bounded_verification_call(call):
    """Keep only replayable tool metadata in the checkpoint."""
    if not isinstance(call, dict) or not isinstance(call.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", call["id"]):
        raise ValueError("Invalid verification tool call ID")
    function = call.get("function") or {}
    if not isinstance(function, dict):
        raise ValueError("Invalid verification tool call")
    name = function.get("name")
    raw_args = function.get("arguments")
    if name not in {"register_claims", "register_concept_candidates", "lookup_stt", "lookup_stt_by_id", "lookup_stt_by_time", "lookup_frame", "lookup_frame_by_t_id", "lookup_web", "lookup_concept_web"} or not isinstance(raw_args, str) or len(raw_args) > (16_000 if name == "register_concept_candidates" else 10_000 if name == "register_claims" else 2_000):
        raise ValueError("Invalid verification tool call")
    args = json.loads(raw_args)
    allowed = ({"block_ids", "query"} if name == "lookup_concept_web" else
               {"candidates"} if name == "register_concept_candidates" else
               {"claims"} if name == "register_claims" else
               {"claim_ids", "query", "reason_code"} if name == "lookup_web" else
               {"claim_ids", "summary_quote", "t_ids"} if name == "lookup_stt_by_id" else
               {"claim_ids", "summary_quote", "start_seconds", "end_seconds"} if name == "lookup_stt_by_time" else
               {"claim_ids", "summary_quote", "t_ids", "start_seconds", "end_seconds"} if name == "lookup_stt" else
               {"claim_ids", "t_id"} if name == "lookup_frame_by_t_id" else
               {"claim_ids", "keywords", "start_seconds", "end_seconds", "t_id"})
    if not isinstance(args, dict) or set(args) - allowed:
        raise ValueError("Invalid verification tool arguments")
    if name == "lookup_concept_web":
        block_ids = args.get("block_ids")
        if (not isinstance(block_ids, list) or not 1 <= len(block_ids) <= 4
                or any(not isinstance(item, str) or not re.fullmatch(r"B\d{4,}", item)
                       for item in block_ids)):
            raise ValueError("Invalid concept web block IDs")
        VerificationEvidenceLookup.validate_technical_query(args.get("query"))
        return {"id": call["id"], "type": "function", "function": {
            "name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
    if name == "register_concept_candidates":
        items = args.get("candidates")
        if not isinstance(items, list) or not 1 <= len(items) <= 20 or any(
            not isinstance(item, dict)
            or not {"summary_quote", "t_ids", "reason", "needs_frame"} <= set(item)
            or set(item) - {"summary_quote", "t_ids", "reason", "needs_frame"}
            or not isinstance(item["summary_quote"], str) or not 1 <= len(item["summary_quote"]) <= 2000
            or not isinstance(item["reason"], str) or not 1 <= len(item["reason"]) <= 300
            or not isinstance(item["needs_frame"], bool)
            or not isinstance(item["t_ids"], list) or len(item["t_ids"]) > 4
            or len(item["t_ids"]) != len(set(map(str, item["t_ids"])))
            or any(not isinstance(t_id, str) or not re.fullmatch(r"[ST]\d{4}", t_id)
                   for t_id in item["t_ids"])
            for item in items
        ):
            raise ValueError("Invalid concept candidate registration")
        return {"id": call["id"], "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
    if name == "register_claims":
        items = args.get("claims")
        if not isinstance(items, list) or not 1 <= len(items) <= 20 or any(
            not isinstance(item, dict) or "summary_quote" not in item
            or set(item) - {"summary_quote", "occurrence"}
            or not isinstance(item["summary_quote"], str) or not 1 <= len(item["summary_quote"]) <= 2000
            or ("occurrence" in item and (not isinstance(item["occurrence"], int)
                or isinstance(item["occurrence"], bool) or item["occurrence"] < 0)) for item in items
        ):
            raise ValueError("Invalid claim registration")
        return {"id": call["id"], "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
    ids = args.get("claim_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= 4 or any(
        not isinstance(item, str) or not re.fullmatch(r"C\d{3,4}", item) for item in ids
    ):
        raise ValueError("Invalid verification claim IDs")
    if name == "lookup_web":
        VerificationEvidenceLookup.validate_technical_query(args.get("query"))
        if args.get("reason_code") != "technical_accuracy_uncertain":
            raise ValueError("Web lookup must concern uncertain lecture technical accuracy")
        return {"id": call["id"], "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
    if name in {"lookup_stt", "lookup_stt_by_id", "lookup_stt_by_time"}:
        quote = args.get("summary_quote")
        source_ids = args.get("t_ids")
        if (len(ids) != 1 or (quote is not None and (not isinstance(quote, str) or not 1 <= len(quote) <= 2000))
                or (source_ids is not None and (not isinstance(source_ids, list) or not 1 <= len(source_ids) <= 4
                    or any(not isinstance(item, str) or not re.fullmatch(r"[ST]\d{4}", item) for item in source_ids)))
                or (source_ids and (args.get("start_seconds") is not None or args.get("end_seconds") is not None))):
            raise ValueError("Invalid STT locator request")
        if not source_ids and args.get("start_seconds") is None and args.get("end_seconds") is None:
            raise ValueError("STT lookup requires IDs or a time range")
        if name == "lookup_stt_by_id" and not source_ids:
            raise ValueError("ID lookup requires T/S IDs")
        if name == "lookup_stt_by_time" and (source_ids or args.get("start_seconds") is None
                                               or args.get("end_seconds") is None):
            raise ValueError("Time lookup requires a complete range without IDs")
    if name in {"lookup_frame", "lookup_frame_by_t_id"} and (not isinstance(args.get("keywords", ""), str) or len(args.get("keywords", "")) > 80):
        raise ValueError("Invalid verification keywords")
    if name in {"lookup_frame", "lookup_frame_by_t_id"} and args.get("t_id") is not None and (
            len(ids) != 1 or not isinstance(args["t_id"], str)
            or not re.fullmatch(r"T\d{4}", args["t_id"])
            or args.get("keywords") or args.get("start_seconds") is not None
            or args.get("end_seconds") is not None):
        raise ValueError("Timed frame lookup requires one STT anchor")
    for key in ("start_seconds", "end_seconds"):
        value = args.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100_000_000):
            raise ValueError("Invalid verification time range")
    if name == "lookup_frame_by_t_id" and args.get("t_id") is None:
        raise ValueError("Timed frame lookup requires a T ID")
    if name == "lookup_frame" and not args.get("t_id") and not args.get("keywords", "").strip() and args.get("start_seconds") is None and args.get("end_seconds") is None:
        raise ValueError("Verification lookup requires keywords or a time range")
    return {"id": call["id"], "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}


def _checkpoint_verification_call(call):
    """Preserve a paid tool turn without persisting malformed model arguments."""
    try:
        return _bounded_verification_call(call), False
    except (TypeError, ValueError, json.JSONDecodeError):
        call_id = call.get("id") if isinstance(call, dict) else None
        if not isinstance(call_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", call_id):
            raise ValueError("Invalid verification tool call ID")
        return {
            "id": call_id, "type": "function",
            "function": {"name": "lookup_stt", "arguments": '{"claim_ids":["C000"],"summary_quote":"unavailable","t_ids":["T0000"]}'},
        }, True


def _validated_verification_checkpoint_result(result, summary_markdown, returned_evidence_by_claim,
                                              returned_web_evidence_by_claim=None, web_search_required_claims=None,
                                              web_search_unavailable=False, locator_status_by_claim=None,
                                              locator_hints=None, stt_lookup_claim_ids=None,
                                              stt_lookup_quote_by_claim=None,
                                              timed_frame_evidence_by_claim=None,
                                              timed_frame_targets_by_image_by_claim=None,
                                              timed_frame_lookup_claim_ids=None, registered_claims=None):
    """Check normalized verifier output against replayed evidence, without model citation limits."""
    expected = {"claims", "issues", "edits", "checked_claim_count", "source_checked_claim_count", "unreviewed_claims", "locator_status"}
    if not isinstance(result, dict) or set(result) != expected or not isinstance(result.get("claims"), list):
        raise ValueError("Invalid normalized verification checkpoint")
    if any(not isinstance(claim, dict) for claim in result["claims"]):
        raise ValueError("Invalid normalized verification claims")
    # The normalized claim inventory contains every returned source (up to 20
    # from a timed STT lookup). Only the model's original citations have a
    # 12-ID cap; reconstruct the inventory from the replayed lookup ledger.
    raw = {"claims": [{**claim, "source_ids": [],
                       "locator_status": result["locator_status"].get(claim["claim_id"])}
                      for claim in result["claims"]],
           "issues": result["issues"],
           "edits": [{key: value for key, value in edit.items() if key not in {"start", "end"}}
                     for edit in result["edits"]]}
    checked = parse_verification_result(
        json.dumps(raw, ensure_ascii=False),
        summary_markdown=summary_markdown,
        returned_evidence_by_claim=returned_evidence_by_claim,
        locator_status_by_claim=locator_status_by_claim,
        locator_hints=locator_hints,
        stt_lookup_claim_ids=stt_lookup_claim_ids,
        stt_lookup_quote_by_claim=stt_lookup_quote_by_claim,
        timed_frame_evidence_by_claim=timed_frame_evidence_by_claim,
        timed_frame_targets_by_image_by_claim=timed_frame_targets_by_image_by_claim,
        timed_frame_lookup_claim_ids=timed_frame_lookup_claim_ids,
        returned_web_evidence_by_claim=returned_web_evidence_by_claim,
        web_search_required_claims=web_search_required_claims,
        web_search_unavailable=web_search_unavailable,
        registered_claims=registered_claims,
    )
    if checked != result:
        raise ValueError("Normalized verification checkpoint differs from replayed evidence")
    return checked


def _recover_rejected_verification_round(round_entry, validate):
    """Reuse a paid final response only when the current evidence rules accept it."""
    raw = round_entry.get("rejected_structured_result")
    if not round_entry.get("invalid_request") or not isinstance(raw, dict):
        return False
    try:
        normalized = validate(raw)
    except (ValueError, TypeError):
        return False
    round_entry["result"] = normalized
    round_entry["completed"] = True
    round_entry["invalid_request"] = False
    return True


def _verification_evidence_digest(source_records, image_records, image_meta, stt_utterances, image_dir):
    """Bind a verifier checkpoint to the material its read-only tools can reveal."""
    digest = hashlib.sha256()
    payload = [source_records, image_records, image_meta, stt_utterances]
    digest.update(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8"))
    root = Path(image_dir).resolve()
    for record in image_records:
        name = str(record.get("file_name") or "")
        if not name or Path(name).name != name:
            continue
        path = (root / name).resolve()
        digest.update(name.encode("utf-8"))
        if path.parent != root or not path.is_file():
            digest.update(b"missing")
            continue
        size = path.stat().st_size
        if size > VerificationEvidenceLookup.MAX_IMAGE_BYTES:
            digest.update(f"oversize:{size}".encode("ascii"))
            continue
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


"""Validate result structure/evidence bindings and recover already-paid rejected responses."""


def create_verification_result_validators(*, chunk_id, claim_registry, lookup, mode, run, saved_verification, summary_body_for_verification, verification_source_records, web_search_enabled, web_search_requested):
    """Validate result structure/evidence bindings and recover already-paid rejected responses."""
    def validate_verification_payload(parsed):
        if mode != "legacy":
            if mode == "concept":
                checked = parse_concept_only_result(
                    json.dumps(parsed, ensure_ascii=False),
                    revised_markdown=summary_body_for_verification,
                    web_records=lookup.web_records,
                    web_search_required_blocks=lookup.web_search_required_claims)
                unsafe_index = next((index for index, finding in enumerate(
                    checked["findings"]) if finding["kind"] == "concept_error"
                    and (not isinstance(finding["edit"], dict)
                         or not isinstance(finding["edit"].get("start"), int))), None)
                if unsafe_index is not None:
                    finding = checked["findings"][unsafe_index]
                    raise ValueError(f"findings[{unsafe_index}].edit unsafe_edit block_patch "
                                     f"block_id={finding['block_id']} reason={finding.get('edit_error', 'unbound_patch')}")
                return parsed
            if mode == "fidelity":
                checked = parse_fidelity_comparison_result(
                    json.dumps(parsed, ensure_ascii=False),
                    comparison_id=chunk_id,
                    draft_markdown=summary_body_for_verification,
                    cleaned_stt=verification_source_records,
                    scene_records=[], registered_claims={},
                )
                unsafe_index = next((index for index, finding in enumerate(
                    checked["findings"]) if finding["kind"] not in {"uncertain", "dismissed"}
                    and finding["edit"] is None), None)
                if unsafe_index is not None:
                    finding = checked["findings"][unsafe_index]
                    raise ValueError(f"findings[{unsafe_index}].edit unsafe_edit block_patch "
                                     f"block_id={finding['block_id']} reason={finding.get('edit_error', 'unbound_patch')}")
                return parsed
            if mode == "integrated":
                parsed = mark_unassessed_candidates(parsed, claim_registry.claims)
            checked = parse_integrated_chunk_result(
                json.dumps(parsed, ensure_ascii=False),
                chunk_id=chunk_id, draft_markdown=summary_body_for_verification,
                concept_review_enabled=run.concept_review_enabled if mode == "integrated" else False,
                concept_only=mode == "integrated",
                registered_claims=claim_registry.claims,
                returned_source_ids_by_claim=lookup.returned_evidence_by_claim,
                original_frame_ids_by_claim=lookup.returned_timed_frame_by_claim,
                timed_frame_targets_by_image_by_claim=lookup.timed_frame_targets_by_image_by_claim,
                returned_web_source_ids_by_claim=lookup.returned_web_evidence_by_claim,
            )
            unsafe_index = next((index for index, finding in enumerate(checked["findings"])
                                 if finding.get("incomplete_reason") == "unsafe_edit"), None)
            if (unsafe_index is not None
                    and not any(item.get("correction_used")
                                for item in saved_verification.get("rounds") or [])):
                raise ValueError(f"findings[{unsafe_index}].edit unsafe_edit")
            return parsed
        if claim_registry.claims and isinstance(parsed, dict):
            for key in ("claims", "issues"):
                for index, item in enumerate(parsed.get(key) if isinstance(parsed.get(key), list) else []):
                    if isinstance(item, dict) and "summary_quote" in item:
                        raise ValueError(f"{key}[{index}].summary_quote must be omitted after registration.")
        return parse_verification_result(
            json.dumps(parsed, ensure_ascii=False),
            summary_markdown=summary_body_for_verification,
            returned_evidence_by_claim=lookup.returned_evidence_by_claim,
            locator_status_by_claim=lookup.locator_status_by_claim,
            locator_hints=lookup._locator_hints,
            stt_lookup_claim_ids=lookup.stt_lookup_claim_ids,
            stt_lookup_quote_by_claim=lookup.stt_quote_by_claim,
            timed_frame_evidence_by_claim=lookup.returned_timed_frame_by_claim,
            timed_frame_targets_by_image_by_claim=lookup.timed_frame_targets_by_image_by_claim,
            timed_frame_lookup_claim_ids=lookup.timed_frame_lookup_claim_ids,
            returned_web_evidence_by_claim=lookup.returned_web_evidence_by_claim,
            web_search_required_claims=lookup.web_search_required_claims,
            web_search_unavailable=web_search_requested and not web_search_enabled,
            registered_claims=claim_registry.claims or None,
        )

    def validated_checkpoint_result(result):
        if mode != "legacy":
            result = validate_verification_payload(result)
            if mode == "concept":
                return parse_concept_only_result(
                    json.dumps(result, ensure_ascii=False),
                    revised_markdown=summary_body_for_verification,
                    web_records=lookup.web_records,
                    web_search_required_blocks=lookup.web_search_required_claims)
            if mode == "fidelity":
                checked = parse_fidelity_comparison_result(
                    json.dumps(result, ensure_ascii=False),
                    comparison_id=chunk_id,
                    draft_markdown=summary_body_for_verification,
                    cleaned_stt=verification_source_records,
                    scene_records=[], registered_claims={},
                )
                if (any(round_entry.get("tool_calls") for round_entry in
                        saved_verification.get("rounds") or [])
                        or saved_verification.get("tool_outcomes")):
                    checked = {**checked, "status": "needs_review",
                               "incomplete_reason": "unexpected_tool_request"}
                return checked
            return parse_integrated_chunk_result(
                json.dumps(result, ensure_ascii=False),
                chunk_id=chunk_id, draft_markdown=summary_body_for_verification,
                concept_review_enabled=run.concept_review_enabled if mode == "integrated" else False,
                concept_only=mode == "integrated",
                registered_claims=claim_registry.claims,
                returned_source_ids_by_claim=lookup.returned_evidence_by_claim,
                original_frame_ids_by_claim=lookup.returned_timed_frame_by_claim,
                timed_frame_targets_by_image_by_claim=lookup.timed_frame_targets_by_image_by_claim,
                returned_web_source_ids_by_claim=lookup.returned_web_evidence_by_claim,
            )
        return _validated_verification_checkpoint_result(
            result, summary_body_for_verification,
            lookup.returned_evidence_by_claim,
            lookup.returned_web_evidence_by_claim, lookup.web_search_required_claims,
            web_search_requested and not web_search_enabled,
            lookup.locator_status_by_claim, lookup._locator_hints,
            lookup.stt_lookup_claim_ids, lookup.stt_quote_by_claim,
            lookup.returned_timed_frame_by_claim,
            lookup.timed_frame_targets_by_image_by_claim,
            lookup.timed_frame_lookup_claim_ids,
            claim_registry.claims or None,
        )

    def recover_rejected_round(round_entry):
        if mode == "legacy":
            return _recover_rejected_verification_round(round_entry, validate_verification_payload)
        raw = round_entry.get("rejected_structured_result")
        if not round_entry.get("invalid_request") or not isinstance(raw, dict):
            return False
        try:
            if round_entry.get("unsafe_edit_retry"):
                # A parser fix can make a paid response valid. Recheck
                # every retained finding; never turn unsafe edits into
                # an incomplete result merely to avoid another call.
                validate_verification_payload(raw)
            checked = validated_checkpoint_result(raw)
        except (ValueError, TypeError):
            return False
        round_entry.update(raw_result=raw, result=checked, completed=True, invalid_request=False)
        return True

    return validate_verification_payload, validated_checkpoint_result, recover_rejected_round
