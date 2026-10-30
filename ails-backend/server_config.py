from __future__ import annotations

import json
import os
import sys
import copy
import math
import tempfile
import time
from typing import Mapping

from common import (
    BASE_EXE_DIR,
    make_json_safe,
    resolve_app_path,
)
from language_support import APP_LANGUAGE_DEFAULT
from ai_reasoning import normalize_reasoning_effort
import uuid
import edition_manifest
from edition_manifest import feature_enabled, load_edition_manifest, require_local_stt_provider
from language_support import normalize_app_language
from settings.prompt_template import upgrade_prompt_template
from common import (
    BASE_PROMPT_TEMPLATE, DEEPGRAM_DEFAULT_MODEL, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_MODEL, DEFAULT_GEMINI_IMAGE_MODEL, GROQ_DEFAULT_BASE_URL, GROQ_DEFAULT_IMAGE_MODEL, GROQ_DEFAULT_STT_ENDPOINT, GROQ_DEFAULT_STT_MODEL, GROQ_DEFAULT_SUMMARY_MODEL, LMSTUDIO_DEFAULT_BASE_URL, LMSTUDIO_DEFAULT_IMAGE_MODEL, LMSTUDIO_DEFAULT_SUMMARY_MODEL, LMSTUDIO_LEGACY_BASE_URL, LOCAL_FASTER_WHISPER_ENGINE, LOCAL_OPENVINO_ENGINE, LOCAL_WHISPER_CPP_VULKAN_ENGINE, OPENAI_RESPONSES_ENDPOINT, OPENAI_SUMMARY_VERIFIER_REASONING_EFFORT, PROVIDER_DEEPGRAM, PROVIDER_DEEPSEEK, PROVIDER_DISABLED, PROVIDER_GEMINI, PROVIDER_GROQ, PROVIDER_LMSTUDIO, STATUS_LOG_VIEW_DETAILED, STATUS_LOG_VIEW_OPTIONS, STT_MODEL_DEFAULT, SUMMARY_PRIORITY_LIST, get_effective_feature_model_name, infer_image_model_name, infer_image_provider, infer_secondary_image_model_name, infer_stt_model_name, infer_stt_provider, infer_summary_model_name, infer_summary_provider, is_custom_model_option, normalize_deepseek_model_name, normalize_gemini_model_name, normalize_secondary_image_provider,
)

def _is_local_ai_settings_enabled() -> bool:
    return bool(edition_manifest.LOCAL_AI_SETTINGS_ENABLED)

def _load_api_credentials(keys):
    # Compatibility only: never access the retired personal-key credential service.
    return {}

