"""Compatibility exports. Implementation belongs to code_services.assist_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("code_services.assist_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class ApiCodeAssistMixin:
    """Stable API methods delegating to the code_assist service."""
    def review_code_sandbox(self, payload: dict, emit=None):
        return _service_call(self, "code_assist", 'review_code_sandbox', payload, emit)

    def prompt_edit_code_sandbox(self, payload: dict):
        return _service_call(self, "code_assist", 'prompt_edit_code_sandbox', payload)
