from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any


ALLOWED_LICENSES = {"LGPL-2.1-or-later", "LGPL-3.0-or-later"}
FORBIDDEN_CONFIG_FLAGS = {
    "--enable-gpl",
    "--enable-version3-gpl",
    "--enable-nonfree",
    "--enable-libx264",
    "--enable-libx265",
    "--enable-libfdk-aac",
}
FORBIDDEN_BINARY_NAMES = ("x264", "x265", "fdk-aac", "fdk_aac")
EXECUTABLES = ("ffmpeg.exe", "ffprobe.exe")


class FFmpegBundleError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_build_configuration(text: str) -> None:
    normalized = str(text or "").lower()
    found = sorted(flag for flag in FORBIDDEN_CONFIG_FLAGS if flag in normalized)
    if found:
        raise FFmpegBundleError("Forbidden FFmpeg build flags: " + ", ".join(found))
    if "nonfree and unredistributable" in normalized:
        raise FFmpegBundleError("FFmpeg reports that this build is nonfree and unredistributable.")


def _configuration_flags(text: str) -> set[str]:
    return set(re.findall(r"--[A-Za-z0-9][A-Za-z0-9_=+.,:/-]*", str(text or "")))


def _reported_version(text: str, executable_name: str) -> str:
    match = re.search(rf"(?im)^{re.escape(executable_name)} version\s+([^\s]+)", str(text or ""))
    if not match:
        raise FFmpegBundleError(f"Cannot parse {executable_name} runtime version.")
    return match.group(1)


