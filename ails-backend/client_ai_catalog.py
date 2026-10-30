"""Public provider metadata fetched by the local client, with no account secret."""
import math
import threading
import time
from ai_model_selection import OPENROUTER_MODEL_ALIASES, is_managed_model_id
from client_ai_policy import DEFAULTS

_lock = threading.Lock()
_cache = None


def catalog(platform):
    import requests
    from personal_mode import require_server_enabled
    require_server_enabled()
    global _cache
    if platform != "openrouter":
        return {"platform": platform, "models": [], "default_model_id": None,
                "unavailable_reason": "vercel_on_hold"}
    with _lock:
        if _cache and _cache[0] > time.monotonic():
            return _cache[1]
        response = requests.get("https://openrouter.ai/api/v1/models", timeout=15, allow_redirects=False)
        if response.status_code != 200:
            raise ValueError("공급자 모델 목록을 확인할 수 없습니다.")
        raw_models = response.json().get("data")
        if not isinstance(raw_models, list):
            raise ValueError("공급자 모델 목록 형식이 올바르지 않습니다.")
        models = []
        for raw in raw_models:
            if not isinstance(raw, dict) or not is_managed_model_id(raw.get("id")):
                continue
            try:
                input_rate, output_rate = float(raw["pricing"]["prompt"]), float(raw["pricing"]["completion"])
                context = int(raw["context_length"])
                maximum = int((raw.get("top_provider") or {}).get("max_completion_tokens") or min(context, 8192))
            except (KeyError, ValueError, TypeError):
                continue
            if not all(math.isfinite(v) and v >= 0 for v in (input_rate, output_rate)) or context <= 0 or maximum <= 0:
                continue
            supported = raw.get("supported_parameters") or []
            modalities = (raw.get("architecture") or {}).get("input_modalities") or ["text"]
            model_id = raw["id"]
            models.append({"id": model_id, "name": raw.get("name", model_id), "developer": model_id.split("/")[0],
                           "aliases": [OPENROUTER_MODEL_ALIASES[model_id]] if model_id in OPENROUTER_MODEL_ALIASES else [],
                           "type": "language", "input_modalities": modalities, "output_modalities": ["text"],
                           "context_length": context, "max_output_tokens": maximum, "tools": "tools" in supported,
                           "vision": "image" in modalities, "streaming": True, "available": True,
                           "reasoning": {"values": []}, "supported_parameters": supported,
                           "input_price": input_rate, "output_price": output_rate,
                           "reservation_input_price": input_rate, "reservation_output_price": output_rate,
                           "recommended": False, "verification_needed": True})
        result = {"platform": platform, "models": models, "default_model_id": DEFAULTS["chatbot"],
                  "default_reasoning": None, "stale": False, "estimate_tokens": True}
        _cache = (time.monotonic() + 300, result)
        return result


def local_token_estimate(payload):
    """An explicit preflight estimate, never a provider usage/billing receipt."""
    import json
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    # Conservative text serialization allowance; vision/audio are not accurately
    # tokenized here. The provider key cap, not this estimate, enforces spending.
    return {"model_id": payload["model"], "input_tokens": len(text.encode("utf-8")) + 256,
            "source": "local_serialization_estimate", "estimated": True}
