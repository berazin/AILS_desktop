"""Compatibility exports. Implementation belongs to documents.review_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("documents.review_service"), name)

from bootstrap.service_adapter import service_call as _service_call
from .api_problem_auto_review import ProblemAutoReviewMixin


class ProblemReviewMixin(ProblemAutoReviewMixin):
    """Stable API methods delegating to the review service."""
    def generate_pdf_problem_hint(self, payload: dict):
        return _service_call(self, "review", 'generate_pdf_problem_hint', payload)

    def review_pdf_problem(self, payload: dict):
        return _service_call(self, "review", 'review_pdf_problem', payload)

    def choose_pdf_problem_review_model(self, payload: dict):
        return _service_call(self, "review", 'choose_pdf_problem_review_model', payload)

    def preview_pdf_answer_key(self, payload: dict):
        return _service_call(self, "review", 'preview_pdf_answer_key', payload)

    def list_pdf_study_problems(self, pdf_path, base_dir):
        return _service_call(self, "review", 'list_pdf_study_problems', pdf_path, base_dir)

    def scan_pdf_study_problems(self, payload):
        return _service_call(self, "review", 'scan_pdf_study_problems', payload)

    def manage_pdf_answer_key(self, payload: dict):
        return _service_call(self, "review", 'manage_pdf_answer_key', payload)

    def confirm_pdf_answer_key(self, payload: dict):
        return _service_call(self, "review", 'confirm_pdf_answer_key', payload)

    def confirm_pdf_answer_keys(self, payload: dict):
        return _service_call(self, "review", 'confirm_pdf_answer_keys', payload)

    def _validate_answer_key_grading_ai(self):
        return _service_call(self, "review", '_validate_answer_key_grading_ai')

    def _call_answer_key_grading_ai(self, messages):
        return _service_call(self, "review", '_call_answer_key_grading_ai', messages)

    def grade_pdf_problem(self, payload: dict):
        return _service_call(self, "review", 'grade_pdf_problem', payload)

    def grade_pdf_problems_batch(self, payload: dict, *, is_cancelled=lambda: False, emit=None):
        return _service_call(self, "review", 'grade_pdf_problems_batch', payload, is_cancelled=is_cancelled, emit=emit)

    def _complete_pdf_problem_grading(self, prepared, grading, response):
        return _service_call(self, "review", '_complete_pdf_problem_grading', prepared, grading, response)

    def _call_pdf_problem_grading_ai(self, grading_messages, *, on_text=None, on_started=None, is_cancelled=None):
        return _service_call(self, "review", '_call_pdf_problem_grading_ai', grading_messages, on_text=on_text, on_started=on_started, is_cancelled=is_cancelled)

    @staticmethod
    def parse_code_review_response(raw_answer, active_file):
        return _import_module("documents.review_service").ReviewService.parse_code_review_response(raw_answer, active_file)
