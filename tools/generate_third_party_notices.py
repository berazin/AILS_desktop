from __future__ import annotations

import argparse
import ast
import email
import fnmatch
import hashlib
import importlib.metadata as importlib_metadata
import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
BUNDLE_MANIFEST_NAME = "bundle-manifest.json"
LICENSE_NAMES = ("license", "licence", "copying", "notice", "copyright")
CLASSIFIER_LICENSES = {
    "Apache Software License": "Apache-2.0",
    "BSD License": "BSD-3-Clause",
    "GNU Lesser General Public License v2 or later (LGPLv2+)": "LGPL-2.0-or-later",
    "GNU Lesser General Public License v3 or later (LGPLv3+)": "LGPL-3.0-or-later",
    "ISC License (ISCL)": "ISC",
    "MIT License": "MIT",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "Python Software Foundation License": "PSF-2.0",
}
LEGACY_LICENSES = {
    "apache 2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache license, version 2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "bsd-2-clause": "BSD-2-Clause",
    "bsd-3-clause": "BSD-3-Clause",
    "bsd 3-clause or apache-2.0": "(BSD-3-Clause OR Apache-2.0)",
    "isc": "ISC",
    "lgpl-2.1-or-later": "LGPL-2.1-or-later",
    "lgpl-3.0-or-later": "LGPL-3.0-or-later",
    "mit": "MIT",
    "mit license": "MIT",
    "mpl-2.0": "MPL-2.0",
    "psf": "PSF-2.0",
    "python software foundation license": "PSF-2.0",
}
SPDX_LICENSE_IDS = {
    "0BSD",
    "Apache-2.0",
    "BlueOak-1.0.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSD-3-Clause-Clear",
    "BSL-1.0",
    "CC-BY-4.0",
    "CC0-1.0",
    "CNRI-Python",
    "GPL-2.0-only",
    "GPL-2.0-or-later",
    "GPL-3.0-only",
    "GPL-3.0-or-later",
    "ISC",
    "LGPL-2.0-only",
    "LGPL-2.0-or-later",
    "LGPL-2.1-only",
    "LGPL-2.1-or-later",
    "LGPL-3.0-only",
    "LGPL-3.0-or-later",
    "MIT",
    "MIT-0",
    "MIT-CMU",
    "MPL-2.0",
    "PSF-2.0",
    "Python-2.0",
    "TCL",
    "Unlicense",
    "Unicode-3.0",
    "Zlib",
}


class LicenseAuditError(RuntimeError):
    pass


@dataclass
class Component:
    ecosystem: str
    name: str
    version: str
    license_expression: str
    source_path: str
    source_url: str = "NOASSERTION"
    license_files: list[Path] = field(default_factory=list)
    copied_license_files: list[str] = field(default_factory=list)
    distributed_files: list[dict] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)

    @property
    def key(self) -> tuple[str, str, str]:
        return self.ecosystem, self.name.lower(), self.version


def _looks_like_license(path: Path) -> bool:
    name = path.name.lower()
    if any(part.lower() in {"licenses", "license", "build_licenses"} for part in path.parts[:-1]):
        return path.suffix.lower() in {"", ".html", ".md", ".rst", ".txt"}
    return any(name == token or name.startswith(token + ".") or name.startswith(token + "-") for token in LICENSE_NAMES)


def _valid_spdx_expression(expression: str) -> bool:
    compact = re.sub(r"\s+", "", str(expression or ""))
    tokens = re.findall(r"LicenseRef-[A-Za-z0-9.+-]+|[A-Za-z0-9][A-Za-z0-9.+-]*|[()]", expression)
    if not tokens or "".join(tokens) != compact:
        return False
    for token in tokens:
        if token in {"AND", "OR", "WITH", "(", ")"}:
            continue
        if token.startswith("LicenseRef-") or token in {"LLVM-exception"} or token.endswith("-exception-2.0"):
            continue
        if token not in SPDX_LICENSE_IDS:
            return False
    return True


def _metadata_license(message: email.message.Message) -> str:
    expression = str(message.get("License-Expression", "") or "").strip()
    if expression and _valid_spdx_expression(expression):
        return expression
    value = str(message.get("License", "") or "").strip()
    package_name = str(message.get("Name", "") or "").strip().lower().replace("-", "_")
    overrides = {
        "clr_loader": "MIT",
        "pyinstaller": "LicenseRef-PyInstaller-Bootloader-Exception",
        "pypdfium2": "(BSD-3-Clause OR Apache-2.0) AND LicenseRef-PDFium-Third-Party",
        "python_bidi": "LGPL-3.0-or-later",
    }
    if package_name in overrides:
        return overrides[package_name]
    normalized_value = re.sub(r"\s+", " ", value).strip().lower()
    if value and _valid_spdx_expression(value):
        return value
    if normalized_value in LEGACY_LICENSES:
        return LEGACY_LICENSES[normalized_value]
    for classifier in message.get_all("Classifier", []):
        if "License ::" not in classifier:
            continue
        label = classifier.rsplit("::", 1)[-1].strip()
        if label in CLASSIFIER_LICENSES:
            return CLASSIFIER_LICENSES[label]
    return "UNKNOWN"


def scan_python_components(backend_root: Path) -> list[Component]:
    components = []
    for dist_info in sorted(backend_root.rglob("*.dist-info")):
        if not dist_info.is_dir():
            continue
        if "ocr-runtimes" in {part.lower() for part in dist_info.parts}:
            # Provider-isolated wheels are audited by pinned aggregate policy
            # entries below; treating each proprietary NVIDIA wheel as a normal
            # PyPI package would lose its reviewed redistribution scope.
            continue
        metadata_path = dist_info / "METADATA"
        if not metadata_path.is_file():
            continue
        message = email.message_from_string(metadata_path.read_text(encoding="utf-8", errors="replace"))
        name = str(message.get("Name", "") or dist_info.name.rsplit(".dist-info", 1)[0]).strip()
        version = str(message.get("Version", "") or "unknown").strip()
        license_files = [path for path in dist_info.rglob("*") if path.is_file() and _looks_like_license(path)]
        top_level_path = dist_info / "top_level.txt"
        if top_level_path.is_file():
            for top_level in top_level_path.read_text(encoding="utf-8", errors="replace").splitlines():
                package_dir = dist_info.parent / top_level.strip()
                if package_dir.is_dir():
                    license_files.extend(
                        path for path in package_dir.rglob("*") if path.is_file() and _looks_like_license(path)
                    )
        component = Component(
            ecosystem="python",
            name=name,
            version=version,
            license_expression=_metadata_license(message),
            source_path=dist_info.relative_to(backend_root).as_posix(),
            license_files=license_files,
        )
        components.append(component)
    return components