def make_default_config() -> dict:
    config = {
        "language": APP_LANGUAGE_DEFAULT,
        "groq_base_url": GROQ_DEFAULT_BASE_URL,
        "groq_stt_endpoint": GROQ_DEFAULT_STT_ENDPOINT,
        "deepseek_base_url": DEEPSEEK_DEFAULT_BASE_URL,
        "video_vision_concurrency": 4,
        "video_frame_interval_seconds": 0.5,
        "voice_agent_provider": "local",
        "local_voice_agent_model": voice.local_model_catalog.LOCAL_PROBLEM_REVIEW_MODEL_AUTO,
        "ai_assist_cloud_fallback_policy": "manual",
        "local_problem_review_model": voice.local_model_catalog.LOCAL_PROBLEM_REVIEW_MODEL_AUTO,
        "pdf_ocr_model_variant": "auto",
        "pdf_ocr_auto_review": "none",
        "background_document_embedding": True,
        "background_document_ocr": False,
        "background_document_spacing": False,
        "background_document_spacing_non_ails": False,
        "background_document_ocr_non_ails": False,
        "background_document_ocr_excluded_paths": [],
        "ai_model_selection": {"default": {"mode": "managed_default"}, "features": {}},
        "insight_book_reasoning_effort": "default",
        "ai_provider_settings": {"default": "ails", "features": {}, "chatgpt_model": ""},
        "ails_auth_server_url": DEFAULT_AILS_AUTH_SERVER_URL,
        "ails_auth_email": "",
        "ails_device_id": "",
        "openai_responses_endpoint": OPENAI_RESPONSES_ENDPOINT,
        "summary_verification_enabled": True,
        "video_summary_verification_enabled": False,
        "summary_verification_web_search_enabled": False,
        "openrouter_web_search": {"enabled": False, "engine": "exa"},
        "summary_verification_reasoning_effort": OPENAI_SUMMARY_VERIFIER_REASONING_EFFORT,
        "summary_reasoning_effort": "none",
        "custom_summary_endpoint": "",
        "custom_summary_model_name": "",
        "custom_ocr_endpoint": "",
        "custom_ocr_model_name": "",
        "custom_image_endpoint": "",
        "custom_image_model_name": "",
        "custom_image_batch_size": 5,
        "custom_stt_endpoint": "",
        "custom_stt_model_name": "",
        "lmstudio_base_url": LMSTUDIO_DEFAULT_BASE_URL,
        "lmstudio_image_batch_size": 5,
        "summary_provider": PROVIDER_DEEPSEEK,
        "summary_model_name": DEEPSEEK_DEFAULT_MODEL,
        "ocr_provider": PROVIDER_GEMINI,
        "ocr_model_name": SUMMARY_PRIORITY_LIST[0],
        "image_provider": PROVIDER_GEMINI,
        "image_model_name": DEFAULT_GEMINI_IMAGE_MODEL,
        "image_secondary_provider": PROVIDER_DISABLED,
        "image_secondary_model_name": "",
        "chatbot_zdr_enabled": False,
        "stt_provider": LOCAL_WHISPER_CPP_VULKAN_ENGINE if feature_enabled("summary.local_stt") else PROVIDER_GEMINI,
        "stt_model_name": LOCAL_WHISPER_CPP_VULKAN_ENGINE if feature_enabled("summary.local_stt") else STT_MODEL_DEFAULT,
        "model_name": DEEPSEEK_DEFAULT_MODEL,
        "summary_fallback_on_quota": True,
        "whisper_model_size": "base",
        "whisper_cpp_model_name": "large-v3-turbo-q5_0",
        "status_log_view_mode": STATUS_LOG_VIEW_DETAILED,
        "max_parallel_summary_jobs": 2,
        "debug_trace_enabled": False,
        "lms_username": "",
        "current_grade": 2,
        "current_semester": 1,
        "md_save_path": "",
        "python_kernel_executable": "",
        "prompt_template": BASE_PROMPT_TEMPLATE,
        "ai_consent_status": "unset",
        "ai_consent_version": 0,
        "ai_consent_policy_version": "",
        "ai_consent_recorded_at": "",
        "ai_consent_withdrawn_at": "",
        # User Memory + Context Composer (모든 숫자는 설정 가능한 기본값)
        "memory_enabled": True,
        "model_context_limit_tokens": chat.context_composer.DEFAULT_MODEL_CONTEXT_LIMIT_TOKENS,
        "context_budgets": dict(chat.context_composer.DEFAULT_CONTEXT_BUDGETS),
        "memory_settings": dict(chat.memory_settings.DEFAULT_MEMORY_SETTINGS),
    }
    if feature_enabled("developer_tools"):
        config.update(
            {
                "phoenix_enabled": False,
                "phoenix_endpoint": DEFAULT_PHOENIX_ENDPOINT,
                "phoenix_project_name": DEFAULT_PHOENIX_PROJECT_NAME,
            }
        )
    return config


def load_config() -> dict:
    config = make_default_config()
    loaded_config = {}
    if os.path.exists(common.CONFIG_FILE):
        for encoding in ("utf-8", "utf-8-sig", "cp949", "euc-kr"):
            try:
                with open(common.CONFIG_FILE, "r", encoding=encoding) as handle:
                    loaded = json.load(handle)
                if isinstance(loaded, dict):
                    loaded_config = dict(loaded)
                    config.update(loaded)
                    if "background_document_spacing_non_ails" not in loaded:
                        config["background_document_spacing_non_ails"] = loaded.get("background_document_spacing_force", False)
                    if (
                        "local_voice_agent_model" not in loaded
                        and str(loaded.get("chatbot_model_name") or "") in ai_model_selection.CHATBOT_LOCAL_AGENT_MODEL_IDS
                    ):
                        config["local_voice_agent_model"] = loaded["chatbot_model_name"]
                    if "ai_model_selection" not in loaded:
                        config["ai_model_selection"] = ai_model_selection.migrate_legacy_model_selection(
                            loaded, allow_byok=_is_local_ai_settings_enabled(),
                        )
                break
            except Exception:
                continue
    normalized = normalize_loaded_config(config)
    voice.voice_recognition.VOICE_RECOGNITION_SERVICE.set_vad_threshold(normalized.get("voice_vad_threshold"))
    voice.voice_recognition.VOICE_RECOGNITION_SERVICE.set_language(normalized.get("language"))
    for key in SECRET_CONFIG_KEYS:
        normalized.pop(key, None)
    # Do not migrate or delete legacy stored credentials during startup.
    if normalized.get("ails_device_id") != loaded_config.get("ails_device_id") and not any(key in loaded_config for key in SECRET_CONFIG_KEYS):
        _write_config_without_api_keys(normalized)
    return normalized


