"""Move markdown materials with their linked image directories."""

from __future__ import annotations

import os
import re
import shutil
import stat
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit
from urllib.request import url2pathname

from documents.material_practice_service import report_image_dir_names
from system_storage import IMAGE_DIR_NAMES, canonical_system_name, resolve_system_path, visible_data_folder


_IMAGES = re.compile(
    r'!\[[^\]\n]*\]\(\s*(?P<markdown><[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+)\)'
    r'|!\[\[(?P<obsidian>[^\]|\n]+)(?:\|[^\]\n]*)?\]\]'
    r'|<img\b[^>]*?\bsrc=["\'](?P<html>[^"\']+)["\']', re.IGNORECASE,
)
_CODE = re.compile(r'^(`{3,}|~{3,})[^\n]*\n.*?^\1[^\n]*$|`[^`\n]+`', re.MULTILINE | re.DOTALL)
_IGNORED = {"_images", "_resume", "_trash", ".git", "__pycache__"}
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".tif", ".tiff"}


def _inside(path: Path, root: Path) -> bool:
    return path.resolve().is_relative_to(root.resolve())


def _is_redirect(path: Path) -> bool:
    return path.is_symlink() or getattr(path.lstat(), "st_reparse_tag", 0) == getattr(stat, "IO_REPARSE_TAG_MOUNT_POINT", None)


def _reports(root: Path):
    if root.is_file():
        return [root] if root.suffix.lower() == ".md" else []
    result = []
    for parent, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if visible_data_folder(Path(parent) / name)
                   and _inside(Path(parent) / name, root) and not _is_redirect(Path(parent) / name)]
        result.extend(Path(parent) / name for name in files if name.lower().endswith(".md"))
    return result


def _references(content: str):
    # Keep offsets in the original text, without interpreting code examples.
    masked = _CODE.sub(lambda match: " " * len(match.group()), content)
    for match in _IMAGES.finditer(masked):
        kind = match.lastgroup
        start, end = match.span(kind)
        value = content[start:end]
        if kind == "markdown":
            if value.startswith("<"):
                start += 1
                end = start + value.index(">") - 1
            else:
                value = re.sub(r'\s+["\'][^"\']*["\']\s*$', "", value).rstrip()
                end = start + len(value)
        yield start, end, content[start:end]


def _image_path(src: str, report: Path, base: Path) -> Path | None:
    if not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", src) and not src.startswith(("/api/files", "//")):
        literal_path = Path(unquote(src).replace("\\", os.sep))
        if not literal_path.is_absolute():
            literal_path = report.parent / literal_path
        if literal_path.is_file():
            return Path(os.path.abspath(literal_path))
    if re.match(r"^[A-Za-z]:[/\\]", src):
        path = Path(unquote(src))
    else:
        try:
            url = urlsplit(src)
        except ValueError:
            return None
        if url.path == "/api/files" and (not url.netloc or url.hostname in {"localhost", "127.0.0.1"}):
            raw = parse_qs(url.query).get("path", [""])[0]
            if not raw:
                return None
            path = Path(raw)
        elif url.scheme == "file" and not url.netloc:
            path = Path(url2pathname(url.path))
        elif url.scheme or url.netloc:
            return None
        else:
            path = Path(unquote(url.path).replace("\\", os.sep))
    if not path.is_absolute():
        path = report.parent / path
    path = Path(os.path.abspath(path))
    path = Path(resolve_system_path(str(path)))
    if path.is_file():
        return path
    # Older reports may refer to the base _images directory from a week folder.
    parts = path.parts
    image_parent = next((name for name in IMAGE_DIR_NAMES if name in parts), None)
    if image_parent:
        suffix = Path(*parts[parts.index(image_parent):])
        for parent in (report.parent, *report.parent.parents):
            if not _inside(parent, base):
                break
            candidate = Path(resolve_system_path(str(parent / suffix)))
            if candidate.is_file():
                return candidate
    if len(Path(src).parts) == 1:
        for name in report_image_dir_names(report.stem):
            for parent in (report.parent, base):
                candidate = Path(resolve_system_path(str(parent / ".images" / name / unquote(src))))
                if candidate.is_file():
                    return candidate
    return None


def _image_folder(image: Path, report: Path, base: Path) -> Path | None:
    if not _inside(image, base):
        return None
    parents = []
    for parent in image.parents:
        if parent == base:
            break
        parents.append(parent)
    for parent in parents:
        if parent.parent.name in IMAGE_DIR_NAMES:
            return parent
    for parent in parents:
        if parent.name.endswith(("_images", ".images")) and parent.name not in IMAGE_DIR_NAMES:
            return parent
    # Also support user-attached folders such as assets/ and images/.
    folder = image.parent
    if _inside(folder, report.parent) and folder != report.parent:
        folder = report.parent / folder.relative_to(report.parent).parts[0]
    if folder == report.parent or folder == base:
        return None
    if all(path.suffix.lower() in _IMAGE_EXTENSIONS for path in folder.rglob("*") if path.is_file()):
        return folder
    return None


