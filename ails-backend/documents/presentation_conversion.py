"""Bounded, isolated LibreOffice conversion without inherited stdout pipe waits."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import shutil

from bootstrap.external_program import external_program_environment, independent_program_spawn


def _stop_converter(process: subprocess.Popen) -> None:
    import psutil

    try:
        parent = psutil.Process(process.pid)
        owned = [parent, *parent.children(recursive=True)]
    except psutil.NoSuchProcess:
        owned = []
    for child in reversed(owned):
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
    if process.poll() is None:
        process.kill()
    process.wait(timeout=5)
    _, alive = psutil.wait_procs(owned, timeout=5)
    if alive:
        raise RuntimeError("PPT/PPTX 변환 프로세스를 종료하지 못했습니다.")


def run_presentation_conversion(executable: str, source: str, target: str, *, timeout: float = 180) -> None:
    # A shared LibreOffice profile can retain recovery/lock state or redirect a
    # second conversion into another soffice instance. Own both profile/output.
    console = Path(executable).with_suffix(".com")
    if os.name == "nt" and console.is_file():
        executable = str(console)
    # LibreOffice still creates legacy MAX_PATH-sensitive profile subpaths.
    # Keep the profile below the short system temp root, not a deep app/cache path.
    with tempfile.TemporaryDirectory(prefix="ails-ppt-") as directory:
        work = Path(directory)
        assert work.resolve().parent == Path(tempfile.gettempdir()).resolve()
        profile, output = work / "profile", work / "output"
        profile.mkdir()
        output.mkdir()
        command = [executable, "--headless", "--nologo", "--nodefault", "--norestore",
                   "--nofirststartwizard", f"-env:UserInstallation={profile.as_uri()}",
                   "--convert-to", "pdf:impress_pdf_Export", "--outdir", str(output), source]
        # File-backed output avoids communicate() waiting forever on a pipe
        # still held by a child after the launcher times out or exits.
        with tempfile.TemporaryFile() as log:
            # LibreOffice owns a separate Python/C++ runtime. Inheriting the
            # packaged backend's DLL directory/PATH can load incompatible DLLs.
            with independent_program_spawn():
                process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log,
                                           stderr=subprocess.STDOUT, env=external_program_environment(),
                                           cwd=work, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                process.wait(timeout=timeout)
            except BaseException as error:
                _stop_converter(process)
                if isinstance(error, subprocess.TimeoutExpired):
                    raise RuntimeError("PPT/PPTX PDF 변환 시간이 초과되었습니다. 다시 열어 주세요.") from None
                raise
            log.seek(0, os.SEEK_END)
            log.seek(max(0, log.tell() - 8192))
            detail = log.read(8192).decode("utf-8", errors="replace").strip()[-1000:]
        converted = output / (Path(source).stem + ".pdf")
        if process.returncode != 0 or not converted.is_file() or converted.stat().st_size == 0:
            raise RuntimeError(f"PPT/PPTX PDF 변환에 실패했습니다 (종료 코드 {process.returncode}): {detail}")
        # System temp and the application cache can be on different volumes.
        descriptor, staged = tempfile.mkstemp(prefix=".ppt-export-", suffix=".pdf", dir=Path(target).parent)
        try:
            with os.fdopen(descriptor, "wb") as destination, converted.open("rb") as source_pdf:
                shutil.copyfileobj(source_pdf, destination)
            os.replace(staged, target)
        finally:
            Path(staged).unlink(missing_ok=True)
