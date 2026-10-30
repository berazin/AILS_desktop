"""MaterialCatalog: one feature workflow and its explicitly supplied collaborators."""
from __future__ import annotations
from collections.abc import Mapping
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from documents.material_catalog_rules import LECTURE_REPORT_RE
from documents.material_catalog_rules import NEW_LECTURE_REPORT_RE
from documents.material_catalog_rules import WEEK_DIR_RE
from documents.material_catalog_rules import is_visible_lecture_folder
from documents.material_catalog_rules import natural_sort_key
from documents.material_directory_listing import can_descend_material_directory
from documents.material_directory_listing import list_material_directory
from documents.material_file_policy import MATERIAL_FILE_EXTENSIONS
from documents.material_file_policy import PRESENTATION_EXTENSIONS
from documents.material_file_policy import material_file_kind_from_ext
from documents.material_practice_service import practice_set_summary
from documents.material_sources import title_from_report_path
from documents.presentation_service import presentation_pdf_cache_path
from system_storage import visible_data_folder
import os
import re
import threading
import time


@dataclass(frozen=True)
class MaterialCatalogPorts:
    append_idle_log: Callable[..., Any]
    current_semester_folder_name: Callable[..., Any]
    material_trash_items: Callable[..., Any]
    get_background_work: Callable[..., Any]
    get_config: Callable[..., Any]