def normalize_loaded_config(config: dict) -> dict:
    ai_compliance.normalize_consent_config(config)
    if "ai_model_selection" not in config:
        config["ai_model_selection"] = ai_model_selection.migrate_legacy_model_selection(
            config, allow_byok=_is_local_ai_settings_enabled(),
        )
    from ai_provider_settings import normalize_provider_settings
    config["ai_provider_settings"] = normalize_provider_settings(config.get("ai_provider_settings"))
    config["ai_model_selection"] = ai_model_selection.normalize_model_settings(config.get("ai_model_selection"))
    config.pop("lms_password", None)
    config.pop("lms_password_saved", None)
    config.pop("openrouter_model_name", None)
    config["groq_base_url"] = GROQ_DEFAULT_BASE_URL
    config["groq_stt_endpoint"] = GROQ_DEFAULT_STT_ENDPOINT
    config["deepseek_base_url"] = DEEPSEEK_DEFAULT_BASE_URL
    voice_agent_provider = str(config.get("voice_agent_provider") or "local").strip().casefold()
    config["voice_agent_provider"] = voice_agent_provider if voice_agent_provider in {"local", "cloud"} else "local"
    config["local_voice_agent_model"] = voice.local_model_catalog.normalize_local_problem_review_model(
        config.get("local_voice_agent_model")
    )
    assist_fallback = str(config.get("ai_assist_cloud_fallback_policy") or "manual").strip().casefold()
    config["ai_assist_cloud_fallback_policy"] = assist_fallback if assist_fallback in {"manual", "automatic"} else "manual"
    config["local_problem_review_model"] = voice.local_model_catalog.normalize_local_problem_review_model(
        config.get("local_problem_review_model")
    )
    try:
        frame_interval = float(config.get("video_frame_interval_seconds", 0.5))
    except (TypeError, ValueError):
        frame_interval = 0.5
    config["video_frame_interval_seconds"] = (
        min(10.0, max(0.25, frame_interval)) if math.isfinite(frame_interval) and frame_interval > 0 else 0.5
    )
    selected_ocr_model = str(config.get("pdf_ocr_model_variant") or "auto").strip().casefold()
    config["pdf_ocr_model_variant"] = selected_ocr_model if selected_ocr_model in {"auto", "tiny", "small", "medium"} else "auto"
    config["memory_enabled"] = bool(config.get("memory_enabled", True))
    try:
        context_limit = int(config.get("model_context_limit_tokens") or 0)
    except (TypeError, ValueError):
        context_limit = 0
    config["model_context_limit_tokens"] = context_limit if context_limit > 0 else chat.context_composer.DEFAULT_MODEL_CONTEXT_LIMIT_TOKENS
    config["context_budgets"] = chat.context_composer.normalize_budgets(config.get("context_budgets"))
    config["memory_settings"] = chat.memory_settings.normalize_memory_settings(config.get("memory_settings"))
    pdf_ocr_auto_review = str(config.get("pdf_ocr_auto_review") or "none").strip().casefold()
    config["pdf_ocr_auto_review"] = (
        pdf_ocr_auto_review if pdf_ocr_auto_review in PDF_OCR_AUTO_REVIEW_MODES else "none"
    )
    config["background_document_embedding"] = coerce_config_bool(
        config.get("background_document_embedding"), True
    )
    config["background_document_ocr"] = coerce_config_bool(config.get("background_document_ocr"), False)
    config["background_document_ocr_non_ails"] = coerce_config_bool(
        config.get("background_document_ocr_non_ails"), False
    )
    config["background_document_spacing"] = coerce_config_bool(
        config.get("background_document_spacing"), False
    )
    config["background_document_spacing_non_ails"] = coerce_config_bool(
        config.get("background_document_spacing_non_ails", config.get("background_document_spacing_force")), False
    )
    config.pop("background_document_spacing_force", None)
    raw_ocr_excluded = config.get("background_document_ocr_excluded_paths")
    if isinstance(raw_ocr_excluded, (list, tuple, set)):
        config["background_document_ocr_excluded_paths"] = sorted({
            os.path.abspath(str(p)) for p in raw_ocr_excluded if str(p or "").strip()
        })
    else:
        config["background_document_ocr_excluded_paths"] = []
    config["language"] = normalize_app_language(config.get("language"))
    try:
        voice_vad_threshold = float(config.get("voice_vad_threshold", voice.voice_recognition.VAD_THRESHOLD_DEFAULT))
    except (TypeError, ValueError):
        voice_vad_threshold = voice.voice_recognition.VAD_THRESHOLD_DEFAULT
    config["voice_vad_threshold"] = min(voice.voice_recognition.VAD_THRESHOLD_MAX, max(voice.voice_recognition.VAD_THRESHOLD_MIN, voice_vad_threshold))
    config["openai_responses_endpoint"] = OPENAI_RESPONSES_ENDPOINT
    verification_enabled = config.get("summary_verification_enabled", True)
    if isinstance(verification_enabled, str):
        normalized_verification_enabled = verification_enabled.strip().lower()
        if normalized_verification_enabled in {"0", "false", "no", "off", ""}:
            verification_enabled = False
        elif normalized_verification_enabled in {"1", "true", "yes", "on"}:
            verification_enabled = True
        else:
            verification_enabled = True
    else:
        verification_enabled = bool(verification_enabled)
    config["summary_verification_enabled"] = verification_enabled
    video_verification_enabled = config.get("video_summary_verification_enabled", False)
    if isinstance(video_verification_enabled, str):
        video_verification_enabled = video_verification_enabled.strip().lower() in {"1", "true", "yes", "on"}
    config["video_summary_verification_enabled"] = bool(video_verification_enabled)
    from openrouter_web_search import settings as normalize_web_search
    config["openrouter_web_search"] = normalize_web_search(config)
    config["summary_verification_web_search_enabled"] = False  # Retired server-key path.
    config["summary_verification_reasoning_effort"] = str(
        config.get("summary_verification_reasoning_effort") or OPENAI_SUMMARY_VERIFIER_REASONING_EFFORT
    ).strip()
    config["insight_book_reasoning_effort"] = normalize_reasoning_effort(config.get("insight_book_reasoning_effort"))
    config.setdefault("custom_summary_endpoint", "")
    config.setdefault("custom_summary_model_name", "")
    config.setdefault("custom_ocr_endpoint", "")
    config.setdefault("custom_ocr_model_name", "")
    # Generic OCR AI remains disabled. This reviewer only updates the separate
    # Practice Mode problem catalog; PaddleOCR text and indexes stay untouched.
    config["ails_auth_server_url"] = DEFAULT_AILS_AUTH_SERVER_URL
    config["ails_auth_email"] = str(config.get("ails_auth_email") or "").strip().casefold()
    try:
        config["ails_device_id"] = str(uuid.UUID(str(config.get("ails_device_id") or "")))
    except (ValueError, AttributeError):
        config["ails_device_id"] = str(uuid.uuid4())
    config["problem_review_provider"] = "gateway"
    # Page-batched routing is deterministic: Nano, then Luna, then Gemini 2.5
    # Flash Lite for candidates still below the confidence threshold.
    config["problem_review_model_name"] = documents.problem_review_gateway.PRIMARY_REVIEW_MODEL
    config["problem_review_fallback_model_name"] = documents.problem_review_gateway.FALLBACK_REVIEW_MODEL
    try:
        config["problem_review_budget_usd"] = max(0.01, min(documents.problem_review_gateway.MAX_BENCHMARK_COST_USD, float(config.get("problem_review_budget_usd", documents.problem_review_gateway.MAX_BENCHMARK_COST_USD))))
    except (TypeError, ValueError):
        config["problem_review_budget_usd"] = documents.problem_review_gateway.MAX_BENCHMARK_COST_USD
    config.setdefault("custom_image_endpoint", "")
    config.setdefault("custom_image_model_name", "")
    config.setdefault("custom_image_batch_size", 5)
    config.setdefault("custom_stt_endpoint", "")
    config.setdefault("custom_stt_model_name", "")
    config["lmstudio_base_url"] = common.migrate_legacy_chat_endpoint(
        config.get("lmstudio_base_url", ""),
        LMSTUDIO_LEGACY_BASE_URL,
        LMSTUDIO_DEFAULT_BASE_URL,
    )
    config.setdefault("lmstudio_image_batch_size", 5)
    config.setdefault("status_log_view_mode", STATUS_LOG_VIEW_DETAILED)
    config.setdefault("debug_trace_enabled", False)
    if feature_enabled("developer_tools") and normalize_phoenix_config is not None:
        config = normalize_phoenix_config(config)
    else:
        for key in PHOENIX_CONFIG_KEYS:
            config.pop(key, None)
    config.setdefault("lms_username", "")
    config["current_grade"] = max(1, min(6, int(config.get("current_grade", 2) or 2)))
    config["current_semester"] = max(1, min(2, int(config.get("current_semester", 1) or 1)))
    config.setdefault("python_kernel_executable", "")
    config.setdefault("start_week", 1)
    try:
        config["start_week"] = max(1, int(config.get("start_week", 1) or 1))
    except Exception:
        config["start_week"] = 1
    config["md_save_path"] = resolve_app_path(config.get("md_save_path", ""))
    config.setdefault("image_model_name", DEFAULT_GEMINI_IMAGE_MODEL)
    config.setdefault("groq_summary_model_name", GROQ_DEFAULT_SUMMARY_MODEL)
    config.setdefault("groq_image_model_name", GROQ_DEFAULT_IMAGE_MODEL)
    config.setdefault("groq_stt_model_name", GROQ_DEFAULT_STT_MODEL)
    config.setdefault("deepseek_summary_model_name", DEEPSEEK_DEFAULT_MODEL)
    config.setdefault("deepseek_image_model_name", DEEPSEEK_DEFAULT_MODEL)
    config["deepseek_summary_model_name"] = normalize_deepseek_model_name(
        config["deepseek_summary_model_name"]
    )
    config["deepseek_image_model_name"] = normalize_deepseek_model_name(
        config["deepseek_image_model_name"]
    )
    config.setdefault("lmstudio_summary_model_name", LMSTUDIO_DEFAULT_SUMMARY_MODEL)
    config.setdefault("lmstudio_image_model_name", LMSTUDIO_DEFAULT_IMAGE_MODEL)
    config.setdefault("deepgram_stt_model_name", DEEPGRAM_DEFAULT_MODEL)
    config.setdefault("whisper_cpp_model_name", "large-v3-turbo-q5_0")
    config.setdefault("groq_image_batch_size", 5)
    config.setdefault("image_secondary_provider", PROVIDER_DISABLED)
    config.setdefault("image_secondary_model_name", "")
    for legacy_key in (
        "ai_gateway_access_mode", "chatbot_expert_model_name",
        "video_vision_model_name", "video_text_model_name", "summary_verification_model_name",
        "chatbot_provider", "chatbot_model_name", "grading_provider", "grading_model_name",
        "quiz_provider", "quiz_model_name",
        *(f"cloud_model_{workflow}" for workflow in ai_model_selection.MANAGED_WORKFLOWS),
    ):
        config.pop(legacy_key, None)
    zdr_enabled = config.get("chatbot_zdr_enabled", False)
    if isinstance(zdr_enabled, str):
        zdr_enabled = zdr_enabled.strip().casefold() in {"1", "true", "yes", "on"}
    config["chatbot_zdr_enabled"] = bool(zdr_enabled)
    config.setdefault("ocr_provider", config.get("summary_provider", PROVIDER_GEMINI))
    config.setdefault("ocr_model_name", config.get("summary_model_name", SUMMARY_PRIORITY_LIST[0]))

    config["summary_provider"] = infer_summary_provider(config)
    config["summary_model_name"] = infer_summary_model_name(config)
    config["image_provider"] = infer_image_provider(config)
    config["image_model_name"] = infer_image_model_name(config)
    config["image_secondary_provider"] = normalize_secondary_image_provider(config)
    config["image_secondary_model_name"] = infer_secondary_image_model_name(config)
    for provider_key, model_key in (
        ("summary_provider", "summary_model_name"),
        ("image_provider", "image_model_name"),
        ("image_secondary_provider", "image_secondary_model_name"),
    ):
        if config.get(provider_key) == PROVIDER_DEEPSEEK:
            config[model_key] = normalize_deepseek_model_name(config.get(model_key))
        elif config.get(provider_key) == PROVIDER_GEMINI:
            config[model_key] = normalize_gemini_model_name(config.get(model_key))
    if summary_stt_enabled():
        normalize_stt_config_for_edition(config)
        config["stt_provider"] = infer_stt_provider(config)
        config["stt_model_name"] = infer_stt_model_name(config)

    if config.get("status_log_view_mode") not in STATUS_LOG_VIEW_OPTIONS:
        config["status_log_view_mode"] = STATUS_LOG_VIEW_DETAILED
    try:
        config["max_parallel_summary_jobs"] = max(1, min(4, int(config.get("max_parallel_summary_jobs", 2) or 2)))
    except Exception:
        config["max_parallel_summary_jobs"] = 2
    if config["summary_provider"] == PROVIDER_GROQ and not is_custom_model_option(config["summary_model_name"]):
        config["groq_summary_model_name"] = config["summary_model_name"]
    elif config["summary_provider"] == PROVIDER_DEEPSEEK and not is_custom_model_option(config["summary_model_name"]):
        config["deepseek_summary_model_name"] = config["summary_model_name"]
    elif config["summary_provider"] == PROVIDER_LMSTUDIO and not is_custom_model_option(config["summary_model_name"]):
        config["lmstudio_summary_model_name"] = config["summary_model_name"]

    if config["image_provider"] == PROVIDER_GROQ and not is_custom_model_option(config["image_model_name"]):
        config["groq_image_model_name"] = config["image_model_name"]
    elif config["image_provider"] == PROVIDER_DEEPSEEK and not is_custom_model_option(config["image_model_name"]):
        config["deepseek_image_model_name"] = config["image_model_name"]
    elif config["image_provider"] == PROVIDER_LMSTUDIO and not is_custom_model_option(config["image_model_name"]):
        config["lmstudio_image_model_name"] = config["image_model_name"]

    if summary_stt_enabled():
        if config["stt_provider"] == PROVIDER_GROQ and not is_custom_model_option(config["stt_model_name"]):
            config["groq_stt_model_name"] = config["stt_model_name"]
        elif config["stt_provider"] == PROVIDER_DEEPGRAM and not is_custom_model_option(config["stt_model_name"]):
            config["deepgram_stt_model_name"] = config["stt_model_name"]
        elif config["stt_provider"] in (LOCAL_OPENVINO_ENGINE, LOCAL_FASTER_WHISPER_ENGINE) and not is_custom_model_option(config["stt_model_name"]):
            config["whisper_model_size"] = config.get("stt_model_name", config.get("whisper_model_size", "base"))
        elif config["stt_provider"] == LOCAL_WHISPER_CPP_VULKAN_ENGINE and not is_custom_model_option(config["stt_model_name"]):
            config["whisper_cpp_model_name"] = config.get("stt_model_name", config.get("whisper_cpp_model_name", "large-v3-turbo-q5_0"))

    config["model_name"] = get_effective_feature_model_name(
        config,
        "summary",
        config["summary_model_name"],
    ) or config["summary_model_name"]
    config["prompt_template"] = upgrade_prompt_template(config.get("prompt_template", BASE_PROMPT_TEMPLATE))
    for key in SECRET_CONFIG_KEYS:
        config.pop(key, None)
    return config


