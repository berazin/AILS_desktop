"""InsightService: feature operations and owned state."""
from __future__ import annotations
from documents.insight_support import (
    Any,
    Callable,
    InsightAccountAccess,
    InsightBookService,
    InsightStore,
    Mapping,
    _access_initialization_lock,
    credential_store,
    dataclass,
    digest,
    hashlib,
    measure_call,
    messages,
    normalize_reasoning_effort,
    os,
    provider_timing_callback,
    require_feature,
    runtime,
    settings,
    shared_encoder,
    text,
)
from documents.insight_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class InsightServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    _call_material_practice_ai: Callable[..., Any]
    _material_practice_ai_selection: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    get_managed_auth_context_local: Callable[[], Any]
    verified_memory_user_id: Callable[..., Any]

class InsightService:
    def __init__(self, ports: InsightServicePorts):
        self._ports = ports
        self._call_material_practice_ai = ports._call_material_practice_ai
        self._material_practice_ai_selection = ports._material_practice_ai_selection
        self.verified_memory_user_id = ports.verified_memory_user_id
        self._insight_account_access = None
        self._insight_db_root = None

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    @property
    def managed_auth_context_local(self):
        return self._ports.get_managed_auth_context_local()

    def _insight_user_id(self):
        require_feature("insight_book")
        with _access_initialization_lock:
            access = getattr(self, "_insight_account_access", None)
            if access is None:
                def verify():
                    user_id = self.verified_memory_user_id()
                    context = getattr(getattr(self, "managed_auth_context_local", None), "value", None)
                    return user_id, context if isinstance(context, Mapping) else None
                access = self._insight_account_access = InsightAccountAccess(verify, credential_store.load_auth_credentials)
        return access.resolve()

    def _insight_context(self):
        user_id = self._insight_user_id()
        root = getattr(self, "_insight_db_root", None) or os.path.join(
            os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "AILS", "insight_books")
        store = InsightStore(os.path.join(root, hashlib.sha256(user_id.encode("utf-8")).hexdigest() + ".sqlite3"))
        runtime.recover(store)
        return user_id, store

    def _insight_service(self, user_id, store):
        def check_access():
            if self._insight_user_id() != user_id:
                raise PermissionError("작업을 시작한 계정이 변경되었습니다.")
            self._material_practice_ai_selection("insight_book")

        def call_ai(operation, payload, cancel_check):
            check_access()
            effort = normalize_reasoning_effort(self.config.get("insight_book_reasoning_effort"))
            callback = provider_timing_callback()
            raw, provider, model, usage = self._call_material_practice_ai(
                messages(operation, payload), max_retries=0, cancel_check=cancel_check, workflow="insight_book",
                reasoning_effort=None if effort == "default" else effort,
                **({"timing_callback": callback} if callback else {}))
            return {"raw": raw, "provider": provider, "model": model, "usage": usage, "requested_reasoning_effort": effort}

        return InsightBookService(store, call_ai, check_access, shared_encoder)

    def insight_snapshot(self, raw_offset=0, revision_offset=0, review_filter="all"):
        user_id, store = self._insight_context()
        return {**store.snapshot(max(0, int(raw_offset)), max(0, int(revision_offset)), review_filter),
                "account_scope": hashlib.sha256(user_id.encode("utf-8")).hexdigest()}

    def insight_record(self, raw_id):
        _user_id, store = self._insight_context()
        raw = store.require("raw", text(raw_id, "Insight ID", 100))
        return {"raw": raw, "run": store.require("run", raw["run_id"])}

    def insight_submit(self, payload):
        with measure_call() as timing:
            return self._insight_submit(payload, timing)

    def _insight_submit(self, payload, timing):
        user_id, store = self._insight_context()
        self._material_practice_ai_selection("insight_book")
        parent = payload.get("parent_id", "")
        if parent and payload.get("approve_correction") is not True:
            raise ValueError("개선 Insight는 사용자가 승인한 뒤 제출해야 합니다.")
        # Older clients may still send sources. New submissions never read or attach them.
        run = store.submit(payload.get("text"), payload.get("request_id"), [], parent,
                           approve_correction=payload.get("approve_correction") is True)
        if "submission_timing" not in run:
            run = store.update_run(run["id"], submission_timing=timing.snapshot())
        runtime.launch(self._insight_service(user_id, store))
        return {"run": run}

    def insight_action(self, payload):
        user_id, store = self._insight_context()
        action = payload.get("action")
        if action == "settings":
            with store.transaction() as db:
                meta = store.require("meta", "book", db)
                meta["settings"] = settings(payload.get("settings"))
                store.put("meta", "book", meta, db)
            return {"settings": meta["settings"]}
        if action == "cancel":
            return {"run": store.cancel(payload.get("run_id"))}
        self._material_practice_ai_selection("insight_book")
        if action == "retry":
            run = store.require("run", payload.get("run_id"))
            if run["state"] not in {"failed", "cancelled", "interrupted"} or run["attempt"] >= 3:
                raise ValueError("재개 가능한 작업이 아니거나 3회 시도를 모두 사용했습니다.")
            run = store.update_run(run["id"], state="queued", cancel_requested=False, error="",
                                   unknown_retry=run.get("unknown_retry", 0) + int(payload.get("allow_new_ai_attempt") is True))
        else:
            if action not in {"maintain", "question", "grade"}:
                raise ValueError("지원하지 않는 Insight Book 작업입니다.")
            request_id = text(payload.get("request_id"), "요청 ID", 100)
            body = {"action": action}
            if action in {"question", "grade"}:
                body["wrong_id"] = store.require("wrong", payload.get("wrong_id"))["id"]
            if action == "grade":
                body.update(review_id=text(payload.get("review_id"), "문항 ID", 100),
                            answer=text(payload.get("answer"), "답안", 10000))
            with store.transaction() as db:
                prior = store.get("request", request_id, db)
                if prior and prior["digest"] != digest(body):
                    raise ValueError("요청 ID를 다른 작업에 재사용할 수 없습니다.")
                run = store.require("run", prior["run_id"], db) if prior else store.new_run(action, body, db)
                if not prior:
                    store.put("request", request_id, {"digest": digest(body), "run_id": run["id"]}, db)
        runtime.launch(self._insight_service(user_id, store))
        return {"run": run}

    def cancel_all_insight_work(self):
        runtime.cancel_all()
