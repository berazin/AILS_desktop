"""Account-bound, sanitized Codex quota snapshots shared by both chat surfaces."""
import copy
import math
import threading
import time

from .codex_account_rpc import UsageUnavailable, profile_stamp, read_codex_limits
from .protocol import ChatGPTError

MESSAGES = {
    "codex_not_installed": "Codex CLI가 설치되어 있지 않아 한도를 확인할 수 없습니다.",
    "codex_not_connected": "Codex에 같은 ChatGPT 계정으로 로그인하면 한도를 표시합니다.",
    "account_mismatch": "Codex와 AILS에 연결된 계정이 달라 한도를 표시하지 않습니다.",
    "usage_timeout": "사용량 조회 시간이 초과되었습니다. 다시 시도해 주세요.",
    "usage_unavailable": "Codex 사용량을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    "codex_unavailable": "설치된 Codex의 계정 조회를 사용할 수 없습니다.",
    "not_connected": "AI 설정에서 ChatGPT 계정을 연결해 주세요.",
    "permission_required": "ChatGPT 구독 사용 권한을 확인해 주세요.",
    "reconnect_required": "ChatGPT 연결이 변경되었습니다. 다시 조회해 주세요.",
    "deployment_pending": "이 배포판은 ChatGPT 구독 연결을 지원하지 않습니다.",
}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def normalize_limits(result):
    buckets = result.get("rateLimitsByLimitId")
    if not isinstance(buckets, dict) or not buckets:
        legacy = result.get("rateLimits")
        buckets = {legacy.get("limitId") or "codex": legacy} if isinstance(legacy, dict) else {}
    windows = []
    for key, bucket in list(buckets.items())[:20]:
        if not isinstance(bucket, dict) or not isinstance(key, str):
            continue
        for slot in ("primary", "secondary"):
            window = bucket.get(slot)
            if not isinstance(window, dict) or not number(window.get("usedPercent")):
                continue
            duration, reset = window.get("windowDurationMins"), window.get("resetsAt")
            # Null means unavailable. It never means 0% used or an unlimited plan.
            windows.append({"id": key[:100] + ":" + slot,
                            "name": str(bucket.get("limitName") or key)[:100],
                            "remaining_percent": max(0, min(100, 100 - window["usedPercent"])),
                            "window_minutes": duration if number(duration) and duration > 0 else None,
                            "resets_at": reset if number(reset) and reset > 0 else None})
    return windows


class ChatGPTUsageLimits:
    def __init__(self):
        self.lock = threading.Lock()
        self.cache = None

    def read(self, account, *, refresh=False):
        try:
            _, identity = account.access()
            email = account.status().get("email", "")
            key = identity, email, profile_stamp()
            with self.lock:
                now = time.monotonic()
                if self.cache and self.cache[0] == key and now < self.cache[1] and (not refresh or now - self.cache[2] < 1):
                    account.access(expected=identity)
                    return copy.deepcopy(self.cache[3])
                try:
                    raw = read_codex_limits(email)
                    account.access(expected=identity)
                    if profile_stamp() != key[2]:
                        raise UsageUnavailable("reconnect_required")
                    windows = normalize_limits(raw)
                    if not windows:
                        raise UsageUnavailable("usage_unavailable")
                    result = {"available": True, "source": "codex", "windows": windows,
                              "updated_at": time.time(), "error_code": "", "message": ""}
                except UsageUnavailable as error:
                    account.access(expected=identity)
                    result = self.unavailable(error.code)
                fetched = time.monotonic()
                # Shorter than the UI's 60s poll even with a 10s RPC, so the
                # next poll cannot keep recycling an older successful snapshot.
                lifetime = 45 if result["available"] else 15
                resets = [w["resets_at"] - time.time() for w in result["windows"] if w["resets_at"] and w["resets_at"] > time.time()]
                if resets:
                    lifetime = min(lifetime, min(resets))
                self.cache = key, fetched + lifetime, fetched, result
                return copy.deepcopy(result)
        except ChatGPTError as error:
            return self.unavailable(error.code)

    @staticmethod
    def unavailable(code):
        return {"available": False, "source": "codex", "windows": [], "updated_at": None,
                "error_code": code if code in MESSAGES else "usage_unavailable",
                "message": MESSAGES.get(code, MESSAGES["usage_unavailable"])}


USAGE_LIMITS = ChatGPTUsageLimits()