def _write_config_without_api_keys(config: dict) -> None:
    persisted = {
        key: value
        for key, value in config.items()
        if key not in SECRET_CONFIG_KEYS and not key.startswith("_")
    }
    # Settings saves and background auth refreshes can overlap. Each writer
    # owns its temp file, on the same volume for the final atomic replacement.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", errors="replace", delete=False,
            dir=os.path.dirname(os.path.abspath(common.CONFIG_FILE)),
            prefix=os.path.basename(common.CONFIG_FILE) + ".", suffix=".tmp",
        ) as handle:
            temp_path = handle.name
            json.dump(persisted, handle, ensure_ascii=False, indent=2)
        # Windows readers/scanners can briefly hold the destination without
        # delete sharing. Retry only that atomic replacement, not the save's
        # credential updates or any task/AI work. Persistent errors still fail.
        for attempt in range(8):
            try:
                os.replace(temp_path, common.CONFIG_FILE)
                break
            except PermissionError as error:
                if getattr(error, "winerror", None) not in {5, 32, 33} or attempt == 7:
                    raise
                time.sleep(min(0.025 * (2 ** attempt), 0.4))
    finally:
        if temp_path is not None and os.path.exists(temp_path):
            os.unlink(temp_path)


def save_config(config: dict) -> dict:
    from subscription_policy import validate_subscription_settings
    validate_subscription_settings(config)
    if _is_local_ai_settings_enabled() and "ai_model_selection" in config:
        ai_model_selection.validate_model_settings_for_save(config["ai_model_selection"])
    if "ai_model_selection" not in config:
        config["ai_model_selection"] = ai_model_selection.migrate_legacy_model_selection(
            config, allow_byok=_is_local_ai_settings_enabled(),
        )
    for key in (
        "summary_provider",
        "image_provider",
        "image_secondary_provider",
        "ocr_provider",
    ):
        if key in config:
            config[key] = providers.provider_to_api(config[key])
    normalized = normalize_loaded_config(dict(config))
    voice.voice_recognition.VOICE_RECOGNITION_SERVICE.set_vad_threshold(normalized.get("voice_vad_threshold"))
    voice.voice_recognition.VOICE_RECOGNITION_SERVICE.set_language(normalized.get("language"))
    md_save_path = resolve_app_path(normalized.get("md_save_path", ""))
    normalized["md_save_path"] = md_save_path
    if md_save_path:
        os.makedirs(md_save_path, exist_ok=True)
    for key in SECRET_CONFIG_KEYS:
        normalized.pop(key, None)
    _write_config_without_api_keys(normalized)
    return normalized


