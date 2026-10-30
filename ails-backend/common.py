import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE" # 🚨 추가: 윈도우 환경 스레드 돌연사(OpenMP 충돌) 방지
import shutil
import time
import subprocess
import json
import hashlib
import datetime
import re
import math
import atexit
import sys
from lazy_http_client import requests  # Legacy export used by pipeline_utils.
import threading
import base64
import io
import tempfile
import importlib
from edition_manifest import (
    canonical_edition_id,
    feature_enabled,
    load_edition_manifest,
    require_faster_whisper_model,
    require_feature,
    require_local_stt_provider,
)
from language_support import LANGUAGE_KOREAN_NAMES, normalize_app_language
OVModelForSpeechSeq2Seq = None
AutoProcessor = None
pipeline = None
WhisperModel = None

def __getattr__(name):
    # Preserve the historical common.np export without loading numerical
    # libraries for configuration, document listings or server startup.
    if name == "np":
        import numpy as np
        globals()[name] = np
        return np
    # Historical re-exports have no role in configuration or HTTP startup.
    # Resolve their real objects on first use, including `from common import *`.
    legacy_exports = {
        "Image": ("PIL.Image", None), "ImageDraw": ("PIL.ImageDraw", None),
        "wave": ("wave", None), "zipfile": ("zipfile", None),
        "SequenceMatcher": ("difflib", "SequenceMatcher"),
        **{key: ("concurrent.futures", key) for key in ("FIRST_COMPLETED", "ThreadPoolExecutor", "as_completed", "wait")},
    }
    if name in legacy_exports:
        module, attribute = legacy_exports[name]
        value = importlib.import_module(module)
        if attribute is not None:
            value = getattr(value, attribute)
        globals()[name] = value
        return value
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

def load_faster_whisper_model_class():
    """Load the retired engine only for legacy source-level calls.

    Current editions never expose this provider. Keeping the import dynamic
    prevents its adapter and native dependencies from entering DirectML-only
    packaged applications.
    """
    module = importlib.import_module('voice.noav_faster_whisper')
    return module.load_faster_whisper_model_class()

_OV_WHISPER_PIPE = None
_CURRENT_OV_SIZE = None
_FW_WHISPER_MODEL = None
_CURRENT_FW_SIZE = None
_CURRENT_FW_DEVICE = None
_CURRENT_FW_COMPUTE_TYPE = None
_CURRENT_FW_BACKEND_LABEL = None
_CURRENT_FW_INIT_NOTE = None
_USD_KRW_RATE_CACHE = {"rate": None, "fetched_at": 0.0, "source": ""}
_GEMINI_IMAGE_CACHE = {}
SUMMARY_PIPELINE_VERSION = "v2.6"
_GEMINI_IMAGE_CACHE_DISABLED_MODELS = set()

# Windows에서 subprocess 실행 시 창이 뜨지 않도록 하는 플래그
CREATE_NO_WINDOW = 0x08000000
CHUNK_SIZE = 6000
MAX_WORKERS = 10
VISUAL_CAPTION_SIMILARITY_THRESHOLD = 0.9
VISUAL_MERGE_GAP_SECONDS = 5.0
VISUAL_CONTEXT_MAX_ITEMS = 20
VISUAL_CONTEXT_PER_SEGMENT = 5
VISUAL_SEGMENT_PADDING_SECONDS = 8.0
SEGMENT_GAP_SPLIT_SECONDS = 18.0
SEGMENT_TARGET_CHARS = 5000
SEGMENT_MAX_CHARS = 7000
SEGMENT_MIN_CHARS = 1200


class _BackendMessageBox:
    @staticmethod
    def askyesno(*_args, **_kwargs):
        return False

    @staticmethod
    def showinfo(*_args, **_kwargs):
        return None

    @staticmethod
    def showerror(*_args, **_kwargs):
        return None

    @staticmethod
    def showwarning(*_args, **_kwargs):
        return None


messagebox = _BackendMessageBox()

def resource_path(relative_path):
    if getattr(sys, 'frozen', False):
        base_path = os.path.dirname(sys.executable)
        internal_path = os.path.join(base_path, "_internal", relative_path)
        if os.path.exists(internal_path):
            return internal_path
        return os.path.join(base_path, relative_path)
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))
        root_path = os.path.join(base_path, "..")
        if os.path.exists(os.path.join(root_path, relative_path)):
            return os.path.join(root_path, relative_path)
        return os.path.join(base_path, relative_path)


def resolve_faster_whisper_model_source(model_size):
    normalized = str(model_size or "").strip()
    if not normalized or not re.fullmatch(r"[0-9A-Za-z._-]+", normalized):
        raise RuntimeError("Invalid faster-whisper model identifier.")
    if canonical_edition_id() == "commercial":
        require_faster_whisper_model(normalized)
    bundled_dir = resource_path(os.path.join("models", "whisper", normalized))
    required = (
        "config.json",
        "model.bin",
        "preprocessor_config.json",
        "tokenizer.json",
        "vocabulary.json",
    )
    if all(os.path.isfile(os.path.join(bundled_dir, filename)) for filename in required):
        return bundled_dir
    if canonical_edition_id() == "commercial":
        raise RuntimeError(
            f"Commercial local STT requires an approved bundled Whisper model: {normalized}"
        )
    return normalized

_RUNTIME_DATA_DIR = os.path.abspath(
    os.path.expandvars(os.path.expanduser(os.environ.get("AILS_RUNTIME_DATA_DIR", "")))
) if os.environ.get("AILS_RUNTIME_DATA_DIR") else ""

if _RUNTIME_DATA_DIR:
    os.makedirs(_RUNTIME_DATA_DIR, exist_ok=True)
    APP_BASE_DIR = _RUNTIME_DATA_DIR
elif getattr(sys, 'frozen', False):
    APP_BASE_DIR = os.path.dirname(sys.executable)
else:
    APP_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

if _RUNTIME_DATA_DIR:
    BASE_EXE_DIR = _RUNTIME_DATA_DIR
elif getattr(sys, 'frozen', False):
    BASE_EXE_DIR = os.path.dirname(sys.executable)
else:
    BASE_EXE_DIR = APP_BASE_DIR

def resolve_app_path(path_value, default=""):
    from system_storage import resolve_system_path
    value = str(path_value or default or "").strip()
    if not value:
        return ""
    value = os.path.expandvars(os.path.expanduser(value))
    if os.path.isabs(value):
        return resolve_system_path(os.path.normpath(value))
    return resolve_system_path(os.path.normpath(os.path.join(BASE_EXE_DIR, value)))

def make_app_relative_path(path_value, base_dir=None):
    value = str(path_value or "").strip()
    if not value:
        return ""
    expanded = os.path.normpath(os.path.expandvars(os.path.expanduser(value)))
    if not os.path.isabs(expanded):
        return expanded

    root = os.path.normpath(base_dir or BASE_EXE_DIR)
    try:
        relative = os.path.relpath(expanded, root)
    except ValueError:
        return expanded
    if relative == os.curdir:
        return "."
    if relative == os.pardir or relative.startswith(os.pardir + os.path.sep):
        return expanded
    return relative

