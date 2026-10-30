"""Reject build-environment customization accidentally frozen into a release."""
from pathlib import Path


def verify_frozen_runtime_customization(backend_dir: Path) -> None:
    from PyInstaller.archive.readers import CArchiveReader
    archive = CArchiveReader(str(backend_dir / "AILSBackend.exe"))
    modules = set(archive.toc)
    for name, entry in archive.toc.items():
        if entry[-1] == "z":
            modules.update(archive.open_embedded_archive(name).toc)
    forbidden = modules & {"sitecustomize", "usercustomize"}
    if forbidden:
        raise RuntimeError("Build-environment customization was frozen into the backend: " + ", ".join(sorted(forbidden)))