def config_for_ui(config: Mapping, include_secrets=False, lms_password_saved=False) -> dict:
    data = {key: value for key, value in config.items() if not str(key).startswith("_")}
    if not _is_local_ai_settings_enabled():
        data["ai_model_selection"] = production_model_settings(data.get("ai_model_selection"))
        for personal_key in (
            "summary_provider", "summary_model_name", "quiz_provider", "quiz_model_name",
            "image_provider", "image_model_name", "image_secondary_provider", "image_secondary_model_name",
            "chatbot_provider", "chatbot_model_name", "grading_provider", "grading_model_name",
            "summary_verification_model_name", "problem_review_model_name",
        ):
            data.pop(personal_key, None)
    data["lms_password_saved"] = bool(lms_password_saved)
    for key in SECRET_CONFIG_KEYS:
        data.pop(key, None)
    data["api_key_storage"] = "unsupported"
    data["managed_by_ails"] = not _is_local_ai_settings_enabled()
    for key in (
        "summary_provider",
        "image_provider",
        "image_secondary_provider",
        "ocr_provider",
    ):
        if key in data:
            data[key] = providers.provider_to_ui(data[key])
    return data


def default_config_for_ui() -> dict:
    return config_for_ui(normalize_loaded_config(make_default_config()), include_secrets=True)