CONFIG_FILE = os.path.join(BASE_EXE_DIR, "last_config.json")
TEMP_DIR_NAME = os.path.join(BASE_EXE_DIR, "temp_segments")
STT_MODEL_DEFAULT = "gemini-3.5-flash-lite"
LOCAL_OPENVINO_ENGINE = "Local (openVINO)"
LOCAL_FASTER_WHISPER_ENGINE = "Local (faster-whisper)"
LOCAL_WHISPER_CPP_VULKAN_ENGINE = "Local (whisper.cpp Vulkan)"
LOCAL_DIRECTML_ENGINE = "Local (DirectML)"
GROQ_SUMMARY_ENGINE = "Groq (OpenAI-compatible)"
GROQ_VISION_ENGINE = "Groq Vision"
GROQ_STT_ENGINE = "Groq Whisper"
PROVIDER_LMSTUDIO = "LM Studio"
PROVIDER_GEMINI = "Gemini"
PROVIDER_GROQ = "Groq"
PROVIDER_DEEPSEEK = "DeepSeek"
PROVIDER_DEEPGRAM = "Deepgram"
PROVIDER_DISABLED = "사용 안 함"
OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses"
OPENAI_SUMMARY_VERIFIER_MODEL = "gpt-5.6-luna"
OPENAI_SUMMARY_VERIFIER_REASONING_EFFORT = "medium"
DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.5-flash-lite"
PROVIDER_CUSTOM = "Custom"
CUSTOM_MODEL_OPTION = "Custom"
GROQ_LEGACY_BASE_URL = "https://api.groq.com/openai"
GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_DEFAULT_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models"
GROQ_DEFAULT_STT_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_DEFAULT_SUMMARY_MODEL = "llama-3.3-70b-versatile"
GROQ_DEFAULT_IMAGE_MODEL = "llama-3.2-11b-vision-preview"
GROQ_DEFAULT_STT_MODEL = "whisper-large-v3-turbo"
DEEPSEEK_LEGACY_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_GATEWAY_ROOT = "https://gateway.ai.cloudflare.com/v1/f340ec5285fa868152d01adadf585ef7/jms/deepseek"
DEEPSEEK_DEFAULT_BASE_URL = f"{DEEPSEEK_GATEWAY_ROOT}/chat/completions"
DEEPSEEK_DEFAULT_MODELS_ENDPOINT = f"{DEEPSEEK_GATEWAY_ROOT}/models"
DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"
DEEPSEEK_MODEL_OPTIONS = ["deepseek-v4-flash", "deepseek-v4-pro"]
DEEPSEEK_RETIRED_MODEL_MIGRATIONS = {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
}
GEMINI_RETIRED_MODEL_MIGRATIONS = {
    "gemini-1.5-flash": "gemini-3.6-flash",
    "gemini-1.5-flash-8b": "gemini-3.5-flash-lite",
    "gemini-2.5-flash": "gemini-3.6-flash",
    "gemini-2.5-flash-preview-09-2025": "gemini-3.6-flash",
    "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite-preview-09-2025": "gemini-3.5-flash-lite",
    "gemini-2.5-pro": "gemini-3.5-flash",
    "gemini-2.5-pro-preview-09-2025": "gemini-3.5-flash",
    "gemini-3-flash-preview": "gemini-3.6-flash",
    "gemini-3.1-flash-preview": "gemini-3.6-flash",
    "gemini-3.1-flash-lite-preview": "gemini-3.5-flash-lite",
    "gemini-3.1-pro-preview": "gemini-3.5-flash",
}
DEEPGRAM_DEFAULT_MODEL = "nova-3"
LMSTUDIO_LEGACY_BASE_URL = "http://localhost:1234"
LMSTUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1/chat/completions"
LMSTUDIO_DEFAULT_MODELS_ENDPOINT = "http://localhost:1234/v1/models"
LMSTUDIO_DEFAULT_SUMMARY_MODEL = ""
LMSTUDIO_DEFAULT_IMAGE_MODEL = ""
DEEPGRAM_MODEL_OPTIONS = ["nova-3", "nova-2"]
OPENAI_COMPAT_MAX_RETRIES = 4
OPENAI_COMPAT_RETRY_BASE_SEC = 5
OPENAI_COMPAT_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
DEFAULT_RATE_LIMIT_WAIT_SCHEDULE = (30.0, 20.0, 10.0)
GROQ_IMAGE_RATE_LIMIT_WAIT_SCHEDULE = (30.0, 20.0, 10.0)
HTTP_ERROR_PREVIEW_LIMIT = 280
USD_KRW_RATE_TTL_SEC = 300
USD_KRW_RATE_API_URL = "https://open.er-api.com/v6/latest/USD"
SUMMARY_PRIORITY_LIST = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
]
SUMMARY_PROVIDER_OPTIONS = [PROVIDER_GEMINI, PROVIDER_GROQ, PROVIDER_DEEPSEEK, PROVIDER_LMSTUDIO, PROVIDER_CUSTOM]
QUIZ_PROVIDER_OPTIONS = [PROVIDER_GEMINI, PROVIDER_GROQ, PROVIDER_DEEPSEEK, PROVIDER_LMSTUDIO]
IMAGE_PROVIDER_OPTIONS = [PROVIDER_GEMINI, PROVIDER_GROQ, PROVIDER_LMSTUDIO, PROVIDER_CUSTOM]
IMAGE_SECONDARY_PROVIDER_OPTIONS = [PROVIDER_DISABLED, PROVIDER_GEMINI, PROVIDER_GROQ, PROVIDER_LMSTUDIO]
DUAL_IMAGE_PROVIDER_OPTIONS = {PROVIDER_GROQ, PROVIDER_GEMINI, PROVIDER_LMSTUDIO}
STT_PROVIDER_OPTIONS = [LOCAL_WHISPER_CPP_VULKAN_ENGINE, LOCAL_FASTER_WHISPER_ENGINE, LOCAL_OPENVINO_ENGINE, LOCAL_DIRECTML_ENGINE, PROVIDER_GROQ, PROVIDER_GEMINI, PROVIDER_DEEPGRAM, PROVIDER_CUSTOM]
SUMMARY_ENGINE_OPTIONS = SUMMARY_PRIORITY_LIST + [GROQ_SUMMARY_ENGINE]
IMAGE_MODEL_OPTIONS = [DEFAULT_GEMINI_IMAGE_MODEL, GROQ_VISION_ENGINE]
STT_OPTIONS = [STT_MODEL_DEFAULT, LOCAL_OPENVINO_ENGINE, LOCAL_FASTER_WHISPER_ENGINE, LOCAL_WHISPER_CPP_VULKAN_ENGINE, LOCAL_DIRECTML_ENGINE, GROQ_STT_ENGINE] + [m for m in SUMMARY_PRIORITY_LIST if m != STT_MODEL_DEFAULT]
WHISPER_MODEL_OPTIONS = ["tiny", "base", "small", "medium", "large-v3"]
WHISPER_CPP_MODEL_OPTIONS = [
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3-turbo-q5_0",
    "large-v3-turbo-q8_0",
    "large-v3-turbo-fp16",
    "large-v3-q5_0",
    "large-v3-fp16",
]
# Bundled runtime/models live beside the backend executable (or project root in
# dev). BASE_EXE_DIR may instead be a writable per-user data directory.
WHISPER_CPP_TOOL_DIR = resource_path(os.path.join("tools", "whispercpp-vulkan"))
WHISPER_CPP_MODEL_DIR = resource_path(os.path.join("models", "whispercpp"))
STATUS_LOG_VIEW_DETAILED = "상세히 보기"
STATUS_LOG_VIEW_COMPACT = "간략히 보기"
STATUS_LOG_VIEW_OPTIONS = [STATUS_LOG_VIEW_DETAILED, STATUS_LOG_VIEW_COMPACT]


