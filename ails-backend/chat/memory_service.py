"""MemoryService: feature operations and owned state."""
from __future__ import annotations
from chat.memory_support import (
    Any,
    Callable,
    DEFAULT_MODEL_CONTEXT_LIMIT_TOKENS,
    Mapping,
    dataclass,
    feature_enabled,
    measured,
    normalize_budgets,
    normalize_memory_settings,
    require_feature,
    server_config,
    threading,
)
from chat.memory_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class MemoryServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    get__chatbot_turn_cache: Callable[[], Any]
    _managed_auth_request: Callable[..., Any]
    append_idle_log: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    get_lock: Callable[[], Any]
    embedding_backend: Callable[[], Any]

class MemoryService:
    def close(self):
        self.clear_memory_service()

    def __init__(self, ports: MemoryServicePorts):
        self._ports = ports
        self._managed_auth_request = ports._managed_auth_request
        self.append_idle_log = ports.append_idle_log
        self._memory_service_lock = threading.Lock()
        self._memory_service = None
        self._memory_service_user_id = None

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

    @measured("memory_identity")
    def verified_memory_user_id(self) -> str:
        """Resolve identity from the authenticated server, never from local config."""

        try:
            result = self._managed_auth_request("/me")
        except Exception:
            self.clear_memory_service()
            raise
        user = result.get("user", result) if isinstance(result, Mapping) else None
        user_id = str(user.get("user_id") or "").strip() if isinstance(user, Mapping) else ""
        if not user_id:
            self.clear_memory_service()
            raise ValueError("계정을 확인할 수 없어 메모리를 사용할 수 없습니다.")
        return user_id

    def clear_memory_service(self) -> None:
        """Drop the account-specific handle after a credential change."""

        turn_cache = getattr(self, "_chatbot_turn_cache", None)
        if turn_cache is not None:
            turn_cache.clear()
        lock = getattr(self, "_memory_service_lock", None)
        if lock is None:
            return
        with lock:
            service = getattr(self, "_memory_service", None)
            self._memory_service = None
            self._memory_service_user_id = None
            if service is not None:
                service.close()

    def memory_service(self):
        require_feature("user_memory")
        from chat.user_memory import UserMemoryService
        if not hasattr(self, "_memory_service_lock"):
            self._memory_service_lock = threading.Lock()
        user_id = self.verified_memory_user_id()
        with self._memory_service_lock:
            service = getattr(self, "_memory_service", None)
            if getattr(self, "_memory_service_user_id", None) != user_id:
                if service is not None:
                    service.close()
                service = None
                self._memory_service = None
            if service is None:
                service = UserMemoryService(settings=self.memory_settings(), account_id=user_id,
                    encoder_provider=self._ports.embedding_backend)
                self._memory_service = service
                self._memory_service_user_id = user_id
            service.settings = normalize_memory_settings(self.memory_settings())
        return service

    def memory_settings(self) -> dict:
        return normalize_memory_settings(self.config.get("memory_settings"))

    def memory_enabled(self) -> bool:
        return feature_enabled("user_memory") and bool(self.config.get("memory_enabled", True))

    @measured("memory_save")
    def observe_chat_exchange(self, payload: Mapping, answer: Any) -> None:
        """챗봇 턴 완료 후 장기 보존 가치가 있는 신호만 기억으로 반영한다."""

        if not self.memory_enabled():
            return
        question = str((payload or {}).get("question", "") or "")
        if not question.strip():
            return
        try:
            self.memory_service().observe_exchange(question, answer)
        except Exception as error:
            self.append_idle_log(f"사용자 메모리 갱신 실패: {error}")

    def memory_snapshot(self) -> dict:
        service = self.memory_service()
        snapshot = service.snapshot()
        snapshot["enabled"] = self.memory_enabled()
        snapshot["context_budgets"] = normalize_budgets(self.config.get("context_budgets"))
        snapshot["model_context_limit_tokens"] = int(self.config.get("model_context_limit_tokens") or 0)
        return snapshot

    def memory_mutate(self, payload: Mapping) -> dict:
        service = self.memory_service()
        if str(payload.get("action") or "").strip().casefold() == "compress":
            item = service.maybe_compress_episodic(subject=str(payload.get("subject") or ""))
            return {"compressed": item.to_api() if item else None}
        item, action = service.create_or_update_manual(payload)
        return {"item": item.to_api(), "action": action}

    def memory_delete(self, payload: Mapping) -> dict:
        item_id = str((payload or {}).get("id") or "")
        if not item_id:
            raise ValueError("삭제할 기억 ID가 없습니다.")
        return {"deleted": self.memory_service().delete_item(item_id), "id": item_id}

    def memory_update_settings(self, payload: Mapping) -> dict:
        """메모리·context budget 설정을 저장한다(context_composer 즉시 반영)."""

        require_feature("user_memory")
        body = payload if isinstance(payload, Mapping) else {}
        if "memory_enabled" in body:
            self.config["memory_enabled"] = bool(body.get("memory_enabled"))
        if "memory_settings" in body and isinstance(body.get("memory_settings"), Mapping):
            self.config["memory_settings"] = normalize_memory_settings(body["memory_settings"])
        if "context_budgets" in body and isinstance(body.get("context_budgets"), Mapping):
            self.config["context_budgets"] = normalize_budgets(body["context_budgets"])
        if "model_context_limit_tokens" in body:
            try:
                limit = int(body.get("model_context_limit_tokens") or 0)
            except (TypeError, ValueError):
                limit = 0
            self.config["model_context_limit_tokens"] = limit if limit > 0 else DEFAULT_MODEL_CONTEXT_LIMIT_TOKENS
        with self.lock:
            self.config = server_config.save_config(dict(self.config))
        return {
            "memory_enabled": self.memory_enabled(),
            "memory_settings": normalize_memory_settings(self.config.get("memory_settings")),
            "context_budgets": normalize_budgets(self.config.get("context_budgets")),
            "model_context_limit_tokens": int(self.config.get("model_context_limit_tokens") or 0),
        }
