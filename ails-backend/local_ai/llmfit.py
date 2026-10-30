"""Run the MIT-licensed llmfit CLI through its JSON interface.

No llmfit or Odysseus implementation code is embedded. The optional Windows
helper is a pinned upstream release, installed only after an explicit action.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import threading
import zipfile
from pathlib import Path


from model_manager import default_model_store
from common import resource_path
from . import host_platform

VERSION = "1.1.17"
ARCHIVE_SHA256 = "661b6ea57d835f681fbabcf3366649ff681d0081267fd3a05db254e67af6073f"
EXECUTABLE_SHA256 = "3c5c783dd85cd78d2f91c9ac2809967a47b13708a9cc72112ed4a02c9d6cc981"
ARCHIVE_SIZE = 6222681
# v1.1.17's full recommendation JSON is 16-18 MiB for the same PC,
# depending on available memory. Keep all ranks rather than truncating models.
MAX_JSON_CHARS = 64 * 1024 * 1024
RELEASE = f"https://github.com/AlexsJones/llmfit/releases/download/v{VERSION}/llmfit-v{VERSION}-x86_64-pc-windows-msvc.zip"
_INSTALL_LOCK = threading.Lock()


def helper_directory() -> Path:
    return default_model_store().parent / "tools" / f"llmfit-{VERSION}"


def executable() -> str | None:
    # Environment override is an administrator/developer setting, never an API argument.
    override = os.environ.get("AILS_LLMFIT_PATH")
    if override:
        return str(Path(override).resolve()) if Path(override).is_file() else None
    bundled = helper_directory() / "llmfit.exe"
    if bundled.is_file() and hashlib.sha256(bundled.read_bytes()).hexdigest() == EXECUTABLE_SHA256:
        return str(bundled)
    return shutil.which("llmfit")


def status() -> dict:
    return {"ready": bool(executable()), "version": VERSION,
            "install_supported": host_platform.supports_bundled_helper(),
            "download_bytes": ARCHIVE_SIZE, "license": "MIT"}


def install(emit) -> None:
    import requests
    with _INSTALL_LOCK:
        if executable():
            emit({"type": "done"})
            return
        if not status()["install_supported"]:
            raise ValueError("이 플랫폼에서는 공식 llmfit을 설치한 뒤 다시 분석해 주세요.")
        chunks, count = [], 0
        with requests.get(RELEASE, stream=True, timeout=(10, 30)) as response:
            response.raise_for_status()
            for chunk in response.iter_content(128 * 1024):
                count += len(chunk)
                if count > ARCHIVE_SIZE:
                    raise ValueError("분석 도구 파일 크기 검증에 실패했습니다.")
                chunks.append(chunk)
                emit({"type": "progress", "status": "분석 도구 다운로드", "completed": count, "total": ARCHIVE_SIZE})
        archive = b"".join(chunks)
        if count != ARCHIVE_SIZE or hashlib.sha256(archive).hexdigest() != ARCHIVE_SHA256:
            raise ValueError("분석 도구 무결성 검증에 실패했습니다.")
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            prefix = f"llmfit-v{VERSION}-x86_64-pc-windows-msvc/"
            binary = zipped.read(prefix + "llmfit.exe")
            license_text = zipped.read(prefix + "LICENSE")
        if hashlib.sha256(binary).hexdigest() != EXECUTABLE_SHA256:
            raise ValueError("분석 도구 실행 파일 검증에 실패했습니다.")
        target = helper_directory()
        target.mkdir(parents=True, exist_ok=True)
        (target / "LICENSE").write_bytes(license_text)
        pending = target / "llmfit.exe.part"
        pending.write_bytes(binary)
        os.replace(pending, target / "llmfit.exe")
        emit({"type": "done"})


def run(*arguments: str) -> dict:
    command = executable()
    if not command:
        raise ValueError("하드웨어 분석 도구를 먼저 준비해 주세요.")
    environment = dict(os.environ)
    environment["LLAMA_CPP_PATH"] = str(Path(resource_path("tools/llamacpp-vulkan")))
    environment["LLMFIT_MODELS_DIR"] = str(default_model_store())
    # Do not let provider discovery contact a configured remote machine.
    for name in ("OLLAMA_HOST", "LMSTUDIO_HOST", "VLLM_HOST", "FERRUM_HOST", "LLAMA_SERVER_HOST", "DOCKER_MODEL_RUNNER_HOST"):
        environment[name] = "http://127.0.0.1:1"
    for name in ("AILS_LOCAL_API_TOKEN", "GITHUB_TOKEN", "GH_TOKEN", "LMSTUDIO_API_KEY"):
        environment.pop(name, None)
    try:
        result = subprocess.run([command, "--no-dashboard", *arguments], capture_output=True, encoding="utf-8", errors="replace",
                                timeout=45, env=environment, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired as error:
        raise ValueError("하드웨어 분석 시간이 초과되었습니다. 잠시 뒤 다시 분석해 주세요.") from error
    if result.returncode:
        raise ValueError(f"llmfit 실행에 실패했습니다 (종료 코드 {result.returncode}). 분석 도구의 설치 상태를 확인해 주세요.")
    if len(result.stdout) > MAX_JSON_CHARS:
        raise ValueError("llmfit 추천 결과가 처리 가능한 크기를 초과했습니다. 분석 도구의 모델 카탈로그를 확인해 주세요.")
    try:
        data = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise ValueError("llmfit 응답 형식이 지원되지 않습니다.") from error
    if not isinstance(data, dict):
        raise ValueError("llmfit 응답 형식이 지원되지 않습니다.")
    return data
