"""Disk-backed whitespace-insensitive Ourmalsam lookup; never a Kiwi user lexicon."""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import threading
import uuid
from array import array
from bisect import bisect_left
from collections import OrderedDict
from contextlib import closing
from pathlib import Path

from common import resource_path

INDEX_VERSION = 1
MIN_TERM_LENGTH = 3
MAX_TERM_LENGTH = 32
_KOREAN_TERM = re.compile(r"[가-힣]+(?: [가-힣]+)*\Z")
_indexes = {}
_lock = threading.Lock()


class TermDictionary:
    def __init__(self, source: Path, cache_dir: Path):
        self.source = source.resolve()
        stat = source.stat()
        self.signature = (stat.st_size, stat.st_mtime_ns)
        cache_dir.mkdir(parents=True, exist_ok=True)
        identity = hashlib.sha256(f"{self.source}:{self.signature}".encode()).hexdigest()[:20]
        self.path = cache_dir / f"ourmalsam-{INDEX_VERSION}-{identity}.sqlite3"
        expected = f"{INDEX_VERSION}:{stat.st_size}:{stat.st_mtime_ns}"
        try:
            with closing(sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True)) as db:
                valid = db.execute("SELECT value FROM meta WHERE name='signature'").fetchone() == (expected,)
        except sqlite3.Error:
            valid = False
        if not valid:
            self._build(expected)
        # Only the small two-syllable prefix/length filter is kept in Python.
        self._prefix_codes, self._prefix_masks = array("I"), array("Q")
        with closing(sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True)) as db:
            self.revision = db.execute("SELECT value FROM meta WHERE name='sha256'").fetchone()[0]
            self.count = db.execute("SELECT value FROM meta WHERE name='count'").fetchone()[0]
            for prefix, mask in db.execute("SELECT prefix, lengths FROM prefixes ORDER BY prefix"):
                self._prefix_codes.append(self._prefix_code(prefix))
                self._prefix_masks.append(mask)
        self._cache = OrderedDict()
        self._query_lock = threading.Lock()

    def _build(self, signature):
        temporary = self.path.with_name(f"{self.path.name}.{uuid.uuid4().hex}.tmp")
        digest = hashlib.sha256()
        try:
            with closing(sqlite3.connect(temporary)) as db, db:
                db.execute("PRAGMA journal_mode=OFF")
                db.execute("PRAGMA synchronous=OFF")
                db.execute("PRAGMA cache_size=-4096")
                db.execute("CREATE TABLE terms (key TEXT, form TEXT, PRIMARY KEY(key,form)) WITHOUT ROWID")
                db.execute("CREATE TABLE prefixes (prefix TEXT PRIMARY KEY, lengths INTEGER) WITHOUT ROWID")
                db.execute("CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID")
                prefixes, batch = {}, []
                with self.source.open("rb") as handle:
                    for line in handle:
                        digest.update(line)
                        form = " ".join(line.decode("utf-8-sig").split())
                        key = form.replace(" ", "")
                        if not (MIN_TERM_LENGTH <= len(key) <= MAX_TERM_LENGTH and _KOREAN_TERM.fullmatch(form)):
                            continue
                        batch.append((key, form))
                        prefix = key[:2]
                        prefixes[prefix] = prefixes.get(prefix, 0) | (1 << len(key))
                        if len(batch) >= 2000:
                            db.executemany("INSERT OR IGNORE INTO terms VALUES (?,?)", batch)
                            batch.clear()
                db.executemany("INSERT OR IGNORE INTO terms VALUES (?,?)", batch)
                db.executemany("INSERT INTO prefixes VALUES (?,?)", prefixes.items())
                count = db.execute("SELECT count(*) FROM terms").fetchone()[0]
                db.executemany("INSERT INTO meta VALUES (?,?)", [
                    ("signature", signature), ("sha256", digest.hexdigest()), ("count", str(count)),
                ])
            stat = self.source.stat()
            if self.signature != (stat.st_size, stat.st_mtime_ns):
                raise OSError("OCR dictionary changed while indexing")
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)

    def lookup_many(self, keys):
        keys = list(dict.fromkeys(keys))
        with self._query_lock:
            missing = [key for key in keys if key not in self._cache]
            found = {key: [] for key in missing}
            if missing:
                # Cache hits need no connection. Misses release their file handle
                # before returning so profile cleanup/source refresh is safe.
                with closing(sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True)) as db:
                    db.execute("PRAGMA cache_size=-2048")
                    db.execute("PRAGMA mmap_size=0")
                    for offset in range(0, len(missing), 400):
                        chunk = missing[offset:offset + 400]
                        rows = db.execute(
                            f"SELECT key,form FROM terms WHERE key IN ({','.join('?' for _ in chunk)}) ORDER BY key,form", chunk)
                        for key, form in rows:
                            found[key].append(form)
            result = {key: self._cache[key] if key in self._cache else tuple(found[key]) for key in keys}
            for key in keys:
                self._cache[key] = result[key]
                self._cache.move_to_end(key)
            while len(self._cache) > 4096:
                self._cache.popitem(last=False)
            return result

    @staticmethod
    def _prefix_code(prefix):
        return (ord(prefix[0]) - 0xAC00) * 11172 + ord(prefix[1]) - 0xAC00

    def lengths_for(self, prefix):
        if len(prefix) != 2:
            return 0
        code = self._prefix_code(prefix)
        offset = bisect_left(self._prefix_codes, code)
        return (self._prefix_masks[offset] if offset < len(self._prefix_codes)
                and self._prefix_codes[offset] == code else 0)

    def close(self):
        # Connections are scoped to a lookup; retain the existing lifecycle API.
        with self._query_lock:
            self._cache.clear()


def get_term_dictionary():
    """Optional source file; missing/invalid dictionaries leave the baseline usable."""
    source = Path(resource_path("Dictionary/words.txt"))
    if not source.is_file():
        return None
    stat = source.stat()
    cache = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "AILS" / "ocr_terms"
    signature = (str(source.resolve()), stat.st_size, stat.st_mtime_ns, str(cache.resolve()))
    with _lock:
        if signature not in _indexes:
            index = TermDictionary(source, cache)
            for previous in _indexes.values():
                previous.close()
            _indexes.clear()
            _indexes[signature] = index
        return _indexes[signature]
