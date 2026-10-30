"""Workspace copy/paste, preserving sources, practice data and report images."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path
from urllib.parse import quote

from documents import material_image_move as images
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.material_practice_service import practice_data_path, report_image_dir_names
from system_storage import resolve_system_path


def _safe(path: Path, base: Path) -> None:
    if not path.resolve().is_relative_to(base.resolve()):
        raise ValueError("자료 저장 폴더 밖의 경로는 사용할 수 없습니다.")


def _check_tree(path: Path, base: Path) -> None:
    _safe(path, base)
    # Cloud-sync placeholders also carry REPARSE_POINT; reject redirects only.
    if images._is_redirect(path):
        raise ValueError("링크나 연결된 폴더는 복사·이동할 수 없습니다.")
    if path.is_dir():
        for child in path.iterdir():
            _check_tree(child, base)


def _unique(parent: Path, name: str, directory: bool = False) -> Path:
    stem, suffix = (name, "") if directory else os.path.splitext(name)
    candidate, number = parent / name, 2
    while os.path.lexists(candidate) or (not directory and os.path.lexists(practice_data_path(str(candidate)))):
        candidate = parent / f"{stem} ({number}){suffix}"
        number += 1
    return candidate


def _mkdir(path: Path, created: list[Path], base: Path) -> None:
    _safe(path, base)
    if path.exists():
        return
    _mkdir(path.parent, created, base)
    path.mkdir()
    created.append(path)


def _copy(source: Path, target: Path, created: list[Path], base: Path) -> None:
    _check_tree(source, base)
    _safe(target, base)
    _mkdir(target.parent, created, base)
    if source.is_dir():
        target.mkdir()
        created.append(target)
        shutil.copytree(source, target, dirs_exist_ok=True)
    else:
        with target.open("xb") as destination:
            created.append(target)
            with source.open("rb") as original:
                shutil.copyfileobj(original, destination)
        shutil.copystat(source, target)


def _sync_practice_hash(report: Path, original: bytes, rewritten: bytes) -> None:
    sidecar = Path(practice_data_path(str(report)))
    if not sidecar.is_file() or original == rewritten:
        return
    try:
        data = json.loads(sidecar.read_bytes())
    except (ValueError, UnicodeError):
        return
    # Preserve already-invalid metadata instead of silently validating it.
    if isinstance(data, dict) and data.get("markdown_sha256") == hashlib.sha256(original).hexdigest():
        data["markdown_sha256"] = hashlib.sha256(rewritten).hexdigest()
        images._write_bytes(sidecar, json.dumps(data, ensure_ascii=False).encode("utf-8"))


def _copy_entry(source: Path, target: Path, base: Path) -> None:
    reports = images._reports(source)
    created: list[Path] = []
    originals = {report: report.read_bytes() for report in reports}
    try:
        _copy(source, target, created, base)
        if source.is_file() and source.suffix.lower() == ".md":
            sidecar = Path(practice_data_path(str(source)))
            if sidecar.exists():
                _copy(sidecar, Path(practice_data_path(str(target))), created, base)

        folders: dict[Path, Path] = {}
        loose_images: dict[Path, Path] = {}
        for report, original in originals.items():
            new_report = target if source.is_file() else target / report.relative_to(source)
            content = original.decode("utf-8", errors="surrogateescape")
            references = [(start, end, images._image_path(src, report, base)) for start, end, src in images._references(content)]
            private_assets = new_report.parent / ".images" / f".{new_report.stem}.images"
            private_assets = _unique(private_assets.parent, private_assets.name, True)
            found = [images._image_folder(image, report, base) for _, _, image in references if image]
            for name in report_image_dir_names(report.stem):
                for parent in (report.parent, base):
                    folder = Path(resolve_system_path(str(parent / ".images" / name)))
                    if folder.is_dir():
                        found.append(folder)
                        break
            for folder in found:
                if folder is None or folder in folders:
                    continue
                _safe(folder, base)
                if source.is_dir() and folder.is_relative_to(source):
                    folders[folder] = target / folder.relative_to(source)
                else:
                    destination = _unique(private_assets, folder.name, True)
                    _copy(folder, destination, created, base)
                    folders[folder] = destination
            for start, end, image in reversed(references):
                if image is None:
                    continue
                _safe(image, base)
                if source.is_dir() and image.is_relative_to(source):
                    new_image = target / image.relative_to(source)
                else:
                    folder = next((folder for folder in folders if image.is_relative_to(folder)), None)
                    if folder is not None:
                        new_image = folders[folder] / image.relative_to(folder)
                    else:
                        if image not in loose_images:
                            destination = _unique(private_assets, image.name)
                            _copy(image, destination, created, base)
                            loose_images[image] = destination
                        new_image = loose_images[image]
                replacement = quote(os.path.relpath(new_image, new_report.parent).replace("\\", "/"), safe="/._-~")
                content = content[:start] + replacement + content[end:]
            rewritten = content.encode("utf-8", errors="surrogateescape")
            if rewritten != original:
                images._write_bytes(new_report, rewritten)
                _sync_practice_hash(new_report, original, rewritten)
    except Exception as error:
        rollback_errors = []
        for path in reversed(created):
            try:
                _safe(path, base)
                if path == base:
                    raise ValueError("저장 폴더 자체를 삭제할 수 없습니다.")
                if path.is_dir():
                    shutil.rmtree(path)
                elif path.exists():
                    path.unlink()
            except Exception as rollback_error:
                rollback_errors.append(rollback_error)
        if rollback_errors:
            raise ExceptionGroup("자료 복사 실패 및 사본 정리 실패", [error, *rollback_errors]) from error
        raise


def transfer_entries(payload: dict, base_dir: str, validate_file, validate_folder, move_material) -> dict:
    mode, paths = payload.get("mode"), payload.get("paths")
    if mode not in {"copy", "cut"}:
        raise ValueError("복사 또는 잘라내기를 선택해야 합니다.")
    if not isinstance(paths, list) or not 1 <= len(paths) <= 10000 or any(not isinstance(path, str) or not path.strip() for path in paths):
        raise ValueError("붙여넣을 파일·폴더 경로를 확인하세요.")
    base = Path(os.path.abspath(base_dir))
    target_folder = Path(validate_folder(payload.get("target_folder_path", ""), base_dir))
    _safe(target_folder, base)
    results, selected, seen = [], [], set()
    with PRACTICE_SET_LOCK:
        for raw in paths:
            try:
                path = Path(os.path.abspath(raw))
                path = Path(validate_folder(str(path), base_dir, allow_base=False) if path.is_dir() else validate_file(str(path), base_dir))
                _safe(path, base)
                _check_tree(path, base)
                if path.is_file() and path.suffix.lower() == ".md":
                    sidecar = Path(practice_data_path(str(path)))
                    if sidecar.exists():
                        _check_tree(sidecar, base)
                if path.resolve() == base.resolve():
                    raise ValueError("작업공간 루트는 복사·이동할 수 없습니다.")
                key = os.path.normcase(str(path))
                if key not in seen:
                    selected.append(path)
                    seen.add(key)
            except Exception as error:
                results.append({"status": "error", "old_path": raw, "error": str(error)})
        parents = [path for path in selected if path.is_dir()]
        selected = [path for path in selected if not any(path != parent and path.is_relative_to(parent) for parent in parents)]
        for source in selected:
            try:
                if source.is_dir() and target_folder.resolve().is_relative_to(source.resolve()):
                    raise ValueError("폴더 자신이나 하위 폴더에는 붙여넣을 수 없습니다.")
                if mode == "cut" and source.parent.resolve() == target_folder.resolve():
                    results.append({"status": "unchanged", "old_path": str(source), "new_path": str(source)})
                    continue
                target = _unique(target_folder, source.name, source.is_dir())
                _safe(target, base)
                extra = {}
                if mode == "copy":
                    _copy_entry(source, target, base)
                else:
                    source_is_file = source.is_file()
                    original_reports = {report: report.read_bytes() for report in images._reports(source)}
                    extra = images.move_material_with_images(str(source), str(target), str(base), move_material, unique_destinations=True)
                    warnings = []
                    for report, original in original_reports.items():
                        new_report = target if source_is_file else target / report.relative_to(source)
                        try:
                            _sync_practice_hash(new_report, original, new_report.read_bytes())
                        except Exception as error:
                            warnings.append(f"이동은 완료됐지만 연습문제 데이터 갱신에 실패했습니다: {new_report.name}: {error}")
                    if warnings:
                        extra["warning"] = "\n".join(warnings)
                results.append({"status": "copied" if mode == "copy" else "moved", "old_path": str(source), "new_path": str(target), **extra})
            except Exception as error:
                results.append({"status": "error", "old_path": str(source), "error": str(error)})
    return {"results": results}
