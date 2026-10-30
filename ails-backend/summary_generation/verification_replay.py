"""Replay saved model/tool outcomes without another paid request."""

from __future__ import annotations

import json
from .verification_evidence import (
    UNAVAILABLE_EVIDENCE_REPLY,
    is_safe_verification_correction_message,
)
from pipeline_utils import TaskCancelledError
from .verification_contract import _bounded_verification_call


def replay_verification_rounds(*, candidate_digest_by_call_id, claim_registry, engine, execute_verification_tool, frame_digest_by_call_id, lookup, max_verification_tool_rounds, messages, mode, recover_rejected_round, rounds, run, saved_outcomes, saved_verification):
    """Replay saved model/tool outcomes without another paid request."""
    for replay_index, round_entry in enumerate(rounds):
        calls = round_entry.get("tool_calls") or []
        if not calls:
            if (replay_index == len(rounds) - 1
                    and recover_rejected_round(round_entry)):
                run.persist_partial_progress()
                break
            if round_entry.get("invalid_request") and round_entry.get("correction_message"):
                if not is_safe_verification_correction_message(round_entry["correction_message"]):
                    raise RuntimeError("잘못된 근거 검증 수정 요청 체크포인트입니다.")
                rejected = round_entry.get("rejected_structured_result")
                if round_entry.get("unsafe_edit_retry") and isinstance(rejected, dict):
                    messages.append({"role": "assistant", "content": json.dumps(
                        rejected, ensure_ascii=False)})
                messages.append({"role": "user", "content": round_entry["correction_message"]})
                continue
            if not round_entry.get("completed"):
                raise RuntimeError("이전 검증 응답이 유효하지 않아 자동 재호출을 중단했습니다.")
            break
        replayed_calls = [_bounded_verification_call(call) for call in calls]
        if replay_index >= max_verification_tool_rounds:
            # A paid final round may contain rejected tool calls.
            # They were never executed and must stay that way.
            correction = round_entry.get("correction_message")
            if not round_entry.get("invalid_request") or not is_safe_verification_correction_message(correction):
                raise RuntimeError("잘못된 근거 검증 도구 체크포인트입니다.")
            messages.append({"role": "user", "content": correction})
            continue
        messages.append({"role": "assistant", "tool_calls": replayed_calls})
        image_parts = []
        for call in replayed_calls:
            outcome = saved_outcomes.get((replay_index, call["id"]))
            outcome_status = outcome.get("evidence_status") if outcome and outcome.get("completed") else None
            if call["function"]["name"] in {"lookup_web", "lookup_concept_web"}:
                args = json.loads(call["function"]["arguments"])
                replay_status = outcome_status if outcome_status in {"found", "missing", "error", "limit", "unavailable"} else "unavailable"
                replay_content = (lookup.replay_concept_web(
                    block_ids=args["block_ids"], query=args["query"],
                    status=replay_status, records=(outcome or {}).get("web_records") or [])
                    if call["function"]["name"] == "lookup_concept_web" else
                    lookup.replay_web(
                        claim_ids=args["claim_ids"], query=args["query"],
                        status=replay_status,
                        records=(outcome or {}).get("web_records") or []))
                result = {"content": replay_content, "evidence_status": replay_status}
                if outcome and outcome.get("evidence_status") == "pending":
                    outcome["evidence_status"] = "unavailable"
                    outcome["completed"] = True
                    run.persist_partial_progress()
            elif call["id"] in round_entry.get("invalid_tool_call_ids", []) or outcome_status == "invalid_request":
                result = {"content": '{"status":"invalid_request","evidence":[],"error":"invalid_request"}', "evidence_status": "invalid_request"}
            elif outcome_status in {"error", "limit"}:
                # A limit refusal consumed no quota. Failed reads did;
                # replaying the latter must retain its per-tool budget.
                if outcome_status == "error":
                    if call["function"]["name"] == "register_claims":
                        raise RuntimeError("Claim registration cannot replay as an evidence read error")
                    kind = "frame" if call["function"]["name"] in {"lookup_frame", "lookup_frame_by_t_id"} else "stt"
                    lookup._calls += 1
                    if kind == "frame":
                        lookup._frame_calls += 1
                        if call["function"]["name"] == "lookup_frame_by_t_id":
                            lookup.timed_frame_lookup_claim_ids.update(
                                json.loads(call["function"]["arguments"])["claim_ids"])
                    else:
                        lookup._stt_calls += 1
                        args = json.loads(call["function"]["arguments"])
                        claim_id = args["claim_ids"][0]
                        quote = (claim_registry.quote(claim_id) if claim_registry.claims
                                 else args.get("summary_quote"))
                        if not isinstance(quote, str):
                            raise RuntimeError("Missing STT claim quote in verification checkpoint")
                        if (claim_id in lookup.stt_quote_by_claim
                                and lookup.stt_quote_by_claim[claim_id] != quote):
                            raise RuntimeError("Conflicting STT claim quote in verification checkpoint")
                        lookup.stt_lookup_claim_ids.add(claim_id)
                        lookup.stt_quote_by_claim.setdefault(claim_id, quote)
                result = {"content": (UNAVAILABLE_EVIDENCE_REPLY if outcome_status == "error" else '{"status":"limit","evidence":[],"error":"limit"}'),
                          "evidence_status": outcome_status}
            else:
                try:
                    result = execute_verification_tool(
                        call, require_cached_frame=(outcome_status == "found"
                            and call["function"]["name"] in {"register_concept_candidates", "lookup_frame", "lookup_frame_by_t_id"}))
                except TaskCancelledError:
                    raise
                except Exception as error:
                    status = getattr(error, "evidence_status", "error")
                    if status not in {"invalid_request", "limit", "error"}:
                        raise
                    result = {"content": (UNAVAILABLE_EVIDENCE_REPLY if status == "error" else json.dumps({"status": status, "evidence": [], "error": status})),
                              "evidence_status": status}
            if outcome_status in {"found", "missing"} and result["evidence_status"] != outcome_status:
                raise RuntimeError("저장된 근거 검증 조회 결과와 재생 결과가 다릅니다.")
            candidate_digest = candidate_digest_by_call_id.pop(call["id"], None)
            if (call["function"]["name"] == "register_concept_candidates"
                    and outcome_status in {"found", "missing"}
                    and (not outcome.get("candidate_digest")
                         or outcome["candidate_digest"] != candidate_digest)):
                raise RuntimeError("저장된 개념 후보 근거와 재생 결과가 다릅니다.")
            frame_digest = frame_digest_by_call_id.pop(call["id"], None)
            frame_args = json.loads(call["function"]["arguments"])
            original_frame_lookup = (
                call["function"]["name"] in {"lookup_frame", "lookup_frame_by_t_id"}
                and (frame_args.get("t_id") or (mode == "fidelity"
                     and frame_args.get("start_seconds") is not None
                     and frame_args.get("end_seconds") is not None))
            )
            if (original_frame_lookup
                    and outcome_status == "found"
                    and (not outcome.get("frame_digest")
                         or outcome["frame_digest"] != frame_digest)):
                raise RuntimeError("저장된 원본 프레임 근거와 재생 결과가 다릅니다.")
            if not outcome or outcome.get("evidence_status") != result["evidence_status"] or not outcome.get("completed"):
                saved_verification["tool_outcomes"].append({
                    "round_index": replay_index,
                    "tool_call_id": call["id"],
                    "name": call["function"]["name"],
                    "evidence_status": result["evidence_status"],
                    "completed": True,
                })
                run.persist_partial_progress()
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": result["content"]})
            if result.get("image_parts"):
                image_parts.append({"type": "text", "text": f"Evidence image for tool call {call['id']}:"})
                image_parts.extend(result["image_parts"])
        engine.status["locator_status"] = dict(lookup.locator_status_by_claim)
        if image_parts:
            messages.append({"role": "user", "content": image_parts})
        correction = round_entry.get("correction_message")
        if correction:
            if not round_entry.get("invalid_request") or not is_safe_verification_correction_message(correction):
                raise RuntimeError("잘못된 근거 검증 수정 요청 체크포인트입니다.")
            messages.append({"role": "user", "content": correction})
