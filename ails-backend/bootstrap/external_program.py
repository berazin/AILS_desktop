"""Keep external programs independent of the frozen backend's native libraries."""
from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import sys
import threading

_spawn_lock = threading.RLock()


@contextmanager
def independent_program_spawn():
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        yield
        return
    import ctypes
    from ctypes import wintypes

    with _spawn_lock:
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.SetDllDirectoryW.argtypes = [wintypes.LPCWSTR]
        api.SetDllDirectoryW.restype = wintypes.BOOL
        api.GetDllDirectoryW.argtypes = [wintypes.DWORD, wintypes.LPWSTR]
        api.GetDllDirectoryW.restype = wintypes.DWORD
        buffer = ctypes.create_unicode_buffer(32768)
        api.GetDllDirectoryW(len(buffer), buffer)
        previous = buffer.value
        if not api.SetDllDirectoryW(None):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            yield
        finally:
            if not api.SetDllDirectoryW(previous or None):
                raise ctypes.WinError(ctypes.get_last_error())


def external_program_environment() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith(("_PYI_", "PYINSTALLER_", "AILS_"))
           and k.upper() not in {"PYTHONHOME", "PYTHONPATH"}}
    if not getattr(sys, "frozen", False):
        return env
    bundle = Path(getattr(sys, "_MEIPASS", sys.prefix)).resolve()

    def bundled(value: str) -> bool:
        return bool(value) and Path(value).resolve().is_relative_to(bundle)

    env["PATH"] = os.pathsep.join(p for p in env.get("PATH", "").split(os.pathsep) if p and not bundled(p))
    for key in ("QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH", "OPENSSL_MODULES"):
        if key in env and bundled(env[key]):
            env.pop(key)
    return env
