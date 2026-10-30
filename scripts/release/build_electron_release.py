from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ails-backend"))
sys.path.insert(0, str(ROOT / "tools"))

from edition_manifest import (
    SUPPORTED_EDITIONS,
    canonical_edition_id,
    load_edition_manifest,
    manifest_sha256,
    whisper_cpp_model_ids,
)
from ai_compliance import publication_compliance_errors
from generate_third_party_notices import generate_notices, validate_notice_bundle

from verify_ffmpeg_bundle import verify_ffmpeg_bundle
from tiktoken_packaging import verify_frozen_tiktoken
from runtime_customization_packaging import verify_frozen_runtime_customization
from prepare_notebook_runtime import prepare_notebook_runtime


FRONTEND_DIR = ROOT / "ails-frontend"
BACKEND_DIR = ROOT / "ails-backend"
BACKEND_SPEC_PATH = ROOT / "scripts" / "release" / "AILS.backend.spec"
DIST_ROOT = ROOT / "dist"
BUILD_ROOT = ROOT / "build"
ELECTRON_BACKEND_DIST = BUILD_ROOT / "electron_backend"
ELECTRON_BACKEND_WORK = BUILD_ROOT / "electron_backend_pyi"
VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
BOOTSTRAP_SOURCE = ROOT / "bootstrap" / "AILSBootstrap.cs"
RELEASE_REPOSITORY_URL = "https://github.com/berazin/AILS_desktop"
EDITIONS = ("developer",)
EDITION_MARKER_NAME = ".ails-edition"
PAPERBACK_ROOT = ROOT / "native" / "paperback-document-model"
WINDOWS_SPEECH_HOST_PROJECT = ROOT / "native" / "windows-speech-host" / "AILS.WindowsSpeechHost.csproj"
WINDOWS_SPEECH_HOST_BUILD = BUILD_ROOT / "windows_speech_host"
PYTHON_KERNEL_WHEELS_LOCK = ROOT / "python_kernel_wheels.lock.json"
OCR_RUNTIME_WHEELS_LOCK = ROOT / "scripts" / "release" / "ocr_runtime_wheels.lock.json"
OCR_RUNTIME_RELATIVE = Path("_internal/ocr-runtimes")
OCR_RUNTIME_MANIFEST_RELATIVE = Path("audit/ocr-runtime-bundle.json")
OCR_RUNTIME_APPROVAL_RELATIVE = Path("audit/ocr-runtime-commercial-approval.json")