class MaterialCatalog:
    def __init__(self, ports: MaterialCatalogPorts):
        self._ports = ports
        self.append_idle_log = ports.append_idle_log
        self.current_semester_folder_name = ports.current_semester_folder_name
        self.material_trash_items = ports.material_trash_items
        self.lecture_materials_cache_lock = threading.Lock()
        self._lecture_materials_cache = None
        self._lecture_materials_cache_key = ""
        self._lecture_materials_cache_at = 0.0

    @property
    def background_work(self):
        return self._ports.get_background_work()

    @property
    def config(self):
        return self._ports.get_config()

    def migrate_material_system_storage(self):
        from documents.system_storage_migration import migrate_system_storage
        base = str(self.config.get("md_save_path", "") or "").strip()
        if base:
            result = migrate_system_storage(base, allow_partial=True)
            if result["renamed"] or result["updated_reports"]:
                self.invalidate_lecture_materials_cache()
                self.append_idle_log(f"System storage migration: {result['renamed']} directories, {result['updated_reports']} reports")
            if result.get("deferred"):
                self.append_idle_log(f"System storage migration preserved {len(result['deferred'])} conflicting entries for review")

    def lecture_material_directory(self, directory: str = "", *, include_problem_progress: bool = False):
        result = list_material_directory(
            str(self.config.get("md_save_path", "") or "").strip(), directory,
            extensions=MATERIAL_FILE_EXTENSIONS, visible_folder=is_visible_lecture_folder,
            file_kind=material_file_kind_from_ext, sort_key=natural_sort_key,
        )
        if include_problem_progress:
            from documents.material_problem_progress import annotate_material_problem_progress
            return annotate_material_problem_progress(result)
        return result

    def invalidate_lecture_materials_cache(self):
        with self.lecture_materials_cache_lock:
            self._lecture_materials_cache = None
            self._lecture_materials_cache_key = ""
            self._lecture_materials_cache_at = 0.0

    def lecture_materials(self):
        base_dir = str(self.config.get("md_save_path", "") or "").strip()
        if not base_dir or not os.path.isdir(base_dir):
            return {"base_path": base_dir, "folders": []}
        current_semester_folder = self.current_semester_folder_name()
        cache_key = f"{os.path.abspath(base_dir)}|{current_semester_folder}"
        now = time.monotonic()
        with self.lecture_materials_cache_lock:
            if (
                self._lecture_materials_cache is not None
                and self._lecture_materials_cache_key == cache_key
                and now - self._lecture_materials_cache_at <= 2.0
            ):
                return self._lecture_materials_cache

        ignored_dirs = set()

        def build_folder_node(folder_path: str, ancestors: frozenset[str] = frozenset()):
            weeks: dict[int, dict] = {}
            files = []
            children = []
            if not can_descend_material_directory(base_dir, folder_path, ancestors):
                return {"name": os.path.basename(folder_path), "path": folder_path, "files": [], "weeks": [],
                        "children": [], "report_count": 0, "direct_report_count": 0, "children_loaded": False}
            ancestors = ancestors | {os.path.normcase(os.path.realpath(folder_path))}

            for item in sorted(os.scandir(folder_path), key=lambda entry: (not entry.is_dir(), natural_sort_key(entry.name))):
                if item.is_dir():
                    if item.name in ignored_dirs or not is_visible_lecture_folder(item.name) or not visible_data_folder(item.path):
                        continue

                    # 주차 폴더인지 확인 (예: 4주차)
                    week_dir_match = WEEK_DIR_RE.match(item.name)
                    if week_dir_match:
                        # 주차 폴더는 children(폴더 트리)에 추가하지 않고, 내부 정리본을 직접 탐색
                        for sub_item in sorted(os.scandir(item.path), key=lambda entry: natural_sort_key(entry.name)):
                            if sub_item.is_dir():
                                continue
                            sub_file_name = sub_item.name
                            sub_ext = os.path.splitext(sub_file_name)[1].lower()
                            if sub_file_name.startswith(".") or not sub_item.is_file():
                                continue

                            sub_match = NEW_LECTURE_REPORT_RE.match(sub_file_name)
                            if sub_ext == ".md" and sub_match:
                                week = int(sub_match.group("week"))
                                sequence = int(sub_match.group("sequence"))
                                week_item = weeks.setdefault(week, {"week": week, "reports": []})
                                folder_display_name = os.path.basename(folder_path)
                                report_title = f"{folder_display_name} {sequence}번 정리본"
                                week_item["reports"].append(
                                    {
                                        "id": report_title,
                                        "title": report_title,
                                        "file_name": sub_file_name,
                                        "file_path": sub_item.path,
                                        "sequence": sequence,
                                        "updated_at": os.path.getmtime(sub_item.path),
                                    }
                                )
                            else:
                                files.append(
                                    {
                                        "id": sub_item.path,
                                        "title": os.path.splitext(sub_file_name)[0],
                                        "file_name": sub_file_name,
                                        "file_path": sub_item.path,
                                        "kind": material_file_kind_from_ext(sub_ext),
                                        "updated_at": os.path.getmtime(sub_item.path),
                                    }
                                )
                        continue

                    children.append(build_folder_node(item.path, ancestors))
                    continue

                file_name = item.name
                ext = os.path.splitext(file_name)[1].lower()
                if file_name.startswith(".") or not item.is_file():
                    continue

                match = LECTURE_REPORT_RE.match(file_name)
                new_match = NEW_LECTURE_REPORT_RE.match(file_name)
                if ext == ".md" and (match or new_match):
                    active_match = match if match else new_match
                    week = int(active_match.group("week"))
                    sequence = int(active_match.group("sequence"))
                    week_item = weeks.setdefault(week, {"week": week, "reports": []})
                    if new_match:
                        folder_display_name = os.path.basename(folder_path)
                        report_title = f"{folder_display_name} {sequence}번 정리본"
                    else:
                        report_title = title_from_report_path(item.path)
                    week_item["reports"].append(
                        {
                            "id": report_title,
                            "title": report_title,
                            "file_name": file_name,
                            "file_path": item.path,
                            "sequence": sequence,
                            "updated_at": os.path.getmtime(item.path),
                        }
                    )
                    continue

                files.append(
                    {
                        "id": item.path,
                        "title": os.path.splitext(file_name)[0],
                        "file_name": file_name,
                        "file_path": item.path,
                        "kind": material_file_kind_from_ext(ext),
                        "updated_at": os.path.getmtime(item.path),
                    }
                )

            week_list = sorted(weeks.values(), key=lambda item: item["week"])
            for week_item in week_list:
                week_item["reports"].sort(key=lambda item: (item["sequence"], natural_sort_key(item["title"])))
            files.sort(key=lambda item: (item["kind"], natural_sort_key(item["title"])))

            direct_report_count = sum(len(week["reports"]) for week in week_list)
            child_report_count = sum(int(child.get("report_count", 0) or 0) for child in children)
            return {
                "name": os.path.basename(folder_path),
                "path": folder_path,
                "updated_at": os.path.getmtime(folder_path),
                "weeks": week_list,
                "files": files,
                "children": children,
                "report_count": direct_report_count + child_report_count,
                "direct_report_count": direct_report_count,
            }

        def semester_sort_info(name: str):
            match = re.fullmatch(r"\s*(\d+)학년\s*(\d+)학기\s*", str(name or ""))
            if not match:
                return None
            return int(match.group(1)), int(match.group(2))

        def folder_sort_key(folder: dict):
            name = str(folder.get("name", "") or "")
            if name == current_semester_folder:
                return (0, 0, 0, "")
            semester_info = semester_sort_info(name)
            if semester_info:
                return (2, semester_info[0], semester_info[1], name.lower())
            return (1, 0, 0, name.lower())

        # base_dir 바로 아래에 있는 직속 파일들 스캔
        root_weeks = {}
        root_files = []

        for item in sorted(os.scandir(base_dir), key=lambda entry: (not entry.is_dir(), natural_sort_key(entry.name))):
            if item.is_dir():
                continue

            file_name = item.name
            ext = os.path.splitext(file_name)[1].lower()
            if file_name.startswith(".") or not item.is_file():
                continue

            match = LECTURE_REPORT_RE.match(file_name)
            new_match = NEW_LECTURE_REPORT_RE.match(file_name)
            if ext == ".md" and (match or new_match):
                active_match = match if match else new_match
                week = int(active_match.group("week"))
                sequence = int(active_match.group("sequence"))
                week_item = root_weeks.setdefault(week, {"week": week, "reports": []})
                week_item["reports"].append(
                    {
                        "id": title_from_report_path(item.path),
                        "title": title_from_report_path(item.path),
                        "file_name": file_name,
                        "file_path": item.path,
                        "sequence": sequence,
                        "updated_at": os.path.getmtime(item.path),
                    }
                )
                continue

            root_files.append(
                {
                    "id": item.path,
                    "title": os.path.splitext(file_name)[0],
                    "file_name": file_name,
                    "file_path": item.path,
                    "kind": material_file_kind_from_ext(ext),
                    "updated_at": os.path.getmtime(item.path),
                }
            )

        root_week_list = sorted(root_weeks.values(), key=lambda item: item["week"])
        for week_item in root_week_list:
            week_item["reports"].sort(key=lambda item: (item["sequence"], natural_sort_key(item["title"])))
        root_files.sort(key=lambda item: (item["kind"], natural_sort_key(item["title"])))

        root_report_count = sum(len(week["reports"]) for week in root_week_list)

        folders = []
        for entry in sorted(os.scandir(base_dir), key=lambda item: natural_sort_key(item.name)):
            if not entry.is_dir() or not is_visible_lecture_folder(entry.name) or not visible_data_folder(entry.path):
                continue
            folders.append(build_folder_node(entry.path, frozenset({os.path.normcase(os.path.realpath(base_dir))})))

        # 직속 파일이 있는 경우에만 가상 폴더 노드로 추가
        if root_files or root_week_list:
            folders.append({
                "name": "분류되지 않은 파일",
                "path": base_dir,
                "updated_at": os.path.getmtime(base_dir),
                "weeks": root_week_list,
                "files": root_files,
                "children": [],
                "report_count": root_report_count + len(root_files),
                "direct_report_count": root_report_count,
                "is_virtual": True,
            })

        def folder_sort_key_with_virtual(folder: dict):
            name = str(folder.get("name", "") or "")
            if name == "분류되지 않은 파일":
                return (-1, 0, 0, "")
            return folder_sort_key(folder)

        folders.sort(key=folder_sort_key_with_virtual)

        def annotate_practice(folder: dict) -> None:
            for file_item in folder.get("files", []):
                if file_item.get("kind") == "md":
                    summary = practice_set_summary(file_item["file_path"])
                    if summary is not None:
                        file_item["practice_set"] = summary
            for week in folder.get("weeks", []):
                for report in week.get("reports", []):
                    summary = practice_set_summary(report["file_path"])
                    if summary is not None:
                        report["practice_set"] = summary
            for child in folder.get("children", []):
                annotate_practice(child)

        for folder in folders:
            annotate_practice(folder)

        result = {
            "base_path": base_dir,
            "folders": folders,
            "trash": self.material_trash_items(base_dir),
            "current_semester_folder": current_semester_folder,
        }
        embedding_paths: list[str] = []
        pdf_paths: list[str] = []
        presentation_paths: list[str] = []
        presentation_pdf_paths: list[str] = []

        def collect_indexable_document(path: str) -> None:
            """자료 파일의 임베딩 대상 경로를 수집한다. 지원 형식이 아니면 변환된 PDF(예: 슬라이드)가 있을 때 그것을 사용한다."""
            normalized = str(path or "")
            ext = os.path.splitext(normalized)[1].casefold()
            from_presentation = False
            if ext not in {".pdf", ".md", ".txt", ".ipynb"}:
                if ext not in PRESENTATION_EXTENSIONS:
                    return
                presentation_paths.append(normalized)
                try:
                    rendered_pdf = presentation_pdf_cache_path(normalized)
                except Exception:
                    return
                if not os.path.isfile(rendered_pdf):
                    return
                normalized = rendered_pdf
                from_presentation = True
            embedding_paths.append(normalized)
            if os.path.splitext(normalized)[1].casefold() == ".pdf":
                pdf_paths.append(normalized)
                if from_presentation:
                    presentation_pdf_paths.append(normalized)

        def collect_folder_documents(folder: Mapping) -> None:
            for file_item in folder.get("files", []):
                collect_indexable_document(str(file_item.get("file_path") or ""))
            for week in folder.get("weeks", []):
                for report in week.get("reports", []):
                    collect_indexable_document(str(report.get("file_path") or ""))
            for child in folder.get("children", []):
                collect_folder_documents(child)

        for folder in folders:
            collect_folder_documents(folder)
        # 백그라운드 문서 준비(임베딩·OCR) 설정이 켜져 있으면 새로고침 결과를
        # 원장에 반영해 완료되지 않은 문서를 이어서 처리한다.
        background_work = getattr(self, "background_work", None)
        if background_work is not None:
            try:
                background_work.note_material_paths(
                    embedding_paths=embedding_paths,
                    pdf_paths=pdf_paths,
                    presentation_paths=presentation_paths,
                    presentation_pdf_paths=presentation_pdf_paths,
                )
            except Exception:
                pass
        with self.lecture_materials_cache_lock:
            self._lecture_materials_cache = result
            self._lecture_materials_cache_key = cache_key
            self._lecture_materials_cache_at = time.monotonic()
        return result
