"""Compatibility exports. Implementation belongs to chat.budget_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("chat.budget_service"), name)