def _walk_toc_records(value):
    if isinstance(value, (list, tuple)):
        if (
            len(value) >= 3
            and isinstance(value[0], str)
            and isinstance(value[1], str)
            and isinstance(value[2], str)
            and value[2].upper() in {"BINARY", "DATA", "EXECUTABLE", "EXTENSION", "PYMODULE"}
        ):
            yield value[0], value[1], value[2].upper()
            return
        for item in value:
            yield from _walk_toc_records(item)


def read_pyinstaller_toc_records(worktree: Path) -> list[tuple[str, str, str]]:
    records: list[tuple[str, str, str]] = []
    for pattern in ("PYZ-*.toc", "COLLECT-*.toc"):
        for toc_path in sorted(worktree.rglob(pattern)):
            try:
                payload = ast.literal_eval(toc_path.read_text(encoding="utf-8", errors="strict"))
            except (OSError, SyntaxError, ValueError) as error:
                raise LicenseAuditError(f"Cannot parse PyInstaller TOC {toc_path}: {error}") from error
            records.extend(_walk_toc_records(payload))
    if not records:
        raise LicenseAuditError(f"No actual PyInstaller PYZ/COLLECT records found under: {worktree}")
    return records


def _site_packages_root(path: Path) -> Path | None:
    for index, part in enumerate(path.parts):
        if part.lower() == "site-packages":
            return Path(*path.parts[: index + 1])
    return None


def _distribution_top_levels(distribution: importlib_metadata.Distribution) -> set[str]:
    names: set[str] = set()
    top_level_text = distribution.read_text("top_level.txt") or ""
    names.update(line.strip() for line in top_level_text.splitlines() if line.strip())
    for entry in distribution.files or []:
        parts = Path(str(entry)).parts
        if not parts:
            continue
        first = parts[0]
        lowered = first.lower()
        if lowered.endswith((".dist-info", ".data")) or first.startswith("."):
            continue
        if first.endswith(".py"):
            first = Path(first).stem
        if first:
            names.add(first)
    normalized_name = re.sub(r"[-.]+", "_", str(distribution.metadata.get("Name", "") or ""))
    if normalized_name:
        names.add(normalized_name)
    return names


def _distribution_license_files(distribution: importlib_metadata.Distribution) -> list[Path]:
    files: list[Path] = []
    for entry in distribution.files or []:
        entry_path = Path(str(entry))
        if not _looks_like_license(entry_path):
            continue
        candidate = Path(distribution.locate_file(entry))
        if candidate.is_file():
            files.append(candidate)
    root = Path(distribution.locate_file(""))
    for top_level in _distribution_top_levels(distribution):
        package_dir = root / top_level
        if package_dir.is_dir():
            files.extend(path for path in package_dir.rglob("*") if path.is_file() and _looks_like_license(path))
    return sorted(set(files))


def scan_pyinstaller_python_components(worktree: Path) -> tuple[list[Component], list[str]]:
    records = read_pyinstaller_toc_records(worktree)
    site_sources: dict[Path, set[Path]] = {}
    for _destination, source_text, _kind in records:
        source = Path(source_text)
        root = _site_packages_root(source)
        if root is not None:
            site_sources.setdefault(root, set()).add(source)

    components: list[Component] = []
    issues: list[str] = []
    for site_root, sources in sorted(site_sources.items(), key=lambda item: str(item[0]).lower()):
        distributions = list(importlib_metadata.distributions(path=[str(site_root)]))
        file_owners: dict[str, importlib_metadata.Distribution] = {}
        top_level_owners: dict[str, list[importlib_metadata.Distribution]] = {}
        for distribution in distributions:
            for entry in distribution.files or []:
                located = Path(distribution.locate_file(entry))
                file_owners[str(located.resolve()).casefold()] = distribution
            for top_level in _distribution_top_levels(distribution):
                top_level_owners.setdefault(top_level.casefold(), []).append(distribution)

        used: dict[tuple[str, str], importlib_metadata.Distribution] = {}
        unresolved: list[Path] = []
        for source in sources:
            owner = file_owners.get(str(source.resolve()).casefold())
            if owner is None:
                try:
                    relative = source.resolve().relative_to(site_root.resolve())
                except ValueError:
                    relative = Path()
                first = relative.parts[0].casefold() if relative.parts else ""
                candidates = top_level_owners.get(first, [])
                if len(candidates) == 1:
                    owner = candidates[0]
            if owner is None:
                unresolved.append(source)
                continue
            name = str(owner.metadata.get("Name", "") or "unknown").strip()
            version = str(owner.version or "unknown").strip()
            used[(name.lower(), version)] = owner

        for (normalized_name, version), distribution in sorted(used.items()):
            name = str(distribution.metadata.get("Name", "") or normalized_name).strip()
            components.append(
                Component(
                    ecosystem="python",
                    name=name,
                    version=version,
                    license_expression=_metadata_license(distribution.metadata),
                    source_path=f"python-distribution:{name}@{version}",
                    license_files=_distribution_license_files(distribution),
                )
            )
        for source in sorted(unresolved, key=lambda item: str(item).lower()):
            issues.append(f"PyInstaller source is not owned by a Python distribution: {source.name}")
    return components, issues


def _node_license_expression(package: dict) -> str:
    value = package.get("license", "")
    if isinstance(value, str) and value.strip():
        normalized = value.strip()
        if _valid_spdx_expression(normalized):
            return normalized
        return LEGACY_LICENSES.get(normalized.lower(), "UNKNOWN")
    if isinstance(value, dict):
        return _node_license_expression({"license": value.get("type", "")})
    licenses = package.get("licenses")
    if isinstance(licenses, list):
        values = [str(item.get("type", "") if isinstance(item, dict) else item).strip() for item in licenses]
        values = [item for item in values if item]
        if values:
            normalized_values = [_node_license_expression({"license": item}) for item in values]
            if all(item != "UNKNOWN" for item in normalized_values):
                return " OR ".join(normalized_values)
    return "UNKNOWN"


