from __future__ import annotations

import importlib
import importlib.machinery
import sys
import types
from typing import Any


SUPPORTED_FASTER_WHISPER_VERSION = "1.2.1"
_PYAV_STUB_MARKER = "__ails_pyav_disabled__"


def _pyav_disabled(*_args: Any, **_kwargs: Any) -> None:
    raise RuntimeError(
        "PyAV decoding is disabled in AILS. Pass a 16 kHz mono float32 NumPy array to faster-whisper."
    )


def install_disabled_pyav_stub() -> types.ModuleType:
    existing = sys.modules.get("av")
    if existing is not None and getattr(existing, _PYAV_STUB_MARKER, False):
        return existing

    stub = types.ModuleType("av")
    stub.__spec__ = importlib.machinery.ModuleSpec("av", loader=None)
    setattr(stub, _PYAV_STUB_MARKER, True)
    stub.open = _pyav_disabled

    error_module = types.ModuleType("av.error")
    error_module.__spec__ = importlib.machinery.ModuleSpec("av.error", loader=None)

    class InvalidDataError(Exception):
        pass

    error_module.InvalidDataError = InvalidDataError
    stub.error = error_module
    stub.audio = types.SimpleNamespace(
        resampler=types.SimpleNamespace(AudioResampler=_pyav_disabled),
        fifo=types.SimpleNamespace(AudioFifo=_pyav_disabled),
    )
    sys.modules["av"] = stub
    sys.modules["av.error"] = error_module
    return stub


def load_faster_whisper_model_class():
    stub = install_disabled_pyav_stub()
    module = importlib.import_module("faster_whisper")
    version = str(getattr(module, "__version__", "") or "")
    if version != SUPPORTED_FASTER_WHISPER_VERSION:
        raise RuntimeError(
            f"Unsupported faster-whisper version {version or 'unknown'}; "
            f"AILS requires {SUPPORTED_FASTER_WHISPER_VERSION}."
        )

    audio_module = importlib.import_module("faster_whisper.audio")
    transcribe_module = importlib.import_module("faster_whisper.transcribe")
    audio_module.av = stub
    audio_module.decode_audio = _pyav_disabled
    transcribe_module.decode_audio = _pyav_disabled
    module.decode_audio = _pyav_disabled
    return module.WhisperModel
