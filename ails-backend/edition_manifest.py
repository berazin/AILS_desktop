from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

from ai_compliance import validate_compliance_metadata


EDITION_ALIASES = {"full": "developer"}
SUPPORTED_EDITIONS = ("developer",)
FEATURE_KEYS = frozenset(
    {
        "summary.audio_pdf",
        "summary.local_stt",
        "summary.media_files",
        "summary.web_inputs",
        "ide",
        "developer_tools",
        "user_memory",
        "insight_book",
    }
)
SUMMARY_TASK_FEATURES = {
    "audio": "summary.audio_pdf",
    "video_detailed": "summary.media_files",
    "video_summary": "summary.media_files",
    "url": "summary.web_inputs",
    "youtube": "summary.web_inputs",
    "eclass_vod": "summary.web_inputs",
}
PINNED_COMMERCIAL_FEATURES = {
    "summary.audio_pdf": False,
    "summary.local_stt": True,
    "summary.media_files": True,
    "summary.web_inputs": False,
    "ide": False,
    "developer_tools": False,
    "user_memory": False,
    "insight_book": False,
}
PINNED_COMMERCIAL_TASKS = ["video_detailed", "video_summary"]
PINNED_COMMERCIAL_LOCAL_STT_PROVIDERS = ["Local (whisper.cpp Vulkan)"]
PINNED_COMMERCIAL_WHISPER_CPP_MODELS = [
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
PINNED_COMMERCIAL_EXCLUSIONS = {
    'api_modules.api_notebook',
    'api_modules.api_notebook_environments',
    'code_services.notebook_execution',
    'code_services.notebook_worker',
    'code_services.notebook_environments',
    'code_services.notebook_bundle',
    'code_services.notebook_process',
    'code_services.notebook_packages',

    'ipykernel',
    'ipykernel_launcher',
    'IPython',
    'jupyter_client',
    'jupyter_core',
    'comm',
    'debugpy',
    'matplotlib_inline',

    "chatgpt_subscription",
    "chat.user_memory",
    "documents.insight_book",
    "api_modules.api_insight_book",
    "aistudio_sdk",
    "arize_phoenix_otel",
    "av",
    "browser_cookie3",
    "ctranslate2",
    "faster_whisper",
    "fitz",
    "openvino",
    "opentelemetry",
    "openinference",
    "onnxruntime_genai",
    "optimum",
    "playwright",
    "pymupdf",
    "transformers",
    "phoenix",
    "phoenix_observability",
    "yt_dlp",
}


class EditionManifestError(RuntimeError):
    pass


class EditionFeatureDisabled(PermissionError):
    def __init__(self, feature: str, edition: str):
        super().__init__(f"Feature '{feature}' is disabled in the '{edition}' edition.")
        self.feature = feature
        self.edition = edition


def canonical_edition_id(value: str | None = None) -> str:
    requested = str(value or os.environ.get("AILS_EDITION", "developer") or "developer").strip().lower()
    canonical = EDITION_ALIASES.get(requested, requested)
    if canonical not in SUPPORTED_EDITIONS:
        supported = ", ".join(SUPPORTED_EDITIONS)
        raise EditionManifestError(f"Unsupported AILS edition '{requested}'. Expected one of: {supported}.")
    return canonical


def _manifest_candidates(edition: str) -> list[Path]:
    candidates: list[Path] = []
    explicit = str(os.environ.get("AILS_EDITION_MANIFEST", "") or "").strip()
    frozen_commercial = bool(getattr(sys, "frozen", False) and edition == "commercial")
    if explicit and not frozen_commercial:
        candidates.append(Path(explicit).expanduser())
    if getattr(sys, "frozen", False):
        bundle_root = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        candidates.extend(
            [
                bundle_root / "editions" / f"{edition}.json",
                Path(sys.executable).resolve().parent / "editions" / f"{edition}.json",
            ]
        )
    source_root = Path(__file__).resolve().parents[1]
    candidates.append(source_root / "editions" / f"{edition}.json")
    return candidates


def _validate_manifest(manifest: dict[str, Any], expected_id: str) -> dict[str, Any]:
    if manifest.get("schema_version") != 1:
        raise EditionManifestError(f"Unsupported edition manifest schema for '{expected_id}'.")
    if manifest.get("id") != expected_id:
        raise EditionManifestError(
            f"Edition manifest ID mismatch: expected '{expected_id}', got '{manifest.get('id')}'."
        )
    features = manifest.get("features")
    if not isinstance(features, dict) or not all(isinstance(value, bool) for value in features.values()):
        raise EditionManifestError(f"Edition '{expected_id}' must define boolean feature flags.")
    if set(features) != FEATURE_KEYS:
        missing = sorted(FEATURE_KEYS - set(features))
        unexpected = sorted(set(features) - FEATURE_KEYS)
        raise EditionManifestError(
            f"Edition '{expected_id}' feature keys are invalid; missing={missing}, unexpected={unexpected}."
        )
    allowed = manifest.get("allowed_summary_task_types")
    if (
        not isinstance(allowed, list)
        or any(not isinstance(item, str) or item not in SUMMARY_TASK_FEATURES for item in allowed)
        or len(allowed) != len(set(allowed))
    ):
        raise EditionManifestError(f"Edition '{expected_id}' has invalid summary task types.")
    expected_tasks = {
        task_type for task_type, feature in SUMMARY_TASK_FEATURES.items() if features[feature]
    }
    if set(allowed) != expected_tasks:
        raise EditionManifestError(
            f"Edition '{expected_id}' summary tasks must exactly match its feature flags."
        )
    if features["summary.local_stt"] and not (
        features["summary.audio_pdf"] or features["summary.media_files"]
    ):
        raise EditionManifestError(
            f"Edition '{expected_id}' cannot enable local STT without audio or video summaries."
        )
    for field in ("display_name", "product_name", "app_id", "artifact_prefix", "update_channel"):
        if not isinstance(manifest.get(field), str) or not str(manifest[field]).strip():
            raise EditionManifestError(f"Edition '{expected_id}' must define non-empty '{field}'.")
    try:
        validate_compliance_metadata(manifest.get("compliance"), expected_id)
    except ValueError as error:
        raise EditionManifestError(str(error)) from error
    packaging = manifest.get("packaging")
    if not isinstance(packaging, dict):
        raise EditionManifestError(f"Edition '{expected_id}' must define packaging settings.")
    if packaging.get("ffmpeg_policy") not in {
        "developer",
        "bundled-at-build",
        "audited-lgpl-bundle-required",
        "excluded",
    }:
        raise EditionManifestError(f"Edition '{expected_id}' has an invalid FFmpeg policy.")
    if packaging.get("local_stt_policy") not in {
        "developer",
        "audited-faster-whisper-bundle-required",
        "audited-directml-whisper-bundle-required",
        "audited-whisper-cpp-vulkan-bundle-required",
        "downloadable-whisper-cpp-vulkan-models",
        "excluded",
    }:
        raise EditionManifestError(f"Edition '{expected_id}' has an invalid local STT policy.")
    local_stt_providers = packaging.get("local_stt_providers")
    if (
        not isinstance(local_stt_providers, list)
        or any(not isinstance(item, str) or not item.strip() for item in local_stt_providers)
        or len(local_stt_providers) != len(set(local_stt_providers))
    ):
        raise EditionManifestError(f"Edition '{expected_id}' has invalid local STT providers.")
    faster_whisper_models = packaging.get("faster_whisper_model_ids")
    if (
        not isinstance(faster_whisper_models, list)
        or any(
            not isinstance(item, str) or not re.fullmatch(r"[0-9A-Za-z._-]+", item)
            for item in faster_whisper_models
        )
        or len(faster_whisper_models) != len(set(faster_whisper_models))
    ):
        raise EditionManifestError(f"Edition '{expected_id}' has invalid faster-whisper model IDs.")
    whisper_cpp_models = packaging.get("whisper_cpp_model_ids")
    if (
        not isinstance(whisper_cpp_models, list)
        or any(
            not isinstance(item, str) or not re.fullmatch(r"[0-9A-Za-z._-]+", item)
            for item in whisper_cpp_models
        )
        or len(whisper_cpp_models) != len(set(whisper_cpp_models))
    ):
        raise EditionManifestError(f"Edition '{expected_id}' has invalid whisper.cpp model IDs.")
    directml_whisper_models = packaging.get("directml_whisper_model_ids")
    if (
        not isinstance(directml_whisper_models, list)
        or any(
            not isinstance(item, str) or not re.fullmatch(r"[0-9A-Za-z._-]+", item)
            for item in directml_whisper_models
        )
        or len(directml_whisper_models) != len(set(directml_whisper_models))
    ):
        raise EditionManifestError(f"Edition '{expected_id}' has invalid DirectML Whisper model IDs.")
    if packaging.get("faster_whisper_acceleration") not in {
        "developer-auto",
        "cpu-only",
        "excluded",
    }:
        raise EditionManifestError(f"Edition '{expected_id}' has an invalid faster-whisper acceleration policy.")
    if packaging.get("whisper_cpp_acceleration") not in {"vulkan-preferred", "excluded"}:
        raise EditionManifestError(f"Edition '{expected_id}' has an invalid whisper.cpp acceleration policy.")
    if packaging.get("directml_acceleration") not in {"directml-only", "excluded"}:
        raise EditionManifestError(f"Edition '{expected_id}' has an invalid DirectML acceleration policy.")
    if features["summary.local_stt"] and packaging.get("local_stt_policy") == "excluded":
        raise EditionManifestError(
            f"Edition '{expected_id}' enables local STT but excludes its packaged runtime."
        )
    if features["summary.local_stt"] != bool(local_stt_providers):
        raise EditionManifestError(
            f"Edition '{expected_id}' local STT providers must match its feature flag."
        )
    if "Local (faster-whisper)" in local_stt_providers and not faster_whisper_models:
        raise EditionManifestError(
            f"Edition '{expected_id}' enables faster-whisper without an allowed model ID."
        )
    if "Local (faster-whisper)" not in local_stt_providers and faster_whisper_models:
        raise EditionManifestError(
            f"Edition '{expected_id}' declares faster-whisper models without the provider."
        )
    if "Local (whisper.cpp Vulkan)" in local_stt_providers and not whisper_cpp_models:
        raise EditionManifestError(
            f"Edition '{expected_id}' enables whisper.cpp Vulkan without an allowed model ID."
        )
    if "Local (whisper.cpp Vulkan)" not in local_stt_providers and whisper_cpp_models:
        raise EditionManifestError(
            f"Edition '{expected_id}' declares whisper.cpp models without the provider."
        )
    if bool(whisper_cpp_models) != (packaging.get("whisper_cpp_acceleration") == "vulkan-preferred"):
        raise EditionManifestError(
            f"Edition '{expected_id}' whisper.cpp models must use Vulkan-preferred acceleration."
        )
    if "Local (DirectML)" in local_stt_providers and not directml_whisper_models:
        raise EditionManifestError(
            f"Edition '{expected_id}' enables DirectML without an allowed Whisper model ID."
        )
    if "Local (DirectML)" not in local_stt_providers and directml_whisper_models:
        raise EditionManifestError(
            f"Edition '{expected_id}' declares DirectML models without the provider."
        )
    for field in ("include_problem_number_models", "strict_license_check"):
        if not isinstance(packaging.get(field), bool):
            raise EditionManifestError(f"Edition '{expected_id}' packaging.{field} must be boolean.")
    excluded = packaging.get("exclude_python_packages")
    if (
        not isinstance(excluded, list)
        or any(not isinstance(item, str) or not item.strip() for item in excluded)
        or len(excluded) != len(set(excluded))
    ):
        raise EditionManifestError(f"Edition '{expected_id}' has invalid Python package exclusions.")
    if expected_id == "commercial":
        if features != PINNED_COMMERCIAL_FEATURES or allowed != PINNED_COMMERCIAL_TASKS:
            raise EditionManifestError("Commercial feature policy does not match the policy pinned in the executable.")
        if (
            packaging.get("ffmpeg_policy") != "excluded"
            or packaging.get("local_stt_policy") != "audited-whisper-cpp-vulkan-bundle-required"
            or local_stt_providers != PINNED_COMMERCIAL_LOCAL_STT_PROVIDERS
            or whisper_cpp_models != PINNED_COMMERCIAL_WHISPER_CPP_MODELS
            or directml_whisper_models
            or faster_whisper_models
            or packaging.get("faster_whisper_acceleration") != "excluded"
            or packaging.get("whisper_cpp_acceleration") != "vulkan-preferred"
            or packaging.get("directml_acceleration") != "excluded"
            or packaging.get("strict_license_check") is not True
            or packaging.get("include_problem_number_models") is not True
            or not PINNED_COMMERCIAL_EXCLUSIONS.issubset(set(excluded))
        ):
            raise EditionManifestError("Commercial packaging policy does not match the pinned safety policy.")
    return manifest


def allowed_local_stt_providers(edition: str | None = None) -> tuple[str, ...]:
    manifest = load_edition_manifest(edition)
    if not manifest["features"]["summary.local_stt"]:
        return ()
    return tuple(manifest["packaging"]["local_stt_providers"])


def faster_whisper_model_ids(edition: str | None = None) -> tuple[str, ...]:
    manifest = load_edition_manifest(edition)
    if "Local (faster-whisper)" not in allowed_local_stt_providers(edition):
        return ()
    return tuple(manifest["packaging"]["faster_whisper_model_ids"])


def whisper_cpp_model_ids(edition: str | None = None) -> tuple[str, ...]:
    manifest = load_edition_manifest(edition)
    if "Local (whisper.cpp Vulkan)" not in allowed_local_stt_providers(edition):
        return ()
    return tuple(manifest["packaging"]["whisper_cpp_model_ids"])


def directml_whisper_model_ids(edition: str | None = None) -> tuple[str, ...]:
    manifest = load_edition_manifest(edition)
    if "Local (DirectML)" not in allowed_local_stt_providers(edition):
        return ()
    return tuple(manifest["packaging"]["directml_whisper_model_ids"])


def require_local_stt_provider(provider: str, edition: str | None = None) -> None:
    manifest = load_edition_manifest(edition)
    require_feature("summary.local_stt", edition)
    if str(provider or "").strip() not in allowed_local_stt_providers(edition):
        raise EditionFeatureDisabled(
            f"summary.local_stt.provider.{str(provider or 'unknown').strip() or 'unknown'}",
            str(manifest["id"]),
        )


def require_faster_whisper_model(model_id: str, edition: str | None = None) -> None:
    manifest = load_edition_manifest(edition)
    require_local_stt_provider("Local (faster-whisper)", edition)
    if str(model_id or "").strip() not in faster_whisper_model_ids(edition):
        raise EditionFeatureDisabled(
            f"summary.local_stt.model.{str(model_id or 'unknown').strip() or 'unknown'}",
            str(manifest["id"]),
        )


def require_whisper_cpp_model(model_id: str, edition: str | None = None) -> None:
    manifest = load_edition_manifest(edition)
    require_local_stt_provider("Local (whisper.cpp Vulkan)", edition)
    allowed = set(whisper_cpp_model_ids(edition))
    candidate = str(model_id or "").strip()
    alias_map = {
        "large-v3": "large-v3-fp16",
        "large-v3-turbo": "large-v3-turbo-fp16",
    }
    resolved = alias_map.get(candidate, candidate)
    if candidate not in allowed and resolved not in allowed:
        raise EditionFeatureDisabled(
            f"summary.local_stt.model.{candidate or 'unknown'}",
            str(manifest["id"]),
        )


def require_directml_whisper_model(model_id: str, edition: str | None = None) -> None:
    manifest = load_edition_manifest(edition)
    require_local_stt_provider("Local (DirectML)", edition)
    if str(model_id or "").strip() not in directml_whisper_model_ids(edition):
        raise EditionFeatureDisabled(
            f"summary.local_stt.model.{str(model_id or 'unknown').strip() or 'unknown'}",
            str(manifest["id"]),
        )


@lru_cache(maxsize=None)
def _load_manifest_by_id(edition: str) -> dict[str, Any]:
    checked = []
    for candidate in _manifest_candidates(edition):
        path = candidate.resolve()
        checked.append(str(path))
        if not path.is_file():
            continue
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise EditionManifestError(f"Cannot read edition manifest {path}: {error}") from error
        if not isinstance(manifest, dict):
            raise EditionManifestError(f"Edition manifest must be a JSON object: {path}")
        validated = _validate_manifest(manifest, edition)
        validated["_source_path"] = str(path)
        return validated
    raise EditionManifestError(
        f"Edition manifest for '{edition}' was not found. Checked: {', '.join(checked)}"
    )


def load_edition_manifest(edition: str | None = None) -> dict[str, Any]:
    return deepcopy(_load_manifest_by_id(canonical_edition_id(edition)))


def feature_enabled(feature: str, edition: str | None = None) -> bool:
    manifest = load_edition_manifest(edition)
    return bool(manifest["features"].get(str(feature), False))


def require_feature(feature: str, edition: str | None = None) -> None:
    manifest = load_edition_manifest(edition)
    if not manifest["features"].get(str(feature), False):
        raise EditionFeatureDisabled(str(feature), str(manifest["id"]))


def summary_task_allowed(task_type: str, edition: str | None = None) -> bool:
    manifest = load_edition_manifest(edition)
    return str(task_type or "").strip() in set(manifest["allowed_summary_task_types"])


def require_summary_task(task_type: str, edition: str | None = None) -> None:
    manifest = load_edition_manifest(edition)
    normalized = str(task_type or "").strip()
    if normalized not in set(manifest["allowed_summary_task_types"]):
        feature = SUMMARY_TASK_FEATURES.get(normalized, f"summary.task.{normalized or 'unknown'}")
        raise EditionFeatureDisabled(feature, str(manifest["id"]))


def manifest_sha256(edition: str | None = None) -> str:
    manifest = load_edition_manifest(edition)
    payload = {key: value for key, value in manifest.items() if not key.startswith("_")}
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# api_server에서 이동: 에디션 매니페스트 싱글턴과 파생 정책
EDITION_MANIFEST = load_edition_manifest()
LOCAL_AI_SETTINGS_ENABLED = str(EDITION_MANIFEST.get("id") or "") in {"developer", "personal"}
def faster_whisper_model_options() -> list[str]:
    return list(faster_whisper_model_ids())


def directml_whisper_model_options() -> list[str]:
    return list(directml_whisper_model_ids())


def whisper_cpp_model_options() -> list[str]:
    return list(whisper_cpp_model_ids())
