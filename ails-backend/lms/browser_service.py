"""LmsBrowserService: feature operations and owned state."""
from __future__ import annotations
from lms.browser_support import (
    Any,
    Callable,
    LMS_BROWSER_CDP_PORT,
    LMS_KEYRING_SERVICE,
    LMS_KEYRING_USERNAME,
    TaskCancelledError,
    ctypes,
    dataclass,
    get_lms_browser_cdp_url,
    get_lms_browser_cdp_ws_url,
    get_lms_browser_info,
    get_lms_browser_profile_dir,
    os,
    pipeline_utils,
    require_feature,
    save_config,
    subprocess,
    threading,
    time,
    urlparse,
    uuid,
)
from lms.browser_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class LmsBrowserServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    append_idle_log: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    get_lock: Callable[[], Any]

class LmsBrowserService:
    def close(self):
        self.close_lms_browser()

    def __init__(self, ports: LmsBrowserServicePorts):
        self._ports = ports
        self.append_idle_log = ports.append_idle_log
        self.lms_browser_lock = threading.Lock()
        self.lms_auth_condition = threading.Condition()
        self.lms_auth_attempt = None
        self.lms_playwright = None
        self.lms_browser_context = None
        self.lms_browser_process = None
        self.lms_browser_headless = False
        self.lms_browser_auto_hidden = False
        self.lms_browser_info = None
        self.lms_origin = ""

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    @property
    def lock(self):
        return self._ports.get_lock()

    def _set_lms_origin(self, target_url: str = "") -> str:
        value = str(target_url or self.config.get("last_lms_url", "") or "").strip()
        parsed = urlparse(value)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("올바른 LMS 주소를 먼저 입력해 주세요.")
        origin = f"{parsed.scheme.lower()}://{parsed.netloc}"
        attempt = self.lms_auth_attempt
        if attempt and attempt["state"] in {"checking", "signing_in", "awaiting_mfa"} and self.lms_origin and origin != self.lms_origin:
            raise RuntimeError("다른 LMS 인증이 진행 중입니다. 완료 후 다시 시도해 주세요.")
        self.lms_origin = origin
        return origin

    def _lms_page_kind(self, page) -> str:
        """Classify only observable LMS pages; unknown pages never prove login."""
        parsed = urlparse(str(page.url or ""))
        path = parsed.path.lower()
        expected_host = urlparse(self.lms_origin).hostname or ""
        current_host = parsed.hostname or ""
        parent_host = expected_host.partition(".")[2] if expected_host.count(".") >= 2 else expected_host
        if not expected_host or not (current_host == expected_host or current_host == parent_host or current_host.endswith("." + parent_host)):
            return "unknown"
        try:
            challenge = page.locator("input[autocomplete='one-time-code'], input[name*='otp' i], input[name*='verification' i]")
            if challenge.count() and challenge.first.is_visible():
                return "mfa"
        except Exception:
            pass
        if parsed.hostname != expected_host:
            return "unknown"
        if "/login" in path or "errorcode=" in parsed.query.lower():
            return "login"
        try:
            if page.locator("a[href*='/login/logout.php'], .usermenu, [data-user-id]").count():
                return "authenticated"
        except Exception:
            pass
        return "unknown"

    def get_lms_auth_status(self) -> dict:
        with self.lms_auth_condition:
            attempt = self.lms_auth_attempt
            if not attempt:
                return {"attempt_id": "", "state": "idle", "message": "", "expires_at": None}
            return {key: attempt[key] for key in ("attempt_id", "state", "message", "expires_at")}

    def cancel_lms_auth(self, attempt_id: str) -> dict:
        with self.lms_auth_condition:
            attempt = self.lms_auth_attempt
            if attempt and attempt["attempt_id"] == attempt_id and attempt["state"] in {"checking", "signing_in", "awaiting_mfa"}:
                attempt["state"] = "cancelled"
                attempt["message"] = "LMS 인증 대기가 취소되었습니다."
                self.lms_auth_condition.notify_all()
        return self.get_lms_auth_status()

    def _set_lms_auth_state(self, attempt: dict, state: str, message: str) -> bool:
        with self.lms_auth_condition:
            if self.lms_auth_attempt is not attempt or attempt["state"] in {"authenticated", "failed", "cancelled"}:
                return False
            attempt["state"] = state
            attempt["message"] = message
            self.lms_auth_condition.notify_all()
            return True

    def _close_lms_browser_unlocked(self):
        try:
            if self.is_lms_browser_running():
                try:
                    import asyncio
                    try:
                        asyncio.set_event_loop(None)
                    except Exception:
                        pass
                    from playwright.sync_api import sync_playwright

                    with sync_playwright() as playwright:
                        browser = playwright.chromium.connect_over_cdp(get_lms_browser_cdp_ws_url(), timeout=3000)
                        browser.close()
                except Exception:
                    pass
        finally:
            process = self.lms_browser_process
            if process is not None:
                try:
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except Exception:
                            process.kill()
                except Exception:
                    pass
            if self.lms_browser_context is not None:
                try:
                    self.lms_browser_context.close()
                except Exception:
                    pass
            if self.lms_playwright is not None:
                try:
                    self.lms_playwright.stop()
                except Exception:
                    pass
            self.lms_browser_process = None
            self.lms_browser_context = None
            self.lms_playwright = None
            self.lms_browser_headless = False
            self.lms_browser_info = None
            self.lms_browser_auto_hidden = False
            for _ in range(10):
                if not self.is_lms_browser_running(timeout_seconds=0.2):
                    break
                time.sleep(0.1)
            if self.is_lms_browser_running(timeout_seconds=0.2):
                self._terminate_orphaned_lms_edge()
                for _ in range(20):
                    if not self.is_lms_browser_running(timeout_seconds=0.2):
                        break
                    time.sleep(0.1)

    def close_lms_browser(self):
        with self.lms_browser_lock:
            self._close_lms_browser_unlocked()

    def _focus_lms_browser_window_unlocked(self):
        if os.name != "nt":
            return False
        try:
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            target_pid = None
            if self.lms_browser_process is not None:
                try:
                    target_pid = int(self.lms_browser_process.pid)
                except Exception:
                    target_pid = None
            if not target_pid:
                return False
            matches = []

            @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            def enum_proc(hwnd, _lparam):
                if not user32.IsWindowVisible(hwnd):
                    return True
                title_len = user32.GetWindowTextLengthW(hwnd)
                if title_len <= 0:
                    return True
                title_buffer = ctypes.create_unicode_buffer(title_len + 1)
                user32.GetWindowTextW(hwnd, title_buffer, title_len + 1)
                title = str(title_buffer.value or "")
                pid = ctypes.c_ulong()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if int(pid.value) == target_pid:
                    matches.append(hwnd)
                    return False
                return True

            user32.EnumWindows(enum_proc, 0)
            if not matches:
                return False
            hwnd = matches[0]
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.ShowWindow(hwnd, 5)  # SW_SHOW
            try:
                user32.AllowSetForegroundWindow(kernel32.GetCurrentProcessId())
            except Exception:
                pass
            user32.SetForegroundWindow(hwnd)
            return True
        except Exception:
            return False

    def _set_lms_browser_visible(self, visible: bool) -> bool:
        """Show or hide only the Edge process launched with the AILS profile."""
        if os.name != "nt" or self.lms_browser_process is None:
            return False
        try:
            user32 = ctypes.windll.user32
            target_pid = int(self.lms_browser_process.pid)
            windows = []

            @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            def collect(hwnd, _lparam):
                pid = ctypes.c_ulong()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if int(pid.value) == target_pid and user32.GetWindowTextLengthW(hwnd) > 0:
                    windows.append(hwnd)
                return True

            user32.EnumWindows(collect, 0)
            for hwnd in windows:
                user32.ShowWindow(hwnd, 9 if visible else 0)
                if visible:
                    user32.SetForegroundWindow(hwnd)
            return bool(windows)
        except Exception:
            return False

    def save_lms_credentials(self, payload: dict) -> dict:
        require_feature("summary.web_inputs")
        username = str(payload.get("username", "") or "").strip()
        password = str(payload.get("password", "") or "")
        remember_password = bool(payload.get("remember_password", True))
        if not username:
            raise ValueError("LMS username is required.")
        try:
            import keyring
        except Exception as error:
            raise RuntimeError("keyring is not available, so LMS password cannot be stored securely.") from error

        if remember_password:
            if password:
                keyring.set_password(LMS_KEYRING_SERVICE, LMS_KEYRING_USERNAME, password)
        else:
            try:
                keyring.delete_password(LMS_KEYRING_SERVICE, LMS_KEYRING_USERNAME)
            except Exception:
                pass

        with self.lock:
            next_config = dict(self.config)
            next_config["lms_username"] = username
            self.config = save_config(next_config)
        self.append_idle_log("LMS credentials saved. e-class VOD tasks can attempt automatic login.")
        return {
            "saved": True,
            "username": username,
            "password_saved": self.has_lms_saved_password(),
        }

    def open_lms_login_browser(
        self,
        *,
        force_new_window=False,
        headless=False,
        start_minimized=False,
        target_url="",
    ):
        require_feature("summary.web_inputs")
        with self.lms_browser_lock:
            browser_info = get_lms_browser_info()
            browser_name = str(browser_info["name"])
            login_url = self._set_lms_origin(target_url) + "/login.php" if not target_url else str(target_url)
            self._set_lms_origin(login_url)

            if not browser_info.get("supports_cdp"):
                try:
                    subprocess.Popen(
                        [browser_info["executable"], login_url],
                        cwd=os.path.dirname(browser_info["executable"]),
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                except Exception as error:
                    raise RuntimeError(f"기본 브라우저 {browser_name}을(를) 열지 못했습니다: {error}") from error
                self.lms_browser_info = browser_info
                self.lms_browser_headless = False
                self.append_idle_log(
                    f"기본 브라우저 {browser_name}에서 LMS 로그인 페이지를 열었습니다. "
                    "로그인 후 작업을 다시 실행하면 브라우저 쿠키를 사용합니다."
                )
                return {
                    "opened": True,
                    "browser": browser_name,
                    "browser_id": browser_info["id"],
                    "profile_dir": "",
                    "cdp_url": "",
                    "headless": False,
                    "start_minimized": False,
                    "automation": "browser_cookies",
                }

            running = self.is_lms_browser_running()
            same_browser = bool(
                self.lms_browser_info
                and self.lms_browser_info.get("id") == browser_info.get("id")
            )
            if running and same_browser and not force_new_window and self.lms_browser_headless == bool(headless):
                return {
                    "opened": False,
                    "browser": browser_name,
                    "browser_id": browser_info["id"],
                    "profile_dir": get_lms_browser_profile_dir(browser_info["id"]),
                    "cdp_url": get_lms_browser_cdp_url(),
                    "headless": self.lms_browser_headless,
                    "start_minimized": bool(start_minimized),
                    "automation": "cdp",
                }
            if running or self.lms_browser_context is not None or self.lms_playwright is not None or self.lms_browser_process is not None:
                self._close_lms_browser_unlocked()

            profile_dir = get_lms_browser_profile_dir(browser_info["id"])
            os.makedirs(profile_dir, exist_ok=True)
            cdp_url = get_lms_browser_cdp_url()
            port = cdp_url.rsplit(":", 1)[-1]
            args = [
                browser_info["executable"],
                f"--remote-debugging-port={port}",
                f"--user-data-dir={profile_dir}",
                "--no-first-run",
                "--lang=ko-KR",
                "--accept-lang=ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "--disable-blink-features=AutomationControlled",
            ]
            if headless:
                args.extend([
                    "--headless=new",
                    "--disable-gpu",
                    "--window-size=1280,900",
                ])
            else:
                if start_minimized:
                    args.append("--start-minimized")
                else:
                    args.append("--start-maximized")
                args.append("--new-window")
            args.append(login_url)
            try:
                self.lms_browser_process = subprocess.Popen(
                    args,
                    cwd=os.path.dirname(browser_info["executable"]),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except Exception as error:
                raise RuntimeError(f"기본 브라우저 {browser_name}을(를) 열지 못했습니다: {error}") from error

            self.lms_browser_info = browser_info
            self.lms_browser_headless = bool(headless)
            if not self.wait_for_lms_browser():
                self._close_lms_browser_unlocked()
                raise RuntimeError(f"{browser_name}이(가) LMS 자동화 포트를 열지 못했습니다.")
            if not headless and not start_minimized:
                focused = False
                for _ in range(20):
                    if self.lms_browser_process.poll() is not None:
                        break
                    if self._focus_lms_browser_window_unlocked():
                        focused = True
                        break
                    time.sleep(0.25)
                if not focused:
                    self._close_lms_browser_unlocked()
                    raise RuntimeError(f"{browser_name} 프로세스는 시작됐지만 보이는 창을 만들지 못했습니다.")
            elif not headless and start_minimized:
                self._set_lms_browser_visible(False)
            if headless:
                self.append_idle_log(f"기본 브라우저 {browser_name}을(를) 백그라운드에서 열었습니다.")
            elif start_minimized:
                self.append_idle_log(f"기본 브라우저 {browser_name}을(를) 최소화 상태로 열었습니다.")
            else:
                self.append_idle_log(f"기본 브라우저 {browser_name}에서 LMS 로그인 페이지를 열었습니다.")

            # 사용자가 AILS에서 LMS창을 열고 조작할 때 실시간으로 숨겨진 자료들을 보이게 하는 백그라운드 모니터링 데몬 기동
            if not headless:
                threading.Thread(
                    target=self._bg_lms_browser_unhider_loop,
                    daemon=True
                ).start()

            return {
                "opened": True,
                "browser": browser_name,
                "browser_id": browser_info["id"],
                "profile_dir": profile_dir,
                "cdp_url": cdp_url,
                "headless": bool(headless),
                "start_minimized": bool(start_minimized),
                "automation": "cdp",
            }

    def inject_lms_hidden_elements_viewer(self, context) -> None:
        css_content = """
        .dimmed, .hidden, [style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"] {
            display: block !important;
            visibility: visible !important;
            opacity: 0.65 !important;
            border: 2px dashed #ff4757 !important;
            background-color: #ffe8e8 !important;
            padding: 4px !important;
            margin: 4px !important;
            border-radius: 4px !important;
            position: relative !important;
        }
        .dimmed::before, .hidden::before, [style*="display: none"]::before, [style*="display:none"]::before {
            content: " [AILS 강제 노출 숨김자료] " !important;
            color: #ff4757 !important;
            font-weight: bold !important;
            font-size: 11px !important;
            background: #ffffff !important;
            border: 1px solid #ff4757 !important;
            border-radius: 3px !important;
            padding: 1px 4px !important;
            margin-right: 5px !important;
            display: inline-block !important;
        }
        """
        script = f"""
        (function() {{
            const inject = () => {{
                if (document.getElementById('ails-visibility-override')) return;
                const style = document.createElement('style');
                style.id = 'ails-visibility-override';
                style.innerHTML = `{css_content}`;
                document.head.appendChild(style);
            }};
            inject();
            window.addEventListener('DOMContentLoaded', inject);
            window.addEventListener('load', inject);
            const observer = new MutationObserver(inject);
            observer.observe(document.documentElement, {{ childList: true, subtree: true }});
        }})();
        """
        try:
            context.add_init_script(script)
            self.append_idle_log("AILS LMS hidden elements unhider script successfully injected into browser context.")
        except Exception as e:
            self.append_idle_log(f"Failed to inject AILS hidden elements unhider script: {str(e)}")

    def _bg_lms_browser_unhider_loop(self) -> None:
        """
        사용자가 AILS에서 LMS창을 수동으로 열어 조작할 때,
        백그라운드에서 실시간으로 CDP를 통해 브라우저를 감시하며
        숨겨진 요소 강제 노출 스크립트를 주기적으로 주입하는 데몬 루프입니다.
        """
        self.append_idle_log("Starting background LMS browser unhider daemon thread.")
        if not self.wait_for_lms_browser(timeout_seconds=10.0):
            self.append_idle_log("Background LMS browser unhider: Browser failed to launch within timeout.")
            return

        import asyncio
        try:
            asyncio.set_event_loop(None)
        except Exception:
            pass
        from playwright.sync_api import sync_playwright
        import time

        css_content = """
        .dimmed, .hidden, [style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"] {
            display: block !important;
            visibility: visible !important;
            opacity: 0.65 !important;
            border: 2px dashed #ff4757 !important;
            background-color: #ffe8e8 !important;
            padding: 4px !important;
            margin: 4px !important;
            border-radius: 4px !important;
            position: relative !important;
        }
        .dimmed::before, .hidden::before, [style*="display: none"]::before, [style*="display:none"]::before {
            content: " [AILS 강제 노출 숨김자료] " !important;
            color: #ff4757 !important;
            font-weight: bold !important;
            font-size: 11px !important;
            background: #ffffff !important;
            border: 1px solid #ff4757 !important;
            border-radius: 3px !important;
            padding: 1px 4px !important;
            margin-right: 5px !important;
            display: inline-block !important;
        }
        """
        script = f"""
        (function() {{
            const inject = () => {{
                if (document.getElementById('ails-visibility-override')) return;
                const style = document.createElement('style');
                style.id = 'ails-visibility-override';
                style.innerHTML = `{css_content}`;
                document.head.appendChild(style);
            }};
            inject();
            window.addEventListener('DOMContentLoaded', inject);
            window.addEventListener('load', inject);
            const observer = new MutationObserver(inject);
            observer.observe(document.documentElement, {{ childList: true, subtree: true }});
        }})();
        """

        try:
            with sync_playwright() as pw:
                cdp_url = get_lms_browser_cdp_ws_url()
                try:
                    browser = pw.chromium.connect_over_cdp(cdp_url, timeout=5000)
                except Exception as cdp_err:
                    self.append_idle_log(f"Background LMS browser unhider failed to connect to CDP: {str(cdp_err)}")
                    return

                context = browser.contexts[0] if browser.contexts else browser.new_context()

                # 향후 열리는 탭에 자동 주입 등록
                try:
                    context.add_init_script(script)
                except Exception as e:
                    self.append_idle_log(f"Background LMS browser unhider error adding init script: {str(e)}")

                def inject_to_page(page):
                    try:
                        page.evaluate(script)
                    except Exception:
                        pass

                # 신규 페이지 생성 이벤트 바인딩
                context.on("page", lambda p: inject_to_page(p))

                self.append_idle_log("Background LMS browser unhider successfully attached to active browser context.")

                # 실시간 스크롤 및 동적 로드 지원을 위한 주기적 감시 루프
                while self.is_lms_browser_running():
                    try:
                        for page in context.pages:
                            # 닫힌 페이지나 유효하지 않은 페이지 에러 회피
                            try:
                                if not page.is_closed():
                                    # 해당 페이지에 스타일이 주입되었는지 확인 후 없으면 즉시 실행
                                    page.evaluate(script)
                            except Exception:
                                pass
                    except Exception:
                        pass
                    time.sleep(1.5)  # 1.5초마다 주기적으로 확인 및 동적 재주입

                self.append_idle_log("Background LMS browser unhider: Browser closed. Exiting daemon thread.")
        except Exception as err:
            self.append_idle_log(f"Background LMS browser unhider daemon encountered an error: {str(err)}")

    def ensure_lms_login_for_eclass(self, target_url: str = "", cancel_event=None) -> dict:
        """Share one login attempt across callers, including an MFA wait."""
        origin = self._set_lms_origin(target_url)
        with self.lms_auth_condition:
            while (self.lms_auth_attempt is not None
                   and self.lms_auth_attempt["state"] in {"authenticated", "failed", "cancelled"}
                   and not self.lms_auth_attempt["worker_done"]):
                if cancel_event is not None and cancel_event.is_set():
                    raise TaskCancelledError("사용자 요청으로 LMS 작업이 취소되었습니다.")
                self.lms_auth_condition.wait(0.5)
            attempt = self.lms_auth_attempt
            if attempt is None or attempt["state"] not in {"checking", "signing_in", "awaiting_mfa"}:
                attempt = {
                    "attempt_id": uuid.uuid4().hex,
                    "state": "checking",
                    "message": "LMS 로그인 상태를 확인하고 있습니다.",
                    "expires_at": time.time() + 600,
                    "waiters": 0,
                    "worker_done": False,
                }
                self.lms_auth_attempt = attempt
                leader = True
            else:
                leader = False
            attempt["waiters"] += 1
        if leader:
            threading.Thread(
                target=self._complete_lms_auth_attempt,
                args=(target_url or origin, attempt),
                daemon=True,
            ).start()
        try:
            with self.lms_auth_condition:
                while attempt["state"] in {"checking", "signing_in", "awaiting_mfa"}:
                    if cancel_event is not None and cancel_event.is_set():
                        raise TaskCancelledError("사용자 요청으로 LMS 작업이 취소되었습니다.")
                    remaining = attempt["expires_at"] - time.time()
                    if remaining <= 0:
                        attempt["state"] = "failed"
                        attempt["message"] = "LMS 인증 대기 시간이 초과되었습니다."
                        self.lms_auth_condition.notify_all()
                        break
                    self.lms_auth_condition.wait(min(0.5, remaining))
                if cancel_event is not None and cancel_event.is_set():
                    raise TaskCancelledError("사용자 요청으로 LMS 작업이 취소되었습니다.")
                if attempt["state"] != "authenticated":
                    if attempt["state"] == "cancelled":
                        raise TaskCancelledError(attempt["message"])
                    raise RuntimeError(attempt["message"])
                return {"logged_in": True, "needs_manual_login": False}
        finally:
            with self.lms_auth_condition:
                attempt["waiters"] -= 1
                if attempt["waiters"] == 0 and attempt["state"] in {"checking", "signing_in", "awaiting_mfa"}:
                    attempt["state"] = "cancelled"
                    attempt["message"] = "LMS 인증 대기 중인 작업이 없어 취소되었습니다."
                    self.lms_auth_condition.notify_all()

    def _complete_lms_auth_attempt(self, target_url: str, attempt: dict) -> None:
        try:
            result = self._run_lms_login_flow(target_url, None, attempt)
            if result != "authenticated":
                raise RuntimeError("LMS 로그인 상태를 확인하지 못했습니다.")
            self._set_lms_auth_state(attempt, "authenticated", "LMS 인증이 완료되었습니다.")
        except RuntimeError as error:
            self._set_lms_auth_state(attempt, "failed", str(error))
        except Exception as error:
            self.append_idle_log(f"LMS authentication failed: {type(error).__name__}")
            self._set_lms_auth_state(attempt, "failed", "LMS 인증 상태를 확인하지 못했습니다. 다시 시도해 주세요.")
        finally:
            if attempt["state"] == "authenticated" and getattr(self, "lms_browser_auto_hidden", False):
                self._set_lms_browser_visible(False)
            with self.lms_auth_condition:
                attempt["worker_done"] = True
                self.lms_auth_condition.notify_all()

    def _probe_lms_session(self, target_url: str) -> str:
        """Check the protected target with the same browser profile."""
        from playwright.sync_api import sync_playwright
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp(get_lms_browser_cdp_ws_url(), timeout=10000)
                if not browser.contexts:
                    raise RuntimeError("LMS 브라우저 컨텍스트를 찾지 못했습니다.")
                page = browser.contexts[0].new_page()
                try:
                    page.goto(self._set_lms_origin(target_url) + "/my/", wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(700)
                    return self._lms_page_kind(page)
                finally:
                    page.close()
        except RuntimeError:
            raise
        except Exception as error:
            raise RuntimeError("LMS 보호 페이지에 연결하지 못했습니다. 네트워크와 브라우저 연결을 확인해 주세요.") from error

    def _open_mfa_in_lms_window(self) -> None:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(get_lms_browser_cdp_ws_url(), timeout=10000)
            if not browser.contexts:
                raise RuntimeError("LMS 브라우저 컨텍스트를 찾지 못했습니다.")
            context = browser.contexts[0]
            for page in context.pages:
                if self._lms_page_kind(page) == "mfa":
                    page.bring_to_front()
                    return
            page = context.new_page()
            page.goto(self.lms_origin + "/my/", wait_until="domcontentloaded", timeout=20000)
            if self._lms_page_kind(page) != "mfa":
                page.close()
                raise RuntimeError("LMS 2차 인증 화면을 표시하지 못했습니다.")

    def _run_lms_login_flow(self, target_url: str, cancel_event, attempt: dict) -> str:
        username = str(self.config.get("lms_username", "") or "").strip()
        password = self.get_lms_saved_password()
        browser = get_lms_browser_info()
        if not browser.get("supports_cdp"):
            raise RuntimeError("LMS 자동 로그인에는 Edge 자동화 연결이 필요합니다.")
        if self.is_lms_browser_running() and self.lms_browser_headless:
            self.close_lms_browser()
        if not self.is_lms_browser_running():
            self.open_lms_login_browser(headless=False, start_minimized=True, target_url=target_url)
            self._set_lms_browser_visible(False)
            self.lms_browser_auto_hidden = True
        initial = self._probe_lms_session(target_url)
        if initial == "authenticated":
            return "authenticated"
        mfa_from_probe = initial == "mfa"
        if initial == "login":
            if not username or not password:
                raise RuntimeError("저장된 LMS 계정이 없습니다. 설정에서 계정을 저장해 주세요.")
            self._set_lms_auth_state(attempt, "signing_in", "저장된 계정으로 LMS에 로그인하고 있습니다.")
            result = self.attempt_lms_autologin(username, password, target_url=target_url)
            if result.get("logged_in"):
                return "authenticated"
            if result.get("mfa_required"):
                initial = "mfa"
                mfa_from_probe = not result.get("mfa_in_window", False)
            elif result.get("login_page_detected"):
                raise RuntimeError("LMS 자동 로그인에 실패했습니다. 저장된 계정을 확인해 주세요.")
            else:
                raise RuntimeError("LMS 로그인 결과를 확인하지 못했습니다.")
        if initial != "mfa":
            raise RuntimeError("LMS 페이지의 인증 상태를 확인하지 못했습니다.")
        self._set_lms_auth_state(attempt, "awaiting_mfa", "브라우저에서 2차 인증하면 자동으로 계속됩니다.")
        if mfa_from_probe:
            self._open_mfa_in_lms_window()
        if not self._set_lms_browser_visible(True):
            raise RuntimeError("LMS 2차 인증 창을 표시하지 못했습니다.")
        while time.time() < attempt["expires_at"]:
            with self.lms_auth_condition:
                if attempt["state"] == "cancelled":
                    raise TaskCancelledError("LMS 인증 대기가 취소되었습니다.")
            if cancel_event is not None and cancel_event.is_set():
                raise TaskCancelledError("사용자 요청으로 LMS 작업이 취소되었습니다.")
            time.sleep(1)
            kind = self._probe_lms_session(target_url)
            if kind == "authenticated":
                return "authenticated"
            if kind not in {"mfa", "login"}:
                raise RuntimeError("2차 인증 화면의 상태를 확인하지 못했습니다.")
        raise RuntimeError("LMS 2차 인증 대기 시간이 초과되었습니다.")

    def attempt_lms_autologin(self, username: str, password: str, *, target_url: str = "") -> dict:
        origin = self._set_lms_origin(target_url)
        expected_host = urlparse(origin).hostname
        import asyncio
        try:
            asyncio.set_event_loop(None)
        except Exception:
            pass
        try:
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as error:
            raise RuntimeError("Playwright is not installed. Install requirements.txt and try again.") from error

        username_selectors = [
            "#input-username",
            "input[name='username']",
            "input[name='userid']",
            "input[name='user_id']",
            "input[name='id']",
            "input[id='username']",
            "input[id='userid']",
            "input[id='user_id']",
            "input[id='id']",
            "input[type='text']",
            "input:not([type])",
        ]
        password_selectors = [
            "#input-password",
            "input[name='password']",
            "input[type='password']",
        ]
        submit_selectors = [
            "input[name='loginbutton']",
            "#loginbtn",
            ".loginbtn",
            "button[type='submit']",
            "input[type='submit']",
            "button:has-text('로그인')",
            "a:has-text('로그인')",
            "button:has-text('Login')",
            "a:has-text('Login')",
        ]

        def first_visible_locator(page, selectors):
            roots = [page] + list(page.frames)
            seen = set()
            for root in roots:
                root_id = id(root)
                if root_id in seen:
                    continue
                seen.add(root_id)
                for selector in selectors:
                    locator = root.locator(selector)
                    try:
                        count = min(locator.count(), 8)
                    except Exception:
                        continue
                    for index in range(count):
                        item = locator.nth(index)
                        try:
                            if item.is_visible(timeout=700):
                                return item
                        except Exception:
                            continue
            return None

        def fill_first_visible(page, selectors, value):
            item = first_visible_locator(page, selectors)
            if item is None:
                return False
            item.fill(value, timeout=3000)
            return True

        with sync_playwright() as playwright:
            browser = self.connect_lms_browser_over_cdp(
                playwright.chromium,
                timeout_seconds=10.0,
            )
            try:
                contexts = browser.contexts
                if not contexts:
                    raise RuntimeError("기본 LMS 브라우저에 활성 페이지가 없습니다.")
                context = contexts[0]
                self.inject_lms_hidden_elements_viewer(context)
                page = context.pages[0] if context.pages else context.new_page()

                def protected_kind() -> str:
                    check_page = context.new_page()
                    try:
                        check_page.goto(origin + "/my/", wait_until="domcontentloaded", timeout=20000)
                        check_page.wait_for_timeout(700)
                        return self._lms_page_kind(check_page)
                    finally:
                        check_page.close()

                # [초고속 세션 복구 고도화] 이미 로그인 세션이 유효하게 살아있는지 초고속 선 탐색
                try:
                    initial_url = page.url.lower()
                    if self._lms_page_kind(page) == "authenticated" and protected_kind() == "authenticated":
                        self.append_idle_log("LMS session is already active on current page. Skipping login flow!")
                        return {"login_attempted": False, "logged_in": True, "needs_manual_login": False}

                    self.append_idle_log("Checking active session by navigating to LMS main dashboard...")
                    page.goto(origin + "/", wait_until="domcontentloaded", timeout=8000)
                    page.wait_for_timeout(1000) # 리다이렉트 대기
                    if "login" in page.url.lower() or "errorcode=" in page.url.lower():
                        self.append_idle_log(f"LMS session check reached login page: {page.url}")
                        if not username or not password:
                            return {
                                "login_attempted": False,
                                "logged_in": False,
                                "needs_manual_login": True,
                                "login_page_detected": True,
                            }
                        self.append_idle_log("Saved LMS credentials are available, so automatic login will be attempted before showing the browser.")
                    if self._lms_page_kind(page) == "authenticated" and protected_kind() == "authenticated":
                        self.append_idle_log("LMS active session successfully restored. Skipping login form!")
                        return {"login_attempted": False, "logged_in": True, "needs_manual_login": False}
                except Exception as check_err:
                    self.append_idle_log(f"Session quick check bypassed: {str(check_err)}")

                login_url = origin + "/login.php?lang=ko"
                self.append_idle_log(f"Navigating to LMS login page: {login_url}")
                try:
                    page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
                except PlaywrightTimeoutError:
                    self.append_idle_log("LMS login page load timed out (30s). Trying to proceed anyway...")
                except Exception as e:
                    self.append_idle_log(f"LMS login page load error: {str(e)}. Trying to proceed anyway...")

                # 5초 동안 한성대 LMS 도메인 로딩 여부 체크하여 about:blank 오판 방지
                for _ in range(10):
                    if urlparse(page.url).hostname == expected_host:
                        break
                    page.wait_for_timeout(500)

                current_url = page.url.lower()
                if self._lms_page_kind(page) == "mfa":
                    return {
                        "login_attempted": False,
                        "logged_in": False,
                        "needs_manual_login": True,
                        "mfa_required": True,
                        "login_page_detected": False,
                    }
                if urlparse(current_url).hostname != expected_host:
                    self.append_idle_log(f"LMS login page did not load correctly. Current URL: {page.url}")
                    return {
                        "login_attempted": False,
                        "logged_in": False,
                        "needs_manual_login": True,
                        "login_page_detected": False,
                    }

                # 로그인 상태 체크
                if self._lms_page_kind(page) == "authenticated" and protected_kind() == "authenticated":
                    self.append_idle_log("LMS session already appears to be logged in.")
                    return {"login_attempted": False, "logged_in": True, "needs_manual_login": False}

                if not username or not password:
                    self.append_idle_log("LMS is not logged in, and no saved credentials were found in settings.")
                    return {
                        "login_attempted": False,
                        "logged_in": False,
                        "needs_manual_login": True,
                        "login_page_detected": True,
                    }

                # 1. 로그인 폼 구성요소가 뜰 때까지 최우선적으로 Playwright 공식 API 및 무적의 폴링 기법 사용
                self.append_idle_log("Waiting for the LMS login form (#input-password) to become attached in DOM...")
                password_attached = False

                # 최대 15초간 0.5초 간격으로 attached 상태 및 DOM 내의 ID 엘리먼트를 철저히 탐색
                for poll_attempt in range(30):
                    try:
                        # Playwright wait_for_selector 시도
                        page.wait_for_selector("#input-password", state="attached", timeout=500)
                        password_attached = True
                        break
                    except Exception:
                        # Javascript 직접 검사로 백업 폴링
                        try:
                            has_el = page.evaluate("() => document.querySelector('#input-password') !== null")
                            if has_el:
                                password_attached = True
                                break
                        except Exception:
                            pass
                    page.wait_for_timeout(500)

                if password_attached:
                    self.append_idle_log("LMS login form (#input-password) attached successfully.")
                else:
                    self.append_idle_log("LMS login form (#input-password) attached check timed out. Proceeding with dynamic backup selectors...")

                filled = False
                submitted = False

                # 2. 최우선 모드: Javascript DOM Injection + 비가시 스타일 강제 파괴 (100% 무적 방식)
                if password_attached:
                    self.append_idle_log("Attempting direct Javascript-based credential injection (with hidden element styling overrides)...")
                    try:
                        import json
                        inject_script = f"""
                        (function() {{
                            var u = document.querySelector("#input-username");
                            var p = document.querySelector("#input-password");
                            if (u && p) {{
                                // 보이지 않는 속성을 강제로 해제하여 렌더링 지연 또는 봇 방어막 필터를 무력화
                                u.style.display = 'block';
                                u.style.visibility = 'visible';
                                u.style.opacity = '1';
                                p.style.display = 'block';
                                p.style.visibility = 'visible';
                                p.style.opacity = '1';

                                u.value = {json.dumps(username)};
                                p.value = {json.dumps(password)};

                                u.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                u.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                p.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                p.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                return true;
                            }}
                            return false;
                        }})()
                        """
                        if page.evaluate(inject_script):
                            filled = True
                            self.append_idle_log("Credentials injected successfully via DOM JS.")

                            # 곧바로 서브밋 시도
                            submit_script = """
                            (function() {
                                var btn = document.querySelector("input[name='loginbutton']") || document.querySelector("input[type='submit']") || document.querySelector(".btn-success");
                                if (btn) {
                                    btn.click();
                                    return true;
                                }
                                var form = document.querySelector("form.form-login") || document.querySelector("form");
                                if (form) {
                                    form.requestSubmit();
                                    return true;
                                }
                                return false;
                            })()
                            """
                            if page.evaluate(submit_script):
                                submitted = True
                                self.append_idle_log("Submitted login form successfully via DOM JS.")
                    except Exception as je:
                        self.append_idle_log(f"LMS login form submission fell back to Playwright: {type(je).__name__}")

                # 3. 백업 모드: Javascript 주입 실패 시 Playwright 물리 flow 동작
                if not filled:
                    password_input = None
                    try:
                        # 직접 ID로 플레이라이트 입력 시도
                        if password_attached:
                            username_input = page.locator("#input-username").first
                            password_input = page.locator("#input-password").first
                            username_input.fill(username, timeout=3000)
                            password_input.fill(password, timeout=3000)
                            filled = True
                            self.append_idle_log("Filled credentials directly using standard ID locators.")
                    except Exception as e:
                        self.append_idle_log(f"Direct ID fill failed: {e}. Trying dynamic backup locator finder...")

                    # 완전 백업: 유동 셀렉터 기반 자동 탐색
                    if not filled:
                        for _ in range(12):
                            password_input = first_visible_locator(page, password_selectors)
                            if password_input is not None:
                                break
                            page.wait_for_timeout(500)

                        if password_input is None:
                            self.append_idle_log(f"LMS automatic login could not find a password field. Current URL: {page.url}")
                            return {
                                "login_attempted": True,
                                "logged_in": False,
                                "needs_manual_login": True,
                                "login_page_detected": ("login" in page.url.lower() or "errorcode=" in page.url.lower()),
                            }

                        if not fill_first_visible(page, username_selectors, username):
                            self.append_idle_log("LMS automatic login could not find a username field.")
                            return {
                                "login_attempted": True,
                                "logged_in": False,
                                "needs_manual_login": True,
                                "login_page_detected": ("login" in page.url.lower() or "errorcode=" in page.url.lower()),
                            }

                        self.append_idle_log("Filling LMS credentials using backup locators...")
                        password_input.fill(password, timeout=3000)
                        filled = True

                # 4. 백업 서브밋 동작 (JS 서브밋이 성공하지 못한 경우)
                if filled and not submitted:
                    self.append_idle_log("Submitting login form using backup click locators...")
                    for selector in ["input[name='loginbutton']", "input[type='submit']", ".btn-success"]:
                        try:
                            btn = page.locator(selector).first
                            if btn.count() > 0:
                                btn.click(timeout=3000)
                                submitted = True
                                break
                        except Exception:
                            continue

                    if not submitted:
                        for selector in submit_selectors:
                            locator = first_visible_locator(page, [selector])
                            try:
                                if locator is not None:
                                    locator.click(timeout=3000)
                                    submitted = True
                                    break
                            except Exception:
                                continue
                    if not submitted:
                        try:
                            if password_attached:
                                page.locator("#input-password").first.press("Enter")
                            else:
                                password_input.press("Enter")
                            submitted = True
                        except Exception:
                            pass

                try:
                    page.wait_for_load_state("networkidle", timeout=10000)
                except PlaywrightTimeoutError:
                    pass
                page.wait_for_timeout(1500)

                # SSO/2차 인증 리다이렉트가 로드될 시간을 준다.
                for _ in range(20):
                    if self._lms_page_kind(page) in {"authenticated", "mfa"}:
                        break
                    page.wait_for_timeout(500)

                page_kind = self._lms_page_kind(page)
                logged_in = page_kind == "authenticated"
                mfa_in_window = page_kind == "mfa"

                if logged_in:
                    verified_kind = protected_kind()
                    logged_in = verified_kind == "authenticated"
                    if verified_kind == "mfa":
                        page_kind = "mfa"

                self.append_idle_log("LMS automatic login succeeded." if logged_in else "LMS automatic login failed or needs manual completion.")
                return {
                    "login_attempted": True,
                    "logged_in": bool(logged_in),
                    "needs_manual_login": not bool(logged_in),
                    "mfa_required": page_kind == "mfa",
                    "mfa_in_window": mfa_in_window,
                    "login_page_detected": ("login" in page.url.lower() or "errorcode=" in page.url.lower()),
                }
            finally:
                # Do not close a CDP-attached browser instance here; the background
                # downloader needs the same browser session immediately afterward.
                pass


    def is_lms_browser_running(self, timeout_seconds=1.5) -> bool:
        try:
            return bool(pipeline_utils.get_lms_browser_cdp_ws_url(timeout=timeout_seconds))
        except Exception:
            return False

    @staticmethod
    def _lms_browser_listener_pid() -> int:
        if os.name != "nt":
            return 0
        try:
            output = subprocess.check_output(
                ["netstat", "-ano", "-p", "tcp"],
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            return 0
        expected_port = f":{LMS_BROWSER_CDP_PORT}"
        for line in output.splitlines():
            fields = line.split()
            if (
                len(fields) >= 5
                and fields[0].upper() == "TCP"
                and fields[1].endswith(expected_port)
                and fields[3].upper() == "LISTENING"
            ):
                try:
                    return int(fields[4])
                except ValueError:
                    return 0
        return 0

    def _terminate_orphaned_lms_edge(self) -> bool:
        pid = self._lms_browser_listener_pid()
        if pid <= 0:
            return False
        try:
            task = subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            ).lstrip()
            if not task.lower().startswith('"msedge.exe"'):
                return False
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
            return result.returncode == 0
        except Exception:
            return False

    def wait_for_lms_browser(self, timeout_seconds=8.0) -> bool:
        deadline = time.time() + max(float(timeout_seconds), 0.5)
        while time.time() < deadline:
            if self.is_lms_browser_running():
                return True
            time.sleep(0.25)
        return self.is_lms_browser_running()

    def connect_lms_browser_over_cdp(self, chromium, timeout_seconds=10.0):
        """Connect after the Chromium HTTP endpoint and WebSocket are both ready."""
        deadline = time.monotonic() + max(float(timeout_seconds), 0.5)
        last_error = None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 and last_error is not None:
                break
            try:
                return chromium.connect_over_cdp(
                    pipeline_utils.get_lms_browser_cdp_ws_url(timeout=max(0.5, min(2.5, remaining))),
                    timeout=max(500, min(2500, int(max(remaining, 0.5) * 1000))),
                )
            except Exception as error:
                last_error = error
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                time.sleep(min(0.35, remaining))

        browser_name = str((self.lms_browser_info or {}).get("name") or "기본 브라우저")
        detail = str(last_error or "CDP connection timed out").strip()
        self.append_idle_log(
            f"기본 브라우저 {browser_name} 자동화 연결 실패: {detail}"
        )
        raise RuntimeError(
            f"기본 브라우저 {browser_name}를 자동 로그인에 연결하지 못했습니다: {detail}"
        ) from last_error

    def get_lms_saved_password(self) -> str:
        try:
            import keyring
        except Exception:
            return ""
        try:
            return keyring.get_password(LMS_KEYRING_SERVICE, LMS_KEYRING_USERNAME) or ""
        except Exception:
            return ""

    def has_lms_saved_password(self) -> bool:
        return bool(self.get_lms_saved_password())
