"""Loopback PKCE/OIDC sign-in and serialized rotating credentials."""
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import hmac
import secrets
import threading
import time
from urllib.parse import parse_qs, urlencode, urlparse
import uuid
import webbrowser

from .protocol import (AUTHORIZE, ISSUER, RESOURCE, SCOPES, TOKEN, TERMINAL_REFRESH_ERRORS,
                       ChatGPTError, checked_auth_url, deployment, http_json, require_deployment)
from .security import CredentialVault


def verify_identity(token, client_id, nonce=None):
    import jwt
    try:
        discovery = http_json("GET", ISSUER + "/.well-known/openid-configuration")
        if discovery.get("issuer") != ISSUER:
            raise ValueError("issuer")
        jwks = http_json("GET", checked_auth_url(discovery["jwks_uri"]))
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            raise ValueError("algorithm")
        keys = [k for k in jwks["keys"] if k.get("kid") == header.get("kid") and k.get("kty") == "RSA"]
        if len(keys) != 1:
            raise ValueError("key")
        claims = jwt.decode(token, jwt.PyJWK.from_dict(keys[0]).key, algorithms=["RS256"],
                            audience=client_id, issuer=ISSUER,
                            options={"require": ["exp", "iss", "aud", "sub"]})
        if not isinstance(claims["sub"], str) or not claims["sub"]:
            raise ValueError("subject")
        if claims.get("azp", client_id) != client_id:
            raise ValueError("authorized party")
        if nonce is not None and not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
            raise ValueError("nonce")
        return claims
    except ChatGPTError:
        raise
    except Exception:
        raise ChatGPTError("invalid_identity") from None


def token_record(result, registration, *, nonce=None, refresh=False):
    if (not isinstance(result, dict) or str(result.get("token_type", "")).lower() != "bearer"
            or not isinstance(result.get("access_token"), str) or not result["access_token"]):
        raise ChatGPTError("invalid_token_response")
    record = dict(registration)
    if not refresh or result.get("id_token"):
        claims = verify_identity(result.get("id_token", ""), record["client_id"], nonce)
        if record.get("subject") and record["subject"] != claims["sub"]:
            raise ChatGPTError("account_mismatch")
        record.update(subject=claims["sub"], email=str(claims.get("email", "")), id_token=result["id_token"])
    scopes = result.get("scope")
    if scopes is None and refresh:
        scopes = " ".join(record.get("scopes", []))
    if not isinstance(scopes, str):
        raise ChatGPTError("invalid_token_response")
    try:
        expires = int(result["expires_in"])
        earliest = float(result.get("earliest_refresh_at") or 0)
        if not 0 < expires <= 86400:
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise ChatGPTError("invalid_token_response") from None
    refresh_token = result.get("refresh_token", "")
    if "offline_access" in scopes.split() and not refresh_token:
        raise ChatGPTError("invalid_token_response")
    record.update(access_token=result["access_token"], refresh_token=refresh_token,
                  scopes=scopes.split(), expires_at=time.time() + expires, earliest_refresh_at=earliest)
    return record


def clear_tokens(record):
    return {k: v for k, v in record.items() if k not in {
        "access_token", "refresh_token", "id_token", "scopes", "expires_at", "earliest_refresh_at"}}


