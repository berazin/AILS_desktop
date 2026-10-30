from __future__ import annotations

import re
from ipaddress import ip_address
from datetime import datetime, timezone
from typing import Any, Mapping
from urllib.parse import urlparse


AI_CONSENT_VERSION = 1
AI_CONSENT_STATUSES = frozenset({"unset", "granted", "declined", "withdrawn"})
AI_CONSENT_REQUIRED_CODE = "AI_CONSENT_REQUIRED"

COMPLIANCE_URL_FIELDS = (
    "privacy_policy_url",
    "terms_of_use_url",
    "ai_disclosure_url",
    "data_deletion_url",
)

EXTERNAL_PROVIDER_DISCLOSURES = (
    {
        "id": "vercel-ai-gateway",
        "name": "Vercel AI Gateway",
        "data": ["prompts", "PDF page images", "OCR problem candidates", "음성 명령 텍스트와 현재 화면 맥락"],
        "privacy_url": "https://vercel.com/legal/privacy-policy",
    },
    {
        "id": "google",
        "name": "Google Gemini",
        "data": ["프롬프트", "PDF 페이지 이미지", "오디오", "답안", "코드"],
        "privacy_url": "https://policies.google.com/privacy",
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "data": ["프롬프트", "문서 텍스트", "답안", "코드"],
        "privacy_url": "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html",
    },
    {
        "id": "cloudflare",
        "name": "Cloudflare AI Gateway",
        "data": ["중계되는 DeepSeek 요청·응답", "요청 메타데이터"],
        "privacy_url": "https://www.cloudflare.com/privacypolicy/",
    },

)

_LOCAL_PROVIDER_NAMES = frozenset(
    {
        "",
        "disabled",
        "사용 안 함",
        "none",
        "lm studio",
        "llama.cpp",
        "openvino whisper",
        "faster-whisper",
        "whisper.cpp vulkan",
        "local (openvino)",
        "local (faster-whisper)",
        "local (whisper.cpp vulkan)",
        "local (directml)",
        "local",
    }
)

_LMSTUDIO_ENDPOINT_KEYS = (
    "lmstudio_base_url",
    "custom_summary_endpoint",
    "custom_image_endpoint",
    "custom_stt_endpoint",
)

_ALWAYS_EXTERNAL_PATHS = frozenset({"/api/pdf/translate/stream"})
_PATH_MODEL_WORKFLOWS = {
    "/api/chatbot": "chatbot",
    "/api/chatbot/stream": "chatbot",
    "/api/material-practice/generate": "practice_generation",
    "/api/code/review": "code_assist",
    "/api/code/review/stream": "code_assist",
    "/api/code/prompt-edit": "code_assist",
    "/api/pdf/problems/review": "grading",
    "/api/pdf/problems/multimodal-review": "problem_review",
    "/api/pdf/problems/multimodal-review/auto/start": "problem_review",
    "/api/pdf/problems/hint/generate": "grading",
    "/api/pdf/problems/grade": "grading",
    "/api/pdf/problems/grade-batch": "grading",
    "/api/voice/agent/stream": "voice_agent",
    "/api/voice/agent/warmup": "voice_agent",
}
_PATH_PROVIDER_KEYS: dict[str, tuple[str, ...]] = {
    "/api/chatbot": ("chatbot_provider",),
    "/api/chatbot/stream": ("chatbot_provider",),
    "/api/material-practice/generate": ("quiz_provider",),
    "/api/code/review": ("chatbot_provider",),
    "/api/code/review/stream": ("chatbot_provider",),
    "/api/code/prompt-edit": ("chatbot_provider",),
    "/api/pdf/problems/review": ("grading_provider",),
    "/api/pdf/problems/multimodal-review": ("problem_review_provider",),
    "/api/pdf/problems/multimodal-review/auto/start": ("problem_review_provider",),
    "/api/pdf/problems/hint/generate": ("grading_provider",),
    "/api/pdf/problems/grade": ("grading_provider",),
    "/api/pdf/problems/grade-batch": ("grading_provider",),
    "/api/voice/agent/stream": ("voice_agent_provider",),
    "/api/voice/agent/warmup": ("voice_agent_provider",),
}
_TASK_PROVIDER_KEYS = (
    "summary_provider",
    "image_provider",
    "image_secondary_provider",
    "stt_provider",
)
_TASK_CREATION_PATHS = frozenset(
    {
        "/api/tasks/url",
        "/api/tasks/youtube",
        "/api/tasks/eclass-vod",
        "/api/tasks/lms-scan",
        "/api/tasks/audio",
        "/api/tasks/video-detailed",
        "/api/tasks/video-summary",
        "/api/retry-all",
    }
)