COMMERCIAL_EXPOSURE_ALLOWLIST: frozenset[tuple[str, str]] = frozenset()
COMMERCIAL_OPAQUE_MODEL_SUFFIXES = {
    ".bin",
    ".onnx",
    ".pdiparams",
    ".pdmodel",
    ".safetensors",
}
WHISPER_CPP_RUNTIME_RELATIVE = Path("tools/whispercpp-vulkan")
WHISPER_CPP_MODEL_RELATIVE = Path("models/whispercpp")
WHISPER_CPP_APPROVAL_RELATIVE = Path("audit/whisper-cpp-vulkan-bundle.json")
WHISPER_CPP_APPROVAL_GENERATOR = ROOT / "tools" / "generate_whisper_cpp_vulkan_approval.py"
COMMERCIAL_FORBIDDEN_CREDENTIAL_FILES = {
    ".env",
    "github-bootstrap-auth.bin",
    "github-update-auth.enc",
}
COMMERCIAL_FORBIDDEN_DEVELOPMENT_PARTS = {
    ".git",
    ".github",
    ".idea",
    ".pytest_cache",
    ".vscode",
    "__pycache__",
    "coverage",
    "src",
    "test",
    "tests",
}
COMMERCIAL_FORBIDDEN_FILE_SUFFIXES = {
    ".key",
    ".map",
    ".p12",
    ".pfx",
    ".ts",
    ".tsx",
}
COMMERCIAL_OPAQUE_FILE_SUFFIXES = {
    ".bin", ".dll", ".exe", ".gif", ".ico", ".jpeg", ".jpg", ".node",
    ".onnx", ".pak", ".pdf", ".pdiparams", ".pdmodel", ".png", ".pyc",
    ".pyd", ".safetensors", ".so", ".ttf", ".wasm", ".webp", ".woff",
    ".woff2", ".zip",
}
COMMERCIAL_SENSITIVE_CONTENT_PATTERNS = (
    ("Google API key", re.compile(rb"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("OpenAI-style API key", re.compile(rb"\bsk-(?:proj-)?[0-9A-Za-z_-]{32,}\b")),
    ("GitHub access token", re.compile(rb"\b(?:gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,})\b")),
    ("Groq API key", re.compile(rb"\bgsk_[0-9A-Za-z_-]{20,}\b")),
    ("xAI API key", re.compile(rb"\bxai-[0-9A-Za-z_-]{20,}\b")),
    (
        "literal API credential",
        re.compile(
            rb"(?i)(?:api[_-]?key|access[_-]?token|client[_-]?secret)"
            rb"[\x20\t\"']{0,4}[:=][\x20\t]{0,4}[\"']"
            rb"[0-9A-Za-z_./+=-]{20,}[\"']"
        ),
    ),
    (
        "provider API credential",
        re.compile(
            rb"(?i)(?:deepgram|deepseek|gemini|groq|openai|xai)"
            rb"[_-]?(?:api[_-]?)?key[\x20\t\"']{0,4}[:=][\x20\t]{0,4}"
            rb"[\"']?[0-9A-Za-z_./+=-]{20,}[\"']?"
        ),
    ),
    (
        "Bearer credential",
        re.compile(rb"(?i)Authorization[\x20\t\"']{0,4}[:=][\x20\t]{0,4}Bearer[\x20\t]+[0-9A-Za-z_./+=-]{20,}"),
    ),
    (
        "private key",
        re.compile(
            rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+"
            rb"[0-9A-Za-z+/=\r\n]{40,}"
        ),
    ),
    (
        "personal home path",
        re.compile(
            rb"(?i)(?:"
            + b"|".join(re.escape(value.encode("utf-8")) for value in {
                str(Path.home()), str(Path.home()).replace("\\", "\\\\"), Path.home().as_posix(),
            })
            + rb")(?:[/\\]|$)"
        ),
    ),
    (
        "personal Windows path",
        re.compile(
            rb"(?i)\b[A-Z]:\\{1,2}Users\\{1,2}"
            + re.escape(Path.home().name.encode("utf-8"))
            + rb"\\{1,2}"
        ),
    ),
    (
        "personal Unix path",
        re.compile(
            rb"/(?:home|Users)/"
            + re.escape(Path.home().name.encode("utf-8"))
            + rb"/"
        ),
    ),
)


def frontend_dist_path(edition: str) -> Path:
    return BUILD_ROOT / f"frontend_{edition}"


def run(cmd: list[str], *, cwd: Path = ROOT, env: dict[str, str] | None = None) -> None:
    print(">>", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, env=env)


def remove_build_tree(path: Path) -> None:
    path = path.resolve()
    if not any(path != base.resolve() and path.is_relative_to(base.resolve()) for base in (BUILD_ROOT, DIST_ROOT)):
        raise ValueError(f"Refusing removal outside a build output directory: {path}")
    if not path.exists():
        return

    def clear_readonly_and_retry(func, target, _error_info):
        os.chmod(target, stat.S_IWRITE)
        func(target)

    shutil.rmtree(path, onerror=clear_readonly_and_retry)




def _commercial_scan_allowlisted(finding_type: str, relative: str) -> bool:
    return (finding_type, relative.lower()) in COMMERCIAL_EXPOSURE_ALLOWLIST


def _approved_whisper_cpp_opaque_files(package_root: Path) -> set[str]:
    local_stt_policy = str(
        load_edition_manifest("commercial")["packaging"].get("local_stt_policy", "excluded")
    )
    if local_stt_policy != "audited-whisper-cpp-vulkan-bundle-required":
        return set()
    backend_root = package_root / "resources" / "backend" / "AILSBackend"
    approval_path = backend_root / WHISPER_CPP_APPROVAL_RELATIVE
    if not approval_path.is_file():
        return set()
    try:
        approval = json.loads(approval_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cannot read packaged whisper.cpp Vulkan approval: {error}") from error
    if (
        not isinstance(approval, dict)
        or approval.get("schema_version") != 1
        or approval.get("component_id") != "whisper-cpp-vulkan-bundle"
        or approval.get("approved_for_commercial_redistribution") is not True
    ):
        raise RuntimeError("Packaged whisper.cpp Vulkan approval is invalid or unapproved.")
    for field in ("reviewed_by", "reviewed_at", "approval_scope"):
        if not str(approval.get(field, "") or "").strip():
            raise RuntimeError(f"Packaged whisper.cpp Vulkan approval is missing {field}.")
    declared_files = approval.get("files")
    if not isinstance(declared_files, dict) or not declared_files:
        raise RuntimeError("Packaged whisper.cpp Vulkan approval has no exact file map.")

    allowed_roots = (
        (backend_root / WHISPER_CPP_RUNTIME_RELATIVE).resolve(),
        (backend_root / WHISPER_CPP_MODEL_RELATIVE).resolve(),
    )
    approved: set[str] = set()
    declared_paths: set[Path] = set()
    for relative, metadata in declared_files.items():
        relative_text = str(relative).strip().replace("\\", "/")
        if not isinstance(metadata, dict):
            continue
        expected_hash = str(metadata.get("sha256", "") or "").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise RuntimeError(f"whisper.cpp Vulkan approval has an invalid SHA-256: {relative_text}")
        path = (backend_root / relative_text).resolve()
        if not any(path == root or root in path.parents for root in allowed_roots):
            raise RuntimeError(
                f"whisper.cpp Vulkan approval path is outside the runtime/model roots: {relative_text}"
            )
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f"Approved whisper.cpp Vulkan file is missing or unsafe: {relative_text}")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected_hash:
            raise RuntimeError(f"Approved whisper.cpp Vulkan file hash mismatch: {relative_text}")
        packaged_relative = path.relative_to(package_root.resolve()).as_posix().lower()
        approved.add(packaged_relative)
        declared_paths.add(path)
    actual_files = {
        path.resolve()
        for root in allowed_roots
        for path in root.rglob("*")
        if root.is_dir() and path.is_file()
    }
    if actual_files != declared_paths:
        raise RuntimeError("whisper.cpp Vulkan approval does not exactly cover packaged files.")
    return approved


def _is_allowlisted_opaque_model(relative_path: Path, approved_files: set[str]) -> bool:
    relative = relative_path.as_posix().lower()
    return (
        relative in approved_files
        and relative_path.suffix.lower() in COMMERCIAL_OPAQUE_MODEL_SUFFIXES
    )


def _scan_sensitive_content(path: Path) -> set[str]:
    findings: set[str] = set()
    overlap = b""
    opaque = path.suffix.lower() in COMMERCIAL_OPAQUE_FILE_SUFFIXES
    try:
        with path.open("rb") as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                payload = overlap + chunk
                views = [payload]
                if not opaque and payload and payload.count(b"\0") * 5 > len(payload):
                    views.extend((payload[::2], payload[1::2]))
                for label, pattern in COMMERCIAL_SENSITIVE_CONTENT_PATTERNS:
                    if label in findings:
                        continue
                    if any(pattern.search(view) for view in views):
                        findings.add(label)
                overlap = payload[-1024:]
    except OSError as error:
        raise RuntimeError(f"Cannot scan packaged commercial file {path}: {error}") from error
    return findings


def verify_commercial_package_exposure(package_root: Path) -> None:
    package_root = package_root.resolve()
    if not package_root.is_dir():
        raise RuntimeError(f"Commercial package root does not exist: {package_root}")

    approved_whisper_cpp_files = _approved_whisper_cpp_opaque_files(package_root)
    offenders: list[str] = []
    for path in package_root.rglob("*"):
        if not path.is_file():
            continue
        relative_path = path.relative_to(package_root)
        relative = relative_path.as_posix()
        lower_relative = relative.lower()
        lower_name = path.name.lower()
        lower_parts = {part.lower() for part in relative_path.parts}

        forbidden_asset = (
            lower_name in COMMERCIAL_FORBIDDEN_CREDENTIAL_FILES
            or lower_name.startswith(".env.")
            or path.suffix.lower() in COMMERCIAL_FORBIDDEN_FILE_SUFFIXES
            or bool(lower_parts & COMMERCIAL_FORBIDDEN_DEVELOPMENT_PARTS)
        )
        if forbidden_asset and not _commercial_scan_allowlisted("asset", lower_relative):
            offenders.append(f"development/auth asset: {relative}")
            continue

        is_whisper_cpp_opaque = (
            lower_relative.startswith("resources/backend/ailsbackend/models/whispercpp/")
            and path.suffix.lower() in COMMERCIAL_OPAQUE_MODEL_SUFFIXES
        )
        is_directml_opaque = (
            lower_relative.startswith("resources/backend/ailsbackend/models/whisper-directml/")
            and path.suffix.lower() in COMMERCIAL_OPAQUE_MODEL_SUFFIXES
        )
        if is_directml_opaque:
            offenders.append(f"unapproved DirectML model asset: {relative}")
            continue
        if is_whisper_cpp_opaque and not _is_allowlisted_opaque_model(
            relative_path,
            approved_whisper_cpp_files,
        ):
            offenders.append(f"unapproved whisper.cpp model asset: {relative}")
            continue
        if _is_allowlisted_opaque_model(relative_path, approved_whisper_cpp_files):
            continue
        for finding in sorted(_scan_sensitive_content(path)):
            finding_key = finding.lower().replace(" ", "_")
            if not _commercial_scan_allowlisted(finding_key, lower_relative):
                offenders.append(f"{finding}: {relative}")

    if offenders:
        raise RuntimeError(
            "Commercial package exposure audit failed; remove the unapproved files or values "
            "instead of broadening the allowlist:\n- "
            + "\n- ".join(offenders[:50])
        )


def find_executable(*names: str) -> str:
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError(f"Required executable not found: {', '.join(names)}")


def resolve_pyinstaller_python() -> Path:
    candidates = [VENV_PYTHON, Path(sys.executable)]
    checked: set[str] = set()
    for python_exe in candidates:
        if not python_exe.exists():
            continue
        key = str(python_exe).lower()
        if key in checked:
            continue
        checked.add(key)
        try:
            subprocess.run(
                [str(python_exe), "-m", "PyInstaller", "--version"],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            return python_exe
        except Exception:
            continue
    raise RuntimeError("PyInstaller is not available. Install requirements.txt first.")


def ensure_required_paths() -> None:
    missing = [path for path in (FRONTEND_DIR, BACKEND_DIR, BACKEND_SPEC_PATH) if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing build inputs: " + ", ".join(str(path) for path in missing))


def ensure_frontend_dependencies() -> None:
    electron_dir = FRONTEND_DIR / "node_modules" / "electron"
    builder_dir = FRONTEND_DIR / "node_modules" / "electron-builder"
    if electron_dir.exists() and builder_dir.exists():
        return
    npm = find_executable("npm.cmd", "npm")
    run([npm, "install"], cwd=FRONTEND_DIR)


def edition_environment(edition: str) -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("ELECTRON_BUILDER_COMPRESSION_LEVEL", "3")
    # Nsis7z bundled by electron-builder cannot decode 7-Zip's newer ARM64
    # filter. Force the supported BCJ filter, including for pip ARM launchers.
    env["ELECTRON_BUILDER_7Z_FILTER"] = "BCJ"
    env["AILS_EDITION"] = edition
    env["AILS_FRONTEND_OUT_DIR"] = str(frontend_dist_path(edition))
    if edition == "commercial":
        env.pop("AILS_EDITION_MANIFEST", None)
    return env


def write_edition_marker(directory: Path, edition: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / EDITION_MARKER_NAME).write_text(f"{edition}\n", encoding="ascii")
    manifest = load_edition_manifest(edition)
    source_path = Path(manifest["_source_path"])
    shutil.copy2(source_path, directory / "edition-manifest.json")
    (directory / "edition-manifest.sha256").write_text(
        f"{manifest_sha256(edition)}  edition-manifest.json\n",
        encoding="ascii",
    )


def embedded_manifest_sha256(directory: Path, edition: str) -> str:
    manifest_path = directory / "edition-manifest.json"
    checksum_path = directory / "edition-manifest.sha256"
    if not manifest_path.is_file() or not checksum_path.is_file():
        raise RuntimeError(f"Edition manifest files are missing from: {directory}")
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cannot read packaged edition manifest: {manifest_path}: {error}") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1 or payload.get("id") != edition:
        raise RuntimeError(f"Packaged edition manifest identity mismatch: {manifest_path}")
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    actual = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    expected = manifest_sha256(edition)
    if actual != expected:
        raise RuntimeError(f"Packaged edition manifest content mismatch: {manifest_path}")
    checksum_line = checksum_path.read_text(encoding="ascii").strip()
    if checksum_line != f"{actual}  edition-manifest.json":
        raise RuntimeError(f"Packaged edition manifest checksum mismatch: {checksum_path}")
    return actual


def require_edition_marker(directory: Path, edition: str, label: str) -> None:
    marker = directory / EDITION_MARKER_NAME
    actual = marker.read_text(encoding="ascii").strip() if marker.exists() else ""
    if actual != edition:
        raise RuntimeError(
            f"{label} is not a reusable {edition} build. Expected {marker} to contain '{edition}'."
        )
    embedded_manifest_sha256(directory, edition)


def verify_frozen_backend_manifest(backend_dir: Path, edition: str) -> None:
    candidates = [
        backend_dir / "editions" / f"{edition}.json",
        backend_dir / "_internal" / "editions" / f"{edition}.json",
    ]
    packaged = [path for path in candidates if path.is_file()]
    if not packaged:
        raise RuntimeError(f"Frozen backend is missing its runtime edition manifest: {backend_dir}")
    expected = manifest_sha256(edition)
    for path in packaged:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Cannot read frozen backend edition manifest: {path}: {error}") from error
        canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        actual = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if payload.get("id") != edition or payload.get("schema_version") != 1 or actual != expected:
            raise RuntimeError(f"Frozen backend runtime manifest mismatch: {path}")


def verify_edition_frontend(edition: str, frontend_dist: Path) -> None:
    forbidden_by_edition = {
        "commercial": (
            b"/chatgpt/status",
            b"/chatgpt/models",
            b"/chatgpt/usage",
            b"Continue with ChatGPT",
            b"/tasks/url",
            b"/tasks/youtube",
            b"/tasks/eclass-vod",
            b"/tasks/lms-scan",
            b"/tasks/audio",
            b"/lms/login",
            b"/lms/credentials",
            b"/developer-tools",
        ),
        "general": (
            b"/tasks/url",
            b"/tasks/youtube",
            b"/tasks/eclass-vod",
            b"/tasks/lms-scan",
            b"/tasks/audio",
            b"/lms/login",
            b"/lms/credentials",
        ),
    }
    forbidden = forbidden_by_edition.get(edition, ())
    offenders = []
    for path in frontend_dist.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".js", ".mjs", ".html"}:
            continue
        payload = path.read_bytes()
        if any(token in payload for token in forbidden):
            offenders.append(path)
    if offenders:
        raise RuntimeError(
            f"{edition} frontend still contains disabled summary-generation endpoints: "
            + ", ".join(str(path) for path in offenders)
        )
def verify_commercial_backend_worktree(worktree: Path) -> None:
    from ide_packaging import verify_commercial_ide_tree
    verify_commercial_ide_tree(worktree)
    forbidden_top_level_packages = {
        "chatgpt_subscription",
        "av",
        "browser_cookie3",
        "ctranslate2",
        "developer_tools",
        "faster_whisper",
        "fitz",
        "noav_faster_whisper",
        "onnxruntime_genai",
        "openvino",
        "optimum",
        "playwright",
        "pymupdf",
        "torch",
        "transformers",
        "yt_dlp",
        "phoenix",
        "phoenix_observability",
        "opentelemetry",
        "openinference",
        "arize_phoenix_otel",
    }
    toc_entry_pattern = re.compile(r"\(\s*['\"]([^'\"]+)['\"]\s*,")
    offenders = []
    for pattern in ("PYZ-*.toc", "PKG-*.toc", "COLLECT-*.toc"):
        for path in worktree.rglob(pattern):
            source = path.read_text(encoding="utf-8", errors="ignore").lower()
            top_level_entries = {
                match.group(1).replace("\\", "/").lstrip("./").split("/", 1)[0].split(".", 1)[0]
                for match in toc_entry_pattern.finditer(source)
            }
            if top_level_entries & forbidden_top_level_packages:
                offenders.append(path)
    if offenders:
        raise RuntimeError(
            "Commercial backend still contains disabled web-input or local STT packages: "
            + ", ".join(str(path) for path in offenders)
        )


def verify_general_backend_has_ffmpeg(backend_dir: Path) -> None:
    missing = [
        backend_dir / "tools" / "ffmpeg" / "bin" / filename
        for filename in ("ffmpeg.exe", "ffprobe.exe")
        if not (backend_dir / "tools" / "ffmpeg" / "bin" / filename).is_file()
    ]
    if missing:
        raise RuntimeError(
            "The general package must embed FFmpeg at build time: "
            + ", ".join(str(path) for path in missing)
        )


def prepare_packaged_ffmpeg(backend_dir: Path, edition: str) -> None:
    policy = str(load_edition_manifest(edition)["packaging"].get("ffmpeg_policy", "excluded"))
    if policy == "excluded":
        return
    if policy == "bundled-at-build":
        install_ffmpeg_for_backend(backend_dir, BUILD_ROOT / "ffmpeg_cache")
        verify_general_backend_has_ffmpeg(backend_dir)
        return
    if policy != "audited-lgpl-bundle-required":
        return

    bundle_value = str(os.environ.get("AILS_COMMERCIAL_FFMPEG_DIR", "") or "").strip()
    if not bundle_value:
        raise RuntimeError(
            "Commercial packaging requires AILS_COMMERCIAL_FFMPEG_DIR pointing to a pinned, "
            "LGPL-only bundle accepted by tools/verify_ffmpeg_bundle.py."
        )
    bundle_dir = Path(bundle_value).expanduser().resolve()
    verify_ffmpeg_bundle(bundle_dir, execute=True)
    destination = (backend_dir / "tools" / "ffmpeg").resolve()
    destination.relative_to(backend_dir.resolve())
    if destination.exists():
        remove_build_tree(destination)
    shutil.copytree(bundle_dir, destination)


def _verify_packaged_whisper_cpp_vulkan_bundle(
    backend_dir: Path,
    edition: str,
    *,
    require_models: bool = True,
) -> set[str]:
    runtime_root = backend_dir / WHISPER_CPP_RUNTIME_RELATIVE
    model_root = backend_dir / WHISPER_CPP_MODEL_RELATIVE
    required_runtime = (runtime_root / "whisper-cli.exe", runtime_root / "ggml-vulkan.dll")
    missing = [str(path) for path in required_runtime if not path.is_file() or path.stat().st_size == 0]
    if missing:
        raise RuntimeError("whisper.cpp Vulkan runtime is incomplete: " + ", ".join(missing))
    expected_models = {f"ggml-{model_id}.bin" for model_id in whisper_cpp_model_ids(edition)}
    actual_models = {path.name for path in model_root.glob("*.bin") if path.is_file()}
    if require_models and actual_models != expected_models:
        raise RuntimeError(
            "whisper.cpp model set differs from the edition manifest; "
            f"packaged={sorted(actual_models)}, required={sorted(expected_models)}."
        )
    if not require_models and actual_models:
        raise RuntimeError(
            "downloadable whisper.cpp edition must not package model files: "
            + ", ".join(sorted(actual_models))
        )
    files = {
        path.relative_to(backend_dir).as_posix().lower()
        for root in (runtime_root, model_root)
        for path in root.rglob("*")
        if path.is_file()
    }
    unsafe = [str(path) for root in (runtime_root, model_root) for path in root.rglob("*") if path.is_symlink()]
    if unsafe:
        raise RuntimeError("whisper.cpp Vulkan bundle contains symbolic links: " + ", ".join(unsafe))
    return files


def ensure_whisper_cpp_vulkan_approval(bundle_root: Path) -> Path:
    approval = bundle_root / WHISPER_CPP_APPROVAL_RELATIVE
    if approval.is_file():
        return approval
    run([
        sys.executable,
        str(WHISPER_CPP_APPROVAL_GENERATOR),
        "--bundle-dir",
        str(bundle_root),
    ])
    if not approval.is_file():
        raise RuntimeError(f"Whisper Vulkan approval was not created: {approval}")
    return approval


def prepare_packaged_local_stt(backend_dir: Path, edition: str) -> None:
    policy = str(load_edition_manifest(edition)["packaging"].get("local_stt_policy", "excluded"))
    if policy == "excluded":
        return
    if policy not in {
        "developer",
        "audited-whisper-cpp-vulkan-bundle-required",
        "downloadable-whisper-cpp-vulkan-models",
    }:
        raise RuntimeError(f"Unsupported packaged local STT policy: {policy}")
    variable = (
        "AILS_COMMERCIAL_WHISPER_CPP_VULKAN_BUNDLE_DIR"
        if edition == "commercial"
        else "AILS_WHISPER_CPP_VULKAN_BUNDLE_DIR"
    )
    source_value = str(os.environ.get(variable, "") or "").strip()
    if edition == "commercial" and not source_value:
        source_value = str(os.environ.get("AILS_WHISPER_CPP_VULKAN_BUNDLE_DIR", "") or "").strip()
    source_root = Path(source_value).expanduser().resolve() if source_value else ROOT
    if edition == "commercial" and not source_value:
        raise RuntimeError(
            "Commercial whisper.cpp Vulkan packaging requires "
            f"{variable} or AILS_WHISPER_CPP_VULKAN_BUNDLE_DIR."
        )
    packaged_paths = [WHISPER_CPP_RUNTIME_RELATIVE]
    if policy == "audited-whisper-cpp-vulkan-bundle-required":
        packaged_paths.append(WHISPER_CPP_MODEL_RELATIVE)
    for relative in packaged_paths:
        source = source_root / relative
        destination = backend_dir / relative
        if not source.is_dir():
            raise RuntimeError(f"whisper.cpp Vulkan bundle directory is missing: {source}")
        if destination.exists():
            remove_build_tree(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, destination)
    if policy == "downloadable-whisper-cpp-vulkan-models":
        model_root = backend_dir / WHISPER_CPP_MODEL_RELATIVE
        if model_root.exists():
            remove_build_tree(model_root)
    _verify_packaged_whisper_cpp_vulkan_bundle(
        backend_dir,
        edition,
        require_models=policy == "audited-whisper-cpp-vulkan-bundle-required",
    )
    if edition == "commercial":
        approval_source = ensure_whisper_cpp_vulkan_approval(source_root)
        license_source = source_root / "audit" / "whisper-cpp-vulkan" / "licenses"
        if not approval_source.is_file() or not license_source.is_dir():
            raise RuntimeError("Commercial whisper.cpp Vulkan bundle lacks approval or license evidence.")
        approval_target = backend_dir / WHISPER_CPP_APPROVAL_RELATIVE
        approval_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(approval_source, approval_target)
        shutil.copytree(
            license_source,
            backend_dir / "audit" / "whisper-cpp-vulkan" / "licenses",
            dirs_exist_ok=True,
        )


def prepare_packaged_paperback(backend_dir: Path) -> None:
    # Native source trees are intentionally absent; package the existing runtime.
    source = ROOT / "tools" / "paperback" / "ails-paperback-prototype.exe"
    if not source.is_file():
        raise FileNotFoundError(source)
    fixture = BUILD_ROOT / "paperback-release-smoke.txt"
    fixture.write_text("AILS release native document smoke test.", encoding="utf-8")
    probe = subprocess.run([str(source), str(fixture)], capture_output=True, text=True, encoding="utf-8", check=True)
    if "AILS release native document smoke test." not in probe.stdout:
        raise RuntimeError("Paperback native runtime did not parse the release fixture")
    destination = backend_dir / "tools" / "paperback"
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination / source.name)
    notices = ROOT / "scripts" / "release" / "native-notices"
    shutil.copytree(notices, destination / "licenses", dirs_exist_ok=True)
    (destination / "provenance.json").write_text(json.dumps({
        "source": "existing local native runtime",
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "rebuilt": False,
    }, indent=2), encoding="utf-8")


def prune_packaged_backend(backend_dir: Path, edition: str) -> None:
    if load_edition_manifest(edition)["features"].get("developer_tools", False):
        return
    internal = backend_dir / "_internal"
    for metadata_dir in internal.glob("pip-*.dist-info"):
        if metadata_dir.is_dir():
            remove_build_tree(metadata_dir)


def load_python_wheel_lock() -> dict:
    data = json.loads(PYTHON_KERNEL_WHEELS_LOCK.read_text(encoding="utf-8"))
    if data.get("schema_version") != 2:
        raise ValueError(f"Unsupported python kernel wheel lock schema: {PYTHON_KERNEL_WHEELS_LOCK}")
    packages = data.get("packages")
    if not isinstance(packages, list) or not packages:
        raise ValueError(f"Python kernel wheel lock has no packages: {PYTHON_KERNEL_WHEELS_LOCK}")
    for item in packages:
        if not isinstance(item, dict) or not str(item.get("name") or "") or not str(item.get("version") or ""):
            raise ValueError(f"Python kernel wheel lock entry is invalid: {item}")
    return data


def _python_wheel_filename_matches(filename: str, item: dict, abi_tags: list[str]) -> bool:
    lowered = filename.lower()
    if not lowered.endswith(".whl"):
        return False
    if item.get("kind") == "pure":
        return lowered.endswith("-py3-none-any.whl") or lowered.endswith("-py2.py3-none-any.whl")
    if not lowered.endswith("-win_amd64.whl"):
        return False
    if any(f"-{tag}-" in lowered for tag in abi_tags):
        return True
    return bool(re.search(r"-cp\d+-abi3-win_amd64\.whl$", lowered))


def _python_wheel_artifacts(item: dict) -> list[dict]:
    artifacts = []
    for artifact in item.get("wheels") or []:
        if (
            isinstance(artifact, dict)
            and str(artifact.get("filename") or "")
            and str(artifact.get("url") or "").startswith("https://files.pythonhosted.org/")
        ):
            artifacts.append(artifact)
    return artifacts


def _verify_wheel_digest(filename: str, content: bytes, expected_sha256: object) -> None:
    expected = str(expected_sha256 or "").strip().lower()
    if not expected:
        return
    digest = hashlib.sha256(content).hexdigest()
    if digest != expected:
        raise RuntimeError(
            f"Python kernel wheel sha256 mismatch for {filename}: expected {expected}, got {digest}"
        )


def _fetch_pinned_wheel(artifact: dict) -> tuple[str, bytes]:
    filename = str(artifact["filename"])
    url = str(artifact["url"])
    with urllib.request.urlopen(url, timeout=180) as response:
        content = response.read()
    _verify_wheel_digest(filename, content, artifact.get("sha256"))
    return filename, content


def _resolve_unpinned_wheel(item: dict, abi_tags: list[str]) -> tuple[str, bytes]:
    api_url = f"https://pypi.org/pypi/{item['name']}/{item['version']}/json"
    with urllib.request.urlopen(api_url, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    for asset in payload.get("urls", []):
        filename = str(asset.get("filename") or "")
        if _python_wheel_filename_matches(filename, item, abi_tags):
            with urllib.request.urlopen(str(asset.get("url")), timeout=180) as wheel_response:
                return filename, wheel_response.read()
    raise RuntimeError(
        f"No matching python kernel wheel on PyPI: {item['name']}=={item['version']} "
        f"(abi={','.join(abi_tags)}, kind={item.get('kind')})"
    )


def prepare_python_kernel_wheels(backend_dir: Path) -> Path:
    lock_bytes = PYTHON_KERNEL_WHEELS_LOCK.read_bytes()
    lock = json.loads(lock_bytes.decode("utf-8"))
    lock_sha256 = hashlib.sha256(lock_bytes).hexdigest()
    abi_tags = [str(tag) for tag in lock.get("abi_tags", [])]
    destination = backend_dir / "_internal" / "python-kernel-wheels"
    manifest_path = destination / "manifest.json"
    if manifest_path.is_file():
        try:
            recorded = json.loads(manifest_path.read_text(encoding="utf-8"))
            if recorded.get("lock_sha256") == lock_sha256:
                verified = True
                for item in recorded.get("packages", []):
                    wheel_path = destination / str(item.get("filename") or "")
                    if not wheel_path.is_file():
                        verified = False
                        break
                    digest = hashlib.sha256(wheel_path.read_bytes()).hexdigest()
                    if digest != item.get("sha256"):
                        verified = False
                        break
                if verified:
                    return destination
        except (OSError, ValueError, KeyError):
            pass

    remove_build_tree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    records = []
    for item in lock["packages"]:
        artifacts = _python_wheel_artifacts(item)
        downloads = (
            [_fetch_pinned_wheel(artifact) for artifact in artifacts]
            if artifacts
            else [_resolve_unpinned_wheel(item, abi_tags)]
        )
        for filename, content in downloads:
            wheel_path = destination / filename
            wheel_path.write_bytes(content)
            records.append({
                "name": item["name"],
                "version": item["version"],
                "filename": filename,
                "sha256": hashlib.sha256(content).hexdigest(),
            })
            print(f"[python-kernel-wheels] {filename} ({len(content)} bytes)")
    manifest = {"lock_sha256": lock_sha256, "packages": records}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return destination


def load_ocr_runtime_wheel_lock() -> dict:
    lock = json.loads(OCR_RUNTIME_WHEELS_LOCK.read_text(encoding="utf-8"))
    if lock.get("schema_version") != 1:
        raise ValueError(f"Unsupported OCR runtime lock schema: {OCR_RUNTIME_WHEELS_LOCK}")
    if lock.get("python_tag") != "cp312-cp312-win_amd64":
        raise ValueError("OCR runtime lock must target 64-bit CPython 3.12 on Windows.")
    if lock.get("priority") != ["cuda", "openvino", "directml"]:
        raise ValueError("OCR runtime priority must be cuda, openvino, then directml.")
    runtimes = lock.get("runtimes")
    if not isinstance(runtimes, dict) or set(runtimes) != {"cuda", "openvino", "directml"}:
        raise ValueError("OCR runtime lock must contain cuda, openvino, and directml runtimes.")
    expected_providers = {
        "cuda": "CUDAExecutionProvider",
        "openvino": "OpenVINOExecutionProvider",
        "directml": "DmlExecutionProvider",
    }
    for runtime_key, runtime in runtimes.items():
        if not isinstance(runtime, dict) or runtime.get("provider") != expected_providers[runtime_key]:
            raise ValueError(f"OCR runtime provider mismatch: {runtime_key}")
        packages = runtime.get("packages") if isinstance(runtime, dict) else None
        if not isinstance(packages, list) or not packages:
            raise ValueError(f"OCR runtime lock has no packages: {runtime_key}")
        for package in packages:
            if not isinstance(package, dict) or not all(
                str(package.get(key) or "").strip()
                for key in ("name", "version", "filename", "sha256", "url")
            ):
                raise ValueError(f"Invalid OCR runtime package lock entry: {runtime_key}: {package}")
            if not str(package["url"]).startswith("https://files.pythonhosted.org/"):
                raise ValueError(f"Unapproved OCR runtime wheel host: {package['url']}")
            if not str(package["filename"]).endswith(".whl") or not re.fullmatch(
                r"[0-9a-fA-F]{64}", str(package["sha256"])
            ):
                raise ValueError(f"Invalid OCR runtime wheel pin: {package['filename']}")
    return lock


def ocr_runtime_wheel_lock_sha256(lock: dict | None = None) -> str:
    payload = lock or load_ocr_runtime_wheel_lock()
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _cached_ocr_runtime_wheel(package: dict) -> Path:
    cache_dir = BUILD_ROOT / "ocr_runtime_wheels"
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / str(package["filename"])
    expected = str(package["sha256"]).lower()
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
        return path
    if path.exists():
        path.unlink()
    with urllib.request.urlopen(str(package["url"]), timeout=300) as response:
        content = response.read()
    actual = hashlib.sha256(content).hexdigest()
    if actual != expected:
        raise RuntimeError(
            f"OCR runtime wheel sha256 mismatch for {package['filename']}: "
            f"expected {expected}, got {actual}"
        )
    path.write_bytes(content)
    return path


def _extract_locked_wheel(wheel_path: Path, destination: Path) -> None:
    root = destination.resolve()
    with zipfile.ZipFile(wheel_path) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if target != root and root not in target.parents:
                raise RuntimeError(f"Unsafe path in OCR runtime wheel: {member.filename}")
        archive.extractall(destination)


def _runtime_tree_digest(directory: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    files = [path for path in directory.rglob("*") if path.is_file()]
    for path in sorted(files, key=lambda item: item.relative_to(directory).as_posix().lower()):
        relative = path.relative_to(directory).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest(), len(files)


def _stage_commercial_ocr_runtime_approval(backend_dir: Path, lock_sha256: str) -> None:
    value = str(os.environ.get("AILS_COMMERCIAL_OCR_RUNTIME_APPROVAL_FILE") or "").strip()
    if not value:
        raise RuntimeError(
            "Commercial OCR runtime packaging requires "
            "AILS_COMMERCIAL_OCR_RUNTIME_APPROVAL_FILE."
        )
    source = Path(value).expanduser().resolve()
    try:
        approval = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError(f"Cannot read commercial OCR runtime approval: {source}") from error
    if approval.get("approved_for_commercial_redistribution") is not True:
        raise RuntimeError("Commercial OCR runtime approval is not approved.")
    if str(approval.get("lock_sha256") or "").lower() != lock_sha256:
        raise RuntimeError("Commercial OCR runtime approval does not match the pinned wheel lock.")
    for field in ("reviewed_by", "reviewed_at", "approval_scope"):
        if not str(approval.get(field) or "").strip():
            raise RuntimeError(f"Commercial OCR runtime approval is missing {field}.")
    target = backend_dir / OCR_RUNTIME_APPROVAL_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def prepare_packaged_ocr_runtimes(backend_dir: Path, edition: str) -> Path:
    if (backend_dir / OCR_RUNTIME_MANIFEST_RELATIVE).is_file():
        try:
            verify_packaged_ocr_runtime_bundle(backend_dir, require_commercial_approval=edition == "commercial")
            return backend_dir / OCR_RUNTIME_RELATIVE
        except RuntimeError:
            print("Rebuilding stale OCR runtime staging", flush=True)
    lock = load_ocr_runtime_wheel_lock()
    lock_sha256 = ocr_runtime_wheel_lock_sha256(lock)
    destination = backend_dir / OCR_RUNTIME_RELATIVE
    remove_build_tree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    runtime_records = {}
    for runtime_key in lock["priority"]:
        runtime = lock["runtimes"][runtime_key]
        runtime_dir = destination / runtime_key
        runtime_dir.mkdir(parents=True, exist_ok=True)
        packages = []
        for package in runtime["packages"]:
            wheel_path = _cached_ocr_runtime_wheel(package)
            _extract_locked_wheel(wheel_path, runtime_dir)
            packages.append({
                "name": package["name"],
                "version": package["version"],
                "filename": package["filename"],
                "sha256": package["sha256"],
                "url": package["url"],
            })
        tree_sha256, file_count = _runtime_tree_digest(runtime_dir)
        runtime_records[runtime_key] = {
            "provider": runtime["provider"],
            "packages": packages,
            "tree_sha256": tree_sha256,
            "file_count": file_count,
        }
    manifest = {
        "schema_version": 1,
        "lock_sha256": lock_sha256,
        "priority": lock["priority"],
        "runtimes": runtime_records,
    }
    manifest_path = backend_dir / OCR_RUNTIME_MANIFEST_RELATIVE
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if edition == "commercial":
        _stage_commercial_ocr_runtime_approval(backend_dir, lock_sha256)
    return destination


def verify_packaged_ocr_runtime_bundle(
    backend_dir: Path,
    *,
    require_commercial_approval: bool = False,
) -> dict:
    lock_sha256 = ocr_runtime_wheel_lock_sha256()
    manifest_path = backend_dir / OCR_RUNTIME_MANIFEST_RELATIVE
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError("Packaged OCR runtime manifest is missing or invalid.") from error
    if manifest.get("schema_version") != 1 or manifest.get("lock_sha256") != lock_sha256:
        raise RuntimeError("Packaged OCR runtime manifest does not match the pinned wheel lock.")
    runtimes = manifest.get("runtimes")
    if not isinstance(runtimes, dict) or set(runtimes) != {"cuda", "openvino", "directml"}:
        raise RuntimeError("Packaged OCR runtime manifest is incomplete.")
    root = backend_dir / OCR_RUNTIME_RELATIVE
    for runtime_key, record in runtimes.items():
        runtime_dir = root / runtime_key
        tree_sha256, file_count = _runtime_tree_digest(runtime_dir)
        if tree_sha256 != record.get("tree_sha256") or file_count != record.get("file_count"):
            raise RuntimeError(f"Packaged OCR runtime files changed after staging: {runtime_key}")
    if require_commercial_approval:
        approval_path = backend_dir / OCR_RUNTIME_APPROVAL_RELATIVE
        try:
            approval = json.loads(approval_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise RuntimeError("Commercial OCR runtime approval is missing or invalid.") from error
        if approval.get("approved_for_commercial_redistribution") is not True:
            raise RuntimeError("Commercial OCR runtime approval is not approved.")
        if str(approval.get("lock_sha256") or "").lower() != lock_sha256:
            raise RuntimeError("Commercial OCR runtime approval does not match the pinned wheel lock.")
    return manifest


def verify_commercial_backend_files(backend_dir: Path) -> None:
    from ide_packaging import verify_commercial_ide_tree
    verify_commercial_ide_tree(backend_dir)
    verify_packaged_ocr_runtime_bundle(backend_dir, require_commercial_approval=True)
    ffmpeg_policy = str(
        load_edition_manifest("commercial")["packaging"].get("ffmpeg_policy", "excluded")
    )
    allow_audited_ffmpeg = ffmpeg_policy == "audited-lgpl-bundle-required"
    allow_audited_whisper_cpp = (
        load_edition_manifest("commercial")["packaging"].get("local_stt_policy")
        == "audited-whisper-cpp-vulkan-bundle-required"
    )
    approved_whisper_cpp_files = (
        _verify_packaged_whisper_cpp_vulkan_bundle(backend_dir, "commercial")
        if allow_audited_whisper_cpp
        else set()
    )
    if allow_audited_whisper_cpp and not (backend_dir / WHISPER_CPP_APPROVAL_RELATIVE).is_file():
        raise RuntimeError("Commercial whisper.cpp Vulkan approval manifest is missing.")
    forbidden_top_level_packages = {
        "chatgpt_subscription",
        "av",
        "browser_cookie3",
        "ctranslate2",
        "developer_tools",
        "faster_whisper",
        "fitz",
        "noav_faster_whisper",
        "openvino",
        "optimum",
        "playwright",
        "pymupdf",
        "torch",
        "transformers",
        "yt_dlp",
        "phoenix",
        "phoenix_observability",
        "opentelemetry",
        "openinference",
        "arize_phoenix_otel",
    }
    forbidden_local_stt_tokens = [
        "/models/whisper/",
        "/whisper_models/",
        "/audit/ctranslate2",
        "/audit/faster-whisper",
        "/audit/intel-openmp",
        "/audit/nvidia-cudnn",
        "/audit/silero-vad",
        "/audit/whisper-models",
        "ctranslate2.dll",
        "whisper.cpp",
        "whisper_cpp",
        "whispercpp",
    ]
    forbidden_top_level_packages.add("onnxruntime_genai")
    forbidden_local_stt_tokens.extend((
        "/models/whisper-directml/",
        "/audit/directml-whisper",
        "/audit/onnxruntime-genai-directml",
    ))
    forbidden_codec_tokens = ("x264", "x265", "fdk-aac", "fdk_aac")
    forbidden_legacy_native_prefixes = (
        "cublas",
        "cublaslt",
        "cudart",
        "cudnn",
        "cufft",
        "cupti",
        "curand",
        "cusolver",
        "cusparse",
        "libiomp",
        "nppc",
        "nppial",
        "nppicc",
        "nppidei",
        "nppif",
        "nppig",
        "nppim",
        "nppist",
        "nppisu",
        "nppitc",
        "npps",
        "nvjitlink",
        "nvml",
        "nvrtc",
    )
    forbidden_legacy_native_names = {"nvcuda.dll"}
    ffmpeg_library_prefixes = (
        "avcodec-",
        "avdevice-",
        "avfilter-",
        "avformat-",
        "avutil-",
        "postproc-",
        "swresample-",
        "swscale-",
    )
    ffmpeg_program_names = {"ffmpeg.exe", "ffprobe.exe", "ffmpeg.dll"}
    whisper_program_prefixes = ("whisper-bench", "whisper-cli", "whisper-server")
    offenders = []
    for path in backend_dir.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(backend_dir).as_posix().lower()
        rooted_relative = f"/{relative}"
        basename = path.name.lower()
        is_packaged_cuda_ocr_runtime = rooted_relative.startswith(
            "/_internal/ocr-runtimes/cuda/"
        )
        relative_parts = tuple(part.lower() for part in path.relative_to(backend_dir).parts)
        package_parts = relative_parts[1:] if relative_parts[:1] == ("_internal",) else relative_parts
        if package_parts[:1] == ("site-packages",):
            package_parts = package_parts[1:]
        top_level_name = package_parts[0] if package_parts else ""
        has_forbidden_top_level_package = any(
            top_level_name == package
            or top_level_name.startswith(f"{package}.")
            or top_level_name.startswith(f"{package}-")
            for package in forbidden_top_level_packages
        )
        is_audited_ffmpeg_file = allow_audited_ffmpeg and relative.startswith("tools/ffmpeg/")
        is_unapproved_ffmpeg_native = (
            basename in ffmpeg_program_names
            or basename.startswith(ffmpeg_library_prefixes)
            or basename.startswith("opencv_videoio_ffmpeg")
        ) and not is_audited_ffmpeg_file
        is_whisper_cpp_asset = (
            basename.startswith(whisper_program_prefixes)
            or basename == "whisper.dll"
            or (basename.startswith("ggml-") and path.suffix.lower() in {".bin", ".dll"})
            or basename == "ggml.dll"
        )
        is_approved_whisper_cpp_file = relative in approved_whisper_cpp_files
        if (
            any(token in relative for token in forbidden_codec_tokens)
            or basename in forbidden_legacy_native_names
            or (
                path.suffix.lower() == ".dll"
                and basename.startswith(forbidden_legacy_native_prefixes)
                and not is_packaged_cuda_ocr_runtime
            )
            or has_forbidden_top_level_package
            or (
                any(token in rooted_relative for token in forbidden_local_stt_tokens)
                and not is_approved_whisper_cpp_file
            )
            or is_unapproved_ffmpeg_native
            or (is_whisper_cpp_asset and not is_approved_whisper_cpp_file)
        ):
            offenders.append(path)
    if offenders:
        raise RuntimeError(
            "Commercial backend contains a disabled package, local STT runtime, or unapproved codec binary: "
            + ", ".join(str(path) for path in offenders[:30])
        )


def generate_license_bundle(backend_dir: Path, edition: str, pyinstaller_worktree: Path) -> Path:
    output_dir = BUILD_ROOT / f"license_bundle_{edition}"
    strict = bool(load_edition_manifest(edition)["packaging"].get("strict_license_check", False))
    remove_build_tree(output_dir)
    generate_notices(
        edition=edition,
        backend_root=backend_dir,
        node_root=FRONTEND_DIR / "node_modules",
        package_lock=FRONTEND_DIR / "package-lock.json",
        output_dir=output_dir,
        strict=strict,
        pyinstaller_worktree=pyinstaller_worktree,
    )
    return output_dir


def verify_electron_runtime_ffmpeg(package_root: Path, edition: str) -> None:
    policy = str(
        load_edition_manifest(edition)["packaging"].get(
            "electron_runtime_ffmpeg_policy", ""
        )
    )
    if policy != "bundled-lgpl-non-proprietary":
        raise RuntimeError(
            "Commercial packaging must declare the separately audited Electron FFmpeg runtime."
        )

    runtime = package_root / "ffmpeg.dll"
    chromium_notices = package_root / "LICENSES.chromium.html"
    if not runtime.is_file():
        raise RuntimeError(
            "The official Electron runtime is incomplete: ffmpeg.dll is missing. "
            "Do not remove this delay-loaded Chromium component after packaging."
        )
    if not chromium_notices.is_file():
        raise RuntimeError("Electron Chromium third-party notices are missing.")

    notice_text = chromium_notices.read_text(encoding="utf-8", errors="replace").lower()
    if '<span class="title">ffmpeg</span>' not in notice_text:
        raise RuntimeError("Electron Chromium notices do not identify the bundled FFmpeg runtime.")
    if "gnu lesser general public license" not in notice_text:
        raise RuntimeError("Electron Chromium notices do not include the FFmpeg LGPL terms.")


def verify_packaged_edition(package_root: Path, edition: str) -> None:
    resources = package_root / "resources"
    packaged_frontend = resources / "frontend"
    packaged_backend = resources / "backend" / "AILSBackend"
    require_edition_marker(packaged_frontend, edition, "Packaged frontend")
    require_edition_marker(packaged_backend, edition, "Packaged backend")
    verify_frozen_backend_manifest(packaged_backend, edition)
    verify_frozen_tiktoken(packaged_backend)
    verify_edition_frontend(edition, packaged_frontend)

    frontend_hash = embedded_manifest_sha256(packaged_frontend, edition)
    backend_hash = embedded_manifest_sha256(packaged_backend, edition)
    if frontend_hash != backend_hash:
        raise RuntimeError("Packaged frontend and backend edition manifests do not match.")

    strict_license_check = bool(
        load_edition_manifest(edition)["packaging"].get("strict_license_check", False)
    )
    validate_notice_bundle(
        resources / "licenses",
        edition=edition,
        strict=strict_license_check,
    )

    if (
        load_edition_manifest(edition)["packaging"].get("local_stt_policy")
        == "downloadable-whisper-cpp-vulkan-models"
    ):
        _verify_packaged_whisper_cpp_vulkan_bundle(
            packaged_backend,
            edition,
            require_models=False,
        )

    if edition == "commercial":
        verify_commercial_backend_files(packaged_backend)
        ffmpeg_policy = str(
            load_edition_manifest(edition)["packaging"].get("ffmpeg_policy", "excluded")
        )
        if ffmpeg_policy == "audited-lgpl-bundle-required":
            verify_ffmpeg_bundle(packaged_backend / "tools" / "ffmpeg", execute=True)
        verify_electron_runtime_ffmpeg(package_root, edition)
        verify_commercial_package_exposure(package_root)
    elif edition == "general":
        verify_general_backend_has_ffmpeg(packaged_backend)


def build_frontend(edition: str) -> None:
    npm = find_executable("npm.cmd", "npm")
    ensure_frontend_dependencies()
    run([npm, "run", f"build:{edition}"], cwd=FRONTEND_DIR, env=edition_environment(edition))
    frontend_dist = frontend_dist_path(edition)
    write_edition_marker(frontend_dist, edition)
    verify_edition_frontend(edition, frontend_dist)


def remove_excluded_ffmpeg_assets(backend_dir: Path, edition: str) -> None:
    policy = str(load_edition_manifest(edition)["packaging"].get("ffmpeg_policy", "excluded"))
    if policy != "excluded":
        return
    patterns = ("opencv_videoio_ffmpeg*.dll", "ffmpeg.exe", "ffprobe.exe", "ffmpeg.dll")
    for pattern in patterns:
        for path in backend_dir.rglob(pattern):
            if path.is_file():
                path.unlink()
    remaining = [
        path for pattern in patterns for path in backend_dir.rglob(pattern) if path.is_file()
    ]
    if remaining:
        raise RuntimeError(
            "FFmpeg-excluded edition still contains codec assets: "
            + ", ".join(str(path) for path in remaining)
        )


def build_backend(pyinstaller_python: Path, edition: str) -> Path:
    if not (BACKEND_DIR / "native" / "ails_media_foundation.dll").is_file():
        raise FileNotFoundError("Required Media Foundation runtime is missing")
    backend_dist = ELECTRON_BACKEND_DIST.with_name(f"{ELECTRON_BACKEND_DIST.name}_{edition}")
    backend_work = ELECTRON_BACKEND_WORK.with_name(f"{ELECTRON_BACKEND_WORK.name}_{edition}")
    remove_build_tree(backend_dist)
    remove_build_tree(backend_work)
    backend_dist.mkdir(parents=True, exist_ok=True)
    backend_work.mkdir(parents=True, exist_ok=True)

    run(
        [
            str(pyinstaller_python),
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath",
            str(backend_dist),
            "--workpath",
            str(backend_work),
            str(BACKEND_SPEC_PATH),
        ],
        cwd=ROOT,
        env=edition_environment(edition),
    )
    output_dir = backend_dist / "AILSBackend"
    if not (output_dir / "AILSBackend.exe").exists():
        raise FileNotFoundError(f"Backend executable was not created: {output_dir / 'AILSBackend.exe'}")
    remove_excluded_ffmpeg_assets(output_dir, edition)
    write_edition_marker(output_dir, edition)
    verify_frozen_backend_manifest(output_dir, edition)
    if edition == "commercial":
        verify_commercial_backend_worktree(backend_work)
    return output_dir




def verify_packaged_ocr_runtime(backend_dir: Path) -> None:
    verify_packaged_ocr_runtime_bundle(backend_dir)
    executable = backend_dir / "AILSBackend.exe"
    env = os.environ.copy()
    env["AILS_EDITION"] = (backend_dir / EDITION_MARKER_NAME).read_text(encoding="ascii").strip()
    env.pop("AILS_EDITION_MANIFEST", None)
    env.pop("AILS_OCR_RUNTIME_PROVIDER", None)
    result = subprocess.run(
        [str(executable), "--verify-ocr-runtime"],
        cwd=backend_dir,
        env=env,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Packaged OCR runtime auto-selection self-test failed with exit code "
            f"{result.returncode}: {executable}"
        )


def load_frontend_metadata() -> tuple[str, str]:
    metadata = json.loads((FRONTEND_DIR / "package.json").read_text(encoding="utf-8"))
    name = str(metadata.get("name", "")).strip()
    version = str(metadata.get("version", "")).strip()
    if not name or not version:
        raise ValueError("ails-frontend/package.json must define name and version.")
    return name, version


def release_asset_names(version: str, edition: str = "developer") -> tuple[str, str, str, str]:
    manifest = load_edition_manifest(edition)
    prefix = str(manifest["artifact_prefix"])
    installer_name = f"{prefix}-Setup-{version}.exe"
    channel = str(manifest["update_channel"])
    metadata_name = "latest.yml" if channel == "latest" else f"{channel}.yml"
    bootstrap_name = f"{prefix}-Bootstrap.exe"
    return installer_name, f"{installer_name}.sha256", metadata_name, bootstrap_name


def build_electron(
    output_dir: Path,
    installer_name: str,
    metadata_name: str,
    edition: str,
) -> tuple[Path, Path, Path, list[Path]]:
    builder = FRONTEND_DIR / "node_modules" / ".bin" / ("electron-builder.cmd" if sys.platform.startswith("win") else "electron-builder")
    if not builder.exists():
        ensure_frontend_dependencies()
    run(
        [
            str(builder),
            "--config",
            f"electron-builder.{edition}.yml",
            "--publish",
            "never",
            f"--config.directories.output={output_dir.as_posix()}",
        ],
        cwd=FRONTEND_DIR,
        env=edition_environment(edition),
    )

    executable_name = f"{load_edition_manifest(edition)['product_name']}.exe"
    executable = output_dir / "win-unpacked" / executable_name
    if not executable.exists():
        raise FileNotFoundError(f"Electron executable was not created: {executable}")
    installer = output_dir / installer_name
    if not installer.exists():
        raise FileNotFoundError(f"NSIS installer was not created: {installer}")
    metadata = output_dir / metadata_name
    if not metadata.exists():
        raise FileNotFoundError(f"Updater metadata was not created: {metadata}")
    blockmaps = sorted(output_dir.glob(f"{installer_name}*.blockmap"))
    return executable, installer, metadata, blockmaps


def write_sha256(path: Path) -> Path:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    checksum_path = path.with_name(path.name + ".sha256")
    checksum_path.write_text(f"{digest.hexdigest()}  {path.name}\n", encoding="ascii")
    return checksum_path


def find_csharp_compiler() -> Path:
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    candidates = [
        system_root / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe",
        system_root / "Microsoft.NET" / "Framework" / "v4.0.30319" / "csc.exe",
    ]
    found = shutil.which("csc")
    if found:
        candidates.insert(0, Path(found))
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise RuntimeError(".NET Framework C# compiler was not found; enable .NET Framework 4.x.")


def build_bootstrap(
    output_dir: Path,
    output_name: str = "AILS-Bootstrap.exe",
    edition: str = "developer",
) -> Path:
    if not BOOTSTRAP_SOURCE.exists():
        raise FileNotFoundError(f"Bootstrap source is missing: {BOOTSTRAP_SOURCE}")
    output_path = output_dir / output_name
    command = [
        str(find_csharp_compiler()),
        "/nologo",
        "/target:winexe",
        "/optimize+",
        "/platform:anycpu",
        "/reference:System.dll",
        "/reference:System.Core.dll",
        "/reference:System.Drawing.dll",
        "/reference:System.Net.Http.dll",
        "/reference:System.Security.dll",
        "/reference:System.Web.Extensions.dll",
        "/reference:System.Windows.Forms.dll",
        f"/out:{output_path}",
    ]
    if edition == "general":
        command.append("/define:AILS_GENERAL")
    elif edition == "commercial":
        command.append("/define:AILS_COMMERCIAL")
    if (ROOT / "assets" / "AILS.ico").exists():
        command.append(f"/win32icon:{ROOT / 'assets' / 'AILS.ico'}")
    command.append(str(BOOTSTRAP_SOURCE))
    run(command)
    if not output_path.exists():
        raise FileNotFoundError(f"Bootstrap executable was not created: {output_path}")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the developer NSIS release without publishing it.")
    parser.add_argument("--edition", choices=("developer",), default="developer")
    parser.add_argument("--skip-frontend", action="store_true", help="Reuse verified frontend staging")
    parser.add_argument("--skip-backend", action="store_true", help="Reuse verified frozen backend staging")
    parser.add_argument("--package-existing", type=Path, help="Recompress a verified win-unpacked directory in this release output")
    args = parser.parse_args()
    edition = args.edition
    _, version = load_frontend_metadata()
    installer_name, checksum_name, metadata_name, bootstrap_name = release_asset_names(version, edition)
    if args.package_existing:
        output_dir = args.package_existing.resolve()
        output_dir.relative_to(DIST_ROOT.resolve())
        package = output_dir / "win-unpacked"
        if json.loads((package / "ails-update-manifest.json").read_text(encoding="utf-8"))["version"] != version:
            raise RuntimeError("Prepackaged app version does not match package.json")
        verify_packaged_edition(package, edition)
        # Preserve old/interrupted archives outside electron-builder's cache name.
        # Its timestamp check alone cannot distinguish an interrupted archive.
        for archive in output_dir.glob("*.nsis.7z"):
            archive.rename(archive.with_name(archive.name + ".previous-" + datetime.now().strftime("%Y%m%d%H%M%S")))
        builder = FRONTEND_DIR / "node_modules/.bin/electron-builder.cmd"
        run([str(builder), "--config", "electron-builder.developer.yml", "--publish", "never",
             "--prepackaged", str(package), f"--config.directories.output={output_dir.as_posix()}"],
            cwd=FRONTEND_DIR, env=edition_environment(edition))
        verify_packaged_edition(package, edition)
        write_sha256(output_dir / installer_name)
        build_bootstrap(output_dir, bootstrap_name, edition)
        print(f"Release output: {output_dir}", flush=True)
        return
    ensure_required_paths()
    ensure_frontend_dependencies()
    if args.skip_frontend:
        require_edition_marker(frontend_dist_path(edition), edition, "Frontend")
        verify_edition_frontend(edition, frontend_dist_path(edition))
    else:
        build_frontend(edition)
    backend_worktree = BUILD_ROOT / "electron_backend_pyi_developer"
    if args.skip_backend:
        backend_dir = BUILD_ROOT / "electron_backend_developer" / "AILSBackend"
        require_edition_marker(backend_dir, edition, "Backend")
        verify_frozen_backend_manifest(backend_dir, edition)
    else:
        backend_dir = build_backend(resolve_pyinstaller_python(), edition)
    verify_frozen_tiktoken(backend_dir)
    verify_frozen_runtime_customization(backend_dir)
    print("Preparing notebook and native runtimes", flush=True)
    prepare_python_kernel_wheels(backend_dir)
    notebook_destination = backend_dir / "_internal" / "notebook-runtime"
    notebook_cache = ROOT / ".release-runtime-cache" / "notebook-runtime"
    if notebook_cache.is_dir() and not notebook_destination.exists():
        prepare_notebook_runtime(notebook_cache)
        shutil.copytree(notebook_cache, notebook_destination)
    prepare_notebook_runtime(notebook_destination)
    prepare_packaged_local_stt(backend_dir, edition)
    prepare_packaged_paperback(backend_dir)
    prepare_packaged_ocr_runtimes(backend_dir, edition)
    print("Verifying packaged OCR runtime", flush=True)
    verify_packaged_ocr_runtime(backend_dir)
    print("Generating third-party license bundle", flush=True)
    generate_license_bundle(backend_dir, edition, backend_worktree)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = DIST_ROOT / f"AILS_electron_{edition}_{timestamp}"
    executable, installer, metadata, blockmaps = build_electron(output_dir, installer_name, metadata_name, edition)
    verify_packaged_edition(executable.parent, edition)
    checksum = write_sha256(installer)
    bootstrap = build_bootstrap(output_dir, bootstrap_name, edition)
    assert checksum.name == checksum_name and metadata.name == metadata_name
    print(f"Release output: {output_dir}", flush=True)
    print(f"Run verify_release.py before publish_release.py. Assets: {[p.name for p in [installer, checksum, metadata, bootstrap, *blockmaps]]}")


if __name__ == "__main__":
    main()
