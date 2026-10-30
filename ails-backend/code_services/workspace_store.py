"""Folder workspaces. User files stay on disk; identities and links stay in SQLite."""
import hashlib
from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import uuid
from system_storage import resolve_system_path
from .workspace_text import decode_workspace_text, encode_workspace_text


_LOCK = threading.RLock()
MAX_TEXT_BYTES = 2 * 1024 * 1024
IGNORED = {".git", "node_modules", "__pycache__", ".venv", "venv"}
DOCUMENT_EXTENSIONS = {".pdf", ".md", ".txt", ".ipynb", ".ppt", ".pptx", ".epub", ".mobi", ".azw", ".azw3", ".fb2", ".rtf", ".docx", ".xlsx", ".csv", ".hwp", ".hwpx"}


class WorkspaceError(ValueError):
    def __init__(self, message, code="workspace_error"):
        super().__init__(message)
        self.code = code


def _path(value):
    if not str(value or "").strip():
        raise WorkspaceError("폴더 경로를 입력하세요.")
    return Path(resolve_system_path(os.path.abspath(os.path.expanduser(str(value)))))


def _identity(root):
    marker = root / ".link"
    if marker.is_symlink():
        raise WorkspaceError(".link는 심볼릭 링크일 수 없습니다.")
    if not marker.exists():
        return None
    try:
        if marker.stat().st_size > 80:
            raise ValueError()
        return str(uuid.UUID(marker.read_text(encoding="utf-8").strip()))
    except (ValueError, UnicodeError):
        raise WorkspaceError(".link에 올바른 UUID가 없습니다. 기존 파일을 보존했습니다.", "invalid_identity") from None


def _digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