import ai_compliance
import ai_model_selection
from settings.value_coercion import coerce_config_bool
import chat.context_composer
import chat.memory_settings
import common
import credential_store
import documents.problem_review_gateway
import provider_names as providers
import voice.local_model_catalog
import voice.voice_recognition


# api_server에서 이동: 설정 키 집합과 에디션 정책
COMPILED_AILS_AUTH_SERVER_URL = "https://auth.ailstudio.org"
DEFAULT_AILS_AUTH_SERVER_URL = COMPILED_AILS_AUTH_SERVER_URL
STT_CONFIG_KEYS = frozenset(
    {
        "stt_provider",
        "stt_model_name",
        "groq_stt_model_name",
        "deepgram_stt_model_name",
        "whisper_model_size",
        "whisper_cpp_model_name",
        "custom_stt_endpoint",
        "custom_stt_model_name",
        "custom_stt_api_key",
        "deepgram_api_key",
    }
)
OCR_AI_CONFIG_KEYS = frozenset(
    {
        "ocr_provider",
        "ocr_model_name",
        "custom_ocr_endpoint",
        "custom_ocr_model_name",
        "custom_ocr_api_key",
    }
)
def filter_config_update_for_edition(config_update: Mapping) -> dict:
    filtered = {
        key: value
        for key, value in config_update.items()
        if key not in OCR_AI_CONFIG_KEYS
        and key != "ails_auth_server_url"
        and key not in {
            "ai_gateway_access_mode", "chatbot_expert_model_name", "summary_verification_model_name",
            "chatbot_provider", "chatbot_model_name", "grading_provider", "grading_model_name",
            "quiz_provider", "quiz_model_name",
        }
        and not str(key).startswith("cloud_model_")
    }
    if not feature_enabled("developer_tools"):
        filtered = {
            key: value
            for key, value in filtered.items()
            if key not in PHOENIX_CONFIG_KEYS
        }
    if not edition_manifest.LOCAL_AI_SETTINGS_ENABLED:
        filtered = {
            key: value
            for key, value in filtered.items()
            if key not in MANAGED_AI_CONFIG_KEYS
        }
        if "ai_model_selection" in filtered:
            filtered["ai_model_selection"] = production_model_settings(filtered["ai_model_selection"])
    if summary_stt_enabled():
        require_stt_provider_allowed(str(filtered.get("stt_provider", "") or ""))
    else:
        filtered = {
            key: value
            for key, value in filtered.items()
            if key not in STT_CONFIG_KEYS
        }
    return filtered