class AIConsentRequired(PermissionError):
    code = AI_CONSENT_REQUIRED_CODE

    def __init__(self) -> None:
        super().__init__(
            "외부 AI로 데이터를 보내기 전에 개인정보·AI 고지에 동의해야 합니다. "
            "설정 > 개인정보·AI에서 내용을 확인하고 동의해 주세요."
        )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def compliance_metadata(manifest: Mapping[str, Any]) -> dict[str, Any]:
    value = manifest.get("compliance")
    return dict(value) if isinstance(value, Mapping) else {}


def validate_compliance_metadata(metadata: Mapping[str, Any], edition: str) -> None:
    if not isinstance(metadata, Mapping):
        raise ValueError(f"Edition '{edition}' must define compliance metadata.")
    if not isinstance(metadata.get("policy_version"), str) or not metadata.get("policy_version", "").strip():
        raise ValueError(f"Edition '{edition}' must define compliance.policy_version.")
    if metadata.get("consent_version") != AI_CONSENT_VERSION:
        raise ValueError(
            f"Edition '{edition}' must use compliance.consent_version={AI_CONSENT_VERSION}."
        )
    for field in (*COMPLIANCE_URL_FIELDS, "support_email"):
        if not isinstance(metadata.get(field), str):
            raise ValueError(f"Edition '{edition}' compliance.{field} must be a string.")


def publication_compliance_errors(manifest: Mapping[str, Any]) -> list[str]:
    metadata = compliance_metadata(manifest)
    errors: list[str] = []
    for field in COMPLIANCE_URL_FIELDS:
        value = str(metadata.get(field, "") or "").strip()
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.netloc:
            errors.append(f"compliance.{field} must be a public HTTPS URL")
    support_email = str(metadata.get("support_email", "") or "").strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", support_email):
        errors.append("compliance.support_email must be a valid support email address")
    return errors


def normalize_consent_config(config: dict[str, Any]) -> dict[str, Any]:
    status = str(config.get("ai_consent_status", "unset") or "unset").strip().lower()
    if status not in AI_CONSENT_STATUSES:
        status = "unset"
    config["ai_consent_status"] = status
    try:
        config["ai_consent_version"] = int(config.get("ai_consent_version", 0) or 0)
    except (TypeError, ValueError):
        config["ai_consent_version"] = 0
    for key in ("ai_consent_recorded_at", "ai_consent_withdrawn_at"):
        config[key] = str(config.get(key, "") or "")
    config["ai_consent_policy_version"] = str(
        config.get("ai_consent_policy_version", "") or ""
    )
    return config