def resolve_bundled_tool(fallback, *relative_paths):
    for relative_path in relative_paths:
        candidate = resource_path(relative_path)
        if os.path.isfile(candidate):
            return candidate
    return fallback


FFMPEG_EXE = resolve_bundled_tool(
    "ffmpeg",
    os.path.join("tools", "ffmpeg", "bin", "ffmpeg.exe"),
    "ffmpeg.exe",
)
FFPROBE_EXE = resolve_bundled_tool(
    "ffprobe",
    os.path.join("tools", "ffmpeg", "bin", "ffprobe.exe"),
    "ffprobe.exe",
)
from usage_metering import (
    USD_KRW_RATE_API_URL,
    USD_KRW_RATE_TTL_SEC,
    _USD_KRW_RATE_CACHE,
    PRICING_REFERENCE_CHECKED_AT,
    PRICING_REFERENCE_MARKDOWN,
    MODEL_PRICING_USD_PER_1M,
    MODEL_PRICING_ALIASES,
    resolve_pricing_model,
    get_model_pricing,
    normalize_deepseek_model_name,
    normalize_gemini_model_name,
    fetch_usd_krw_rate,
    format_cost_pair,
    estimate_token_count,
    _usage_field,
    _usage_float,
    extract_usage_metadata,
    extract_openai_compat_usage,
    calculate_usage_cost,
    build_usage_event,
    summarize_usage_events,
    build_usage_table_row,
    build_usage_markdown,
)

_WHISPER_MODEL = None
_CURRENT_WHISPER_SIZE = None
INVALID_FILE_CHARS = r'[\\/*?:"<>|]'

def is_custom_model_option(model_name):
    return str(model_name or "").strip() == CUSTOM_MODEL_OPTION

def append_custom_model_option(models):
    normalized = []
    seen = set()
    for model_name in (models or []):
        value = str(model_name or "").strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)
    if CUSTOM_MODEL_OPTION not in seen:
        normalized.append(CUSTOM_MODEL_OPTION)
    return normalized or [CUSTOM_MODEL_OPTION]

def get_custom_feature_config_keys(feature):
    mapping = {
        "summary": ("custom_summary_endpoint", "custom_summary_model_name", "custom_summary_api_key"),
        "ocr": ("custom_ocr_endpoint", "custom_ocr_model_name", "custom_ocr_api_key"),
        "image": ("custom_image_endpoint", "custom_image_model_name", "custom_image_api_key"),
        "stt": ("custom_stt_endpoint", "custom_stt_model_name", "custom_stt_api_key"),
    }
    return mapping.get(feature)

def get_selected_model_config_key(feature):
    mapping = {
        "summary": "summary_model_name",
        "ocr": "ocr_model_name",
        "quiz": "quiz_model_name",
        "image": "image_model_name",
        "image_secondary": "image_secondary_model_name",
        "stt": "stt_model_name",
    }
    return mapping.get(feature, "")

def get_custom_feature_values(config, feature):
    keys = get_custom_feature_config_keys(feature)
    if not keys:
        return "", "", ""
    endpoint_key, model_key, api_key_key = keys
    return (
        normalize_endpoint_url(config.get(endpoint_key, ""), ""),
        str(config.get(model_key, "") or "").strip(),
        str(config.get(api_key_key, "") or "").strip(),
    )

def get_effective_feature_model_name(config, feature, fallback=""):
    selected_key = get_selected_model_config_key(feature)
    selected_value = str(config.get(selected_key, "") or "").strip() if selected_key else ""
    if is_custom_model_option(selected_value):
        _endpoint, custom_model_name, _api_key = get_custom_feature_values(config, feature)
        return custom_model_name or fallback
    return selected_value or fallback

def normalize_endpoint_url(endpoint_url, fallback=""):
    normalized = str(endpoint_url or fallback or "").strip()
    if not normalized:
        return str(fallback or "").strip()
    return normalized.rstrip("/")

def migrate_legacy_chat_endpoint(saved_value, legacy_root, default_endpoint):
    normalized = normalize_endpoint_url(saved_value, "")
    if not normalized:
        return default_endpoint
    if normalize_endpoint_url(legacy_root, "") and normalized == normalize_endpoint_url(legacy_root, ""):
        return default_endpoint
    return normalized

def build_openai_chat_endpoint(endpoint_url, fallback_endpoint=""):
    return normalize_endpoint_url(endpoint_url, fallback_endpoint)

STREAM_USAGE_ENDPOINT_HOSTS = (
    "api.deepseek.com",
    "api.groq.com",
)


def endpoint_supports_stream_usage(endpoint_url):
    """stream_options.include_usage를 안전히 받는 공급자인지 판정한다.

    확인되지 않은 엔드포인트(커스텀·게이트웨이)는 알 수 없는 파라미터로
    거부할 수 있으므로 보수적으로 제외한다.
    """
    endpoint = str(endpoint_url or "").lower()
    if "://localhost" in endpoint or "://127.0.0.1" in endpoint or "://[::1]" in endpoint:
        return True
    return any(host in endpoint for host in STREAM_USAGE_ENDPOINT_HOSTS)

def build_openai_models_endpoint(endpoint_url, fallback_endpoint):
    endpoint = normalize_endpoint_url(endpoint_url, fallback_endpoint)
    lowered = endpoint.lower()
    suffix_map = {
        "/v1/chat/completions": "/v1/models",
        "/chat/completions": "/models",
        "/v1/chat": "/v1/models",
        "/chat": "/models",
        "/v1/models": "/v1/models",
        "/models": "/models",
    }
    for suffix, replacement in suffix_map.items():
        if lowered.endswith(suffix):
            return endpoint[:len(endpoint) - len(suffix)] + replacement
    raise RuntimeError("모델 목록 엔드포인트를 유추할 수 없습니다. `/chat/completions` 또는 `/models`까지 포함된 전체 URL을 입력하세요.")

def build_audio_transcriptions_endpoint(endpoint_url, fallback_endpoint=""):
    return normalize_endpoint_url(endpoint_url, fallback_endpoint)

def build_openai_compat_headers(api_key="", endpoint_url="", *, json_content=False):
    headers = {}
    if json_content:
        headers["Content-Type"] = "application/json"
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if str(endpoint_url or "").lower().startswith("https://gateway.ai.cloudflare.com/"):
        # Keep usage metadata while preventing prompts and responses from being stored.
        headers["cf-aig-collect-log-payload"] = "false"
    return headers