def production_model_settings(value) -> dict:
    settings = ai_model_selection.normalize_model_settings(value)
    if settings["default"]["mode"] == "local":
        settings["default"] = {"mode": "managed_default"}
    settings["features"] = {
        workflow: selection
        for workflow, selection in settings["features"].items()
        if selection["mode"] != "local"
    }
    return settings
PDF_OCR_AUTO_REVIEW_MODES = frozenset({"none", "local", "cloud"})
SECRET_CONFIG_KEYS = {
    "gemini_api_key",
    "gemini_backup_api_key",
    "deepgram_api_key",
    "groq_api_key",
    "deepseek_api_key",
    "openai_api_key",
    "custom_summary_api_key",
    "custom_ocr_api_key",
    "custom_image_api_key",
    "custom_stt_api_key",
    "lmstudio_api_key",
    "vercel_gateway_api_key",
    "openrouter_api_key",
}
MANAGED_AI_CONFIG_KEYS = frozenset(
    SECRET_CONFIG_KEYS
    | STT_CONFIG_KEYS
    | {
        "ai_gateway_access_mode",
        "ails_auth_server_url",
        "summary_provider",
        "model_name",
        "summary_model_name",
        "image_provider",
        "image_model_name",
        "image_secondary_provider",
        "image_secondary_model_name",
        "problem_review_model_name",
        "problem_review_fallback_model_name",
        "summary_verification_reasoning_effort",
        "summary_reasoning_effort",
        "openai_responses_endpoint",
        "custom_summary_endpoint",
        "custom_summary_model_name",
        "custom_image_endpoint",
        "custom_image_model_name",
        "custom_stt_endpoint",
        "custom_stt_model_name",
        "lmstudio_base_url",
        "lmstudio_summary_model_name",
        "lmstudio_image_model_name",
        "groq_base_url",
        "groq_stt_endpoint",
        "groq_summary_model_name",
        "groq_image_model_name",
        "groq_stt_model_name",
        "deepseek_base_url",
        "deepseek_summary_model_name",
        "deepseek_image_model_name",
        "deepgram_stt_model_name",
    }
)
API_KEY_STORED_PLACEHOLDER = "••••••••"


