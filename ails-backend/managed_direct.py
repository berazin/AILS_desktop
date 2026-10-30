"""Developer-only provider credentials and durable, content-free dispatch receipts.

Only dispatch counts and provider receipt IDs are persisted; credentials live in memory and prices come from the
provider's report on the server. A crashed dispatch stays counted, so a missing
provider report cannot silently become a free request.
"""
from __future__ import annotations

import copy
import provider_credentials
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
import secrets
import uuid
from datetime import datetime

ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions"
_lock = threading.RLock()
_sessions = {}


def _data_dir():
    runtime_dir = str(os.environ.get("AILS_RUNTIME_DATA_DIR", "") or "").strip()
    if runtime_dir:
        return Path(os.path.abspath(os.path.expandvars(os.path.expanduser(runtime_dir))))
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    return Path(appdata or os.path.join(os.path.expanduser("~"), ".local", "share")) / "AILS"


def _path(session_id):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", session_id):
        raise ValueError("Invalid managed session ID")
    return _data_dir() / "direct-ai-receipts" / f"{session_id}.json"


def _write(session_id, data):
    path = _path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    try:
        with temp.open("w", encoding="utf-8") as handle:
            json.dump(data, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def transport_fields(result, server_url):
    mode = result.get("transport")
    if mode in (None, "proxy"):
        return {"gateway_url": f"{server_url.rstrip('/')}/v1/gateway/chat/completions"}
    if mode != "vercel_developer_direct" or result.get("gateway_url") != ENDPOINT:
        raise ValueError("Unsupported managed AI transport")
    from edition_manifest import canonical_edition_id
    if canonical_edition_id() == "commercial":
        raise ValueError("Vercel direct credentials are not supported in the commercial edition")
    expires = datetime.fromisoformat(str(result["expires_at"]).replace("Z", "+00:00")).timestamp()
    if expires <= time.time():
        raise ValueError("Invalid direct session expiry")
    session_id = str(result["session_id"])
    provider_key = str(result["token"])
    if not provider_key:
        raise ValueError("Missing provider credential")
    token = secrets.token_urlsafe(32)
    models = result.get("allowed_models")
    if not isinstance(models, list) or not models or not all(isinstance(m, str) and m for m in models):
        raise ValueError("Invalid direct credential model policy")
    record = {"session_id": session_id, "requests": {}, "closed": False}
    with _lock:
        # Never overwrite a prior dispatch receipt if a server repeats a session.
        if _path(session_id).exists():
            raise ValueError("Direct session ID was already issued")
        _write(session_id, record)
        _sessions[hashlib.sha256(token.encode()).hexdigest()] = {
            "record": record, "models": set(models), "expires": expires, "provider_key": provider_key,
            "reasoning": copy.deepcopy(result.get("reasoning_config")),
        }
    return {"gateway_url": ENDPOINT, "transport": mode, "token": token,
            "reasoning_config": copy.deepcopy(result.get("reasoning_config"))}


def prepare_request(api_key, endpoint, model, payload, cancel_check=None, log_list=None):
    from personal_mode import require_local_transport
    require_local_transport(endpoint)
    prepared = provider_credentials.prepare(api_key, endpoint, model, payload)
    if prepared is not None:
        return prepared, True
    with _lock:
        session = _sessions.get(hashlib.sha256(str(api_key).encode()).hexdigest())
    if session is None:
        return payload, False
    if endpoint != ENDPOINT or model not in session["models"]:
        raise ValueError("Direct AI endpoint/model does not match the issued session")
    if session["record"]["closed"]:
        raise RuntimeError("Direct AI session has closed")
    if time.time() >= session["expires"]:
        raise RuntimeError("관리형 AI 세션이 만료되었습니다. 작업을 재시도해 주세요.")
    result = copy.deepcopy(payload)
    result.pop("ails_request_budget_microusd", None)
    selection = session["reasoning"]
    if selection:
        def clean(options):
            return {key: clean(value) if isinstance(value, dict) else value for key, value in options.items()
                    if not re.search(r"reasoning|thinking", key, re.I) and key != "effort"}
        for key in ("reasoning", "reasoning_effort", "thinking", "thinking_config", "thinkingConfig", "enable_thinking", "include_reasoning"):
            result.pop(key, None)
        for key in ("providerOptions", "provider_options", "output_config", "generation_config"):
            if isinstance(result.get(key), dict):
                result[key] = clean(result[key])
        value = selection.get("value")
        if value in ("enabled", "disabled"):
            result["reasoning"] = {"enabled": value == "enabled"}
        elif value != "model_default":
            result["reasoning"] = {"effort": value}
    return result, True


def provider_key(api_key):
    if str(api_key).startswith("ails-lease-"):
        return provider_credentials.key(api_key)
    with _lock:
        session = _sessions.get(hashlib.sha256(str(api_key).encode()).hexdigest())
        return session["provider_key"] if session else api_key


def record_dispatch(api_key, model):
    with _lock:
        session = _sessions.get(hashlib.sha256(str(api_key).encode()).hexdigest())
        if session is None:
            return None
        record = session["record"]
        if record["closed"]:
            raise RuntimeError("Direct AI session has closed")
        if model not in session["models"]:
            raise ValueError("Direct AI model does not match the session")
        request_id = uuid.uuid4().hex
        updated = {**record, "requests": {**record["requests"], request_id: {"model": model, "id": None}}}
        _write(record["session_id"], updated)  # Must succeed before paid dispatch.
        record.update(updated)
        return request_id


def record_generation(api_key, request_id, payload):
    if request_id is None or not isinstance(payload, dict):
        return
    generation_id = payload.get("id")
    if not isinstance(generation_id, str) or not re.fullmatch(r"gen_[A-Za-z0-9_-]{1,128}", generation_id):
        return
    with _lock:
        session = _sessions[hashlib.sha256(str(api_key).encode()).hexdigest()]
        record = session["record"]
        request = record["requests"][request_id]
        if request["id"] == generation_id:
            return
        if request["id"] is not None:
            raise ValueError("Provider changed generation ID during a request")
        updated = copy.deepcopy(record)
        updated["requests"][request_id]["id"] = generation_id
        _write(record["session_id"], updated)
        record.update(updated)


def record_rejection(api_key, request_id, status_code):
    if request_id is None:
        return
    with _lock:
        session = _sessions.get(hashlib.sha256(str(api_key).encode()).hexdigest())
        if session is None:
            return
        record = session["record"]
        if request_id not in record["requests"]:
            return
        request = record["requests"][request_id]
        if request.get("id") is not None:
            return
        updated = copy.deepcopy(record)
        updated["requests"][request_id]["rejected"] = int(status_code or 0)
        _write(record["session_id"], updated)
        record.update(updated)


def close_receipt(session_id):
    with _lock:
        try:
            path = _path(session_id)
        except ValueError:
            # Proxy session IDs are opaque and need not be valid local filenames.
            # Direct sessions are validated before any receipt is registered.
            return None
        if not path.exists():
            return None
        record = json.loads(path.read_text(encoding="utf-8"))
        requests = record.get("requests")
        if record.get("session_id") != session_id or not isinstance(requests, dict):
            raise ValueError("Invalid direct AI dispatch receipt")
        record["closed"] = True
        _write(session_id, record)
        for session in _sessions.values():
            if session["record"]["session_id"] == session_id:
                session["record"]["closed"] = True
        valid_requests = [r for r in requests.values() if not r.get("rejected")]
        return {"expected_requests": len(valid_requests), "generations": [r for r in valid_requests if r.get("id")]}


def receipt_needs_submission(session_id):
    with _lock:
        try:
            path = _path(session_id)
        except ValueError:
            return False
        if not path.exists():
            return False
        record = json.loads(path.read_text(encoding="utf-8"))
        active = any(s["record"]["session_id"] == session_id for s in _sessions.values())
        return not record.get("submitted", False) and (record.get("closed", False) or not active)


def receipt_submitted(session_id):
    with _lock:
        try:
            path = _path(session_id)
        except ValueError:
            return
        if not path.exists():
            return
        record = json.loads(path.read_text(encoding="utf-8"))
        record["submitted"] = True
        _write(session_id, record)
