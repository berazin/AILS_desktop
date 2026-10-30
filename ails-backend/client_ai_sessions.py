"""Account authorization/credential lease, separate from local task selection."""
from chat.latency_spans import span
import math
import uuid
import client_ai_policy
import provider_credentials
import openrouter_web_search


def acquire(state, workflow, estimate, *, model_id=None, policy_revision=None, reasoning_effort=None, purpose=None):
    from personal_mode import require_server_enabled
    require_server_enabled()
    if purpose:
        # The former OpenAI server-key web-search endpoint is not a direct
        # OpenRouter tool contract. Never silently route it through the Worker.
        raise ValueError("이 공급자의 직접 웹 검색 연결은 아직 지원되지 않습니다.")
    from ai_compliance import require_external_provider_consent, compliance_metadata
    import edition_manifest
    require_external_provider_consent("OpenRouter", state.config, compliance_metadata(edition_manifest.EDITION_MANIFEST))
    state._ensure_managed_auth_state()
    with state.managed_auth_lock:
        if state.managed_browser_auth:
            raise ValueError("로그인을 완료하거나 취소한 뒤 AI 작업을 시작해 주세요.")
    revision = client_ai_policy.revision(state.config)
    if policy_revision is not None and policy_revision != revision:
        raise ValueError("로컬 AI 설정이 변경되었습니다. 작업을 다시 준비해 주세요.")
    identity = client_ai_policy.identity(state.config, workflow, state.selected_ai_model(workflow))
    selected = model_id or identity["model_id"]
    models = [selected]
    policy = {}
    if workflow == "problem_review":
        policy = state.managed_problem_review_policy()
        models = [item["model_id"] for item in policy["review_plan"]]
        selected = models[0]
    web_search = openrouter_web_search.settings(state.config)
    openrouter_web_search.validate(web_search, models, zdr=state.config.get("chatbot_zdr_enabled") is True)
    value = float(estimate)
    if not math.isfinite(value) or value <= 0:
        raise ValueError("AI 예상 비용이 올바르지 않습니다.")
    with span("capabilities"):
        capabilities = state._managed_auth_request("/ai/capabilities")
    if capabilities.get("protocol") != "client-ai-v1" or not capabilities.get("direct_available"):
        raise ValueError("현재 배포 채널의 임시 AI 자격증명 발급을 사용할 수 없습니다. "
                         + str(capabilities.get("reason") or "서버 발급 설정을 확인해 주세요."))
    _url, _email, device_id = state._managed_auth_profile()
    request_id = uuid.uuid4().hex
    try:
        with span("lease_issue"):
            result = state._managed_auth_request("/ai/leases", method="POST", payload={
                "device_id": device_id, "request_id": request_id, "budget_microusd": max(1, math.ceil(value * 1_000_000)),
            })
    except Exception:
        # Recover by the durable request ID, never replay a possibly successful
        # issuance. DELETE can cancel an in-flight issuer via its state CAS.
        try:
            state._managed_auth_request("/ai/leases/" + request_id, method="DELETE")
        except Exception:
            pass  # Server expiry/reconciliation keeps the unknown monetary hold.
        raise
    try:
        session = provider_credentials.register(result, models, reasoning=reasoning_effort, web_search=web_search)
    except Exception:
        # No inference has run. Ask the issuer to revoke, without logging its response.
        lease_id = result.get("lease_id") if isinstance(result, dict) else None
        if isinstance(lease_id, str) and all(c.isalnum() or c in "-_" for c in lease_id):
            try:
                state._managed_auth_request("/ai/leases/" + lease_id, method="DELETE")
            except Exception:
                pass
        raise
    return {**session, **policy, "allowed_models": models, "model_id": selected,
            "policy_revision": revision, "policy_source": "client",
            "max_cost": result["limit_microusd"] / 1_000_000,
            "session_cost_limit_microusd": result["limit_microusd"],
            **({"reasoning_config": {"model_id": selected, "value": reasoning_effort}} if reasoning_effort else {})}
