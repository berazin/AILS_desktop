from __future__ import annotations

import json
import logging
import math
import os
import sys
import time
import urllib.parse
from contextlib import contextmanager
from typing import Mapping

import managed_direct
from ai_reasoning import REASONING_EFFORTS

import ai_model_selection
import credential_store
import server_config
import re
import threading
import uuid
from http import HTTPStatus
from urllib.parse import quote, urlparse


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading




# api_server에서 이동: 관리형 인증 HTTP 헬퍼와 검수 정책 검증
import urllib.error
import urllib.request
import ai_model_selection
import documents.problem_review_gateway

def normalize_managed_review_policy(value: Mapping) -> dict:
    """Validate the server-owned three-stage review route."""
    plan = value.get("review_plan")
    if not isinstance(plan, list) or len(plan) != 3:
        raise ManagedAuthError("AILS 관리자가 설정한 문제 검수 정책이 올바르지 않습니다.")
    normalized = []
    seen_models = set()
    for expected_role, item in zip(("primary", "secondary", "fallback"), plan):
        if not isinstance(item, Mapping) or str(item.get("role") or "") != expected_role:
            raise ManagedAuthError("AILS 관리자가 설정한 문제 검수 순서가 올바르지 않습니다.")
        model_id = str(item.get("model_id") or "").strip()
        if not ai_model_selection.is_managed_model_id(model_id) or model_id in seen_models:
            raise ManagedAuthError("AILS 관리자가 설정한 문제 검수 모델이 허용되지 않습니다.")
        seen_models.add(model_id)
        normalized.append({"role": expected_role, "model_id": model_id})
    try:
        revision = int(value.get("policy_revision") or value.get("revision") or 0)
        threshold = float(value.get("confidence_threshold", documents.problem_review_gateway.AUTO_APPLY_CONFIDENCE))
    except (TypeError, ValueError) as error:
        raise ManagedAuthError("AILS 문제 검수 정책 값이 올바르지 않습니다.") from error
    if revision <= 0 or not 0.0 <= threshold <= 1.0:
        raise ManagedAuthError("AILS 문제 검수 정책 값이 올바르지 않습니다.")
    return {
        "policy_revision": revision,
        "review_plan": normalized,
        "confidence_threshold": threshold,
        "primary_model": normalized[0]["model_id"],
        "secondary_model": normalized[1]["model_id"],
        "fallback_model": normalized[2]["model_id"],
        "routing_platform": str(value.get("routing_platform") or "").strip() or None,
        "workflow_models": dict(value.get("workflow_models") or {}) if isinstance(value.get("workflow_models"), Mapping) else {},
    }
class ManagedAuthError(RuntimeError):
    def __init__(self, message: str, *, status: int = 0, code: str = ""):
        super().__init__(message)
        self.status = status
        self.code = code


def _managed_auth_server_url(value: object) -> str:
    server_url = str(value or "").strip().rstrip("/")
    if not server_url:
        raise ValueError("AILS 인증 서버 URL을 설정해 주세요.")
    parsed = urlparse(server_url)
    local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not local_http:
        raise ValueError("AILS 인증 서버는 HTTPS URL이어야 합니다.")
    if not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("AILS 인증 서버 URL이 올바르지 않습니다.")
    return server_url


