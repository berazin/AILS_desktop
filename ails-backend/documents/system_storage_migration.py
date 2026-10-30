"""Migrate folders in an AILS data root using the existing recoverable journal."""
import os
from pathlib import Path
import threading
import uuid

from documents.material_image_move import _write_bytes
from documents.material_practice_lock import PRACTICE_SET_LOCK
from documents.system_storage_journal import StorageJournal, digest, migration_lock, recover_pending
from documents.system_storage_plan import mapped_path, plan_system_storage, nonconflicting_plan
from documents.system_storage_references import inspect_references, verify_links

_LOCK = threading.RLock()


def migrate_system_storage(root, *, excluded_paths=(), allow_partial=False, _prepared=None):
    root = Path(root).resolve()
    if not root.is_dir():
        return {"renamed": 0, "updated_reports": 0}
    if _prepared is not None and (_prepared["root"] != str(root)
            or _prepared["excluded_paths"] != [str(Path(p).resolve()) for p in excluded_paths]):
        raise ValueError("Prepared migration scope differs from the selected data root")
    with _LOCK:
        plan = _prepared["plan"] if _prepared is not None else plan_system_storage(root, excluded_paths=excluded_paths)
        pending = root / ".ails" / "system-storage-migrations"
        if not plan["moves"] and not pending.is_dir():
            if plan["collisions"] or plan["blocked"]:
                if not allow_partial:
                    raise FileExistsError(f"System storage migration preserves conflicts: {plan['collisions'] + plan['blocked']}")
                return {"renamed": 0, "updated_reports": 0, "deferred": [*plan["collisions"], *plan["blocked"]]}
            if not inspect_references(plan)["updates"]:
                return {"renamed": 0, "updated_reports": 0}
        if not allow_partial and not pending.is_dir() and (plan["collisions"] or plan["blocked"]):
            raise FileExistsError(f"System storage migration preserves conflicts: {plan['collisions'] + plan['blocked']}")
        with migration_lock(root) as directory:
            with PRACTICE_SET_LOCK:
                recovered = recover_pending(directory, root, _write_bytes)
            if recovered or _prepared is None:
                plan = plan_system_storage(root, excluded_paths=excluded_paths)
            if allow_partial:
                plan = nonconflicting_plan(plan)
            if plan["collisions"] or plan["blocked"]:
                raise FileExistsError(f"System storage migration preserves conflicts: {plan['collisions'] + plan['blocked']}")
            detail = _prepared["references"] if _prepared is not None and not recovered else inspect_references(plan)
            if not plan["moves"] and not detail["updates"]:
                result = {"renamed": 0, "updated_reports": 0}
                if plan.get("deferred"):
                    result["deferred"] = plan["deferred"]
                return result
            # Reference inspection can traverse the entire library. Only mutations
            # share the practice lock, so startup scans do not block folder actions.
            with PRACTICE_SET_LOCK:
                current = plan_system_storage(root, excluded_paths=excluded_paths)
                if allow_partial:
                    current = nonconflicting_plan(current)
                keys = ("moves", "mapped_moves", "reports", "records", "collisions", "blocked")
                if any(current[key] != plan[key] for key in keys):
                    raise RuntimeError("Storage changed during preflight; retry migration")
                moves = [(Path(old), Path(new)) for old, new in plan["moves"]]
                mapped = mapped_path(root, moves)
                updates = detail["updates"]
                initial = {str(old): digest(old) for old, _ in moves}
                journal_path = directory / uuid.uuid4().hex
                journal_path.mkdir()
                references = []
                for index, (source, original, rewritten) in enumerate(updates):
                    backup = journal_path / f"{index}.reference.backup"
                    with backup.open("xb") as handle:
                        handle.write(original)
                        handle.flush()
                        os.fsync(handle.fileno())
                    references.append({"path": str(source), "new_path": str(mapped(source)), "backup": str(backup)})
                journal = StorageJournal(journal_path, {"schema_version": 2, "root": str(root),
                    "moves": plan["moves"], "mapped_moves": plan["mapped_moves"], "references": references,
                    "source_digests": initial, "excluded_paths": [str(Path(p).resolve()) for p in excluded_paths],
                    "recovered_manifests": recovered, "deferred": plan.get("deferred", []),
                    "link_changes": detail["link_changes"], "broken_links_before": detail["broken_links"]})
                journal.save("prepared")

                def merge(old, new):
                    if not old.resolve().is_relative_to(root) or not new.resolve().is_relative_to(root):
                        raise ValueError("System folder move escapes its data root")
                    if not new.exists():
                        journal.move(old, new)
                    elif old.is_dir() and new.is_dir() and not new.is_symlink() and not new.is_junction():
                        for child in sorted(old.iterdir()):
                            merge(child, new / child.name)
                        journal.remove_empty(old)
                    else:
                        raise FileExistsError(f"System storage target exists: {new}")

                try:
                    for old, new in moves:
                        if not any(Path(child).is_relative_to(old) and Path(child) != old for child, _target in plan["moves"]):
                            if digest(old) != initial[str(old)]:
                                raise RuntimeError(f"Storage changed after preflight: {old}")
                        merge(old, new)
                    for (source, original, rewritten), reference in zip(updates, references):
                        journal.write(mapped(source), original, rewritten, reference["backup"], _write_bytes)
                    verified = verify_links(detail["link_changes"], root)
                except Exception as error:
                    try:
                        journal.rollback(_write_bytes)
                    except Exception as rollback:
                        journal.save("rollback_failed")
                        raise ExceptionGroup("System storage migration rollback failed", [error, rollback]) from error
                    raise
                journal.save("complete")
                return {"renamed": len(moves), "updated_reports": sum(Path(item["path"]).suffix.lower() == ".md" for item in references),
                        "updated_records": sum(Path(item["path"]).suffix.lower() == ".json" for item in references),
                        "manifest": str(journal_path / "manifest.json"), "recovered": len(recovered),
                        "deferred": plan.get("deferred", []), "links": verified,
                        "broken_links_before": len(detail["broken_links"])}
