from __future__ import annotations

import os
from collections.abc import Iterable, Mapping


AUTH_CREDENTIAL_SERVICE = "AILS Auth"
AUTH_CREDENTIAL_KEYS = ("access_token", "refresh_token")


def _windows_keyring_backend():
    if os.name != "nt":
        raise RuntimeError("보안 자격 증명 저장소는 Windows Credential Manager에서만 사용할 수 있습니다.")
    try:
        import keyring
    except ImportError as error:
        raise RuntimeError("Windows Credential Manager 연동 모듈(keyring)이 설치되지 않았습니다.") from error

    backend = keyring.get_keyring()
    backend_type = type(backend)
    if backend_type.__module__ != "keyring.backends.Windows":
        raise RuntimeError(
            "Windows Credential Manager 백엔드를 사용할 수 없습니다: "
            f"{backend_type.__module__}.{backend_type.__name__}"
        )
    return backend


def _load_credentials(service: str, keys: Iterable[str]) -> dict[str, str]:
    backend = _windows_keyring_backend()
    credentials: dict[str, str] = {}
    for key in keys:
        try:
            credentials[str(key)] = backend.get_password(
                service,
                str(key),
            ) or ""
        except Exception as error:
            raise RuntimeError(
                f"Windows Credential Manager에서 자격증명을 읽지 못했습니다: {key}"
            ) from error
    return credentials


def _save_credentials(service: str, values: Mapping[str, object]) -> None:
    if not values:
        return
    backend = _windows_keyring_backend()
    for key, raw_value in values.items():
        username = str(key)
        value = str(raw_value or "")
        try:
            if value:
                backend.set_password(service, username, value)
                continue
            try:
                backend.delete_password(service, username)
            except Exception:
                if backend.get_password(service, username):
                    raise
        except Exception as error:
            action = "저장" if value else "삭제"
            raise RuntimeError(
                f"Windows Credential Manager에서 자격증명을 {action}하지 못했습니다: {username}"
            ) from error






def load_auth_credentials() -> dict[str, str]:
    return _load_credentials(AUTH_CREDENTIAL_SERVICE, AUTH_CREDENTIAL_KEYS)


def save_auth_credentials(values: Mapping[str, object]) -> None:
    _save_credentials(AUTH_CREDENTIAL_SERVICE, values)