def _managed_auth_error_message(payload: object, fallback: str) -> str:
    if isinstance(payload, Mapping):
        error = payload.get("error")
        if isinstance(error, Mapping):
            code = str(error.get("code") or "")
            detail = str(error.get("message") or error.get("detail") or code or fallback)
            if code == "insufficient_credits":
                if "overage" in detail.casefold():
                    return "미정산된 AI 초과 사용금이 있습니다. 크레딧 지급 후 다시 시도해 주세요."
                return "관리형 AI 크레딧이 부족합니다. 설정에서 잔액을 확인해 주세요."
            if code == "billing_not_configured":
                return "결제 기능을 준비 중입니다."
            localized = {
                "email_registered": "이미 가입된 이메일입니다. 로그인해 주세요.",
                "recovery_email_registered": "이미 다른 계정에서 사용 중인 복구 이메일입니다.",
                "invalid_registration": "회원가입 정보를 확인해 주세요. 이름과 비밀번호 조건을 다시 확인해 주세요.",
                "consent_required": "회원가입하려면 이용약관과 개인정보처리방침에 동의해야 합니다.",
                "plan_not_available": "선택한 플랜은 현재 가입할 수 없습니다. 다른 플랜을 선택해 주세요.",
                "google_registration_required": "Google 계정으로 처음 가입하려면 회원가입 탭에서 약관·개인정보 동의가 필요합니다.",
                "billing_plans_invalid": "플랜 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
                "billing_provider_unavailable": "결제 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                "brandpay_not_configured": "등록 계좌 빠른 충전은 관리자 계약과 서버 설정이 완료된 뒤 사용할 수 있습니다.",
                "registered_account_not_found": "등록된 계좌를 찾지 못했습니다. 계좌를 다시 등록해 주세요.",
                "secondary_pin_confirmation_mismatch": "2차 비밀번호 확인이 일치하지 않습니다.",
                "secondary_pin_already_configured": "2차 비밀번호가 이미 설정되어 있습니다.",
                "secondary_pin_required": "빠른 충전용 2차 비밀번호를 먼저 설정해 주세요.",
                "secondary_pin_invalid": "2차 비밀번호가 올바르지 않습니다.",
                "secondary_pin_locked": "2차 비밀번호 입력 오류가 반복되어 15분 동안 잠겼습니다.",
                "credit_product_not_available": "선택한 크레딧 상품은 현재 구매할 수 없습니다.",
                "email_verification_required": "이메일 인증이 필요합니다. 받은 편지함을 확인하거나 인증 메일을 다시 보내 주세요.",
                "email_delivery_unavailable": "인증 메일 발송이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
                "email_delivery_failed": "인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
                "invalid_email_verification_token": "인증 링크가 만료되었거나 이미 사용되었습니다.",
                "invalid_signup_code": "인증번호가 올바르지 않거나 만료되었습니다.",
                "invalid_signup_verification": "이메일 인증이 만료되었습니다. 인증번호를 다시 받아 주세요.",
                "invalid_password_reset_token": "비밀번호 재설정 링크가 만료되었거나 이미 사용되었습니다.",
                "password_confirmation_mismatch": "새 비밀번호 확인이 일치하지 않습니다.",
                "invalid_password": "비밀번호는 12자 이상이어야 합니다.",
                "invalid_recovery_email": "복구 이메일을 확인해 주세요. 로그인 이메일과 다른 주소여야 합니다.",
                "feedback_delivery_unavailable": "피드백 메일 발송이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
                "feedback_delivery_failed": "피드백 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
                "invalid_feedback": "피드백 제목과 내용을 확인해 주세요.",
            }
            if code in localized:
                return localized[code]
            if "device is not active" in detail.casefold():
                return "이 장치의 인증이 유효하지 않습니다. AILS 계정에 다시 로그인해 주세요."
            if "license is not active" in detail.casefold() or code in {"license_not_active", "license_or_device_denied"}:
                return "라이선스가 만료되었거나 비활성 상태입니다. 계정 라이선스를 확인해 주세요."
            return detail[:500]
        msg = str(payload.get("detail") or payload.get("message") or error or fallback)
        if "license is not active" in msg.casefold():
            return "라이선스가 만료되었거나 비활성 상태입니다. 계정 라이선스를 확인해 주세요."
        return msg[:500]
    if "license is not active" in str(fallback).casefold():
        return "라이선스가 만료되었거나 비활성 상태입니다. 계정 라이선스를 확인해 주세요."
    return fallback


def _managed_auth_http_json(
    server_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: Mapping | None = None,
    access_token: str = "",
    timeout: int = 15,
) -> dict:
    from personal_mode import require_server_enabled
    require_server_enabled()
    url = _managed_auth_server_url(server_url) + "/" + str(path or "").lstrip("/")
    effective_payload = payload if payload is not None else ({} if method.upper() == "DELETE" and str(path or "").startswith("/ai/sessions/") else None)
    body = json.dumps(dict(effective_payload), ensure_ascii=False).encode("utf-8") if effective_payload is not None else None
    # Cloudflare가 인증 서버 앞단에서 Browser Integrity Check(Error 1010)로
    # Python-urllib 기본 UA를 봇 시그니처로 차단하므로 브라우저 UA를 보낸다.
    headers = {
        "Accept": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
        ),
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    attempts = 3 if method.upper() == "GET" else 1
    try:
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    response_body = response.read()
                    status = int(getattr(response, "status", 200) or 200)
                break
            except urllib.error.HTTPError:
                raise  # Auth/permission failures must follow the normal handler.
            except (OSError, TimeoutError) as error:
                if attempt + 1 == attempts:
                    raise
                _logger.warning("Managed auth read retry: method=%s path=%s attempt=%s error=%s",
                                method, urllib.parse.urlsplit(path).path, attempt + 1, type(error).__name__)
                time.sleep(0.5 * (attempt + 1))
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            error_payload = json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            error_payload = {}
        error_code = ""
        if isinstance(error_payload, Mapping):
            nested_error = error_payload.get("error")
            if isinstance(nested_error, Mapping):
                error_code = str(nested_error.get("code") or "")
            else:
                error_code = str(error_payload.get("code") or "")
        error_message = _managed_auth_error_message(
            error_payload,
            f"AILS 인증 서버 요청 실패: HTTP {error.code}",
        )
        status = int(error.code)
        if status >= 500 and error_message.casefold() in {
            "expired token",
            "invalid token signature",
            "malformed token",
            "unsupported token header",
            "invalid token claims",
        }:
            # Older deployed workers surfaced JWT decode failures as HTTP 500.
            # Treat those responses as auth failures so refresh/re-login can run.
            status = HTTPStatus.UNAUTHORIZED
            error_code = "authentication_required"
        raise ManagedAuthError(
            error_message,
            status=status,
            code=error_code,
        ) from error
    except (OSError, TimeoutError) as error:
        raise ManagedAuthError(
            f"AILS 인증 서버에 연결하지 못했습니다: {error} "
            f"({method} {urllib.parse.urlsplit(path).path}, 제한 {timeout}초, {attempts}회 시도)"
        ) from error
    if status == HTTPStatus.NO_CONTENT or not response_body:
        return {}
    try:
        result = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManagedAuthError("AILS 인증 서버 응답이 올바른 JSON이 아닙니다.") from error
    if not isinstance(result, dict):
        raise ManagedAuthError("AILS 인증 서버 응답은 JSON 객체여야 합니다.")
    return result


_logger = logging.getLogger(__name__)
