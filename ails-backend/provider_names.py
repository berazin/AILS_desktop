"""Provider identifiers and UI labels, independent of inference pipelines."""
from common import LOCAL_OPENVINO_ENGINE, LOCAL_FASTER_WHISPER_ENGINE, LOCAL_WHISPER_CPP_VULKAN_ENGINE, LOCAL_DIRECTML_ENGINE, PROVIDER_LMSTUDIO

LOCAL_STT_PROVIDERS = frozenset(
    {
        LOCAL_OPENVINO_ENGINE,
        LOCAL_FASTER_WHISPER_ENGINE,
        LOCAL_WHISPER_CPP_VULKAN_ENGINE,
        LOCAL_DIRECTML_ENGINE,
    }
)


CUSTOM_PROVIDER_LABEL = "Custom"


def provider_to_api(value: str) -> str:
    provider = str(value or "").strip()
    if provider == CUSTOM_PROVIDER_LABEL:
        return PROVIDER_LMSTUDIO
    return provider


def provider_to_ui(value: str) -> str:
    provider = str(value or "").strip()
    if provider == PROVIDER_LMSTUDIO:
        return CUSTOM_PROVIDER_LABEL
    return provider
