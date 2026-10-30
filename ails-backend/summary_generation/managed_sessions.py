"""Task-owned, lazy stage sessions; paid requests are never replayed on timeout."""
from __future__ import annotations

from contextlib import nullcontext
import logging
import math
import threading
import time
from datetime import datetime

from .managed_costs import tag_managed_session

_logger = logging.getLogger(__name__)
_ROTATE_CODES = {"ai_session_capacity", "ai_session_pending", "ai_session_inactive",
                 "ai_session_expired", "ai_session_not_active", "ai_session_busy"}


def _pre_dispatch_rejection(error):
    """Only the managed server's admission errors are safe to retry."""
    cause = error
    while cause is not None:
        response = getattr(cause, "response", None)
        if response is not None and response.status_code in {401, 403, 409}:
            try:
                payload = response.json()
                code = payload.get("code")
            except (ValueError, TypeError, AttributeError):
                return False
            return code in _ROTATE_CODES
        cause = cause.__cause__
    return False


class ManagedStageSessions:
    def __init__(self, acquire, finish, records):
        self._acquire = acquire
        self._finish = finish
        self._records = records
        self._lock = threading.RLock()
        self._active = {}
        self._identities = {}
        self._inflight = {}
        self._retired = {}
        self._closed = False

    def session(self, phase, workflow, **options):
        # Identity is pinned per stage; never reuse a token across model/policy changes.
        key = (phase, workflow, tuple(sorted(options.items())))
        with self._lock:
            if self._closed:
                raise RuntimeError("Managed task sessions have already closed")
            session = self._active.get(key)
            if session and session.get("_expires_epoch", 0) <= time.time() + 30:
                self._retire(session)
                session = None
            if session is None:
                # A default-model stage must retain its resolved identity even
                # when TTL/capacity forces a new token partway through the stage.
                session = self._acquire(workflow, **{**options, **self._identities.get(key, {})})
                if session.get("model_id") and session.get("policy_revision"):
                    self._identities[key] = {"model_id": session["model_id"],
                                             "policy_revision": session["policy_revision"]}
                try:
                    expires = datetime.fromisoformat(session["expires_at"].replace("Z", "+00:00")).timestamp()
                except (KeyError, TypeError, ValueError):
                    expires = time.time() + 600
                session.update(_stage_pool=self, _stage_key=key, _expires_epoch=expires)
                self._active[key] = session
                if session.get("transport") != "chatgpt":
                    self._records.append(tag_managed_session(session, phase))
            return session

    def _retire(self, session):
        key = session["_stage_key"]
        if self._active.get(key) is session:
            self._active.pop(key)
        session_id = session["session_id"]
        self._retired[session_id] = session
        if not self._inflight.get(session_id):
            self._settle(session)

    def _settle(self, session):
        session_id = session["session_id"]
        try:
            session["settlement"] = self._finish(session_id)
        except Exception:
            # Retain the receipt identity for later close/reconciliation. A
            # billing transport failure must not replay a completed AI call.
            _logger.exception("Stage settlement will be retried during task cleanup")
            return
        self._retired.pop(session_id, None)

    def call(self, original_session, send):
        phase, workflow, options = original_session["_stage_key"]
        for attempt in range(2):
            with self._lock:
                # Register admission atomically with selection: another worker
                # may retire the stage after a failure or TTL rotation.
                session = self.session(phase, workflow, **dict(options))
                session_id = session["session_id"]
                self._inflight[session_id] = self._inflight.get(session_id, 0) + 1
            try:
                return send(session)
            except Exception as error:
                with self._lock:
                    self._retire(session)
                if attempt or not _pre_dispatch_rejection(error):
                    raise
            finally:
                with self._lock:
                    self._inflight[session_id] -= 1
                    if not self._inflight[session_id]:
                        self._inflight.pop(session_id)
                        if session_id in self._retired:
                            self._settle(session)

    def close_stage(self, phase):
        with self._lock:
            for session in list(self._active.values()):
                if session["_stage_key"][0] == phase:
                    self._retire(session)

    def close(self):
        with self._lock:
            self._closed = True
            for session in list(self._active.values()):
                self._retire(session)
            for session_id, session in list(self._retired.items()):
                if not self._inflight.get(session_id):
                    self._settle(session)


def request_budget_microusd(session, messages):
    """An expected hold, not an output cap or a claimed actual charge."""
    # Reuse the pricing table and input estimator; unknown future model prices
    # retain the server-issued initial reserve as a conservative fallback.
    from ai_request_limits import estimate_request_tokens
    from usage_metering import calculate_usage_cost
    tokens = estimate_request_tokens({"model": session["model_id"], "messages": messages})
    estimated = calculate_usage_cost(session["model_id"], tokens, 0, "text")
    if estimated is None and "/" in session["model_id"]:
        estimated = calculate_usage_cost(session["model_id"].split("/", 1)[1], tokens, 0, "text")
    initial = max(0.01, float(session.get("max_cost") or 0.01))
    amount = max(initial, float(estimated or 0) * 1.2)
    maximum = int(session.get("session_cost_limit_microusd") or 5_000_000)
    return min(maximum, max(1, math.ceil(amount * 1_000_000)))


def managed_video_action(api, config, phase, workflow, **options):
    snapshot = (config.get("_ai_provider_snapshot") or {}).get(workflow)
    if snapshot is not None:
        current = api.selected_ai_model(workflow)
        if (snapshot.get("mode") == "chatgpt" or current.get("mode") == "chatgpt") and current != snapshot:
            from subscription_policy import require_subscription
            require_subscription()
            from chatgpt_subscription.protocol import ChatGPTError
            raise ChatGPTError("model_unavailable")
    identity_key = {"video_summary": "_summary_pinned_identity", "video_stt_cleanup": "_stt_cleanup_pinned_identity",
                    "video_verification": "_video_verification_identity"}.get(workflow)
    identity = config.get(identity_key) if identity_key else None
    if isinstance(identity, dict) and identity.get("mode") == "chatgpt":
        from subscription_policy import require_subscription
        require_subscription()
        from chatgpt_subscription.account import ACCOUNT
        from subscription_policy import require_subscription
        require_subscription()
        from chatgpt_subscription.protocol import ChatGPTError
        selection = api.selected_ai_model(workflow)
        if selection.get("mode") != "chatgpt" or selection.get("modelId") != identity.get("model_id"):
            raise ChatGPTError("model_unavailable")
        ACCOUNT.access(expected=identity.get("account_identity"))
    pool = config.get("_managed_stage_sessions")
    if isinstance(pool, ManagedStageSessions):
        return nullcontext(pool.session(phase, workflow, **options))
    return api.managed_ai_action(workflow, **options)
