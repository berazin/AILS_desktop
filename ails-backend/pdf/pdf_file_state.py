"""Small file primitives shared by PDF writers and the derived search index."""
import hashlib
import os
import threading
from weakref import WeakValueDictionary

_path_locks_guard = threading.Lock()
_path_locks = WeakValueDictionary()


def _lock_for_pdf(path):
    key = os.path.normcase(os.path.abspath(path))
    with _path_locks_guard:
        lock = _path_locks.get(key)
        if lock is None:
            lock = threading.RLock()
            _path_locks[key] = lock
        return lock


def file_digest(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
