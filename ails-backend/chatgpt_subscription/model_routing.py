"""Route model-tab selections through the signed-in account's model catalog."""
from .account import ACCOUNT
from .protocol import ChatGPTError
from ai_provider_settings import FEATURES


def account_model_id(selection):
    model = str(selection.get("modelId") or "")
    if selection.get("mode") == "managed" and model.startswith("openai/"):
        return model[len("openai/"):]
    return None


def connected_models():
    status = ACCOUNT.status()
    if not status["available"] or not status["connected"]:
        return []
    if not status["plan_enabled"]:
        raise ChatGPTError("permission_required")
    return ACCOUNT.models()


def default_selection(model):
    """Resolve an unset choice lazily from the connected account's catalog."""
    if not model:
        models = ACCOUNT.models()
        if not models:
            from .protocol import ChatGPTError
            raise ChatGPTError("model_unavailable")
        model = models[0]["id"]
    return {"mode": "chatgpt", "modelId": model}


def subscription_selection(selection, workflow, *, enabled, models=None):
    # Review retains its server-owned multi-model plan and credit contract.
    model = account_model_id(selection)
    if (not enabled or workflow == "problem_review" or not model
            or (workflow not in FEATURES and workflow != "video_verification")):
        return None
    models = connected_models() if models is None else models
    if model in {entry["id"] for entry in models}:
        return {"mode": "chatgpt", "modelId": model}
    return None
