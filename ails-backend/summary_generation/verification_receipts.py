"""Persist each paid round and tool receipt before later validation/publication."""

from __future__ import annotations

import json
from common import build_usage_event
from .verification_evidence import is_safe_verification_correction_message
from .verification_contract import _checkpoint_verification_call


def create_verification_receipt_callbacks(*, candidate_digest_by_call_id, frame_digest_by_call_id, legacy_verification_identity, mode, model_identity, prior_verification_rounds, run, saved_verification, validated_checkpoint_result, verification_identity, web_result_by_call_id, web_usage_by_call_id):
    """Persist each paid round and tool receipt before later validation/publication."""
    def refresh_verification_usage():
        model_calls = [item.get("usage") or {} for item in saved_verification["rounds"]]
        calls = [*model_calls, *(item["web_usage"] for item in saved_verification["tool_outcomes"]
                                 if isinstance(item, dict) and isinstance(item.get("web_usage"), dict))]
        aggregate = {
            "input_tokens": sum(int(item.get("input_tokens") or 0) for item in calls),
            "output_tokens": sum(int(item.get("output_tokens") or 0) for item in calls),
            "total_tokens": sum(int(item.get("total_tokens") or 0) for item in calls),
            "cached_input_tokens": sum(int(item.get("cached_input_tokens", item.get("prompt_cache_hit_tokens", 0)) or 0) for item in calls),
            "cache_write_tokens": sum(int(item.get("cache_write_tokens") or 0) for item in calls),
            "source": "api" if all(item.get("source") == "api" for item in calls) else "estimated",
            "billing_mode": model_identity["mode"] if isinstance(model_identity, dict) and model_identity.get("mode") in {"managed", "chatgpt"} else "byok",
        }
        has_web_calls = any(item.get("name") in {"lookup_web", "lookup_concept_web"}
                            and not item.get("reused_from_parent")
                            and not item.get("replay_blocked")
                            for item in saved_verification["tool_outcomes"]
                            if isinstance(item, dict))
        if has_web_calls:
            # Token rates alone omit the Responses web tool fee.
            # Leave the combined phase unpriced until a complete
            # confirmed receipt is available.
            aggregate["pricing_model"] = "unpriced-verification-with-web-search"
        # A web tool call may incur a separate charge. A model-only
        # receipt must not be shown as the total verification cost.
        if (model_calls and not has_web_calls
                and all("actual_cost_usd" in item for item in model_calls)):
            aggregate["actual_cost_usd"] = sum(float(item["actual_cost_usd"]) for item in model_calls)
        run.usage_events[:] = [event for event in run.usage_events
                           if not event or event.get("verification_identity") not in
                           {verification_identity, legacy_verification_identity}]
        event = build_usage_event("verification", saved_verification["rounds"][-1].get("model") or "", aggregate, input_type="text") if calls else None
        if event:
            event["verification_identity"] = verification_identity
            if mode in {"fidelity", "integrated", "concept"}:
                event["verification_stage"] = (
                    "fidelity" if mode == "fidelity" else "concept")
            event["attempt"] = (
                "mixed" if 0 < prior_verification_rounds < len(saved_verification["rounds"])
                else "prior" if prior_verification_rounds else "current"
            )
            run.usage_events.append(event)
            if has_web_calls and aggregate["billing_mode"] == "byok":
                # Responses usage has tokens but no separate web tool fee.
                # Keep those tokens in verification and mark the search
                # stage as unpriced without counting them twice.
                run.usage_events.append({
                    "phase": "web_search", "model": event["model"],
                    "pricing_model": "unpriced-web-search-tool",
                    "billing_mode": "byok", "attempt": event["attempt"],
                    "verification_identity": verification_identity,
                    "input_tokens": 0, "output_tokens": 0,
                })
        run.summary_resume_payload["usage_events"] = list(run.usage_events)
        return aggregate

    def on_verification_round(event):
        index = event["round_index"]
        if index != len(saved_verification["rounds"]):
            raise RuntimeError("근거 검증 라운드 순서가 올바르지 않습니다.")
        usage = {key: value for key, value in (event.get("usage") or {}).items()
                 if key in {"input_tokens", "output_tokens", "total_tokens", "thought_tokens",
                            "cached_input_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "cache_write_tokens", "actual_cost_usd",
                            "source", "model", "display_model", "pricing_model"}}
        entry = {"tool_calls": [], "invalid_tool_call_ids": [], "usage": usage,
                 "model": str(event.get("model") or "")[:128],
                 "completed": bool(event.get("completed")),
                 "invalid_request": bool(event.get("invalid_request")),
                 "correction_used": bool(event.get("correction_used")),
                 "unsafe_edit_retry": bool(event.get("unsafe_edit_retry"))}
        if is_safe_verification_correction_message(event.get("correction_message")):
            entry["correction_message"] = event["correction_message"]
        rejected = event.get("rejected_structured_result")
        if isinstance(rejected, dict):
            encoded_rejected = json.dumps(rejected, ensure_ascii=False)
            if len(encoded_rejected) <= 100_000:
                # Private checkpoint only; never shown in report or status logs.
                entry["rejected_structured_result"] = rejected
        try:
            for call in event.get("tool_calls") or []:
                bounded_call, invalid = _checkpoint_verification_call(call)
                entry["tool_calls"].append(bounded_call)
                if invalid:
                    entry["invalid_tool_call_ids"].append(bounded_call["id"])
        except (TypeError, ValueError, json.JSONDecodeError):
            saved_verification["rounds"].append(entry)
            refresh_verification_usage()
            run.persist_partial_progress()
            raise
        if entry["completed"]:
            if mode != "legacy":
                entry["raw_result"] = event["structured_result"]
            entry["result"] = validated_checkpoint_result(event["structured_result"])
        saved_verification["rounds"].append(entry)
        refresh_verification_usage()
        run.persist_partial_progress()

    def on_verification_tool(event):
        tool_name = str(event.get("name") or "")
        entry = {
            "round_index": event.get("round_index"),
            "tool_call_id": str(event.get("tool_call_id") or "")[:128],
            "name": tool_name if tool_name in {"register_claims", "register_concept_candidates", "lookup_stt", "lookup_stt_by_id", "lookup_stt_by_time", "lookup_frame", "lookup_frame_by_t_id", "lookup_web", "lookup_concept_web"} else "invalid",
            "evidence_status": event.get("evidence_status"),
            "completed": bool(event.get("completed")),
        }
        if tool_name in {"lookup_frame", "lookup_frame_by_t_id"} and entry["evidence_status"] == "found":
            frame_digest = frame_digest_by_call_id.pop(entry["tool_call_id"], None)
            if frame_digest:
                entry["frame_digest"] = frame_digest
        if tool_name == "register_concept_candidates" and entry["evidence_status"] in {"found", "missing"}:
            candidate_digest = candidate_digest_by_call_id.pop(entry["tool_call_id"], None)
            if candidate_digest:
                entry["candidate_digest"] = candidate_digest
        if tool_name in {"lookup_web", "lookup_concept_web"}:
            web_payload = web_result_by_call_id.pop(entry["tool_call_id"], {})
            entry["web_records"] = web_payload.get("evidence") or []
            if web_payload.get("reused_from_parent"):
                entry["reused_from_parent"] = True
            if web_payload.get("replay_blocked"):
                entry["replay_blocked"] = True
            web_usage = web_usage_by_call_id.pop(entry["tool_call_id"], None)
            if web_usage:
                entry["web_usage"] = web_usage
            pending = next((item for item in reversed(saved_verification["tool_outcomes"])
                            if item.get("tool_call_id") == entry["tool_call_id"]
                            and item.get("round_index") == entry["round_index"]
                            and item.get("evidence_status") == "pending"), None)
            if pending is not None:
                pending.update(entry)
            else:
                saved_verification["tool_outcomes"].append(entry)
        else:
            saved_verification["tool_outcomes"].append(entry)
        if tool_name in {"lookup_web", "lookup_concept_web"}:
            refresh_verification_usage()
        run.persist_partial_progress()

    return refresh_verification_usage, on_verification_round, on_verification_tool
