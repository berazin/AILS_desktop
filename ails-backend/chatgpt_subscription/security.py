"""Protected atomic token records, isolated from AILS credentials/config exports."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import tempfile
import threading

from credential_store import _windows_keyring_backend


class CredentialVault:
    def __init__(self):
        self._lock = threading.RLock()
        self.path = Path(os.environ.get("LOCALAPPDATA", "")) / "AILS" / "ChatGPT" / "session.enc"

    @contextmanager
    def locked(self):
        # No plaintext fallback on unsupported platforms or locked keyrings.
        if os.name != "nt":
            raise RuntimeError("ChatGPT 연결은 Windows 보안 자격 증명 저장소가 필요합니다.")
        if not self.path.is_absolute():
            raise RuntimeError("ChatGPT 보안 저장소 경로를 확인할 수 없습니다.")
        import msvcrt
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR, 0o600)
            with os.fdopen(fd, "r+b") as lock:
                lock.seek(0)
                # Windows permits locking beyond EOF. Do not write before
                # acquiring the lock held by another process's refresh.
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield self
                finally:
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)

    def _cipher(self):
        from cryptography.fernet import Fernet
        backend = _windows_keyring_backend()
        key = backend.get_password("AILS ChatGPT", "vault-key")
        if not key:
            if self.path.exists():
                raise RuntimeError("ChatGPT 보안 저장소 키를 찾을 수 없습니다.")
            key = Fernet.generate_key().decode("ascii")
            backend.set_password("AILS ChatGPT", "vault-key", key)
        return Fernet(key.encode("ascii"))

    def read(self):
        cipher = self._cipher()
        if not self.path.exists():
            return {}
        try:
            return json.loads(cipher.decrypt(self.path.read_bytes()))
        except Exception:
            raise RuntimeError("ChatGPT 보안 저장소를 읽지 못했습니다.") from None

    def write(self, record):
        encrypted = self._cipher().encrypt(json.dumps(record).encode("utf-8"))
        fd, name = tempfile.mkstemp(dir=self.path.parent)
        try:
            with os.fdopen(fd, "wb") as target:
                target.write(encrypted)
                target.flush()
                os.fsync(target.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
