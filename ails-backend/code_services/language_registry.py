from __future__ import annotations

import hashlib
import glob
import io
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
import zipfile
from pathlib import PurePosixPath
from urllib.parse import quote, urlparse


from .language_profiles import (
    PROFILE_ID_RE,
    language_packs_dir,
    load_language_profiles,
    save_language_profile,
)
from .language_recipes import code_runner_recipe, recipe_executables


OPEN_VSX_SEARCH_URL = "https://open-vsx.org/api/-/search"
OPEN_VSX_API_ROOT = "https://open-vsx.org/api"
MISE_REGISTRY_URL = "https://api.github.com/repos/jdx/mise/contents/registry"
MASON_RELEASE_URL = "https://api.github.com/repos/mason-org/mason-registry/releases/latest"
CODE_RUNNER_LATEST_URL = "https://open-vsx.org/api/formulahendry/code-runner/latest"
_USER_AGENT = "AILS-language-registry/1.0"
_ALLOWED_DOWNLOAD_HOSTS = {
    "open-vsx.org", "github.com", "api.github.com", "raw.githubusercontent.com",
    "objects.githubusercontent.com", "release-assets.githubusercontent.com",
}
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_CACHE_TTL_SECONDS = 30 * 60
_MAX_EXTENSION_BYTES = 50 * 1024 * 1024
_MAX_TOOL_BYTES = 300 * 1024 * 1024
_MAX_ASSET_BYTES = 8 * 1024 * 1024
_cache_lock = threading.RLock()
_cache: dict[str, tuple[float, object]] = {}
_jobs_lock = threading.RLock()
_jobs: dict[str, dict] = {}
_active_job_id = ""
_BLOCKED_COMMAND_EXECUTABLES = {
    "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "sh", "bash",
    "wscript", "wscript.exe", "cscript", "cscript.exe", "mshta", "mshta.exe", "rundll32", "rundll32.exe",
}


def _cache_get(key: str):
    with _cache_lock:
        item = _cache.get(key)
        if item and time.monotonic() - item[0] < _CACHE_TTL_SECONDS:
            return item[1]
    return None


def _cache_set(key: str, value):
    with _cache_lock:
        _cache[key] = (time.monotonic(), value)
    return value


def _request_json(url: str, *, params: dict | None = None):
    import requests
    response = requests.get(
        url,
        params=params,
        headers={"Accept": "application/json", "User-Agent": _USER_AGENT},
        timeout=(8, 30),
    )
    response.raise_for_status()
    return response.json()


def _assert_download_url(url: str) -> None:
    parsed = urlparse(str(url or ""))
    if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_DOWNLOAD_HOSTS:
        raise ValueError("The registry returned an unsupported download address.")


def _download_bytes(url: str, *, max_bytes: int) -> bytes:
    import requests
    _assert_download_url(url)
    with requests.get(url, headers={"User-Agent": _USER_AGENT}, stream=True, timeout=(10, 120)) as response:
        response.raise_for_status()
        declared = int(response.headers.get("Content-Length") or 0)
        if declared > max_bytes:
            raise ValueError("The registry asset is larger than the allowed limit.")
        chunks = []
        size = 0
        for chunk in response.iter_content(1024 * 256):
            if not chunk:
                continue
            size += len(chunk)
            if size > max_bytes:
                raise ValueError("The registry asset is larger than the allowed limit.")
            chunks.append(chunk)
        return b"".join(chunks)


def _openvsx_search(query: str) -> list[dict]:
    payload = _request_json(
        OPEN_VSX_SEARCH_URL,
        params={"query": query, "size": 10, "category": "Programming Languages"},
    )
    extensions = []
    for item in payload.get("extensions", []):
        namespace = str(item.get("namespace", ""))
        name = str(item.get("name", ""))
        version = str(item.get("version", ""))
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", namespace) or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            continue
        extensions.append({
            "id": f"{namespace}.{name}",
            "namespace": namespace,
            "name": name,
            "version": version,
            "label": item.get("displayName") or name,
            "description": item.get("description") or "",
            "verified": bool(item.get("verified")),
            "deprecated": bool(item.get("deprecated")),
            "downloads": int(item.get("downloadCount") or 0),
            "updated_at": item.get("timestamp") or "",
            "icon_url": (item.get("files") or {}).get("icon") or "",
            "source": "openvsx",
        })
    lowered = query.lower().strip()

    def relevance(item: dict) -> int:
        name = str(item["name"]).lower()
        label = str(item["label"]).lower()
        extension_id = str(item["id"]).lower()
        if lowered in {name, label}:
            return 0
        if name.startswith(lowered) or label.startswith(lowered):
            return 1
        if lowered in name or lowered in label or lowered in extension_id:
            return 2
        return 3

    extensions.sort(
        key=lambda item: (item["deprecated"], relevance(item), not item["verified"], -item["downloads"])
    )
    return extensions


