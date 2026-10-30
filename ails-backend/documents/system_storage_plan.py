"""Read-only planning confined to one AILS-managed data root."""
import os
from pathlib import Path

from system_storage import DATA_INTERNAL_DIRS, canonical_data_folder_name, canonical_system_name, legacy_code_folder


def mapped_path(root, moves):
    names = {Path(old): Path(new).name for old, new in moves}
    cache = {root: root}

    def mapped(path):
        path = Path(path)
        if not path.is_relative_to(root):
            return path
        if path in cache:
            return cache[path]
        result = mapped(path.parent) / names.get(path, path.name)
        cache[path] = result
        return result
    return mapped


def plan_system_storage(root, *, excluded_paths=()):
    root = Path(root).resolve()
    exclusions = [Path(path).resolve() for path in excluded_paths]
    moves, reports, records, files, directories, skipped, blocked, opaque = [], [], [], [], [], [], [], []
    if root.is_dir():
        for directory, dirs, names in os.walk(root, followlinks=False):
            parent = Path(directory)
            retained = []
            for name in sorted(dirs):
                path = parent / name
                source_project = ((path / "pyvenv.cfg").is_file() or (path / ".git").exists()
                    or (path / ".ails-code-project").is_file()
                    or (path / "ProjectSettings" / "ProjectVersion.txt").is_file())
                if source_project or name.casefold() in DATA_INTERNAL_DIRS or path == root / ".ails" / "system-storage-migrations":
                    skipped.append(str(path))
                    if path != root / ".ails" / "system-storage-migrations":
                        opaque.append(path)
                    continue
                if any(path == excluded or path.is_relative_to(excluded) for excluded in exclusions):
                    skipped.append(str(path))
                    continue
                if path.is_symlink() or path.is_junction() or not path.resolve().is_relative_to(root):
                    skipped.append(str(path))
                    blocked.append({"path": str(path), "reason": "linked_directory"})
                    continue
                retained.append(name)
                directories.append(path)
                try:
                    target_name = canonical_data_folder_name(name)
                    if target_name == name and legacy_code_folder(path, recursive=True):
                        target_name = canonical_system_name(name)
                    if target_name == name and name.endswith("_images") and parent.name in {"_images", ".images"}:
                        target_name = canonical_system_name(name)
                except ValueError as error:
                    blocked.append({"path": str(path), "reason": str(error)})
                    continue
                if target_name != name:
                    if any(excluded.is_relative_to(path) for excluded in exclusions):
                        blocked.append({"path": str(path), "reason": "contains_excluded_data"})
                    else:
                        moves.append((path, path.with_name(target_name)))
            dirs[:] = retained
            for name in names:
                path = parent / name
                if path.is_symlink():
                    blocked.append({"path": str(path), "reason": "linked_file"})
                    continue
                files.append(path)
                if name.lower().endswith(".md"):
                    reports.append(path)
                elif name.lower().endswith(".json"):
                    records.append(path)
    # A storage parent's rename can carry a source project intact. Do not
    # rename its internal directories or rewrite its files, but preflight every
    # destination to prevent a late merge collision from aborting other groups.
    for boundary in opaque:
        if not any(boundary.is_relative_to(old) for old, _new in moves):
            continue
        directories.append(boundary)
        for parent, dirs, names in os.walk(boundary, followlinks=False):
            retained = []
            for name in dirs:
                path = Path(parent, name)
                if path.is_symlink() or path.is_junction():
                    blocked.append({"path": str(path), "reason": "linked_source_entry"})
                else:
                    retained.append(name)
                    directories.append(path)
            dirs[:] = retained
            for name in names:
                path = Path(parent, name)
                if path.is_symlink():
                    blocked.append({"path": str(path), "reason": "linked_source_entry"})
                else:
                    files.append(path)
    mapped = mapped_path(root, moves)
    collisions = []
    destinations = {}
    link_cache = {root: False}

    def linked_target(path):
        if path not in link_cache:
            link_cache[path] = path.is_symlink() or path.is_junction() or linked_target(path.parent)
        return link_cache[path]

    for path in [*directories, *files]:
        destination = mapped(path)
        if destination == path:
            continue
        key = os.path.normcase(str(destination))
        previous = destinations.get(key)
        if previous is not None and (not previous.is_dir() or not path.is_dir()):
            collisions.append({"source": str(path), "other_source": str(previous), "target": str(destination), "reason": "same_planned_target"})
        destinations[key] = path
        if linked_target(destination):
            collisions.append({"source": str(path), "target": str(destination), "reason": "linked_target"})
            continue
        if destination == path or not destination.exists():
            continue
        if path.is_dir() and destination.is_dir():
            continue
        collisions.append({"source": str(path), "target": str(destination), "reason": "existing_target"})
    # A skipped dependency keeps its name; a link inside a moved directory
    # blocks that move so no linked content is moved or traversed.
    blocked = [item for item in blocked if any(Path(item["path"]).is_relative_to(old) or Path(item["path"]) == old for old, _ in moves)
               or item["reason"] in {"contains_excluded_data"} or item["reason"].startswith("System folder")]
    ordered = sorted(moves, key=lambda pair: (-len(pair[0].parts), str(pair[0]).casefold()))
    return {"root": str(root), "moves": [(str(old), str(new)) for old, new in ordered],
            "mapped_moves": [(str(old), str(mapped(old))) for old, _ in ordered],
            "reports": [str(path) for path in reports], "records": [str(path) for path in records],
            "collisions": collisions, "blocked": blocked, "skipped": skipped}


def nonconflicting_plan(plan):
    """Hold the complete storage group containing a conflict, never split it."""
    moves = [(Path(old), Path(new)) for old, new in plan["moves"]]
    roots = [old for old, _ in moves if not any(old != parent and old.is_relative_to(parent) for parent, _ in moves)]
    unsafe = set()
    for item in [*plan["collisions"], *plan["blocked"]]:
        for field in ("source", "other_source", "path"):
            if field not in item:
                continue
            path = Path(item[field])
            unsafe.update(root for root in roots if path == root or path.is_relative_to(root) or root.is_relative_to(path))
    safe_moves = [(str(old), str(new)) for old, new in moves if not any(old == root or old.is_relative_to(root) for root in unsafe)]
    mapped = mapped_path(Path(plan["root"]), safe_moves)
    return {**plan, "moves": safe_moves, "mapped_moves": [(old, str(mapped(old))) for old, _new in safe_moves],
            "deferred": [*plan["collisions"], *plan["blocked"]], "collisions": [], "blocked": []}
