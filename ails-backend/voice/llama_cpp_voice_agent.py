from __future__ import annotations

from chat.latency_spans import measured

import os
import re
import socket
import subprocess
import threading
import time
import urllib.error
from contextlib import contextmanager
from pathlib import Path

from common import resource_path
from hardware_capabilities import detect_vulkan_capabilities
from model_manager import ModelUnavailableError, get_model_manager
from .local_model_catalog import MODEL_4B_ID, MODEL_8B_ID, MODEL_SPECS, LOCAL_CONTEXT, model_spec
from .local_model_catalog import (
    LOCAL_PROBLEM_REVIEW_MODEL_AUTO, LOCAL_PROBLEM_REVIEW_MODEL_IDS,
    normalize_local_problem_review_model,
)


HIGH_PERFORMANCE_MIN_VRAM_BYTES = 10 * 1024 ** 3


def select_voice_agent_model_id(capabilities: dict | None = None) -> str:
    capabilities = capabilities if capabilities is not None else detect_vulkan_capabilities()
    device = capabilities.get("selected_device") or {}
    if (
        capabilities.get("available")
        and int(device.get("device_type") or -1) == 2
        and int(device.get("device_memory_bytes") or 0) >= HIGH_PERFORMANCE_MIN_VRAM_BYTES
    ):
        return MODEL_8B_ID
    return MODEL_4B_ID


