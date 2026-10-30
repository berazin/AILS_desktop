"""Verify an NSIS release in isolated directories, without installing it globally."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import yaml
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[2]


def digest(path: Path, algorithm="sha256"):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def backend_smoke(package: Path, work: Path, *, backend_path=None, frontend_path=None):
    token = secrets.token_hex(32)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = {**os.environ, "AILS_LOCAL_API_TOKEN": token,
           "AILS_RUNTIME_DATA_DIR": str(work / "runtime"), "AILS_EDITION": "developer"}
    backend = backend_path or package / "resources/backend/AILSBackend/AILSBackend.exe"
    log = (work / "backend.log").open("wb")
    process = subprocess.Popen([str(backend), "--port", str(port), "--frontend",
                                str(frontend_path or package / "resources/frontend")],
                               cwd=work, env=env, stdout=log, stderr=log)
    def get(path, authenticated=True):
        headers = {"X-AILS-Token": token} if authenticated else {}
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers=headers)
        return urllib.request.urlopen(request, timeout=15).read()
    try:
        deadline = time.monotonic() + 180
        while True:
            if process.poll() is not None:
                raise RuntimeError(f"Packaged backend exited: {process.returncode}; see {work / 'backend.log'}")
            try:
                health = json.loads(get("/api/health"))
                break
            except (OSError, ValueError):
                if time.monotonic() >= deadline:
                    raise RuntimeError("Packaged backend readiness timed out")
                time.sleep(1)
        assert health["ok"] and health["edition"] == "developer", health
        edition = json.loads(get("/api/edition"))
        assert edition["manifest_sha256"] == health["edition_manifest_sha256"]
        try:
            get("/api/model-options", False)
        except urllib.error.HTTPError as error:
            assert error.code == 403, error.code
        else:
            raise AssertionError("Protected API accepted a request without a token")
        assert json.loads(get("/api/model-options"))
        assert b"<html" in get("/").lower()
        return {"health": health, "api_auth": True, "model_options": True, "frontend": True}
    finally:
        process.terminate()
        process.wait(timeout=30)
        log.close()


def installer_smoke(installer: Path, version: str, work: Path):
    install = work / "a"
    install.mkdir()
    source = work / "Parent.cs"
    source.write_text("class Parent { static void Main() { System.Threading.Thread.Sleep(-1); } }", encoding="utf-8")
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    executable = install / "AILS.exe"
    subprocess.run([str(compiler), "/nologo", "/target:winexe", f"/out:{executable}", str(source)], check=True)
    old_hash = digest(executable)
    tools = install / "resources/backend/AILSBackend/tools/ffmpeg"
    shutil.copytree(ROOT / "tools/ffmpeg", tools)
    parent = subprocess.Popen([str(executable)])
    session_id = secrets.token_hex(16)
    session = work / "sessions" / session_id
    session.mkdir(parents=True)
    request = {"protocol": 1, "id": session_id, "nonce": secrets.token_hex(32),
               "installDir": str(install), "executablePath": str(executable),
               "parentPid": parent.pid, "expectedVersion": version}
    (session / "request.json").write_text(json.dumps(request), encoding="utf-8")
    local = work / "local-app-data"
    local.mkdir()
    env = {**os.environ, "LOCALAPPDATA": str(local), "APPDATA": str(local),
           "PSModulePath": str(Path(os.environ["WINDIR"]) / "System32/WindowsPowerShell/v1.0/Modules")}
    child = subprocess.Popen([str(installer), "--updated", "/S", "--ails-staged-update",
                              f"--ails-update-session={session}", f"--ails-update-id={session_id}",
                              f"/D={install}"], cwd=work, env=env)
    try:
        deadline = time.monotonic() + 900
        last_state = None
        while time.monotonic() < deadline:
            try:
                status = json.loads((session / "status.json").read_text(encoding="utf-8-sig"))
            except (OSError, ValueError):
                status = {}
            state = status.get("state")
            if state != last_state:
                print("Installer:", state, flush=True)
                last_state = state
            if state == "error":
                raise RuntimeError(status.get("error"))
            if state == "ready":
                assert parent.poll() is None and digest(executable) == old_hash
                stage = Path(f"{install}.ails-update-{session_id}")
                manifest_count = len(json.loads((stage / "ails-update-manifest.json").read_text())["files"])
                # Cancel before handoff: no registry changes or real installation.
                (session / "cancel").touch()
                child.wait(timeout=60)
                assert digest(executable) == old_hash
                return {"ready": True, "old_install_preserved": True,
                        "manifest_files": manifest_count}
            if child.poll() is not None:
                raise RuntimeError(f"Installer exited before ready: {child.returncode}, {status}")
            time.sleep(1)
        raise TimeoutError("Installer preparation timed out")
    finally:
        (session / "cancel").touch()
        if child.poll() is None:
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.terminate()
                child.wait(timeout=30)
        parent.terminate()
        parent.wait(timeout=30)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    version = json.loads((ROOT / "ails-frontend/package.json").read_text())["version"]
    installer = output / f"AILS-Setup-{version}.exe"
    print("Checking installer checksum and update metadata", flush=True)
    checksum = installer.with_name(installer.name + ".sha256")
    assert checksum.read_text().split()[0] == digest(installer)
    metadata = yaml.safe_load((output / "latest.yml").read_text(encoding="utf-8"))
    assert metadata["version"] == version
    update_file = next(item for item in metadata["files"] if item["url"] == installer.name)
    assert update_file["size"] == installer.stat().st_size
    assert update_file["sha512"] == base64.b64encode(bytes.fromhex(digest(installer, "sha512"))).decode("ascii")
    assert metadata.get("ailsStagedInstall") == 1 or update_file.get("ailsStagedInstall") == 1
    # Keep the fixture comparable to the default installation path. The staging
    # suffix adds 45 characters; a deeply nested workspace would exceed MAX_PATH.
    work = Path(tempfile.mkdtemp(prefix="ar"))
    package = output / "win-unpacked"
    manifest = json.loads((package / "ails-update-manifest.json").read_text())
    assert manifest["version"] == version
    longest_staged_path = len(str(work / "a")) + len(".ails-update-") + 32 + 1 + max(len(item["path"]) for item in manifest["files"])
    if longest_staged_path >= 260:
        raise RuntimeError(f"QA temporary directory is too deep for the Windows installer: {work}")
    print(f"Checking {len(manifest['files'])} packaged files", flush=True)
    package_root = package.resolve()
    def check_file(item):
        file = (package / item["path"]).resolve()
        file.relative_to(package_root)
        assert file.stat().st_size == item["size"] and digest(file) == item["sha256"], item["path"]
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(check_file, manifest["files"]))
    print("Checking backend and installer preparation", flush=True)
    report = {"version": version, "output": str(output), "manifest_files": len(manifest["files"]),
              "backend": backend_smoke(package, work),
              "installer": installer_smoke(installer, version, work)}
    source_record = ROOT / "build/release-source-inputs.json"
    if source_record.is_file():
        sources = json.loads(source_record.read_text(encoding="utf-8"))
        for name, expected in sources.items():
            assert digest(ROOT / name) == expected, f"Source changed during packaging: {name}"
        report["unchanged_source_files"] = len(sources)
    names = [installer.name, checksum.name, installer.name + ".blockmap", "latest.yml", "AILS-Bootstrap.exe"]
    report["assets"] = [{"name": name, "size": (output / name).stat().st_size,
                         "sha256": digest(output / name)} for name in names]
    (output / "release-verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
