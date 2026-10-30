from __future__ import annotations

import json
import glob
import os
import re
import shutil
import subprocess
from pathlib import Path

from edition_manifest import feature_enabled


PROFILE_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
RESERVED_LANGUAGE_IDS = {
    "python", "c", "cpp", "csharp", "javascript", "typescript", "java", "go", "rust", "lua",
}
SUPPORTED_PLACEHOLDERS = (
    "{file}", "{file_name}", "{file_stem}", "{file_stem_path}", "{file_dir}",
    "{work_dir}", "{project_dir}",
)
SUPPORTED_COMMANDS = ("run", "build", "test")
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def language_profiles_path() -> str:
    base = os.environ.get("APPDATA") or os.path.join(str(Path.home()), ".config")
    return os.path.join(base, "AILS", "language_profiles.json")


def language_packs_dir() -> str:
    base = os.environ.get("APPDATA") or os.path.join(str(Path.home()), ".config")
    return os.path.join(base, "AILS", "language-packs")


def _normalize_extensions(value) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("extensions must be an array.")
    result = []
    for item in value:
        extension = str(item or "").strip().lower().lstrip(".")
        if not extension or not re.fullmatch(r"[a-z0-9][a-z0-9_+-]{0,31}", extension):
            raise ValueError(f"Invalid file extension: {item}")
        if extension not in result:
            result.append(extension)
    if not result:
        raise ValueError("At least one file extension is required.")
    return result


def _normalize_string_list(value, field: str, *, limit: int = 48) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{field} must be an array of strings.")
    if len(value) > limit or any(len(item) > 500 for item in value):
        raise ValueError(f"Too many or overly long values in {field}.")
    return list(value)


def _normalize_command_step(raw, field: str) -> dict:
    if not isinstance(raw, dict):
        raise ValueError(f"{field} must be an object.")
    executable = str(raw.get("executable", "")).strip().strip('"')
    if not executable or len(executable) > 500:
        raise ValueError(f"{field}.executable is required.")
    arguments = _normalize_string_list(raw.get("arguments", []), f"{field}.arguments")
    return {"executable": executable, "arguments": arguments}


def _normalize_command(raw, field: str, *, allow_variants: bool = True) -> dict | None:
    if raw in (None, ""):
        return None
    result = _normalize_command_step(raw, f"commands.{field}")
    prepare_raw = raw.get("prepare", [])
    if not isinstance(prepare_raw, list) or len(prepare_raw) > 8:
        raise ValueError(f"commands.{field}.prepare must be an array of up to 8 commands.")
    if prepare_raw:
        result["prepare"] = [
            _normalize_command_step(item, f"commands.{field}.prepare[{index}]")
            for index, item in enumerate(prepare_raw)
        ]
    variants_raw = raw.get("by_extension", {}) if allow_variants else {}
    if variants_raw:
        if not isinstance(variants_raw, dict) or len(variants_raw) > 16:
            raise ValueError(f"commands.{field}.by_extension must be an object with up to 16 entries.")
        variants = {}
        for extension, value in variants_raw.items():
            normalized_extension = str(extension or "").strip().lower().lstrip(".")
            if not re.fullmatch(r"[a-z0-9][a-z0-9_+-]{0,31}", normalized_extension):
                raise ValueError(f"Invalid command extension: {extension}")
            variants[normalized_extension] = _normalize_command(
                value, f"{field}.by_extension.{normalized_extension}", allow_variants=False
            )
        result["by_extension"] = variants
    return result


def _normalize_commands(raw: dict) -> dict:
    commands_raw = raw.get("commands")
    if commands_raw is not None and not isinstance(commands_raw, dict):
        raise ValueError("commands must be an object.")
    commands_raw = dict(commands_raw or {})
    if "run" not in commands_raw and raw.get("executable"):
        commands_raw["run"] = {
            "executable": raw.get("executable"),
            "arguments": raw.get("arguments", ["{file}"]),
        }
    commands = {}
    for action in SUPPORTED_COMMANDS:
        command = _normalize_command(commands_raw.get(action), action)
        if command:
            commands[action] = command
    if not commands:
        raise ValueError("At least one run, build or test command is required.")
    return commands


