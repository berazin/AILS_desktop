"""Reject frozen backends that omit tiktoken's dynamically discovered plugin."""
from pathlib import Path


REQUIRED_TIKTOKEN_MODULES = frozenset({
    "tiktoken",
    "tiktoken.core",
    "tiktoken.load",
    "tiktoken.registry",
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
})


def verify_frozen_tiktoken(backend_dir: Path) -> None:
    from PyInstaller.archive.readers import CArchiveReader

    executable = backend_dir / "AILSBackend.exe"
    archive = CArchiveReader(str(executable))
    modules = set()
    for name, entry in archive.toc.items():
        if entry[-1] == "z":
            modules.update(archive.open_embedded_archive(name).toc)
    missing = REQUIRED_TIKTOKEN_MODULES - modules
    if missing:
        raise RuntimeError(
            f"Frozen backend is missing required tiktoken modules: {', '.join(sorted(missing))}. "
            "Rebuild the backend with tiktoken_ext.openai_public included; "
            f"do not reuse this backend: {executable}"
        )