class LlamaCppVoiceAgent:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._session_lock = threading.Lock()
        self._closed = threading.Event()
        self._process: subprocess.Popen | None = None
        self._endpoint = ""
        self._log_handle = None
        self._active_model_id = ""

    def _model_status(self, model_id: str) -> dict:
        return get_model_manager().status(model_id)

    @staticmethod
    def _validated_model_id(model_id: str = "") -> str:
        selected = str(model_id or "").strip() or select_voice_agent_model_id()
        model_spec(selected)
        return selected

    def status(self, model_id: str = "") -> dict:
        with self._lock:
            executable = Path(resource_path("tools/llamacpp-vulkan/llama-server.exe"))
            requested_model_id = str(model_id or "").strip()
            model_id = self._validated_model_id(requested_model_id or self._active_model_id)
            spec = model_spec(model_id)
            resident = bool(
                self._active_model_id
                and self._process is not None
                and self._process.poll() is None
                and self._healthy()
            )
            active_model_id = self._active_model_id if resident else ""
            try:
                payload = dict(self._model_status(model_id))
            except ModelUnavailableError:
                payload = {}
            payload.update({
                "model_id": model_id,
                "model_label": spec["label"],
                "active_model_id": active_model_id,
                "resident": resident,
                "selection_source": "requested" if requested_model_id else "resident" if active_model_id else "hardware",
                "runtime_ready": executable.is_file(),
                "runtime_error": "" if executable.is_file() else "llama.cpp Vulkan 실행 파일이 없습니다. AILS를 업데이트해 주세요.",
                "backend": "llama.cpp Vulkan",
            })
            return payload

    def install_model(self, confirmed: bool, progress=None, model_id: str = "") -> dict:
        selected_model_id = self._validated_model_id(model_id)
        if not confirmed:
            raise ValueError(f"{model_spec(selected_model_id)['label']} 모델 다운로드를 확인해 주세요.")
        return get_model_manager().install(selected_model_id, progress=progress)

    @measured("local_ready")
    def _endpoint_locked(self, model_id: str, cancel_check=None) -> str:
        self._check_open()
        if (
            self._active_model_id == model_id
            and self._process is not None
            and self._process.poll() is None
            and self._healthy()
        ):
            return self._endpoint
        self._close_locked()
        try:
            ready = bool(self._model_status(model_id)["ready"])
        except ModelUnavailableError:
            ready = False
        if not ready:
            raise ModelUnavailableError("선택한 Qwen3 로컬 모델을 먼저 다운로드해야 합니다.")
        return self._start_locked(model_id, cancel_check=cancel_check) if cancel_check else self._start_locked(model_id)

    def endpoint(self, model_id: str = "") -> str:
        with self._lock:
            return self._endpoint_locked(self._validated_model_id(model_id))

    @contextmanager
    def session(self, model_id: str = "", priority: int | str | None = None, cancel_check=None):
        """Keep another local feature from switching models during one request."""

        from local_inference import GPU_SCHEDULER, GpuPriority

        prio = GpuPriority.CRITICAL if priority is None else priority
        def check():
            self._check_open()
            if cancel_check:
                cancel_check()

        while not self._session_lock.acquire(timeout=0.05):
            check()
        try:
            check()
            with GPU_SCHEDULER.acquire("local_llm", priority=prio, cancel_check=check):
                check()
                selected_model_id = self._validated_model_id(model_id)
                with self._lock:
                    endpoint = self._endpoint_locked(selected_model_id, cancel_check=check)
                alias = str(model_spec(selected_model_id)["alias"])
                yield endpoint, alias
        finally:
            self._session_lock.release()

    def active_alias(self) -> str:
        model_id = self._active_model_id or select_voice_agent_model_id()
        return str(model_spec(model_id)["alias"])

    @measured("local_cold_load")
    def _start_locked(self, model_id: str, cancel_check=None) -> str:
        spec = model_spec(model_id)
        executable = Path(resource_path("tools/llamacpp-vulkan/llama-server.exe"))
        if not executable.is_file():
            raise RuntimeError("llama.cpp Vulkan 실행 파일이 없습니다. AILS를 업데이트해 주세요.")
        try:
            install_path = self._model_status(model_id)["install_path"]
        except ModelUnavailableError as error:
            raise RuntimeError(str(error)) from error
        if not install_path:
            raise RuntimeError("보이스 모델이 아직 다운로드되지 않았습니다.")
        model_path = Path(install_path) / str(spec["filename"])
        if spec.get("quantization"):
            from local_ai.gguf import verify_quantization
            verify_quantization(model_path, spec["quantization"])
        port = self._free_port()
        self._endpoint = f"http://127.0.0.1:{port}/v1/chat/completions"
        log_dir = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "AILS" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        self._log_handle = (log_dir / "llama-server.log").open("ab")
        self._log_start = self._log_handle.tell()
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self._process = subprocess.Popen(
            [
                str(executable),
                "--model", str(model_path),
                "--alias", str(spec["alias"]),
                "--host", "127.0.0.1",
                "--port", str(port),
                "--ctx-size", str(LOCAL_CONTEXT),
                "--parallel", "1",
                "--gpu-layers", "auto",
                "--reasoning", "off",
                "--reasoning-budget", "0",
                "--cors-origins", "localhost",
                "--no-ui",
            ],
            cwd=str(executable.parent),
            stdin=subprocess.DEVNULL,
            stdout=self._log_handle,
            stderr=subprocess.STDOUT,
            creationflags=flags,
        )
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                self._check_open()
                if cancel_check:
                    cancel_check()
            except BaseException:
                self._close_locked()
                raise
            if self._process.poll() is not None:
                error = self._log_tail()
                self._close_locked()
                raise RuntimeError(f"llama.cpp가 모델을 불러오지 못했습니다. {error}".strip())
            if self._healthy():
                self._active_model_id = model_id
                return self._endpoint
            time.sleep(0.2)
        self._close_locked()
        raise RuntimeError("llama.cpp 모델 준비 시간이 120초를 초과했습니다.")

    def execution_info(self) -> dict:
        """Only report acceleration that the current process actually logged."""
        if not self._process or self._process.poll() is not None:
            return {"gpu_used": None, "gpu_layers": None}
        try:
            self._log_handle.flush()
            with Path(self._log_handle.name).open("rb") as stream:
                stream.seek(self._log_start)
                log = stream.read(2 * 1024 * 1024).decode("utf-8", errors="replace")
            matches = re.findall(r"offloaded (\d+)/(\d+) layers to GPU", log)
            layers = int(matches[-1][0]) if matches else None
            return {"gpu_used": layers > 0 if layers is not None else None, "gpu_layers": layers}
        except (OSError, AttributeError, ValueError):
            return {"gpu_used": None, "gpu_layers": None}

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _check_open(self):
        if self._closed.is_set():
            raise InterruptedError("Local model runtime has closed")

    def shutdown(self) -> None:
        """Cancel queued/load work and terminate an in-flight inference server."""
        self._closed.set()
        self.close()

    def _healthy(self) -> bool:
        if not self._endpoint:
            return False
        import urllib.request
        try:
            base = self._endpoint.rsplit("/v1/", 1)[0]
            with urllib.request.urlopen(f"{base}/health", timeout=1) as response:
                return response.status == 200
        except (OSError, urllib.error.URLError):
            return False

    def _close_locked(self) -> None:
        process, self._process = self._process, None
        self._endpoint = ""
        self._active_model_id = ""
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if self._log_handle is not None:
            self._log_handle.close()
            self._log_handle = None

    def _log_tail(self) -> str:
        if self._log_handle is not None:
            try:
                self._log_handle.flush()
            except (OSError, ValueError):
                pass
        log_path = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "AILS" / "logs" / "llama-server.log"
        try:
            return log_path.read_bytes()[-4096:].decode("utf-8", errors="replace").strip()
        except OSError:
            return ""

    @staticmethod
    def _free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])


VOICE_AGENT_RUNTIME = LlamaCppVoiceAgent()

# api_server에서 이동: 로컬 문제 검수 모델 선택(llama.cpp 에이전트 모델과 동일한 카탈로그)

def resolve_local_problem_review_model_id(value) -> str:
    selected = normalize_local_problem_review_model(value)
    return select_voice_agent_model_id() if selected == LOCAL_PROBLEM_REVIEW_MODEL_AUTO else selected
