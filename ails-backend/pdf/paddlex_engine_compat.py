"""Shared PaddleX ONNX Runtime engine compatibility layer.

The PaddleX inference stack that powers both the legacy PaddleOCR pipeline
(``pdf_ocr``) and the PP-StructureV3 document analysis pipeline
(``pdf_structure``) needs the same environment guards and DirectML-safe
monkey patches. This module owns them so both pipelines stay in sync.
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
import threading
import time
import types
import traceback
from collections import deque

from ocr_runtime import OPENVINO_GPU_LOAD_CONFIG, load_onnxruntime

_logger = logging.getLogger(__name__)

GPU_PROVIDERS = {
    "DmlExecutionProvider",
    "CUDAExecutionProvider",
    "OpenVINOExecutionProvider",
}
OPENVINO_CPU_ONLY_MODEL_DIRS = {
    "wired_table_structure",
    "wireless_table_structure",
}

SESSION_EVENT_LIMIT = 256

# Bounded process-local telemetry. The registry owns no session references;
# session IDs and metadata are enough to prove lifecycle balance without
# extending the native object's lifetime.
_session_creation_log = deque(maxlen=SESSION_EVENT_LIMIT)
_session_registry: dict[int, dict] = {}
_session_registry_lock = threading.RLock()
_active_inference_count = 0
_active_inference_models: dict[str, int] = {}


def _log_session_creation(
    model_name: str,
    model_path: str,
    requested_providers: list,
    provider_options: list,
    input_shapes: dict,
    output_shapes: dict,
    success: bool,
    error: str = "",
    actual_providers: list | None = None,
):
    """Log detailed session creation info for diagnostics."""
    actual = None if actual_providers is None else list(actual_providers)
    with _session_registry_lock:
        active_gpu_sessions = sum(
            1 for item in _session_registry.values() if item.get("gpu")
        )
    entry = {
        "event": "session_created" if success else "session_create_failed",
        "timestamp": time.time(),
        "pid": os.getpid(),
        "thread_id": threading.get_ident(),
        "model_name": model_name,
        "model_path": model_path,
        "providers": requested_providers,
        "requested_providers": requested_providers,
        "actual_providers": actual,
        "provider_options": provider_options,
        "input_shapes": input_shapes,
        "output_shapes": output_shapes,
        "active_gpu_sessions": active_gpu_sessions,
        "success": success,
        "error": error,
        "stack_trace": traceback.format_stack()[-5:-1] if not success else None,
    }
    _session_creation_log.append(entry)
    if success:
        _logger.info(
            "ONNX Session created: model=%s path=%s requested_providers=%s "
            "actual_providers=%s inputs=%s outputs=%s",
            model_name,
            model_path,
            requested_providers,
            actual if actual is not None else "unavailable",
            input_shapes,
            output_shapes,
        )
    else:
        _logger.error(
            "ONNX Session FAILED: model=%s path=%s requested_providers=%s "
            "actual_providers=%s error=%s",
            model_name,
            model_path,
            requested_providers,
            actual if actual is not None else "unavailable",
            error,
        )
        for line in traceback.format_stack()[-5:-1]:
            _logger.error("  Stack: %s", line.strip())


def get_session_creation_log():
    """Return the session creation log for diagnostics."""
    return list(_session_creation_log)


def clear_session_creation_log():
    """Clear the session creation log."""
    _session_creation_log.clear()


def _register_session(
    session,
    *,
    model_name: str,
    model_path: str,
    requested_providers: list,
    actual_providers: list,
) -> int:
    session_id = id(session)
    with _session_registry_lock:
        _session_registry[session_id] = {
            "session_id": session_id,
            "model_name": model_name,
            "model_path": model_path,
            "requested_providers": list(requested_providers),
            "actual_providers": list(actual_providers),
            "gpu": bool(actual_providers and actual_providers[0] in GPU_PROVIDERS),
            "created_at": time.time(),
            "pid": os.getpid(),
            "thread_id": threading.get_ident(),
        }
    return session_id


def _unregister_session(session_id: int) -> dict | None:
    with _session_registry_lock:
        return _session_registry.pop(session_id, None)


def active_session_snapshot() -> dict:
    with _session_registry_lock:
        sessions = [dict(item) for item in _session_registry.values()]
        return {
            "count": len(sessions),
            "gpu_count": sum(1 for item in sessions if item.get("gpu")),
            "session_ids": [item["session_id"] for item in sessions],
            "sessions": sessions,
            "active_inferences": _active_inference_count,
            "active_models": sorted(_active_inference_models),
        }


def _log_session_release(metadata: dict) -> None:
    with _session_registry_lock:
        active_gpu_sessions = sum(
            1 for item in _session_registry.values() if item.get("gpu")
        )
    entry = {
        "event": "session_released",
        "timestamp": time.time(),
        "pid": os.getpid(),
        "thread_id": threading.get_ident(),
        "session_id": metadata.get("session_id"),
        "model_name": metadata.get("model_name"),
        "model_path": metadata.get("model_path"),
        "active_gpu_sessions": active_gpu_sessions,
        "success": True,
    }
    _session_creation_log.append(entry)
    _logger.info(
        "ONNX Session released: model=%s path=%s session_id=%s "
        "active_gpu_sessions=%d pid=%d thread_id=%d",
        entry["model_name"],
        entry["model_path"],
        entry["session_id"],
        active_gpu_sessions,
        entry["pid"],
        entry["thread_id"],
    )


def release_paddlex_onnx_sessions(root) -> int:
    """Detach ONNX sessions reachable through PaddleX/PaddleOCR objects."""
    if root is None:
        return 0
    released = 0
    visited: set[int] = set()
    stack: list[tuple[object, bool]] = [(root, True)]
    while stack:
        value, is_root = stack.pop()
        value_id = id(value)
        if value_id in visited:
            continue
        visited.add(value_id)
        if isinstance(value, dict):
            stack.extend((item, False) for item in value.values())
            continue
        if isinstance(value, (list, tuple, set, frozenset)):
            stack.extend((item, False) for item in value)
            continue
        module_name = type(value).__module__
        owned = module_name.startswith(("paddlex.", "paddleocr."))
        if not is_root and not owned:
            continue
        if module_name.endswith("onnxruntime_runner") and hasattr(value, "session"):
            session = getattr(value, "session", None)
            if session is not None:
                metadata = _unregister_session(id(session))
                value.session = None
                if hasattr(value, "_input_names"):
                    value._input_names = []
                if hasattr(value, "_output_names"):
                    value._output_names = []
                released += 1
                if metadata is not None:
                    _log_session_release(metadata)
        attributes = getattr(value, "__dict__", None)
        if isinstance(attributes, dict):
            stack.extend((item, False) for item in attributes.values())
    return released


def _extract_model_info_from_config(config: dict) -> tuple[str, str]:
    """Extract model name and path from PaddleX engine config."""
    model_name = "unknown"
    model_path = "unknown"

    # PaddleX config keys for different models
    model_keys = [
        ("layout_detection_model_name", "layout_detection_model_dir"),
        ("region_detection_model_name", "region_detection_model_dir"),
        ("text_detection_model_name", "text_detection_model_dir"),
        ("text_recognition_model_name", "text_recognition_model_dir"),
        ("table_classification_model_name", "table_classification_model_dir"),
        ("wired_table_structure_recognition_model_name", "wired_table_structure_recognition_model_dir"),
        ("wireless_table_structure_recognition_model_name", "wireless_table_structure_recognition_model_dir"),
        ("wired_table_cells_detection_model_name", "wired_table_cells_detection_model_dir"),
        ("wireless_table_cells_detection_model_name", "wireless_table_cells_detection_model_dir"),
        ("formula_recognition_model_name", "formula_recognition_model_dir"),
    ]

    for name_key, dir_key in model_keys:
        if name_key in config and config[name_key]:
            model_name = str(config[name_key])
            model_path = str(config.get(dir_key, "unknown"))
            break

    return model_name, model_path


def _get_onnx_model_input_output_shapes(model_path: str) -> tuple[dict, dict]:
    """Extract input/output shapes from ONNX model file."""
    input_shapes = {}
    output_shapes = {}

    if not model_path or model_path == "unknown" or not os.path.isdir(model_path):
        return input_shapes, output_shapes

    onnx_file = os.path.join(model_path, "inference.onnx")
    if not os.path.isfile(onnx_file):
        return input_shapes, output_shapes

    try:
        import onnx
        model = onnx.load(onnx_file)
        for inp in model.graph.input:
            shape_info = []
            if inp.type.HasField('tensor_type'):
                tensor_type = inp.type.tensor_type
                for dim in tensor_type.shape.dim:
                    if dim.HasField('dim_value'):
                        shape_info.append(dim.dim_value)
                    elif dim.HasField('dim_param'):
                        shape_info.append(f"dynamic:{dim.dim_param}")
                    else:
                        shape_info.append("dynamic:?")
                input_shapes[inp.name] = shape_info
        for out in model.graph.output:
            shape_info = []
            if out.type.HasField('tensor_type'):
                tensor_type = out.type.tensor_type
                for dim in tensor_type.shape.dim:
                    if dim.HasField('dim_value'):
                        shape_info.append(dim.dim_value)
                    elif dim.HasField('dim_param'):
                        shape_info.append(f"dynamic:{dim.dim_param}")
                    else:
                        shape_info.append("dynamic:?")
                output_shapes[out.name] = shape_info
    except Exception as e:
        _logger.warning("Failed to extract ONNX shapes for %s: %s", model_path, e)

    return input_shapes, output_shapes


def install_paddlex_offline_model_source_guard() -> None:
    if "aistudio_sdk" in sys.modules:
        return

    package = types.ModuleType("aistudio_sdk")
    package.__path__ = []
    errors = types.ModuleType("aistudio_sdk.errors")
    snapshot = types.ModuleType("aistudio_sdk.snapshot_download")

    class NotExistError(RuntimeError):
        pass

    def snapshot_download(*_args, **_kwargs):
        raise RuntimeError("AILS blocks PaddleX network model downloads; use ModelManager.")

    errors.NotExistError = NotExistError
    snapshot.snapshot_download = snapshot_download
    package.errors = errors
    package.snapshot_download = snapshot
    sys.modules.update({
        "aistudio_sdk": package,
        "aistudio_sdk.errors": errors,
        "aistudio_sdk.snapshot_download": snapshot,
    })


def configure_paddlex_logging():
    # PaddleX configures its own stderr handler at import time. Keep warnings
    # and errors visible, but omit repetitive model/cache INFO messages.
    logging.getLogger("paddlex").setLevel(logging.WARNING)
    logging.getLogger("paddleocr").setLevel(logging.ERROR)


def load_paddlex_runtime():
    """Import the packaged PaddleOCR/PaddleX runtime with the offline guard."""
    install_paddlex_offline_model_source_guard()
    ort = load_onnxruntime()
    return ort


def dml_device_id() -> int:
    """Return the DirectML device index from the environment or default 0."""
    raw = os.environ.get("AILS_DML_DEVICE_ID", "0")
    try:
        return max(0, int(raw))
    except (ValueError, TypeError):
        return 0


def cuda_device_id() -> int:
    raw = os.environ.get("AILS_CUDA_DEVICE_ID", "0")
    try:
        return max(0, int(raw))
    except (ValueError, TypeError):
        return 0


def provider_device_id(provider: str | None) -> int:
    if provider == "DmlExecutionProvider":
        return dml_device_id()
    if provider == "CUDAExecutionProvider":
        return cuda_device_id()
    return 0


def openvino_cache_dir() -> str:
    root = (
        os.environ.get("AILS_OPENVINO_CACHE_DIR")
        or os.path.join(
            os.environ.get("LOCALAPPDATA")
            or os.environ.get("APPDATA")
            or tempfile.gettempdir(),
            "AILS",
            "openvino_cache",
        )
    )
    try:
        os.makedirs(root, exist_ok=True)
    except OSError:
        pass
    return root


def provider_options(provider: str | None) -> dict:
    if provider == "DmlExecutionProvider":
        device_id = dml_device_id()
        return {"device_id": device_id} if device_id else {}
    if provider == "CUDAExecutionProvider":
        return {"device_id": cuda_device_id()}
    if provider == "OpenVINOExecutionProvider":
        return {
            "device_type": "GPU",
            "load_config": OPENVINO_GPU_LOAD_CONFIG,
            "cache_dir": openvino_cache_dir(),
        }
    return {}


def device_string_for_profile(profile) -> str:
    if profile is not None and getattr(profile, "gpu_provider", None) in GPU_PROVIDERS:
        return "gpu"
    return "cpu"


def install_onnxruntime_engine_patches(ort, profile) -> None:
    """Force PaddleX ONNX runners onto the probed AILS provider.

    PaddleX picks providers itself and assumes a desktop CUDA runtime; the
    packaged AILS runtimes (DirectML/OpenVINO/CUDA isolated trees) need the
    provider list, provider options and (for DirectML) sequential execution
    without memory patterns to stay stable.
    """
    from paddlex.inference.models.engines.onnxruntime import ONNXRuntimeEngine
    from paddlex.inference.models.runners.onnxruntime_runner import ONNXRuntimeRunner

    gpu_provider = getattr(profile, "gpu_provider", None)

    def check_engine_device(self, engine_config):
        device_type = engine_config.get("device_type")
        if device_type not in {None, "cpu", "gpu"}:
            raise ValueError("ONNX Runtime OCR은 cpu 또는 gpu 장치만 지원합니다.")

    def selected_providers(self):
        device_type = (self._config.get("device_type") or "cpu").lower()
        if device_type == "gpu" and gpu_provider:
            if gpu_provider == "OpenVINOExecutionProvider":
                model_dir_name = os.path.basename(
                    os.path.normpath(str(self.model_dir))
                ).lower()
                if model_dir_name in OPENVINO_CPU_ONLY_MODEL_DIRS:
                    return ["CPUExecutionProvider"], None
            return (
                [gpu_provider, "CPUExecutionProvider"],
                [provider_options(gpu_provider), {}],
            )
        return ["CPUExecutionProvider"], None

    ONNXRuntimeEngine._check_device_support = check_engine_device
    ONNXRuntimeRunner._default_providers = selected_providers

    original = getattr(
        ONNXRuntimeRunner,
        "_ails_original_build_session_options",
        ONNXRuntimeRunner._build_session_options,
    )
    ONNXRuntimeRunner._ails_original_build_session_options = original

    # Wrap _create_session to log detailed info
    original_create_session = ONNXRuntimeRunner._create_session

    def logged_create_session(self):
        model_path = self._get_model_path()
        model_name = self.model_file_prefix
        session_options = self._build_session_options()
        providers, provider_options = self._resolve_providers()

        # Get input/output shapes from the model
        input_shapes = {}
        output_shapes = {}
        try:
            import onnx
            model = onnx.load(str(model_path))
            for inp in model.graph.input:
                shape_info = []
                if inp.type.HasField('tensor_type'):
                    tensor_type = inp.type.tensor_type
                    for dim in tensor_type.shape.dim:
                        if dim.HasField('dim_value'):
                            shape_info.append(dim.dim_value)
                        elif dim.HasField('dim_param'):
                            shape_info.append(f"dynamic:{dim.dim_param}")
                        else:
                            shape_info.append("dynamic:?")
                    input_shapes[inp.name] = shape_info
            for out in model.graph.output:
                shape_info = []
                if out.type.HasField('tensor_type'):
                    tensor_type = out.type.tensor_type
                    for dim in tensor_type.shape.dim:
                        if dim.HasField('dim_value'):
                            shape_info.append(dim.dim_value)
                        elif dim.HasField('dim_param'):
                            shape_info.append(f"dynamic:{dim.dim_param}")
                        else:
                            shape_info.append("dynamic:?")
                    output_shapes[out.name] = shape_info
        except Exception as e:
            _logger.warning("Failed to extract ONNX shapes for %s: %s", model_path, e)

        actual_providers = None
        requested_primary = providers[0] if providers else None
        if isinstance(requested_primary, tuple):
            requested_primary = requested_primary[0]
        session_kwargs = {}
        if requested_primary == "OpenVINOExecutionProvider":
            session_kwargs["enable_fallback"] = False

        try:
            session = self._ort.InferenceSession(
                str(model_path),
                sess_options=session_options,
                providers=providers,
                provider_options=provider_options,
                **session_kwargs,
            )
            actual_providers = list(session.get_providers())
            if (
                requested_primary == "OpenVINOExecutionProvider"
                and (
                    not actual_providers
                    or actual_providers[0] != "OpenVINOExecutionProvider"
                )
            ):
                raise RuntimeError(
                    "OpenVINOExecutionProvider를 요청했지만 실제 세션 공급자는 "
                    f"{actual_providers or ['none']}입니다."
                )
            session_id = _register_session(
                session,
                model_name=model_name,
                model_path=str(model_path),
                requested_providers=providers,
                actual_providers=actual_providers,
            )
            self._ails_session_id = session_id
            self._ails_model_name = model_name
            self._ails_model_path = str(model_path)
            _log_session_creation(
                model_name,
                str(model_path),
                providers,
                provider_options,
                input_shapes,
                output_shapes,
                True,
                actual_providers=actual_providers,
            )
            return session
        except Exception as e:
            _log_session_creation(
                model_name,
                str(model_path),
                providers,
                provider_options,
                input_shapes,
                output_shapes,
                False,
                str(e),
                actual_providers=actual_providers,
            )
            raise

    ONNXRuntimeRunner._create_session = logged_create_session

    original_call = getattr(
        ONNXRuntimeRunner,
        "_ails_original_call",
        ONNXRuntimeRunner.__call__,
    )
    ONNXRuntimeRunner._ails_original_call = original_call

    def logged_call(self, *args, **kwargs):
        global _active_inference_count
        model_name = str(
            getattr(self, "_ails_model_name", self.model_file_prefix)
        )
        input_shapes = []
        if args:
            raw_inputs = args[0]
            values = (
                raw_inputs
                if isinstance(raw_inputs, (list, tuple))
                else [raw_inputs]
            )
            input_shapes = [list(getattr(value, "shape", ())) for value in values]
        with _session_registry_lock:
            _active_inference_count += 1
            _active_inference_models[model_name] = (
                _active_inference_models.get(model_name, 0) + 1
            )
            active = _active_inference_count
            active_models = sorted(_active_inference_models)
        _logger.info(
            "ONNX inference start: model=%s session_id=%s inputs=%s "
            "active_inferences=%d active_models=%s pid=%d thread_id=%d",
            model_name,
            getattr(self, "_ails_session_id", None),
            input_shapes,
            active,
            active_models,
            os.getpid(),
            threading.get_ident(),
        )
        try:
            return original_call(self, *args, **kwargs)
        finally:
            with _session_registry_lock:
                _active_inference_count -= 1
                remaining = _active_inference_models.get(model_name, 0) - 1
                if remaining > 0:
                    _active_inference_models[model_name] = remaining
                else:
                    _active_inference_models.pop(model_name, None)
                active = _active_inference_count
            _logger.info(
                "ONNX inference end: model=%s session_id=%s "
                "active_inferences=%d pid=%d thread_id=%d",
                model_name,
                getattr(self, "_ails_session_id", None),
                active,
                os.getpid(),
                threading.get_ident(),
            )

    ONNXRuntimeRunner.__call__ = logged_call

    if gpu_provider == "DmlExecutionProvider":
        def dml_safe_session_options(self):
            sess_options = original(self)
            if (self._config.get("device_type") or "cpu").lower() == "gpu":
                sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
                sess_options.enable_mem_pattern = False
            return sess_options

        ONNXRuntimeRunner._build_session_options = dml_safe_session_options
    elif hasattr(ONNXRuntimeRunner, "_ails_original_build_session_options"):
        ONNXRuntimeRunner._build_session_options = (
            ONNXRuntimeRunner._ails_original_build_session_options
        )