def _normalize_runtime(value) -> dict | None:
    if value in (None, ""):
        return None
    if not isinstance(value, dict):
        raise ValueError("runtime must be an object.")
    manager = str(value.get("manager", "system") or "system").strip().lower()
    if manager not in {"system", "mise"}:
        raise ValueError("runtime.manager must be 'system' or 'mise'.")
    tool = str(value.get("tool", "")).strip()
    version = str(value.get("version", "latest") or "latest").strip()
    if manager == "mise" and not re.fullmatch(r"[a-zA-Z0-9_.:+/-]{1,120}", tool):
        raise ValueError("A valid mise runtime tool is required.")
    if len(version) > 80 or not re.fullmatch(r"[a-zA-Z0-9_.+/-]{1,80}", version):
        raise ValueError("Invalid runtime version.")
    return {"manager": manager, "tool": tool, "version": version}


def _normalize_metadata(value, field: str) -> dict | None:
    if value in (None, ""):
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object.")
    encoded = json.dumps(value, ensure_ascii=False)
    if len(encoded) > 50_000:
        raise ValueError(f"{field} metadata is too large.")
    return json.loads(encoded)


def validate_language_profile(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Language profile must be an object.")
    profile_id = str(raw.get("id", "")).strip().lower()
    if not PROFILE_ID_RE.fullmatch(profile_id):
        raise ValueError("Profile ID must start with a letter and contain 1-48 lowercase letters, numbers, '_' or '-'.")
    if profile_id in RESERVED_LANGUAGE_IDS:
        raise ValueError("Built-in language IDs cannot be replaced.")
    label = str(raw.get("label", "")).strip()
    if not label or len(label) > 80:
        raise ValueError("A label of 1-80 characters is required.")
    commands = _normalize_commands(raw)
    run_command = commands.get("run") or next(iter(commands.values()))
    version_arguments = _normalize_string_list(
        raw.get("version_arguments", ["--version"]), "version_arguments", limit=8
    )
    template = str(raw.get("template", "") or "")
    if len(template) > 100_000:
        raise ValueError("Template is too large.")
    command_state = str(raw.get("command_state", "ready") or "ready").strip().lower()
    if command_state not in {"ready", "needs_review"}:
        command_state = "needs_review"
    result = {
        "id": profile_id,
        "label": label,
        "extensions": _normalize_extensions(raw.get("extensions", [])),
        "executable": run_command["executable"],
        "arguments": list(run_command["arguments"]),
        "commands": commands,
        "version_arguments": version_arguments,
        "template": template,
        "command_state": command_state,
    }
    for field, normalizer in (
        ("runtime", _normalize_runtime),
        ("syntax", lambda value: _normalize_metadata(value, "syntax")),
        ("language_server", lambda value: _normalize_metadata(value, "language_server")),
        ("verification", lambda value: _normalize_metadata(value, "verification")),
        ("source", lambda value: _normalize_metadata(value, "source")),
    ):
        normalized = normalizer(raw.get(field))
        if normalized:
            result[field] = normalized
    return result


def load_language_profiles() -> list[dict]:
    if not feature_enabled("developer_tools"):
        return []
    path = language_profiles_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        profiles = payload.get("profiles", []) if isinstance(payload, dict) else []
        result = []
        for profile in profiles:
            try:
                result.append(validate_language_profile(profile))
            except ValueError:
                continue
        return result
    except Exception:
        return []


def _write_language_profiles(profiles: list[dict]) -> None:
    path = language_profiles_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump({"version": 2, "profiles": profiles}, handle, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)


def save_language_profile(raw: dict) -> dict:
    profile = validate_language_profile(raw)
    profiles = [item for item in load_language_profiles() if item["id"] != profile["id"]]
    profiles.append(profile)
    profiles.sort(key=lambda item: item["label"].lower())
    _write_language_profiles(profiles)
    return profile


def delete_language_profile(profile_id: str) -> bool:
    normalized = str(profile_id or "").strip().lower()
    profiles = load_language_profiles()
    next_profiles = [item for item in profiles if item["id"] != normalized]
    if len(next_profiles) == len(profiles):
        return False
    _write_language_profiles(next_profiles)
    return True


def _find_mise() -> str:
    resolved = shutil.which("mise") or shutil.which("mise.exe")
    if resolved:
        return os.path.abspath(resolved)
    patterns = (
        r"%LOCALAPPDATA%\Microsoft\WinGet\Links\mise.exe",
        r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\jdx.mise_*\mise\bin\mise.exe",
        r"%LOCALAPPDATA%\Programs\mise\bin\mise.exe",
        r"%USERPROFILE%\scoop\shims\mise.exe",
    )
    for pattern in patterns:
        expanded = os.path.expandvars(pattern)
        for candidate in sorted(glob.glob(expanded), reverse=True):
            if os.path.isfile(candidate):
                return os.path.abspath(candidate)
    return ""


def _profile_executable_status(profile: dict) -> tuple[str, bool]:
    runtime = profile.get("runtime") or {}
    if runtime.get("manager") == "mise":
        mise = _find_mise()
        if not mise:
            return "", False
        tool = runtime.get("tool", "")
        version = runtime.get("version", "latest")
        try:
            completed = subprocess.run(
                [mise, "where", f"{tool}@{version}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=8,
                creationflags=_CREATE_NO_WINDOW,
            )
            resolved = (completed.stdout or "").strip().splitlines()
            return (resolved[-1] if resolved and completed.returncode == 0 else ""), completed.returncode == 0
        except Exception:
            return "", False
    executable = profile["executable"]
    expanded = os.path.expandvars(os.path.expanduser(executable))
    resolved = expanded if os.path.isfile(expanded) else shutil.which(executable)
    return (os.path.abspath(resolved) if resolved else ""), bool(resolved)


def language_profiles_status() -> dict:
    profiles = []
    for profile in load_language_profiles():
        executable_path, installed = _profile_executable_status(profile)
        profiles.append({
            **profile,
            "installed": installed,
            "executable_path": executable_path,
            "actions": list(profile.get("commands", {}).keys()),
        })
    return {
        "path": language_profiles_path(),
        "packs_path": language_packs_dir(),
        "placeholders": list(SUPPORTED_PLACEHOLDERS),
        "profiles": profiles,
    }


def resolve_language_profile(language: str, file_name: str) -> dict | None:
    normalized_language = str(language or "").strip().lower()
    extension = os.path.splitext(str(file_name or ""))[1].lower().lstrip(".")
    for profile in load_language_profiles():
        if profile["id"] == normalized_language or extension in profile["extensions"]:
            return profile
    return None


def expand_profile_argument(value: str, *, active_path: str, work_dir: str) -> str:
    file_stem_path = os.path.splitext(active_path)[0]
    replacements = {
        "{file}": active_path,
        "{file_name}": os.path.basename(active_path),
        "{file_stem}": os.path.basename(file_stem_path),
        "{file_stem_path}": file_stem_path,
        "{file_dir}": os.path.dirname(active_path),
        "{work_dir}": work_dir,
        "{project_dir}": work_dir,
    }
    result = str(value)
    for placeholder, replacement in replacements.items():
        result = result.replace(placeholder, replacement)
    return result


def resolve_profile_commands(profile: dict, action: str, *, active_path: str, work_dir: str) -> tuple[list[list[str]] | None, str]:
    normalized_action = str(action or "run").strip().lower()
    if normalized_action not in SUPPORTED_COMMANDS:
        return None, f"Unsupported profile action: {normalized_action}"
    if profile.get("command_state") == "needs_review":
        return None, (
            f"{profile['label']} syntax and tools are installed, but its {normalized_action} command needs review. "
            "Open Code Settings > Languages and save a command before running it."
        )
    command = (profile.get("commands") or {}).get(normalized_action)
    if not command:
        return None, f"{profile['label']} does not define a {normalized_action} command."
    extension = os.path.splitext(active_path)[1].lower().lstrip(".")
    command = (command.get("by_extension") or {}).get(extension) or command
    runtime = profile.get("runtime") or {}

    def resolve_step(step: dict) -> tuple[list[str] | None, str]:
        executable_value = expand_profile_argument(step["executable"], active_path=active_path, work_dir=work_dir)
        arguments = [
            expand_profile_argument(value, active_path=active_path, work_dir=work_dir)
            for value in step.get("arguments", [])
        ]
        if runtime.get("manager") == "mise":
            mise = _find_mise()
            if not mise:
                return None, "mise is not installed. Reinstall the language runtime from Code Settings > Languages."
            tool = runtime.get("tool", "")
            version = runtime.get("version", "latest")
            return [mise, "exec", f"{tool}@{version}", "--", executable_value, *arguments], ""
        executable = shutil.which(executable_value)
        if not executable and os.path.isfile(os.path.expandvars(os.path.expanduser(executable_value))):
            executable = os.path.abspath(os.path.expandvars(os.path.expanduser(executable_value)))
        if not executable:
            return None, (
                f"{profile['label']} runtime not found: {step['executable']}. "
                "Install it and verify the executable path in Code Settings > Languages."
            )
        return [executable, *arguments], ""

    resolved_commands = []
    for step in [*command.get("prepare", []), command]:
        resolved, error = resolve_step(step)
        if not resolved:
            return None, error
        resolved_commands.append(resolved)
    return resolved_commands, ""