def scan_node_components(node_root: Path, package_lock: Path) -> list[Component]:
    if not package_lock.is_file():
        raise LicenseAuditError(f"Missing package lock: {package_lock}")
    lock = json.loads(package_lock.read_text(encoding="utf-8"))
    packages = lock.get("packages", {})
    components = []
    for lock_path, lock_entry in sorted(packages.items()):
        if not lock_path.startswith("node_modules/") or not isinstance(lock_entry, dict):
            continue
        if lock_entry.get("dev") is True:
            continue
        relative = lock_path[len("node_modules/") :]
        package_dir = node_root.joinpath(*relative.split("/"))
        if not package_dir.is_dir() and lock_entry.get("optional") is True:
            # package-lock records optional binaries for every OS/CPU. They are
            # not distribution components when npm did not install them.
            continue
        package_json = package_dir / "package.json"
        metadata = {}
        if package_json.is_file():
            metadata = json.loads(package_json.read_text(encoding="utf-8", errors="replace"))
        name = str(metadata.get("name") or relative.split("node_modules/")[-1]).strip()
        version = str(metadata.get("version") or lock_entry.get("version") or "unknown").strip()
        expression = _node_license_expression(metadata or lock_entry)
        if name == "highlightjs-vue":
            # The published 1.0.0 metadata says CC0, while the authoritative
            # repository now carries BSD-3-Clause. Use the explicit repository
            # license, which is the more conservative redistribution grant.
            expression = "BSD-3-Clause"
        license_files = [path for path in package_dir.iterdir() if path.is_file() and _looks_like_license(path)] if package_dir.is_dir() else []
        component = Component(
            ecosystem="node",
            name=name,
            version=version,
            license_expression=expression,
            source_path=f"node_modules/{relative}",
            license_files=license_files,
        )
        if not package_dir.is_dir():
            component.issues.append("production package directory is missing")
        components.append(component)
    return components


def scan_electron_components(node_root: Path) -> list[Component]:
    electron_dir = node_root / "electron"
    package_json = electron_dir / "package.json"
    version = "unknown"
    if package_json.is_file():
        version = str(json.loads(package_json.read_text(encoding="utf-8")).get("version") or "unknown")
    electron_license = electron_dir / "dist" / "LICENSE"
    chromium_notices = electron_dir / "dist" / "LICENSES.chromium.html"
    return [
        Component(
            ecosystem="native",
            name="Electron",
            version=version,
            license_expression="MIT",
            source_path="electron/dist",
            source_url="https://github.com/electron/electron",
            license_files=[electron_license] if electron_license.is_file() else [],
        ),
        Component(
            ecosystem="native",
            name="Chromium third-party components",
            version=f"Electron-{version}",
            license_expression="LicenseRef-Chromium-Third-Party",
            source_path="electron/dist/LICENSES.chromium.html",
            source_url="https://www.chromium.org/",
            license_files=[chromium_notices] if chromium_notices.is_file() else [],
        ),
    ]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_bundle_manifest(output_dir: Path) -> Path:
    manifest_path = output_dir / BUNDLE_MANIFEST_NAME
    files = {
        path.relative_to(output_dir).as_posix(): _sha256_file(path)
        for path in sorted(output_dir.rglob("*"))
        if path.is_file() and path != manifest_path
    }
    payload = {
        "schema_version": 1,
        "hash_algorithm": "SHA-256",
        "files": files,
    }
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest_path


def _matches_artifact_pattern(relative: str, pattern: str) -> bool:
    normalized_relative = relative.replace("\\", "/").lower()
    normalized_pattern = pattern.replace("\\", "/").lower()
    return fnmatch.fnmatch(normalized_relative, normalized_pattern) or (
        normalized_pattern.startswith("**/")
        and fnmatch.fnmatch(normalized_relative, normalized_pattern[3:])
    )


def _approval_text_file(backend_root: Path, relative: object, label: str) -> Path:
    relative_text = str(relative or "").strip().replace("\\", "/")
    if not relative_text:
        raise LicenseAuditError(f"Commercial approval manifest has no {label} path.")
    path = (backend_root / relative_text).resolve()
    try:
        path.relative_to(backend_root.resolve())
    except ValueError as error:
        raise LicenseAuditError(
            f"Commercial approval {label} escapes the packaged backend: {relative_text}"
        ) from error
    if not path.is_file():
        raise LicenseAuditError(f"Commercial approval {label} is missing: {relative_text}")
    if not path.read_text(encoding="utf-8", errors="replace").strip():
        raise LicenseAuditError(f"Commercial approval {label} is empty: {relative_text}")
    return path


