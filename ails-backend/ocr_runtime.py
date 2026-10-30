from __future__ import annotations

import base64
import importlib
import json
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path


OCR_PROVIDER_PRIORITY = (
    "CUDAExecutionProvider",
    "OpenVINOExecutionProvider",
    "DmlExecutionProvider",
)
OCR_RUNTIME_KEYS = {
    "cuda": "CUDAExecutionProvider",
    "openvino": "OpenVINOExecutionProvider",
    "directml": "DmlExecutionProvider",
    "cpu": "CPUExecutionProvider",
}
OCR_RUNTIME_PROVIDER_ENV = "AILS_OCR_RUNTIME_PROVIDER"
OCR_RUNTIME_ROOT_ENV = "AILS_OCR_RUNTIME_ROOT"
OPENVINO_GPU_LOAD_CONFIG = json.dumps(
    {"GPU": {"EXECUTION_MODE_HINT": "ACCURACY"}},
    separators=(",", ":"),
)

_PROBE_MODEL = base64.b64decode(
    "CAg6UQoQCgF4EgF5IghJZGVudGl0eRITYWlscy1wcm92aWRlci1wcm9iZVoTCgF4"
    "Eg4KDAgBEggKAggBCgIIAWITCgF5Eg4KDAgBEggKAggBCgIIAUIECgAQDQ=="
)
_runtime_lock = threading.RLock()
_selected_runtime_key: str | None = None
_active_runtime_key: str | None = None
_dll_directory_handles: list[object] = []
_logger = logging.getLogger(__name__)


def packaged_ocr_runtime_root() -> Path | None:
    configured = str(os.environ.get(OCR_RUNTIME_ROOT_ENV) or "").strip()
    if configured:
        root = Path(configured).expanduser().resolve()
        return root if root.is_dir() else None
    if not getattr(sys, "frozen", False):
        return None
    internal = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent / "_internal"))
    root = internal / "ocr-runtimes"
    return root if root.is_dir() else None


