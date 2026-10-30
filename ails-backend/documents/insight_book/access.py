"""Short-lived server-verified identities, invalidated by local credential changes."""
from __future__ import annotations

import hashlib
import threading
import time

from .timing import measure_span


def credential_fingerprint(credentials):
    values = [str(credentials.get(key) or "") for key in ("access_token", "refresh_token")]
    if not any(values):
        raise PermissionError("AILS 계정에 로그인해 주세요.")
    return hashlib.sha256("\0".join(values).encode("utf-8")).digest()


class InsightAccountAccess:
    def __init__(self, verify, read_credentials, *, ttl=30, clock=time.monotonic):
        self.verify, self.read_credentials = verify, read_credentials
        self.ttl, self.clock = ttl, clock
        self.lock = threading.RLock()
        self.user_id, self.fingerprint, self.valid_until = None, None, 0

    def resolve(self):
        with measure_span("auth_check"), self.lock:
            try:
                fingerprint = credential_fingerprint(self.read_credentials())
                if fingerprint == self.fingerprint and self.user_id and self.clock() < self.valid_until:
                    return self.user_id
                with measure_span("auth_remote"):
                    user_id, verified_credentials = self.verify()
                verified = credential_fingerprint(verified_credentials) if verified_credentials is not None else fingerprint
                if not user_id or credential_fingerprint(self.read_credentials()) != verified:
                    raise PermissionError("계정 인증 정보가 변경되었습니다. 다시 시도해 주세요.")
                self.user_id, self.fingerprint = user_id, verified
                self.valid_until = self.clock() + self.ttl
                return user_id
            except BaseException:
                self.user_id, self.fingerprint, self.valid_until = None, None, 0
                raise