def _validate_commercial_approval_manifest(
    *,
    backend_root: Path,
    approval_path: Path,
    component_id: str,
    matched: dict[str, Path],
    expected_version: str,
    expected_expression: str,
    requirements: dict | None = None,
) -> tuple[str, str, str, list[Path]]:
    requirements = requirements or {}
    try:
        approval = json.loads(approval_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise LicenseAuditError(
            f"Cannot read commercial approval manifest {approval_path}: {error}"
        ) from error
    if not isinstance(approval, dict) or approval.get("schema_version") != 1:
        raise LicenseAuditError("Commercial approval manifest must use schema_version 1.")
    if str(approval.get("component_id", "")) != component_id:
        raise LicenseAuditError(
            f"Commercial approval component_id must be '{component_id}'."
        )
    if approval.get("approved_for_commercial_redistribution") is not True:
        raise LicenseAuditError(
            "Commercial approval manifest must explicitly approve commercial redistribution."
        )
    for field in ("reviewed_by", "reviewed_at", "approval_scope"):
        if not str(approval.get(field, "") or "").strip():
            raise LicenseAuditError(f"Commercial approval manifest has no {field}.")
    reviewed_at = str(approval["reviewed_at"]).strip()
    try:
        datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise LicenseAuditError(
            "Commercial approval reviewed_at must be an ISO-8601 date or timestamp."
        ) from error

    version = str(approval.get("version", "") or "").strip()
    if not version or version.lower() == "unknown":
        raise LicenseAuditError("Commercial approval manifest has no pinned component version.")
    if expected_version and expected_version.lower() != "unknown" and version != expected_version:
        raise LicenseAuditError(
            f"Commercial approval version mismatch: expected {expected_version}, got {version}."
        )
    required_version = str(requirements.get("version", "") or "").strip()
    if required_version and version != required_version:
        raise LicenseAuditError(
            f"Commercial approval version must be {required_version}, got {version}."
        )
    version_pattern = str(requirements.get("version_pattern", "") or "").strip()
    if version_pattern:
        try:
            version_matches = re.fullmatch(version_pattern, version) is not None
        except re.error as error:
            raise LicenseAuditError(
                f"Invalid commercial approval version_pattern for {component_id}: {error}"
            ) from error
        if not version_matches:
            raise LicenseAuditError(
                f"Commercial approval version does not match the required pattern: {version}."
            )

    expression = str(approval.get("license_expression", "") or "").strip()
    if not _valid_spdx_expression(expression):
        raise LicenseAuditError(
            f"Commercial approval has an invalid SPDX license expression: {expression or 'missing'}"
        )
    if (
        expected_expression
        and expected_expression.upper() not in {"UNKNOWN", "NOASSERTION"}
        and expression != expected_expression
    ):
        raise LicenseAuditError(
            "Commercial approval license expression differs from component-policy.json."
        )
    source_url = str(approval.get("source_url", "") or "").strip()
    if not source_url.startswith("https://"):
        raise LicenseAuditError("Commercial approval manifest must pin an HTTPS source_url.")
    required_source_url = str(requirements.get("source_url", "") or "").strip()
    if required_source_url and source_url != required_source_url:
        raise LicenseAuditError(
            "Commercial approval source_url differs from the reviewed value."
        )

    required_upstream = requirements.get("upstream_artifact")
    if required_upstream is not None:
        actual_upstream = approval.get("upstream_artifact")
        if not isinstance(required_upstream, dict) or not isinstance(actual_upstream, dict):
            raise LicenseAuditError(
                "Commercial approval manifest must pin the reviewed upstream artifact."
            )
        for field, required_value in required_upstream.items():
            if str(actual_upstream.get(field, "") or "") != str(required_value):
                raise LicenseAuditError(
                    f"Commercial approval upstream artifact {field} differs from the reviewed value."
                )
        upstream_hash = str(actual_upstream.get("sha256", "") or "").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", upstream_hash):
            raise LicenseAuditError("Commercial approval upstream artifact has no valid SHA-256.")
        if not str(actual_upstream.get("source_url", "") or "").startswith("https://"):
            raise LicenseAuditError("Commercial approval upstream artifact has no HTTPS source.")

    required_provenance = requirements.get("build_provenance")
    if required_provenance is not None:
        actual_provenance = approval.get("build_provenance")
        if not isinstance(required_provenance, dict) or not isinstance(
            actual_provenance, dict
        ):
            raise LicenseAuditError(
                "Commercial approval manifest must pin model build provenance."
            )
        for field, required_value in required_provenance.items():
            if str(actual_provenance.get(field, "") or "") != str(required_value):
                raise LicenseAuditError(
                    f"Commercial approval build provenance {field} differs from the reviewed value."
                )

    required_provenance_fields = requirements.get("required_build_provenance_fields", [])
    if not isinstance(required_provenance_fields, list):
        raise LicenseAuditError(
            "Commercial approval required_build_provenance_fields must be a list."
        )
    if required_provenance_fields:
        actual_provenance = approval.get("build_provenance")
        if not isinstance(actual_provenance, dict):
            raise LicenseAuditError(
                "Commercial approval manifest must pin model build provenance."
            )
        missing_provenance = [
            str(field)
            for field in required_provenance_fields
            if not str(actual_provenance.get(str(field), "") or "").strip()
        ]
        if missing_provenance:
            raise LicenseAuditError(
                "Commercial approval build provenance is incomplete: "
                + ", ".join(missing_provenance)
            )

    if requirements.get("require_gpu_runtime_not_self_contained") is True:
        gpu_status = approval.get("gpu_runtime_status")
        if not isinstance(gpu_status, dict) or gpu_status.get("self_contained") is not False:
            raise LicenseAuditError(
                "Commercial approval must state that the NVIDIA GPU runtime is not self-contained."
            )
        not_bundled = {
            str(value).lower() for value in gpu_status.get("not_bundled", [])
        }
        required_missing = {"cublas64_12.dll", "cublaslt64_12.dll", "nvcuda.dll"}
        if not required_missing.issubset(not_bundled):
            raise LicenseAuditError(
                "Commercial approval must identify cuBLAS, cuBLASLt, and the NVIDIA driver runtime as not bundled."
            )

    top_level_license_values = approval.get("license_files")
    if not isinstance(top_level_license_values, list) or not top_level_license_values:
        raise LicenseAuditError("Commercial approval manifest has no license_files list.")
    evidence_files = [
        _approval_text_file(backend_root, value, "license text")
        for value in top_level_license_values
    ]

    approval_relative = approval_path.resolve().relative_to(backend_root.resolve()).as_posix()
    declared_files = approval.get("files")
    if not isinstance(declared_files, dict) or not declared_files:
        raise LicenseAuditError("Commercial approval manifest has no per-file audit map.")

    target_files = {
        relative: path
        for relative, path in matched.items()
        if relative != approval_relative
    }
    if set(declared_files) != set(target_files):
        missing = sorted(set(target_files) - set(declared_files))
        unexpected = sorted(set(declared_files) - set(target_files))
        raise LicenseAuditError(
            "Commercial approval must cover every matched distribution file exactly; "
            f"missing={missing}, unexpected={unexpected}."
        )

    required_file_hashes_raw = requirements.get("file_sha256", {})
    if not isinstance(required_file_hashes_raw, dict):
        raise LicenseAuditError("Commercial approval file_sha256 requirement must be an object.")
    required_file_hashes = {
        str(name).casefold(): str(value).lower()
        for name, value in required_file_hashes_raw.items()
    }
    for name, expected_hash in required_file_hashes.items():
        if not name or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise LicenseAuditError(
                f"Commercial approval has an invalid required SHA-256 for: {name or 'unnamed file'}"
            )
    seen_required_hashes: set[str] = set()

    for relative, path in sorted(target_files.items()):
        file_approval = declared_files.get(relative)
        if not isinstance(file_approval, dict):
            raise LicenseAuditError(f"Commercial approval entry is invalid: {relative}")
        expected_hash = str(file_approval.get("sha256", "") or "").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected_hash) or _sha256_file(path) != expected_hash:
            raise LicenseAuditError(f"Commercial approval SHA-256 mismatch: {relative}")
        required_hash = required_file_hashes.get(path.name.casefold())
        if required_hash is not None:
            seen_required_hashes.add(path.name.casefold())
            if expected_hash != required_hash:
                raise LicenseAuditError(
                    f"Commercial approval file differs from the reviewed release baseline: {relative}"
                )
        file_expression = str(file_approval.get("license_expression", "") or "").strip()
        if not _valid_spdx_expression(file_expression) or _license_is_blocked(file_expression):
            raise LicenseAuditError(
                f"Commercial approval has an unresolved per-file license: {relative}: "
                f"{file_expression or 'missing'}"
            )
        file_source = str(file_approval.get("source_url", "") or "").strip()
        if not file_source.startswith("https://"):
            raise LicenseAuditError(
                f"Commercial approval has no pinned HTTPS source for: {relative}"
            )
        required_file_source = str(
            requirements.get("file_source_url", "") or ""
        ).strip()
        if required_file_source and file_source != required_file_source:
            raise LicenseAuditError(
                f"Commercial approval file source differs from the reviewed value: {relative}"
            )
        file_license_values = file_approval.get("license_files")
        if not isinstance(file_license_values, list) or not file_license_values:
            raise LicenseAuditError(
                f"Commercial approval has no license text for: {relative}"
            )
        evidence_files.extend(
            _approval_text_file(backend_root, value, f"license text for {relative}")
            for value in file_license_values
        )
        required_signer = str(
            requirements.get("authenticode_subject_contains", "") or ""
        ).strip()
        if required_signer:
            authenticode = file_approval.get("authenticode")
            if not isinstance(authenticode, dict):
                raise LicenseAuditError(
                    f"Commercial approval has no Authenticode evidence for: {relative}"
                )
            status = str(authenticode.get("status", "") or "")
            subject = str(authenticode.get("subject", "") or "")
            thumbprint = re.sub(
                r"\s+", "", str(authenticode.get("thumbprint", "") or "")
            ).upper()
            if status != "Valid" or required_signer not in subject:
                raise LicenseAuditError(
                    f"Commercial approval Authenticode signer mismatch for: {relative}"
                )
            if not re.fullmatch(r"[0-9A-F]{40,128}", thumbprint):
                raise LicenseAuditError(
                    f"Commercial approval Authenticode thumbprint is invalid for: {relative}"
                )
        if "LGPL" in file_expression.upper():
            source_offer_values = file_approval.get("source_offer_files")
            if not isinstance(source_offer_values, list) or not source_offer_values:
                raise LicenseAuditError(
                    f"Commercial approval has no LGPL source/build evidence for: {relative}"
                )
            evidence_files.extend(
                _approval_text_file(
                    backend_root,
                    value,
                    f"LGPL source/build evidence for {relative}",
                )
                for value in source_offer_values
            )
    missing_required_hashes = sorted(set(required_file_hashes) - seen_required_hashes)
    if missing_required_hashes:
        raise LicenseAuditError(
            "Commercial approval is missing reviewed release files: "
            + ", ".join(missing_required_hashes)
        )
    return version, expression, source_url, sorted(set(evidence_files))