def _mise_registry() -> list[dict]:
    cached = _cache_get("mise-registry")
    if cached is not None:
        return cached
    payload = _request_json(MISE_REGISTRY_URL)
    runtimes = []
    for item in payload if isinstance(payload, list) else []:
        name = str(item.get("name", ""))
        if not name.endswith(".toml"):
            continue
        tool_id = name[:-5]
        if re.fullmatch(r"[A-Za-z0-9_.+-]+", tool_id):
            runtimes.append({
                "id": tool_id,
                "label": tool_id,
                "description": "mise registry runtime",
                "version": "latest",
                "install_supported": os.name == "nt",
                "source": "mise",
            })
    return _cache_set("mise-registry", runtimes)


def _mason_registry() -> list[dict]:
    cached = _cache_get("mason-registry")
    if cached is not None:
        return cached
    release = _request_json(MASON_RELEASE_URL)
    assets = {item.get("name"): item for item in release.get("assets", [])}
    archive_asset = assets.get("registry.json.zip")
    checksums_asset = assets.get("checksums.txt")
    if not archive_asset or not checksums_asset:
        raise RuntimeError("The Mason registry release is missing its signed asset list.")
    archive = _download_bytes(archive_asset.get("browser_download_url", ""), max_bytes=10 * 1024 * 1024)
    checksums = _download_bytes(checksums_asset.get("browser_download_url", ""), max_bytes=1024 * 1024).decode(
        "utf-8", errors="replace"
    )
    expected_match = re.search(r"\b([a-fA-F0-9]{64})\s+\*?registry\.json\.zip\b", checksums)
    if not expected_match or hashlib.sha256(archive).hexdigest().lower() != expected_match.group(1).lower():
        raise RuntimeError("Mason registry checksum verification failed.")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        registry = json.loads(bundle.read("registry.json").decode("utf-8"))
    result = registry if isinstance(registry, list) else []
    return _cache_set("mason-registry", result)


def _mason_install_supported(package: dict) -> bool:
    source = package.get("source") or {}
    if not isinstance(source, dict):
        return False
    source_id = str(source.get("id", ""))
    assets = source.get("asset") or []
    if not re.fullmatch(r"pkg:github/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[^\s]+", source_id):
        return False
    return any(
        isinstance(item, dict)
        and str(item.get("target", "")) in {"win_x64", "win"}
        and str(item.get("file", "")).lower().endswith(".zip")
        for item in assets
    )


def _search_mise(query: str) -> list[dict]:
    lowered = query.lower().replace(" ", "-")
    matches = [item for item in _mise_registry() if lowered in item["id"].lower()]
    matches.sort(key=lambda item: (item["id"].lower() != lowered, len(item["id"])))
    return matches[:10]


def _search_mason(query: str) -> list[dict]:
    lowered = query.lower()
    matches = []
    for package in _mason_registry():
        if not isinstance(package, dict):
            continue
        languages = [str(item) for item in package.get("languages", [])]
        categories = [str(item) for item in package.get("categories", [])]
        haystack = " ".join([str(package.get("name", "")), str(package.get("description", "")), *languages]).lower()
        if lowered not in haystack or "LSP" not in categories:
            continue
        source = package.get("source") or {}
        source_id = str(source.get("id", "")) if isinstance(source, dict) else ""
        version = source_id.rsplit("@", 1)[-1] if "@" in source_id else ""
        matches.append({
            "id": package.get("name", ""),
            "label": package.get("name", ""),
            "description": package.get("description", ""),
            "languages": languages,
            "version": version,
            "homepage": package.get("homepage", ""),
            "licenses": package.get("licenses", []),
            "install_supported": os.name == "nt" and _mason_install_supported(package),
            "source": "mason",
        })
    def relevance(item: dict) -> tuple[int, str]:
        package_id = item["id"].lower()
        languages = [language.lower() for language in item["languages"]]
        if package_id in {f"{lowered}-lsp", f"{lowered}-language-server"}:
            return 0, package_id
        if lowered in package_id and languages == [lowered]:
            return 1, package_id
        if lowered in package_id:
            return 2, package_id
        if languages == [lowered]:
            return 3, package_id
        return 4, package_id

    matches.sort(key=relevance)
    return matches[:10]


