"""Compatibility exports. Implementation belongs to accounts.auth_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("accounts.auth_service"), name)

from bootstrap.service_adapter import service_call as _service_call
import ai_model_selection


class ManagedAuthMixin:
    """Stable API methods delegating to the auth service."""
    def _managed_auth_profile(self, payload: Mapping | None=None) -> tuple[str, str, str]:
        return _service_call(self, "auth", '_managed_auth_profile', payload)

    def _require_no_active_managed_sessions(self) -> None:
        return _service_call(self, "auth", '_require_no_active_managed_sessions')

    def _save_managed_auth_profile(self, server_url: str, email: str, device_id: str) -> None:
        return _service_call(self, "auth", '_save_managed_auth_profile', server_url, email, device_id)

    @staticmethod
    def _register_managed_device(server_url: str, access_token: str, device_id: str) -> None:
        return _import_module("accounts.auth_service").ManagedAuthService._register_managed_device(server_url, access_token, device_id)

    @staticmethod
    def _managed_auth_tokens(result: Mapping, *, require_tokens: bool=True) -> dict[str, str]:
        return _import_module("accounts.auth_service").ManagedAuthService._managed_auth_tokens(result, require_tokens=require_tokens)

    @classmethod
    def _save_managed_auth_tokens(cls, result: Mapping, *, require_tokens: bool=True) -> dict[str, str]:
        return _import_module("accounts.auth_service").ManagedAuthService._save_managed_auth_tokens(result, require_tokens=require_tokens)

    def _refresh_managed_auth(self, server_url: str, refresh_token: str) -> dict[str, str]:
        return _service_call(self, "auth", '_refresh_managed_auth', server_url, refresh_token)

    def _managed_auth_request(self, path: str, *, method: str='GET', payload: Mapping | None=None, retry_auth: bool=True) -> dict:
        return _service_call(self, "auth", '_managed_auth_request', path, method=method, payload=payload, retry_auth=retry_auth)

    def managed_auth_register(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_register', payload)

    def managed_auth_start_signup_email(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_start_signup_email', payload)

    def managed_auth_verify_signup_email(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_verify_signup_email', payload)

    def managed_auth_resend_verification(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_resend_verification', payload)

    def managed_auth_request_password_reset(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_request_password_reset', payload)

    def managed_auth_request_id_recovery(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_request_id_recovery', payload)

    def managed_auth_plans(self) -> dict:
        return _service_call(self, "auth", 'managed_auth_plans')

    def managed_auth_checkout(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_checkout', payload)

    def managed_auth_credit_payment_status(self) -> dict:
        return _service_call(self, "auth", 'managed_auth_credit_payment_status')

    def managed_auth_set_secondary_pin(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_set_secondary_pin', payload)

    def managed_auth_start_account_registration(self) -> dict:
        return _service_call(self, "auth", 'managed_auth_start_account_registration')

    def managed_auth_charge_registered_account(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_charge_registered_account', payload)

    def managed_auth_select_plan(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_select_plan', payload)

    def submit_feedback(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'submit_feedback', payload)

    def managed_auth_login(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_login', payload)

    def managed_auth_logout(self) -> dict:
        return _service_call(self, "auth", 'managed_auth_logout')

    def managed_auth_browser_start(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_browser_start', payload)

    def managed_auth_browser_cancel(self, payload: Mapping) -> dict:
        return _service_call(self, "auth", 'managed_auth_browser_cancel', payload)

    def managed_auth_browser_poll(self) -> dict:
        return _service_call(self, "auth", 'managed_auth_browser_poll')

    def _rollback_cancelled_browser_auth(self, pending: Mapping) -> None:
        return _service_call(self, "auth", '_rollback_cancelled_browser_auth', pending)

    def managed_auth_status(self, *, validate_remote: bool=True) -> dict:
        return _service_call(self, "auth", 'managed_auth_status', validate_remote=validate_remote)

    def _has_usable_managed_credits(self, auth_status: Mapping | None=None) -> bool:
        return _service_call(self, "auth", '_has_usable_managed_credits', auth_status)

    def _ensure_managed_auth_state(self) -> None:
        return _service_call(self, "auth", '_ensure_managed_auth_state')

    def acquire_managed_ai_session(self, estimated_cost_usd: float, *, policy_revision: int | None=None) -> dict:
        return _service_call(self, "auth", 'acquire_managed_ai_session', estimated_cost_usd, policy_revision=policy_revision)

    def get_managed_ai_session_result(self, session_id: str) -> dict:
        return _service_call(self, "auth", 'get_managed_ai_session_result', session_id)

    def finish_managed_ai_session(self, session_id: str) -> dict | None:
        return _service_call(self, "auth", 'finish_managed_ai_session', session_id)

    def _remember_managed_session_auth_context(self, session_id: str) -> None:
        return _service_call(self, "auth", '_remember_managed_session_auth_context', session_id)

    def acquire_managed_ai_action_session(self, workflow: str, estimated_cost_usd: float=ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD, *, policy_revision: int | None=None, model_id: str | None=None, purpose: str | None=None, reasoning_effort: str | None=None) -> dict:
        return _service_call(self, "auth", 'acquire_managed_ai_action_session', workflow, estimated_cost_usd, policy_revision=policy_revision, model_id=model_id, purpose=purpose, reasoning_effort=reasoning_effort)

    def managed_ai_action(self, workflow: str, estimated_cost_usd: float=ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD, *, policy_revision: int | None=None, model_id: str | None=None, purpose: str | None=None, reasoning_effort: str | None=None, request_messages: list[dict] | None=None, request_options: dict | None=None, request_timing_callback=None):
        return _service_call(self, "auth", 'managed_ai_action', workflow, estimated_cost_usd, policy_revision=policy_revision, model_id=model_id, purpose=purpose, reasoning_effort=reasoning_effort, request_messages=request_messages, request_options=request_options, request_timing_callback=request_timing_callback)