def _read_manifest(bundle_dir: Path) -> dict[str, Any]:
    path = bundle_dir / "manifest.json"
    if not path.is_file():
        raise FFmpegBundleError(f"Missing FFmpeg bundle manifest: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise FFmpegBundleError(f"Cannot read FFmpeg bundle manifest: {error}") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise FFmpegBundleError("FFmpeg manifest must use schema_version 1.")
    return payload


def _require_text_file(bundle_dir: Path, relative: str, label: str) -> Path:
    path = (bundle_dir / relative).resolve()
    try:
        path.relative_to(bundle_dir.resolve())
    except ValueError as error:
        raise FFmpegBundleError(f"{label} escapes the FFmpeg bundle: {relative}") from error
    if not path.is_file() or not path.read_text(encoding="utf-8", errors="replace").strip():
        raise FFmpegBundleError(f"Missing or empty {label}: {relative}")
    return path


def _run(executable: Path, *arguments: str) -> str:
    completed = subprocess.run(
        [str(executable), "-hide_banner", *arguments],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    output = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
    if completed.returncode != 0:
        raise FFmpegBundleError(
            f"{executable.name} {' '.join(arguments)} failed with exit code {completed.returncode}: {output}"
        )
    return output


def verify_ffmpeg_bundle(bundle: str | Path, *, execute: bool = True) -> dict[str, Any]:
    bundle_dir = Path(bundle).expanduser().resolve()
    if not bundle_dir.is_dir():
        raise FFmpegBundleError(f"FFmpeg bundle directory does not exist: {bundle_dir}")
    manifest = _read_manifest(bundle_dir)

    version = str(manifest.get("version", "") or "").strip()
    source_url = str(manifest.get("source_url", "") or "").strip()
    source_sha256 = str(manifest.get("source_sha256", "") or "").strip().lower()
    license_expression = str(manifest.get("license_expression", "") or "").strip()
    if not version or version.lower() in {"latest", "rolling"}:
        raise FFmpegBundleError("FFmpeg manifest must pin an exact version.")
    if not source_url.startswith("https://"):
        raise FFmpegBundleError("FFmpeg manifest must provide an HTTPS source_url for the exact source.")
    if not re.fullmatch(r"[0-9a-f]{64}", source_sha256):
        raise FFmpegBundleError("FFmpeg manifest must provide the exact source archive SHA-256.")
    if license_expression not in ALLOWED_LICENSES:
        raise FFmpegBundleError(
            f"Commercial FFmpeg must be LGPL-only; got '{license_expression or 'missing'}'."
        )

    license_path = _require_text_file(bundle_dir, str(manifest.get("license_file", "")), "license file")
    source_path = _require_text_file(bundle_dir, str(manifest.get("source_offer_file", "")), "source notice")
    config_path = _require_text_file(bundle_dir, str(manifest.get("build_config_file", "")), "build config")
    source_archive_relative = str(manifest.get("source_archive", "") or "").strip()
    source_archive_path = (bundle_dir / source_archive_relative).resolve()
    try:
        source_archive_path.relative_to(bundle_dir)
    except ValueError as error:
        raise FFmpegBundleError(f"Source archive escapes the FFmpeg bundle: {source_archive_relative}") from error
    if not source_archive_path.is_file() or sha256_file(source_archive_path) != source_sha256:
        raise FFmpegBundleError("Bundled FFmpeg source archive is missing or does not match source_sha256.")
    license_text = license_path.read_text(encoding="utf-8", errors="replace").lower()
    if "lesser general public license" not in license_text:
        raise FFmpegBundleError("FFmpeg license file does not contain the LGPL text.")
    source_text = source_path.read_text(encoding="utf-8", errors="replace")
    if source_url not in source_text or source_sha256 not in source_text.lower():
        raise FFmpegBundleError("Source notice must contain the pinned source URL and SHA-256.")
    declared_config = config_path.read_text(encoding="utf-8", errors="replace")
    inspect_build_configuration(declared_config)

    declared_files = manifest.get("files")
    if not isinstance(declared_files, dict) or not declared_files:
        raise FFmpegBundleError("FFmpeg manifest must list SHA-256 hashes for every executable and DLL.")
    actual_binaries = {
        path.relative_to(bundle_dir).as_posix(): path
        for path in bundle_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".exe", ".dll"}
    }
    undeclared = sorted(set(actual_binaries) - set(declared_files))
    if undeclared:
        raise FFmpegBundleError("Undeclared FFmpeg binaries: " + ", ".join(undeclared))
    for relative, expected in declared_files.items():
        relative_text = str(relative).replace("\\", "/")
        path = (bundle_dir / relative_text).resolve()
        try:
            path.relative_to(bundle_dir)
        except ValueError as error:
            raise FFmpegBundleError(f"FFmpeg file escapes the bundle: {relative}") from error
        if not path.is_file():
            raise FFmpegBundleError(f"Missing declared FFmpeg file: {relative_text}")
        actual = sha256_file(path)
        if actual != str(expected).strip().lower():
            raise FFmpegBundleError(f"SHA-256 mismatch for FFmpeg file: {relative_text}")
        lower_name = path.name.lower()
        if any(token in lower_name for token in FORBIDDEN_BINARY_NAMES):
            raise FFmpegBundleError(f"Forbidden codec library in commercial FFmpeg bundle: {path.name}")

    executable_paths = {}
    for name in EXECUTABLES:
        matches = [path for path in actual_binaries.values() if path.name.lower() == name]
        if len(matches) != 1:
            raise FFmpegBundleError(f"Expected exactly one {name}; found {len(matches)}.")
        executable_paths[name] = matches[0]

    if execute:
        version_output = _run(executable_paths["ffmpeg.exe"], "-version")
        buildconf_output = _run(executable_paths["ffmpeg.exe"], "-buildconf")
        license_output = _run(executable_paths["ffmpeg.exe"], "-L")
        probe_output = _run(executable_paths["ffprobe.exe"], "-version")
        probe_buildconf_output = _run(executable_paths["ffprobe.exe"], "-buildconf")
        probe_license_output = _run(executable_paths["ffprobe.exe"], "-L")
        inspect_build_configuration(buildconf_output)
        inspect_build_configuration(license_output)
        inspect_build_configuration(probe_buildconf_output)
        inspect_build_configuration(probe_license_output)
        if _reported_version(version_output, "ffmpeg") != version or _reported_version(probe_output, "ffprobe") != version:
            raise FFmpegBundleError("FFmpeg/ffprobe runtime version does not match manifest.json.")
        if "lesser general public license" not in license_output.lower() or "lesser general public license" not in probe_license_output.lower():
            raise FFmpegBundleError("ffmpeg/ffprobe -L did not report an LGPL license.")
        declared_flags = _configuration_flags(declared_config)
        ffmpeg_flags = _configuration_flags(buildconf_output)
        ffprobe_flags = _configuration_flags(probe_buildconf_output)
        if not declared_flags or declared_flags != ffmpeg_flags or declared_flags != ffprobe_flags:
            raise FFmpegBundleError("BUILD_CONFIG.txt does not exactly match ffmpeg and ffprobe runtime build flags.")

    return {
        "bundle_dir": str(bundle_dir),
        "version": version,
        "license_expression": license_expression,
        "source_url": source_url,
        "source_sha256": source_sha256,
        "files": {key: str(value).lower() for key, value in declared_files.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a pinned LGPL-only FFmpeg distribution bundle.")
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--no-execute", action="store_true", help="Only validate files and metadata.")
    args = parser.parse_args()
    result = verify_ffmpeg_bundle(args.bundle, execute=not args.no_execute)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
