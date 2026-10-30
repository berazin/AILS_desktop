"""Personal deployment policy; never mutates saved preferences or credentials."""

def enabled():
    import edition_manifest
    return edition_manifest.EDITION_MANIFEST["id"] == "personal"


def require_server_enabled():
    if enabled():
        raise PermissionError("개인용 모드에서는 AILS 서버와 유료 API 공급자를 사용하지 않습니다.")


def selection(config, workflow):
    from ai_model_selection import normalize_model_settings, resolve_model_selection
    if workflow == "problem_review":
        raise ValueError("PDF 자동 다중 모델 검수는 개인용에서 지원하지 않습니다. 로컬 OCR·문제 감지와 ChatGPT 문제 풀이를 사용해 주세요.")
    normalized = normalize_model_settings(config.get("ai_model_selection"))
    requested = normalized["features"].get(workflow, normalized["default"])
    if requested["mode"] == "local" and workflow == "chatbot":
        return resolve_model_selection(normalized, workflow, allow_byok=True)
    # Retain explicit subscription models; stale paid selections never execute.
    model = str((config.get("ai_provider_settings") or {}).get("chatgpt_model") or "")
    if requested["mode"] in {"chatgpt", "codex"}:
        model = requested.get("modelId", "")
    elif requested["mode"] == "managed" and requested.get("modelId", "").startswith("openai/"):
        model = requested["modelId"][len("openai/"):]
    return {"mode": "chatgpt", "modelId": model}


def preview(config, payload, settings):
    from ai_model_selection import MANAGED_WORKFLOWS
    from chatgpt_subscription.model_routing import connected_models
    from chatgpt_subscription.protocol import ChatGPTError
    effective = {**config, "ai_model_selection": settings,
                 "ai_provider_settings": payload.get("provider_settings", config.get("ai_provider_settings"))}
    models, error = [], ""
    try:
        models = connected_models()
    except ChatGPTError as failure:
        error = str(failure)
    workflows = {}
    for workflow in MANAGED_WORKFLOWS:
        if workflow == "insight_book":
            continue
        try:
            route = selection(effective, workflow)
            workflows[workflow] = {"mode": route["mode"], "model_id": route.get("modelId", ""),
                "provider": route.get("provider"), "source": "common", "billing_mode": "chatgpt" if route["mode"] == "chatgpt" else "local"}
        except ValueError as failure:
            workflows[workflow] = {"mode": "error", "source": "common", "error": str(failure)}
    return {"workflows": workflows, "chatgpt_models": models, "chatgpt_error": error}


def require_local_transport(endpoint):
    if not enabled():
        return
    from urllib.parse import urlsplit
    parsed = urlsplit(str(endpoint))
    if (parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username or parsed.password):
        raise PermissionError("개인용 AI는 ChatGPT 연결 또는 로컬 모델만 사용할 수 있습니다.")
