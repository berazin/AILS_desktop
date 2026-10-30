"""Verify and seed the offline learning runtime into writable, stable user storage."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid

from common import resource_path
from code_services.notebook_process import checked_python


def data_root() -> Path:
    override = os.environ.get("AILS_NOTEBOOK_DATA_DIR")
    base = os.environ.get("AILS_RUNTIME_DATA_DIR")
    path = Path(override) if override else (
        Path(base) / "notebooks" if base else Path(os.environ.get("LOCALAPPDATA", Path.home())) / "AILS" / "notebooks")
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def bundle_root() -> Path:
    override = os.environ.get("AILS_NOTEBOOK_BUNDLE_DIR")
    if override and not getattr(sys, "frozen", False):
        return Path(override).resolve()
    bundled = Path(resource_path("notebook-runtime"))
    if not bundled.exists() and not getattr(sys, "frozen", False):
        return Path(__file__).resolve().parents[2] / ".release-runtime-cache" / "notebook-runtime"
    return bundled


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_bundle(bundle: Path) -> dict:
    manifest_path = bundle / "manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError("기본 Python 학습 환경이 포함되지 않았습니다. 노트북 런타임이 포함된 AILS 설치가 필요합니다.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or not re.fullmatch(r"[a-zA-Z0-9._-]+", manifest.get("runtime_id", "")):
        raise ValueError("Invalid notebook runtime manifest")
    files = manifest.get("files", {})
    if not files or "python/python.exe" not in files or "requirements.lock" not in files or not any(p.startswith("wheels/") for p in files):
        raise ValueError("Incomplete notebook runtime manifest")
    actual_files = {path.relative_to(bundle).as_posix() for path in bundle.rglob("*") if path.is_file() and path != manifest_path}
    if actual_files != set(files):
        raise RuntimeError("노트북 기본 환경 무결성 검사 실패: 파일 목록이 변경되었습니다.")
    for name, expected in files.items():
        path = (bundle / name).resolve()
        if not path.is_relative_to(bundle.resolve()) or not path.is_file() or digest(path) != expected:
            raise RuntimeError(f"노트북 기본 환경 무결성 검사 실패: {name}")
    return manifest


def seed_environment(destination: Path, root: Path) -> dict:
    bundle = bundle_root()
    manifest = verify_bundle(bundle)
    runtime = root / "runtimes" / manifest["runtime_id"]
    if not runtime.exists():
        runtime.parent.mkdir(parents=True, exist_ok=True)
        staging = runtime.with_name(runtime.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            shutil.copytree(bundle / "python", staging)
            staging.rename(runtime)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
    # The venv points to a stable user copy, never to a versioned MSIX install path.
    base_python = str(runtime / "python.exe")
    destination.parent.mkdir(parents=True, exist_ok=True)
    python = str(destination / "Scripts" / "python.exe")
    try:
        checked_python(base_python, ["-I", "-m", "venv", str(destination)], root)
        checked_python(python, ["-I", "-m", "pip", "install", "--no-index", "--only-binary=:all:",
                               "--no-compile", "--require-hashes", "--find-links", str(bundle / "wheels"),
                               "-r", str(bundle / "requirements.lock")], root, timeout=300)
        checked_python(python, ["-I", "-c", "import ipykernel,IPython,numpy,pandas,matplotlib,matplotlib_inline"], root)
    except Exception:
        # Only the newly-created, owned environment is removed; existing environments never enter here.
        if destination.resolve().is_relative_to((root / "envs").resolve()):
            shutil.rmtree(destination, ignore_errors=True)
        raise
    return {"python": python, "runtime_id": manifest["runtime_id"], "version": manifest["python_version"]}