def scan_policy_components(backend_root: Path, edition: str) -> tuple[list[Component], list[str]]:
    policy_path = ROOT / "licenses" / "component-policy.json"
    if not policy_path.is_file():
        return [], [f"component policy is missing: {policy_path}"]
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    if not isinstance(policy, dict) or policy.get("schema_version") != 1:
        raise LicenseAuditError(f"Invalid component policy: {policy_path}")
    entries = policy.get("components")
    if not isinstance(entries, list):
        raise LicenseAuditError(f"Component policy has no components list: {policy_path}")

    artifact_files = {
        path.relative_to(backend_root).as_posix(): path
        for path in backend_root.rglob("*")
        if path.is_file()
    }
    components: list[Component] = []
    issues: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        excluded_editions = {
            str(value).strip().lower()
            for value in entry.get("excluded_editions", [])
            if str(value).strip()
        }
        if edition.lower() in excluded_editions:
            continue
        patterns = [str(pattern) for pattern in entry.get("paths", []) if str(pattern).strip()]
        matched = {
            relative: path
            for relative, path in artifact_files.items()
            if any(_matches_artifact_pattern(relative, pattern) for pattern in patterns)
        }
        if not matched:
            if edition == "commercial" and entry.get("commercial_required") is True:
                issues.append(
                    "native:"
                    + str(entry.get("id", "unnamed-native-component"))
                    + ": required commercial component is missing from the staged backend"
                )
            continue
        component_id = str(entry.get("id", "unnamed-native-component"))
        version = str(entry.get("version", "unknown"))
        expression = str(entry.get("license_expression", "UNKNOWN"))
        source_url = str(entry.get("source", "NOASSERTION"))

        if component_id == "ffmpeg":
            manifest_path = next(
                (path for relative, path in matched.items() if relative.lower().endswith("/manifest.json")),
                None,
            )
            if manifest_path is None:
                issues.append("native:ffmpeg: audited manifest.json is missing")
            else:
                ffmpeg_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                version = str(ffmpeg_manifest.get("version", "unknown"))
                expression = str(ffmpeg_manifest.get("license_expression", "UNKNOWN"))
                source_url = str(ffmpeg_manifest.get("source_url", "NOASSERTION"))
        license_patterns = [str(pattern) for pattern in entry.get("license_paths", [])]
        license_files = [
            path
            for relative, path in matched.items()
            if _looks_like_license(Path(relative))
        ]
        license_files.extend(
            path
            for relative, path in artifact_files.items()
            if any(_matches_artifact_pattern(relative, pattern) for pattern in license_patterns)
        )
        environment_distribution = str(entry.get("python_distribution", "") or "").strip()
        if environment_distribution:
            try:
                environment_metadata = importlib_metadata.distribution(environment_distribution)
                license_files.extend(_distribution_license_files(environment_metadata))
                environment_version = str(environment_metadata.version or "unknown")
                if version.lower() == "unknown":
                    version = environment_version
                elif environment_version != version:
                    issues.append(
                        f"native:{component_id}: build environment distribution version differs: "
                        f"expected {version}, got {environment_version}"
                    )
            except importlib_metadata.PackageNotFoundError:
                issues.append(
                    f"native:{component_id}: build environment distribution is missing: {environment_distribution}"
                )
        if component_id == "ffmpeg" and manifest_path is not None:
            license_files.append(manifest_path)
            for key in ("license_file", "source_offer_file", "build_config_file"):
                relative = str(ffmpeg_manifest.get(key, "") or "").strip()
                candidate = manifest_path.parent / relative
                if candidate.is_file():
                    license_files.append(candidate)
        approval_file = str(entry.get("commercial_approval_file", "") or "").strip()
        approval_issue = ""
        if edition == "commercial" and approval_file:
            approval_path = backend_root / approval_file
            if not approval_path.is_file():
                approval_issue = f"commercial approval evidence is missing: {approval_file}"
            elif component_id != "ffmpeg":
                try:
                    version, expression, source_url, approval_evidence = (
                        _validate_commercial_approval_manifest(
                            backend_root=backend_root,
                            approval_path=approval_path,
                            component_id=component_id,
                            matched=matched,
                            expected_version=version,
                            expected_expression=expression,
                            requirements=entry.get("commercial_approval_requirements"),
                        )
                    )
                    license_files.extend(approval_evidence)
                    license_files.append(approval_path)
                except LicenseAuditError as error:
                    approval_issue = str(error)

        component = Component(
            ecosystem="native",
            name=str(entry.get("display_name") or component_id),
            version=version,
            license_expression=expression,
            source_path=f"artifact-policy:{component_id}",
            source_url=source_url,
            license_files=sorted(set(license_files)),
            distributed_files=[
                {
                    "path": relative,
                    "sha256": _sha256_file(path),
                }
                for relative, path in sorted(matched.items())
                if not _looks_like_license(Path(relative))
            ],
        )
        if approval_issue:
            component.issues.append(approval_issue)
        approval_glob = str(entry.get("commercial_approval_glob", "") or "").strip()
        if edition == "commercial" and approval_glob:
            approval_matches = [
                path
                for relative, path in artifact_files.items()
                if _matches_artifact_pattern(relative, approval_glob)
            ]
            if not approval_matches:
                component.issues.append(
                    f"commercial approval evidence is missing: {approval_glob}"
                )
            elif any(
                not path.read_text(encoding="utf-8", errors="replace").strip()
                for path in approval_matches
            ):
                component.issues.append(
                    f"commercial approval evidence is empty: {approval_glob}"
                )
        if edition == "commercial" and entry.get("commercial_blocked") is True:
            component.issues.append("component policy blocks this asset from the commercial edition")
        components.append(component)
    return components, issues