def _write_bytes(path: Path, content: bytes) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".ails-image-move-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        shutil.copystat(path, temporary)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def move_material_with_images(source_path: str, target_path: str, base_dir: str, move_material, *, unique_destinations: bool = False) -> dict:
    """Preflight destinations, move the material, and restore it on any failure.

    ``move_material`` also carries the existing practice sidecar. The caller
    holds the material mutation lock for the entire operation.
    """
    source, target, base = (Path(os.path.abspath(path)) for path in (source_path, target_path, base_dir))
    source_is_file = source.is_file()
    if not _inside(source, base) or not _inside(target, base):
        raise ValueError("자료와 이미지의 이동 경로는 저장 폴더 안이어야 합니다.")
    reports = _reports(source)
    originals = {report: report.read_bytes() for report in reports}
    contents = {report: data.decode("utf-8", errors="surrogateescape") for report, data in originals.items()}
    folders = {}
    references = {}
    for report, content in contents.items():
        references[report] = [(start, end, _image_path(src, report, base)) for start, end, src in _references(content)]
        found = [_image_folder(image, report, base) for _, _, image in references[report] if image]
        # Preserve unreferenced images in the report's conventional folder too.
        for name in report_image_dir_names(report.stem):
            for parent in (report.parent, base):
                candidate = Path(resolve_system_path(str(parent / ".images" / name)))
                if candidate.is_dir():
                    found.append(candidate)
                    break
        new_report = target if source_is_file else target / report.relative_to(source)
        for folder in found:
            if folder is None:
                continue
            if not _inside(folder, base):
                raise ValueError("이미지 폴더가 자료 저장 폴더 밖을 가리킵니다.")
            if source.is_dir() and _inside(folder, source):
                destination = target / folder.relative_to(source)
            elif folder.parent.name in IMAGE_DIR_NAMES:
                destination = new_report.parent / ".images" / canonical_system_name(folder.name)
            else:
                destination = new_report.parent / folder.name
            # Several reports in a moved folder can share one external image folder.
            folders.setdefault(folder, destination)

    external = {folder: destination for folder, destination in folders.items()
                if not (source.is_dir() and _inside(folder, source)) and folder != destination}
    destinations = set()
    for folder, destination in external.items():
        if not _inside(destination, base):
            raise ValueError("대상 이미지 폴더가 자료 저장 폴더 밖을 가리킵니다.")
        def occupied(candidate):
            inside_moved = not source_is_file and candidate.is_relative_to(target) and Path(resolve_system_path(str(source / candidate.relative_to(target)))).exists()
            return candidate in destinations or Path(resolve_system_path(str(candidate))).exists() or inside_moved
        if occupied(destination) and unique_destinations:
            original, number = destination, 2
            while occupied(destination):
                destination = original.with_name(f"{original.name} ({number})")
                number += 1
            external[folder] = destination
            folders[folder] = destination
        if occupied(destination):
            raise FileExistsError("대상 위치에 같은 이름의 이미지 폴더가 이미 있습니다.")
        destinations.add(destination)

    shared = set()
    if external:
        for report in _reports(base):
            if report in originals:
                continue
            content = report.read_bytes().decode("utf-8", errors="surrogateescape")
            for _, _, src in _references(content):
                image = _image_path(src, report, base)
                if image:
                    shared.update(folder for folder in external if _inside(image, folder))

    rewritten = {}
    image_link_updates = []
    for report, content in contents.items():
        new_report = target if source_is_file else target / report.relative_to(source)
        replacements = []
        for start, end, image in reversed(references[report]):
            if not image:
                continue
            new_image = image
            for folder, destination in folders.items():
                if _inside(image, folder):
                    new_image = destination / image.relative_to(folder)
                    break
            relative = os.path.relpath(new_image, new_report.parent).replace("\\", "/")
            replacement = quote(relative, safe="/._-~")
            if content[start:end] != replacement:
                replacements.append({"before": content[start:end], "after": replacement})
            content = content[:start] + replacement + content[end:]
        rewritten[new_report] = content.encode("utf-8", errors="surrogateescape")
        if replacements:
            image_link_updates.append({"file_path": str(new_report), "replacements": replacements})

    moved = []
    changed = []
    created_parents = []
    move_material(str(source), str(target))
    try:
        for folder, destination in external.items():
            if not destination.parent.exists():
                destination.parent.mkdir(parents=True)
                created_parents.append(destination.parent)
            if folder in shared:
                destination.mkdir()
                moved.append((folder, destination, True))
                shutil.copytree(folder, destination, dirs_exist_ok=True, symlinks=True)
            else:
                moved.append((folder, destination, False))
                shutil.move(str(folder), str(destination))
        for report, original in originals.items():
            new_report = target if source_is_file else target / report.relative_to(source)
            if rewritten[new_report] != original:
                _write_bytes(new_report, rewritten[new_report])
                changed.append((new_report, original))
    except Exception as error:
        rollback_errors = []
        for new_report, original in reversed(changed):
            try:
                _write_bytes(new_report, original)
            except Exception as rollback_error:
                rollback_errors.append(rollback_error)
        for folder, destination, copied in reversed(moved):
            try:
                if copied:
                    shutil.rmtree(destination)
                elif destination.exists() and not folder.exists():
                    shutil.move(str(destination), str(folder))
                elif destination.exists():
                    shutil.rmtree(destination)
            except Exception as rollback_error:
                rollback_errors.append(rollback_error)
        try:
            move_material(str(target), str(source))
        except Exception as rollback_error:
            rollback_errors.append(rollback_error)
        for parent in reversed(created_parents):
            if parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        if rollback_errors:
            raise ExceptionGroup("자료 이동 실패 및 원래 위치 복구 실패", [error, *rollback_errors]) from error
        raise
    return {"moved_image_dirs": len(external), "image_link_updates": image_link_updates}
