"""Exact-file grants recorded by the Electron OS file-open entry point."""
import json
import os
from pathlib import Path


def is_external_document(value: str, *, existing: bool = True) -> bool:
    manifest = os.environ.get("AILS_EXTERNAL_DOCUMENTS", "")
    if not manifest or not value:
        return False
    try:
        target = Path(value).resolve(strict=existing)
        if (existing and not target.is_file()) or not target.parent.is_dir() or (target.exists() and not target.is_file()):
            return False
        grants = json.loads(Path(manifest).read_text(encoding="utf-8"))
        # Do not resolve old grants: replacing an approved path with a symlink
        # must not authorize the symlink's new target.
        return isinstance(grants, list) and os.path.normcase(str(target)) in {
            os.path.normcase(item) for item in grants if isinstance(item, str)
        }
    except (OSError, ValueError, RuntimeError):
        return False
