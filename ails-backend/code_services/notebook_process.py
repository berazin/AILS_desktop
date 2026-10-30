"""Subprocess policy for the independent notebook interpreter (not an OS sandbox)."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

from common import CREATE_NO_WINDOW
from bootstrap.external_program import independent_program_spawn as independent_python_spawn


def child_environment(python: str, data_root: Path) -> dict[str, str]:
    excluded = {"PYTHONHOME", "PYTHONPATH", "PYTHONDONTWRITEBYTECODE", "PYTHONPYCACHEPREFIX",
                "VIRTUAL_ENV", "CONDA_PREFIX", "CONDA_DEFAULT_ENV"}
    env = {k: v for k, v in os.environ.items() if k.upper() not in excluded
           and not any(word in k.upper() for word in ("TOKEN", "SECRET", "PASSWORD", "API_KEY"))
           and not k.upper().startswith(("PIP_", "UV_"))}
    prefix = Path(python).parent
    paths = [str(prefix), str(prefix.parent)]
    backend_roots = [Path(sys.prefix).resolve(), Path(getattr(sys, "_MEIPASS", sys.prefix)).resolve()]
    paths += [p for p in env.get("PATH", "").split(os.pathsep)
              if p and not any(Path(p).resolve().is_relative_to(base) for base in backend_roots)]
    env.update(PATH=os.pathsep.join(paths), PYTHONNOUSERSITE="1", PYTHONUTF8="1",
               PYTHONPYCACHEPREFIX=str(data_root / "cache" / "bytecode"), PIP_REQUIRE_VIRTUALENV="true",
               PIP_DISABLE_PIP_VERSION_CHECK="1", PIP_NO_INPUT="1",
               PIP_CONFIG_FILE=os.devnull, UV_NO_CONFIG="1", UV_PYTHON_DOWNLOADS="never",
               UV_CACHE_DIR=str(data_root / "cache" / "uv"),
               PIP_CACHE_DIR=str(data_root / "cache" / "pip"),
               MPLCONFIGDIR=str(data_root / "cache" / "matplotlib"),
               IPYTHONDIR=str(data_root / "ipython"),
               JUPYTER_CONFIG_DIR=str(data_root / "jupyter"),
               JUPYTER_RUNTIME_DIR=str(data_root / "jupyter" / "runtime"),
               MPLBACKEND="module://matplotlib_inline.backend_inline")
    return env


def run_python(python: str, args: list[str], data_root: Path, *, timeout: int = 120):
    command = [python, *args]
    with independent_python_spawn():
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW,
                                   env=child_environment(python, data_root), cwd=str(data_root))
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_process_tree(process)
        process.communicate()
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def stop_process_tree(process):
    if process.poll() is None:
        if os.name == "nt":
            subprocess.run([str(Path(os.environ["SystemRoot"]) / "System32" / "taskkill.exe"),
                            "/PID", str(process.pid), "/T", "/F"], capture_output=True, creationflags=CREATE_NO_WINDOW)
        else:
            process.kill()
        process.wait(timeout=10)


def checked_python(python: str, args: list[str], data_root: Path, *, timeout: int = 120):
    result = run_python(python, args, data_root, timeout=timeout)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or f"Python exit {result.returncode}")[-8000:])
    return result.stdout
