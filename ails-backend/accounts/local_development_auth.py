"""Local developer identity, separate from real account tokens and billing."""
import hashlib
import json
import os
from pathlib import Path
import tempfile


def profile_path():
    from common import BASE_EXE_DIR
    return Path(BASE_EXE_DIR) / "developer-local-account.json"


def status():
    try:
        profile = json.loads(profile_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        profile = {}
    name = str(profile.get("name") or "") if isinstance(profile, dict) else ""
    user_id = "local-development-" + hashlib.sha256(name.encode("utf-8")).hexdigest() if name else ""
    return {"mode": "personal", "configured": True, "authenticated": bool(name),
            "local_development": True, "email": name, "display_name": name,
            "user_id": user_id, "email_verified": False, "verification_required": False,
            "device_id": "local-development", "server_url": "", "credits": None,
            "settlements": None, "license": None, "license_active": False,
            "error": "", "login_pending": False}


def login(payload):
    # Any input is accepted. Passwords are deliberately neither read nor stored.
    name = str(payload.get("email") or payload.get("display_name") or "개발 사용자").strip()[:200] or "개발 사용자"
    target = profile_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent,
                                         prefix=".developer-account-", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump({"schema_version": 1, "name": name}, stream, ensure_ascii=False)
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return status()


def logout():
    profile_path().unlink(missing_ok=True)
    return status()