def _normalize_runtime_key(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    if not normalized or normalized == "auto":
        return None
    if normalized not in OCR_RUNTIME_KEYS:
        raise ValueError(f"지원하지 않는 OCR 런타임입니다: {normalized}")
    return normalized


def _runtime_directory(root: Path, runtime_key: str) -> Path:
    return root / ("directml" if runtime_key == "cpu" else runtime_key)


def _add_runtime_dll_directories(runtime_dir: Path) -> None:
    directories = {runtime_dir}
    directories.update(path.parent for path in runtime_dir.rglob("*.dll"))
    ordered = sorted(directories, key=lambda path: (len(path.parts), str(path).lower()))
    current_path = os.environ.get("PATH", "")
    additions = [str(path) for path in ordered if str(path).lower() not in current_path.lower()]
    if additions:
        os.environ["PATH"] = os.pathsep.join([*additions, current_path])
    if hasattr(os, "add_dll_directory"):
        for directory in ordered:
            try:
                _dll_directory_handles.append(os.add_dll_directory(str(directory)))
            except OSError:
                continue


def _activate_packaged_runtime(runtime_key: str) -> None:
    global _active_runtime_key

    root = packaged_ocr_runtime_root()
    if root is None:
        return
    runtime_dir = _runtime_directory(root, runtime_key)
    if not runtime_dir.is_dir():
        raise RuntimeError(f"패키지에 OCR 런타임이 없습니다: {runtime_key}")
    runtime_text = str(runtime_dir)
    if runtime_text not in sys.path:
        sys.path.insert(0, runtime_text)
    _add_runtime_dll_directories(runtime_dir)
    importlib.invalidate_caches()
    _active_runtime_key = runtime_key


def _probe_packaged_runtime_subprocess(runtime_key: str) -> bool:
    env = os.environ.copy()
    env[OCR_RUNTIME_PROVIDER_ENV] = runtime_key
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    command = [sys.executable]
    if not getattr(sys, "frozen", False):
        command.append(str(Path(__file__).with_name("api_server.py")))
    command.extend(("--probe-ocr-runtime", runtime_key))
    try:
        result = subprocess.run(
            command,
            cwd=Path(sys.executable).resolve().parent,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=45,
            check=False,
            creationflags=flags,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def select_packaged_ocr_runtime() -> str:
    global _selected_runtime_key

    with _runtime_lock:
        if _selected_runtime_key is not None:
            return _selected_runtime_key
        requested = _normalize_runtime_key(os.environ.get(OCR_RUNTIME_PROVIDER_ENV))
        if requested is not None:
            _selected_runtime_key = requested
            return requested
        root = packaged_ocr_runtime_root()
        if root is None:
            _selected_runtime_key = "auto"
            return _selected_runtime_key
        for runtime_key in ("cuda", "openvino", "directml", "cpu"):
            if not _runtime_directory(root, runtime_key).is_dir():
                continue
            if _probe_packaged_runtime_subprocess(runtime_key):
                _selected_runtime_key = runtime_key
                _logger.info("Selected packaged OCR runtime: %s", runtime_key)
                return runtime_key
        raise RuntimeError("사용 가능한 CUDA, OpenVINO, DirectML 또는 CPU OCR 런타임이 없습니다.")


def load_onnxruntime():
    global _active_runtime_key

    with _runtime_lock:
        if "onnxruntime" in sys.modules:
            return sys.modules["onnxruntime"]
        runtime_key = select_packaged_ocr_runtime()
        if runtime_key != "auto":
            _activate_packaged_runtime(runtime_key)
        module = importlib.import_module("onnxruntime")
        providers = set(module.get_available_providers())
        if runtime_key == "auto":
            provider = next((name for name in OCR_PROVIDER_PRIORITY if name in providers), None)
            _active_runtime_key = next(
                (key for key, name in OCR_RUNTIME_KEYS.items() if name == provider),
                "cpu" if "CPUExecutionProvider" in providers else None,
            )
        else:
            expected = OCR_RUNTIME_KEYS[runtime_key]
            if expected not in providers:
                raise RuntimeError(
                    f"{runtime_key} OCR 런타임에 {expected}가 없습니다: {sorted(providers)}"
                )
        return module


def active_onnxruntime_provider() -> str | None:
    module = load_onnxruntime()
    providers = set(module.get_available_providers())
    if _active_runtime_key in OCR_RUNTIME_KEYS:
        expected = OCR_RUNTIME_KEYS[_active_runtime_key]
        if expected in providers:
            return expected
    return next((name for name in OCR_PROVIDER_PRIORITY if name in providers), None)


def _openvino_has_gpu_device() -> bool:
    try:
        from openvino import Core

        core = Core()
        return any(str(device).upper().startswith("GPU") for device in core.available_devices)
    except Exception:
        return False


def probe_packaged_ocr_runtime(runtime_key: str) -> bool:
    runtime_key = _normalize_runtime_key(runtime_key)
    if runtime_key is None:
        return False
    os.environ[OCR_RUNTIME_PROVIDER_ENV] = runtime_key
    try:
        ort = load_onnxruntime()
        provider = OCR_RUNTIME_KEYS[runtime_key]
        if provider not in ort.get_available_providers():
            return False
        if runtime_key == "openvino" and not _openvino_has_gpu_device():
            return False
        options = ort.SessionOptions()
        provider_options: dict[str, object] = {}
        if runtime_key == "directml":
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            options.enable_mem_pattern = False
            device_id = max(0, int(os.environ.get("AILS_DML_DEVICE_ID", "0") or "0"))
            if device_id:
                provider_options["device_id"] = device_id
        elif runtime_key == "cuda":
            provider_options["device_id"] = max(
                0, int(os.environ.get("AILS_CUDA_DEVICE_ID", "0") or "0")
            )
        elif runtime_key == "openvino":
            provider_options.update(
                {
                    "device_type": "GPU",
                    "load_config": OPENVINO_GPU_LOAD_CONFIG,
                }
            )
        session = ort.InferenceSession(
            _PROBE_MODEL,
            sess_options=options,
            providers=[provider],
            provider_options=[provider_options],
        )
        if not session.get_providers() or session.get_providers()[0] != provider:
            return False
        import numpy as np

        output = session.run(None, {"x": np.asarray([[1.0]], dtype=np.float32)})
        return bool(output) and float(output[0][0][0]) == 1.0
    except Exception:
        _logger.exception("OCR runtime probe failed: %s", runtime_key)
        return False
