"""One cancellable worker per account database; durable runs survive UI closure."""
from __future__ import annotations

import threading
from jobs.context import contextual_call

from .store import InsightStore

_lock = threading.RLock()
_workers = {}


def recover(store):
    with _lock:
        if store.path in _workers:
            return
        for run in store.list("run"):
            if run["state"] in {"running", "queued"}:
                store.update_run(run["id"], state="interrupted", error="앱이 중단되었습니다. 저장된 응답으로 재개할 수 있습니다.")


def launch(service):
    path = service.store.path
    with _lock:
        if path in _workers:
            return

        def work():
            try:
                while True:
                    with _lock:
                        pending = [run for run in service.store.list("run") if run["state"] == "queued"]
                        if not pending:
                            _workers.pop(path, None)
                            return
                    run = min(pending, key=lambda row: row["created_at"])
                    service.process(run["id"])
            finally:
                with _lock:
                    # Don't discard a successor installed after this worker drained.
                    if _workers.get(path) is threading.current_thread():
                        _workers.pop(path, None)

        worker = threading.Thread(target=contextual_call(work), name="ails-insight-book", daemon=True)
        _workers[path] = worker
        worker.start()


def cancel_all():
    with _lock:
        paths = list(_workers)
    for path in paths:
        store = InsightStore(path)
        for run in store.list("run"):
            if run["state"] in {"running", "queued"}:
                store.cancel(run["id"])
