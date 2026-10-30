"""MultimodalReview: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from documents.auto_review_support import (
    AUTO_APPLY_CONFIDENCE,
    Mapping,
    PDF_PROBLEM_MANAGED_ESTIMATE_USD_PER_PAGE,
    PDF_PROBLEM_MODEL_FORMAT_MAX_RETRIES,
    _INTERNAL_GATEWAY_REVIEW,
    documents,
    hashlib,
    language_support,
    normalize_answer_type,
    os,
    pdf,
    safe_float,
    threading,
    time,
)


@dataclass(frozen=True)
class MultimodalReviewPorts:
    acquire_managed_ai_session: Callable[..., Any]
    finish_managed_ai_session: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]


class MultimodalReview:
    def __init__(self, ports: MultimodalReviewPorts):
        self._ports = ports
        self.acquire_managed_ai_session = ports.acquire_managed_ai_session
        self.finish_managed_ai_session = ports.finish_managed_ai_session
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

    def review_pdf_problem_multimodal(self, payload: dict):
        if payload.get("_internal_review_token") is _INTERNAL_GATEWAY_REVIEW:
            return self._review_pdf_problem_multimodal_with_key(payload)
        access_mode = "managed" if self.workflow_uses_managed_ai("problem_review") else "personal"
        if access_mode == "personal":
            raise ValueError("Personal review credentials are no longer supported.")
        if access_mode != "managed":
            raise RuntimeError("AI gateway access mode is invalid.")
        session = self.acquire_managed_ai_session(PDF_PROBLEM_MANAGED_ESTIMATE_USD_PER_PAGE)
        try:
            return self._review_pdf_problem_multimodal_with_key({
                **payload,
                "_gateway_api_key": session["token"],
                "_review_policy": session,
                "_internal_review_token": _INTERNAL_GATEWAY_REVIEW,
            })
        finally:
            self.finish_managed_ai_session(session["session_id"])

    def _review_pdf_problem_multimodal_with_key(self, payload: dict):
        """Nano-first page review with Luna then Gemini confidence fallbacks."""
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        base_dir = str(payload.get("base_dir", "") or "")
        problem = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, payload.get("problem_id", ""))
        start_page = max(1, int(problem.get("page") or 1))
        requested_problem_ids = {
            str(problem_id or "")
            for problem_id in (payload.get("_problem_ids") or [])
            if str(problem_id or "")
        }
        page_problems = [
            dict(candidate) for candidate in documents.problem_manager.list_pdf_problems(pdf_path, base_dir).get("problems", [])
            if isinstance(candidate, Mapping) and int(candidate.get("page") or 0) == start_page
            and (
                not requested_problem_ids
                or str(candidate.get("id", "") or "") in requested_problem_ids
            )
        ]
        if not page_problems:
            page_problems = [problem]
        api_key = str(payload.get("_gateway_api_key") or "").strip()
        if not api_key:
            raise RuntimeError("AI gateway review credential is unavailable.")
        review_policy = payload.get("_review_policy") if isinstance(payload.get("_review_policy"), Mapping) else {}
        primary_model = str(review_policy.get("primary_model") or documents.problem_review_gateway.PRIMARY_REVIEW_MODEL)
        secondary_model = str(review_policy.get("secondary_model") or documents.problem_review_gateway.SECONDARY_REVIEW_MODEL)
        fallback_model = str(review_policy.get("fallback_model") or documents.problem_review_gateway.FALLBACK_REVIEW_MODEL)
        confidence_threshold = max(0.0, min(
            1.0,
            safe_float(review_policy.get("confidence_threshold"), AUTO_APPLY_CONFIDENCE),
        ))
        cancel_event = payload.get("_cancel_event")

        def cancellation_requested() -> bool:
            return isinstance(cancel_event, threading.Event) and cancel_event.is_set()

        if cancellation_requested():
            raise RuntimeError("Automatic problem review was cancelled before the page request started.")

        def failed_batch_records(model, error, *, call_made=True):
            batch_id = hashlib.sha256(
                f"failed\0{model}\0{start_page}\0{time.time_ns()}".encode("utf-8")
            ).hexdigest()[:20]
            error_usage = dict(getattr(error, "usage", {}) or {})
            batch_cost = max(0.0, safe_float(error_usage.get("cost"), 0.0))
            error_usage["batch_cost_usd"] = batch_cost
            actual_call = bool(getattr(error, "call_made", call_made))
            accounting_complete = bool(getattr(
                error,
                "cost_accounting_complete",
                not actual_call,
            ))
            response_diagnostics = dict(getattr(error, "response_diagnostics", {}) or {})
            return {
                str(candidate.get("id", "")): {
                    "schema_version": 4,
                    "created_at": time.time(),
                    "model": model,
                    "problem_id": str(candidate.get("id", "")),
                    "original": dict(candidate),
                    "proposal": None,
                    "raw_proposal": None,
                    "validation_error": f"Model batch request failed: {str(error)[:800]}",
                    "usage": dict(error_usage),
                    "latency_ms": int(getattr(error, "latency_ms", 0) or 0),
                    "response_id": str(getattr(error, "response_id", "") or ""),
                    "response_diagnostics": response_diagnostics,
                    "call_made": actual_call,
                    "cost_accounting_complete": accounting_complete,
                    "response_truncated": bool(getattr(error, "response_truncated", False)),
                    "batch_id": batch_id,
                    "batch_pages": sorted({int(item.get("page") or 1) for item in page_problems}),
                    "application_status": "proposed",
                    "applied": False,
                }
                for candidate in page_problems
            }

        managed_gateway_url = str((payload.get("_review_policy") or {}).get("gateway_url") or "").strip()
        try:
            review_language = language_support.normalize_app_language((pdf.pdf_ocr.pdf_ocr_status(pdf_path) or {}).get("language"))
        except Exception:
            review_language = language_support.APP_LANGUAGE_DEFAULT

        def run_model_batch_with_format_retry(model):
            attempts = []
            accepted = {}
            latest = {}
            for attempt_number in range(1, PDF_PROBLEM_MODEL_FORMAT_MAX_RETRIES + 2):
                response_error = None
                try:
                    latest = documents.problem_review_gateway.review_page_batch(
                        base_dir=base_dir,
                        pdf_path=pdf_path,
                        problems=page_problems,
                        api_key=api_key,
                        model=model,
                        endpoint=managed_gateway_url,
                        language=review_language,
                    )
                except Exception as error:
                    if ((payload.get("_review_policy") or {}).get("transport") == "openrouter_temporary_direct"
                            and not isinstance(error, documents.problem_review_gateway.GatewayResponseError)):
                        # The provider may have completed a timed-out request.
                        # Do not spend again through the secondary-model route.
                        raise RuntimeError("AI review response was not confirmed. Automatic retry and model fallback were stopped; check the task before retrying.") from None
                    response_error = error
                    latest = failed_batch_records(model, error)
                attempts.append(latest)

                invalid_ids = []
                for problem_id, record in latest.items():
                    proposal = record.get("proposal") if isinstance(record, Mapping) else None
                    validation_error = str(record.get("validation_error", "") or "") if isinstance(record, Mapping) else ""
                    if isinstance(proposal, Mapping) and not validation_error:
                        accepted.setdefault(problem_id, record)
                    elif problem_id not in accepted:
                        invalid_ids.append(problem_id)
                if not invalid_ids:
                    return accepted, attempts

                retryable_format_error = response_error is None or isinstance(
                    response_error,
                    documents.problem_review_gateway.GatewayResponseError,
                )
                retries_used = attempt_number - 1
                if (
                    not retryable_format_error
                    or retries_used >= PDF_PROBLEM_MODEL_FORMAT_MAX_RETRIES
                    or cancellation_requested()
                ):
                    return {
                        problem_id: accepted.get(problem_id, latest.get(problem_id, {}))
                        for problem_id in latest
                    }, attempts

                persisted = dict(latest)
                for problem_id in invalid_ids:
                    persisted[problem_id] = documents.problem_review_gateway.mark_review_status(
                        base_dir,
                        pdf_path,
                        latest[problem_id],
                        "response_failed",
                        "Model response format was invalid; retrying the same page batch.",
                        retry_attempt=attempt_number,
                        retry_limit=PDF_PROBLEM_MODEL_FORMAT_MAX_RETRIES,
                        response_truncated=bool(getattr(response_error, "response_truncated", False)),
                    )
                attempts[-1] = persisted

            return latest, attempts

        # Retry only response-format failures. Low confidence still follows the
        # Nano -> Luna -> Gemini route without repeating a valid model response.
        primary_records, primary_attempts = run_model_batch_with_format_retry(
            primary_model
        )

        def record_proposal(record):
            proposal = record.get("proposal") if isinstance(record, Mapping) else None
            return proposal if isinstance(proposal, Mapping) else None

        def record_confidence(record):
            proposal = record_proposal(record)
            if proposal is not None:
                return max(0.0, min(1.0, safe_float(proposal.get("confidence"), 0.0)))
            raw = record.get("raw_proposal") if isinstance(record, Mapping) else None
            return max(0.0, min(1.0, safe_float(
                raw.get("confidence") if isinstance(raw, Mapping) else 0.0,
                0.0,
            )))

        def auto_apply_eligible(record):
            proposal = record_proposal(record)
            return bool(
                proposal is not None
                and proposal.get("auto_apply_eligible", True)
                and not str(record.get("validation_error", "") or "")
            )

        secondary_problem_ids = {
            str(candidate.get("id", ""))
            for candidate in page_problems
            if (
                not auto_apply_eligible(primary_records.get(str(candidate.get("id", "")), {}))
                or record_confidence(primary_records.get(str(candidate.get("id", "")), {}))
                < confidence_threshold
            )
        }
        secondary_records = {}
        secondary_attempts = []
        if secondary_problem_ids and not cancellation_requested():
            secondary_records, secondary_attempts = run_model_batch_with_format_retry(
                secondary_model
            )
        elif secondary_problem_ids:
            secondary_records = failed_batch_records(
                secondary_model,
                RuntimeError("Automatic problem review was cancelled before the Luna fallback request."),
                call_made=False,
            )
            secondary_attempts = [secondary_records]

        fallback_problem_ids = {
            problem_id
            for problem_id in secondary_problem_ids
            if (
                not auto_apply_eligible(secondary_records.get(problem_id, {}))
                or record_confidence(secondary_records.get(problem_id, {}))
                < confidence_threshold
            )
        }
        # Every model receives the identical page batch. Candidates that did
        # not need a later fallback remain audit-only.
        fallback_records = {}
        fallback_attempts = []
        if fallback_problem_ids and not cancellation_requested():
            fallback_records, fallback_attempts = run_model_batch_with_format_retry(
                fallback_model
            )
        elif fallback_problem_ids:
            fallback_records = failed_batch_records(
                fallback_model,
                RuntimeError(f"Automatic problem review was cancelled before the {fallback_model} fallback request."),
                call_made=False,
            )
            fallback_attempts = [fallback_records]

        # A model call may take long enough for another editor/request to
        # change the page. Never overwrite a newer user or AI revision with a
        # response produced from the stale snapshot.
        freshness_fields = (
            "problem_text", "number", "page", "page_end", "choices", "code", "code_positions",
            "answer_type",
        )
        current_by_id = {}
        for candidate in page_problems:
            problem_id = str(candidate.get("id", ""))
            current = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, problem_id)
            current_by_id[problem_id] = current
            def freshness_value(item, field):
                if field == "answer_type":
                    return normalize_answer_type(item.get(field))
                if field in {"choices", "code", "code_positions"}:
                    return list(item.get(field) or [])
                return item.get(field)

            stale = any(
                freshness_value(current, field) != freshness_value(candidate, field)
                for field in freshness_fields
            )
            if stale:
                error = RuntimeError(
                    "멀티모달 검수 중 페이지 문제가 변경되어 자동 반영을 중단했습니다."
                )
                for record in [
                    *primary_records.values(),
                    *secondary_records.values(),
                    *fallback_records.values(),
                ]:
                    documents.problem_review_gateway.mark_review_application_failed(base_dir, pdf_path, record, error)
                raise error

        updated_by_id = dict(current_by_id)
        routing_records = {}
        audit_records = [
            record
            for attempts in (primary_attempts, secondary_attempts, fallback_attempts)
            for records in attempts[:-1]
            for record in records.values()
        ]
        queued_items = []
        applied_problem_ids = []
        application_errors = []
        for candidate in page_problems:
            problem_id = str(candidate.get("id", ""))
            primary_record = primary_records[problem_id]
            needs_secondary = problem_id in secondary_problem_ids
            secondary_record = secondary_records.get(problem_id)
            secondary_confidence = record_confidence(secondary_record)
            needs_fallback = problem_id in fallback_problem_ids
            fallback_record = fallback_records.get(problem_id)

            if not needs_secondary:
                selected_record = primary_record
                selected_model = primary_model
                selected_stage = "primary"
            elif (
                auto_apply_eligible(secondary_record)
                and secondary_confidence >= confidence_threshold
            ):
                selected_record = secondary_record
                selected_model = secondary_model
                selected_stage = "secondary"
            elif (
                auto_apply_eligible(fallback_record)
                and record_confidence(fallback_record) >= confidence_threshold
            ):
                selected_record = fallback_record
                selected_model = fallback_model
                selected_stage = "fallback"
            else:
                fallback_confidence = record_confidence(fallback_record)
                both_under = (
                    auto_apply_eligible(secondary_record)
                    and auto_apply_eligible(fallback_record)
                    and secondary_confidence < confidence_threshold
                    and fallback_confidence < confidence_threshold
                )
                reason = (
                        f"Both fallback confidences were below {confidence_threshold:.2f}."
                    if both_under
                    else (
                        f"Neither {secondary_model} nor {fallback_model} produced a structurally valid proposal "
                        f"at confidence {confidence_threshold:.2f} or above."
                    )
                )
                nano_final = documents.problem_review_gateway.mark_review_status(
                    base_dir,
                    pdf_path,
                    primary_record,
                    "needs_user_review",
                    reason,
                    confidence_threshold=confidence_threshold,
                    companion_model=secondary_model,
                    companion_confidence=secondary_confidence,
                )
                secondary_final = documents.problem_review_gateway.mark_review_status(
                    base_dir,
                    pdf_path,
                    secondary_record,
                    "needs_user_review",
                    reason,
                    confidence_threshold=confidence_threshold,
                    companion_model=fallback_model,
                    companion_confidence=fallback_confidence,
                )
                fallback_final = documents.problem_review_gateway.mark_review_status(
                    base_dir,
                    pdf_path,
                    fallback_record,
                    "needs_user_review",
                    reason,
                    confidence_threshold=confidence_threshold,
                    companion_model=secondary_model,
                    companion_confidence=secondary_confidence,
                )
                paddle_original = (
                    dict(candidate.get("paddleocr_original") or {})
                    if isinstance(candidate.get("paddleocr_original"), Mapping)
                    else {}
                )
                if (
                    paddle_original
                    and str(current_by_id[problem_id].get("practice_content_source", "") or "") == "ai_review"
                ):
                    updated_by_id[problem_id] = documents.problem_manager.apply_reviewed_problem_content(
                        pdf_path,
                        base_dir,
                        problem_id,
                        problem_text=paddle_original.get("problem_text", ""),
                        number=paddle_original.get("number", candidate.get("number", 1)),
                        page=paddle_original.get("page", candidate.get("page", 1)),
                        page_end=paddle_original.get("page_end", candidate.get("page_end", candidate.get("page", 1))),
                        choices=paddle_original.get("choices", []),
                        code=paddle_original.get("code", []),
                        code_positions=paddle_original.get("code_positions", []),
                        answer_type=paddle_original.get("answer_type", "unknown"),
                        selected_source="paddleocr",
                        resolution_kind="unresolved_safety",
                        audit_reference=str(primary_record.get("batch_id", "") or ""),
                        review_stage="paddleocr",
                        expected_content=candidate,
                    )
                queue_item = documents.problem_review_gateway.upsert_review_queue_item(
                    base_dir,
                    pdf_path,
                    {
                        "problem_id": problem_id,
                        "page": candidate.get("page"),
                        "number": candidate.get("number"),
                        "original": {
                            **candidate,
                            **(
                                dict(candidate.get("paddleocr_original") or {})
                                if isinstance(candidate.get("paddleocr_original"), Mapping)
                                else {}
                            ),
                            "practice_content_source": "paddleocr",
                        },
                        "reason": reason,
                        "confidence_threshold": confidence_threshold,
                        "primary_review": secondary_final,
                        "fallback_review": fallback_final,
                        "review_provenance": {
                            "luna": {"stage": "secondary", "model": secondary_model},
                            "gemini": {"stage": "fallback", "model": fallback_model},
                        },
                    },
                )
                queued_items.append(queue_item)
                routing_records[problem_id] = secondary_final
                audit_records.extend([nano_final, secondary_final, fallback_final])
                continue

            proposal = record_proposal(selected_record)
            try:
                updated = documents.problem_manager.apply_reviewed_problem_content(
                    pdf_path,
                    base_dir,
                    problem_id,
                    problem_text=proposal.get("problem_text", candidate.get("problem_text", "")),
                    number=proposal.get("number", candidate.get("number", 1)),
                    # Routing metadata is catalog state, not OCR text. Never let a
                    # printed folio returned by the model move the problem.
                    page=candidate.get("page", 1),
                    page_end=candidate.get("page_end", candidate.get("page", 1)),
                    choices=proposal.get("choices", candidate.get("choices", [])),
                    code=proposal.get("code", candidate.get("code", [])),
                    code_positions=proposal.get("code_positions", candidate.get("code_positions", [])),
                    answer_type=normalize_answer_type(proposal.get("answer_type")),
                    selected_source={
                        "primary": "nano",
                        "secondary": "luna",
                        "fallback": "gemini",
                    }[selected_stage],
                    resolution_kind="automatic",
                    audit_reference=str(selected_record.get("batch_id", "") or ""),
                    selected_model=selected_model,
                    review_stage=selected_stage,
                    expected_content=candidate,
                )
            except Exception as error:
                failed_record = documents.problem_review_gateway.mark_review_application_failed(
                    base_dir, pdf_path, selected_record, error,
                )
                routing_records[problem_id] = failed_record
                audit_records.append(failed_record)
                application_errors.append({"problem_id": problem_id, "error": str(error)[:1_000]})
                updated_by_id[problem_id] = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, problem_id)
                continue
            try:
                applied_record = documents.problem_review_gateway.mark_review_applied(
                    base_dir,
                    pdf_path,
                    selected_record,
                    updated,
                )
            except Exception as error:
                failed_record = documents.problem_review_gateway.mark_review_application_failed(
                    base_dir, pdf_path, selected_record, error,
                )
                routing_records[problem_id] = failed_record
                audit_records.append(failed_record)
                application_errors.append({"problem_id": problem_id, "error": str(error)[:1_000]})
                updated_by_id[problem_id] = updated
                continue

            for model, companion_record in (
                (primary_model, primary_record),
                (secondary_model, secondary_record),
                (fallback_model, fallback_record),
            ):
                if companion_record is None or companion_record is selected_record:
                    continue
                status = "superseded" if (
                    model == primary_model and needs_secondary
                    or model == secondary_model and needs_fallback
                ) else "not_selected"
                audit_records.append(documents.problem_review_gateway.mark_review_status(
                    base_dir,
                    pdf_path,
                    companion_record,
                    status,
                    f"{selected_model} was selected by the {confidence_threshold:.2f} confidence threshold.",
                    selected_model=selected_model,
                ))
            documents.problem_review_gateway.remove_review_queue_item(base_dir, pdf_path, problem_id)
            updated_by_id[problem_id] = updated
            applied_problem_ids.append(problem_id)
            routing_records[problem_id] = applied_record
            audit_records.append(applied_record)

        selected_id = str(problem.get("id", ""))
        selected_problem = updated_by_id[selected_id]

        def batch_cost(records):
            if not records:
                return 0.0
            first = next(iter(records.values()))
            usage = first.get("usage") if isinstance(first, Mapping) else None
            return max(0.0, safe_float(
                usage.get("batch_cost_usd") if isinstance(usage, Mapping) else 0.0,
                0.0,
            ))

        def batch_call_made(records):
            return any(
                bool(record.get("call_made", True))
                for record in records.values()
                if isinstance(record, Mapping)
            )

        def batch_accounting_complete(records):
            return all(
                not bool(record.get("call_made", True))
                or bool(record.get("cost_accounting_complete", True))
                for record in records.values()
                if isinstance(record, Mapping)
            )

        def batch_response_errors(records):
            errors = []
            for record in records.values():
                if not isinstance(record, Mapping):
                    continue
                error = str(record.get("validation_error", "") or "").strip()
                if error and error not in errors:
                    errors.append(error[:1_000])
            return errors

        primary_call_made = sum(batch_call_made(records) for records in primary_attempts)
        secondary_call_made = sum(batch_call_made(records) for records in secondary_attempts)
        fallback_call_made = sum(batch_call_made(records) for records in fallback_attempts)
        primary_accounting_complete = all(
            batch_accounting_complete(records) for records in primary_attempts
        )
        secondary_accounting_complete = all(
            batch_accounting_complete(records) for records in secondary_attempts
        )
        fallback_accounting_complete = all(
            batch_accounting_complete(records) for records in fallback_attempts
        )

        pending_queue = documents.problem_review_gateway.list_review_queue(base_dir, pdf_path)
        return {
            "problem": selected_problem,
            "problems": [updated_by_id[str(candidate.get("id", ""))] for candidate in page_problems],
            "review": routing_records[selected_id],
            "reviews": audit_records,
            "review_queue": queued_items,
            "pending_review_queue": pending_queue,
            "page_problem_count": len(page_problems),
            "applied_problem_count": len(applied_problem_ids),
            "queued_problem_count": len(queued_items),
            "application_errors": application_errors,
            "primary_model": primary_model,
            "secondary_model": secondary_model,
            "fallback_model": fallback_model,
            "secondary_requested": bool(secondary_records),
            "secondary_problem_ids": sorted(secondary_problem_ids),
            "fallback_requested": bool(fallback_records),
            "fallback_problem_ids": sorted(fallback_problem_ids),
            "confidence_threshold": confidence_threshold,
            "usage": {
                "primary_cost_usd": sum(batch_cost(records) for records in primary_attempts),
                "secondary_cost_usd": sum(batch_cost(records) for records in secondary_attempts),
                "fallback_cost_usd": sum(batch_cost(records) for records in fallback_attempts),
                "total_cost_usd": (
                    sum(batch_cost(records) for records in primary_attempts)
                    + sum(batch_cost(records) for records in secondary_attempts)
                    + sum(batch_cost(records) for records in fallback_attempts)
                ),
                "call_count": primary_call_made + secondary_call_made + fallback_call_made,
                "cost_accounting_complete": (
                    primary_accounting_complete
                    and secondary_accounting_complete
                    and fallback_accounting_complete
                ),
                "response_errors": [
                    error
                    for attempts in (primary_attempts, secondary_attempts, fallback_attempts)
                    for records in attempts
                    for error in batch_response_errors(records)
                ],
            },
        }
