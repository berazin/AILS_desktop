"""ModelService: feature operations and owned state."""
from __future__ import annotations
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
import ai_model_selection
import edition_manifest
from edition_manifest import feature_enabled
from ai_model_selection import (
    VERIFICATION_MANAGED_MODELS,
    VISION_MANAGED_MODELS,
    migrate_legacy_model_selection,
    normalize_model_settings,
    preview_model_selections,
    resolve_model_selection,
)
_support_name = "settings.model_support"
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class ModelServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    _managed_auth_request: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]

class ModelService:
    def __init__(self, ports: ModelServicePorts):
        self._ports = ports
        self._managed_auth_request = ports._managed_auth_request

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def preview_ai_model_selections(self, payload: dict):
        settings = payload.get("settings")
        if not isinstance(settings, Mapping):
            settings = {}
        import personal_mode
        if personal_mode.enabled():
            return personal_mode.preview(self.config, payload, settings)
        workflow_defaults = payload.get("workflow_defaults")
        preview = preview_model_selections(
            settings,
            workflow_defaults if isinstance(workflow_defaults, Mapping) else {},
            allow_byok=edition_manifest.LOCAL_AI_SETTINGS_ENABLED,
        )
        from subscription_policy import enabled, MESSAGE
        if not enabled():
            from ai_provider_settings import provider_for
            provider_config = {"ai_provider_settings": payload.get("provider_settings", getattr(self, "config", {}).get("ai_provider_settings"))}
            for workflow, route in preview.items():
                try:
                    provider_for(provider_config, workflow)
                except PermissionError:
                    preview[workflow] = {"mode": "error", "source": route["source"], "error": MESSAGE}
            return {"workflows": preview, "chatgpt_models": [], "chatgpt_error": ""}
        from chatgpt_subscription.model_routing import connected_models, subscription_selection, account_model_id
        from chatgpt_subscription.protocol import ChatGPTError
        from ai_provider_settings import provider_for, normalize_provider_settings
        models, error = [], ""
        if edition_manifest.LOCAL_AI_SETTINGS_ENABLED:
            try:
                models = connected_models()
            except ChatGPTError as failure:
                error = str(failure)
        normalized = normalize_model_settings(settings)
        provider_config = {"ai_provider_settings": payload.get("provider_settings", getattr(self, "config", {}).get("ai_provider_settings"))}
        for workflow, route in preview.items():
            requested = normalized["features"].get(workflow, normalized["default"])
            from settings.development_mode import enabled as local_development
            if local_development() and requested["mode"] == "local":
                continue
            explicit_ails = workflow == "chatbot" and normalize_provider_settings(provider_config["ai_provider_settings"])["features"].get(workflow) == "ails"
            selected = None if explicit_ails else subscription_selection(requested, workflow,
                enabled=edition_manifest.LOCAL_AI_SETTINGS_ENABLED, models=models)
            if not selected and provider_for(provider_config, workflow) == "chatgpt":
                selected = {"mode": "chatgpt", "modelId": normalize_provider_settings(
                    provider_config["ai_provider_settings"])["chatgpt_model"] or (models[0]["id"] if models else "")}
            if error and (selected or (account_model_id(requested) and workflow != "problem_review")):
                preview[workflow] = {"mode": "error", "source": route["source"], "error": error}
            elif selected:
                preview[workflow] = {"mode": "chatgpt", "model_id": selected["modelId"],
                    "source": "workflow" if workflow in normalized["features"] else "common",
                    "billing_mode": "chatgpt", "fallback_reason": None}
        return {"workflows": preview, "chatgpt_models": models, "chatgpt_error": error}

    def model_options(self, config_override=None):
        import personal_mode
        if personal_mode.enabled():
            return {"models": {}, "errors": {}, "chatbot_agent_models": [dict(model, available=True) for model in ai_model_selection.CHATBOT_LOCAL_AGENT_MODELS], "chatbot_expert_models": [], "chatbot_expert_auto_model_id": ""}
        return {
            "models": {},
            "errors": {},
            "chatbot_agent_models": [
                dict(model, available=True)
                for model in (
                    ai_model_selection.CHATBOT_AGENT_MODELS
                    if edition_manifest.LOCAL_AI_SETTINGS_ENABLED
                    else ai_model_selection.CHATBOT_CLOUD_AGENT_MODELS
                )
            ],
            "chatbot_expert_models": [
                dict(model, available=True) for model in ai_model_selection.CHATBOT_EXPERT_MODELS
            ] if edition_manifest.LOCAL_AI_SETTINGS_ENABLED else [],
            "chatbot_expert_auto_model_id": ai_model_selection.CHATBOT_EXPERT_DEFAULT_MODEL,
        }

    def chatbot_model_catalog(self):
        from personal_mode import require_server_enabled
        require_server_enabled()
        from chat.model_catalog import chatbot_model_catalog
        return chatbot_model_catalog(self)

    def validate_chatbot_model(self, payload):
        from chat.model_catalog import chatbot_model_catalog, validate_chatbot_choice
        catalog = chatbot_model_catalog(self, validate_id=payload.get("model_id"), require_tools=payload.get("require_tools") is True,
            require_vision=payload.get("require_vision") is True)
        model = validate_chatbot_choice(catalog, {"mode": "managed", "modelId": payload.get("model_id")},
            payload.get("reasoning_effort", "default"), require_tools=payload.get("require_tools") is True,
            require_vision=payload.get("require_vision") is True)
        return {"valid": True, "model_id": model["id"]}

    def test_model_connection(self, payload: dict):
        raise ValueError("Personal API key connections are no longer supported.")

    def selected_ai_model(self, workflow: str) -> dict:
        if workflow == "insight_book":
            from edition_manifest import require_feature
            require_feature("insight_book")
        import personal_mode
        if personal_mode.enabled():
            return personal_mode.selection(self.config, workflow)
        from ai_provider_settings import provider_for, normalize_provider_settings
        settings = self.config.get("ai_model_selection")
        if settings is None:
            settings = migrate_legacy_model_selection(
                self.config, allow_byok=edition_manifest.LOCAL_AI_SETTINGS_ENABLED,
            )
        from subscription_policy import enabled
        if not enabled():
            provider_for(self.config, workflow)
            return resolve_model_selection(settings, workflow, allow_byok=edition_manifest.LOCAL_AI_SETTINGS_ENABLED)
        normalized = normalize_model_settings(settings)
        from settings.development_mode import enabled as local_development
        if local_development() and normalized["features"].get(workflow, normalized["default"])["mode"] == "local":
            return resolve_model_selection(settings, workflow, allow_byok=edition_manifest.LOCAL_AI_SETTINGS_ENABLED)
        from chatgpt_subscription.model_routing import subscription_selection
        explicit_ails = (workflow == "chatbot" and normalize_provider_settings(
            self.config.get("ai_provider_settings"))["features"].get(workflow) == "ails")
        selected = None if explicit_ails else subscription_selection(normalized["features"].get(workflow, normalized["default"]),
            workflow, enabled=edition_manifest.LOCAL_AI_SETTINGS_ENABLED)
        if selected:
            return selected
        if provider_for(self.config, workflow) == "chatgpt":
            from chatgpt_subscription.model_routing import default_selection
            return default_selection(normalize_provider_settings(
                self.config.get("ai_provider_settings"))["chatgpt_model"])
        return resolve_model_selection(
            settings, workflow,
            allow_byok=edition_manifest.LOCAL_AI_SETTINGS_ENABLED,
        )

    def workflow_uses_managed_ai(self, workflow: str) -> bool:
        # Legacy name: chooses the account-backed branch over Developer BYOK.
        # Credit checks must inspect the selected mode; ChatGPT never uses AILS credits.
        return self.selected_ai_model(workflow)["mode"] != "local"

    def local_provider_model(self, workflow: str) -> tuple[str, str]:
        if not edition_manifest.LOCAL_AI_SETTINGS_ENABLED:
            raise RuntimeError("개인 API 키 모델은 개발판에서만 사용할 수 있습니다.")
        selection = self.selected_ai_model(workflow)
        if selection["mode"] != "local":
            raise ValueError(f"{workflow} does not use a personal model.")
        return selection["provider"], selection["modelId"]

    def managed_workflow_model(self, workflow: str) -> str | None:
        selection = self.selected_ai_model(workflow)
        if selection["mode"] != "managed":
            return None
        selected = str(selection["modelId"])
        canonical = ai_model_selection.OPENROUTER_MODEL_ALIASES.get(selected, selected)
        if not ai_model_selection.is_managed_model_id(canonical):
            raise ValueError(f"선택한 관리형 AI 모델({selected})을 사용할 수 없습니다.")
        return canonical

    def managed_workflow_options(self, workflow: str) -> dict:
        model = self.managed_workflow_model(workflow)
        if model:
            return {"model_id": model}
        return {}

    def managed_cloud_model_catalog(self) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        import client_ai_policy
        capabilities = self._managed_auth_request("/ai/capabilities")
        routing_platform = capabilities.get("routing_platform")
        provider_status = capabilities.get("provider_status")
        if routing_platform not in {"openrouter", "vercel"}:
            raise ValueError("AI 연결 채널을 확인할 수 없습니다.")
        review_models = list(client_ai_policy.REVIEW_MODELS)
        local_defaults = dict(client_ai_policy.DEFAULTS)
        model_capabilities = {}

        models = []
        for m in ai_model_selection.MANAGED_MODEL_CATALOG:
            model_id = m["openrouter_id"] if routing_platform == "openrouter" else m["id"]
            capabilities = model_capabilities.get(m["id"])
            if not isinstance(capabilities, list):
                capabilities = [
                    "text", *(["vision"] if m["id"] in VISION_MANAGED_MODELS else []),
                    *(["structured_output"] if m["id"] in VERIFICATION_MANAGED_MODELS else []),
                ]
            # Existing models still pass the same local workflow capability
            # gates at selection time. Do not advertise a server capability
            # that that gate rejects; provider allowlists remain a separate budget boundary.
            if m["id"] in ai_model_selection.MANAGED_AI_MODELS:
                capabilities = [capability for capability in capabilities
                                if (capability != "vision" or m["id"] in VISION_MANAGED_MODELS)
                                and (capability != "structured_output"
                                     or m["id"] in VERIFICATION_MANAGED_MODELS)]
            models.append({
                "id": model_id,
                "canonical_id": m["id"],
                "name": m["name"],
                "provider": m["provider"],
                "input_price": m["input_price"],
                "output_price": m["output_price"],
                "input_rate_usd_per_1m": m["input_price"],
                "output_rate_usd_per_1m": m["output_price"],
                "routing_platform": routing_platform,
                "capabilities": capabilities,
            })

        workflows = []
        workflow_defaults = {}
        for wf_id, meta in ai_model_selection.MANAGED_WORKFLOW_LABELS.items():
            if wf_id == "insight_book" and not feature_enabled("insight_book"):
                continue
            raw_default = local_defaults.get(wf_id, "")
            default_model = (
                ai_model_selection.VERCEL_TO_OPENROUTER_ALIASES.get(raw_default, raw_default)
                if routing_platform == "openrouter"
                else raw_default
            )
            workflow_defaults[wf_id] = default_model
            workflows.append({
                "id": wf_id,
                "label": meta["label"],
                "description": meta["description"],
                "default_model": default_model,
                "user_model": self.managed_workflow_model(wf_id) or "",
            })

        return {
            "routing_platform": routing_platform,
            "provider_status": provider_status,
            "models": [] if provider_status == "on_hold" else models,
            "review_models": review_models,
            "ails_default_model": local_defaults.get("chatbot", ""),
            "workflows": workflows,
            "workflow_defaults": workflow_defaults,
            "server_defaults": {},
            "policy_source": "client",
        }

    @staticmethod
    def call_managed_gateway_chat(session: Mapping, messages: list[dict], **kwargs):
        if session.get("transport") == "chatgpt":
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription import runtime
            return runtime.call(session["token"], session["model_id"], messages, **kwargs)
        # Keep the HTTP response alive during long reasoning while retaining
        # the caller's text/full-assistant-message return contract.
        kwargs.setdefault("stream", True)
        kwargs.setdefault("retry_ambiguous_errors", False)
        def send(active_session):
            import pipeline_utils
            endpoint = str(active_session.get("gateway_url") or ai_model_selection.MANAGED_GATEWAY_CHAT_ENDPOINT)
            options = dict(kwargs)
            if active_session.get("_chatbot_budget") is not None:
                options["request_options"] = {
                    **(options.get("request_options") or {}),
                    "ails_request_budget_microusd": active_session["_chatbot_budget"].budget(messages, options.get("request_options")),
                }
            elif active_session.get("_stage_pool") is not None and active_session.get("transport") != "vercel_developer_direct":
                from summary_generation.managed_sessions import request_budget_microusd
                options["request_options"] = {
                    **(options.get("request_options") or {}),
                    "ails_request_budget_microusd": request_budget_microusd(active_session, messages),
                }
            return pipeline_utils.call_openai_compatible_chat(
                endpoint, str(active_session["token"]), str(active_session["model_id"]), messages,
                provider_label="AILS managed AI gateway", **options,
            )
        pool = session.get("_stage_pool")
        answer, usage = pool.call(session, send) if pool is not None else send(session)
        if isinstance(usage, dict):
            usage = {**usage, "billing_mode": "managed"}
        return answer, usage
