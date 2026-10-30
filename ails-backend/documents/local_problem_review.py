"""LocalProblemReview: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from documents.auto_review_support import (
    Mapping,
    documents,
    language_support,
    os,
    pdf,
    pipeline_utils,
    problem_review_ocr_context,
    threading,
    voice,
)


@dataclass(frozen=True)
class LocalProblemReviewPorts:
    get_config: Callable[..., Any]


class LocalProblemReview:
    def __init__(self, ports: LocalProblemReviewPorts):
        self._ports = ports

    @property
    def config(self):
        return self._ports.get_config()

    def review_pdf_problem_local(self, payload: Mapping) -> dict:
        """Proofread one page of catalog problems with local Qwen3 text output."""

        pdf_path = os.path.abspath(str(payload.get("pdf_path", "") or ""))
        base_dir = str(payload.get("base_dir", "") or "")
        seed = documents.problem_manager.get_pdf_problem(pdf_path, base_dir, payload.get("problem_id", ""))
        requested_ids = {
            str(problem_id or "")
            for problem_id in payload.get("_problem_ids") or []
            if str(problem_id or "")
        }
        catalog = documents.problem_manager.list_pdf_problems(pdf_path, base_dir)
        all_problems = [
            dict(problem) for problem in catalog.get("problems", [])
            if isinstance(problem, Mapping)
        ]
        page = max(1, int(seed.get("page") or 1))
        page_problems = [
            problem for problem in all_problems
            if int(problem.get("page") or 1) == page
            and (not requested_ids or str(problem.get("id", "") or "") in requested_ids)
        ] or [seed]
        cancel_event = payload.get("_cancel_event")
        application_errors = []
        applied_count = 0
        processed_count = 0
        local_model_id = voice.llama_cpp_voice_agent.resolve_local_problem_review_model_id(
            payload.get("_local_model_id", self.config.get("local_problem_review_model"))
        )
        model_name = local_model_id
        try:
            proofread_language = language_support.normalize_app_language((pdf.pdf_ocr.pdf_ocr_status(pdf_path) or {}).get("language"))
        except Exception:
            proofread_language = language_support.APP_LANGUAGE_DEFAULT
        for problem in page_problems:
            if isinstance(cancel_event, threading.Event) and cancel_event.is_set():
                break
            problem_id = str(problem.get("id", "") or "")
            try:
                indexed_pages = [
                    pdf.pdf_ocr.indexed_pdf_page(pdf_path, page_number)
                    for page_number in range(
                        max(1, int(problem.get("page") or 1)),
                        min(
                            max(
                                int(problem.get("page") or 1),
                                int(problem.get("page_end") or problem.get("page") or 1),
                            ),
                            int(problem.get("page") or 1) + 1,
                        ) + 1,
                    )
                ]
                context = problem_review_ocr_context(problem, indexed_pages, all_problems)
                messages = documents.problem_answering.build_local_problem_proofread_messages({
                    "problem": problem,
                    "page_context": context,
                }, language=proofread_language)
                with voice.llama_cpp_voice_agent.VOICE_AGENT_RUNTIME.session(local_model_id) as (endpoint, model_name):
                    corrected, _usage = pipeline_utils.call_openai_compatible_chat(
                        endpoint,
                        "",
                        model_name,
                        messages,
                        provider_label="llama.cpp local problem review",
                        allow_empty_api_key=True,
                        max_retries=0,
                        timeout=180,
                        request_options={
                            "temperature": 0,

                            "cache_prompt": True,
                        },
                    )
                proposal = documents.problem_answering.parse_local_problem_proofread_response(
                    corrected,
                    problem,
                    page_context=context,
                )
                processed_count += 1
                if not proposal["changed"]:
                    continue
                documents.problem_manager.apply_reviewed_problem_content(
                    pdf_path,
                    base_dir,
                    problem_id,
                    problem_text=proposal["problem_text"],
                    number=proposal["number"],
                    page=problem.get("page"),
                    page_end=problem.get("page_end"),
                    choices=problem.get("choices") or [],
                    code=problem.get("code") or [],
                    code_positions=problem.get("code_positions") or [],
                    answer_type=problem.get("answer_type"),
                    selected_source="local",
                    resolution_kind="automatic",
                    selected_model=model_name,
                    review_stage="local",
                    expected_content=problem,
                )
                applied_count += 1
            except Exception as error:
                application_errors.append({
                    "problem_id": problem_id,
                    "error": str(error)[:1_000],
                })
        return {
            "page": page,
            "page_problem_count": processed_count,
            "applied_problem_count": applied_count,
            "queued_problem_count": 0,
            "application_errors": application_errors,
            "provider": "llama.cpp",
            "model": model_name,
            "usage": {"call_count": processed_count, "total_cost_usd": 0.0},
        }
