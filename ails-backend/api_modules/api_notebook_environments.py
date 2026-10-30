"""Compatibility exports. Implementation belongs to code_services.environment_requests."""
from __future__ import annotations
from importlib import import_module as _import_module


def notebook_environment_request(state, payload, emit=None):
    from code_services.environment_requests import notebook_environment_request as handle
    return handle(state, payload, emit)

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("code_services.environment_requests"), name)
