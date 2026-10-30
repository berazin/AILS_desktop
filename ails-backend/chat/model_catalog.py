"""Client-fetched public chatbot metadata. No AI sessions or paid probes."""

from collections.abc import Mapping
from chat.latency_spans import measured, span

from ai_model_selection import is_managed_model_id


@measured("catalog")
def chatbot_model_catalog(state, *, validate_id=None, require_tools=False, require_vision=False):
    from client_ai_catalog import catalog
    with span("capabilities"):
        capabilities = state._managed_auth_request("/ai/capabilities")
    result = catalog(capabilities.get("routing_platform"))
    if not isinstance(result, Mapping) or result.get("platform") not in {"vercel", "openrouter"}:
        raise ValueError("AILS 모델 목록 응답이 올바르지 않습니다.")
    models = result.get("models")
    if not isinstance(models, list):
        raise ValueError("AILS 모델 목록 응답이 올바르지 않습니다.")
    fields = {
        "id", "name", "developer", "aliases", "type", "input_modalities", "output_modalities",
        "context_length", "max_output_tokens", "tools", "streaming", "vision", "reasoning",
        "supported_parameters", "input_price", "output_price", "reservation_input_price", "reservation_output_price", "estimated_request_cost", "expires_at",
        "available", "experimental", "privacy", "recommended", "recommendation_basis",
        "verification_needed", "evaluation",
    }
    return {
        "platform": result["platform"],
        "unavailable_reason": result.get("unavailable_reason"),
        "models": [{key: value for key, value in model.items() if key in fields}
                   for model in models if isinstance(model, Mapping) and is_managed_model_id(model.get("id"))],
        **{key: result.get(key) for key in ("fetched_at", "stale", "expires_at", "default_model_id", "default_reasoning", "estimate_tokens")},
    }


def validate_chatbot_choice(catalog, selection, effort="default", *, require_tools=False, require_vision=False):
    """Validate explicit choices before preparation; provider guardrails separately enforce the allowed model scope."""
    if catalog.get("unavailable_reason") == "vercel_on_hold":
        raise ValueError("Vercel은 현재 보류 중입니다. 이 개발 채널에서는 로컬 AI를 사용해 주세요.")
    model_id = selection.get("modelId") if selection.get("mode") == "managed" else catalog.get("default_model_id")
    model = next((item for item in catalog["models"] if item["id"] == model_id or model_id in item.get("aliases", [])), None)
    if not model or not model.get("available"):
        raise ValueError("선택한 모델을 현재 환경에서 사용할 수 없습니다. 다른 모델을 직접 선택해 주세요.")
    if require_tools and model.get("tools") is not True:
        raise ValueError("이 작업에는 도구 호출을 지원하는 모델이 필요합니다.")
    if require_vision and model.get("vision") is not True:
        raise ValueError("이 작업에는 이미지 입력을 지원하는 모델이 필요합니다.")
    if effort not in {None, "default"} and effort not in model.get("reasoning", {}).get("values", []):
        raise ValueError("선택한 모델에서 지원하는 추론 수준을 선택해 주세요.")
    return model
