from __future__ import annotations

import glob
import codecs
import os
import queue
import re
import shutil
import subprocess
import threading
import time
import uuid


_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_CACHE_TTL_SECONDS = 3.0
_status_cache: tuple[float, dict] | None = None
_install_lock = threading.Lock()
_install_jobs_lock = threading.RLock()
_install_jobs: dict[str, dict] = {}
_active_install_job_id = ""
_JOB_OUTPUT_LIMIT = 12_000
_JOB_RETENTION_SECONDS = 60 * 60
_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_DOWNLOAD_AMOUNT_RE = re.compile(
    r"(?P<current>\d+(?:\.\d+)?)\s*(?P<current_unit>KB|MB|GB)\s*/\s*"
    r"(?P<total>\d+(?:\.\d+)?)\s*(?P<total_unit>KB|MB|GB)",
    re.IGNORECASE,
)
_PERCENT_RE = re.compile(r"(?<!\d)(?P<percent>\d{1,3}(?:\.\d+)?)\s*%")


DEVELOPER_TOOL_CATALOG = (
    {
        "id": "python",
        "label": "Python 3.13",
        "description": "Python scripts and external notebook kernels",
        "languages": ["Python"],
        "package_id": "Python.Python.3.13",
        "executables": ["python", "python3", "py"],
        "version_args": ["--version"],
        "paths": [
            r"%LOCALAPPDATA%\Programs\Python\Python313\python.exe",
            r"%ProgramFiles%\Python313\python.exe",
        ],
        "recommended": True,
    },
    {
        "id": "llvm",
        "label": "LLVM / Clang",
        "description": "One toolchain for compiling both C and C++",
        "languages": ["C", "C++"],
        "package_id": "LLVM.LLVM",
        "executables": ["clang", "clang.exe"],
        "version_args": ["--version"],
        "paths": [r"%ProgramFiles%\LLVM\bin\clang.exe"],
        "recommended": True,
    },
    {
        "id": "dotnet",
        "label": ".NET SDK 10",
        "description": "C# compiler and .NET command-line tools",
        "languages": ["C#"],
        "package_id": "Microsoft.DotNet.SDK.10",
        "executables": ["dotnet", "dotnet.exe"],
        "version_args": ["--version"],
        "paths": [r"%ProgramFiles%\dotnet\dotnet.exe"],
        "recommended": True,
    },
    {
        "id": "rust",
        "label": "Rustup",
        "description": "Rust compiler and Cargo toolchain manager",
        "languages": ["Rust"],
        "package_id": "Rustlang.Rustup",
        "executables": ["rustc", "rustc.exe"],
        "version_args": ["--version"],
        "paths": [r"%USERPROFILE%\.cargo\bin\rustc.exe"],
        "recommended": False,
    },
    {
        "id": "java",
        "label": "Temurin JDK 21",
        "description": "Java compiler; Spring projects can use their Maven or Gradle wrapper",
        "languages": ["Java", "Spring"],
        "package_id": "EclipseAdoptium.Temurin.21.JDK",
        "executables": ["javac", "javac.exe"],
        "version_args": ["-version"],
        "paths": [r"%ProgramFiles%\Eclipse Adoptium\jdk-21*\bin\javac.exe"],
        "recommended": False,
    },
    {
        "id": "lua",
        "label": "Lua 5.4",
        "description": "Lua interpreter for scripts and embedded-language exercises",
        "languages": ["Lua"],
        "package_id": "DEVCOM.Lua",
        "executables": ["lua", "lua.exe", "lua54", "lua54.exe"],
        "version_args": ["-v"],
        "paths": [
            r"%ProgramFiles%\Lua\lua.exe",
            r"%LOCALAPPDATA%\Programs\Lua\lua.exe",
        ],
        "recommended": False,
    },
    {
        "id": "node",
        "label": "Node.js LTS",
        "description": "JavaScript and TypeScript runtime",
        "languages": ["JavaScript", "TypeScript"],
        "package_id": "OpenJS.NodeJS.LTS",
        "executables": ["node", "node.exe"],
        "version_args": ["--version"],
        "paths": [r"%ProgramFiles%\nodejs\node.exe"],
        "recommended": False,
    },
    {
        "id": "go",
        "label": "Go",
        "description": "Go compiler and standard tooling",
        "languages": ["Go"],
        "package_id": "GoLang.Go",
        "executables": ["go", "go.exe"],
        "version_args": ["version"],
        "paths": [r"%ProgramFiles%\Go\bin\go.exe"],
        "recommended": False,
    },
)


