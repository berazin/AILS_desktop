"""Durable operations and repeatable rollback for the existing storage migration."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import tempfile


def digest(path):
    path = Path(path)
    if path.is_symlink() or path.is_junction():
        raise ValueError(f"Linked migration entry is unsupported: {path}")
    if path.is_file():
        with path.open("rb") as handle:
            return hashlib.file_digest(handle, "sha256").hexdigest()
    entries = []
    for parent, dirs, files in os.walk(path, followlinks=False):
        for name in sorted([*dirs, *files]):
            child = Path(parent, name)
            if child.is_symlink() or child.is_junction():
                raise ValueError(f"Linked migration entry is unsupported: {child}")
            entries.append((child.relative_to(path).as_posix(), digest(child) if child.is_file() else "directory"))
    return hashlib.sha256(json.dumps(sorted(entries)).encode()).hexdigest()


def write_manifest(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".manifest-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def migration_lock(root):
    directory = Path(root) / ".ails" / "system-storage-migrations"
    for part in (Path(root) / ".ails", directory, directory / ".lock"):
        if part.is_symlink() or part.is_junction():
            raise ValueError("Linked migration journal is unsupported")
    directory.mkdir(parents=True, exist_ok=True)
    if not directory.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError("Migration journal escapes its data root")
    with (directory / ".lock").open("a+b") as handle:
        handle.seek(0)
        if not handle.read(1):
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield directory
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def _bounded(path, root):
    value = Path(path)
    if not value.is_absolute() or not value.resolve().is_relative_to(root.resolve()):
        raise ValueError("Migration operation escapes its data root")
    if any(part.is_symlink() or part.is_junction() for part in [value, *value.parents] if part.is_relative_to(root)):
        raise ValueError("Migration operation contains a linked path")
    return value


class StorageJournal:
    def __init__(self, path, manifest):
        self.path, self.manifest = Path(path), manifest
        self.root = Path(manifest["root"])
        self.next_index = 0

    def save(self, status):
        self.manifest["status"] = status
        write_manifest(self.path / "manifest.json", self.manifest)

    def append(self, event):
        with (self.path / "operations.jsonl").open("ab") as handle:
            handle.write((json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())

    def operation(self, kind, **values):
        event = {"index": self.next_index, "kind": kind, **values}
        self.next_index += 1
        self.append(event)
        return event

    def done(self, event):
        self.append({"done": event["index"]})

    def move(self, source, target):
        source, target = _bounded(source, self.root), _bounded(target, self.root)
        if target.exists():
            raise FileExistsError(f"System storage target exists: {target}")
        event = self.operation("move", source=str(source), target=str(target), before=digest(source))
        source.rename(target)
        self.done(event)

    def remove_empty(self, path):
        path = _bounded(path, self.root)
        if any(path.iterdir()):
            raise FileExistsError(f"Migration source is no longer empty: {path}")
        event = self.operation("rmdir", source=str(path))
        path.rmdir()
        self.done(event)

    def write(self, path, original, rewritten, backup, writer):
        path = _bounded(path, self.root)
        before = hashlib.sha256(original).hexdigest()
        if digest(path) != before:
            raise RuntimeError(f"Reference changed during migration: {path}")
        stamp = path.stat()
        event = self.operation("write", target=str(path), before=before,
                               after=hashlib.sha256(rewritten).hexdigest(), backup=str(backup),
                               atime_ns=stamp.st_atime_ns, mtime_ns=stamp.st_mtime_ns)
        writer(path, rewritten)
        # Document/embedding signatures include mtime; an equal-length link
        # update must invalidate them too. Image/media timestamps are untouched.
        os.utime(path, None)
        self.done(event)

    def rollback(self, writer):
        self.save("rolling_back")
        events, done = [], set()
        log = self.path / "operations.jsonl"
        lines = log.read_bytes().splitlines(keepends=True) if log.exists() else []
        for number, line in enumerate(lines):
            if not line.endswith(b"\n") and number == len(lines) - 1:
                break  # A torn last append never authorized its filesystem effect.
            event = json.loads(line)
            if "done" in event:
                done.add(event["done"])
            else:
                events.append(event)
        for event in reversed(events):
            if event["kind"] == "move":
                source, target = (_bounded(event[key], self.root) for key in ("source", "target"))
                if source.exists():
                    if digest(source) != event["before"] or target.exists() and event["index"] in done:
                        raise FileExistsError(f"Rollback preserves conflicting paths: {source}, {target}")
                    continue
                if not target.exists() or digest(target) != event["before"]:
                    raise RuntimeError(f"Moved data changed; rollback preserves it: {target}")
                target.rename(source)
            elif event["kind"] == "rmdir":
                source = _bounded(event["source"], self.root)
                if not source.exists():
                    source.mkdir()
                elif not source.is_dir():
                    raise FileExistsError(f"Rollback directory path is occupied: {source}")
            elif event["kind"] == "write":
                target = _bounded(event["target"], self.root)
                current = digest(target)
                if current == event["before"]:
                    continue
                backup = _bounded(event["backup"], self.path)
                if current != event["after"] or digest(backup) != event["before"]:
                    raise RuntimeError(f"Reference changed; rollback preserves it: {target}")
                writer(target, backup.read_bytes())
                if "mtime_ns" in event:
                    os.utime(target, ns=(event["atime_ns"], event["mtime_ns"]))
        self.save("rolled_back")


def recover_pending(directory, root, writer):
    recovered = []
    for path in sorted(directory.glob("*/manifest.json")):
        path = _bounded(path, directory)
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest.get("status") in {"complete", "rolled_back"}:
            continue
        if manifest.get("schema_version") != 2 or Path(manifest.get("root", "")).resolve() != root.resolve():
            raise RuntimeError(f"Older or foreign incomplete migration requires review: {path}")
        journal = StorageJournal(path.parent, manifest)
        try:
            journal.rollback(writer)
        except Exception:
            journal.save("rollback_failed")
            raise
        recovered.append(str(path))
    return recovered


def resolve_recorded_path(path):
    value = Path(os.path.abspath(path))
    # Only recorded data-root mappings extend compatibility to unknown names.
    for ancestor in value.parents:
        directory = ancestor / ".ails" / "system-storage-migrations"
        if not directory.is_dir() or not directory.resolve().is_relative_to(ancestor.resolve()) or directory.is_symlink() or directory.is_junction() or directory.parent.is_symlink() or directory.parent.is_junction():
            continue
        for record in sorted(directory.glob("*/manifest.json"), reverse=True):
            try:
                record = _bounded(record, directory)
                data = json.loads(record.read_text(encoding="utf-8"))
                if data.get("status") != "complete" or Path(data.get("root", "")).resolve() != ancestor.resolve():
                    continue
                moves = sorted(data.get("mapped_moves", data.get("moves", [])), key=lambda pair: -len(Path(pair[0]).parts))
                for old, new in moves:
                    old, new = _bounded(old, ancestor), _bounded(new, ancestor)
                    if value.is_relative_to(old):
                        candidate = new / value.relative_to(old)
                        if candidate.exists() and candidate.resolve().is_relative_to(ancestor.resolve()):
                            return str(candidate)
            except (OSError, ValueError, TypeError, KeyError):
                continue
    return None
