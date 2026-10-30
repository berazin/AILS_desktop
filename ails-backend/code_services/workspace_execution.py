"""Reuse AILS toolchains without saving snapshots over the user's folder."""
import os
from pathlib import Path
import shutil
import sys

from . import code_executor
from .language_profiles import resolve_language_profile
from .console_encoding import configure_console_runtime, normalize_console_encoding


def prepare_workspace_execution(root, file_name, language, action, timeout, build_dir, console_encoding="auto"):
    normalize_console_encoding(console_encoding)
    root = Path(root).resolve()
    source = root / file_name
    if not source.is_file() or not source.resolve().is_relative_to(root):
        raise ValueError("실행할 파일이 작업 폴더 안에 없습니다.")
    code = source.read_text(encoding="utf-8")
    profile = resolve_language_profile(language, file_name)
    timeout_seconds = code_executor._timeout_seconds(timeout)
    environment = os.environ.copy()
    for key in code_executor.BLOCKED_SANDBOX_ENV_KEYS:
        environment.pop(key, None)
    if profile:
        commands, error = code_executor._custom_profile_commands(profile, str(source), str(root), action)
        if not commands:
            return {"success": False, "stderr": error}
        stdout, stderr = "", ""
        for command in commands[:-1]:
            result = code_executor._run_compile(command, str(root), timeout_seconds, environment)
            stdout += result.stdout or ""
            stderr += result.stderr or ""
            if result.returncode:
                return {"success": False, "stdout": stdout, "stderr": stderr}
        command, environment, encoding = configure_console_runtime(commands[-1], environment, console_encoding)
        return {"success": True, "command": command, "env": environment, "console_encoding": encoding,
                "timeout": timeout_seconds, "stdout": stdout, "stderr": stderr}

    compiled = source.suffix.lower() in {".c", ".cpp", ".cc", ".cxx", ".rs", ".java", ".cs"}
    if action not in {"run", "build"} or (action == "build" and not compiled):
        return {"success": False, "stderr": "이 작업에는 해당 언어의 빌드·테스트 프로파일이 필요합니다."}
    # Java and C# toolchains discover their source files in the build directory.
    # Copy sources to a disposable build folder, never generate a project in the original.
    active = source
    if source.suffix.lower() in {".java", ".cs"}:
        for directory, dirs, names in os.walk(root):
            dirs[:] = [name for name in dirs if name not in {".git", "node_modules", ".venv", "bin", "obj"}
                       and not (Path(directory) / name).is_symlink()]
            for name in names:
                item = Path(directory) / name
                if item.suffix.lower() != source.suffix.lower() or item.is_symlink():
                    continue
                target = Path(build_dir) / item.relative_to(root)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(item, target)
        active = Path(build_dir) / source.relative_to(root)
    prepared = code_executor._prepare_code_sandbox(
        build_dir, code, language, file_name, [], timeout, "run", source_path=str(active), console_encoding=console_encoding)
    if prepared.get("success") and action == "build":
        if source.suffix.lower() == ".cs":
            prepared["command"][1] = "build"
            prepared["command"].remove("--project")
        else:
            prepared["command"] = [sys.executable, "-c", "pass"]
    return prepared
