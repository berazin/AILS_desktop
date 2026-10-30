"""ReviewRecords: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from documents.auto_review_support import (
    Mapping,
    documents,
    get_problem_review,
    hashlib,
    list_gold_samples,
    normalize_answer_type,
    os,
    save_gold_sample,
    time,
    validated_review_resolution_content,
)


@dataclass(frozen=True)
class ReviewRecordsPorts:
    pass


class ReviewRecords:
    def __init__(self, ports: ReviewRecordsPorts):
        self._ports = ports

    def get_pdf_problem_multimodal_review(self, payload: dict):
        model = str(payload.get("model") or documents.problem_review_gateway.PRIMARY_REVIEW_MODEL)
        return {"review": get_problem_review(
            str(payload.get("base_dir", "") or ""),
            os.path.abspath(str(payload.get("pdf_path", "") or "")),
            str(payload.get("problem_id", "") or ""),
            model,
        )}

    def list_pdf_problem_multimodal_review_queue(self, payload: dict):
        base_dir = str(payload.get("base_dir", "") or "")
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        items = documents.problem_review_gateway.list_review_queue(base_dir, pdf_path)
        unresolved_count = sum(1 for item in items if item.get("status") == "needs_user_review")
        return {"items": items, "count": len(items), "unresolved_count": unresolved_count}

    def resolve_pdf_problem_multimodal_review_queue(self, payload: dict):
        """Apply user-edited selection to practice catalog only; retain all evidence."""
        base_dir = str(payload.get("base_dir", "") or "")
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        problem_id = str(payload.get("problem_id", "") or "").strip()
        selected_source = str(payload.get("selected_source", "") or "").strip().lower()
        if selected_source not in {"paddleocr", "luna", "gemini"}:
            raise ValueError("selected_source must be paddleocr, luna, or gemini.")
        final = validated_review_resolution_content(payload.get("final_content"))

        queue_items = documents.problem_review_gateway.list_review_queue(base_dir, pdf_path)
        queue_item = next(
            (item for item in queue_items if str(item.get("problem_id", "")) == problem_id),
            None,
        )
        if not isinstance(queue_item, Mapping):
            raise KeyError("Review queue item was not found.")
        original = queue_item.get("original") if isinstance(queue_item.get("original"), Mapping) else {}
        current = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, problem_id)
        expected_content = (
            queue_item.get("final_content")
            if queue_item.get("status") == "resolved" and isinstance(queue_item.get("final_content"), Mapping)
            else original
        )
        freshness_fields = ("problem_text", "choices", "code", "code_positions", "answer_type")
        stale = any(
            (
                list(current.get(field) or []) != list(expected_content.get(field) or [])
                if field in {"choices", "code", "code_positions"}
                else normalize_answer_type(current.get(field)) != normalize_answer_type(expected_content.get(field))
                if field == "answer_type"
                else str(current.get(field, "") or "") != str(expected_content.get(field, "") or "")
            )
            for field in freshness_fields
        )
        if stale:
            raise RuntimeError(
                "Practice problem changed after this review queue item was opened. Reload it before saving."
            )
        resolution_id = hashlib.sha256(
            f"{problem_id}\0{selected_source}\0{time.time_ns()}".encode("utf-8")
        ).hexdigest()[:24]
        requested_content = {
            "problem_text": final.get("problem_text"),
            "choices": list(final.get("choices")),
            # Presence was validated above: [] means deliberately empty.
            "code": list(final.get("code")),
            "code_positions": list(final.get("code_positions") or []),
            "answer_type": final.get("answer_type"),
        }
        evidence = {
            "paddleocr_original": dict(original),
            "luna_review": dict(queue_item.get("primary_review") or {}),
            "gemini_review": dict(queue_item.get("fallback_review") or {}),
            "secondary_review": dict(queue_item.get("primary_review") or {}),
            "fallback_review": dict(queue_item.get("fallback_review") or {}),
            "review_provenance": dict(queue_item.get("review_provenance") or {}),
        }
        selected_review = (
            queue_item.get("primary_review")
            if selected_source == "luna"
            else queue_item.get("fallback_review")
            if selected_source == "gemini"
            else {}
        )
        selected_model = str(
            selected_review.get("model", "")
            if isinstance(selected_review, Mapping)
            else ""
        )
        selected_stage = {
            "paddleocr": "paddleocr",
            "luna": "secondary",
            "gemini": "fallback",
        }[selected_source]
        documents.problem_review_gateway.record_review_queue_resolution(
            base_dir,
            pdf_path,
            problem_id,
            {
                "resolution_id": resolution_id,
                "status": "requested",
                "selected_source": selected_source,
                "selected_model": selected_model,
                "review_stage": selected_stage,
                "final_content": requested_content,
                "candidate_evidence": evidence,
                "editor_action": "save_practice_override",
            },
        )
        try:
            updated = documents.problem_manager.apply_reviewed_problem_content(
                pdf_path,
                base_dir,
                problem_id,
                problem_text=requested_content["problem_text"],
                number=original.get("number"),
                page=original.get("page"),
                page_end=original.get("page_end", original.get("page")),
                choices=requested_content["choices"],
                code=requested_content["code"],
                code_positions=requested_content["code_positions"],
                answer_type=requested_content["answer_type"],
                selected_source=selected_source,
                resolution_kind="user_review",
                audit_reference=resolution_id,
                selected_model=selected_model,
                review_stage=selected_stage,
                expected_content=expected_content,
            )
        except Exception as error:
            documents.problem_review_gateway.record_review_queue_resolution(
                base_dir,
                pdf_path,
                problem_id,
                {
                    "resolution_id": resolution_id,
                    "status": "failed",
                    "selected_source": selected_source,
                    "selected_model": selected_model,
                    "review_stage": selected_stage,
                    "final_content": requested_content,
                    "error": str(error)[:1_000],
                },
            )
            raise

        normalized_final = {
            "problem_text": updated.get("problem_text", ""),
            "choices": list(updated.get("choices") or []),
            "code": list(updated.get("code") or []),
            "code_positions": list(updated.get("code_positions") or []),
            "answer_type": normalize_answer_type(updated.get("answer_type")),
        }
        resolved_item = documents.problem_review_gateway.record_review_queue_resolution(
            base_dir,
            pdf_path,
            problem_id,
            {
                "resolution_id": resolution_id,
                "status": "applied",
                "selected_source": selected_source,
                "selected_model": selected_model,
                "review_stage": selected_stage,
                "final_content": normalized_final,
                "candidate_evidence": evidence,
                "editor_action": "save_practice_override",
            },
        )
        for source_name, review in (
            ("luna", queue_item.get("primary_review")),
            ("gemini", queue_item.get("fallback_review")),
        ):
            if not isinstance(review, Mapping):
                continue
            try:
                documents.problem_review_gateway.mark_review_status(
                    base_dir,
                    pdf_path,
                    review,
                    "user_selected" if source_name == selected_source else "user_not_selected",
                    "User resolved the low-confidence review queue item.",
                    resolution_id=resolution_id,
                    selected_source=selected_source,
                    final_content=normalized_final,
                )
            except Exception:
                # Queue-resolution audit already contains both immutable model
                # snapshots and exact final content; model-latest files are secondary.
                pass
        return {"problem": updated, "item": resolved_item}

    def list_pdf_problem_multimodal_gold_samples(self, payload: dict):
        base_dir = str(payload.get("base_dir", "") or "")
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        samples = list_gold_samples(base_dir, pdf_path)
        return {"samples": samples, "count": len(samples), "target_count": 40}

    def save_pdf_problem_multimodal_gold_sample(self, payload: dict):
        if payload.get("human_confirmed") is not True:
            raise ValueError("PDF 원문과 대조한 뒤 정답 기준 표본임을 확인해 주세요.")
        base_dir = str(payload.get("base_dir", "") or "")
        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        problem = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, payload.get("problem_id", ""))
        return save_gold_sample(base_dir, pdf_path, problem)
