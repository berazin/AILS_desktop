"""ManagedAuthService: feature operations and owned state."""
from __future__ import annotations
from accounts.auth_support import (
    Any,
    Callable,
    HTTPStatus,
    ManagedAuthError,
    Mapping,
    REASONING_EFFORTS,
    _logger,
    _managed_auth_http_json,
    _managed_auth_server_url,
    ai_model_selection,
    contextmanager,
    credential_store,
    dataclass,
    managed_direct,
    os,
    quote,
    re,
    server_config,
    threading,
    time,
    urlparse,
    uuid,
)
from accounts.auth_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class ManagedAuthServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    get__chatbot_turn_cache: Callable[[], Any]
    clear_memory_service: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    get_lock: Callable[[], Any]
    selected_ai_model: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class ManagedAuthService:
    def __init__(self, ports: ManagedAuthServicePorts):
        self._ports = ports
        self.clear_memory_service = ports.clear_memory_service
        self.selected_ai_model = ports.selected_ai_model
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai
        self.managed_auth_lock = threading.RLock()
        self.managed_browser_auth = None
        self.managed_auth_context_local = threading.local()
        self.managed_session_auth_contexts = {}

    @property
    def _chatbot_turn_cache(self):
        return self._ports.get__chatbot_turn_cache()

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    @property
    def lock(self):
        return self._ports.get_lock()

    def _managed_auth_profile(self, payload: Mapping | None = None) -> tuple[str, str, str]:
        payload = payload if isinstance(payload, Mapping) else {}
        server_url = _managed_auth_server_url(server_config.DEFAULT_AILS_AUTH_SERVER_URL)
        email = str(payload.get("email") or self.config.get("ails_auth_email") or "").strip().casefold()
        if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("이메일 주소가 올바르지 않습니다.")
        device_id = str(self.config.get("ails_device_id") or "").strip()
        try:
            device_id = str(uuid.UUID(device_id))
        except (ValueError, AttributeError):
            device_id = str(uuid.uuid4())
        return server_url, email, device_id

    def _require_no_active_managed_sessions(self) -> None:
        self._ensure_managed_auth_state()
        with self.managed_auth_lock:
            if self.managed_session_auth_contexts:
                raise ManagedAuthError(
                    "관리형 AI 작업이 진행 중입니다. 작업을 취소하거나 완료한 뒤 계정을 변경해 주세요.",
                    status=HTTPStatus.CONFLICT,
                )

    def _save_managed_auth_profile(
        self,
        server_url: str,
        email: str,
        device_id: str,
    ) -> None:
        with self.lock:
            self.config = server_config.save_config({
                **self.config,
                "ails_auth_server_url": server_url,
                "ails_auth_email": email,
                "ails_device_id": device_id,
            })

    @staticmethod
    def _register_managed_device(server_url: str, access_token: str, device_id: str) -> None:
        _managed_auth_http_json(
            server_url,
            "/devices",
            method="POST",
            payload={
                "device_name": os.environ.get("COMPUTERNAME", "Windows PC")[:100],
                "device_id": device_id,
            },
            access_token=access_token,
        )

    @staticmethod
    def _managed_auth_tokens(result: Mapping, *, require_tokens: bool = True) -> dict[str, str]:
        access_token = str(result.get("access_token") or "").strip()
        refresh_token = str(result.get("refresh_token") or "").strip()
        if require_tokens and (not access_token or not refresh_token):
            raise ManagedAuthError("AILS 인증 서버가 access_token과 refresh_token을 반환하지 않았습니다.")
        return {"access_token": access_token, "refresh_token": refresh_token}

    @classmethod
    def _save_managed_auth_tokens(cls, result: Mapping, *, require_tokens: bool = True) -> dict[str, str]:
        tokens = cls._managed_auth_tokens(result, require_tokens=require_tokens)
        updates = {}
        if tokens["access_token"]:
            updates["access_token"] = tokens["access_token"]
        if tokens["refresh_token"]:
            updates["refresh_token"] = tokens["refresh_token"]
        if updates:
            credential_store.save_auth_credentials(updates)
        return tokens

    def _refresh_managed_auth(self, server_url: str, refresh_token: str) -> dict[str, str]:
        result = _managed_auth_http_json(
            server_url,
            "/auth/refresh",
            method="POST",
            payload={"refresh_token": refresh_token},
        )
        return self._save_managed_auth_tokens({
            **result,
            "refresh_token": result.get("refresh_token") or refresh_token,
        })

    def _managed_auth_request(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: Mapping | None = None,
        retry_auth: bool = True,
    ) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        from settings.development_mode import enabled as local_development
        if local_development():
            from accounts import local_development_auth
            status = local_development_auth.status()
            if path == "/me" and method == "GET":
                if not status["authenticated"]:
                    raise ManagedAuthError("로컬 개발 계정으로 로그인해 주세요.", status=401)
                return {"user": {key: status[key] for key in ("user_id", "email", "display_name")},
                        "local_development": True}
            raise ManagedAuthError("서버 없는 개발 모드입니다. AI 설정에서 ChatGPT 연결 또는 로컬 모델을 사용해 주세요.", status=503)
        # Creating a managed session reserves credits. Never retry a timed-out
        # POST blindly: the Worker may have committed the reservation already.
        request_timeout = 60 if method == "POST" and path in {"/ai/sessions", "/ai/leases"} else 15
        self._ensure_managed_auth_state()
        self.managed_auth_context_local.value = None
        server_url, _email, _device_id = self._managed_auth_profile()
        with self.managed_auth_lock:
            credentials = credential_store.load_auth_credentials()
            access_token = str(credentials.get("access_token") or "").strip()
            refresh_token = str(credentials.get("refresh_token") or "").strip()

            def clear_if_current() -> None:
                latest = credential_store.load_auth_credentials()
                if str(latest.get("refresh_token") or "").strip() == refresh_token:
                    credential_store.save_auth_credentials({"access_token": "", "refresh_token": ""})

            if not access_token:
                if not refresh_token:
                    raise ManagedAuthError("AILS 계정에 로그인해 주세요.", status=401)
                try:
                    tokens = self._refresh_managed_auth(server_url, refresh_token)
                except ManagedAuthError as refresh_error:
                    if refresh_error.status == HTTPStatus.UNAUTHORIZED:
                        clear_if_current()
                    raise
                access_token = tokens["access_token"]
                refresh_token = tokens["refresh_token"]
            try:
                result = _managed_auth_http_json(
                    server_url,
                    path,
                    method=method,
                    payload=payload,
                    access_token=access_token,
                    timeout=request_timeout,
                )
                self.managed_auth_context_local.value = {
                    "server_url": server_url,
                    "access_token": access_token,
                    "refresh_token": refresh_token,
                }
                return result
            except ManagedAuthError as error:
                if (
                    error.status == HTTPStatus.FORBIDDEN
                    and "device is not active" in str(error).casefold()
                    and retry_auth
                    and _device_id
                    and access_token
                ):
                    try:
                        self._register_managed_device(server_url, access_token, _device_id)
                        result = _managed_auth_http_json(
                            server_url,
                            path,
                            method=method,
                            payload=payload,
                            access_token=access_token,
                            timeout=request_timeout,
                        )
                        self.managed_auth_context_local.value = {
                            "server_url": server_url,
                            "access_token": access_token,
                            "refresh_token": refresh_token,
                        }
                        return result
                    except ManagedAuthError:
                        raise error
                if error.status != HTTPStatus.UNAUTHORIZED:
                    raise
                if not retry_auth or not refresh_token:
                    clear_if_current()
                    raise
                try:
                    tokens = self._refresh_managed_auth(server_url, refresh_token)
                except ManagedAuthError as refresh_error:
                    if refresh_error.status == HTTPStatus.UNAUTHORIZED:
                        clear_if_current()
                    raise
                retry_payload = payload
                if path == "/auth/logout" and isinstance(payload, Mapping):
                    retry_payload = {**payload, "refresh_token": tokens["refresh_token"]}
                result = _managed_auth_http_json(
                    server_url,
                    path,
                    method=method,
                    payload=retry_payload,
                    access_token=tokens["access_token"],
                    timeout=request_timeout,
                )
                self.managed_auth_context_local.value = {
                    "server_url": server_url,
                    **tokens,
                }
                return result

    def managed_auth_register(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        self._ensure_managed_auth_state()
        self._require_no_active_managed_sessions()
        server_url, email, device_id = self._managed_auth_profile(payload)
        password = str(payload.get("password") or "")
        password_confirmation = str(payload.get("password_confirmation") or "")
        display_name = " ".join(str(payload.get("display_name") or "").split())
        signup_token = str(payload.get("signup_token") or "").strip()
        if not email or not password:
            raise ValueError("이메일과 비밀번호를 입력해 주세요.")
        if not display_name or len(display_name) > 80:
            raise ValueError("이름을 80자 이내로 입력해 주세요.")
        if len(signup_token) < 20:
            raise ValueError("이메일 인증을 먼저 완료해 주세요.")
        if password != password_confirmation:
            raise ValueError("비밀번호 확인이 일치하지 않습니다.")
        if payload.get("age_accepted") is not True or payload.get("terms_accepted") is not True or payload.get("privacy_accepted") is not True:
            raise ValueError("만 14세 이상 확인과 필수 약관에 동의해 주세요.")
        with self.managed_auth_lock:
            result = _managed_auth_http_json(
                server_url,
                "/auth/register",
                method="POST",
                payload={
                    "email": email,
                    "password": password,
                    "display_name": display_name,
                    "signup_token": signup_token,
                    "age_accepted": True,
                    "terms_accepted": True,
                    "privacy_accepted": True,
                    "marketing_accepted": payload.get("marketing_accepted") is True,
                    "data_improvement_accepted": payload.get("data_improvement_accepted") is True,
                },
            )
            tokens = self._managed_auth_tokens(result)
            self._register_managed_device(server_url, tokens["access_token"], device_id)
            self._save_managed_auth_profile(server_url, email, device_id)
            try:
                credential_store.save_auth_credentials(tokens)
            except Exception:
                credential_store.save_auth_credentials({"access_token": "", "refresh_token": ""})
                raise
        self.clear_memory_service()
        return self.managed_auth_status()

    def managed_auth_start_signup_email(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        server_url, email, _device_id = self._managed_auth_profile(payload)
        if not email:
            raise ValueError("이메일을 입력해 주세요.")
        result = _managed_auth_http_json(
            server_url,
            "/auth/signup/email",
            method="POST",
            payload={"email": email},
        )
        signup_token = str(result.get("signup_token") or "")
        if len(signup_token) < 20:
            raise ManagedAuthError("AILS 인증 서버가 유효한 회원가입 인증 정보를 반환하지 않았습니다.")
        return {"signup_token": signup_token, "expires_at": str(result.get("expires_at") or "")}

    def managed_auth_verify_signup_email(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        server_url, email, _device_id = self._managed_auth_profile(payload)
        signup_token = str(payload.get("signup_token") or "").strip()
        code = str(payload.get("code") or "").strip()
        if len(signup_token) < 20 or not re.fullmatch(r"\d{6}", code):
            raise ValueError("6자리 이메일 인증번호를 입력해 주세요.")
        result = _managed_auth_http_json(
            server_url,
            "/auth/signup/email/verify",
            method="POST",
            payload={"signup_token": signup_token, "code": code},
        )
        if str(result.get("status") or "") != "verified" or str(result.get("email") or "").casefold() != email.casefold():
            raise ManagedAuthError("AILS 인증 서버가 이메일 인증 결과를 확인하지 못했습니다.")
        return {"status": "verified", "email": email}

    def managed_auth_resend_verification(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        server_url, email, _device_id = self._managed_auth_profile(payload)
        if not email:
            raise ValueError("이메일을 입력해 주세요.")
        result = _managed_auth_http_json(
            server_url,
            "/auth/email/verification/resend",
            method="POST",
            payload={"email": email},
        )
        return {"status": str(result.get("status") or "accepted")}

    def managed_auth_request_password_reset(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        server_url, email, _device_id = self._managed_auth_profile(payload)
        if not email:
            raise ValueError("이메일을 입력해 주세요.")
        result = _managed_auth_http_json(
            server_url,
            "/auth/password/reset/request",
            method="POST",
            payload={"email": email},
        )
        return {"status": str(result.get("status") or "accepted")}

    def managed_auth_request_id_recovery(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        server_url, _email, _device_id = self._managed_auth_profile(payload)
        recovery_email = str(payload.get("recovery_email") or "").strip().casefold()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recovery_email):
            raise ValueError("복구 이메일을 입력해 주세요.")
        result = _managed_auth_http_json(
            server_url,
            "/auth/account/id-recovery/request",
            method="POST",
            payload={"email": recovery_email},
        )
        return {"status": str(result.get("status") or "accepted")}

    def managed_auth_plans(self) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        server_url, _email, _device_id = self._managed_auth_profile()
        result = _managed_auth_http_json(server_url, "/plans")
        plans = result.get("plans")
        if not isinstance(plans, list):
            raise ManagedAuthError("AILS 인증 서버가 유효한 플랜 목록을 반환하지 않았습니다.")
        return {
            "revision": int(result.get("revision") or 0),
            "billing_configured": result.get("billing_configured") is True,
            "plans": [item for item in plans if isinstance(item, Mapping) and item.get("enabled") is not False],
        }

    def managed_auth_checkout(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        plan_id = str(payload.get("plan_id") or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", plan_id):
            raise ValueError("결제할 플랜을 선택해 주세요.")
        result = self._managed_auth_request(
            "/billing/checkout",
            method="POST",
            payload={"plan_id": plan_id},
        )
        checkout_url = str(result.get("checkout_url") or "").strip()
        parsed = urlparse(checkout_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ManagedAuthError("AILS 인증 서버가 유효한 결제 주소를 반환하지 않았습니다.")
        return {"checkout_url": checkout_url}

    def managed_auth_credit_payment_status(self) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        result = self._managed_auth_request("/billing/credit-payment")
        accounts = result.get("accounts")
        if not isinstance(accounts, list):
            raise ManagedAuthError("AILS 인증 서버가 유효한 등록 계좌 상태를 반환하지 않았습니다.")
        return {
            "configured": result.get("configured") is True,
            "secondary_pin_configured": result.get("secondary_pin_configured") is True,
            "secondary_pin_locked_until": result.get("secondary_pin_locked_until"),
            "ready": result.get("ready") is True,
            "accounts": [
                {
                    "id": str(item.get("id") or ""),
                    "name": str(item.get("name") or "등록 계좌")[:80],
                    "bank_code": str(item.get("bank_code") or "")[:8],
                    "last4": str(item.get("last4") or "")[-4:],
                }
                for item in accounts
                if isinstance(item, Mapping) and item.get("id")
            ],
        }

    def managed_auth_set_secondary_pin(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        pin = str(payload.get("pin") or "")
        confirmation = str(payload.get("pin_confirmation") or "")
        if not re.fullmatch(r"\d{6}", pin) or not re.fullmatch(r"\d{6}", confirmation):
            raise ValueError("2차 비밀번호는 숫자 6자리여야 합니다.")
        return self._managed_auth_request(
            "/billing/secondary-pin", method="POST",
            payload={"pin": pin, "pin_confirmation": confirmation},
        )

    def managed_auth_start_account_registration(self) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        result = self._managed_auth_request("/billing/brandpay/registration", method="POST", payload={})
        registration_url = str(result.get("registration_url") or "").strip()
        parsed = urlparse(registration_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ManagedAuthError("AILS 인증 서버가 유효한 계좌 등록 주소를 반환하지 않았습니다.")
        return {"registration_url": registration_url}

    def managed_auth_charge_registered_account(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        plan_id = str(payload.get("plan_id") or "").strip()
        account_id = str(payload.get("account_id") or "").strip()
        pin = str(payload.get("secondary_pin") or "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", plan_id):
            raise ValueError("충전할 크레딧 상품을 선택해 주세요.")
        if not account_id or len(account_id) > 200:
            raise ValueError("등록 계좌를 선택해 주세요.")
        if not re.fullmatch(r"\d{6}", pin):
            raise ValueError("2차 비밀번호는 숫자 6자리여야 합니다.")
        result = self._managed_auth_request(
            "/billing/brandpay/charge", method="POST",
            payload={"plan_id": plan_id, "account_id": account_id, "secondary_pin": pin},
            retry_auth=False,
        )
        if result.get("status") != "completed" or not isinstance(result.get("credits"), Mapping):
            raise ManagedAuthError("AILS 인증 서버가 빠른 충전 완료를 확인하지 못했습니다.")
        return result

    def managed_auth_select_plan(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        plan_id = str(payload.get("plan_id") or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", plan_id):
            raise ValueError("플랜을 선택해 주세요.")
        result = self._managed_auth_request(
            "/me/plan",
            method="POST",
            payload={"plan_id": plan_id},
        )
        if str(result.get("requested_plan_id") or "") != plan_id:
            raise ManagedAuthError("AILS 인증 서버가 플랜 선택 결과를 확인하지 못했습니다.")
        return self.managed_auth_status()

    def submit_feedback(self, payload: Mapping) -> dict:
        category = str(payload.get("category") or "").strip()
        title = str(payload.get("title") or "").strip()
        body = str(payload.get("body") or "").strip()
        if category not in {"bug", "feature", "usability", "ai_output", "other"}:
            raise ValueError("피드백 유형을 확인해 주세요.")
        if not title or len(title) > 120:
            raise ValueError("피드백 제목을 120자 이내로 입력해 주세요.")
        if not body or len(body) > 6_000:
            raise ValueError("피드백 내용을 6000자 이내로 입력해 주세요.")
        result = self._managed_auth_request(
            "/feedback",
            method="POST",
            payload={"category": category, "title": title, "body": body},
        )
        if result.get("status") != "sent":
            raise ManagedAuthError("AILS 인증 서버가 피드백 발송을 확인하지 못했습니다.")
        return {"status": "sent"}

    def managed_auth_login(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        from settings.development_mode import enabled as local_development
        if local_development():
            from accounts import local_development_auth
            with self.managed_auth_lock:
                status = local_development_auth.login(payload)
            self.clear_memory_service()
            return status
        self._ensure_managed_auth_state()
        self._require_no_active_managed_sessions()
        server_url, email, device_id = self._managed_auth_profile(payload)
        password = str(payload.get("password") or "")
        if not email or not password:
            raise ValueError("이메일과 비밀번호를 입력해 주세요.")
        with self.managed_auth_lock:
            result = _managed_auth_http_json(
                server_url,
                "/auth/login",
                method="POST",
                payload={"email": email, "password": password},
            )
            tokens = self._managed_auth_tokens(result)
            self._register_managed_device(server_url, tokens["access_token"], device_id)
            self._save_managed_auth_profile(server_url, email, device_id)
            try:
                credential_store.save_auth_credentials(tokens)
            except Exception:
                credential_store.save_auth_credentials({"access_token": "", "refresh_token": ""})
                raise
        self.clear_memory_service()
        return self.managed_auth_status()

    def managed_auth_logout(self) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        from settings.development_mode import enabled as local_development
        if local_development():
            from accounts import local_development_auth
            with self.managed_auth_lock:
                status = local_development_auth.logout()
            self.clear_memory_service()
            return status
        import provider_credentials
        self._ensure_managed_auth_state()
        self._require_no_active_managed_sessions()
        provider_credentials.clear()
        # 계정이 바뀌면 턴 조립 캐시의 문맥이 재사용되지 않게 즉시 비운다.
        turn_cache = getattr(self, "_chatbot_turn_cache", None)
        if turn_cache is not None:
            turn_cache.clear()
        warning = ""
        with self.managed_auth_lock:
            credentials = credential_store.load_auth_credentials()
            access_token = str(credentials.get("access_token") or "").strip()
            refresh_token = str(credentials.get("refresh_token") or "").strip()
            try:
                if access_token:
                    self._managed_auth_request(
                        "/auth/logout",
                        method="POST",
                        payload={"refresh_token": refresh_token},
                    )
            except Exception as error:
                warning = str(error)[:500]
            finally:
                credential_store.save_auth_credentials({"access_token": "", "refresh_token": ""})
        self.clear_memory_service()
        return {**self.managed_auth_status(validate_remote=False), "warning": warning}

    def managed_auth_browser_start(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        """Start a browser login without exposing the one-time poll secret to the renderer."""
        self._ensure_managed_auth_state()
        self._require_no_active_managed_sessions()
        server_url, _email, device_id = self._managed_auth_profile(payload)
        requested_generation = str(payload.get("generation") or "").strip()
        if requested_generation:
            try:
                generation = str(uuid.UUID(requested_generation))
            except ValueError as error:
                raise ValueError("Google 로그인 요청 식별자가 올바르지 않습니다.") from error
        else:
            generation = str(uuid.uuid4())
        with self.managed_auth_lock:
            previous = self.managed_browser_auth
            if isinstance(previous, Mapping) and isinstance(previous.get("cancel_event"), threading.Event):
                previous["cancel_event"].set()
            result = _managed_auth_http_json(
                server_url,
                "/auth/browser/start",
                method="POST",
                payload={},
            )
            request_id = str(result.get("request_id") or "").strip()
            poll_token = str(result.get("poll_token") or "").strip()
            login_url = str(result.get("login_url") or "").strip()
            expires_at = str(result.get("expires_at") or "").strip()
            expected = urlparse(server_url)
            opened = urlparse(login_url)
            direct_google = (
                opened.scheme == "https"
                and opened.netloc.casefold() == "accounts.google.com"
                and opened.path == "/o/oauth2/v2/auth"
            )
            if (
                not request_id
                or not poll_token
                or not login_url
                or (not direct_google and (opened.scheme != expected.scheme or opened.netloc != expected.netloc))
            ):
                raise ManagedAuthError("AILS 인증 서버가 유효한 브라우저 로그인 정보를 반환하지 않았습니다.")
            self.managed_browser_auth = {
                "generation": generation,
                "cancel_event": threading.Event(),
                "server_url": server_url,
                "device_id": device_id,
                "request_id": request_id,
                "poll_token": poll_token,
                "expires_at": expires_at,
            }
        return {
            "status": "pending",
            "generation": generation,
            "login_url": login_url,
            "expires_at": expires_at,
        }

    def managed_auth_browser_cancel(self, payload: Mapping) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        """Cancel only the matching local browser-login generation."""
        self._ensure_managed_auth_state()
        generation = str(payload.get("generation") or "").strip()
        cancelled = False
        # Set the event before waiting for the auth lock. An in-flight remote
        # poll can then observe cancellation before committing credentials.
        pending = self.managed_browser_auth
        if (
            generation
            and isinstance(pending, Mapping)
            and str(pending.get("generation") or "") == generation
            and isinstance(pending.get("cancel_event"), threading.Event)
        ):
            pending["cancel_event"].set()
        with self.managed_auth_lock:
            current = self.managed_browser_auth
            if (
                generation
                and isinstance(current, Mapping)
                and str(current.get("generation") or "") == generation
            ):
                cancel_event = current.get("cancel_event")
                if isinstance(cancel_event, threading.Event):
                    cancel_event.set()
                self.managed_browser_auth = None
                cancelled = True
            if (
                generation
                and isinstance(pending, Mapping)
                and str(pending.get("generation") or "") == generation
                and bool(pending.get("credentials_committed"))
            ):
                self._rollback_cancelled_browser_auth(pending)
                cancelled = True
        return {
            **self.managed_auth_status(validate_remote=False),
            "login_pending": bool(self.managed_browser_auth),
            "cancelled": cancelled,
        }

    def managed_auth_browser_poll(self) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        self._ensure_managed_auth_state()
        with self.managed_auth_lock:
            pending = self.managed_browser_auth
            if not isinstance(pending, Mapping):
                return {**self.managed_auth_status(validate_remote=False), "login_pending": False}
        cancel_event = pending.get("cancel_event")
        generation = str(pending.get("generation") or "")
        try:
            result = _managed_auth_http_json(
                str(pending["server_url"]),
                "/auth/browser/poll",
                method="POST",
                payload={
                    "request_id": pending["request_id"],
                    "poll_token": pending["poll_token"],
                },
            )
        except Exception:
            if isinstance(cancel_event, threading.Event) and cancel_event.is_set():
                return {**self.managed_auth_status(validate_remote=False), "login_pending": False, "cancelled": True}
            raise
        with self.managed_auth_lock:
            current = self.managed_browser_auth
            current_generation = str(current.get("generation") or "") if isinstance(current, Mapping) else ""
            if (
                current_generation != generation
                or (isinstance(cancel_event, threading.Event) and cancel_event.is_set())
            ):
                return {
                    **self.managed_auth_status(validate_remote=False),
                    "login_pending": bool(current),
                    "cancelled": True,
                }
            if str(result.get("status") or "pending") == "pending":
                return {
                    **self.managed_auth_status(validate_remote=False),
                    "login_pending": True,
                }
            tokens = self._managed_auth_tokens(result)
            email = str(result.get("email") or "").strip().casefold()
        self._register_managed_device(
            str(pending["server_url"]),
            tokens["access_token"],
            str(pending["device_id"]),
        )
        with self.managed_auth_lock:
            current = self.managed_browser_auth
            current_generation = str(current.get("generation") or "") if isinstance(current, Mapping) else ""
            if (
                current_generation != generation
                or (isinstance(cancel_event, threading.Event) and cancel_event.is_set())
            ):
                return {
                    **self.managed_auth_status(validate_remote=False),
                    "login_pending": bool(current),
                    "cancelled": True,
                }
            self._require_no_active_managed_sessions()
            pending["previous_credentials"] = credential_store.load_auth_credentials()
            pending["previous_profile"] = {
                key: self.config.get(key)
                for key in (
                    "ails_auth_server_url",
                    "ails_auth_email",
                    "ails_device_id",
                )
            }
            self._save_managed_auth_profile(
                str(pending["server_url"]),
                email,
                str(pending["device_id"]),
            )
            pending["profile_committed"] = True
            if isinstance(cancel_event, threading.Event) and cancel_event.is_set():
                self._rollback_cancelled_browser_auth(pending)
                self.managed_browser_auth = None
                return {**self.managed_auth_status(validate_remote=False), "login_pending": False, "cancelled": True}
            try:
                # Mark before the two-entry Credential Manager write so a
                # partial write is restored if its second entry fails.
                pending["credentials_committed"] = True
                credential_store.save_auth_credentials(tokens)
                if isinstance(cancel_event, threading.Event) and cancel_event.is_set():
                    self._rollback_cancelled_browser_auth(pending)
                    return {**self.managed_auth_status(validate_remote=False), "login_pending": False, "cancelled": True}
            except Exception:
                self._rollback_cancelled_browser_auth(pending)
                raise
            finally:
                self.managed_browser_auth = None
        self.clear_memory_service()
        return {**self.managed_auth_status(), "login_pending": False}

    def _rollback_cancelled_browser_auth(self, pending: Mapping) -> None:
        if bool(pending.get("credentials_committed")):
            previous_credentials = pending.get("previous_credentials")
            if isinstance(previous_credentials, Mapping):
                credential_store.save_auth_credentials(previous_credentials)
            pending["credentials_committed"] = False
        if bool(pending.get("profile_committed")):
            previous_profile = pending.get("previous_profile")
            if isinstance(previous_profile, Mapping):
                with self.lock:
                    self.config = server_config.save_config({**self.config, **previous_profile})
            pending["profile_committed"] = False

    def managed_auth_status(self, *, validate_remote: bool = True) -> dict:
        from personal_mode import require_server_enabled
        require_server_enabled()
        from settings.development_mode import enabled as local_development
        if local_development():
            from accounts import local_development_auth
            return local_development_auth.status()
        self._ensure_managed_auth_state()
        mode = "managed" if self.workflow_uses_managed_ai("chatbot") else "personal"
        server_url = server_config.DEFAULT_AILS_AUTH_SERVER_URL
        email = str(self.config.get("ails_auth_email") or "")
        device_id = str(self.config.get("ails_device_id") or "")
        credentials = credential_store.load_auth_credentials()
        authenticated = bool(credentials.get("refresh_token"))
        error = ""
        credits = None
        settlements = None
        license_data = None
        license_active = False
        display_name = ""
        requested_plan_id = ""
        email_verified = False
        if authenticated and validate_remote:
            try:
                result = self._managed_auth_request("/me")
                user = result.get("user") if isinstance(result.get("user"), Mapping) else result
                if isinstance(user, Mapping):
                    email = str(user.get("email") or email)
                    display_name = str(user.get("display_name") or "")
                    requested_plan_id = str(user.get("requested_plan_id") or "")
                    email_verified = user.get("email_verified") is True
            except Exception as status_error:
                # Preserve a session through transient remote failures, but let an
                # invalid refresh token clear the stored session in the request path.
                error = str(status_error)[:500]
                credentials = credential_store.load_auth_credentials()
                authenticated = bool(credentials.get("refresh_token"))
            if authenticated:
                try:
                    result = self._managed_auth_request("/credits")
                    credits = {
                        key: max(0, int(result.get(key) or 0))
                        for key in (
                            "available_microusd",
                            "reserved_microusd",
                            "spent_microusd",
                            "debt_microusd",
                        )
                    }
                except Exception as credit_error:
                    error = f"크레딧 잔액을 불러오지 못했습니다: {str(credit_error)[:400]}"
                try:
                    result = self._managed_auth_request("/ai/settlements")
                    if not isinstance(result, Mapping) or type(result.get("pending_count")) is not int or result["pending_count"] < 0:
                        raise ValueError("Invalid settlement status")
                    settlements = {key: max(0, int(result.get(key) or 0)) for key in
                                   ("pending_count", "held_microusd", "observed_usage_microusd")}
                    settlements["status"] = "checking_provider" if result.get("automatic_checking") is True else "paused"
                except Exception:
                    settlements = {"status": "unavailable"}
                try:
                    result = self._managed_auth_request("/license")
                    if isinstance(result, Mapping):
                        license_data = {
                            "license_type": str(result.get("license_type") or ""),
                            "status": str(result.get("status") or ""),
                            "expires_at": str(result.get("expires_at") or ""),
                        }
                        expires_at = str(result.get("expires_at") or "")
                        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        if license_data["status"] == "active" and (not expires_at or expires_at > now_iso):
                            license_active = True
                except Exception:
                    pass
        credentials = credential_store.load_auth_credentials()
        authenticated = bool(credentials.get("refresh_token"))
        return {
            "mode": mode,
            "configured": bool(server_url),
            "authenticated": authenticated,
            "email": email,
            "display_name": display_name,
            "requested_plan_id": requested_plan_id,
            "email_verified": email_verified,
            "device_id": device_id,
            "server_url": server_url,
            "credits": credits,
            "settlements": settlements,
            "license": license_data,
            "license_active": license_active,
            "error": error,
            "login_pending": bool(self.managed_browser_auth),
        }

    def _has_usable_managed_credits(self, auth_status: Mapping | None = None) -> bool:
        status = auth_status if isinstance(auth_status, Mapping) else self.managed_auth_status()
        if not status.get("authenticated"):
            return False
        if status.get("license_active") is False:
            return False
        credits = status.get("credits")
        if isinstance(credits, Mapping) and int(credits.get("available_microusd") or 0) <= 0:
            return False
        return True

    def _ensure_managed_auth_state(self) -> None:
        if not hasattr(self, "managed_auth_lock"):
            self.managed_auth_lock = threading.RLock()
        if not hasattr(self, "managed_browser_auth"):
            self.managed_browser_auth = None
        if not hasattr(self, "managed_auth_context_local"):
            self.managed_auth_context_local = threading.local()
        if not hasattr(self, "managed_session_auth_contexts"):
            self.managed_session_auth_contexts = {}

    def acquire_managed_ai_session(
        self,
        estimated_cost_usd: float,
        *,
        policy_revision: int | None = None,
    ) -> dict:
        if self.selected_ai_model("problem_review")["mode"] == "chatgpt":
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.protocol import ChatGPTError
            raise ChatGPTError("unsupported_capability")
        import client_ai_sessions
        return client_ai_sessions.acquire(self, "problem_review", estimated_cost_usd, policy_revision=policy_revision)

    def get_managed_ai_session_result(self, session_id: str) -> dict:
        if str(session_id).startswith("lease-"):
            result = self._managed_auth_request("/ai/leases/" + quote(session_id[6:], safe=""), method="GET")
            return {**result, "session_id": session_id, "status": "closing" if result.get("settlement_pending") else "completed"}
        if str(session_id).startswith("chatgpt-local-"):
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.protocol import ChatGPTError
            raise ChatGPTError("unsupported_capability")
        if managed_direct.receipt_needs_submission(str(session_id)):
            return self.finish_managed_ai_session(session_id)
        return self._managed_auth_request(f"/ai/sessions/{quote(str(session_id), safe='')}", method="GET")

    def finish_managed_ai_session(self, session_id: str) -> dict | None:
        if str(session_id).startswith("lease-"):
            import provider_credentials
            provider_credentials.close(session_id)
            try:
                result = self._managed_auth_request("/ai/leases/" + quote(session_id[6:], safe=""), method="DELETE")
            except ManagedAuthError:
                # The completed inference must not become a failed answer that
                # invites a second paid request. Native expiry and the durable
                # server reconciler still revoke; never claim closure/refund.
                return {"session_id": session_id, "status": "closing", "settlement_pending": True,
                        "closure_pending": True, "reason": "server_confirmation_pending"}
            return {**result, "session_id": session_id, "status": "closing" if result.get("settlement_pending") else "completed"}
        if str(session_id).startswith("chatgpt-local-"):
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription import runtime
            runtime.finish(session_id)
            return None
        session_id = str(session_id or "").strip()
        if not session_id:
            return
        self._ensure_managed_auth_state()
        path = f"/ai/sessions/{quote(session_id, safe='')}"
        direct_receipt = managed_direct.close_receipt(session_id)
        receipt_options = {"payload": direct_receipt} if direct_receipt is not None else {}
        with self.managed_auth_lock:
            context = dict(self.managed_session_auth_contexts.get(session_id) or {})
            if not context:
                result = self._managed_auth_request(path, method="DELETE", **receipt_options)
                managed_direct.receipt_submitted(session_id)
                return result
            server_url = str(context.get("server_url") or "")
            access_token = str(context.get("access_token") or "")
            try:
                result = _managed_auth_http_json(
                    server_url,
                    path,
                    method="DELETE",
                    access_token=access_token,
                    **receipt_options,
                )
            except ManagedAuthError as error:
                if error.status == 0:
                    # The DELETE may have settled credits even when its reply
                    # was lost. A read-only lookup recovers that receipt.
                    try:
                        settled = _managed_auth_http_json(
                            server_url, path, method="GET", access_token=access_token,
                        )
                    except ManagedAuthError:
                        raise error
                    if (settled.get("session_id") == session_id
                            and settled.get("status") in {"completed", "failed", "closing"}):
                        self.managed_session_auth_contexts.pop(session_id, None)
                        return settled
                    raise error
                if error.status != HTTPStatus.UNAUTHORIZED:
                    raise
                current = credential_store.load_auth_credentials()
                current_access = str(current.get("access_token") or "").strip()
                current_refresh = str(current.get("refresh_token") or "").strip()
                if current_access and current_access != access_token:
                    try:
                        result = _managed_auth_http_json(
                            server_url,
                            path,
                            method="DELETE",
                            access_token=current_access,
                            **receipt_options,
                        )
                        self.managed_session_auth_contexts.pop(session_id, None)
                        managed_direct.receipt_submitted(session_id)
                        return result
                    except ManagedAuthError as current_error:
                        if current_error.status != HTTPStatus.UNAUTHORIZED:
                            raise
                refresh_token = current_refresh or str(context.get("refresh_token") or "")
                if not refresh_token:
                    raise
                refreshed = _managed_auth_http_json(
                    server_url,
                    "/auth/refresh",
                    method="POST",
                    payload={"refresh_token": refresh_token},
                )
                tokens = self._managed_auth_tokens({
                    **refreshed,
                    "refresh_token": refreshed.get("refresh_token") or refresh_token,
                })
                for stored_context in self.managed_session_auth_contexts.values():
                    if str(stored_context.get("server_url") or "") == server_url:
                        stored_context.update(tokens)
                credential_error = None
                try:
                    credential_store.save_auth_credentials(tokens)
                except Exception as save_error:
                    credential_error = save_error
                result = _managed_auth_http_json(
                    server_url,
                    path,
                    method="DELETE",
                    access_token=tokens["access_token"],
                    **receipt_options,
                )
                self.managed_session_auth_contexts.pop(session_id, None)
                managed_direct.receipt_submitted(session_id)
                if credential_error is not None:
                    raise credential_error
                return result
            self.managed_session_auth_contexts.pop(session_id, None)
            managed_direct.receipt_submitted(session_id)
            return result

    def _remember_managed_session_auth_context(self, session_id: str) -> None:
        session_id = str(session_id or "").strip()
        context = getattr(self.managed_auth_context_local, "value", None)
        if not session_id or not isinstance(context, Mapping):
            return
        normalized = {
            key: str(context.get(key) or "")
            for key in ("server_url", "access_token", "refresh_token")
        }
        if not normalized["server_url"] or not normalized["access_token"]:
            return
        with self.managed_auth_lock:
            self.managed_session_auth_contexts[session_id] = normalized

    def acquire_managed_ai_action_session(
        self,
        workflow: str,
        estimated_cost_usd: float = ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD,
        *,
        policy_revision: int | None = None,
        model_id: str | None = None,
        purpose: str | None = None,
        reasoning_effort: str | None = None,
    ) -> dict:
        if reasoning_effort is not None and (workflow not in {"insight_book", "chatbot"} or reasoning_effort not in REASONING_EFFORTS | ({"enabled", "disabled"} if workflow == "chatbot" else set())):
            raise ValueError("이 작업에서 지원하는 추론 수준을 선택해 주세요.")
        if self.selected_ai_model(workflow)["mode"] == "chatgpt":
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription import runtime
            from ai_compliance import require_external_provider_consent, compliance_metadata
            import edition_manifest
            require_external_provider_consent("OpenAI", self.config, compliance_metadata(edition_manifest.EDITION_MANIFEST))
            if purpose:
                from subscription_policy import require_subscription
                require_subscription()
                from chatgpt_subscription.protocol import ChatGPTError
                raise ChatGPTError("unsupported_capability")
            selection = self.selected_ai_model(workflow)
            if model_id is not None and model_id != selection["modelId"]:
                from subscription_policy import require_subscription
                require_subscription()
                from chatgpt_subscription.protocol import ChatGPTError
                raise ChatGPTError("model_unavailable")
            def request_guard():
                require_external_provider_consent("OpenAI", self.config, compliance_metadata(edition_manifest.EDITION_MANIFEST))
                if self.selected_ai_model(workflow) != selection:
                    from subscription_policy import require_subscription
                    require_subscription()
                    from chatgpt_subscription.protocol import ChatGPTError
                    raise ChatGPTError("model_unavailable")
            return runtime.acquire(selection["modelId"], request_guard=request_guard, reasoning_effort=reasoning_effort)
        import client_ai_sessions
        return client_ai_sessions.acquire(self, workflow, estimated_cost_usd, model_id=model_id,
                                          policy_revision=policy_revision, reasoning_effort=reasoning_effort, purpose=purpose)

    @contextmanager
    def managed_ai_action(
        self,
        workflow: str,
        estimated_cost_usd: float = ai_model_selection.MANAGED_AI_ACTION_ESTIMATE_USD,
        *,
        policy_revision: int | None = None,
        model_id: str | None = None,
        purpose: str | None = None,
        reasoning_effort: str | None = None,
        request_messages: list[dict] | None = None,
        request_options: dict | None = None,
        request_timing_callback=None,
    ):
        calculator = None
        if workflow == "chatbot" and request_messages is not None and self.selected_ai_model(workflow)["mode"] != "chatgpt":
            from chat.budget_service import prepare_chatbot_budget
            calculator, estimated_cost_usd = prepare_chatbot_budget(
                self, request_messages, request_options, model_id=model_id, effort=reasoning_effort,
                timing_callback=request_timing_callback,
            )
            model_id = calculator.model["id"]
        session_options = {"policy_revision": policy_revision}
        if purpose:
            session_options["purpose"] = purpose
        if model_id is not None:
            session_options["model_id"] = model_id
        if reasoning_effort is not None:
            session_options["reasoning_effort"] = reasoning_effort
        session = self.acquire_managed_ai_action_session(
            workflow,
            estimated_cost_usd,
            **session_options,
        )
        action_failed = False
        try:
            if calculator is not None:
                aliases = ai_model_selection.OPENROUTER_MODEL_ALIASES
                if aliases.get(session["model_id"], session["model_id"]) != aliases.get(calculator.model["id"], calculator.model["id"]):
                    raise ManagedAuthError("토큰을 계산한 모델과 세션 모델이 일치하지 않습니다.")
                session["_chatbot_budget"] = calculator
            yield session
        except BaseException:
            action_failed = True
            raise
        finally:
            try:
                session["settlement"] = self.finish_managed_ai_session(session["session_id"])
            except BaseException:
                if not action_failed:
                    raise
                _logger.exception("Managed AI session settlement failed after the action error")
