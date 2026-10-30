"""File moves and restoration metadata."""
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.material_practice_service import practice_data_path
import errno
import json
import os
import shutil
import stat
import time

def move_material_to_trash(source_path: str, trash_path: str) -> None:
    """Move material despite brief Windows/cloud-sync access locks."""
    with PRACTICE_SET_LOCK:
        for attempt in range(12):
            try:
                try:
                    os.rename(source_path, trash_path)
                except OSError as error:
                    # shutil.move also copies on access-denied, including large
                    # folders. Only a genuine cross-device move needs copying.
                    if error.errno != errno.EXDEV:
                        raise
                    shutil.move(source_path, trash_path)
                return
            except PermissionError:
                try:
                    os.chmod(source_path, stat.S_IWRITE)
                except OSError:
                    pass
                if attempt >= 11:
                    raise
                time.sleep(min(0.75, 0.05 * (attempt + 1)))


def move_material_with_practice(source_path: str, target_path: str) -> None:
    """Keep a generated MD and its sidecar together on file moves."""
    with PRACTICE_SET_LOCK:
        if os.path.normcase(os.path.abspath(source_path)) == os.path.normcase(os.path.abspath(target_path)):
            return
        source_data = practice_data_path(source_path) if source_path.lower().endswith(".md") and os.path.isfile(source_path) else ""
        target_data = practice_data_path(target_path) if source_data else ""
        if target_data and os.path.exists(target_data):
            raise FileExistsError("대상 위치에 연습문제 데이터가 이미 있습니다.")
        if os.path.exists(target_path):
            raise FileExistsError("대상 위치에 같은 이름의 자료가 이미 있습니다.")
        move_material_to_trash(source_path, target_path)
        if source_data and os.path.isfile(source_data):
            try:
                move_material_to_trash(source_data, target_data)
            except Exception:
                move_material_to_trash(target_path, source_path)
                raise


def material_restore_metadata_path(trash_path: str) -> str:
    return os.path.join(os.path.dirname(trash_path), f".{os.path.basename(trash_path)}.restore.json")


def read_material_restore_metadata(trash_path: str) -> dict:
    try:
        with open(material_restore_metadata_path(trash_path), "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_material_restore_metadata(trash_path: str, source_path: str) -> None:
    metadata_path = material_restore_metadata_path(trash_path)
    temp_path = f"{metadata_path}.tmp"
    data = {"original_parent": os.path.dirname(source_path), "original_name": os.path.basename(source_path)}
    try:
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False)
        os.replace(temp_path, metadata_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def remove_material_restore_metadata(trash_path: str) -> None:
    try:
        os.remove(material_restore_metadata_path(trash_path))
    except FileNotFoundError:
        pass
