"""Compatibility exports. Implementation belongs to lms.browser_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("lms.browser_service"), name)

from bootstrap.service_adapter import service_call as _service_call
from .api_lms_courses import ApiLmsCourseMixin


class ApiLmsBrowserMixin(ApiLmsCourseMixin):
    """Stable API methods delegating to the lms_browser service."""
    @staticmethod
    def _lms_page_kind(page) -> str:
        return _import_module("lms.browser_service").LmsBrowserService._lms_page_kind(page)

    def get_lms_auth_status(self) -> dict:
        return _service_call(self, "lms_browser", 'get_lms_auth_status')

    def cancel_lms_auth(self, attempt_id: str) -> dict:
        return _service_call(self, "lms_browser", 'cancel_lms_auth', attempt_id)

    def _set_lms_auth_state(self, attempt: dict, state: str, message: str) -> bool:
        return _service_call(self, "lms_browser", '_set_lms_auth_state', attempt, state, message)

    def _close_lms_browser_unlocked(self):
        return _service_call(self, "lms_browser", '_close_lms_browser_unlocked')

    def close_lms_browser(self):
        return _service_call(self, "lms_browser", 'close_lms_browser')

    def _focus_lms_browser_window_unlocked(self):
        return _service_call(self, "lms_browser", '_focus_lms_browser_window_unlocked')

    def _set_lms_browser_visible(self, visible: bool) -> bool:
        return _service_call(self, "lms_browser", '_set_lms_browser_visible', visible)

    def save_lms_credentials(self, payload: dict) -> dict:
        return _service_call(self, "lms_browser", 'save_lms_credentials', payload)

    def open_lms_login_browser(self, *, force_new_window=False, headless=False, start_minimized=False, target_url=''):
        return _service_call(self, "lms_browser", 'open_lms_login_browser', force_new_window=force_new_window, headless=headless, start_minimized=start_minimized, target_url=target_url)

    def inject_lms_hidden_elements_viewer(self, context) -> None:
        return _service_call(self, "lms_browser", 'inject_lms_hidden_elements_viewer', context)

    def _bg_lms_browser_unhider_loop(self) -> None:
        return _service_call(self, "lms_browser", '_bg_lms_browser_unhider_loop')

    def ensure_lms_login_for_eclass(self, target_url: str='', cancel_event=None) -> dict:
        return _service_call(self, "lms_browser", 'ensure_lms_login_for_eclass', target_url, cancel_event)

    def _complete_lms_auth_attempt(self, target_url: str, attempt: dict) -> None:
        return _service_call(self, "lms_browser", '_complete_lms_auth_attempt', target_url, attempt)

    def _probe_lms_session(self, target_url: str) -> str:
        return _service_call(self, "lms_browser", '_probe_lms_session', target_url)

    def _open_mfa_in_lms_window(self) -> None:
        return _service_call(self, "lms_browser", '_open_mfa_in_lms_window')

    def _run_lms_login_flow(self, target_url: str, cancel_event, attempt: dict) -> str:
        return _service_call(self, "lms_browser", '_run_lms_login_flow', target_url, cancel_event, attempt)

    def attempt_lms_autologin(self, username: str, password: str, *, target_url: str='') -> dict:
        return _service_call(self, "lms_browser", 'attempt_lms_autologin', username, password, target_url=target_url)

    def is_lms_browser_running(self, timeout_seconds=1.5) -> bool:
        return _service_call(self, "lms_browser", 'is_lms_browser_running', timeout_seconds)

    @staticmethod
    def _lms_browser_listener_pid() -> int:
        return _import_module("lms.browser_service").LmsBrowserService._lms_browser_listener_pid()

    def _terminate_orphaned_lms_edge(self) -> bool:
        return _service_call(self, "lms_browser", '_terminate_orphaned_lms_edge')

    def wait_for_lms_browser(self, timeout_seconds=8.0) -> bool:
        return _service_call(self, "lms_browser", 'wait_for_lms_browser', timeout_seconds)

    def connect_lms_browser_over_cdp(self, chromium, timeout_seconds=10.0):
        return _service_call(self, "lms_browser", 'connect_lms_browser_over_cdp', chromium, timeout_seconds)

    def get_lms_saved_password(self) -> str:
        return _service_call(self, "lms_browser", 'get_lms_saved_password')

    def has_lms_saved_password(self) -> bool:
        return _service_call(self, "lms_browser", 'has_lms_saved_password')
