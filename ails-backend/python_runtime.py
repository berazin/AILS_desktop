from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import sys
import threading
import time

from common import CREATE_NO_WINDOW, resource_path
from edition_manifest import canonical_edition_id


VENV_DIR_NAME = ".ails-venv"
SUPPORTED_PYTHON_VERSIONS = ((3, 11), (3, 12), (3, 13))
DETECTION_CACHE_SECONDS = 10.0
VERSION_PROBE_TIMEOUT_SECONDS = 3.0
VENV_SETUP_TIMEOUT_SECONDS = 180.0

WHICH_CANDIDATES = ("python", "python3", "py")
GLOB_PATTERNS = (
    r"%LOCALAPPDATA%\Programs\Python\Python3*\python.exe",
    r"%ProgramFiles%\Python3*\python.exe",
    r"%USERPROFILE%\anaconda3\python.exe",
    r"%USERPROFILE%\miniconda3\python.exe",
    r"%USERPROFILE%\anaconda3\envs\*\python.exe",
    r"%USERPROFILE%\miniconda3\envs\*\python.exe",
    r"%USERPROFILE%\.conda\envs\*\python.exe",
)

_VERSION_RE = re.compile(r"(3\.\d{1,2}\.\d{1,2})")
_detection_cache: list[dict] | None = None
_detection_cache_at = 0.0
_detection_lock = threading.Lock()
_config_source = None


def set_config_source(provider) -> None:
    global _config_source
    _config_source = provider


def current_config() -> dict | None:
    try:
        return _config_source() if _config_source else None
    except Exception:
        return None


def _probe_version(executable: str) -> str:
    try:
        completed = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=VERSION_PROBE_TIMEOUT_SECONDS,
            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except Exception:
        return ""
    output = f"{completed.stdout or ''}\n{completed.stderr or ''}"
    match = _VERSION_RE.search(output)
    return match.group(1) if match else ""


def _expand_patterns(patterns) -> list[str]:
    matches: list[str] = []
    for pattern in patterns:
        expanded = os.path.expandvars(os.path.expanduser(pattern))
        for found in sorted(glob.glob(expanded)):
            if os.path.isfile(found):
                matches.append(os.path.abspath(found))
    return matches


def detect_installations(force: bool = False) -> list[dict]:
    global _detection_cache, _detection_cache_at
    now = time.monotonic()
    with _detection_lock:
        if not force and _detection_cache is not None and now - _detection_cache_at < DETECTION_CACHE_SECONDS:
            return list(_detection_cache)

        candidates: list[tuple[str, str]] = []
        seen: set[str] = set()
        for name in WHICH_CANDIDATES:
            resolved = shutil.which(name)
            if resolved:
                absolute = os.path.abspath(resolved)
                key = os.path.normcase(absolute)
                if key not in seen:
                    seen.add(key)
                    candidates.append((absolute, "which"))
        for path in _expand_patterns(GLOB_PATTERNS):
            key = os.path.normcase(path)
            if key not in seen:
                seen.add(key)
                source = "conda" if ".conda" in path.lower() or "anaconda3" in path.lower() or "miniconda3" in path.lower() else "glob"
                candidates.append((path, source))

        installations = []
        for path, source in candidates:
            version = _probe_version(path)
            if not version:
                continue
            installations.append({"path": path, "version": version, "source": source})

        _detection_cache = installations
        _detection_cache_at = now
        return list(installations)


def configured_executable(config: dict | None = None) -> str:
    return str((config or {}).get("python_kernel_executable", "") or "").strip().strip('"')


def resolve_external_python(config: dict | None = None) -> dict:
    configured = configured_executable(config)
    if configured:
        version = _probe_version(configured)
        if os.path.isfile(configured) and version:
            return {"mode": "custom", "path": os.path.abspath(configured), "version": version, "error": ""}
        return {"mode": "custom", "path": configured, "version": "", "error": "not_found"}
    if getattr(sys, "frozen", False):
        for candidate in detect_installations():
            return {"mode": "auto", "path": candidate["path"], "version": candidate["version"], "error": ""}
        return {"mode": "bundled", "path": "", "version": "", "error": "no_external_python"}
    return {
        "mode": "dev",
        "path": sys.executable,
        "version": _probe_version(sys.executable),
        "error": "",
    }


def validate_python_executable(path: object) -> dict:
    normalized = str(path or "").strip().strip('"')
    if not normalized:
        return {"ok": False, "path": "", "version": "", "error": "경로가 비어 있습니다."}
    if not os.path.isfile(normalized):
        return {"ok": False, "path": normalized, "version": "", "error": "파일을 찾을 수 없습니다."}
    version = _probe_version(normalized)
    if not version:
        return {"ok": False, "path": normalized, "version": "", "error": "Python 실행 파일이 아니거나 실행에 실패했습니다."}
    return {"ok": True, "path": os.path.abspath(normalized), "version": version, "error": ""}


def _version_key(version: str) -> tuple[int, int]:
    parts = [int(piece) for piece in str(version or "").split(".")[:2]]
    while len(parts) < 2:
        parts.append(0)
    return parts[0], parts[1]


def supported_version(version: str) -> bool:
    return _version_key(version) in SUPPORTED_PYTHON_VERSIONS


def _venv_python_path(venv_root: str) -> str:
    if os.name == "nt":
        return os.path.join(venv_root, "Scripts", "python.exe")
    return os.path.join(venv_root, "bin", "python")


