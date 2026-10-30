from __future__ import annotations

import re
import shlex


BLOCKED_EXECUTABLES = {
    "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "sh", "bash",
    "wscript", "wscript.exe", "cscript", "cscript.exe", "mshta", "mshta.exe", "rundll32", "rundll32.exe",
    "osascript", "autohotkey", "autoit3",
}
_SAFE_EXECUTABLE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.+-]{0,79}$")
_UNSAFE_SHELL_RE = re.compile(r"(?:\|\||(?<!\|)\|(?!\|)|[;<>`]|\$\(|\r|\n)")


def _replace_token_placeholders(token: str) -> str | None:
    replacements = (
        ("$dir$fileNameWithoutExt", "{file_stem_path}"),
        ("$dirWithoutTrailingSlash", "{work_dir}"),
        ("$fullFileName", "{file}"),
        ("$fileNameWithoutExt", "{file_stem}"),
        ("$fileName", "{file_name}"),
        ("$workspaceRoot", "{project_dir}"),
        ("$dir", "{work_dir}/"),
    )
    result = str(token)
    for source, target in replacements:
        result = result.replace(source, target)
    if "$" in result or "%" in result:
        return None
    return result


def _tokenize_segment(segment: str) -> list[str] | None:
    try:
        tokens = shlex.split(segment, posix=True)
    except ValueError:
        return None
    if not tokens:
        return None
    if tokens[0].lower() == "cd":
        if len(tokens) == 2 and tokens[1] in {"$dir", "$dirWithoutTrailingSlash"}:
            return []
        return None
    converted = []
    for token in tokens:
        value = _replace_token_placeholders(token)
        if value is None or len(value) > 500:
            return None
        converted.append(value)
    executable = converted[0]
    if executable.lower() in BLOCKED_EXECUTABLES:
        return None
    if executable != "{file_stem_path}" and not _SAFE_EXECUTABLE_RE.fullmatch(executable):
        return None
    return converted


def convert_code_runner_executor(command: str) -> dict | None:
    value = str(command or "").strip()
    if not value or len(value) > 1_000 or _UNSAFE_SHELL_RE.search(value):
        return None
    raw_segments = [segment.strip() for segment in value.split("&&")]
    if not raw_segments or any(not segment for segment in raw_segments):
        return None
    steps = []
    for segment in raw_segments:
        tokens = _tokenize_segment(segment)
        if tokens is None:
            return None
        if tokens:
            steps.append({"executable": tokens[0], "arguments": tokens[1:]})
    if not steps:
        return None

    uses_file_placeholder = any(
        "{file" in argument
        for step in steps
        for argument in [step["executable"], *step["arguments"]]
    )
    if len(steps) == 1 and not uses_file_placeholder:
        steps[0]["arguments"].append("{file}")

    final = dict(steps[-1])
    if len(steps) > 1:
        final["prepare"] = steps[:-1]
    return final


def _case_insensitive_value(mapping: dict, key: str):
    lowered = str(key or "").lower()
    for candidate, value in mapping.items():
        if str(candidate).lower() == lowered:
            return value
    return None


def code_runner_recipe(
    language_id: str,
    extensions: list[str],
    executor_map: dict,
    extension_map: dict,
) -> dict | None:
    base_command = _case_insensitive_value(executor_map, language_id)
    base = convert_code_runner_executor(base_command) if isinstance(base_command, str) else None
    variants = {}
    for extension in extensions:
        extension_command = _case_insensitive_value(extension_map, f".{str(extension).lstrip('.')}")
        converted = convert_code_runner_executor(extension_command) if isinstance(extension_command, str) else None
        if converted:
            variants[str(extension).lower().lstrip(".")] = converted

    if base is None and variants:
        first_extension = next(iter(variants))
        base = variants.pop(first_extension)
    if base is None:
        return None
    if variants:
        different = {extension: command for extension, command in variants.items() if command != base}
        if different:
            base = {**base, "by_extension": different}
    return {"run": base}


def recipe_executables(commands: dict) -> list[str]:
    result = []

    def collect(command: dict) -> None:
        executable = str(command.get("executable", ""))
        if executable and not executable.startswith("{") and executable not in result:
            result.append(executable)
        for step in command.get("prepare", []):
            if isinstance(step, dict):
                collect(step)
        for variant in (command.get("by_extension") or {}).values():
            if isinstance(variant, dict):
                collect(variant)

    for command in commands.values():
        if isinstance(command, dict):
            collect(command)
    return result
