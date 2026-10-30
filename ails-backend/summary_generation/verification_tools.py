"""Evidence reads and bounded web lookup/replay; no transport orchestration."""

from __future__ import annotations

import json
import hashlib
import uuid
from .verification_evidence import register_concept_candidates
from .verification_contract import _bounded_verification_call


def create_verification_tool_executor(*, candidate_digest_by_call_id, claim_registry, concept_web_reuse, frame_digest_by_call_id, legacy_fidelity, lookup, mode, run, saved_verification, summary_body_for_verification, verification_identity, verification_source_records, web_result_by_call_id, web_search_call, web_search_enabled, web_usage_by_call_id):
    engine = run.engine
    """Evidence reads and bounded web lookup/replay; no transport orchestration."""
    def execute_verification_tool(call, *, require_cached_frame=False):
        if mode == "fidelity" and not legacy_fidelity:
            raise RuntimeError("정제 STT와 초안 대조에는 조회 도구가 없습니다.")
        bounded = _bounded_verification_call(call)
        function = bounded["function"]
        args = json.loads(function["arguments"])
        if function["name"] == "lookup_concept_web":
            if mode != "concept" or not web_search_enabled:
                raise ValueError("Concept web lookup is unavailable.")
            block_ids = args["block_ids"]
            lookup.validate_web_query(args["query"])
            matching_prior_searches = [attempt for attempt in concept_web_reuse
                                       if attempt["query"] == "*" or
                                       attempt["query"].strip().casefold()
                                       == args["query"].strip().casefold()]
            reused_result = None
            if matching_prior_searches:
                current_blocks = summary_body_for_verification.split("\n\n")
                if any(int(block_id[1:]) > len(current_blocks) for block_id in block_ids):
                    raise ValueError("Concept web block ID is out of range.")
                current_texts = {block_id: current_blocks[int(block_id[1:]) - 1]
                                 for block_id in block_ids}
                for attempt in matching_prior_searches:
                    prior_texts = attempt["blocks"]
                    if (attempt["status"] != "found" or
                            not attempt.get("unique_in_parent") or
                            len(prior_texts) != len(current_texts) or
                            len(set(prior_texts.values())) != len(prior_texts) or
                            set(prior_texts.values()) != set(current_texts.values())):
                        continue
                    try:
                        mapped_ids = {old_id: next(new_id for new_id, text in current_texts.items()
                                                   if text == old_text)
                                      for old_id, old_text in prior_texts.items()}
                        mapped_records = [{**record,
                                           "source_id": f"W{len(lookup.web_records) + index:04d}",
                                           "claim_ids": [mapped_ids[item]
                                                         for item in record.get("claim_ids", [])]}
                                          for index, record in enumerate(attempt["records"], 1)]
                        reused_result = lookup.replay_concept_web(
                            block_ids=block_ids, query=args["query"],
                            status="found", records=mapped_records)
                    except (ValueError, TypeError, KeyError, StopIteration, OSError):
                        reused_result = None
                    if reused_result is not None:
                        break
            request_id = str(uuid.uuid5(uuid.NAMESPACE_URL,
                f"{verification_identity}:{call['id']}"))
            saved_verification["tool_outcomes"].append({
                "round_index": len(saved_verification["rounds"]) - 1,
                "tool_call_id": call["id"], "name": "lookup_concept_web",
                "evidence_status": "pending", "request_id": request_id,
                "completed": False,
                "reused_from_parent": reused_result is not None,
                "replay_blocked": bool(matching_prior_searches and reused_result is None)})
            run.persist_partial_progress()
            def search_concept(ids, query):
                response = web_search_call(ids, query, run.cfg, request_id)
                if isinstance(response, dict) and response.get("mode") == "byok":
                    usage = (response.get("response") or {}).get("usage")
                    if isinstance(usage, dict):
                        web_usage_by_call_id[call["id"]] = {
                            **{key: int(usage[key]) for key in (
                                "input_tokens", "output_tokens", "total_tokens")
                               if isinstance(usage.get(key), int) and not isinstance(usage[key], bool)
                               and 0 <= usage[key] <= 10_000_000}, "source": "api"}
                return response
            if reused_result is not None:
                result = reused_result
            elif matching_prior_searches:
                # A prior paid search cannot be safely rebound to
                # this child block. Keep the scope incomplete.
                result = json.dumps({"block_ids": block_ids, "status": "unavailable",
                                     "evidence": []}, ensure_ascii=False)
            else:
                result = lookup.lookup_concept_web(
                    block_ids=block_ids, query=args["query"], search=search_concept)
            web_result_by_call_id[call["id"]] = {
                **json.loads(result), "reused_from_parent": reused_result is not None,
                "replay_blocked": bool(matching_prior_searches and reused_result is None)}
        elif function["name"] == "register_concept_candidates":
            result = register_concept_candidates(
                claim_registry, lookup, args["candidates"],
                require_cached_frame=require_cached_frame,
            )
            candidate_digest_by_call_id[call["id"]] = hashlib.sha256(
                json.dumps({"content": result["content"], "images": result["image_parts"]},
                           sort_keys=True).encode("utf-8")
            ).hexdigest()
        elif function["name"] == "register_claims":
            result = claim_registry.register(args["claims"])
            if mode in {"integrated", "contradiction"}:
                chunk_t_ids = [str(record["source_id"]) for record in verification_source_records
                               if str(record.get("source_id") or "").startswith("T")]
                for registered in claim_registry.claims.values():
                    quote = registered["summary_quote"]
                    if not any(hint.get("summary_quote") == quote for hint in lookup._locator_hints):
                        lookup._locator_hints.append({"summary_quote": quote, "t_ids": chunk_t_ids})
        else:
            # Older injected verifier callbacks may still send a
            # literal STT quote. The live tool schema excludes it.
            legacy_quote = (function["name"] in {"lookup_stt", "lookup_stt_by_id", "lookup_stt_by_time"}
                            and isinstance(args.get("summary_quote"), str)
                            and not claim_registry.claims)
            legacy_followup = (not claim_registry.claims and all(
                claim_id in lookup.stt_quote_by_claim for claim_id in args["claim_ids"]))
            if not (legacy_quote or legacy_followup):
                for claim_id in args["claim_ids"]:
                    claim_registry.quote(claim_id)
            if function["name"] in {"lookup_stt", "lookup_stt_by_id", "lookup_stt_by_time"}:
                if not (legacy_quote or legacy_followup):
                    args["summary_quote"] = claim_registry.quote(args["claim_ids"][0])
                elif "summary_quote" not in args:
                    args["summary_quote"] = lookup.stt_quote_by_claim[args["claim_ids"][0]]
        if function["name"] == "lookup_web":
            if not web_search_enabled:
                result = json.dumps({"claim_ids": args["claim_ids"], "status": "unavailable", "evidence": []})
            else:
                # Prove STT eligibility before committing a paid attempt.
                lookup.validate_web_query(args["query"])
                lookup.note_web_search(args["claim_ids"])
                request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{verification_identity}:{call['id']}"))
                pending = {"round_index": len(saved_verification["rounds"]) - 1,
                           "tool_call_id": call["id"], "name": "lookup_web",
                           "evidence_status": "pending", "request_id": request_id,
                           "completed": False}
                saved_verification["tool_outcomes"].append(pending)
                run.persist_partial_progress()
                def search_web(ids, query):
                    response = web_search_call(ids, query, run.cfg, request_id)
                    if isinstance(response, dict) and response.get("mode") == "byok":
                        usage = (response.get("response") or {}).get("usage")
                        if isinstance(usage, dict):
                            selected = {key: int(usage[key]) for key in
                                        ("input_tokens", "output_tokens", "total_tokens")
                                        if isinstance(usage.get(key), int) and not isinstance(usage[key], bool)
                                        and 0 <= usage[key] <= 10_000_000}
                            if selected:
                                web_usage_by_call_id[call["id"]] = {**selected, "source": "api"}
                    return response
                result = lookup.lookup_web(
                    claim_ids=args["claim_ids"], query=args["query"],
                    search=search_web,
                )
                web_result_by_call_id[call["id"]] = json.loads(result)
        elif function["name"] not in {"register_claims", "register_concept_candidates", "lookup_concept_web"}:
            if (function["name"] in {"lookup_frame", "lookup_frame_by_t_id"}
                    and (args.get("t_id") or (mode == "fidelity"
                         and args.get("start_seconds") is not None
                         and args.get("end_seconds") is not None))):
                args["_require_cache"] = require_cached_frame
            method = (lookup.lookup_stt if function["name"] in
                      {"lookup_stt_by_id", "lookup_stt_by_time"}
                      else lookup.lookup_frame if function["name"] == "lookup_frame_by_t_id"
                      else getattr(lookup, function["name"]))
            result = method(**args)
        content = result["content"] if isinstance(result, dict) else result
        payload = json.loads(content)
        status = ("found" if function["name"] == "register_claims" else
                  payload.get("status") or ("found" if payload.get("evidence") else "missing"))
        if function["name"] in {"register_concept_candidates", "lookup_stt", "lookup_stt_by_id", "lookup_stt_by_time"}:
            engine.status["locator_status"] = dict(lookup.locator_status_by_claim)
        original_frame_lookup = (
            function["name"] in {"lookup_frame", "lookup_frame_by_t_id"}
            and (args.get("t_id") or (mode == "fidelity"
                 and args.get("start_seconds") is not None
                 and args.get("end_seconds") is not None))
        )
        if original_frame_lookup and status == "found":
            frame_digest_by_call_id[call["id"]] = hashlib.sha256(
                json.dumps({"content": content, "images": result.get("image_parts", [])},
                           sort_keys=True).encode("utf-8")
            ).hexdigest()
        if isinstance(result, dict):
            return {**result, "evidence_status": status}
        return {"content": content, "evidence_status": status}

    return execute_verification_tool