def _safe_component_name(component: Component) -> str:
    raw = f"{component.ecosystem}-{component.name}-{component.version}"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._")


def _copy_license_files(component: Component, license_dir: Path) -> None:
    target_dir = license_dir / _safe_component_name(component)
    seen_names: set[str] = set()
    for source in component.license_files:
        name = source.name
        if name.lower() in seen_names:
            digest = hashlib.sha256(str(source).encode("utf-8")).hexdigest()[:8]
            name = f"{source.stem}-{digest}{source.suffix}"
        seen_names.add(name.lower())
        target_dir.mkdir(parents=True, exist_ok=True)
        destination = target_dir / name
        shutil.copy2(source, destination)
        component.copied_license_files.append(destination.relative_to(license_dir.parent).as_posix())


def _add_manual_license_files(component: Component) -> None:
    normalized_name = re.sub(r"[^a-z0-9._-]+", "_", component.name.lower())
    manual_dir = ROOT / "licenses" / "manual" / component.ecosystem / normalized_name
    if manual_dir.is_dir():
        component.license_files.extend(
            path for path in manual_dir.rglob("*") if path.is_file() and _looks_like_license(path)
        )
    if component.license_files:
        return
    if component.ecosystem == "node":
        node_fallbacks = {
            "@napi-rs/canvas-win32-x64-msvc": ROOT / "ails-frontend" / "node_modules" / "@napi-rs" / "canvas" / "LICENSE",
            "@radix-ui/react-compose-refs": ROOT / "ails-frontend" / "node_modules" / "@radix-ui" / "react-slot" / "LICENSE",
        }
        candidate = node_fallbacks.get(component.name)
        if candidate and candidate.is_file():
            component.license_files.append(candidate)
    if component.license_files:
        return
    if component.license_expression == "Apache-2.0":
        try:
            component.license_files.extend(_distribution_license_files(importlib_metadata.distribution("google-auth")))
        except importlib_metadata.PackageNotFoundError:
            pass


def _license_is_blocked(expression: str) -> bool:
    normalized = expression.upper().replace(" ", "")
    if normalized in {"", "UNKNOWN", "NONE", "NOASSERTION"}:
        return True
    if "AGPL" in normalized or "NONFREE" in normalized:
        return True
    allowed_license_refs = {
        "LICENSEREF-CHROMIUM-THIRD-PARTY",
        "LICENSEREF-PDFIUM-THIRD-PARTY",
        "LICENSEREF-PYINSTALLER-BOOTLOADER-EXCEPTION",
        "LICENSEREF-NVIDIA-CUDA-EULA",
        "LICENSEREF-NVIDIA-CUDNN-SLA",
        "LICENSEREF-INTEL-SIMPLIFIED-SOFTWARE-LICENSE",
        "LICENSEREF-AILS-PROBLEM-NUMBER-MODELS",
    }
    referenced = set(re.findall(r"LICENSEREF-[A-Z0-9.+-]+", normalized))
    if referenced - allowed_license_refs:
        return True
    # GPL is not approved for the proprietary commercial package. LGPL is
    # handled as an obligation, not a blocker.
    without_lgpl = normalized.replace("LGPL", "")
    return "GPL" in without_lgpl


def audit_native_assets(backend_root: Path, edition: str, electron_dist: Path) -> list[str]:
    issues = []
    lower_paths = {path.relative_to(backend_root).as_posix().lower(): path for path in backend_root.rglob("*") if path.is_file()}
    forbidden_codec_tokens = ("x264", "x265", "fdk-aac", "fdk_aac")
    for relative in lower_paths:
        if any(token in relative for token in forbidden_codec_tokens):
            issues.append(f"unapproved GPL/nonfree codec binary: {relative}")
    if edition == "commercial":
        forbidden_local_stt_patterns = {
            "PyAV": re.compile(r"(^|/)(av|av\.libs|av-[^/]+\.dist-info)(/|$)"),
            "faster-whisper": re.compile(
                r"(^|/)(faster_whisper|faster_whisper-[^/]+\.dist-info)(/|$)"
            ),
            "CTranslate2": re.compile(
                r"(^|/)(ctranslate2(?:\.dll|_ext[^/]*\.pyd)?|ctranslate2-[^/]+\.dist-info)(/|$)"
            ),
            "cuDNN": re.compile(r"(^|/)cudnn[^/]*\.dll$"),
            "Intel OpenMP": re.compile(r"(^|/)libiomp[^/]*\.dll$"),
            "cuBLAS": re.compile(r"(^|/)(cublas|cublaslt)[^/]*\.dll$"),
            "NVIDIA driver runtime": re.compile(r"(^|/)nvcuda\.dll$"),
            "CUDA": re.compile(
                r"(^|/)(cudart|cufft|curand|cusolver|cusparse|nvjitlink|nvptxcompiler|nvrtc|nvrtc-builtins)[^/]*\.dll$"
            ),
            "Transformers": re.compile(
                r"(^|/)(transformers|transformers-[^/]+\.dist-info)(/|$)"
            ),
            "PyTorch": re.compile(
                r"(^|/)(torch|torch-[^/]+\.dist-info|torch\.libs)(/|$)"
            ),
            "legacy Whisper model": re.compile(
                r"(^|/)(models/(whisper|faster-whisper)|whisper_models)(/|$)"
            ),
        }
        for label, pattern in forbidden_local_stt_patterns.items():
            matches = sorted(
                relative
                for relative in lower_paths
                if pattern.search(relative)
                and not (
                    label in {"cuDNN", "cuBLAS", "CUDA"}
                    and relative.startswith("_internal/ocr-runtimes/cuda/")
                )
            )
            if matches:
                issues.append(
                    f"unapproved {label} runtime in commercial package: "
                    + ", ".join(matches[:10])
                )
        pyinstaller_core = [
            relative
            for relative, path in lower_paths.items()
            if (
                relative.startswith("pyinstaller/")
                or relative.startswith("_internal/pyinstaller/")
            )
            and path.suffix.lower() in {".py", ".pyc", ".pyd"}
        ]
        if pyinstaller_core:
            issues.append(
                "PyInstaller GPL core modules were included instead of only the bootloader exception: "
                + ", ".join(pyinstaller_core[:10])
            )
    chromium_candidates = [
        electron_dist / "LICENSES.chromium.html",
        electron_dist / "LICENSE",
    ]
    for candidate in chromium_candidates:
        if not candidate.is_file():
            issues.append(f"missing Electron distribution notice: {candidate.name}")
    return issues


