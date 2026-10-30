"""Stage pinned offline notebook assets; this does not build an app or installer.

Downloads happen only when explicitly preparing a developer runtime or a release.
The app never calls this script. Runtime setup uses --no-index exclusively.
"""
from __future__ import annotations

import argparse
import email
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
LOCK = Path(__file__).with_name("notebook_runtime.lock.json")
REQUIREMENTS = Path(__file__).with_name("notebook_requirements.lock")


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare_notebook_runtime(destination: Path) -> Path:
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    source_hash = hashlib.sha256(LOCK.read_bytes() + REQUIREMENTS.read_bytes()).hexdigest()
    manifest_path = destination / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("source_hash") == source_hash and manifest.get("files") and all(
            (destination / name).is_file() and sha256(destination / name) == digest
            for name, digest in manifest["files"].items()
        ):
            return destination
        raise RuntimeError(f"Existing notebook bundle is stale or corrupt; prepare into a new directory: {destination}")
    cache = ROOT / ".release-runtime-cache"
    cache.mkdir(exist_ok=True)
    archive = cache / "notebook-python.tar.gz"
    if not archive.is_file() or sha256(archive) != lock["sha256"]:
        with urllib.request.urlopen(lock["url"], timeout=180) as response, archive.open("wb") as target:
            shutil.copyfileobj(response, target)
    if sha256(archive) != lock["sha256"]:
        raise RuntimeError("Notebook CPython SHA-256 mismatch")
    with tarfile.open(archive) as tar:
        # Reject links and paths outside the bundle before extracting pinned upstream data.
        for member in tar.getmembers():
            if not (destination / member.name).resolve().is_relative_to(destination) or member.issym() or member.islnk():
                raise ValueError("Unsafe notebook runtime archive path")
        tar.extractall(destination, filter="data")
    wheels = destination / "wheels"
    wheels.mkdir(exist_ok=True)
    subprocess.run([sys.executable, "-m", "pip", "--isolated", "download", "--disable-pip-version-check",
                    "--index-url", "https://pypi.org/simple", "--require-hashes", "--only-binary=:all:",
                    "--platform", "win_amd64", "--python-version", "3.12", "--implementation", "cp", "--abi", "cp312",
                    "--dest", str(wheels), "-r", str(REQUIREMENTS)], check=True)
    shutil.copy2(REQUIREMENTS, destination / "requirements.lock")
    shutil.copy2(LOCK, destination / "runtime-source.json")
    # Expose wheel metadata and license texts to the existing release inventory/audit.
    inventory = []
    notices = destination / "notices"
    notices.mkdir(exist_ok=True)
    for wheel in sorted(wheels.glob("*.whl")):
        with zipfile.ZipFile(wheel) as zipped:
            metadata_name = next(name for name in zipped.namelist() if name.endswith(".dist-info/METADATA"))
            metadata = email.message_from_bytes(zipped.read(metadata_name))
            dist_info = metadata_name.split("/")[0]
            copied = []
            for name in zipped.namelist():
                if name.endswith("/"):
                    continue
                basename = Path(name).name.lower()
                if name == metadata_name or any(part in basename for part in ("license", "licence", "copying", "notice", "copyright")):
                    relative = name if name.startswith(dist_info + "/") else dist_info + "/bundled/" + name
                    target = (notices / relative).resolve()
                    if not target.is_relative_to(notices.resolve()):
                        raise ValueError("Unsafe wheel license path")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(zipped.read(name))
                    if name != metadata_name:
                        copied.append(target.relative_to(destination).as_posix())
            if not copied:
                raise RuntimeError(f"Notebook wheel has no redistribution license: {wheel.name}")
            inventory.append({"name": metadata["Name"], "version": metadata["Version"],
                              "filename": wheel.name, "sha256": sha256(wheel), "licenses": copied})
    python_notice = notices / f"ails_notebook_cpython-{lock['python_version']}.dist-info"
    python_notice.mkdir(exist_ok=True)
    (python_notice / "METADATA").write_text(f"Metadata-Version: 2.4\nName: ails-notebook-cpython\nVersion: {lock['python_version']}\nLicense-Expression: PSF-2.0\nHome-page: https://docs.astral.sh/python-build-standalone/\n", encoding="utf-8")
    shutil.copy2(destination / "python" / "LICENSE.txt", python_notice / "LICENSE.txt")
    manifest = {"schema_version": 1, "runtime_id": lock["runtime_id"], "python_version": lock["python_version"],
                "platform": lock["platform"], "source_hash": source_hash, "packages": inventory,
                "files": {p.relative_to(destination).as_posix(): sha256(p)
                          for p in sorted(destination.rglob("*")) if p.is_file() and p != manifest_path}}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=ROOT / ".release-runtime-cache" / "notebook-runtime")
    arguments = parser.parse_args()
    print(prepare_notebook_runtime(arguments.destination))
