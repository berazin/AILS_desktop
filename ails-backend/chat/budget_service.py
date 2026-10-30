"""Connect authenticated metadata and token counts to client chatbot budgets."""
from chat.model_catalog import chatbot_model_catalog, validate_chatbot_choice
from chat.managed_budget import ChatbotBudget
from ai_compliance import compliance_metadata, require_external_provider_consent
import edition_manifest


def prepare_chatbot_budget(state, messages, options=None, *, model_id=None, effort=None, timing_callback=None):
    catalog = chatbot_model_catalog(state)
    require_external_provider_consent("Vercel AI Gateway" if catalog["platform"] == "vercel" else "OpenRouter",
                                      state.config, compliance_metadata(edition_manifest.EDITION_MANIFEST))
    selection = {"mode": "managed", "modelId": model_id} if model_id else {"mode": "ails"}
    model = validate_chatbot_choice(catalog, selection, effort,
                                   require_tools=bool((options or {}).get("tools")))
    default_reasoning = catalog.get("default_reasoning") or {}
    if (effort is None and default_reasoning.get("model_id") == model["id"]
            and default_reasoning.get("platform") == catalog["platform"]
            and default_reasoning.get("value") != "model_default"):
        effort = default_reasoning.get("value")
    calculator = ChatbotBudget(state._managed_auth_request, model, effort=effort, timing_callback=timing_callback,
                              zdr_enabled=state.config.get("chatbot_zdr_enabled") is True)
    amount = calculator.budget(messages, options)
    return calculator, amount / 1_000_000
