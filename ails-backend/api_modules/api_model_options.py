"""Compatibility exports. Implementation belongs to settings.model_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("settings.model_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class ModelOptionsMixin:
    """Stable API methods delegating to the models service."""
    def preview_ai_model_selections(self, payload: dict):
        return _service_call(self, "models", 'preview_ai_model_selections', payload)

    def model_options(self, config_override=None):
        return _service_call(self, "models", 'model_options', config_override)

    def chatbot_model_catalog(self):
        return _service_call(self, "models", 'chatbot_model_catalog')

    def validate_chatbot_model(self, payload):
        return _service_call(self, "models", 'validate_chatbot_model', payload)

    def test_model_connection(self, payload: dict):
        return _service_call(self, "models", 'test_model_connection', payload)

    def selected_ai_model(self, workflow: str) -> dict:
        return _service_call(self, "models", 'selected_ai_model', workflow)

    def workflow_uses_managed_ai(self, workflow: str) -> bool:
        return _service_call(self, "models", 'workflow_uses_managed_ai', workflow)

    def local_provider_model(self, workflow: str) -> tuple[str, str]:
        return _service_call(self, "models", 'local_provider_model', workflow)

    def managed_workflow_model(self, workflow: str) -> str | None:
        return _service_call(self, "models", 'managed_workflow_model', workflow)

    def managed_workflow_options(self, workflow: str) -> dict:
        return _service_call(self, "models", 'managed_workflow_options', workflow)

    def managed_cloud_model_catalog(self) -> dict:
        return _service_call(self, "models", 'managed_cloud_model_catalog')

    @staticmethod
    def call_managed_gateway_chat(session: Mapping, messages: list[dict], **kwargs):
        return _import_module("settings.model_service").ModelService.call_managed_gateway_chat(session, messages, **kwargs)