def fetch_available_openai_compat_models(api_key, base_url, default_models=None):
    import requests
    if not api_key:
        if default_models:
            return list(default_models)
        raise RuntimeError("API Key가 필요합니다.")
    fallback_endpoint = GROQ_DEFAULT_MODELS_ENDPOINT
    if default_models in ([DEEPSEEK_DEFAULT_MODEL], DEEPSEEK_MODEL_OPTIONS):
        fallback_endpoint = DEEPSEEK_DEFAULT_MODELS_ENDPOINT
    elif default_models:
        fallback_endpoint = LMSTUDIO_DEFAULT_MODELS_ENDPOINT
    endpoint = build_openai_models_endpoint(base_url, fallback_endpoint)
    response = requests.get(
        endpoint,
        headers=build_openai_compat_headers(api_key, endpoint),
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    models = []
    for item in payload.get("data", []):
        model_id = item.get("id")
        if model_id:
            models.append(model_id)
    models = sorted(set(models))
    if models:
        return models
    return list(default_models or [])

def fetch_available_deepseek_models(api_key, base_url):
    discovered = fetch_available_openai_compat_models(
        api_key,
        base_url or DEEPSEEK_DEFAULT_BASE_URL,
        default_models=DEEPSEEK_MODEL_OPTIONS,
    )
    normalized = [normalize_deepseek_model_name(model) for model in discovered]
    return list(dict.fromkeys([*DEEPSEEK_MODEL_OPTIONS, *normalized]))

def create_gemini_client(api_key):
    raise ValueError("Personal Gemini API connections are no longer supported.")

def fetch_available_gemini_models(api_key):
    raise ValueError("Personal Gemini API connections are no longer supported.")

def infer_summary_provider(config):
    provider = config.get("summary_provider")
    if provider in SUMMARY_PROVIDER_OPTIONS:
        return provider
    legacy = normalize_gemini_model_name(
        config.get("model_name", SUMMARY_PRIORITY_LIST[0]),
        SUMMARY_PRIORITY_LIST[0],
    )
    if legacy == GROQ_SUMMARY_ENGINE:
        return PROVIDER_GROQ
    if str(legacy).lower().startswith("lm-studio:"):
        return PROVIDER_LMSTUDIO
    if str(legacy).lower().startswith("deepseek"):
        return PROVIDER_DEEPSEEK
    return PROVIDER_GEMINI

def infer_summary_model_name(config):
    if is_custom_model_option(config.get("summary_model_name", "")):
        return CUSTOM_MODEL_OPTION
    provider = infer_summary_provider(config)
    if provider == PROVIDER_CUSTOM:
        return CUSTOM_MODEL_OPTION
    if provider == PROVIDER_GROQ:
        return config.get("groq_summary_model_name", GROQ_DEFAULT_SUMMARY_MODEL)
    if provider == PROVIDER_DEEPSEEK:
        return config.get("deepseek_summary_model_name", config.get("model_name", DEEPSEEK_DEFAULT_MODEL))
    if provider == PROVIDER_LMSTUDIO:
        return config.get("lmstudio_summary_model_name", LMSTUDIO_DEFAULT_SUMMARY_MODEL)
    legacy = normalize_gemini_model_name(
        config.get("model_name", SUMMARY_PRIORITY_LIST[0]),
        SUMMARY_PRIORITY_LIST[0],
    )
    if legacy == GROQ_SUMMARY_ENGINE:
        return SUMMARY_PRIORITY_LIST[0]
    return legacy or SUMMARY_PRIORITY_LIST[0]

def infer_image_provider(config):
    provider = config.get("image_provider")
    if provider in IMAGE_PROVIDER_OPTIONS:
        return provider
    legacy = normalize_gemini_model_name(
        config.get("image_model_name", DEFAULT_GEMINI_IMAGE_MODEL),
        DEFAULT_GEMINI_IMAGE_MODEL,
    )
    if legacy == GROQ_VISION_ENGINE:
        return PROVIDER_GROQ
    if str(legacy).lower().startswith("lm-studio:"):
        return PROVIDER_LMSTUDIO
    return PROVIDER_GEMINI

def infer_image_model_name(config):
    if is_custom_model_option(config.get("image_model_name", "")):
        return CUSTOM_MODEL_OPTION
    provider = infer_image_provider(config)
    if provider == PROVIDER_GROQ:
        return config.get("groq_image_model_name", GROQ_DEFAULT_IMAGE_MODEL)
    if provider == PROVIDER_DEEPSEEK:
        return config.get("deepseek_image_model_name", DEEPSEEK_DEFAULT_MODEL)
    if provider == PROVIDER_LMSTUDIO:
        return config.get("lmstudio_image_model_name", LMSTUDIO_DEFAULT_IMAGE_MODEL)
    legacy = normalize_gemini_model_name(
        config.get("image_model_name", DEFAULT_GEMINI_IMAGE_MODEL),
        DEFAULT_GEMINI_IMAGE_MODEL,
    )
    if legacy == GROQ_VISION_ENGINE:
        return DEFAULT_GEMINI_IMAGE_MODEL
    if str(legacy).lower().startswith("deepseek"):
        return DEFAULT_GEMINI_IMAGE_MODEL
    return legacy or DEFAULT_GEMINI_IMAGE_MODEL

def normalize_secondary_image_provider(config):
    provider = str(config.get("image_secondary_provider", PROVIDER_DISABLED) or PROVIDER_DISABLED).strip()
    if provider not in IMAGE_SECONDARY_PROVIDER_OPTIONS:
        return PROVIDER_DISABLED
    return provider

def infer_secondary_image_model_name(config):
    provider = normalize_secondary_image_provider(config)
    if provider == PROVIDER_DISABLED:
        return ""
    if is_custom_model_option(config.get("image_secondary_model_name", "")):
        return CUSTOM_MODEL_OPTION
    if provider == PROVIDER_GROQ:
        return config.get("image_secondary_model_name", "") or config.get("groq_image_model_name", GROQ_DEFAULT_IMAGE_MODEL)
    if provider == PROVIDER_DEEPSEEK:
        return config.get("image_secondary_model_name", "") or config.get("deepseek_image_model_name", DEEPSEEK_DEFAULT_MODEL)
    if provider == PROVIDER_LMSTUDIO:
        return config.get("image_secondary_model_name", "") or config.get("lmstudio_image_model_name", LMSTUDIO_DEFAULT_IMAGE_MODEL)
    return normalize_gemini_model_name(
        config.get("image_secondary_model_name", "") or DEFAULT_GEMINI_IMAGE_MODEL,
        DEFAULT_GEMINI_IMAGE_MODEL,
    )

def build_image_provider_config(base_config, provider, model_name, *, secondary_provider=PROVIDER_DISABLED, secondary_model_name=""):
    next_config = dict(base_config)
    next_config["image_provider"] = provider
    next_config["image_model_name"] = model_name
    next_config["image_secondary_provider"] = secondary_provider
    next_config["image_secondary_model_name"] = secondary_model_name
    if provider == PROVIDER_GROQ:
        next_config["groq_image_model_name"] = model_name
    elif provider == PROVIDER_DEEPSEEK:
        next_config["deepseek_image_model_name"] = model_name
    elif provider == PROVIDER_LMSTUDIO:
        next_config["lmstudio_image_model_name"] = model_name
    return next_config

def get_gemini_image_api_key_candidates(config):
    raise ValueError("Personal cloud API connections are no longer supported. Use an account-backed workflow.")

def infer_stt_provider(config):
    provider = config.get("stt_provider")
    if provider in STT_PROVIDER_OPTIONS:
        return provider
    legacy = normalize_gemini_model_name(
        config.get("stt_model_name", STT_MODEL_DEFAULT),
        STT_MODEL_DEFAULT,
    )
    if legacy == GROQ_STT_ENGINE:
        return PROVIDER_GROQ
    if legacy == LOCAL_OPENVINO_ENGINE:
        return LOCAL_OPENVINO_ENGINE
    if legacy == LOCAL_FASTER_WHISPER_ENGINE:
        return LOCAL_FASTER_WHISPER_ENGINE
    if legacy == LOCAL_WHISPER_CPP_VULKAN_ENGINE:
        return LOCAL_WHISPER_CPP_VULKAN_ENGINE
    if legacy == LOCAL_DIRECTML_ENGINE:
        return LOCAL_DIRECTML_ENGINE
    if str(legacy).lower().startswith("nova-"):
        return PROVIDER_DEEPGRAM
    return PROVIDER_GEMINI

def infer_stt_model_name(config):
    if is_custom_model_option(config.get("stt_model_name", "")):
        return CUSTOM_MODEL_OPTION
    provider = infer_stt_provider(config)
    if provider in (LOCAL_OPENVINO_ENGINE, LOCAL_FASTER_WHISPER_ENGINE):
        return config.get("whisper_model_size", "base")
    if provider == LOCAL_WHISPER_CPP_VULKAN_ENGINE:
        return config.get("whisper_cpp_model_name", config.get("stt_model_name", "large-v3-q5_0"))
    if provider == LOCAL_DIRECTML_ENGINE:
        return "large-v3-turbo"
    if provider == PROVIDER_GROQ:
        return config.get("groq_stt_model_name", GROQ_DEFAULT_STT_MODEL)
    if provider == PROVIDER_DEEPGRAM:
        legacy = config.get("deepgram_stt_model_name", config.get("stt_model_name", DEEPGRAM_DEFAULT_MODEL))
        return legacy or DEEPGRAM_DEFAULT_MODEL
    legacy = normalize_gemini_model_name(
        config.get("stt_model_name", STT_MODEL_DEFAULT),
        STT_MODEL_DEFAULT,
    )
    if legacy in (LOCAL_OPENVINO_ENGINE, LOCAL_FASTER_WHISPER_ENGINE, LOCAL_WHISPER_CPP_VULKAN_ENGINE, LOCAL_DIRECTML_ENGINE, GROQ_STT_ENGINE):
        return STT_MODEL_DEFAULT
    return legacy or STT_MODEL_DEFAULT

def contains_rpd_marker(text):
    lowered = str(text or "").lower()
    markers = [
        "rpd",
        "requests per day",
        "request per day",
        "daily limit",
        "per day",
    ]
    return any(marker in lowered for marker in markers)

def contains_retryable_rate_limit_marker(text):
    lowered = str(text or "").lower()
    markers = [
        "rate limit",
        "rate_limit",
        "too many requests",
        "resource_exhausted",
        "rpm",
        "tpm",
        "retry-after",
        "quota",
    ]
    return any(marker in lowered for marker in markers)

def contains_rate_limit_marker(text):
    return contains_rpd_marker(text) or contains_retryable_rate_limit_marker(text)

def get_openai_compat_rate_limit_kind(error, payload=None):
    samples = [
        str(error or ""),
        extract_http_error_body_preview(error),
        extract_openai_compat_error_text(payload),
    ]
    if any(contains_rpd_marker(sample) for sample in samples):
        return "rpd"

    response = getattr(error, "response", None)
    if response is not None and response.status_code == 429:
        return "retryable"
    if any(contains_retryable_rate_limit_marker(sample) for sample in samples):
        return "retryable"
    return None

def parse_retry_after_seconds(value):
    if value is None:
        return None
    try:
        retry_after = float(str(value).strip())
        if retry_after >= 0:
            return retry_after
    except Exception:
        return None
    return None

def extract_http_error_body_preview(error):
    response = getattr(error, "response", None)
    if response is None:
        return ""
    try:
        text = response.text or ""
    except Exception:
        return ""
    text = str(text).strip()
    if not text:
        return ""
    return text[:HTTP_ERROR_PREVIEW_LIMIT]

def extract_openai_compat_error_text(payload):
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("type") or ""
        return str(message)
    if error:
        return str(error)
    return ""

def get_retry_wait_seconds(error, attempt_index, rate_limit_wait_schedule=None):
    response = getattr(error, "response", None)
    retry_after = None
    if response is not None:
        retry_after = parse_retry_after_seconds(response.headers.get("Retry-After"))
    if rate_limit_wait_schedule:
        schedule = [float(value) for value in rate_limit_wait_schedule if float(value) > 0]
        if schedule:
            wait_seconds = float(schedule[attempt_index % len(schedule)])
            if retry_after is not None:
                return max(wait_seconds, retry_after)
            return wait_seconds
    if retry_after is not None:
        return retry_after
    return float(OPENAI_COMPAT_RETRY_BASE_SEC * (2 ** max(0, attempt_index)))

def should_retry_openai_compat_request(error, payload=None):
    response = getattr(error, "response", None)
    rate_limit_kind = get_openai_compat_rate_limit_kind(error, payload)
    if rate_limit_kind == "rpd":
        return False
    if rate_limit_kind == "retryable":
        return True
    if response is not None and response.status_code in OPENAI_COMPAT_RETRYABLE_STATUS_CODES:
        return True
    return False

def is_openai_compat_rate_limit_error(error, payload=None):
    return get_openai_compat_rate_limit_kind(error, payload) is not None

def sanitize_title(title):
    sanitized = re.sub(INVALID_FILE_CHARS, "_", title).strip()
    return sanitized or "untitled"

_JSON_SURROGATE_RE = re.compile(r"[\ud800-\udfff]")

def make_json_safe(value):
    if isinstance(value, str):
        return _JSON_SURROGATE_RE.sub("\uFFFD", value)
    if isinstance(value, dict):
        return {
            make_json_safe(key): make_json_safe(item_value)
            for key, item_value in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [make_json_safe(item) for item in value]
    return value

def append_status_log(log_list, message):
    if log_list is None:
        return
    timestamp = time.strftime("%H:%M:%S")
    log_list.append(f"[{timestamp}] {message}")

def is_debug_trace_enabled(config):
    return feature_enabled("developer_tools") and bool((config or {}).get("debug_trace_enabled"))

def emit_debug_trace(config, label, content="", event_type="info"):
    if not is_debug_trace_enabled(config):
        return
    callback = (config or {}).get("_debug_trace")
    if not callable(callback):
        return
    try:
        callback(str(label or "debug"), str(content or ""), str(event_type or "info"))
    except Exception:
        pass

def build_image_dir_name(title):
    return f".{sanitize_title(title)}.images"

def _output_academic_period(grade=None, semester=None):
    if grade is None and semester is None:
        return None
    if grade is None or semester is None:
        raise ValueError("Grade and semester must be provided together.")
    return max(1, min(6, int(grade))), max(1, min(2, int(semester)))

def build_image_dir(base_dir, title, *, grade=None, semester=None):
    period = _output_academic_period(grade, semester)
    lecture_name = title.split('_')[0] if '_' in title else title
    safe_lecture_name = sanitize_title(lecture_name)
    target_dir = resolve_app_path(base_dir)
    if period:
        target_dir = os.path.join(target_dir, f"{period[0]}학년 {period[1]}학기")
    target_dir = os.path.join(target_dir, safe_lecture_name, ".images")
    os.makedirs(target_dir, exist_ok=True)
    return os.path.join(target_dir, build_image_dir_name(title))

def build_report_path(base_dir, title, suffix="정리본.md", *, grade=None, semester=None):
    period = _output_academic_period(grade, semester)
    lecture_name = title.split('_')[0] if '_' in title else title
    safe_lecture_name = sanitize_title(lecture_name)
    target_dir = resolve_app_path(base_dir)
    if period:
        target_dir = os.path.join(target_dir, f"{period[0]}학년 {period[1]}학기")
    target_dir = os.path.join(target_dir, safe_lecture_name)
    os.makedirs(target_dir, exist_ok=True)
    clean_title = sanitize_title(title)
    if clean_title.endswith(".md"):
        filename = clean_title
    elif clean_title.endswith("정리본"):
        filename = f"{clean_title}.md"
    elif clean_title.endswith("상세 정리"):
        clean_title = clean_title[: -len("상세 정리")].rstrip() + " 상세정리본"
        filename = f"{clean_title}.md"
    elif clean_title.endswith("요약 정리"):
        clean_title = clean_title[: -len("요약 정리")].rstrip() + " 요약정리본"
        filename = f"{clean_title}.md"
    else:
        filename = f"{clean_title}{suffix}"
    return os.path.join(target_dir, filename)

def get_pip_command():
    candidates = []
    seen = set()

    for executable in (sys.executable, os.path.join(BASE_EXE_DIR, "python.exe"), "python", "py"):
        if not executable:
            continue
        key = executable.lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append([executable, "-m", "pip"])

    for cmd in candidates:
        exe = cmd[0]
        if (os.path.sep in exe or "/" in exe) and not os.path.exists(exe):
            continue
        try:
            subprocess.run(cmd + ["--version"], check=True, capture_output=True, creationflags=CREATE_NO_WINDOW)
            return cmd
        except Exception:
            continue
    return None

def install_openvino_dependencies():
    require_local_stt_provider(LOCAL_OPENVINO_ENGINE)
    pip_cmd = get_pip_command()
    if pip_cmd is None:
        raise RuntimeError("OpenVINO 자동 설치에 사용할 Python/pip 실행 파일을 찾지 못했습니다.")
    subprocess.run(
        pip_cmd + ["install", "openvino", "optimum[intel]", "transformers"],
        check=True,
        creationflags=CREATE_NO_WINDOW
    )

def install_faster_whisper_dependencies():
    require_local_stt_provider(LOCAL_FASTER_WHISPER_ENGINE)
    if canonical_edition_id() == "commercial":
        raise RuntimeError(
            "Commercial local STT must use the approved packaged faster-whisper runtime; "
            "runtime installation is disabled."
        )
    pip_cmd = get_pip_command()
    if pip_cmd is None:
        raise RuntimeError("faster-whisper 자동 설치에 사용할 Python/pip 실행 파일을 찾지 못했습니다.")
    subprocess.run(
        pip_cmd + [
            "install",
            "ctranslate2==4.7.1",
            "huggingface-hub==0.36.2",
            "onnxruntime-windowsml==1.25.2.202605110140",
            "tokenizers==0.22.2",
            "tqdm==4.67.1",
        ],
        check=True,
        creationflags=CREATE_NO_WINDOW,
    )
    subprocess.run(
        pip_cmd + ["install", "--no-deps", "faster-whisper==1.2.1"],
        check=True,
        creationflags=CREATE_NO_WINDOW,
    )

def ensure_openvino_whisper():
    """OpenVINO 및 필수 라이브러리 설치 확인"""
    require_local_stt_provider(LOCAL_OPENVINO_ENGINE)
    global OVModelForSpeechSeq2Seq, AutoProcessor, pipeline
    try:
        importlib.import_module("openvino")
        if OVModelForSpeechSeq2Seq is None or AutoProcessor is None or pipeline is None:
            from optimum.intel.openvino import OVModelForSpeechSeq2Seq as ov_model_cls
            from transformers import AutoProcessor as auto_processor_cls, pipeline as pipeline_fn
            OVModelForSpeechSeq2Seq = ov_model_cls
            AutoProcessor = auto_processor_cls
            pipeline = pipeline_fn
        return True
    except ImportError:
        if messagebox.askyesno("라이브러리 설치", "인텔 GPU 가속(OpenVINO)을 위해 전용 라이브러리가 필요합니다. 설치할까요?"):
            try:
                install_openvino_dependencies()
                importlib.import_module("openvino")
                from optimum.intel.openvino import OVModelForSpeechSeq2Seq as ov_model_cls
                from transformers import AutoProcessor as auto_processor_cls, pipeline as pipeline_fn
                OVModelForSpeechSeq2Seq = ov_model_cls
                AutoProcessor = auto_processor_cls
                pipeline = pipeline_fn
                messagebox.showinfo("성공", "OpenVINO 설치가 완료되었습니다. 현재 작업을 계속 진행합니다.")
                return True
            except Exception as e:
                messagebox.showerror("오류", f"설치 실패: {e}")
        return False

def get_openvino_pipeline(model_size="base"):
    """인텔 GPU를 사용하는 OpenVINO Whisper 파이프라인 생성"""
    global _OV_WHISPER_PIPE, _CURRENT_OV_SIZE

    if not ensure_openvino_whisper():
        raise RuntimeError("OpenVINO Whisper 환경을 준비하지 못했습니다.")
    
    # 모델 사이즈 매핑 (huggingface id)
    model_id = f"openai/whisper-{model_size}"
    
    if _OV_WHISPER_PIPE is None or _CURRENT_OV_SIZE != model_size:
        # GPU 가속을 위해 device="GPU" 설정 (인텔 아크 타격)
        model = OVModelForSpeechSeq2Seq.from_pretrained(
            model_id, export=True, device="GPU", compile=True
        )
        processor = AutoProcessor.from_pretrained(model_id)
        
        _OV_WHISPER_PIPE = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            chunk_length_s=30,
            batch_size=8, # 아크 GPU 성능에 따라 조절 가능
            device="cpu" # pipeline 내부 device는 'cpu'로 두어도 model 자체가 GPU이므로 작동함
        )
        _CURRENT_OV_SIZE = model_size
        
    return _OV_WHISPER_PIPE

BASE_PROMPT_TEMPLATE = """[역할]
당신은 대학교 교수님의 강의 내용을 정확하고 이해하기 쉽게 정리하는 요약 도우미입니다.

[참고 정보]
- 강의 파트: {part_info}
- 직전 요약 끝부분(문장 연결용, 재요약 금지):
{bookmark}
- 이미지 캡션 참고자료:
{image_list_str}
- 이미지 경로 포맷: {image_dir}/파일명

[현재 파트 원문]
{chunk}

[작성 원칙]
1. 현재 파트 원문 또는 SOURCE BLOCK을 순서대로 끝까지 훑고, 실제로 있는 내용만 요약하세요.
2. 참고 정보는 흐름과 중복 방지에만 사용하고, 본문으로 복사하거나 다시 요약하지 마세요.
3. 각 SOURCE에서 새 정보가 있으면 간단히라도 반드시 반영하고, 이미 앞에서 다룬 정보만 있으면 반복하지 마세요.
4. 같은 내용을 일반 설명과 `[실습 추적]`으로 이중 작성하지 말고, 하나의 구조 안에서 이어 쓰세요.
5. 이미지 캡션은 링크 선택용 참고자료입니다. 현재 원문과 직접 대응되는 이미지가 있을 때만 후보의 `삽입 링크` 한 줄을 관련 문단 바로 아래에 넣으세요.
6. 코딩 실습은 바뀐 코드/설정/출력/오류와 그 이유를 중심으로 쓰고, 같은 실습은 하나의 `[실습 추적]` 아래 Step으로 이어 쓰세요.
7. 수식은 반드시 LaTeX($...$ 또는 $$...$$), 코드는 코드 블록으로 작성하세요. 표 앞뒤에는 빈 줄을 한 줄씩 두세요.
8. 새 문서처럼 다시 시작하지 말고, 메타 설명 없이 마크다운 본문만 작성하세요.
9. 현재까지의 목차, 이미 사용한 섹션 제목, 누적 요약은 참고만 하세요. 현재 청크 원문에 해당 내용을 뒷받침하는 실제 설명이 충분히 있을 때만 새 섹션 제목을 만드세요.
10. 내용이 부족하면 새 섹션을 만들지 말고 기존 문단에 1~2문장으로만 이어 쓰세요. 빈 섹션, 제목만 있는 섹션, 예고성 섹션, 흐름 요약 섹션은 만들지 마세요.
11. `현재 파트에서 새롭게 다루는 내용은`, `현재 강의의 흐름 요약`, `(내용 없음, 단순 섹션 제목만 존재)` 같은 메타 문장이나 placeholder를 출력하지 마세요.
12. 마지막 파트 규칙:
{mastery_instruction}
"""

LIVE_CODING_RULE_BLOCK = """- 코딩 실습은 바뀐 코드/설정/출력/오류와 그 이유만 기록하세요. 같은 실습은 하나의 `[실습 추적]` 아래 Step으로 이어 쓰세요."""

MASTERY_CHALLENGE_RULE_BLOCK = """[마지막 파트 규칙]
{mastery_instruction}
"""

SUMMARY_BOUNDARY_RULE_BLOCK = """[중복 방지 규칙]
- 현재 파트의 신규 정보만 다루세요.
- 이미 사용한 제목이나 기존 목차를 새 이름으로 다시 시작하지 마세요.
- 이미 다룬 내용은 새 차이가 있을 때만 짧게 연결하세요.
"""

GEMINI_STT_TRANSCRIPT_PROMPT = (
    "다음 오디오를 한국어 강의 STT 원문으로만 정확히 받아적기 하세요. "
    "출력은 순수 평문이어야 합니다. "
    "타임스탬프(예: 00:12, [00:12], 1:02:33), 화자 라벨, 자막 형식, 번호 목록, 제목, 설명, 요약, 해설, 번역을 절대 넣지 마세요. "
    "잘 들리지 않는 부분은 억지로 추측하지 말고 문맥상 확실한 말만 적으세요. "
    "문장 사이에는 자연스러운 띄어쓰기와 문장부호를 유지하되, 서론이나 메타 문구 없이 전사문만 출력하세요."
)


def gemini_stt_transcript_prompt(language: str = "korean") -> str:
    """Verbatim-transcription prompt pinned to the configured lecture language."""
    lecture_language = LANGUAGE_KOREAN_NAMES.get(normalize_app_language(language), "한국어")
    return GEMINI_STT_TRANSCRIPT_PROMPT.replace("한국어 강의", f"{lecture_language} 강의")

IMAGE_CAPTION_JSON_INSTRUCTION_TEMPLATE = (
    "제공된 {count}개의 강의 슬라이드 이미지를 분석하고 strict JSON만 반환하세요. "
    "키는 파일명과 정확히 일치해야 합니다. "
    "값은 한국어 2~4문장 캡션으로 작성하세요. "
    "각 캡션에는 슬라이드의 핵심 주제, 눈에 띄는 핵심 텍스트나 용어, 표/도표/회로/그래프/수식이 무엇을 설명하는지, 화면 상태를 포함하세요. "
    "코드가 보이면 코드의 목적, 핵심 변화, 실행 결과나 오류 상태까지 설명하세요. "
    "가능하면 이전 흐름과 비교해 이 슬라이드에서 새롭게 추가된 정보가 무엇인지도 포함하세요. "
    "요약본에 이미지를 삽입할 가치가 높은 슬라이드라면 그 이유가 드러나게 설명하세요. "
    "마크다운 설명, 백틱, 부가 문장 없이 JSON 객체만 출력하세요. "
    "파일 목록: {filenames}"
)

__all__ = [
    'APP_BASE_DIR',
    'AutoProcessor',
    'BASE_EXE_DIR',
    'BASE_PROMPT_TEMPLATE',
    'CHUNK_SIZE',
    'CONFIG_FILE',
    'CREATE_NO_WINDOW',
    'CUSTOM_MODEL_OPTION',
    'DEEPGRAM_DEFAULT_MODEL',
    'DEEPGRAM_MODEL_OPTIONS',
    'DEEPSEEK_DEFAULT_BASE_URL',
    'DEEPSEEK_GATEWAY_ROOT',
    'DEEPSEEK_DEFAULT_MODEL',
    'DEEPSEEK_DEFAULT_MODELS_ENDPOINT',
    'DEEPSEEK_LEGACY_BASE_URL',
    'DEEPSEEK_MODEL_OPTIONS',
    'DEEPSEEK_RETIRED_MODEL_MIGRATIONS',
    'DEFAULT_GEMINI_IMAGE_MODEL',
    'DEFAULT_RATE_LIMIT_WAIT_SCHEDULE',
    'DUAL_IMAGE_PROVIDER_OPTIONS',
    'FFMPEG_EXE',
    'FFPROBE_EXE',
    'FIRST_COMPLETED',
    'GEMINI_STT_TRANSCRIPT_PROMPT',
    'gemini_stt_transcript_prompt',
    'GROQ_DEFAULT_BASE_URL',
    'GROQ_DEFAULT_IMAGE_MODEL',
    'GROQ_DEFAULT_MODELS_ENDPOINT',
    'GROQ_DEFAULT_STT_ENDPOINT',
    'GROQ_DEFAULT_STT_MODEL',
    'GROQ_DEFAULT_SUMMARY_MODEL',
    'GROQ_IMAGE_RATE_LIMIT_WAIT_SCHEDULE',
    'GROQ_LEGACY_BASE_URL',
    'GROQ_STT_ENGINE',
    'GROQ_SUMMARY_ENGINE',
    'GROQ_VISION_ENGINE',
    'HTTP_ERROR_PREVIEW_LIMIT',
    'IMAGE_CAPTION_JSON_INSTRUCTION_TEMPLATE',
    'IMAGE_MODEL_OPTIONS',
    'IMAGE_PROVIDER_OPTIONS',
    'IMAGE_SECONDARY_PROVIDER_OPTIONS',
    'INVALID_FILE_CHARS',
    'Image',
    'ImageDraw',
    'LIVE_CODING_RULE_BLOCK',
    'LMSTUDIO_DEFAULT_BASE_URL',
    'LMSTUDIO_DEFAULT_IMAGE_MODEL',
    'LMSTUDIO_DEFAULT_MODELS_ENDPOINT',
    'LMSTUDIO_DEFAULT_SUMMARY_MODEL',
    'LMSTUDIO_LEGACY_BASE_URL',
    'LOCAL_FASTER_WHISPER_ENGINE',
    'LOCAL_DIRECTML_ENGINE',
    'LOCAL_OPENVINO_ENGINE',
    'LOCAL_WHISPER_CPP_VULKAN_ENGINE',
    'MASTERY_CHALLENGE_RULE_BLOCK',
    'MAX_WORKERS',
    'MODEL_PRICING_ALIASES',
    'MODEL_PRICING_USD_PER_1M',
    'OPENAI_COMPAT_MAX_RETRIES',
    'OPENAI_COMPAT_RETRYABLE_STATUS_CODES',
    'OPENAI_COMPAT_RETRY_BASE_SEC',
    'OPENAI_RESPONSES_ENDPOINT',
    'OPENAI_SUMMARY_VERIFIER_MODEL',
    'OPENAI_SUMMARY_VERIFIER_REASONING_EFFORT',
    'OVModelForSpeechSeq2Seq',
    'PRICING_REFERENCE_CHECKED_AT',
    'PRICING_REFERENCE_MARKDOWN',
    'PROVIDER_CUSTOM',
    'PROVIDER_DEEPGRAM',
    'PROVIDER_DEEPSEEK',
    'PROVIDER_DISABLED',
    'PROVIDER_GEMINI',
    'PROVIDER_GROQ',
    'PROVIDER_LMSTUDIO',
    'QUIZ_PROVIDER_OPTIONS',
    'SEGMENT_GAP_SPLIT_SECONDS',
    'SEGMENT_MAX_CHARS',
    'SEGMENT_MIN_CHARS',
    'SEGMENT_TARGET_CHARS',
    'STATUS_LOG_VIEW_COMPACT',
    'STATUS_LOG_VIEW_DETAILED',
    'STATUS_LOG_VIEW_OPTIONS',
    'STT_MODEL_DEFAULT',
    'STT_OPTIONS',
    'STT_PROVIDER_OPTIONS',
    'SUMMARY_BOUNDARY_RULE_BLOCK',
    'SUMMARY_ENGINE_OPTIONS',
    'SUMMARY_PRIORITY_LIST',
    'SUMMARY_PROVIDER_OPTIONS',
    'SequenceMatcher',
    'TEMP_DIR_NAME',
    'ThreadPoolExecutor',
    'USD_KRW_RATE_API_URL',
    'USD_KRW_RATE_TTL_SEC',
    'VISUAL_CAPTION_SIMILARITY_THRESHOLD',
    'VISUAL_CONTEXT_MAX_ITEMS',
    'VISUAL_CONTEXT_PER_SEGMENT',
    'VISUAL_MERGE_GAP_SECONDS',
    'VISUAL_SEGMENT_PADDING_SECONDS',
    'WHISPER_CPP_MODEL_DIR',
    'WHISPER_CPP_MODEL_OPTIONS',
    'WHISPER_CPP_TOOL_DIR',
    'WHISPER_MODEL_OPTIONS',
    'WhisperModel',
    'append_custom_model_option',
    'append_status_log',
    'as_completed',
    'atexit',
    'base64',
    'build_audio_transcriptions_endpoint',
    'build_file_resume_fingerprint',
    'build_image_dir',
    'build_image_dir_name',
    'build_image_provider_config',
    'build_openai_chat_endpoint',
    'build_openai_compat_headers',
    'build_openai_models_endpoint',
    'build_report_path',
    'build_resume_dir',
    'build_resume_state_path',
    'build_retry_registry_path',
    'build_retry_result_content',
    'build_retry_task_payload',
    'build_task_resume_signature',
    'build_usage_event',
    'build_usage_markdown',
    'build_usage_table_row',
    'calculate_usage_cost',
    'clear_resume_state',
    'collect_retry_entries_from_disk',
    'contains_rate_limit_marker',
    'contains_retryable_rate_limit_marker',
    'contains_rpd_marker',
    'create_gemini_client',
    'datetime',
    'emit_debug_trace',
    'ensure_openvino_whisper',
    'estimate_token_count',
    'extract_http_error_body_preview',
    'extract_openai_compat_error_text',
    'extract_openai_compat_usage',
    'extract_usage_metadata',
    'fetch_available_deepseek_models',
    'fetch_available_gemini_models',
    'fetch_available_openai_compat_models',
    'fetch_usd_krw_rate',
    'format_cost_pair',
    'get_custom_feature_config_keys',
    'get_custom_feature_values',
    'get_effective_feature_model_name',
    'get_gemini_image_api_key_candidates',
    'get_model_pricing',
    'get_openai_compat_rate_limit_kind',
    'get_openvino_pipeline',
    'get_pip_command',
    'get_retry_wait_seconds',
    'get_selected_model_config_key',
    'has_valid_image_resume_payload',
    'hashlib',
    'importlib',
    'infer_image_model_name',
    'infer_image_provider',
    'infer_secondary_image_model_name',
    'infer_stt_model_name',
    'infer_stt_provider',
    'infer_summary_model_name',
    'infer_summary_provider',
    'install_faster_whisper_dependencies',
    'install_openvino_dependencies',
    'io',
    'is_custom_model_option',
    'is_debug_trace_enabled',
    'is_openai_compat_rate_limit_error',
    'iter_resume_dir_candidates',
    'iter_resume_state_paths',
    'json',
    'load_resume_state',
    'load_retry_registry',
    'make_app_relative_path',
    'make_json_safe',
    'math',
    'messagebox',
    'migrate_legacy_chat_endpoint',
    'normalize_endpoint_url',
    'normalize_secondary_image_provider',
    'normalize_deepseek_model_name',
    'normalize_gemini_model_name',
    'np',
    'os',
    'parse_retry_after_seconds',
    'pipeline',
    're',
    'remove_retry_registry_entry',
    'requests',
    'resolve_app_path',
    'resolve_pricing_model',
    'resource_path',
    'sanitize_title',
    'save_resume_state',
    'save_retry_registry',
    'should_retry_openai_compat_request',
    'shutil',
    'subprocess',
    'summarize_usage_events',
    'sys',
    'tempfile',
    'threading',
    'time',
    'upsert_retry_registry_entry',
    'wait',
    'wave',
    'zipfile',
]


# api_server에서 이동: 범용 텍스트 정규화
def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


from task_persistence import (
    iter_resume_dir_candidates,
    build_resume_dir,
    build_file_resume_fingerprint,
    build_task_resume_signature,
    build_resume_state_path,
    iter_resume_state_paths,
    load_resume_state,
    save_resume_state,
    clear_resume_state,
    has_valid_image_resume_payload,
    build_retry_task_payload,
    build_retry_registry_path,
    load_retry_registry,
    save_retry_registry,
    upsert_retry_registry_entry,
    remove_retry_registry_entry,
    build_retry_result_content,
    collect_retry_entries_from_disk,
)
