"""Local opaque session adapters for existing AILS generation pipelines.

The gateway-shaped record is compatibility data, never an AILS credit session.
OAuth credentials stay inside account/Responses code, absent from task configs.
"""
import secrets
import threading

from .account import ACCOUNT
from .protocol import ChatGPTError
from . import responses

ENDPOINT = "chatgpt-plan://responses"
_sessions = {}
_lock = threading.RLock()


def acquire(model, *, expected_identity=None, request_guard=None, reasoning_effort=None):
    token, identity = ACCOUNT.access(expected=expected_identity)
    del token
    if not model or model not in {m["id"] for m in ACCOUNT.models()}:
        raise ChatGPTError("model_unavailable")
    handle = "chatgpt-local-" + secrets.token_hex(24)
    with _lock:
        _sessions[handle] = (identity, model, request_guard, reasoning_effort)
    return {"session_id": handle, "token": handle, "model_id": model, "gateway_url": ENDPOINT,
            "transport": "chatgpt", "provider": "ChatGPT 구독", "billing_mode": "chatgpt"}


def finish(handle):
    with _lock:
        _sessions.pop(handle, None)


def call(handle, model, messages, **kwargs):
    with _lock:
        session = _sessions.get(handle)
    if not session or model != session[1]:
        raise ChatGPTError("reconnect_required")
    if callable(session[2]):
        session[2]()
    if session[3] is not None:
        kwargs["request_options"] = {**(kwargs.get("request_options") or {}), "reasoning": {"effort": session[3]}}
    return responses.call(ACCOUNT, session[0], model, messages, **kwargs)


def model_identity(selection):
    token, identity = ACCOUNT.access()
    del token
    if not selection.get("modelId"):
        raise ChatGPTError("model_unavailable")
    return {"mode": "chatgpt", "provider": "ChatGPT 구독", "model_id": selection["modelId"],
            "account_identity": list(identity), "policy_revision": None}