# api_modules/api_model_options에서 이동: 에디션 STT 정책 (서버 설정 계층 소유)
import edition_manifest  # noqa: E402
import provider_names as providers  # noqa: E402

import common  # noqa: E402
def summary_stt_enabled() -> bool:
    return bool(
        feature_enabled("summary.audio_pdf")
        or feature_enabled("summary.media_files")
        or feature_enabled("summary.web_inputs")
    )


def normalize_stt_config_for_edition(config: dict) -> dict:
    """Normalize an active STT selection without changing settings hidden by the edition."""
    if not summary_stt_enabled():
        return config
    provider = common.infer_stt_provider(config)
    if provider not in providers.LOCAL_STT_PROVIDERS:
        allowed = edition_manifest.allowed_local_stt_providers()
        if allowed:
            config["stt_provider"] = allowed[0]
            if allowed[0] == common.LOCAL_WHISPER_CPP_VULKAN_ENGINE and edition_manifest.whisper_cpp_model_options():
                config["stt_model_name"] = edition_manifest.whisper_cpp_model_options()[0]
            provider = allowed[0]
    if provider in providers.LOCAL_STT_PROVIDERS and not feature_enabled("summary.local_stt"):
        config["stt_provider"] = common.PROVIDER_GEMINI
        config["stt_model_name"] = common.STT_MODEL_DEFAULT
    elif provider in providers.LOCAL_STT_PROVIDERS and provider not in edition_manifest.allowed_local_stt_providers():
        allowed = edition_manifest.allowed_local_stt_providers()
        if allowed:
            config["stt_provider"] = allowed[0]
            if allowed[0] == common.LOCAL_WHISPER_CPP_VULKAN_ENGINE and edition_manifest.whisper_cpp_model_options():
                config["stt_model_name"] = edition_manifest.whisper_cpp_model_options()[0]
            elif allowed[0] == common.LOCAL_FASTER_WHISPER_ENGINE and edition_manifest.faster_whisper_model_options():
                config["stt_model_name"] = edition_manifest.faster_whisper_model_options()[0]
        else:
            config["stt_provider"] = common.PROVIDER_GEMINI
            config["stt_model_name"] = common.STT_MODEL_DEFAULT
    elif provider == common.LOCAL_WHISPER_CPP_VULKAN_ENGINE:
        whisper_cpp_models = edition_manifest.whisper_cpp_model_options()
        if whisper_cpp_models:
            selected = str(config.get("stt_model_name") or "").strip()
            if selected not in whisper_cpp_models:
                selected = str(config.get("whisper_cpp_model_name") or "").strip()
            if selected not in whisper_cpp_models:
                selected = whisper_cpp_models[0]
            config["stt_model_name"] = selected
            config["whisper_cpp_model_name"] = selected
    return config


def require_stt_provider_allowed(provider: str) -> None:
    if provider and provider not in providers.LOCAL_STT_PROVIDERS:
        raise ValueError("프로덕션에서는 로컬 음성 인식 모델만 사용할 수 있습니다.")
    if provider in providers.LOCAL_STT_PROVIDERS:
        require_local_stt_provider(provider)


# api_server에서 이동: Phoenix는 developer 전용 선택 의존성. 상용 패키지에서는
# 모듈이 없어도 서버가 임포트될 수 있어야 한다.
if feature_enabled("developer_tools"):
    from phoenix_observability import (
        DEFAULT_PHOENIX_ENDPOINT,
        DEFAULT_PHOENIX_PROJECT_NAME,
        PHOENIX_CONFIG_KEYS,
        PhoenixTelemetry,
        normalize_phoenix_config,
    )
else:
    DEFAULT_PHOENIX_ENDPOINT = "http://127.0.0.1:6006/v1/traces"
    DEFAULT_PHOENIX_PROJECT_NAME = "AILS-dev"
    PHOENIX_CONFIG_KEYS = frozenset(
        {"phoenix_enabled", "phoenix_endpoint", "phoenix_project_name"}
    )
    PhoenixTelemetry = None
    normalize_phoenix_config = None