def generate_notices(
    *,
    edition: str,
    backend_root: Path,
    node_root: Path,
    package_lock: Path,
    output_dir: Path,
    strict: bool,
    pyinstaller_worktree: Path | None = None,
) -> dict:
    if not backend_root.is_dir():
        raise LicenseAuditError(f"Backend distribution does not exist: {backend_root}")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    license_dir = output_dir / "license-texts"
    license_dir.mkdir(parents=True, exist_ok=True)

    issues: list[str] = []
    components = scan_python_components(backend_root)
    if pyinstaller_worktree is not None:
        pyinstaller_components, pyinstaller_issues = scan_pyinstaller_python_components(pyinstaller_worktree)
        components.extend(pyinstaller_components)
        issues.extend(pyinstaller_issues)
    elif any(path.name.lower() == "ailsbackend.exe" for path in backend_root.rglob("*.exe")):
        issues.append("PyInstaller worktree is required to inventory Python modules in the frozen backend")
    components.extend(scan_node_components(node_root, package_lock))
    components.extend(scan_electron_components(node_root))
    policy_components, policy_issues = scan_policy_components(backend_root, edition)
    components.extend(policy_components)
    issues.extend(policy_issues)
    unique = {component.key: component for component in components}
    components = sorted(unique.values(), key=lambda item: item.key)

    issues.extend(audit_native_assets(backend_root, edition, node_root / "electron" / "dist"))
    for component in components:
        _add_manual_license_files(component)
        if not component.version or component.version.lower() == "unknown":
            component.issues.append("component version is unknown")
        if not component.license_files:
            component.issues.append("license text is missing from the installed/distributed package")
        if _license_is_blocked(component.license_expression):
            component.issues.append(f"license requires commercial review: {component.license_expression}")
        _copy_license_files(component, license_dir)
        issues.extend(f"{component.ecosystem}:{component.name}@{component.version}: {issue}" for issue in component.issues)

    electron_dist = node_root / "electron" / "dist"
    for name in ("LICENSE", "LICENSES.chromium.html"):
        source = electron_dist / name
        if source.is_file():
            shutil.copy2(source, output_dir / name)

    inventory = {
        "schema_version": 1,
        "edition": edition,
        "strict": strict,
        "components": [
            {
                "ecosystem": item.ecosystem,
                "name": item.name,
                "version": item.version,
                "license_expression": item.license_expression,
                "source_path": item.source_path,
                "source_url": item.source_url,
                "license_files": item.copied_license_files,
                "distributed_files": item.distributed_files,
                "issues": item.issues,
            }
            for item in components
        ],
        "issues": issues,
    }
    (output_dir / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")

    app_package_path = node_root.parent / "package.json"
    app_version = "unknown"
    if app_package_path.is_file():
        app_version = str(json.loads(app_package_path.read_text(encoding="utf-8")).get("version") or "unknown")
    spdx_packages = [
        {
            "SPDXID": "SPDXRef-Package-AILS",
            "name": f"AILS {edition}",
            "versionInfo": app_version,
            "downloadLocation": "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": "NOASSERTION",
            "copyrightText": "Copyright 2026 AILS",
        }
    ]
    relationships = [
        {
            "spdxElementId": "SPDXRef-DOCUMENT",
            "relationshipType": "DESCRIBES",
            "relatedSpdxElement": "SPDXRef-Package-AILS",
        }
    ]
    for index, item in enumerate(components, start=1):
        spdx_id = f"SPDXRef-Package-{index}"
        declared = (
            item.license_expression
            if _valid_spdx_expression(item.license_expression) and not _license_is_blocked(item.license_expression)
            else "NOASSERTION"
        )
        package = {
            "SPDXID": spdx_id,
            "name": f"{item.ecosystem}:{item.name}",
            "versionInfo": item.version,
            "downloadLocation": item.source_url if item.source_url.startswith(("https://", "http://")) else "NOASSERTION",
            "filesAnalyzed": False,
            "licenseConcluded": "NOASSERTION",
            "licenseDeclared": declared,
            "copyrightText": "NOASSERTION",
        }
        if item.distributed_files:
            file_seed = json.dumps(item.distributed_files, sort_keys=True, separators=(",", ":"))
            package["checksums"] = [
                {
                    "algorithm": "SHA256",
                    "checksumValue": hashlib.sha256(file_seed.encode("utf-8")).hexdigest(),
                }
            ]
        spdx_packages.append(package)
        relationships.append({
            "spdxElementId": "SPDXRef-Package-AILS",
            "relationshipType": "DEPENDS_ON",
            "relatedSpdxElement": spdx_id,
        })
    namespace_seed = json.dumps(
        [
            {
                "ecosystem": item.ecosystem,
                "name": item.name,
                "version": item.version,
                "license": item.license_expression,
                "license_hashes": sorted(_sha256_file(path) for path in item.license_files if path.is_file()),
                "distributed_files": item.distributed_files,
            }
            for item in components
        ],
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    namespace_hash = hashlib.sha256(namespace_seed.encode("utf-8")).hexdigest()
    spdx = {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"AILS-{edition}-third-party",
        "documentNamespace": f"https://ails.local/spdx/{edition}/{namespace_hash}",
        "creationInfo": {
            "created": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "creators": ["Tool: AILS license inventory generator"],
        },
        "packages": spdx_packages,
        "relationships": relationships,
    }
    (output_dir / "SBOM.spdx.json").write_text(json.dumps(spdx, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Third-Party Notices",
        "",
        f"Edition: `{edition}`",
        "",
        "This file is generated from the dependencies present in the distribution staging tree.",
        "The corresponding original license texts are in `license-texts/`.",
        "",
        "| Component | Version | License | Source | License text |",
        "| --- | --- | --- | --- | --- |",
    ]
    for item in components:
        texts = ", ".join(f"`{path}`" for path in item.copied_license_files) or "MISSING"
        source = item.source_url if item.source_url != "NOASSERTION" else item.source_path
        lines.append(
            f"| {item.ecosystem}:{item.name} | {item.version} | {item.license_expression} | {source} | {texts} |"
        )
    (output_dir / "THIRD_PARTY_NOTICES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    review_lines = ["# Distribution Review", ""]
    if issues:
        review_lines.extend(f"- {issue}" for issue in issues)
    else:
        review_lines.append("No automated license issues were found.")
    (output_dir / "REVIEW_REQUIRED.md").write_text("\n".join(review_lines) + "\n", encoding="utf-8")
    _write_bundle_manifest(output_dir)

    if strict and issues:
        preview = "\n".join(f"- {issue}" for issue in issues[:30])
        suffix = f"\n- ... and {len(issues) - 30} more" if len(issues) > 30 else ""
        raise LicenseAuditError(
            "Commercial license audit failed. Resolve every item in REVIEW_REQUIRED.md:\n" + preview + suffix
        )
    validate_notice_bundle(output_dir, edition=edition, strict=strict)
    return inventory


def validate_notice_bundle(output_dir: Path, *, edition: str, strict: bool) -> dict:
    inventory_path = output_dir / "inventory.json"
    sbom_path = output_dir / "SBOM.spdx.json"
    notice_path = output_dir / "THIRD_PARTY_NOTICES.md"
    review_path = output_dir / "REVIEW_REQUIRED.md"
    bundle_manifest_path = output_dir / BUNDLE_MANIFEST_NAME
    required_files = (inventory_path, sbom_path, notice_path, review_path, bundle_manifest_path)
    missing = [str(path) for path in required_files if not path.is_file()]
    if missing:
        raise LicenseAuditError("License bundle is incomplete: " + ", ".join(missing))
    bundle_manifest = json.loads(bundle_manifest_path.read_text(encoding="utf-8"))
    declared_bundle_files = bundle_manifest.get("files") if isinstance(bundle_manifest, dict) else None
    if (
        not isinstance(bundle_manifest, dict)
        or bundle_manifest.get("schema_version") != 1
        or bundle_manifest.get("hash_algorithm") != "SHA-256"
        or not isinstance(declared_bundle_files, dict)
    ):
        raise LicenseAuditError("License bundle integrity manifest is invalid.")
    actual_bundle_files = {
        path.relative_to(output_dir).as_posix(): path
        for path in output_dir.rglob("*")
        if path.is_file() and path != bundle_manifest_path
    }
    if set(declared_bundle_files) != set(actual_bundle_files):
        raise LicenseAuditError("License bundle file set differs from its integrity manifest.")
    for relative, path in actual_bundle_files.items():
        expected_hash = str(declared_bundle_files.get(relative, "") or "").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected_hash) or _sha256_file(path) != expected_hash:
            raise LicenseAuditError(f"License bundle SHA-256 mismatch: {relative}")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    if inventory.get("schema_version") != 1 or inventory.get("edition") != edition:
        raise LicenseAuditError("License inventory edition/schema mismatch.")
    if bool(inventory.get("strict")) != bool(strict):
        raise LicenseAuditError("License inventory strict-mode marker mismatch.")
    issues = inventory.get("issues")
    if not isinstance(issues, list) or (strict and issues):
        raise LicenseAuditError("Strict license inventory still contains unresolved review issues.")
    components = inventory.get("components")
    if not isinstance(components, list) or not components:
        raise LicenseAuditError("License inventory has no distribution components.")
    names = {str(item.get("name", "")) for item in components if isinstance(item, dict)}
    for required_name in ("Electron", "Chromium third-party components"):
        if required_name not in names:
            raise LicenseAuditError(f"License inventory is missing {required_name}.")
    if edition == "commercial":
        manifest_path = ROOT / "editions" / "commercial.json"
        try:
            commercial_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            ffmpeg_policy = str(commercial_manifest["packaging"]["ffmpeg_policy"])
        except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise LicenseAuditError(f"Cannot read commercial FFmpeg policy: {error}") from error
        ffmpeg_name = "FFmpeg commercial runtime"
        if ffmpeg_policy == "audited-lgpl-bundle-required" and ffmpeg_name not in names:
            raise LicenseAuditError(f"Commercial license inventory is missing {ffmpeg_name}.")
        if ffmpeg_policy == "excluded" and ffmpeg_name in names:
            raise LicenseAuditError("Commercial license inventory contains excluded application FFmpeg.")
    for item in components:
        if not isinstance(item, dict):
            raise LicenseAuditError("License inventory contains an invalid component entry.")
        expression = str(item.get("license_expression", "") or "")
        if strict and (_license_is_blocked(expression) or not _valid_spdx_expression(expression)):
            raise LicenseAuditError(f"Invalid commercial license expression: {item.get('name')}: {expression}")
        license_files = item.get("license_files")
        if not isinstance(license_files, list) or (strict and not license_files):
            raise LicenseAuditError(f"Component has no copied license text: {item.get('name')}")
        for relative in license_files:
            path = output_dir / str(relative)
            try:
                path.resolve().relative_to(output_dir.resolve())
            except ValueError as error:
                raise LicenseAuditError(f"License path escapes the bundle: {relative}") from error
            if not path.is_file():
                raise LicenseAuditError(f"Copied license text is missing: {relative}")

    sbom = json.loads(sbom_path.read_text(encoding="utf-8"))
    if (
        sbom.get("spdxVersion") != "SPDX-2.3"
        or sbom.get("SPDXID") != "SPDXRef-DOCUMENT"
        or sbom.get("name") != f"AILS-{edition}-third-party"
    ):
        raise LicenseAuditError("SPDX document identity is invalid.")
    packages = sbom.get("packages")
    if not isinstance(packages, list) or len(packages) != len(components) + 1:
        raise LicenseAuditError("SPDX package set does not match the license inventory.")
    for package in packages:
        declared = str(package.get("licenseDeclared", "NOASSERTION"))
        if declared != "NOASSERTION" and not _valid_spdx_expression(declared):
            raise LicenseAuditError(f"Invalid SPDX licenseDeclared expression: {declared}")
    notice = notice_path.read_text(encoding="utf-8")
    for item in components:
        if f"{item['ecosystem']}:{item['name']}" not in notice:
            raise LicenseAuditError(f"Third-party notice is missing a component: {item['name']}")
    return inventory


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate third-party notices from a staged AILS distribution.")
    parser.add_argument("--edition", required=True, choices=("developer", "commercial", "general"))
    parser.add_argument("--backend-root", required=True, type=Path)
    parser.add_argument("--node-root", type=Path, default=ROOT / "ails-frontend" / "node_modules")
    parser.add_argument("--package-lock", type=Path, default=ROOT / "ails-frontend" / "package-lock.json")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--pyinstaller-worktree", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    generate_notices(
        edition=args.edition,
        backend_root=args.backend_root.resolve(),
        node_root=args.node_root.resolve(),
        package_lock=args.package_lock.resolve(),
        output_dir=args.output_dir.resolve(),
        strict=args.strict,
        pyinstaller_worktree=args.pyinstaller_worktree.resolve() if args.pyinstaller_worktree else None,
    )
    print(f"License bundle written to: {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
