"""Rewrite filesystem references only, preserving source text and query anchors."""
import json
import os
from pathlib import Path
import re
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import url2pathname

from documents.material_image_move import _CODE, _references, _image_path, _IMAGE_EXTENSIONS
from documents.system_storage_plan import mapped_path
from system_storage import resolve_system_path
from documents.system_storage_journal import digest

_LINK = re.compile(r'(?<!!)\[[^\]\n]+\]\(\s*(?P<target><[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+)\)')
_DEFINITION = re.compile(r'(?m)^ {0,3}\[[^\]\n]+\]:\s*(?P<target><[^>\n]+>|\S+)')
_PATH_FIELDS = {"path", "paths", "base_dir", "original_parent", "directory", "folder_path", "saved_path"}


def _targets(content):
    yield from _references(content)
    masked = _CODE.sub(lambda match: " " * len(match.group()), content)
    for pattern in (_LINK, _DEFINITION):
        for match in pattern.finditer(masked):
            start, end = match.span("target")
            value = content[start:end]
            if value.startswith("<"):
                start += 1
                end = start + value.index(">") - 1
            else:
                value = re.sub(r'\s+["\'][^"\']*["\']\s*$', "", value).rstrip()
                end = start + len(value)
            yield start, end, content[start:end]


def rewrite_reference(value, source, mapped, root, *, require_exists=False, trace=None):
    if not value or value.startswith(("data:", "//", "#")):
        return value
    windows_absolute = bool(re.match(r"^[A-Za-z]:[/\\]", value))
    url = urlsplit(value) if not windows_absolute else None
    is_api = bool(url and url.path == "/api/files" and (not url.netloc or url.hostname in {"localhost", "127.0.0.1"}))
    parameters = parse_qsl(url.query, keep_blank_values=True) if is_api else []
    if is_api:
        raw = next((text for key, text in parameters if key == "path"), "")
    elif url and url.scheme == "file" and not url.netloc:
        raw = url2pathname(url.path)
    elif url and (url.scheme or url.netloc):
        return value
    else:
        raw = unquote(value if windows_absolute else url.path)
    if not raw:
        return value
    candidate = Path(raw.replace("\\", os.sep))
    old = Path(os.path.abspath(candidate if candidate.is_absolute() else source.parent / candidate))
    if not old.is_relative_to(root):
        return value
    literal = old
    is_image = old.suffix.casefold() in _IMAGE_EXTENSIONS
    if require_exists and not old.exists():
        found = _image_path(value, source, root) if is_image else None
        old = found or Path(resolve_system_path(str(old)))
    elif not require_exists and mapped(old) == old and any(part.startswith("_") or part.endswith(("_codes", "_images")) for part in old.relative_to(root).parts[:-1]) and not old.exists():
        resolved = Path(resolve_system_path(str(old)))
        if resolved == old:
            parent = Path(resolve_system_path(str(old.parent)))
            resolved = parent / old.name
        old = resolved
    if require_exists and not old.exists():
        if trace is not None:
            trace.update({"status": "broken", "resource_before": str(literal), "value": value})
        return value
    if not old.is_relative_to(root):
        return value
    new, new_source = mapped(old), mapped(source)
    if new == old and new_source.parent == source.parent and literal == old:
        return value
    if trace is not None:
        trace.update({"status": "changed", "resource_before": str(old), "resource_after": str(new),
                      "image": is_image, "source_after": str(new_source)})
    if is_api:
        parameters = [(key, str(new) if key == "path" else text) for key, text in parameters]
        return urlunsplit((url.scheme, url.netloc, url.path, urlencode(parameters), url.fragment))
    if url and url.scheme == "file":
        return new.as_uri() + ("?" + url.query if url.query else "") + ("#" + url.fragment if url.fragment else "")
    if candidate.is_absolute():
        replacement = str(new) if windows_absolute else quote(new.as_posix(), safe="/._-~:")
    else:
        replacement = quote(os.path.relpath(new, new_source.parent).replace("\\", "/"), safe="/._-~")
    if url:
        replacement += ("?" + url.query if url.query else "") + ("#" + url.fragment if url.fragment else "")
    return replacement


