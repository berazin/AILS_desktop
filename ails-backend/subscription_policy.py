"""Edition boundary that never imports subscription code or reads credentials."""
from collections.abc import Mapping
import edition_manifest

MESSAGE = "이 배포판에서는 Codex/ChatGPT 구독 연결을 사용할 수 없습니다. AI 모델 설정에서 로컬 모델 또는 AILS 서버 모델을 직접 선택해 주세요."


def enabled():
    return edition_manifest.EDITION_MANIFEST["id"] in {"developer", "personal"}


def require_subscription():
    if not enabled():
        error = edition_manifest.EditionFeatureDisabled("chatgpt_subscription", edition_manifest.EDITION_MANIFEST["id"])
        error.args = (MESSAGE,)
        raise error


def require_selection(selection):
    if not isinstance(selection, Mapping):
        return
    mode = str(selection.get("mode", "")).casefold()
    provider = str(selection.get("provider", "")).casefold()
    model = str(selection.get("modelId", "")).casefold()
    # Transport identifiers, not model brands: openai/* remains a server model.
    if mode in {"chatgpt", "codex"} or provider in {"chatgpt", "codex"} or model.startswith(("chatgpt:", "codex:", "chatgpt-plan:")):
        require_subscription()


def validate_subscription_settings(config):
    """Validate new settings before any persistence or credential processing."""
    if enabled():
        return
    providers = config.get("ai_provider_settings") or {}
    if isinstance(providers, Mapping):
        choices = [providers.get("default"), *(providers.get("features") or {}).values()]
        if any(str(value).casefold() in {"codex", "chatgpt"} for value in choices):
            require_subscription()
    models = config.get("ai_model_selection") or {}
    if isinstance(models, Mapping):
        require_selection(models.get("default"))
        for selection in (models.get("features") or {}).values():
            require_selection(selection)
