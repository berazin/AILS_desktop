"""Create temporary code workspaces in the user's Documents folder."""

import ctypes
from datetime import datetime
import os
from pathlib import Path


def documents_directory():
    if os.name != "nt":
        return Path.home() / "Documents"
    # CSIDL_PERSONAL follows Windows' relocated Documents folder (including OneDrive).
    buffer = ctypes.create_unicode_buffer(32768)
    result = ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buffer)
    if result != 0 or not buffer.value:
        raise OSError("문서 폴더 위치를 확인할 수 없습니다.")
    return Path(buffer.value)


def workspace_directory():
    return documents_directory() / "AILS" / "Workspaces"


def create_workspace_folder():
    parent = workspace_directory()
    parent.mkdir(parents=True, exist_ok=True)
    name = datetime.now().strftime("%y%m%d%H%M")
    suffix = 1
    while True:
        folder = parent / (name if suffix == 1 else f"{name}-{suffix}")
        try:
            folder.mkdir()
            return folder
        except FileExistsError:
            suffix += 1
