from __future__ import annotations

import argparse
import fnmatch
import json
import math
import os
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


ALLOW_MARKER = "secret-scan: allow"
DEFAULT_EXCLUDES = (
    ".agents/**",
    ".git/**",
    ".venv/**",
    ".venv*/**",
    "**/__pycache__/**",
    "**/.pytest_cache/**",
    "node_modules/**",
    "**/node_modules/**",
    "ails-backend/models/**",
    "browser_profiles/**",
    "build/**",
    "dist/**",
    "downloads/**",
    "output/**",
    "temp_segments/**",
    "tmp/**",
    "_resume/**",
)
MAX_FILE_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    column: int
    rule: str


TOKEN_RULES = (
    ("private-key", re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")),
    ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255})\b")),
    ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("stripe-live-secret", re.compile(r"\bsk_live_[0-9A-Za-z]{16,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{20,}\b")),
    (
        "credential-in-url",
        re.compile(r"\b[a-z][a-z0-9+.-]{2,20}://[^\s/:@]+:([^\s/@]{8,})@", re.IGNORECASE),
    ),
)
ASSIGNMENT_RULE = re.compile(
    r"(?i)[\"']?(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|client[_-]?secret|password|passwd|secret|auth[_-]?token)\b"
    r"[\"']?\s*(?:=|:)\s*[\"']([^\"'\r\n]{16,512})[\"']"
)
ASSIGNMENT_HINTS = (
    "api_key",
    "api-key",
    "access_key",
    "access-key",
    "client_secret",
    "client-secret",
    "password",
    "passwd",
    "secret",
    "auth_token",
    "auth-token",
)
PLACEHOLDER_WORDS = {
    "change-me",
    "changeme",
    "dummy",
    "example",
    "fake",
    "placeholder",
    "replace-me",
    "sample",
    "test",
    "your-key",
    "your-secret",
}


def _relative(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _excluded(relative: str, patterns: Iterable[str]) -> bool:
    normalized = relative.replace("\\", "/")
    return any(
        fnmatch.fnmatch(normalized, pattern)
        or fnmatch.fnmatch("/" + normalized, pattern)
        for pattern in patterns
    )


def iter_candidate_files(root: Path, excludes: Iterable[str]) -> Iterable[Path]:
    if root.is_file():
        yield root
        return
    def raise_walk_error(error: OSError) -> None:
        raise RuntimeError(f"Cannot scan directory: {error}") from error

    for current, directory_names, file_names in os.walk(
        root,
        topdown=True,
        onerror=raise_walk_error,
        followlinks=False,
    ):
        current_path = Path(current)
        directory_names[:] = sorted(
            name
            for name in directory_names
            if not (current_path / name).is_symlink()
            and not _excluded(_relative(current_path / name, root) + "/_", excludes)
        )
        for name in sorted(file_names):
            path = current_path / name
            if not path.is_symlink() and not _excluded(_relative(path, root), excludes):
                yield path


def _decode_text(payload: bytes) -> str | None:
    if payload.startswith((b"\xff\xfe", b"\xfe\xff")):
        return payload.decode("utf-16", errors="replace")
    if b"\x00" in payload[:4096]:
        return None
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = {character: value.count(character) for character in set(value)}
    return -sum((count / len(value)) * math.log2(count / len(value)) for count in counts.values())


def _looks_like_placeholder(value: str) -> bool:
    lowered = value.lower().strip()
    if any(re.search(rf"(?:^|[^a-z0-9]){re.escape(word)}(?:$|[^a-z0-9])", lowered) for word in PLACEHOLDER_WORDS):
        return True
    if len(set(value)) <= 5:
        return True
    return _entropy(value) < 3.3


def scan_text(text: str, display_path: str) -> list[Finding]:
    findings: list[Finding] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        lowered_line = line.lower()
        if ALLOW_MARKER in lowered_line:
            continue
        for rule, pattern in TOKEN_RULES:
            for match in pattern.finditer(line):
                if rule == "credential-in-url" and _looks_like_placeholder(match.group(1)):
                    continue
                findings.append(Finding(display_path, line_number, match.start() + 1, rule))
        if any(hint in lowered_line for hint in ASSIGNMENT_HINTS):
            for match in ASSIGNMENT_RULE.finditer(line):
                if not _looks_like_placeholder(match.group(1)):
                    findings.append(Finding(display_path, line_number, match.start() + 1, "high-entropy-secret"))
    return findings


def scan_path(
    root: Path,
    *,
    excludes: Iterable[str] = DEFAULT_EXCLUDES,
    max_file_bytes: int = MAX_FILE_BYTES,
) -> list[Finding]:
    root = root.resolve()
    if not root.exists():
        raise FileNotFoundError(root)
    findings: list[Finding] = []
    for path in iter_candidate_files(root, excludes):
        try:
            if path.stat().st_size > max_file_bytes:
                continue
            text = _decode_text(path.read_bytes())
        except OSError as error:
            raise RuntimeError(f"Cannot scan {path}: {error}") from error
        if text is not None:
            findings.extend(scan_text(text, _relative(path, root if root.is_dir() else root.parent)))
    return sorted(findings, key=lambda item: (item.path, item.line, item.column, item.rule))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan local files for likely secrets without network access.")
    parser.add_argument("root", nargs="?", type=Path, default=Path.cwd())
    parser.add_argument("--exclude", action="append", default=[], help="Additional glob to exclude; repeatable.")
    parser.add_argument("--max-file-bytes", type=int, default=MAX_FILE_BYTES)
    parser.add_argument("--json", action="store_true", help="Emit redacted JSON findings.")
    args = parser.parse_args(argv)

    try:
        findings = scan_path(
            args.root,
            excludes=(*DEFAULT_EXCLUDES, *args.exclude),
            max_file_bytes=args.max_file_bytes,
        )
    except (FileNotFoundError, RuntimeError) as error:
        print(f"secret scan error: {error}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps([asdict(item) for item in findings], indent=2))
    else:
        for item in findings:
            print(f"{item.path}:{item.line}:{item.column}: {item.rule}")
        print(f"Secret scan: {len(findings)} finding(s).")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
