"""Memory-only direct credentials owned by local Python, never renderer/settings.

Opaque handles are purpose-bound to a fixed endpoint and selected models. This
local check is defense in depth; the provider guardrail enforces the real cap.
"""
from datetime import datetime
import re
import openrouter_web_search
import secrets
import threading
import time
from ai_model_selection import VERCEL_TO_OPENROUTER_ALIASES

ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
_lock = threading.RLock()
_credentials = {}


def register(result, models, *, now=None, reasoning=None, web_search=None):
    from personal_mode import require_server_enabled
    require_server_enabled()
    now = time.time() if now is None else now
    expires = datetime.fromisoformat(str(result.get("expires_at", "")).replace("Z", "+00:00")).timestamp()
    token, lease_id = result.get("token"), result.get("lease_id")
    if (result.get("transport") != "openrouter_temporary_direct" or result.get("gateway_url") != ENDPOINT
            or not isinstance(token, str) or not token or any(c.isspace() for c in token)
            or not isinstance(lease_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", lease_id)
            or not isinstance(result.get("limit_microusd"), int) or isinstance(result.get("limit_microusd"), bool)
            or not 0 < result["limit_microusd"] <= 9_007_199_254_740_991
            or expires <= now or expires > now + 3601
            or not models or not all(isinstance(m, str) and "/" in m for m in models)):
        raise ValueError("서버가 유효한 임시 AI 자격증명을 반환하지 않았습니다.")
    handle = "ails-lease-" + secrets.token_urlsafe(32)
    with _lock:
        _credentials[handle] = {"key": token, "lease_id": lease_id, "expires": expires,
                                "models": frozenset(models), "reasoning": reasoning,
                                "web_search": openrouter_web_search.settings({"openrouter_web_search": web_search})}
    return {"session_id": "lease-" + lease_id, "token": handle, "transport": "openrouter_temporary_direct",
            "gateway_url": ENDPOINT, "expires_at": result["expires_at"]}


def prepare(handle, endpoint, model, payload):
    with _lock:
        entry = _credentials.get(handle)
        if entry is None:
            if str(handle).startswith("ails-lease-"):
                raise RuntimeError("AI 임시 자격증명이 만료되거나 해제되었습니다.")
            return None
        if time.time() >= entry["expires"]:
            _credentials.pop(handle, None)
            raise RuntimeError("AI 임시 자격증명이 만료되었습니다. 작업 상태를 확인한 뒤 재시도해 주세요.")
        if endpoint != ENDPOINT or model not in entry["models"]:
            raise ValueError("AI 자격증명의 대상과 요청이 일치하지 않습니다.")
    result = dict(payload)
    result.pop("ails_request_budget_microusd", None)
    result["model"] = VERCEL_TO_OPENROUTER_ALIASES.get(model, model)
    if entry["reasoning"]:
        result["reasoning"] = ({"enabled": entry["reasoning"] == "enabled"}
                               if entry["reasoning"] in {"enabled", "disabled"}
                               else {"effort": entry["reasoning"]})
    if openrouter_web_search.intrinsic_search_model(result["model"]):
        raise ValueError("검색 내장 모델은 웹 검색 OFF/엔진 선택을 보장할 수 없습니다. 일반 모델을 선택해 주세요.")
    return openrouter_web_search.prepare(result, entry["web_search"])


def key(handle):
    from personal_mode import require_server_enabled
    require_server_enabled()
    with _lock:
        entry = _credentials.get(handle)
        if entry is None or time.time() >= entry["expires"]:
            raise RuntimeError("AI 임시 자격증명이 만료되거나 해제되었습니다.")
        return entry["key"]


def close(session_id):
    lease_id = str(session_id).removeprefix("lease-")
    with _lock:
        for handle in list(_credentials):
            if _credentials[handle]["lease_id"] == lease_id:
                _credentials.pop(handle, None)


def clear():
    with _lock:
        _credentials.clear()


def open_without_redirects(request, *, timeout):
    from personal_mode import require_server_enabled
    require_server_enabled()
    """The PDF review transport must not forward credential-bearing POSTs."""
    import urllib.request

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)
