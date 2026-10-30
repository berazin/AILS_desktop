"""AILS-owned hidden directory names and read compatibility for older paths."""
from __future__ import annotations

import itertools
import os
from pathlib import Path

SYSTEM_DIRS = {"_codes": ".codes", "_images": ".images", "_resume": ".resume", "_link": ".link", "_trash": ".trash"}
IMAGE_DIR_NAMES = (".images", "_images")
DATA_INTERNAL_DIRS = {".git", ".codex", ".agents", ".aws", ".obsidian", "node_modules",
                      "venv", ".venv", ".ails-venv", "site-packages", "__pycache__", "_internal", "build", "dist"}


def canonical_data_folder_name(name: str) -> str:
    """The configured AILS data area treats every leading underscore as storage."""
    if name.casefold() in DATA_INTERNAL_DIRS:
        return name
    if name.startswith("_"):
        target = "." + name[1:]
        if target in {".", ".."} or target.endswith((" ", ".")):
            raise ValueError(f"System folder has no safe dot-prefixed target: {name}")
        return target
    return name


def visible_data_folder_name(name: str) -> bool:
    return bool(name) and not name.startswith((".", "_")) and name.casefold() not in DATA_INTERNAL_DIRS


def legacy_code_folder(path, *, recursive=False) -> bool:
    """Document-specific code storage has an app marker, not just a suffix."""
    path = Path(path)
    if not path.name.casefold().endswith("_codes"):
        return False
    if (path / ".ails-code-project").is_file() or (path / ".ails-problems").is_dir():
        return True
    if not recursive:
        return False
    for directory, dirs, files in os.walk(path, followlinks=False):
        dirs[:] = [name for name in dirs if name.casefold() not in DATA_INTERNAL_DIRS
                   and not Path(directory, name).is_symlink() and not Path(directory, name).is_junction()]
        if ".ails-code-project" in files or ".ails-problems" in dirs:
            return True
    return False


def visible_data_folder(path) -> bool:
    return visible_data_folder_name(Path(path).name) and not legacy_code_folder(path)


def storage_write_base(path: str) -> str:
    """Code storage writers never recreate a known legacy base directory."""
    resolved = Path(resolve_system_path(os.path.abspath(os.path.expanduser(str(path)))))
    name = canonical_system_name(resolved.name)
    if name == resolved.name:
        return str(resolved)
    if resolved.exists():
        raise RuntimeError("Legacy system storage must be migrated before writing; existing data was preserved.")
    return str(resolved.with_name(name))


def canonical_system_name(name: str) -> str:
    if name in SYSTEM_DIRS:
        return SYSTEM_DIRS[name]
    for suffix in ("_codes", "_images"):
        if name.lower().endswith(suffix):
            return "." + name[:-len(suffix)] + suffix.replace("_", ".", 1)
    return name


def legacy_system_name(name: str) -> str:
    reverse = {value: key for key, value in SYSTEM_DIRS.items()}
    if name in reverse:
        return reverse[name]
    for suffix in (".codes", ".images"):
        if name.startswith(".") and name.endswith(suffix):
            return name[1:-len(suffix)] + suffix.replace(".", "_", 1)
    return name


def system_path_candidates(path: str):
    parts = Path(path).parts
    variants = [tuple(dict.fromkeys((part, canonical_system_name(part), legacy_system_name(part)))) for part in parts]
    for candidate in itertools.islice(itertools.product(*variants), 64):
        yield str(Path(*candidate))


def resolve_system_path(path: str) -> str:
    if not path:
        return path
    if os.path.exists(path):
        return path
    from documents.system_storage_journal import resolve_recorded_path
    recorded = resolve_recorded_path(path)
    if recorded:
        return recorded
    for candidate in system_path_candidates(path):
        if os.path.exists(candidate):
            return candidate
    return path