def _integer_or_zero(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def consent_is_valid(config: Mapping[str, Any], metadata: Mapping[str, Any]) -> bool:
    policy_version = str(metadata.get("policy_version", "") or "").strip()
    required_version = _integer_or_zero(metadata.get("consent_version"))
    return bool(
        policy_version
        and required_version == AI_CONSENT_VERSION
        and str(config.get("ai_consent_status", "")).strip().lower() == "granted"
        and _integer_or_zero(config.get("ai_consent_version")) == required_version
        and str(config.get("ai_consent_policy_version", "") or "").strip()
        == policy_version
    )


def consent_status(config: Mapping[str, Any], metadata: Mapping[str, Any]) -> dict[str, Any]:
    status = str(config.get("ai_consent_status", "unset") or "unset")
    return {
        "status": status if status in AI_CONSENT_STATUSES else "unset",
        "valid": consent_is_valid(config, metadata),
        "version": _integer_or_zero(config.get("ai_consent_version")),
        "required_version": _integer_or_zero(metadata.get("consent_version")),
        "policy_version": str(config.get("ai_consent_policy_version", "") or ""),
        "required_policy_version": str(metadata.get("policy_version", "") or ""),
        "recorded_at": str(config.get("ai_consent_recorded_at", "") or ""),
        "withdrawn_at": str(config.get("ai_consent_withdrawn_at", "") or ""),
    }


def record_consent_decision(
    config: Mapping[str, Any],
    metadata: Mapping[str, Any],
    action: str,
    acknowledgements: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_action = str(action or "").strip().lower()
    if normalized_action not in {"grant", "decline", "withdraw"}:
        raise ValueError("Unsupported AI consent action.")

    next_config = dict(config)
    now = utc_now_iso()
    if normalized_action == "grant":
        acknowledgements = acknowledgements or {}
        required = (
            "privacy_and_terms",
            "external_ai_processing",
            "cross_border_transfer",
        )
        if not all(acknowledgements.get(key) is True for key in required):
            raise ValueError("All required AI data processing acknowledgements must be accepted.")
        next_config.update(
            {
                "ai_consent_status": "granted",
                "ai_consent_version": int(metadata.get("consent_version", AI_CONSENT_VERSION)),
                "ai_consent_policy_version": str(metadata.get("policy_version", "") or ""),
                "ai_consent_recorded_at": now,
                "ai_consent_withdrawn_at": "",
            }
        )
    elif normalized_action == "decline":
        next_config.update(
            {
                "ai_consent_status": "declined",
                "ai_consent_version": int(metadata.get("consent_version", AI_CONSENT_VERSION)),
                "ai_consent_policy_version": str(metadata.get("policy_version", "") or ""),
                "ai_consent_recorded_at": now,
                "ai_consent_withdrawn_at": "",
            }
        )
    else:
        next_config.update(
            {
                "ai_consent_status": "withdrawn",
                "ai_consent_version": int(metadata.get("consent_version", AI_CONSENT_VERSION)),
                "ai_consent_policy_version": str(metadata.get("policy_version", "") or ""),
                "ai_consent_recorded_at": now,
                "ai_consent_withdrawn_at": now,
            }
        )
    return next_config


def _endpoint_is_loopback(value: Any) -> bool:
    endpoint = str(value or "").strip()
    if not endpoint:
        return True
    try:
        hostname = (urlparse(endpoint).hostname or "").strip().lower()
    except ValueError:
        return False
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return True
    try:
        return ip_address(hostname).is_loopback
    except ValueError:
        return False


def _stt_feature_enabled() -> bool:
    from edition_manifest import feature_enabled

    return bool(
        feature_enabled("summary.audio_pdf")
        or feature_enabled("summary.media_files")
        or feature_enabled("summary.web_inputs")
    )


def provider_is_external(provider: Any, config: Mapping[str, Any] | None = None) -> bool:
    normalized = str(provider or "").strip().lower()
    if normalized in _LOCAL_PROVIDER_NAMES:
        if normalized != "lm studio":
            return False
        endpoint_config = config or {}
        return any(
            not _endpoint_is_loopback(endpoint_config.get(key))
            for key in _LMSTUDIO_ENDPOINT_KEYS
            if key != "custom_stt_endpoint"
            or _stt_feature_enabled()
        )
    if not normalized:
        return False
    return True


def request_uses_external_ai(path: str, config: Mapping[str, Any]) -> bool:
    normalized_path = str(path or "")
    if normalized_path in _ALWAYS_EXTERNAL_PATHS:
        return True
    if config.get("ai_model_selection"):
        from ai_model_selection import resolve_model_selection
        from edition_manifest import load_edition_manifest

        developer = load_edition_manifest().get("id") == "developer"

        def workflow_is_external(workflow: str) -> bool:
            from ai_provider_settings import provider_for
            if provider_for(config, workflow) == "chatgpt":
                return True
            selection = resolve_model_selection(
                config["ai_model_selection"], workflow, allow_byok=developer,
            )
            return selection["mode"] != "local" or provider_is_external(selection["provider"], config)

        workflow = _PATH_MODEL_WORKFLOWS.get(normalized_path)
        if workflow:
            if workflow == "voice_agent" and str(config.get("voice_agent_provider") or "local").casefold() != "cloud":
                return False
            return workflow_is_external(workflow)
        if normalized_path in _TASK_CREATION_PATHS or normalized_path.startswith("/api/retry/"):
            workflows = ["video_stt_cleanup", "video_summary", "video_visual",
                         "image_analysis", "video_verification"]
            return any(workflow_is_external(item) for item in workflows) or any(
                provider_is_external(config.get(key), config)
                for key in ("stt_provider",)
            )
    provider_keys = _PATH_PROVIDER_KEYS.get(normalized_path)
    if provider_keys is None and (
        normalized_path in _TASK_CREATION_PATHS
        or normalized_path.startswith("/api/retry/")
    ):
        provider_keys = _TASK_PROVIDER_KEYS
    if not provider_keys:
        return False
    return any(provider_is_external(config.get(key), config) for key in provider_keys)


def require_external_ai_consent(
    path: str,
    config: Mapping[str, Any],
    metadata: Mapping[str, Any],
) -> None:
    if request_uses_external_ai(path, config) and not consent_is_valid(config, metadata):
        raise AIConsentRequired()


def require_external_provider_consent(
    provider: Any,
    config: Mapping[str, Any],
    metadata: Mapping[str, Any],
) -> None:
    if provider_is_external(provider, config) and not consent_is_valid(config, metadata):
        raise AIConsentRequired()


def build_compliance_status(
    manifest: Mapping[str, Any],
    config: Mapping[str, Any],
    local_data_directory: str,
) -> dict[str, Any]:
    metadata = compliance_metadata(manifest)
    public_metadata = {key: value for key, value in metadata.items() if key != "_source_path"}
    public_metadata["configured"] = not publication_compliance_errors(manifest)
    features = manifest.get("features")
    audio_processing_enabled = bool(
        isinstance(features, Mapping)
        and (
            features.get("summary.audio_pdf")
            or features.get("summary.media_files")
            or features.get("summary.web_inputs")
        )
    )
    external_providers: list[dict[str, Any]] = []
    for disclosure in EXTERNAL_PROVIDER_DISCLOSURES:
        if not audio_processing_enabled and disclosure["id"] == "deepgram":
            continue
        provider = dict(disclosure)
        provider["data"] = [
            item
            for item in disclosure["data"]
            if audio_processing_enabled or item != "오디오"
        ]
        external_providers.append(provider)
    data_categories = [
        "PDF 텍스트와 렌더링된 페이지 이미지",
        "질문, 답안, 프롬프트와 대화 기록",
        "코드와 실행 또는 채점 정보",
    ]
    if audio_processing_enabled:
        data_categories.insert(0, "사용자가 선택한 음성·영상, 주요 장면과 전사문")
    return {
        "policy": public_metadata,
        "consent": consent_status(config, metadata),
        "external_providers": external_providers,
        "data_categories": data_categories,
        "local_data_directory": str(local_data_directory or ""),
    }


__all__ = [
    "AI_CONSENT_REQUIRED_CODE",
    "AI_CONSENT_VERSION",
    "AIConsentRequired",
    "build_compliance_status",
    "compliance_metadata",
    "consent_is_valid",
    "normalize_consent_config",
    "publication_compliance_errors",
    "provider_is_external",
    "record_consent_decision",
    "request_uses_external_ai",
    "require_external_ai_consent",
    "require_external_provider_consent",
    "validate_compliance_metadata",
]
