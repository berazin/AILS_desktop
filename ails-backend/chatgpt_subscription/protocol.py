"""Pinned official endpoints and safe errors; response bodies never enter logs."""
import json
import re
from pathlib import Path
from urllib.parse import urlparse


ISSUER = "https://auth.openai.com"
RESOURCE = "https://api.openai.com/v1"
AUTHORIZE = ISSUER + "/api/accounts/authorize"
TOKEN = ISSUER + "/api/accounts/oauth/token"
USAGE_URL = "https://chatgpt.com/#settings/Usage"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
TERMINAL_REFRESH_ERRORS = {"invalid_grant", "invalid_refresh_token", "token_expired",
                           "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"}


class ChatGPTError(RuntimeError):
    retryable = False

    def __init__(self, code, *, status=0, request_id="", param=""):
        # Only bounded machine identifiers, never remote error messages or tokens.
        self.code = code if re.fullmatch(r"[a-zA-Z0-9_.-]{1,100}", str(code)) else "request_failed"
        self.status = status
        self.status_code = status
        self.request_id = request_id if re.fullmatch(r"[a-zA-Z0-9_-]{1,150}", str(request_id)) else ""
        self.param = param if re.fullmatch(r"[a-zA-Z0-9_.\[\]-]{1,150}", str(param)) else ""
        messages = {
            "deployment_pending": "이 배포판의 ChatGPT 연동 자격·승인이 아직 확인되지 않았습니다.",
            "not_connected": "AI 설정에서 ChatGPT 계정을 연결해 주세요.",
            "permission_required": "ChatGPT 구독 사용 권한이 없습니다. AI 설정에서 권한을 허용해 주세요.",
            "reconnect_required": "ChatGPT 인증이 만료되거나 해제되었습니다. 다시 연결해 주세요.",
            "model_unavailable": "선택한 ChatGPT 모델을 사용할 수 없습니다. 모델 목록을 새로고침해 주세요.",
            "subscription_sharing_usage_limit_exceeded": "ChatGPT 사용 한도에 도달했습니다. ChatGPT 설정에서 앱 사용량을 확인해 주세요.",
            "subscription_sharing_user_not_eligible": "이 계정 또는 워크스페이스는 ChatGPT 구독 연동을 사용할 수 없습니다.",
            "unsupported_capability": "이 기능 또는 요청 옵션은 ChatGPT 구독 연동에서 지원하지 않습니다.",
            "verification_web_search_unsupported": "현재 ChatGPT 강의 정리 연동은 검증 웹 검색을 지원하지 않습니다. 강의 설정에서 웹 검색을 끄거나 해당 기능의 AI 공급자를 직접 변경해 주세요.",
            "stream_interrupted": "ChatGPT 응답이 완료되기 전에 연결이 끊겼습니다.",
            "response_incomplete": "ChatGPT 응답이 미완료 상태로 종료되었습니다.",
            "cancelled": "ChatGPT 요청이 취소되었습니다.",
            "access_denied": "ChatGPT 로그인이 취소되었거나 권한이 거부되었습니다.",
            "network_error": "ChatGPT 서버에 연결하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
        }
        message = messages.get(self.code, "ChatGPT 요청을 완료하지 못했습니다.")
        super().__init__(f"{message} [{self.code}]" + (f" (HTTP {status})" if status else ""))


def deployment():
    try:
        value = json.loads(Path(__file__).with_name("deployment.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"available": False, "client_id": ""}
    if not isinstance(value, dict):
        return {"available": False, "client_id": ""}
    # Release-owned file, never a user preference or arbitrary endpoint override.
    from edition_manifest import LOCAL_AI_SETTINGS_ENABLED
    eligibility = value.get("eligibility")
    client = "dynamic_agent_client"
    allowed = bool(LOCAL_AI_SETTINGS_ENABLED and eligibility == "local_development")
    if eligibility == "approved":
        client = str(value.get("client_id") or "")
        allowed = bool(LOCAL_AI_SETTINGS_ENABLED and value.get("approval_reference")
                       and re.fullmatch(r"oaiapp_[a-zA-Z0-9_-]+", client))
    return {"available": allowed, "client_id": client}


def require_deployment():
    result = deployment()
    if not result["available"]:
        raise ChatGPTError("deployment_pending")
    return result


def checked_auth_url(url):
    parsed = urlparse(str(url))
    if parsed.scheme != "https" or parsed.netloc != "auth.openai.com" or parsed.fragment:
        raise ChatGPTError("invalid_discovery")
    return url


def error_from_response(response):
    try:
        value = response.json()
    except ValueError:
        value = {}
    error = value.get("error") if isinstance(value, dict) else None
    code = error.get("code") if isinstance(error, dict) else error
    if not code:
        code = {401: "reconnect_required", 403: "permission_required"}.get(response.status_code, "request_failed")
    return ChatGPTError(code, status=response.status_code,
                        request_id=response.headers.get("x-request-id", ""),
                        param=error.get("param", "") if isinstance(error, dict) else "")


def http_json(method, url, **kwargs):
    import requests
    try:
        with requests.request(method, url, timeout=30, allow_redirects=False, **kwargs) as response:
            if response.status_code != 200:
                raise error_from_response(response)
            return response.json()
    except (requests.RequestException, ValueError):
        raise ChatGPTError("network_error") from None
