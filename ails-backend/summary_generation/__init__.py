"""Lecture-summary engine shipped by editions with an enabled summary input."""

__all__ = ["BackgroundEngine"]


def __getattr__(name):
    if name == "BackgroundEngine":
        from .engine import BackgroundEngine

        return BackgroundEngine
    raise AttributeError(name)
