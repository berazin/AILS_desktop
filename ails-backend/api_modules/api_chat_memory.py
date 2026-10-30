"""Compatibility exports. Implementation belongs to chat.memory_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("chat.memory_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class ChatMemoryMixin:
    """Stable API methods delegating to the memory service."""
    def verified_memory_user_id(self) -> str:
        return _service_call(self, "memory", 'verified_memory_user_id')

    def clear_memory_service(self) -> None:
        return _service_call(self, "memory", 'clear_memory_service')

    def memory_service(self):
        return _service_call(self, "memory", 'memory_service')

    def memory_settings(self) -> dict:
        return _service_call(self, "memory", 'memory_settings')

    def memory_enabled(self) -> bool:
        return _service_call(self, "memory", 'memory_enabled')

    def observe_chat_exchange(self, payload: Mapping, answer: Any) -> None:
        return _service_call(self, "memory", 'observe_chat_exchange', payload, answer)

    def memory_snapshot(self) -> dict:
        return _service_call(self, "memory", 'memory_snapshot')

    def memory_mutate(self, payload: Mapping) -> dict:
        return _service_call(self, "memory", 'memory_mutate', payload)

    def memory_delete(self, payload: Mapping) -> dict:
        return _service_call(self, "memory", 'memory_delete', payload)

    def memory_update_settings(self, payload: Mapping) -> dict:
        return _service_call(self, "memory", 'memory_update_settings', payload)