class WorkspaceStore:
    def __init__(self, database):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with _LOCK, self._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS workspaces (
                    id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, opened REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS pdfs (
                    id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS links (
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    pdf_id TEXT NOT NULL REFERENCES pdfs(id),
                    PRIMARY KEY(workspace_id, pdf_id));
            """)
            # Keep the last registered legacy link; originals and other
            # workspaces' document links remain in their existing tables.
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name='one_document_per_workspace'").fetchone():
                db.execute("DELETE FROM links WHERE rowid NOT IN (SELECT MAX(rowid) FROM links GROUP BY workspace_id)")
                db.execute("CREATE UNIQUE INDEX one_document_per_workspace ON links(workspace_id)")

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def _root(self, workspace_id):
        with self._db() as db:
            row = db.execute("SELECT path FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if not row:
            raise WorkspaceError("작업 폴더가 등록되어 있지 않습니다.", "missing_workspace")
        root = Path(resolve_system_path(row["path"]))
        if not root.is_dir() or _identity(root) != workspace_id:
            raise WorkspaceError("작업 폴더를 찾을 수 없습니다. 이동한 폴더를 다시 선택하세요.", "missing_workspace")
        return root

    def _entry(self, workspace_id, relative, allow_root=False):
        root = self._root(workspace_id)
        name = str(relative or "").replace("\\", "/")
        if allow_root and not name:
            return root
        parts = name.split("/")
        if not name or any(part in {"", ".", ".."} or part.endswith((" ", "."))
                           or any(char in part for char in ':<>"|?*\0')
                           or part.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(1, 10)], *[f"LPT{i}" for i in range(1, 10)]}
                           for part in parts):
            raise WorkspaceError("작업 폴더 안의 상대 경로를 사용하세요.")
        if any(part.lower() == ".link" or part.lower() in IGNORED for part in parts):
            raise WorkspaceError("작업 식별 파일과 관리 폴더는 편집할 수 없습니다.")
        target = root
        for part in parts:
            target /= part
            if target.is_symlink():
                raise WorkspaceError("심볼릭 링크는 편집할 수 없습니다.")
        if not target.resolve().is_relative_to(root.resolve()):
            raise WorkspaceError("작업 폴더 밖의 파일에는 접근할 수 없습니다.")
        return target

    def _describe(self, row, db):
        root = Path(resolve_system_path(row["path"]))
        try:
            available = root.is_dir() and _identity(root) == row["id"]
        except (OSError, WorkspaceError):
            available = False
        pdfs = [dict(pdf) for pdf in db.execute(
            "SELECT p.id,p.path FROM pdfs p JOIN links l ON l.pdf_id=p.id WHERE l.workspace_id=? ORDER BY p.path",
            (row["id"],))]
        return {"id": row["id"], "path": str(root), "name": root.name,
                "available": available, "opened": row["opened"],
                "pdfs": [{**pdf, "available": Path(pdf["path"]).is_file()} for pdf in pdfs]}

    def list(self):
        with self._db() as db:
            return [self._describe(row, db) for row in db.execute("SELECT * FROM workspaces ORDER BY opened DESC")]

    def open(self, path, create=False, fork=False, expected_id=None):
        root = _path(path)
        with _LOCK:
            if create:
                root.mkdir(parents=False, exist_ok=False)
            if not root.is_dir():
                raise WorkspaceError("폴더를 찾을 수 없습니다.", "missing_workspace")
            root = root.resolve()
            identity = _identity(root)
            if expected_id and identity != expected_id:
                raise WorkspaceError("선택한 폴더가 원래 작업 폴더와 다릅니다.", "identity_mismatch")
            with self._db() as db:
                old = db.execute("SELECT * FROM workspaces WHERE id=?", (identity,)).fetchone()
                duplicate = old and Path(old["path"]) != root and Path(old["path"]).is_dir()
                if duplicate:
                    try:
                        duplicate = _identity(Path(old["path"])) == identity
                    except (OSError, WorkspaceError):
                        duplicate = True
                if duplicate and not fork:
                    raise WorkspaceError("같은 UUID를 가진 원본 폴더가 있습니다. 복사본을 새 작업으로 등록하세요.", "duplicate_workspace")
                if fork and not duplicate:
                    raise WorkspaceError("중복된 복사본만 새 작업으로 등록할 수 있습니다.")
                collision = db.execute("SELECT id FROM workspaces WHERE path=?", (str(root),)).fetchone()
                if collision and (collision["id"] != identity or duplicate):
                    raise WorkspaceError("이 경로는 다른 작업으로 등록되어 있습니다. 원래 작업의 이동 경로를 먼저 복구하세요.", "path_conflict")
                if identity is None or duplicate:
                    identity = str(uuid.uuid4())
                    marker = root / ".link"
                    if duplicate:
                        marker.write_text(identity, encoding="utf-8")
                    else:
                        with marker.open("x", encoding="utf-8") as handle:
                            handle.write(identity)
                db.execute("INSERT INTO workspaces VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,opened=excluded.opened",
                           (identity, str(root), time.time()))
                row = db.execute("SELECT * FROM workspaces WHERE id=?", (identity,)).fetchone()
                return self._describe(row, db)

    def relocate(self, workspace_id, destination):
        with _LOCK:
            root = self._root(workspace_id)
            target = _path(destination)
            if target.exists() or not target.parent.is_dir() or target.resolve().is_relative_to(root.resolve()):
                raise WorkspaceError("새 폴더 경로를 확인하세요. 기존 폴더를 덮어쓰지 않습니다.")
            root.rename(target)
            try:
                return self.open(str(target), expected_id=workspace_id)
            except Exception:
                target.rename(root)
                raise

    def tree(self, workspace_id, relative=""):
        directory = self._entry(workspace_id, relative, allow_root=True)
        if not directory.is_dir():
            raise WorkspaceError("폴더를 찾을 수 없습니다.")
        entries = []
        for item in directory.iterdir():
            if item.name.lower() == ".link" or item.name.lower() in IGNORED:
                continue
            entries.append({"name": item.name, "path": f"{relative}/{item.name}".lstrip("/"),
                            "directory": item.is_dir(), "symlink": item.is_symlink()})
        return sorted(entries, key=lambda item: (not item["directory"], item["name"].lower()))

    def read(self, workspace_id, relative):
        target = self._entry(workspace_id, relative)
        if not target.is_file() or target.stat().st_size > MAX_TEXT_BYTES:
            raise WorkspaceError("2MB 이하의 텍스트 파일만 편집할 수 있습니다.")
        data = target.read_bytes()
        if b"\0" in data:
            raise WorkspaceError("바이너리 파일은 텍스트로 편집할 수 없습니다.")
        try:
            text, _ = decode_workspace_text(data, target.suffix)
        except UnicodeError:
            supported = "UTF-8 또는 CP949" if target.suffix.lower() in {".c", ".cpp"} else "UTF-8"
            raise WorkspaceError(f"{supported} 텍스트 파일만 편집할 수 있습니다. 원본은 변경하지 않았습니다.") from None
        return {"path": relative, "text": text, "revision": hashlib.sha256(data).hexdigest()}

    def save(self, workspace_id, relative, text, revision):
        with _LOCK:
            target = self._entry(workspace_id, relative)
            if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_TEXT_BYTES:
                raise WorkspaceError("텍스트 크기가 2MB를 초과했습니다.")
            if not target.is_file() or _digest(target) != revision:
                raise WorkspaceError("파일이 외부에서 변경되었습니다. 다시 불러온 후 변경 내용을 확인하세요.", "file_conflict")
            try:
                data = encode_workspace_text(text, target.read_bytes(), target.suffix)
            except UnicodeError:
                raise WorkspaceError("원본 인코딩으로 저장할 수 없는 문자가 있습니다. 파일은 변경하지 않았습니다.") from None
            if len(data) > MAX_TEXT_BYTES:
                raise WorkspaceError("텍스트 크기가 2MB를 초과했습니다.")
            fd, temporary = tempfile.mkstemp(prefix=".ails-save-", dir=target.parent)
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.chmod(temporary, target.stat().st_mode)
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return self.read(workspace_id, relative)

    def mutate(self, workspace_id, operation, relative, destination="", directory=False, revision=None, text=""):
        with _LOCK:
            target = self._entry(workspace_id, relative)
            if operation == "create":
                if directory:
                    target.mkdir()
                else:
                    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_TEXT_BYTES:
                        raise WorkspaceError("파일 내용이 너무 큽니다.")
                    with target.open("x", encoding="utf-8", newline="") as handle:
                        handle.write(text)
            elif operation == "rename":
                dest = self._entry(workspace_id, destination)
                if dest.exists():
                    raise WorkspaceError("같은 이름의 파일 또는 폴더가 있습니다.")
                if target.is_file() and revision and _digest(target) != revision:
                    raise WorkspaceError("파일이 외부에서 변경되었습니다.", "file_conflict")
                target.rename(dest)
            elif operation == "delete":
                if target.is_dir():
                    target.rmdir()  # Nonempty folders require explicit deletion of their contents.
                else:
                    if not revision or _digest(target) != revision:
                        raise WorkspaceError("파일이 변경되었습니다. 다시 불러온 후 삭제하세요.", "file_conflict")
                    target.unlink()
            else:
                raise WorkspaceError("지원하지 않는 파일 작업입니다.")
            return {"success": True}

    def link(self, workspace_id, pdf_path, remove=False, pdf_id=None):
        with _LOCK, self._db() as db:
            if remove:
                db.execute("DELETE FROM links WHERE workspace_id=? AND pdf_id=?", (workspace_id, pdf_id))
                return {"success": True}
            self._root(workspace_id)
            path = _path(pdf_path).resolve()
            if path.suffix.lower() not in DOCUMENT_EXTENSIONS or not path.is_file():
                raise WorkspaceError("연결할 문서 파일을 찾을 수 없거나 지원하지 않는 형식입니다.")
            digest = _digest(path)
            existing = db.execute("SELECT * FROM pdfs WHERE path=?", (str(path),)).fetchone()
            if not existing:
                existing = next((row for row in db.execute("SELECT * FROM pdfs WHERE digest=?", (digest,))
                                 if not Path(row["path"]).exists()), None)
            identity = existing["id"] if existing else str(uuid.uuid4())
            db.execute("INSERT INTO pdfs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,digest=excluded.digest",
                       (identity, str(path), digest))
            db.execute("DELETE FROM links WHERE workspace_id=?", (workspace_id,))
            db.execute("INSERT INTO links VALUES(?,?)", (workspace_id, identity))
            return {"success": True}


def handle_workspace_request(payload, database):
    store = WorkspaceStore(database)
    operation = payload.get("operation", "list")
    try:
        if operation == "list":
            return {"workspaces": store.list()}
        if operation == "browse":
            from .workspace_project_browser import browse_workspace_projects
            return browse_workspace_projects(store)
        if operation == "new":
            from .workspace_creation import create_workspace_folder
            return {"workspace": store.open(create_workspace_folder())}
        if operation == "open":
            return {"workspace": store.open(payload.get("path"), create=payload.get("create", False),
                                             fork=payload.get("fork", False), expected_id=payload.get("expected_id"))}
        if operation == "relocate":
            return {"workspace": store.relocate(payload.get("id"), payload.get("path"))}
        if operation == "tree":
            return {"entries": store.tree(payload.get("id"), payload.get("path", ""))}
        if operation == "read":
            return store.read(payload.get("id"), payload.get("path"))
        if operation == "save":
            return store.save(payload.get("id"), payload.get("path"), payload.get("text"), payload.get("revision"))
        if operation in {"create", "rename", "delete"}:
            return store.mutate(payload.get("id"), operation, payload.get("path"), payload.get("destination", ""),
                                payload.get("directory", False), payload.get("revision"), payload.get("text", ""))
        if operation in {"link", "unlink"}:
            return store.link(payload.get("id"), payload.get("path"), operation == "unlink", payload.get("pdf_id"))
        raise WorkspaceError("지원하지 않는 작업입니다.")
    except (OSError, ValueError) as error:
        return {"error": str(error), "code": getattr(error, "code", "workspace_error")}