def _find_from_patterns(patterns: list[str]) -> str:
    for pattern in patterns:
        expanded = os.path.expandvars(os.path.expanduser(pattern))
        matches = sorted(glob.glob(expanded), reverse=True)
        for match in matches:
            if os.path.isfile(match):
                return os.path.abspath(match)
    return ""


def _find_executable(tool: dict) -> str:
    for candidate in tool.get("executables", []):
        resolved = shutil.which(candidate)
        if resolved:
            return os.path.abspath(resolved)
    resolved = _find_from_patterns(tool.get("paths", []))
    if resolved:
        return resolved
    if tool.get("id") == "node":
        electron = os.path.expandvars(os.environ.get("AILS_ELECTRON_NODE_EXE", "").strip())
        if electron and os.path.isfile(electron):
            return os.path.abspath(electron)
    return ""


def _read_version(executable: str, args: list[str], env: dict | None = None) -> tuple[str, bool]:
    if not executable:
        return "", False
    try:
        completed = subprocess.run(
            [executable, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=8,
            creationflags=_CREATE_NO_WINDOW,
        )
        output = (completed.stdout or "").strip()
        version = output.splitlines()[0][:240] if output else ""
        return version, completed.returncode == 0 and bool(version)
    except Exception:
        return "", False


def _tool_status(tool: dict, winget_path: str) -> dict:
    executable = _find_executable(tool)
    run_env = None
    if tool.get("id") == "node" and executable == os.path.abspath(
        os.path.expandvars(os.environ.get("AILS_ELECTRON_NODE_EXE", "").strip())
    ):
        run_env = os.environ.copy()
        run_env["ELECTRON_RUN_AS_NODE"] = "1"
    version, executable_works = _read_version(
        executable,
        tool.get("version_args", ["--version"]),
        run_env,
    )
    return {
        "id": tool["id"],
        "label": tool["label"],
        "description": tool["description"],
        "languages": list(tool["languages"]),
        "package_id": tool["package_id"],
        "recommended": bool(tool.get("recommended")),
        "installed": bool(executable) and executable_works,
        "executable_path": executable,
        "version": version,
        "install_supported": os.name == "nt" and bool(winget_path),
    }


def developer_tools_status(*, force: bool = False) -> dict:
    global _status_cache
    now = time.monotonic()
    if not force and _status_cache and now - _status_cache[0] < _CACHE_TTL_SECONDS:
        return _status_cache[1]
    winget_path = shutil.which("winget") or ""
    result = {
        "platform": os.name,
        "winget_available": bool(winget_path),
        "tools": [_tool_status(tool, winget_path) for tool in DEVELOPER_TOOL_CATALOG],
    }
    _status_cache = (now, result)
    return result


def _catalog_tool(tool_id: str) -> dict:
    tool = next((item for item in DEVELOPER_TOOL_CATALOG if item["id"] == str(tool_id or "").strip()), None)
    if not tool:
        raise ValueError("Unknown developer tool.")
    return tool


def _winget_install_command(winget: str, tool: dict) -> list[str]:
    return [
        winget,
        "install",
        "--id",
        tool["package_id"],
        "--exact",
        "--source",
        "winget",
        "--silent",
        "--disable-interactivity",
        "--accept-package-agreements",
        "--accept-source-agreements",
    ]


def _unit_bytes(value: float, unit: str) -> float:
    factors = {"KB": 1024.0, "MB": 1024.0 ** 2, "GB": 1024.0 ** 3}
    return value * factors.get(unit.upper(), 1.0)


def parse_winget_progress(output: str, current_phase: str = "preparing", current_percent: float = 3.0) -> tuple[str, float]:
    normalized = _ANSI_ESCAPE_RE.sub("", str(output or "")).replace("\r", "\n")
    lowered = normalized.lower()
    phase = current_phase
    percent = float(current_percent)

    if "found " in lowered or "package agreements" in lowered:
        phase, percent = "preparing", max(percent, 8.0)
    if "downloading" in lowered:
        phase, percent = "downloading", max(percent, 15.0)

    amount_matches = list(_DOWNLOAD_AMOUNT_RE.finditer(normalized))
    if amount_matches:
        match = amount_matches[-1]
        current = _unit_bytes(float(match.group("current")), match.group("current_unit"))
        total = _unit_bytes(float(match.group("total")), match.group("total_unit"))
        if total > 0:
            phase = "downloading"
            percent = max(percent, min(75.0, 15.0 + (current / total) * 60.0))

    percent_matches = list(_PERCENT_RE.finditer(normalized))
    if percent_matches and phase == "downloading":
        reported = float(percent_matches[-1].group("percent"))
        percent = max(percent, min(75.0, 15.0 + min(100.0, reported) * 0.6))

    if "successfully verified installer hash" in lowered or "installer hash" in lowered:
        phase, percent = "verifying", max(percent, 78.0)
    if "starting package install" in lowered or "installing" in lowered:
        phase, percent = "installing", max(percent, 85.0)
    if "successfully installed" in lowered or "successfully upgraded" in lowered:
        phase, percent = "completed", 100.0
    return phase, round(min(100.0, percent), 1)


def _clean_job_output(value: str) -> str:
    normalized = _ANSI_ESCAPE_RE.sub("", str(value or "")).replace("\r", "\n")
    lines = [line.rstrip() for line in normalized.splitlines()]
    return "\n".join(line for line in lines if line.strip())[-_JOB_OUTPUT_LIMIT:]


def _job_snapshot(job: dict) -> dict:
    now = time.time()
    started_at = float(job.get("started_at") or job.get("created_at") or now)
    finished_at = float(job.get("finished_at") or 0)
    return {
        "job_id": job["job_id"],
        "tool_id": job["tool_id"],
        "tool_label": job["tool_label"],
        "status": job["status"],
        "phase": job["phase"],
        "progress_percent": job["progress_percent"],
        "created_at": job["created_at"],
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "elapsed_seconds": max(0.0, (finished_at or now) - started_at),
        "output": _clean_job_output(job.get("output", "")),
        "error": job.get("error", ""),
        "tool": job.get("tool"),
        "already_installed": bool(job.get("already_installed")),
        "restart_recommended": bool(job.get("restart_recommended")),
    }


def _update_job(job_id: str, **changes) -> None:
    with _install_jobs_lock:
        job = _install_jobs.get(job_id)
        if job:
            job.update(changes)


def _append_job_output(job_id: str, text: str) -> None:
    if not text:
        return
    with _install_jobs_lock:
        job = _install_jobs.get(job_id)
        if not job:
            return
        combined = f"{job.get('output', '')}{text}"[-_JOB_OUTPUT_LIMIT:]
        phase, percent = parse_winget_progress(combined, job["phase"], job["progress_percent"])
        job.update(output=combined, phase=phase, progress_percent=percent)


def _cleanup_install_jobs() -> None:
    cutoff = time.time() - _JOB_RETENTION_SECONDS
    with _install_jobs_lock:
        expired = [
            job_id for job_id, job in _install_jobs.items()
            if job.get("finished_at") and float(job["finished_at"]) < cutoff
        ]
        for job_id in expired:
            _install_jobs.pop(job_id, None)


def _run_install_job(job_id: str, tool: dict, winget: str, timeout_seconds: int) -> None:
    global _active_install_job_id, _status_cache
    _update_job(
        job_id,
        status="running",
        phase="preparing",
        progress_percent=3.0,
        started_at=time.time(),
    )
    process = None
    try:
        command = _winget_install_command(winget, tool)
        with _install_lock:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=False,
                creationflags=_CREATE_NO_WINDOW,
            )
            chunks: queue.Queue[bytes | None] = queue.Queue()

            def read_output() -> None:
                try:
                    while process and process.stdout:
                        reader = getattr(process.stdout, "read1", process.stdout.read)
                        chunk = reader(512)
                        if not chunk:
                            break
                        chunks.put(chunk)
                finally:
                    chunks.put(None)

            reader_thread = threading.Thread(target=read_output, daemon=True)
            reader_thread.start()
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            deadline = time.monotonic() + max(60, min(int(timeout_seconds), 3600))
            reader_finished = False
            while process.poll() is None or not reader_finished:
                if time.monotonic() >= deadline:
                    process.kill()
                    raise TimeoutError(f"{tool['label']} installation timed out.")
                try:
                    chunk = chunks.get(timeout=0.25)
                except queue.Empty:
                    continue
                if chunk is None:
                    reader_finished = True
                    continue
                _append_job_output(job_id, decoder.decode(chunk))

            remainder = decoder.decode(b"", final=True)
            if remainder:
                _append_job_output(job_id, remainder)
            return_code = process.wait(timeout=10)

        _status_cache = None
        after = _tool_status(tool, winget)
        with _install_jobs_lock:
            output = _install_jobs.get(job_id, {}).get("output", "")
        if return_code != 0 and not after["installed"]:
            raise RuntimeError(
                f"{tool['label']} installation failed (WinGet code {return_code}).\n{_clean_job_output(output)[-2000:]}"
            )
        _update_job(
            job_id,
            status="completed",
            phase="completed",
            progress_percent=100.0,
            finished_at=time.time(),
            tool=after,
            restart_recommended=not after["installed"],
        )
    except Exception as error:
        _update_job(
            job_id,
            status="failed",
            phase="failed",
            finished_at=time.time(),
            error=str(error),
        )
    finally:
        if process and process.poll() is None:
            process.kill()
        with _install_jobs_lock:
            if _active_install_job_id == job_id:
                _active_install_job_id = ""


