"""Create empty workspace files without replacing an existing entry."""
from __future__ import annotations

import os

from documents.material_practice_service import sanitize_material_child_name


def validate_material_creation_parent(base_dir: str, parent_dir: str) -> None:
    base = os.path.realpath(base_dir)
    parent = os.path.realpath(parent_dir)
    try:
        inside = os.path.commonpath([os.path.normcase(base), os.path.normcase(parent)]) == os.path.normcase(base)
    except ValueError:
        inside = False
    if not inside:
        raise ValueError("작업공간 안에서만 파일을 만들 수 있습니다.")


def create_material_file(base_dir: str, parent_dir: str, payload: dict) -> dict:
    validate_material_creation_parent(base_dir, parent_dir)
    kind = str(payload.get("kind", "md"))
    defaults = {"md": "새 마크다운.md", "txt": "새 텍스트 문서.txt"}
    if kind not in defaults:
        raise ValueError("마크다운 또는 텍스트 파일만 만들 수 있습니다.")
    name = sanitize_material_child_name(payload.get("name") or defaults[kind], allow_extension=True)
    stem, extension = os.path.splitext(name)
    if not extension:
        name = f"{name}.{kind}"
        stem = os.path.splitext(name)[0]
    elif extension.lower() != f".{kind}":
        raise ValueError("선택한 파일 유형과 확장자가 일치해야 합니다.")
    candidate = name
    index = 2
    while True:
        target = os.path.join(parent_dir, candidate)
        try:
            # Exclusive creation also protects against simultaneous requests.
            with open(target, "x", encoding="utf-8"):
                pass
            return {"name": candidate, "path": target, "kind": kind}
        except (FileExistsError, IsADirectoryError, PermissionError):
            # Windows reports an existing directory as PermissionError.
            if not os.path.lexists(target):
                raise
            if not payload.get("unique", True):
                raise FileExistsError("같은 이름의 파일 또는 폴더가 이미 있습니다.") from None
            candidate = f"{stem} ({index}).{kind}"
            index += 1
