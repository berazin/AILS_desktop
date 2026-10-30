"""Authenticated local API for connection controls; never returns OAuth tokens."""
from ai_provider_settings import FEATURES
from subscription_policy import require_subscription


def handle_chatgpt_request(state, method, path, payload=None):
    require_subscription()
    from chatgpt_subscription.account import ACCOUNT
    from chatgpt_subscription.protocol import USAGE_URL, ChatGPTError
    payload = payload or {}
    if method == "GET" and path == "/api/chatgpt/status":
        from edition_manifest import feature_enabled
        features = {key: label for key, label in FEATURES.items() if key != "insight_book" or feature_enabled("insight_book")}
        return {**ACCOUNT.status(), "usage_url": USAGE_URL, "features": features}
    if method == "GET" and path == "/api/chatgpt/models":
        return {"models": ACCOUNT.models(refresh=True)}
    if method == "GET" and path in {"/api/chatgpt/usage", "/api/chatgpt/usage/refresh"}:
        from chatgpt_subscription.usage_limits import USAGE_LIMITS
        return USAGE_LIMITS.read(ACCOUNT, refresh=path.endswith("/refresh"))
    if method == "POST" and path == "/api/chatgpt/connect":
        return ACCOUNT.start(reconsent=payload.get("reconsent") is True)
    if method == "POST" and path == "/api/chatgpt/cancel":
        ACCOUNT.cancel()
        return ACCOUNT.status()
    if method == "POST" and path == "/api/chatgpt/disconnect":
        return ACCOUNT.disconnect()
    if method == "POST" and path == "/api/chatgpt/welcome":
        return ACCOUNT.acknowledge_welcome()
    raise ChatGPTError("unknown_operation")
