"""Compatibility exports. Implementation belongs to chat.research_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("chat.research_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class ResearchToolsMixin:
    """Stable API methods delegating to the research service."""
    def research_scope(self, workspace_id=None):
        return _service_call(self, "research", 'research_scope', workspace_id)

    def research_vision_supported(self):
        return _service_call(self, "research", 'research_vision_supported')

    def execute_research_tool(self, payload):
        return _service_call(self, "research", 'execute_research_tool', payload)

    def _execute_research_tool(self, payload):
        return _service_call(self, "research", '_execute_research_tool', payload)
