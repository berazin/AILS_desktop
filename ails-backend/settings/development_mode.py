"""Temporary serverless developer policy; saved credentials are not changed."""
import copy
import os
from ai_model_selection import normalize_model_settings
from ai_provider_settings import normalize_provider_settings


def enabled():
    from edition_manifest import EDITION_MANIFEST
    return (EDITION_MANIFEST["id"] == "developer"
            and os.environ.get("AILS_DEVELOPMENT_AUTH", "local").strip().lower() == "local")


def runtime_configuration(value):
    if not enabled():
        return value
    result = copy.deepcopy(value)
    providers = normalize_provider_settings(result.get("ai_provider_settings"))
    result["ai_provider_settings"] = providers
    providers["default"] = "chatgpt"
    providers["features"] = {
        key: "chatgpt" if provider == "ails" else provider
        for key, provider in providers.get("features", {}).items()
    }
    models = normalize_model_settings(result.get("ai_model_selection"))
    def convert(selection):
        if selection["mode"] in {"managed", "managed_default"}:
            return {"mode": "chatgpt", "modelId": providers["chatgpt_model"]}
        return selection
    models["default"] = convert(models["default"])
    models["features"] = {key: convert(selection) for key, selection in models["features"].items()}
    result["ai_model_selection"] = models
    return result
