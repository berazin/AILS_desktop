"""Client-owned selection identity; never loads remote workflow assignments.

Defaults below preserve the pre-transition built-in policy. User selections take
precedence. This moves existing behavior; it does not invent a new model ranking.
"""
import hashlib
import json
from ai_model_selection import MANAGED_WORKFLOWS, is_managed_model_id, OPENROUTER_MODEL_ALIASES

DEFAULTS = {workflow: "deepseek/deepseek-v4-flash" for workflow in MANAGED_WORKFLOWS}
DEFAULTS.update(video_visual="openai/gpt-6-luna", video_stt_cleanup="openai/gpt-6-luna",
                image_analysis="qwen/qwen3.5-9b", video_verification="openai/gpt-5.6-luna",
                voice_agent="qwen/qwen3.5-9b")
REVIEW_MODELS = ("openai/gpt-5-nano", "openai/gpt-5.6-luna", "google/gemini-2.5-flash-lite")


def revision(config):
    # Domain separator prevents old server revision/cache reuse. Only public
    # selection settings participate; never hash credentials or document content.
    value = {"contract": "client-ai-v1", "selection": config.get("ai_model_selection", {}),
             "web_search": config.get("openrouter_web_search", {}), "defaults": DEFAULTS, "review": REVIEW_MODELS}
    return int(hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:13], 16) + 1


def identity(config, workflow, selection):
    model = selection.get("modelId") if selection.get("mode") == "managed" else DEFAULTS.get(workflow)
    model = OPENROUTER_MODEL_ALIASES.get(model, model)
    if not is_managed_model_id(model):
        raise ValueError("AI 모델을 선택해 주세요.")
    return {"mode": "managed", "model_id": model, "policy_revision": revision(config), "policy_source": "client"}


def review_policy(config, selection):
    models = list(REVIEW_MODELS)
    selected = selection.get("modelId") if selection.get("mode") == "managed" else None
    if selected:
        if not is_managed_model_id(selected):
            raise ValueError("문제 검수 모델을 선택해 주세요.")
        if selected in models:
            models = [selected, *(model for model in models if model != selected)]
        elif "problem_review" in (config.get("ai_model_selection", {}).get("features") or {}):
            raise ValueError("선택한 모델이 로컬 문제 검수 계획에 없습니다.")
    plan = [{"role": role, "model_id": model} for role, model in zip(("primary", "secondary", "fallback"), models)]
    return {"policy_revision": revision(config), "policy_source": "client", "review_plan": plan,
            "confidence_threshold": 0.95, "primary_model": models[0], "secondary_model": models[1],
            "fallback_model": models[2]}
