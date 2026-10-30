"""Read only the entries immediately inside the visible material directory."""

from __future__ import annotations

import os
from collections.abc import Callable, Collection
from system_storage import visible_data_folder


def can_descend_material_directory(base_dir: str, directory: str, ancestors: Collection[str] = ()) -> bool:
    base = os.path.normcase(os.path.realpath(base_dir))
    target = os.path.normcase(os.path.realpath(directory))
    try:
        return os.path.commonpath([base, target]) == base and target not in ancestors
    except ValueError:
        return False


def list_material_directory(
    base_dir: str,
    directory: str,
    *,
    extensions: Collection[str],
    visible_folder: Callable[[str], bool],
    file_kind: Callable[[str], str],
    sort_key: Callable[[str], list],
) -> dict:
    if not base_dir or not os.path.isdir(base_dir):
        return {"base_path": base_dir, "directory_path": base_dir, "shallow": True, "folders": []}
    base = os.path.abspath(base_dir)
    target = os.path.abspath(directory) if directory else base
    try:
        inside = os.path.normcase(os.path.commonpath([base, target])) == os.path.normcase(base)
        real_base = os.path.realpath(base)
        inside = inside and os.path.normcase(os.path.commonpath([real_base, os.path.realpath(target)])) == os.path.normcase(real_base)
    except ValueError:
        inside = False
    if not inside:
        raise ValueError("Only folders inside the lecture material base folder can be listed.")
    relative = os.path.relpath(target, base)
    if relative != "." and any(not visible_folder(name) for name in relative.split(os.sep)):
        raise ValueError("This material folder is hidden.")
    if not os.path.isdir(target):
        raise FileNotFoundError("Lecture material folder was not found.")

    def folder_node(path: str, *, loaded: bool) -> dict:
        return {"name": os.path.basename(path), "path": path, "updated_at": os.path.getmtime(path),
                "files": [], "weeks": [], "children": [], "report_count": 0,
                "direct_report_count": 0, "children_loaded": loaded}

    node = folder_node(target, loaded=True)
    # Never descend into child directories, inspect file contents/sidecars, or
    # enqueue indexing/OCR work on the path that supplies the visible rows.
    with os.scandir(target) as entries:
        for entry in entries:
            try:
                if entry.is_dir():
                    if visible_folder(entry.name) and visible_data_folder(entry.path):
                        node["children"].append(folder_node(entry.path, loaded=False))
                    continue
                extension = os.path.splitext(entry.name)[1].lower()
                if entry.name.startswith(".") or not entry.is_file():
                    continue
                node["files"].append({"id": entry.path, "title": os.path.splitext(entry.name)[0],
                                      "file_name": entry.name, "file_path": entry.path,
                                      "kind": file_kind(extension), "updated_at": entry.stat().st_mtime})
            except FileNotFoundError:
                # A concurrent move/delete must not discard the remaining rows.
                continue
    node["children"].sort(key=lambda item: sort_key(item["name"]))
    node["files"].sort(key=lambda item: (item["kind"], sort_key(item["title"])))
    if os.path.normcase(target) == os.path.normcase(base):
        folders = node["children"]
        if node["files"]:
            folders = [*folders, {**node, "name": "분류되지 않은 파일", "children": [], "is_virtual": True}]
    else:
        folders = [node]
    return {"base_path": base_dir, "directory_path": target, "shallow": True, "folders": folders}