_LANGUAGE_QUERY_ALIASES = {
    "c++": "cpp",
    "c#": "csharp",
    "f#": "fsharp",
    "objective c": "objective-c",
    "objective-c": "objective-c",
    "visual basic": "vb",
}

_RUNTIME_PROVIDER_HINTS = {
    "erlang": ["erlang"],
    "haskell": ["ghc"],
    "kotlin": ["kotlin"],
    "r": ["r"],
}


def _recipe_runtime_candidates(recipe: dict) -> list[str]:
    language_id = str(recipe.get("language_id", "")).lower()
    result = []
    for candidate in [*_RUNTIME_PROVIDER_HINTS.get(language_id, []), *recipe.get("executables", [])]:
        normalized = str(candidate).strip().lower()
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def _recipe_preview(query: str) -> dict:
    language_id = _LANGUAGE_QUERY_ALIASES.get(query.strip().lower(), query.strip().lower().replace(" ", "-"))
    commands = None
    source = ""
    version = ""
    try:
        registry = _code_runner_registry()
        if registry.get("verified_publisher"):
            commands = code_runner_recipe(language_id, [], registry["executor_map"], registry["extension_map"])
            if commands:
                source = "openvsx-code-runner"
                version = registry["version"]
    except Exception:
        pass
    if not commands:
        fallback = _trusted_fallback_recipe(language_id, language_id)
        commands = (fallback or {}).get("commands")
        if commands:
            source = "ails-reviewed"
    return {
        "available": bool(commands),
        "language_id": language_id,
        "source": source,
        "version": version,
        "executables": recipe_executables(commands or {}),
    }


def search_language_registry(query: str) -> dict:
    normalized = str(query or "").strip()
    if len(normalized) < 1 or len(normalized) > 80:
        raise ValueError("Enter 1-80 characters to search for a language.")
    errors = []

    def collect(name: str, callback):
        try:
            return callback(normalized)
        except Exception as error:
            errors.append({"source": name, "error": str(error)})
            return []

    extensions = collect("openvsx", _openvsx_search)
    runtimes = collect("mise", _search_mise)
    language_servers = collect("mason", _search_mason)
    try:
        recipe = _recipe_preview(normalized)
    except Exception as error:
        errors.append({"source": "recipes", "error": str(error)})
        recipe = {"available": False, "language_id": normalized.lower(), "source": "", "version": "", "executables": []}
    recommended_runtime_id = ""
    candidate_ids = _recipe_runtime_candidates(recipe) if recipe.get("available") else []
    try:
        runtime_by_id = {item["id"].lower(): item for item in _mise_registry()}
        selected_ids = {item["id"].lower() for item in runtimes}
        for candidate in candidate_ids:
            match = runtime_by_id.get(candidate)
            if match and candidate not in selected_ids:
                runtimes.append(dict(match))
                selected_ids.add(candidate)
    except Exception as error:
        if not any(item["source"] == "mise" for item in errors):
            errors.append({"source": "mise", "error": str(error)})
    for candidate in candidate_ids:
        match = next((item for item in runtimes if item["id"].lower() == candidate), None)
        if match:
            recommended_runtime_id = match["id"]
            break
    runtimes.sort(key=lambda item: (item["id"] != recommended_runtime_id, item["id"].lower()))
    for runtime in runtimes:
        runtime["recommended"] = runtime["id"] == recommended_runtime_id

    return {
        "query": normalized,
        "extensions": extensions,
        "runtimes": runtimes,
        "language_servers": language_servers,
        "recipe": recipe,
        "recommended_runtime_id": recommended_runtime_id,
        "errors": errors,
        "sources": [
            {"id": "openvsx", "label": "Open VSX", "purpose": "syntax"},
            {"id": "mise", "label": "mise", "purpose": "runtime"},
            {"id": "mason", "label": "Mason", "purpose": "language_server"},
        ],
    }


def _openvsx_metadata(extension_id: str, version: str) -> dict:
    match = re.fullmatch(r"([A-Za-z0-9_.-]+)\.([A-Za-z0-9_.-]+)", str(extension_id or ""))
    if not match or not re.fullmatch(r"[A-Za-z0-9_.+-]+", str(version or "")):
        raise ValueError("Invalid Open VSX extension reference.")
    namespace, name = match.groups()
    return _request_json(
        f"{OPEN_VSX_API_ROOT}/{quote(namespace)}/{quote(name)}/{quote(version)}"
    )


