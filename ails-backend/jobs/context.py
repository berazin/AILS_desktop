"""Carry application resource scopes into owned background work."""
from contextvars import copy_context
from functools import partial


def contextual_call(action, *args, **kwargs):
    context = copy_context()
    return partial(context.run, action, *args, **kwargs)
