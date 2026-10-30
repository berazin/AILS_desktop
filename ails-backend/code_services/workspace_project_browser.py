"""Read project folders and their registered document links without opening them."""

from pathlib import Path

from .workspace_creation import workspace_directory
from .workspace_store import WorkspaceError, _identity


def browse_workspace_projects(store):
    root = workspace_directory()
    if not root.exists():
        return {"root": str(root), "projects": []}
    if not root.is_dir():
        raise WorkspaceError("작업공간 경로가 폴더가 아닙니다.")
    resolved_root = root.resolve()
    registered = {item["id"]: item for item in store.list()}
    projects = []
    for folder in root.iterdir():
        if folder.is_symlink() or not folder.is_dir() or folder.resolve().parent != resolved_root:
            continue
        identity, error = "", ""
        try:
            identity = _identity(folder) or ""
        except (OSError, WorkspaceError) as reason:
            error = str(reason)
        workspace = registered.get(identity)
        if workspace and Path(workspace["path"]).resolve() != folder.resolve() and workspace["available"]:
            error = "같은 UUID를 가진 원본 작업 폴더가 있습니다."
            workspace = None
        projects.append({
            "id": identity, "name": folder.name, "path": str(folder),
            "available": not bool(error), "error": error,
            "opened": workspace["opened"] if workspace else 0,
            "modified": folder.stat().st_mtime,
            "pdfs": workspace["pdfs"] if workspace else [],
        })
    return {"root": str(root), "projects": sorted(projects, key=lambda item: item["name"].casefold())}