class ChatGPTAccount:
    def __init__(self, vault=None):
        self.vault = vault or CredentialVault()
        self.lock = threading.RLock()
        self.pending = None
        self.error = ""
        self.streams = set()
        self.session_cancel = threading.Event()
        self.model_catalog = None

    def status(self):
        available = deployment()["available"]
        record = {}
        error = self.error
        if available:
            try:
                with self.vault.locked():
                    record = self.vault.read()
            except RuntimeError:
                error = "ChatGPT 보안 저장소를 사용할 수 없습니다. Windows 환경을 확인해 주세요."
        return {"available": available, "connected": bool(record.get("access_token")),
                "email": record.get("email", ""),
                "plan_enabled": bool(record.get("access_token")) and "chatgpt.tokens.use.direct" in record.get("scopes", []),
                "welcome_required": bool(record.get("access_token")) and not record.get("welcome_seen")
                    and "chatgpt.tokens.use.direct" in record.get("scopes", []),
                "pending": self.pending is not None, "error": error}

    def acknowledge_welcome(self):
        with self.lock, self.vault.locked():
            record = self.vault.read()
            if not record.get("access_token"):
                raise ChatGPTError("not_connected")
            self.vault.write({**record, "welcome_seen": True})
        return self.status()

    def start(self, *, reconsent=False):
        config = require_deployment()
        self.cancel()
        with self.lock, self.vault.locked():
            record = self.vault.read()
            record.setdefault("host_id", "urn:uuid:" + str(uuid.uuid4()))
            self.vault.write(record)
            pending = {"state": secrets.token_urlsafe(32), "nonce": secrets.token_urlsafe(32),
                       "verifier": secrets.token_urlsafe(64), "cancel": threading.Event(),
                       "client_id": record.get("client_id") or record.get("pending_client_id") or config["client_id"],
                       "record": record, "expires": time.monotonic() + 300}
            owner = self

            class Callback(BaseHTTPRequestHandler):
                def log_message(self, *_args):
                    pass  # Callback URL contains a code: never log it.

                def do_GET(self):
                    parsed = urlparse(self.path)
                    if (parsed.path != "/auth/callback" or self.headers.get("Host") != server.expected_host):
                        self.send_error(404)
                        return
                    try:
                        owner.complete(pending, parse_qs(parsed.query))
                        body = "ChatGPT 연결 결과를 AILS의 AI 설정에서 확인하세요.".encode("utf-8")
                        status = 200
                    except ChatGPTError as error:
                        owner.error = str(error)
                        body = "ChatGPT 연결을 완료하지 못했습니다. AILS에서 다시 시도하세요.".encode("utf-8")
                        status = 400
                    except Exception:
                        owner.error = "ChatGPT 연결을 저장하지 못했습니다. 보안 저장소를 확인해 주세요."
                        body = b"Sign-in could not be completed. Return to AILS."
                        status = 500
                    finally:
                        pending["cancel"].set()
                    self.send_response(status)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Referrer-Policy", "no-referrer")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

            server = HTTPServer(("127.0.0.1", 0), Callback)
            server.timeout = 0.2
            server.expected_host = f"127.0.0.1:{server.server_port}"
            pending["redirect_uri"] = f"http://{server.expected_host}/auth/callback"
            self.pending = pending
            self.error = ""

        def listen():
            try:
                while not pending["cancel"].is_set() and time.monotonic() < pending["expires"]:
                    server.handle_request()
            finally:
                server.server_close()
                with self.lock:
                    if self.pending is pending:
                        self.pending = None
                        if not pending["cancel"].is_set():
                            self.error = "ChatGPT 로그인 시간이 만료되었습니다. 다시 연결해 주세요."

        threading.Thread(target=listen, daemon=True, name="chatgpt-oauth").start()
        params = {"client_id": pending["client_id"], "ext_agent_host_id": record["host_id"],
                  "response_type": "code", "redirect_uri": pending["redirect_uri"],
                  "scope": SCOPES, "resource": RESOURCE, "state": pending["state"],
                  "nonce": pending["nonce"], "code_challenge_method": "S256",
                  "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(pending["verifier"].encode()).digest()).decode().rstrip("=")}
        if pending["client_id"] == "dynamic_agent_client":
            params["agent_name_hint"] = "AILS"
        elif record.get("id_token"):
            params["id_token_hint"] = record["id_token"]
        if reconsent:
            params["prompt"] = "consent"
        try:
            if not webbrowser.open(AUTHORIZE + "?" + urlencode(params)):
                raise ChatGPTError("browser_unavailable")
        except Exception:
            self.cancel()
            raise ChatGPTError("browser_unavailable") from None
        return self.status()

    def complete(self, pending, query):
        def single(key):
            values = query.get(key, [])
            return values[0] if len(values) == 1 else ""
        if (pending is not self.pending or pending.get("consumed") or pending["cancel"].is_set()
                or time.monotonic() >= pending["expires"]
                or not hmac.compare_digest(single("state"), pending["state"])):
            raise ChatGPTError("invalid_oauth_state")
        if single("error"):
            raise ChatGPTError("access_denied")
        client_id = single("client_id") or pending["client_id"]
        if (not client_id.startswith("oaiapp_") or
                (pending["client_id"] != "dynamic_agent_client" and client_id != pending["client_id"])):
            raise ChatGPTError("invalid_oauth_client")
        if not single("code"):
            raise ChatGPTError("invalid_oauth_code")
        with self.lock:
            if pending.get("consumed"):
                raise ChatGPTError("invalid_oauth_state")
            pending["consumed"] = True
        registration = {**pending["record"], "client_id": client_id}
        try:
            result = http_json("POST", TOKEN, data={"grant_type": "authorization_code", "client_id": client_id,
                               "code": single("code"), "code_verifier": pending["verifier"],
                               "redirect_uri": pending["redirect_uri"], "resource": RESOURCE})
        except ChatGPTError as error:
            if error.code == "invalid_grant" and pending["client_id"] == "dynamic_agent_client":
                # Retain registration for a fresh code without making an
                # unverified callback an authenticated account.
                with self.lock, self.vault.locked():
                    if self.pending is pending and not pending["cancel"].is_set():
                        self.vault.write({**pending["record"], "pending_client_id": client_id})
            raise
        record = token_record(result, registration, nonce=pending["nonce"])
        record.pop("pending_client_id", None)
        with self.lock, self.vault.locked():
            if pending["cancel"].is_set() or self.pending is not pending:
                raise ChatGPTError("cancelled")
            record["generation"] = uuid.uuid4().hex
            self.vault.write(record)
            self.session_cancel.set()
            self.session_cancel = threading.Event()
            pending["cancel"].set()
            self.pending = None
            self.error = ""

    def cancel(self):
        # Signal before acquiring locks so an in-flight exchange cannot commit.
        pending = self.pending
        if pending:
            pending["cancel"].set()
        with self.lock:
            self.pending = None

    def disconnect(self):
        self.cancel()
        self.session_cancel.set()
        with self.lock:
            from .responses import close_response
            for response in list(self.streams):
                close_response(response)
            self.streams.clear()
            with self.vault.locked():
                record = self.vault.read()
                confirmed = not bool(record.get("refresh_token"))
                try:
                    if record.get("refresh_token"):
                        discovery = http_json("GET", ISSUER + "/.well-known/openid-configuration")
                        from .protocol import requests
                        with requests.post(checked_auth_url(discovery["revocation_endpoint"]),
                                           data={"token": record["refresh_token"], "token_type_hint": "refresh_token",
                                                 "client_id": record["client_id"]},
                                           timeout=15, allow_redirects=False) as response:
                            confirmed = response.status_code == 200
                except Exception:
                    confirmed = False
                self.vault.write(clear_tokens(record))
        self.error = "" if confirmed else "로컬 연결은 해제했습니다. 원격 해제는 확인하지 못했으므로 ChatGPT 설정에서 앱 접근을 해제해 주세요."
        return {**self.status(), "revocation_confirmed": confirmed}

    def access(self, *, expected=None):
        require_deployment()
        with self.lock, self.vault.locked():
            record = self.vault.read()
            if not record.get("access_token"):
                raise ChatGPTError("not_connected")
            identity = (record.get("client_id"), record.get("subject"), record.get("generation"))
            if expected is not None and tuple(expected) != identity:
                raise ChatGPTError("reconnect_required")
            if "chatgpt.tokens.use.direct" not in record.get("scopes", []):
                raise ChatGPTError("permission_required")
            if record.get("expires_at", 0) <= time.time() + 60:
                if not record.get("refresh_token"):
                    raise ChatGPTError("reconnect_required")
                if time.time() < record.get("earliest_refresh_at", 0):
                    raise ChatGPTError("refresh_not_ready")
                try:
                    result = http_json("POST", TOKEN, data={"grant_type": "refresh_token",
                                       "client_id": record["client_id"], "refresh_token": record["refresh_token"],
                                       "resource": RESOURCE})
                    record = token_record(result, record, refresh=True)
                    self.vault.write(record)
                except ChatGPTError as error:
                    if error.code in TERMINAL_REFRESH_ERRORS:
                        self.vault.write(clear_tokens(record))
                        raise ChatGPTError("reconnect_required") from None
                    raise
            if "chatgpt.tokens.use.direct" not in record.get("scopes", []):
                raise ChatGPTError("permission_required")
            return record["access_token"], identity

    def models(self, *, refresh=False):
        token, identity = self.access()
        with self.lock:
            cached = self.model_catalog
            if not refresh and cached and cached[0] == identity and time.monotonic() < cached[1]:
                return [dict(model) for model in cached[2]]
            data = http_json("GET", RESOURCE + "/models", headers={"Authorization": "Bearer " + token})
            if not isinstance(data, dict) or not isinstance(data.get("models"), list):
                raise ChatGPTError("invalid_model_catalog")
            models = [{"id": item["slug"], "name": item.get("display_name") or item["slug"]}
                      for item in data["models"] if isinstance(item, dict) and item.get("visibility") == "list"
                      and isinstance(item.get("slug"), str) and item["slug"]]
            self.access(expected=identity)
            self.model_catalog = (identity, time.monotonic() + 60, models)
            return [dict(model) for model in models]


ACCOUNT = ChatGPTAccount()