def start_developer_tool_install(tool_id: str, timeout_seconds: int = 1800) -> dict:
    global _active_install_job_id
    _cleanup_install_jobs()
    tool = _catalog_tool(tool_id)
    if os.name != "nt":
        raise RuntimeError("Automatic developer-tool installation is currently available on Windows only.")
    winget = shutil.which("winget")
    if not winget:
        raise RuntimeError("WinGet is not available. Install or update Windows App Installer first.")

    before = _tool_status(tool, winget)
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "tool_id": tool["id"],
        "tool_label": tool["label"],
        "status": "queued",
        "phase": "preparing",
        "progress_percent": 0.0,
        "created_at": time.time(),
        "started_at": None,
        "finished_at": None,
        "output": "",
        "error": "",
        "tool": before if before["installed"] else None,
        "already_installed": bool(before["installed"]),
        "restart_recommended": False,
    }
    if before["installed"]:
        job.update(status="completed", phase="completed", progress_percent=100.0, finished_at=time.time())
        with _install_jobs_lock:
            _install_jobs[job_id] = job
        return _job_snapshot(job)

    with _install_jobs_lock:
        if _active_install_job_id:
            active = _install_jobs.get(_active_install_job_id)
            if active and active.get("status") in {"queued", "running"}:
                raise RuntimeError(f"{active['tool_label']} is already being installed.")
        _install_jobs[job_id] = job
        _active_install_job_id = job_id

    thread = threading.Thread(
        target=_run_install_job,
        args=(job_id, tool, winget, timeout_seconds),
        daemon=True,
        name=f"ails-tool-install-{tool['id']}",
    )
    thread.start()
    return developer_tool_install_status(job_id)


def developer_tool_install_status(job_id: str) -> dict:
    normalized = str(job_id or "").strip()
    with _install_jobs_lock:
        job = _install_jobs.get(normalized)
        if not job:
            raise KeyError("Developer-tool installation job not found.")
        return _job_snapshot(job)