def _verify_openvsx_archive(metadata: dict, archive: bytes) -> str:
    sha_url = str((metadata.get("files") or {}).get("sha256", ""))
    if not sha_url:
        raise RuntimeError("Open VSX did not provide a checksum for this extension.")
    checksum_text = _download_bytes(sha_url, max_bytes=16 * 1024).decode("ascii", errors="ignore")
    match = re.search(r"\b[a-fA-F0-9]{64}\b", checksum_text)
    actual = hashlib.sha256(archive).hexdigest()
    if not match or match.group(0).lower() != actual:
        raise RuntimeError("Open VSX extension checksum verification failed.")
    return actual


def _code_runner_registry() -> dict:
    cached = _cache_get("code-runner-recipes")
    if cached is not None:
        return cached
    metadata = _request_json(CODE_RUNNER_LATEST_URL)
    archive = _download_bytes(str((metadata.get("files") or {}).get("download", "")), max_bytes=_MAX_EXTENSION_BYTES)
    archive_hash = _verify_openvsx_archive(metadata, archive)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        manifest = json.loads(_read_zip_member(bundle, "extension/package.json").decode("utf-8"))
    properties = (((manifest.get("contributes") or {}).get("configuration") or {}).get("properties") or {})
    executor_map = ((properties.get("code-runner.executorMap") or {}).get("default") or {})
    extension_map = ((properties.get("code-runner.executorMapByFileExtension") or {}).get("default") or {})
    if not isinstance(executor_map, dict) or not isinstance(extension_map, dict):
        raise RuntimeError("Code Runner did not provide declarative executor maps.")
    return _cache_set("code-runner-recipes", {
        "version": str(metadata.get("version", "")),
        "sha256": archive_hash,
        "verified_publisher": bool(metadata.get("verified")),
        "executor_map": executor_map,
        "extension_map": extension_map,
    })


def _external_code_runner_recipe(language_id: str, extensions: list[str]) -> tuple[dict | None, dict | None]:
    registry = _code_runner_registry()
    if not registry.get("verified_publisher"):
        return None, None
    commands = code_runner_recipe(
        language_id,
        extensions,
        registry["executor_map"],
        registry["extension_map"],
    )
    if not commands:
        return None, None
    return commands, {
        "registry": "openvsx-code-runner",
        "extension_id": "formulahendry.code-runner",
        "version": registry["version"],
        "sha256": registry["sha256"],
        "executables": recipe_executables(commands),
    }


def _read_zip_member(bundle: zipfile.ZipFile, member_name: str, *, max_bytes: int = _MAX_ASSET_BYTES) -> bytes:
    normalized = PurePosixPath(str(member_name or "").replace("\\", "/"))
    if normalized.is_absolute() or ".." in normalized.parts:
        raise ValueError("The extension contains an unsafe asset path.")
    info = bundle.getinfo(normalized.as_posix())
    if info.file_size > max_bytes:
        raise ValueError("The extension language asset is too large.")
    return bundle.read(info)


def _safe_pack_id(extension_id: str, language_id: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_.-]+", "-", f"{extension_id}-{language_id}").strip(".-")
    return value[:120]