def _rewrite_record(value, source, mapped, root, names, key=""):
    if isinstance(value, dict):
        return {field: _rewrite_record(item, source, mapped, root, names, field) for field, item in value.items()}
    if isinstance(value, list):
        return [_rewrite_record(item, source, mapped, root, names, key) for item in value]
    if isinstance(value, str):
        if key == "image_dir_name":
            return names.get(value, value)
        if key in _PATH_FIELDS or key.endswith(("_path", "_dir", "_paths")):
            rewritten = rewrite_reference(value, source, mapped, root)
            return unquote(rewritten) if not value.startswith(("file:", "/api/files")) else rewritten
    return value


def inspect_references(plan):
    root = Path(plan["root"])
    mapped = mapped_path(root, plan["moves"])
    updates, changes, broken, hashes = [], [], [], {}
    for raw in plan["reports"]:
        source = Path(raw)
        original = source.read_bytes()
        content = original.decode("utf-8", errors="surrogateescape")
        for start, end, target in sorted(set(_targets(content)), reverse=True):
            trace = {}
            try:
                replacement = rewrite_reference(target, source, mapped, root, require_exists=True, trace=trace)
            except ValueError:
                continue
            if trace.get("status") == "broken":
                broken.append({"source": str(source), "target": target, **trace})
            elif replacement != target:
                change = {"source": str(source), "before": target, "after": replacement, **trace}
                resource = change.get("resource_before")
                if change.get("image") and resource:
                    if resource not in hashes:
                        hashes[resource] = digest(resource)
                    change["resource_sha256"] = hashes[resource]
                changes.append(change)
            content = content[:start] + replacement + content[end:]
        rewritten = content.encode("utf-8", errors="surrogateescape")
        if rewritten != original:
            updates.append((source, original, rewritten))
    names = {Path(old).name: Path(new).name for old, new in plan["moves"]}
    candidates = [Path(old) for old, _new in plan["moves"]]
    moved_roots = [old for old in candidates if not any(old != parent and old.is_relative_to(parent) for parent in candidates)]
    owned_directories = {}
    for raw in plan["records"]:
        source = Path(raw)
        if source.parent not in owned_directories:
            owned_directories[source.parent] = any(source.parent == old or source.parent.is_relative_to(old) for old in moved_roots)
            owned_directories[source.parent] = owned_directories[source.parent] or any(part in {".ails", ".ails-problems", ".resume", ".trash"} for part in source.parent.relative_to(root).parts)
        owned = owned_directories[source.parent]
        if not owned:
            continue
        original = source.read_bytes()
        try:
            payload = json.loads(original.decode("utf-8-sig"))
            revised = _rewrite_record(payload, source, mapped, root, names)
        except (ValueError, UnicodeError):
            continue
        if revised != payload:
            bom = b"\xef\xbb\xbf" if original.startswith(b"\xef\xbb\xbf") else b""
            newline = "\r\n" if b"\r\n" in original else "\n"
            content = json.dumps(revised, ensure_ascii=False, indent=2).replace("\n", newline)
            updates.append((source, original, bom + content.encode("utf-8")))
    return {"updates": updates, "link_changes": changes, "broken_links": broken}


def reference_updates(plan):
    return inspect_references(plan)["updates"]


def verify_links(changes, root):
    """Every changed target must exist; image bytes must match the preflight."""
    contents, hashes = {}, {}
    for change in changes:
        source = Path(change["source_after"])
        target = Path(change["resource_after"])
        if source not in contents:
            content = source.read_bytes().decode("utf-8", errors="surrogateescape")
            contents[source] = {value for _start, _end, value in _targets(content)}
        if change["after"] not in contents[source] or not target.exists():
            raise RuntimeError(f"Changed link does not resolve after migration: {source}")
        if change.get("image"):
            resolved = _image_path(change["after"], source, Path(root))
            if resolved is None or resolved.resolve() != target.resolve():
                raise RuntimeError(f"Changed image link points at another resource: {source}")
            if target not in hashes:
                hashes[target] = digest(target)
            if hashes[target] != change["resource_sha256"]:
                raise RuntimeError(f"Image bytes changed during migration: {target}")
    return {"changed_md_files": len(contents), "changed_links": len(changes), "verified_links": len(changes),
            "verified_image_links": sum(bool(change.get("image")) for change in changes)}
