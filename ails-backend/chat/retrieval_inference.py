"""Local retrieval inference; GPU first, explicit CPU fallback and device evidence."""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np


def _openvino():
    # Releases keep OpenVINO outside PyInstaller, in the audited OCR runtime.
    # Do not switch the already selected ONNX Runtime or import OCR providers.
    from ocr_runtime import packaged_ocr_runtime_root, _add_runtime_dll_directories
    root = packaged_ocr_runtime_root()
    if root is not None:
        directory = root / "openvino"
        if directory.is_dir():
            if str(directory) not in sys.path:
                sys.path.append(str(directory))
            _add_runtime_dll_directories(directory)
    return importlib.import_module("openvino")


class RetrievalSession:
    """Small ONNX-session compatible facade, also accepts W8 OpenVINO IR.

    Shapes are bounded to the measured batch-one contract. No model is shared
    across inference requests without the owner's tokenizer/inference lock.
    """

    def __init__(self, model_path: str, *, max_tokens: int, cache_dir: str):
        self.evidence = {"fallback_errors": []}
        self._compiled = self._request = self._ort = None
        forced = os.environ.get("AILS_RETRIEVAL_DEVICE", "auto").strip().upper()
        if forced not in {"AUTO", "CPU", "GPU"}:
            raise ValueError("AILS_RETRIEVAL_DEVICE must be auto, GPU or CPU")
        try:
            ov = _openvino()
            core = ov.Core()
            devices = [d for d in core.available_devices if str(d).startswith("GPU")]
            if forced == "CPU":
                devices = []
            if forced == "CPU" or (forced == "AUTO" and str(model_path).lower().endswith(".xml")):
                devices.append("CPU")
            if forced == "GPU" and not devices:
                raise RuntimeError("No OpenVINO GPU available")
            graph = core.read_model(str(model_path))
            graph.reshape({p.get_any_name(): ov.PartialShape([1, ov.Dimension(1, max_tokens)])
                           for p in graph.inputs})
            for device in devices:
                try:
                    config = {"PERFORMANCE_HINT": "LATENCY", "NUM_STREAMS": "1",
                              "PERF_COUNT": "YES", "CACHE_DIR": str(Path(cache_dir) / device)}
                    if device.startswith("GPU"):
                        config["INFERENCE_PRECISION_HINT"] = "f16"
                    else:
                        config["INFERENCE_NUM_THREADS"] = min(4, os.cpu_count() or 1)
                    self._compiled = core.compile_model(graph, device, config)
                    self._request = self._compiled.create_infer_request()
                    self._types = {p.get_any_name(): p.get_element_type().to_dtype() for p in self._compiled.inputs}
                    self.evidence.update(engine="OpenVINO", version=ov.__version__,
                                         execution_devices=list(self._compiled.get_property("EXECUTION_DEVICES")),
                                         device=device, device_name=core.get_property(device, "FULL_DEVICE_NAME"),
                                         compute_precision="f16" if device.startswith("GPU") else "CPU default")
                    self.cache_tag = "openvino-gpu-f16" if device.startswith("GPU") else "openvino-cpu"
                    return
                except Exception as error:
                    self.evidence["fallback_errors"].append(f"{device}: {type(error).__name__}: {error}"[:500])
        except Exception as error:
            self.evidence["fallback_errors"].append(f"OpenVINO: {type(error).__name__}: {error}"[:500])
        if str(model_path).lower().endswith(".xml"):
            raise RuntimeError("W8 reranker requires the installed OpenVINO runtime: " + "; ".join(self.evidence["fallback_errors"]))
        from ocr_runtime import load_onnxruntime
        ort = load_onnxruntime()
        available = ort.get_available_providers()
        providers = [] if forced == "CPU" else [p for p in ("CUDAExecutionProvider", "DmlExecutionProvider") if p in available]
        if forced != "GPU":
            providers.append("CPUExecutionProvider")
        for provider in providers:
            try:
                options = ort.SessionOptions()
                options.intra_op_num_threads = 4
                if provider == "DmlExecutionProvider":
                    options.enable_mem_pattern = False
                    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
                session = ort.InferenceSession(str(model_path), sess_options=options, providers=[provider])
                if session.get_providers()[0] != provider:
                    raise RuntimeError("Requested provider was not activated")
                self._ort = session
                self._types = {p.name: np.int32 if "int32" in p.type else np.int64 for p in session.get_inputs()}
                self.evidence.update(engine="ONNX Runtime", version=ort.__version__, device=provider,
                                     execution_devices=session.get_providers(), compute_precision="source graph")
                self.cache_tag = "ort-" + provider
                return
            except Exception as error:
                self.evidence["fallback_errors"].append(f"{provider}: {type(error).__name__}: {error}"[:500])
        raise RuntimeError("No usable retrieval device: " + "; ".join(self.evidence["fallback_errors"]))

    def get_inputs(self):
        return [SimpleNamespace(name=name, type="tensor(int32)" if dtype == np.int32 else "tensor(int64)")
                for name, dtype in self._types.items()]

    def run(self, _outputs, feed):
        values = {name: np.asarray(feed[name], dtype=dtype) for name, dtype in self._types.items()}
        if self._ort is not None:
            return self._ort.run(None, values)
        outputs = list(self._request.infer(values).values())
        executed = [p for p in self._request.profiling_info if str(p.status).endswith("EXECUTED")]
        self.evidence["executed_node_types"] = sorted({p.exec_type for p in executed})
        return outputs