def _normalize_profile_id(language_id: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", str(language_id or "").lower()).strip("-_")
    if not value or not value[0].isalpha():
        value = f"lang-{value}"
    if value in {"python", "c", "cpp", "csharp", "javascript", "typescript", "java", "go", "rust", "lua"}:
        value = f"{value}-openvsx"
    value = value[:48]
    if not PROFILE_ID_RE.fullmatch(value):
        raise ValueError("The extension language ID cannot be converted into an AILS profile ID.")
    return value


def _remote_commands_are_safe(
    commands: dict,
    *,
    verified_publisher: bool,
    runtime_id: str,
    language_id: str,
) -> bool:
    if not verified_publisher or not runtime_id or not isinstance(commands, dict):
        return False
    expected = {runtime_id.lower(), language_id.lower()}
    def safe_step(value: dict, allowed_executables: set[str]) -> bool:
        if not isinstance(value, dict):
            return False
        executable = str(value.get("executable", "")).strip().lower()
        arguments = value.get("arguments")
        if (
            not executable
            or executable in _BLOCKED_COMMAND_EXECUTABLES
            or "/" in executable
            or "\\" in executable
            or executable not in allowed_executables
            or not isinstance(arguments, list)
            or not all(isinstance(item, str) for item in arguments)
        ):
            return False
        for argument in arguments:
            lowered = argument.strip().lower()
            if lowered in {"-c", "/c", "-e", "--eval", "--command"} or lowered.startswith(("--eval=", "--command=")):
                return False
        prepare = value.get("prepare", [])
        return isinstance(prepare, list) and all(safe_step(step, allowed_executables) for step in prepare)

    for value in commands.values():
        if not safe_step(value, expected):
            return False
        variants = value.get("by_extension") or {}
        if not isinstance(variants, dict):
            return False
        for variant in variants.values():
            if not safe_step(variant, expected):
                return False
    return True


def _trusted_fallback_recipe(language_id: str, runtime_id: str) -> dict | None:
    if language_id.lower() == "elixir" and runtime_id.lower() == "elixir":
        return {
            "commands": {
                "run": {"executable": "elixir", "arguments": ["{file}"]},
            },
            "template": 'IO.puts("Hello Elixir!")\n',
        }
    if language_id.lower() != "kotlin" or runtime_id.lower() != "kotlin":
        return None
    output_jar = "{work_dir}/ails-kotlin.jar"
    return {
        "commands": {
            "run": {
                "executable": "java",
                "arguments": ["-jar", output_jar],
                "prepare": [{
                    "executable": "kotlinc",
                    "arguments": ["{file}", "-include-runtime", "-d", output_jar],
                }],
                "by_extension": {
                    "kts": {
                        "executable": "kotlinc",
                        "arguments": ["-script", "{file}"],
                    }
                },
            },
            "build": {
                "executable": "kotlinc",
                "arguments": ["{file}", "-include-runtime", "-d", output_jar],
            },
        },
        "template": 'fun main() {\n    println("Hello Kotlin!")\n}\n',
    }


def _write_json_asset(pack_dir: str, name: str, value) -> str:
    os.makedirs(pack_dir, exist_ok=True)
    path = os.path.join(pack_dir, name)
    temp_path = f"{path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)
    return name


def _select_language(manifest: dict, preferred: str) -> dict:
    languages = ((manifest.get("contributes") or {}).get("languages") or [])
    candidates = [item for item in languages if isinstance(item, dict) and item.get("id") and item.get("extensions")]
    lowered = str(preferred or "").strip().lower()
    if lowered:
        for item in candidates:
            aliases = [str(alias).lower() for alias in item.get("aliases", [])]
            if str(item.get("id", "")).lower() == lowered or lowered in aliases:
                return item
    if not candidates:
        raise ValueError("This Open VSX extension does not declare a file language.")
    return candidates[0]


def _install_openvsx_extension(extension_id: str, version: str, preferred_language: str, runtime_id: str) -> dict:
    metadata = _openvsx_metadata(extension_id, version)
    download_url = str((metadata.get("files") or {}).get("download", ""))
    archive = _download_bytes(download_url, max_bytes=_MAX_EXTENSION_BYTES)
    archive_hash = _verify_openvsx_archive(metadata, archive)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        manifest = json.loads(_read_zip_member(bundle, "extension/package.json").decode("utf-8"))
        language = _select_language(manifest, preferred_language)
        language_id = str(language["id"])
        profile_id = _normalize_profile_id(language_id)
        pack_id = _safe_pack_id(extension_id, language_id)
        pack_dir = os.path.join(language_packs_dir(), pack_id)
        extensions = []
        for item in language.get("extensions", []):
            extension = str(item).lower().lstrip(".")
            if extension and re.fullmatch(r"[a-z0-9][a-z0-9_+-]{0,31}", extension) and extension not in extensions:
                extensions.append(extension)
        if not extensions:
            raise ValueError("The extension does not declare usable file extensions.")

        grammar_metadata = None
        for grammar in ((manifest.get("contributes") or {}).get("grammars") or []):
            if not isinstance(grammar, dict) or grammar.get("language") != language_id:
                continue
            grammar_path = str(grammar.get("path", ""))
            if not grammar_path.lower().endswith(".json"):
                continue
            grammar_json = json.loads(_read_zip_member(bundle, f"extension/{grammar_path.lstrip('./')}").decode("utf-8"))
            grammar_name = _write_json_asset(pack_dir, "grammar.json", grammar_json)
            grammar_metadata = {
                "pack_id": pack_id,
                "grammar": grammar_name,
                "scope_name": grammar.get("scopeName") or grammar_json.get("scopeName") or f"source.{language_id}",
            }
            break

        configuration_path = str(language.get("configuration", ""))
        if configuration_path:
            configuration_json = json.loads(
                _read_zip_member(bundle, f"extension/{configuration_path.lstrip('./')}").decode("utf-8")
            )
            configuration_name = _write_json_asset(pack_dir, "language-configuration.json", configuration_json)
            grammar_metadata = grammar_metadata or {"pack_id": pack_id}
            grammar_metadata["configuration"] = configuration_name

        pack_spec = None
        for candidate in ("extension/ails-language.json", "ails-language.json"):
            try:
                pack_spec = json.loads(_read_zip_member(bundle, candidate, max_bytes=256 * 1024).decode("utf-8"))
                break
            except KeyError:
                continue

    aliases = [str(item) for item in language.get("aliases", []) if str(item).strip()]
    label = aliases[0] if aliases else language_id
    selected_spec = None
    if isinstance(pack_spec, dict):
        profiles = pack_spec.get("profiles")
        if isinstance(profiles, dict):
            selected_spec = profiles.get(language_id)
        if not isinstance(selected_spec, dict):
            selected_spec = pack_spec.get("profile")
    selected_spec = dict(selected_spec) if isinstance(selected_spec, dict) else {}
    commands = selected_spec.get("commands")
    trusted_recipe = None
    recipe_source = None
    fallback_recipe = _trusted_fallback_recipe(language_id, runtime_id)
    if not isinstance(commands, dict):
        try:
            external_commands, recipe_source = _external_code_runner_recipe(language_id, extensions)
        except Exception:
            external_commands, recipe_source = None, None
        trusted_recipe = {"commands": external_commands} if external_commands else fallback_recipe
        commands = (trusted_recipe or {}).get("commands") or {
            "run": {"executable": runtime_id or language_id, "arguments": ["{file}"]}
        }
    commands_are_safe = _remote_commands_are_safe(
        commands,
        verified_publisher=bool(metadata.get("verified")),
        runtime_id=runtime_id,
        language_id=language_id,
    )
    profile = {
        "id": selected_spec.get("id") or profile_id,
        "label": selected_spec.get("label") or label,
        "extensions": selected_spec.get("extensions") or extensions,
        "commands": commands,
        "command_state": "ready" if (selected_spec.get("commands") and commands_are_safe) or (trusted_recipe and runtime_id) else "needs_review",
        "template": selected_spec.get("template", (fallback_recipe or {}).get("template", "")),
        "version_arguments": selected_spec.get("version_arguments", ["--version"]),
        "source": {
            "registry": "openvsx",
            "extension_id": extension_id,
            "version": version,
            "sha256": archive_hash,
            "verified_publisher": bool(metadata.get("verified")),
        },
    }
    if grammar_metadata:
        profile["syntax"] = grammar_metadata
    if runtime_id:
        profile["runtime"] = {"manager": "mise", "tool": runtime_id, "version": "latest"}
    if recipe_source:
        profile["source"]["execution_recipe"] = recipe_source
    return profile


def _find_mise() -> str:
    resolved = shutil.which("mise") or shutil.which("mise.exe")
    if resolved:
        return os.path.abspath(resolved)
    for pattern in (
        r"%LOCALAPPDATA%\Microsoft\WinGet\Links\mise.exe",
        r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\jdx.mise_*\mise\bin\mise.exe",
        r"%LOCALAPPDATA%\Programs\mise\bin\mise.exe",
        r"%USERPROFILE%\scoop\shims\mise.exe",
    ):
        expanded = os.path.expandvars(pattern)
        for candidate in sorted(glob.glob(expanded), reverse=True):
            if os.path.isfile(candidate):
                return os.path.abspath(candidate)
    return ""


def _update_job(job_id: str, **changes) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(changes)


def _append_output(job_id: str, value: str) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id]["output"] = f"{_jobs[job_id].get('output', '')}{value}"[-12_000:]


