"""Read-only official Codex account RPCs. Never reads/copies its credential files."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time


class UsageUnavailable(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def codex_binary():
    executable = shutil.which("codex.exe" if os.name == "nt" else "codex")
    if executable:
        return executable
    # npm's Windows shims cannot be executed safely without a shell. Find the
    # corresponding installed native binary instead; never install/download it.
    shim = shutil.which("codex.cmd") if os.name == "nt" else None
    if shim:
        root = Path(shim).parent / "node_modules" / "@openai"
        for package, target in (("codex-win32-x64", "x86_64-pc-windows-msvc"),
                                ("codex-win32-arm64", "aarch64-pc-windows-msvc")):
            for parent in (root / "codex" / "node_modules" / "@openai", root):
                candidate = parent / package / "vendor" / target / "bin" / "codex.exe"
                if candidate.is_file():
                    return str(candidate)
    raise UsageUnavailable("codex_not_installed")


def profile_stamp():
    # Metadata only, used to invalidate the short cache on a Codex account change.
    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    try:
        stat = (home / "auth.json").stat()
        return str(home), stat.st_mtime_ns, stat.st_size
    except OSError:
        return str(home), None, None


class CodexAccountRPC:
    """A short-lived stdio client; no login, threads, turns, tools, or inference."""
    def __enter__(self):
        self.deadline = time.monotonic() + 10
        self.messages = queue.Queue(maxsize=128)
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith("AILS_") and key not in {"OPENAI_API_KEY", "OPENAI_BASE_URL"}}
        try:
            self.process = subprocess.Popen(
                [codex_binary(), "app-server", "--listen", "stdio://"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8", shell=False, env=environment,
                cwd=tempfile.gettempdir(),
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except OSError:
            raise UsageUnavailable("codex_unavailable") from None
        self.reader = threading.Thread(target=self._read, daemon=True, name="ails-codex-usage")
        self.reader.start()
        return self

    def _read(self):
        try:
            while True:
                line = self.process.stdout.readline(1024 * 1024 + 1)
                if not line or len(line) > 1024 * 1024:
                    break
                try:
                    item = json.loads(line)
                except ValueError:
                    continue
                if isinstance(item, dict):
                    self.messages.put_nowait(item)
        except (OSError, ValueError, queue.Full):
            pass
        finally:
            try:
                self.messages.put_nowait(None)
            except queue.Full:
                pass

    def send(self, value):
        try:
            self.process.stdin.write(json.dumps(value) + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError):
            raise UsageUnavailable("codex_unavailable") from None

    def call(self, request_id, method, params=None):
        self.send({"id": request_id, "method": method,
                   **({"params": params} if params is not None else {})})
        while True:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise UsageUnavailable("usage_timeout")
            try:
                message = self.messages.get(timeout=remaining)
            except queue.Empty:
                raise UsageUnavailable("usage_timeout") from None
            if message is None:
                raise UsageUnavailable("codex_unavailable")
            if message.get("id") != request_id:
                continue
            if "error" in message or not isinstance(message.get("result"), dict):
                # Remote error bodies may contain account information. Never
                # include them in the public exception, response, or logs.
                raise UsageUnavailable("usage_unavailable")
            return message["result"]

    def __exit__(self, *_args):
        # Only terminate the process this client created, never a running Codex app.
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        self.reader.join(timeout=1)
        self.process.stdin.close()
        self.process.stdout.close()


def read_codex_limits(expected_email):
    with CodexAccountRPC() as rpc:
        rpc.call(1, "initialize", {"clientInfo": {"name": "ails_usage", "title": "AILS usage", "version": "1.0"}})
        rpc.send({"method": "initialized"})
        def check_account(request_id):
            account = rpc.call(request_id, "account/read", {"refreshToken": False}).get("account")
            if not isinstance(account, dict) or account.get("type") != "chatgpt":
                raise UsageUnavailable("codex_not_connected")
            actual = account.get("email")
            if not expected_email or not isinstance(actual, str) or actual.strip().casefold() != expected_email.strip().casefold():
                raise UsageUnavailable("account_mismatch")
        check_account(2)
        result = rpc.call(3, "account/rateLimits/read")
        check_account(4)
        return result
