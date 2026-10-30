"""MaterialFileOperations: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from common import resolve_app_path
from documents.material_catalog_rules import ensure_safe_material_dir
from documents.material_catalog_rules import natural_sort_key
from documents.material_creation import create_material_file
from documents.material_creation import validate_material_creation_parent
from documents.material_file_moves import move_material_to_trash
from documents.material_file_moves import move_material_with_practice
from documents.material_file_moves import read_material_restore_metadata
from documents.material_file_moves import remove_material_restore_metadata
from documents.material_file_moves import write_material_restore_metadata
from documents.material_file_policy import MATERIAL_FILE_EXTENSIONS
from documents.material_file_policy import ensure_safe_material_path
from documents.material_file_policy import material_file_kind_from_ext
from documents.material_image_move import move_material_with_images
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.material_practice_service import practice_data_path
from documents.material_practice_service import sanitize_material_child_name
from documents.material_sources import title_from_report_path
from documents.material_transfer import transfer_entries
from system_storage import canonical_data_folder_name
import os
import pdf.viewer_support
import shutil
import stat
import time


@dataclass(frozen=True)
class MaterialFileOperationsPorts:
    get_material_file_service: Callable[..., Any]
    _ready_pdf_text_payload: Callable[..., Any]
    invalidate_lecture_materials_cache: Callable[..., Any]
    lecture_materials: Callable[..., Any]
    refresh_reports_from_disk: Callable[..., Any]
    refresh_retry_candidates_from_disk: Callable[..., Any]
    start_pdf_text_extraction: Callable[..., Any]
    get_background_work: Callable[..., Any]
    get_config: Callable[..., Any]
    get_lecture_materials_cache_lock: Callable[..., Any]
    get_lock: Callable[..., Any]
    get_processed_results: Callable[..., Any]
    get_session_report_titles: Callable[..., Any]


class MaterialFileOperations:
    def __init__(self, ports: MaterialFileOperationsPorts):
        self._ports = ports
        self._ready_pdf_text_payload = ports._ready_pdf_text_payload
        self.invalidate_lecture_materials_cache = ports.invalidate_lecture_materials_cache
        self.lecture_materials = ports.lecture_materials
        self.refresh_reports_from_disk = ports.refresh_reports_from_disk
        self.refresh_retry_candidates_from_disk = ports.refresh_retry_candidates_from_disk
        self.start_pdf_text_extraction = ports.start_pdf_text_extraction

    @property
    def background_work(self):
        return self._ports.get_background_work()

    @property
    def config(self):
        return self._ports.get_config()

    @property
    def lecture_materials_cache_lock(self):
        return self._ports.get_lecture_materials_cache_lock()

    @property
    def lock(self):
        return self._ports.get_lock()

    @property
    def processed_results(self):
        return self._ports.get_processed_results()

    @property
    def session_report_titles(self):
        return self._ports.get_session_report_titles()

    def material_trash_dir(self, base_dir: str) -> str:
        root = os.path.realpath(base_dir)
        trash_dir = os.path.abspath(os.path.join(base_dir, ".trash"))
        try:
            inside_root = os.path.normcase(os.path.commonpath([root, os.path.realpath(trash_dir)])) == os.path.normcase(root)
        except ValueError:
            inside_root = False
        if not inside_root:
            raise ValueError("휴지통은 학습 자료 저장 폴더 안에 있어야 합니다.")
        return trash_dir

    def material_trash_items(self, base_dir: str | None = None) -> list[dict]:
        normalized_base = resolve_app_path(base_dir or self.config.get("md_save_path", ""))
        trash_dir = self.material_trash_dir(normalized_base)
        if not os.path.isdir(trash_dir):
            return []
        items = []
        for entry in sorted(os.scandir(trash_dir), key=lambda item: item.stat().st_mtime, reverse=True):
            if entry.name.startswith("."):
                continue
            is_dir = entry.is_dir()
            ext = os.path.splitext(entry.name)[1].lower()
            metadata = read_material_restore_metadata(entry.path)
            items.append(
                {
                    "id": entry.path,
                    "name": entry.name,
                    "path": entry.path,
                    "kind": "folder" if is_dir else material_file_kind_from_ext(ext),
                    "is_dir": is_dir,
                    "updated_at": os.path.getmtime(entry.path),
                    "original_parent": metadata.get("original_parent"),
                    "original_name": metadata.get("original_name"),
                }
            )
        return items

    def ensure_material_trash_entry_path(self, raw_path: str, base_dir: str) -> str:
        trash_dir = self.material_trash_dir(base_dir)
        normalized = os.path.abspath(raw_path or "")
        try:
            common = os.path.commonpath([normalized, trash_dir])
        except ValueError:
            common = ""
        if common != trash_dir:
            raise ValueError("휴지통 안의 항목만 삭제할 수 있습니다.")
        if os.path.normcase(os.path.commonpath([os.path.realpath(normalized), os.path.realpath(trash_dir)])) != os.path.normcase(os.path.realpath(trash_dir)):
            raise ValueError("휴지통 안의 항목만 삭제할 수 있습니다.")
        if normalized == trash_dir or os.path.dirname(normalized) != trash_dir or os.path.basename(normalized).startswith(".") or not os.path.exists(normalized):
            raise FileNotFoundError("휴지통 항목을 찾을 수 없습니다.")
        return normalized

    def remove_material_trash_path(self, target_path: str):
        with PRACTICE_SET_LOCK:
            def handle_remove_error(func, path, _exc_info):
                os.chmod(path, stat.S_IWRITE)
                func(path)

            try:
                if os.path.isdir(target_path):
                    shutil.rmtree(target_path, onerror=handle_remove_error)
                else:
                    os.remove(target_path)
            except PermissionError:
                if os.path.isdir(target_path):
                    for root, dirs, files in os.walk(target_path):
                        try:
                            os.chmod(root, stat.S_IWRITE)
                        except Exception:
                            pass
                        for name in [*dirs, *files]:
                            try:
                                os.chmod(os.path.join(root, name), stat.S_IWRITE)
                            except Exception:
                                pass
                    shutil.rmtree(target_path, onerror=handle_remove_error)
                else:
                    os.chmod(target_path, stat.S_IWRITE)
                    os.remove(target_path)

    def delete_material_trash_item(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        target_path = self.ensure_material_trash_entry_path(payload.get("path", "") or payload.get("trash_path", ""), base_dir)
        with PRACTICE_SET_LOCK:
            sidecar = practice_data_path(target_path) if target_path.lower().endswith(".md") else ""
            self.remove_material_trash_path(target_path)
            if sidecar and os.path.isfile(sidecar):
                self.remove_material_trash_path(sidecar)
            remove_material_restore_metadata(target_path)
        self.invalidate_lecture_materials_cache()
        return {"deleted": True, "path": target_path, "materials": self.lecture_materials()}

    def empty_material_trash(self):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        trash_dir = self.material_trash_dir(base_dir)
        deleted_count = 0
        if os.path.isdir(trash_dir):
            with PRACTICE_SET_LOCK:
                for entry in list(os.scandir(trash_dir)):
                    if entry.name.startswith("."):
                        continue
                    sidecar = practice_data_path(entry.path) if entry.name.lower().endswith(".md") else ""
                    self.remove_material_trash_path(entry.path)
                    if sidecar and os.path.isfile(sidecar):
                        self.remove_material_trash_path(sidecar)
                    remove_material_restore_metadata(entry.path)
                    deleted_count += 1
                for entry in list(os.scandir(trash_dir)):
                    if entry.name.startswith(".") and (entry.name.endswith(".practice.json") or entry.name.endswith(".restore.json")):
                        self.remove_material_trash_path(entry.path)
        self.invalidate_lecture_materials_cache()
        return {"deleted": True, "deleted_count": deleted_count, "materials": self.lecture_materials()}

    def restore_material_trash_item(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        trash_path = self.ensure_material_trash_entry_path(payload.get("path", "") or payload.get("trash_path", ""), base_dir)
        metadata = read_material_restore_metadata(trash_path)
        original_parent = str(metadata.get("original_parent") or "")
        original_name = str(metadata.get("original_name") or "")
        original_dir_available = False
        if original_parent and os.path.isdir(original_parent):
            try:
                target_dir = ensure_safe_material_dir(original_parent, base_dir)
                original_dir_available = True
            except (FileNotFoundError, ValueError):
                pass
        chosen_dir = str(payload.get("target_folder_path") or "").strip()
        if chosen_dir:
            target_dir = ensure_safe_material_dir(chosen_dir, base_dir)
        elif not original_dir_available:
            raise ValueError("복원할 폴더를 선택하세요.")
        if os.path.normcase(os.path.commonpath([os.path.realpath(target_dir), os.path.realpath(base_dir)])) != os.path.normcase(os.path.realpath(base_dir)):
            raise ValueError("학습 자료 저장 폴더 안으로만 복원할 수 있습니다.")
        target_name = str(payload.get("new_name") or original_name).strip()
        if not target_name:
            raise ValueError("복원할 이름을 입력하세요.")
        target_name = sanitize_material_child_name(target_name, allow_extension=True)
        if os.path.isdir(trash_path):
            target_name = canonical_data_folder_name(target_name)
        if os.path.isfile(trash_path) and os.path.splitext(target_name)[1].lower() != os.path.splitext(trash_path)[1].lower():
            raise ValueError("원래 파일 확장자로 복원해야 합니다.")
        target_path = os.path.abspath(os.path.join(target_dir, target_name))
        if os.path.exists(target_path):
            raise FileExistsError("복원 위치에 같은 이름의 자료가 이미 있습니다.")
        move_material_with_practice(trash_path, target_path)
        remove_material_restore_metadata(trash_path)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        return {"restored": True, "old_path": trash_path, "new_path": target_path, "materials": self.lecture_materials()}

    def unique_material_trash_path(self, source_path: str, base_dir: str) -> str:
        trash_dir = self.material_trash_dir(base_dir)
        os.makedirs(trash_dir, exist_ok=True)
        name = os.path.basename(source_path.rstrip("\\/"))
        root, ext = os.path.splitext(name)
        stamp = time.strftime("%Y%m%d_%H%M%S")
        candidate = os.path.join(trash_dir, f"{root}_{stamp}{ext}")
        index = 2
        while os.path.exists(candidate):
            candidate = os.path.join(trash_dir, f"{root}_{stamp}_{index}{ext}")
            index += 1
        return os.path.abspath(candidate)

    def _create_material_file_service(self):
        return self._ports.get_material_file_service()

    def _material_file_service(self):
        return self._ports.get_material_file_service()

    def read_material_file(self, file_path: str):
        return self._material_file_service().read(file_path)

    def save_material_file(self, payload: dict):
        return self._material_file_service().save(payload)

    def material_file_siblings(self, file_path: str) -> dict:
        raw_path = str(file_path or "").strip()
        if not raw_path:
            return {"previous": None, "next": None, "files": []}
        normalized = os.path.abspath(raw_path)
        parent_dir = os.path.dirname(normalized)
        if not os.path.isdir(parent_dir):
            return {"previous": None, "next": None, "files": []}

        ignored_names = {".git", "_images", "_resume", "_link", "_trash", "__pycache__"}
        files = []
        try:
            for item in os.scandir(parent_dir):
                if item.is_dir() or item.name in ignored_names or item.name.startswith("."):
                    continue
                ext = os.path.splitext(item.name)[1].lower()
                if ext in MATERIAL_FILE_EXTENSIONS:
                    files.append({
                        "path": item.path,
                        "fileName": item.name,
                        "title": title_from_report_path(item.path) if ext == ".md" else os.path.splitext(item.name)[0],
                        "kind": material_file_kind_from_ext(ext),
                    })
        except OSError:
            return {"previous": None, "next": None, "files": []}

        current_ext = os.path.splitext(normalized)[1].lower()
        same_ext_files = [f for f in files if os.path.splitext(f["fileName"])[1].lower() == current_ext]
        active_files = same_ext_files if len(same_ext_files) > 1 else files

        active_files.sort(key=lambda x: natural_sort_key(x["fileName"]))

        current_norm = os.path.normcase(normalized)
        current_idx = -1
        for idx, entry in enumerate(active_files):
            if os.path.normcase(os.path.abspath(entry["path"])) == current_norm:
                current_idx = idx
                break

        if current_idx < 0:
            return {"previous": None, "next": None, "files": active_files}

        return {
            "previous": active_files[current_idx - 1] if current_idx > 0 else None,
            "next": active_files[current_idx + 1] if current_idx < len(active_files) - 1 else None,
            "files": active_files,
        }

    def unlock_material_pdf(self, payload: dict):
        file_path = str(payload.get("path", "") or payload.get("file_path", "") or "").strip()
        password = str(payload.get("password", "") or "")
        normalized = os.path.abspath(file_path)
        if not os.path.isfile(normalized) or os.path.splitext(normalized)[1].lower() != ".pdf":
            raise FileNotFoundError("PDF 파일을 찾을 수 없습니다.")
        unlocked = pdf.viewer_support.unlock_pdf_file(normalized, password)
        self.refresh_reports_from_disk()
        return {"unlocked": unlocked, "file": self.read_material_file(normalized)}

    def rename_material_file(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        source_path = ensure_safe_material_path(payload.get("path", "") or payload.get("file_path", ""), base_dir)
        requested_name = str(payload.get("new_name", "") or "").strip()
        if not requested_name:
            raise ValueError("새 파일 이름을 입력하세요.")
        if os.path.basename(requested_name) != requested_name:
            raise ValueError("파일 이름만 입력할 수 있습니다.")

        source_dir = os.path.dirname(source_path)
        source_ext = os.path.splitext(source_path)[1]
        requested_root, requested_ext = os.path.splitext(requested_name)
        if not requested_ext:
            requested_name = f"{requested_root}{source_ext}"
        if os.path.splitext(requested_name)[1].lower() not in MATERIAL_FILE_EXTENSIONS:
            raise ValueError("지원하는 강의자료 확장자만 사용할 수 있습니다.")

        target_path = os.path.abspath(os.path.join(source_dir, requested_name))
        try:
            common = os.path.commonpath([target_path, source_dir])
        except ValueError:
            common = ""
        if common != source_dir:
            raise ValueError("현재 폴더 안에서만 이름을 변경할 수 있습니다.")
        if os.path.exists(target_path) and os.path.normcase(target_path) != os.path.normcase(source_path):
            raise FileExistsError("같은 이름의 파일이 이미 있습니다.")

        move_material_with_practice(source_path, target_path)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        return {"file": self.read_material_file(target_path), "old_path": source_path, "new_path": target_path}

    def delete_material_file(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        source_path = ensure_safe_material_path(payload.get("path", "") or payload.get("file_path", ""), base_dir)
        trash_path = self.unique_material_trash_path(source_path, base_dir)
        move_material_with_practice(source_path, trash_path)
        try:
            write_material_restore_metadata(trash_path, source_path)
        except Exception:
            move_material_with_practice(trash_path, source_path)
            raise
        title = title_from_report_path(source_path)
        with self.lock:
            self.processed_results.pop(title, None)
            self.session_report_titles.discard(title)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        return {"deleted": True, "path": source_path, "trash_path": trash_path, "materials": self.lecture_materials()}

    def create_material_file(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        parent_dir = ensure_safe_material_dir(payload.get("parent_path", ""), base_dir)
        file = create_material_file(base_dir, parent_dir, payload)
        self.invalidate_lecture_materials_cache()
        return {"file": file, "materials": self.lecture_materials()}

    def create_material_folder(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        parent_dir = ensure_safe_material_dir(payload.get("parent_path", "") or payload.get("path", ""), base_dir)
        validate_material_creation_parent(base_dir, parent_dir)
        raw_name = str(payload.get("name", "") or "").strip() or "새 폴더"
        folder_name = canonical_data_folder_name(sanitize_material_child_name(raw_name))
        target_dir = os.path.abspath(os.path.join(parent_dir, folder_name))
        try:
            common = os.path.commonpath([target_dir, base_dir])
        except ValueError:
            common = ""
        if common != os.path.abspath(base_dir):
            raise ValueError("Only folders inside the lecture material base folder can be created.")
        if bool(payload.get("unique", False)):
            base_name = folder_name
            index = 2
            while os.path.exists(target_dir):
                folder_name = f"{base_name} ({index})"
                target_dir = os.path.abspath(os.path.join(parent_dir, folder_name))
                index += 1
        if os.path.exists(target_dir):
            raise FileExistsError("A folder or file with the same name already exists.")
        os.makedirs(target_dir, exist_ok=False)
        self.invalidate_lecture_materials_cache()
        return {"folder": {"name": folder_name, "path": target_dir}, "materials": self.lecture_materials()}

    def rename_material_folder(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        source_dir = ensure_safe_material_dir(payload.get("path", "") or payload.get("folder_path", ""), base_dir, allow_base=False)
        requested_name = canonical_data_folder_name(sanitize_material_child_name(payload.get("new_name", "")))
        target_dir = os.path.abspath(os.path.join(os.path.dirname(source_dir), requested_name))
        try:
            common = os.path.commonpath([target_dir, os.path.abspath(base_dir)])
        except ValueError:
            common = ""
        if common != os.path.abspath(base_dir):
            raise ValueError("Only folders inside the lecture material base folder can be renamed.")
        if os.path.exists(target_dir) and os.path.normcase(target_dir) != os.path.normcase(source_dir):
            raise FileExistsError("A folder or file with the same name already exists.")
        if os.path.normcase(target_dir) != os.path.normcase(source_dir):
            with PRACTICE_SET_LOCK:
                os.replace(source_dir, target_dir)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        return {"folder": {"name": requested_name, "path": target_dir}, "old_path": source_dir, "new_path": target_dir, "materials": self.lecture_materials()}

    def delete_material_folder(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        source_dir = ensure_safe_material_dir(payload.get("path", "") or payload.get("folder_path", ""), base_dir, allow_base=False)
        trash_path = self.unique_material_trash_path(source_dir, base_dir)
        move_material_to_trash(source_dir, trash_path)
        try:
            write_material_restore_metadata(trash_path, source_dir)
        except Exception:
            move_material_to_trash(trash_path, source_dir)
            raise
        normalized_source = os.path.normcase(os.path.abspath(source_dir))
        with self.lock:
            for title, data in list(self.processed_results.items()):
                file_path = os.path.normcase(os.path.abspath(str(data.get("file_path", "") or "")))
                if file_path == normalized_source or file_path.startswith(normalized_source + os.path.sep):
                    self.processed_results.pop(title, None)
                    self.session_report_titles.discard(title)
        # Deletion already removed the affected in-memory reports. Re-reading every
        # report and resume checkpoint makes a single folder removal wait on
        # unrelated (potentially very large) study materials.
        self.invalidate_lecture_materials_cache()
        return {"deleted": True, "path": source_dir, "trash_path": trash_path, "materials": self.lecture_materials()}

    def transfer_material_entries(self, payload: dict):
        result = transfer_entries(payload, resolve_app_path(self.config.get("md_save_path", "")),
                                  ensure_safe_material_path, ensure_safe_material_dir, move_material_with_practice)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        return {**result, "materials": self.lecture_materials()}

    def move_material_file(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        source_path = ensure_safe_material_path(payload.get("source_path", "") or payload.get("path", ""), base_dir)
        target_dir = ensure_safe_material_dir(payload.get("target_folder_path", "") or payload.get("target_path", ""), base_dir)
        target_path = os.path.abspath(os.path.join(target_dir, os.path.basename(source_path)))
        if os.path.normcase(os.path.dirname(source_path)) == os.path.normcase(target_dir):
            return {"moved": False, "old_path": source_path, "new_path": source_path, "materials": self.lecture_materials()}
        if os.path.exists(target_path):
            raise FileExistsError("A file with the same name already exists in the target folder.")
        with PRACTICE_SET_LOCK:
            image_move = move_material_with_images(source_path, target_path, base_dir, move_material_with_practice)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        return {
            "moved": True,
            "old_path": source_path,
            "new_path": target_path,
            **image_move,
            "materials": self.lecture_materials(),
        }

    def move_material_entry(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        raw_source = str(payload.get("source_path", "") or payload.get("path", "") or "").strip()
        if not raw_source:
            raise ValueError("Source path is required.")
        source_path = os.path.abspath(raw_source)
        base_abs = os.path.abspath(base_dir)
        try:
            source_common = os.path.commonpath([source_path, base_abs])
        except ValueError:
            source_common = ""
        if source_common != base_abs or not os.path.exists(source_path):
            raise FileNotFoundError("Lecture material entry was not found.")
        if os.path.normcase(source_path) == os.path.normcase(base_abs):
            raise ValueError("The base lecture material folder cannot be moved.")
        if os.path.isfile(source_path):
            return self.move_material_file(payload)

        target_dir = ensure_safe_material_dir(payload.get("target_folder_path", "") or payload.get("target_path", ""), base_dir)
        target_path = os.path.abspath(os.path.join(target_dir, os.path.basename(source_path)))
        if os.path.normcase(os.path.dirname(source_path)) == os.path.normcase(target_dir):
            return {"moved": False, "old_path": source_path, "new_path": source_path, "materials": self.lecture_materials()}
        try:
            target_common = os.path.commonpath([target_dir, source_path])
        except ValueError:
            target_common = ""
        if target_common == source_path:
            raise ValueError("A folder cannot be moved inside itself.")
        if os.path.exists(target_path):
            raise FileExistsError("A folder or file with the same name already exists in the target folder.")
        with PRACTICE_SET_LOCK:
            image_move = move_material_with_images(source_path, target_path, base_dir, move_material_with_practice)
        self.refresh_reports_from_disk()
        self.refresh_retry_candidates_from_disk()
        return {
            "moved": True,
            "old_path": source_path,
            "new_path": target_path,
            **image_move,
            "materials": self.lecture_materials(),
        }