def _run_process(job_id: str, command: list[str], timeout_seconds: int) -> None:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_CREATE_NO_WINDOW,
    )
    try:
        output, _ = process.communicate(timeout=timeout_seconds)
        _append_output(job_id, output or "")
        if process.returncode != 0:
            raise RuntimeError(f"Command failed with code {process.returncode}.\n{(output or '')[-2000:]}")
    except subprocess.TimeoutExpired:
        process.kill()
        output, _ = process.communicate()
        _append_output(job_id, output or "")
        raise TimeoutError("Language tool installation timed out.")


def _install_mise_runtime(job_id: str, runtime_id: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.+-]+", runtime_id):
        raise ValueError("Invalid mise runtime ID.")
    valid_ids = {item["id"] for item in _mise_registry()}
    if runtime_id not in valid_ids:
        raise ValueError("The requested runtime is not present in the mise registry.")
    mise = _find_mise()
    if not mise:
        winget = shutil.which("winget")
        if os.name != "nt" or not winget:
            raise RuntimeError("mise is not installed and WinGet is unavailable.")
        _append_output(job_id, "Installing mise with WinGet...\n")
        _run_process(job_id, [
            winget, "install", "--id", "jdx.mise", "--exact", "--source", "winget", "--silent",
            "--disable-interactivity", "--accept-package-agreements", "--accept-source-agreements",
        ], 900)
        mise = _find_mise()
    if not mise:
        raise RuntimeError("mise was installed, but AILS could not locate mise.exe. Restart AILS and retry.")
    _append_output(job_id, f"Installing {runtime_id}@latest with mise...\n")
    _run_process(job_id, [mise, "install", f"{runtime_id}@latest"], 1800)