def find_project_venv_python(start_path: object) -> str:
    value = str(start_path or "")
    if not value:
        return ""
    directory = value if os.path.isdir(value) else os.path.dirname(os.path.abspath(value))
    while True:
        executable = _venv_python_path(os.path.join(directory, VENV_DIR_NAME))
        if os.path.isfile(executable):
            return executable
        parent = os.path.dirname(directory)
        if parent == directory:
            return ""
        directory = parent


def bundled_wheels_dir() -> str:
    directory = resource_path(os.path.join("python-kernel-wheels"))
    if os.path.isdir(directory) and glob.glob(os.path.join(directory, "*.whl")):
        return directory
    return ""


def ensure_notebook_venv(notebook_dir: object, config: dict | None = None) -> dict:
    directory = str(notebook_dir or "").strip()
    if not directory or not os.path.isdir(directory):
        raise ValueError("노트북 폴더를 찾을 수 없어 가상환경을 준비하지 못했습니다.")
    venv_root = os.path.join(directory, VENV_DIR_NAME)
    venv_python = _venv_python_path(venv_root)
    if os.path.isfile(venv_python):
        return {"created": False, "python": venv_python, "base": ""}

    resolved = resolve_external_python(config)
    base = str(resolved.get("path") or "")
    if not base or resolved.get("error"):
        raise RuntimeError(
            "가상환경을 만들 외부 Python을 찾지 못했습니다. 설정에서 파이썬 실행 환경을 지정하거나 Python을 설치해 주세요."
        )
    version = str(resolved.get("version") or "")
    if not supported_version(version):
        supported = ", ".join(".".join(str(part) for part in item) for item in SUPPORTED_PYTHON_VERSIONS)
        raise RuntimeError(
            f"가상환경 격리는 Python {supported}만 지원합니다. 감지된 버전: {version or '알 수 없음'}"
        )

    try:
        completed = subprocess.run(
            [base, "-m", "venv", venv_root],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=VENV_SETUP_TIMEOUT_SECONDS,
            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired as error:
        _remove_tree_best_effort(venv_root)
        raise RuntimeError("가상환경 생성이 시간 초과되었습니다.") from error
    except OSError as error:
        _remove_tree_best_effort(venv_root)
        raise RuntimeError(f"가상환경 생성에 실패했습니다: {error}") from error
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()[-800:]
        _remove_tree_best_effort(venv_root)
        raise RuntimeError(f"가상환경 생성에 실패했습니다. {tail}".strip())

    try:
        _install_ipykernel(venv_python)
    except Exception:
        _remove_tree_best_effort(venv_root)
        raise

    verification = subprocess.run(
        [venv_python, "-c", "import ipykernel"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=VENV_SETUP_TIMEOUT_SECONDS,
        creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if verification.returncode != 0:
        tail = (verification.stderr or verification.stdout or "").strip()[-800:]
        _remove_tree_best_effort(venv_root)
        raise RuntimeError(f"가상환경 커널 검증에 실패했습니다. {tail}".strip())
    return {"created": True, "python": venv_python, "base": base}


def _install_ipykernel(venv_python: str) -> None:
    wheels_dir = bundled_wheels_dir()
    if wheels_dir:
        command = [
            venv_python,
            "-m",
            "pip",
            "install",
            "--no-index",
            "--find-links",
            wheels_dir,
            "--no-warn-script-location",
            "ipykernel",
        ]
    else:
        raise RuntimeError(
            "오프라인 파이썬 커널 구성 파일이 이 패키지에 없습니다. AILS를 최신 버전으로 다시 설치해 주세요."
        )
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=VENV_SETUP_TIMEOUT_SECONDS,
            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("가상환경 커널 구성이 시간 초과되었습니다.") from error
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()[-800:]
        raise RuntimeError(f"가상환경 커널 구성에 실패했습니다. {tail}".strip())


def resolve_execution_python(config: dict | None = None, active_path: object = "") -> tuple[str, str]:
    effective = config if config is not None else current_config()
    venv_python = find_project_venv_python(active_path)
    if venv_python:
        return venv_python, "project_venv"
    configured = configured_executable(effective)
    if configured and os.path.isfile(configured):
        return configured, "custom"
    if getattr(sys, "frozen", False):
        for candidate in detect_installations():
            return candidate["path"], "auto"
        for name in WHICH_CANDIDATES:
            resolved = shutil.which(name)
            if resolved:
                return resolved, "which"
        return "python", "fallback"
    return sys.executable, "dev"


def notebook_support_available() -> bool:
    import importlib.util

    for module_name in ("jupyter_client", "ipykernel"):
        try:
            if importlib.util.find_spec(module_name) is None:
                return False
        except (ImportError, ValueError):
            return False
    return True


def runtime_status(config: dict | None = None) -> dict:
    configured = configured_executable(config)
    resolution = resolve_external_python(config)
    return {
        "configured_path": configured,
        "mode": str(resolution.get("mode") or ""),
        "effective_path": str(resolution.get("path") or ""),
        "version": str(resolution.get("version") or ""),
        "resolution_error": str(resolution.get("error") or ""),
        "installations": detect_installations(),
        "notebook_available": notebook_support_available(),
        "venv_dir_name": VENV_DIR_NAME,
        "supported_versions": [".".join(str(part) for part in item) for item in SUPPORTED_PYTHON_VERSIONS],
    }


def _remove_tree_best_effort(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)