def _validate_profile_toolchain(profile: dict) -> dict:
    runtime = profile.get("runtime") or {}
    if runtime.get("manager") != "mise":
        return {"checked": False, "executables": []}
    mise = _find_mise()
    if not mise:
        raise RuntimeError("mise could not be located after runtime installation.")
    tool = str(runtime.get("tool", ""))
    version = str(runtime.get("version", "latest"))
    completed = subprocess.run(
        [mise, "where", f"{tool}@{version}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
        creationflags=_CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{tool}@{version} was not found after installation.\n{completed.stderr[-1000:]}")
    executables = recipe_executables(profile.get("commands") or {}) if profile.get("command_state") == "ready" else []
    resolved = {}
    for executable in executables:
        lookup = subprocess.run(
            [mise, "exec", f"{tool}@{version}", "--", "where.exe", executable],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            creationflags=_CREATE_NO_WINDOW,
        )
        paths = [line.strip() for line in (lookup.stdout or "").splitlines() if line.strip()]
        if lookup.returncode != 0 or not paths:
            raise RuntimeError(
                f"The {tool} runtime does not provide the required executable '{executable}'. "
                "Choose a different runtime or execution recipe."
            )
        resolved[executable] = paths[0]
    return {
        "checked": True,
        "runtime_path": (completed.stdout or "").strip(),
        "executables": resolved,
    }


def _mason_package(package_id: str) -> dict:
    normalized = str(package_id or "").strip()
    package = next(
        (item for item in _mason_registry() if isinstance(item, dict) and item.get("name") == normalized),
        None,
    )
    if not package or not _mason_install_supported(package):
        raise ValueError("This Mason language server cannot be installed automatically on Windows.")
    return package


def _install_mason_package(package_id: str, profile_id: str) -> dict:
    package = _mason_package(package_id)
    source = package["source"]
    source_match = re.fullmatch(r"pkg:github/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)@([^\s]+)", source["id"])
    if not source_match:
        raise ValueError("Unsupported Mason package source.")
    owner, repo, version = source_match.groups()
    asset = next(
        item for item in source["asset"]
        if isinstance(item, dict)
        and str(item.get("target", "")) in {"win_x64", "win"}
        and str(item.get("file", "")).lower().endswith(".zip")
    )
    file_name = str(asset["file"]).replace("{{ version }}", version).replace("{{version}}", version)
    if not re.fullmatch(r"[A-Za-z0-9_.+()-]+\.zip", file_name):
        raise ValueError("Unsupported Mason asset filename template.")
    archive = _download_bytes(
        f"https://github.com/{owner}/{repo}/releases/download/{quote(version, safe='')}/{quote(file_name, safe='')}",
        max_bytes=_MAX_TOOL_BYTES,
    )
    destination = os.path.join(language_packs_dir(), f"{profile_id}-tools", package_id)
    os.makedirs(destination, exist_ok=True)
    extracted_bytes = 0
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for info in bundle.infolist():
            relative = PurePosixPath(info.filename.replace("\\", "/"))
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("The language server archive contains an unsafe path.")
            target = os.path.abspath(os.path.join(destination, *relative.parts))
            if os.path.commonpath([os.path.abspath(destination), target]) != os.path.abspath(destination):
                raise ValueError("The language server archive contains an unsafe path.")
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            extracted_bytes += info.file_size
            if info.file_size > _MAX_TOOL_BYTES or extracted_bytes > _MAX_TOOL_BYTES:
                raise ValueError("A language server file exceeds the allowed limit.")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with bundle.open(info) as source_handle, open(target, "wb") as target_handle:
                shutil.copyfileobj(source_handle, target_handle)
    requested_bin = str(asset.get("bin") or "")
    requested_name = os.path.basename(requested_bin.replace("{{source.asset.bin}}", ""))
    candidates = []
    for root, _dirs, files in os.walk(destination):
        for name in files:
            if name.lower().endswith((".exe", ".bat", ".cmd")) and (not requested_name or name.lower() == requested_name.lower()):
                candidates.append(os.path.join(root, name))
    executable = candidates[0] if candidates else ""
    return {
        "manager": "mason-registry",
        "package": package_id,
        "version": version,
        "executable_path": executable,
        "installed": bool(executable),
    }


def _job_snapshot(job: dict) -> dict:
    now = time.time()
    finished = float(job.get("finished_at") or 0)
    started = float(job.get("started_at") or job.get("created_at") or now)
    return {
        **job,
        "elapsed_seconds": max(0.0, (finished or now) - started),
    }


def _run_install_job(job_id: str, request: dict) -> None:
    global _active_job_id
    _update_job(job_id, status="running", phase="downloading_syntax", progress_percent=5, started_at=time.time())
    try:
        extension = request.get("extension") or {}
        runtime_id = str(request.get("runtime_id", "") or "").strip()
        server_id = str(request.get("language_server_id", "") or "").strip()
        profile = _install_openvsx_extension(
            str(extension.get("id", "")),
            str(extension.get("version", "")),
            str(request.get("language_id", "")),
            runtime_id,
        )
        _update_job(job_id, phase="installing_runtime", progress_percent=35)
        if runtime_id:
            _install_mise_runtime(job_id, runtime_id)
        _update_job(job_id, phase="installing_language_server", progress_percent=72)
        if server_id:
            profile["language_server"] = _install_mason_package(server_id, profile["id"])
        _update_job(job_id, phase="verifying_toolchain", progress_percent=88)
        verification = _validate_profile_toolchain(profile)
        profile["verification"] = verification
        _update_job(job_id, phase="registering_profile", progress_percent=96)
        saved = save_language_profile(profile)
        _update_job(
            job_id,
            status="completed",
            phase="completed",
            progress_percent=100,
            finished_at=time.time(),
            profile=saved,
        )
    except Exception as error:
        _update_job(job_id, status="failed", phase="failed", finished_at=time.time(), error=str(error))
    finally:
        with _jobs_lock:
            if _active_job_id == job_id:
                _active_job_id = ""


def start_language_pack_install(request: dict) -> dict:
    global _active_job_id
    if not isinstance(request, dict) or not isinstance(request.get("extension"), dict):
        raise ValueError("Select an Open VSX language extension.")
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "status": "queued",
        "phase": "preparing",
        "progress_percent": 0,
        "created_at": time.time(),
        "started_at": None,
        "finished_at": None,
        "output": "",
        "error": "",
        "profile": None,
    }
    with _jobs_lock:
        if _active_job_id:
            active = _jobs.get(_active_job_id)
            if active and active.get("status") in {"queued", "running"}:
                raise RuntimeError("Another language pack is already being installed.")
        _jobs[job_id] = job
        _active_job_id = job_id
    threading.Thread(
        target=_run_install_job,
        args=(job_id, dict(request)),
        daemon=True,
        name=f"ails-language-install-{job_id[:8]}",
    ).start()
    return language_pack_install_status(job_id)


def language_pack_install_status(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(str(job_id or "").strip())
        if not job:
            raise KeyError("Language pack installation job not found.")
        return _job_snapshot(dict(job))


def language_profile_assets(profile_id: str) -> dict:
    normalized = str(profile_id or "").strip().lower()
    profile = next((item for item in load_language_profiles() if item["id"] == normalized), None)
    if not profile:
        raise KeyError("Language profile not found.")
    syntax = profile.get("syntax") or {}
    pack_id = str(syntax.get("pack_id", ""))
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", pack_id):
        return {"profile_id": normalized, "grammar": None, "configuration": None}
    pack_root = os.path.abspath(language_packs_dir())
    profile_root = os.path.abspath(os.path.join(pack_root, pack_id))
    if os.path.commonpath([pack_root, profile_root]) != pack_root:
        raise ValueError("Invalid language pack path.")

    def load_asset(field: str):
        name = str(syntax.get(field, ""))
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", name):
            return None
        path = os.path.abspath(os.path.join(profile_root, name))
        if os.path.commonpath([profile_root, path]) != profile_root or not os.path.isfile(path):
            return None
        if os.path.getsize(path) > _MAX_ASSET_BYTES:
            raise ValueError("Language pack asset is too large.")
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)

    return {
        "profile_id": normalized,
        "scope_name": syntax.get("scope_name") or f"source.{normalized}",
        "grammar": load_asset("grammar"),
        "configuration": load_asset("configuration"),
    }
