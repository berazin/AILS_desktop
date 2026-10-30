"""Application-owned embedding model, indexing queue and cancellation lifetime."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from queue import Empty, Queue
import os
import threading
import time

from search.embedding_process import EmbeddingCancelled, EmbeddingProcess

_bound_runtime: ContextVar[EmbeddingRuntime | None] = ContextVar("ails_embedding_runtime", default=None)
_bound_cancel: ContextVar[threading.Event | None] = ContextVar("ails_embedding_cancel", default=None)


def current_runtime():
    runtime = _bound_runtime.get()
    if runtime is None:
        raise RuntimeError("Embedding work requires an application-owned runtime scope")
    return runtime


class BackendHandle:
    """Clients borrow a model; the runtime retains ownership of its process."""
    def __init__(self, runtime, backend):
        self.runtime, self.backend = runtime, backend

    def __getattr__(self, name):
        return getattr(self.backend, name)

    def encode(self, texts, input_type):
        with self.runtime.activity():
            for attempt in range(2):
                try:
                    return self.backend.encode(texts, input_type, cancelled=self.runtime.cancelled)
                except EmbeddingCancelled:
                    self.runtime.discard(self.backend)
                    self.runtime.check_cancelled()
                    if attempt:
                        raise
                    # A cancelled background job or idle expiry can retire a borrowed
                    # process. An unrelated live request may acquire its replacement.
                    replacement = self.runtime.get_backend().backend
                    if (replacement.model_key, replacement.dimensions) != (self.backend.model_key, self.backend.dimensions):
                        raise RuntimeError("Embedding model changed during the operation; retry with the new model")
                    self.backend = replacement


class EmbeddingRuntime:
    def __init__(self, *, backend_factory=EmbeddingProcess, idle_seconds=None, retry_seconds=300):
        self._backend_factory = backend_factory
        self._idle_seconds = max(0, float(idle_seconds if idle_seconds is not None else os.environ.get("AILS_EMBEDDING_IDLE_UNLOAD_SECONDS", "900")))
        self._retry_seconds = retry_seconds
        self._condition = threading.Condition(threading.RLock())
        self._load_lock = threading.Lock()
        self.cache_lock = threading.RLock()
        self._closed = threading.Event()
        self._backend = self._loading_backend = None
        self._retry_at = 0.0
        self._warming = False
        self._warm_thread = self._index_thread = None
        self._idle_timer = None
        self._idle_generation = 0
        self._active = self._foreground = 0
        self._queue = Queue()
        self._jobs = {}
        self._statuses = {}
        self._signatures = {}

    @contextmanager
    def scope(self, cancel=None):
        inherited = _bound_cancel.get() if _bound_runtime.get() is self else None
        token = _bound_runtime.set(self)
        cancellation = _bound_cancel.set(cancel if cancel is not None else inherited)
        try:
            self.check_cancelled()
            yield self
        finally:
            _bound_cancel.reset(cancellation)
            _bound_runtime.reset(token)

    def cancelled(self):
        event = _bound_cancel.get()
        return self._closed.is_set() or (event is not None and event.is_set())

    def check_cancelled(self):
        if self.cancelled():
            raise EmbeddingCancelled("Embedding operation cancelled")

    @contextmanager
    def activity(self, *, foreground=False):
        with self._condition:
            self.check_cancelled()
            self._active += 1
            self._foreground += int(foreground)
            self._cancel_idle_locked()
        try:
            yield
        finally:
            with self._condition:
                self._active -= 1
                self._foreground -= int(foreground)
                self._condition.notify_all()
                self._schedule_idle_locked()

    def wait_for_foreground(self):
        with self._condition:
            while self._foreground:
                self.check_cancelled()
                self._condition.wait(0.05)
            self.check_cancelled()

    def _cancel_idle_locked(self):
        self._idle_generation += 1
        if self._idle_timer is not None:
            self._idle_timer.cancel()
            self._idle_timer = None

    def _schedule_idle_locked(self):
        self._cancel_idle_locked()
        if self._active or self._warming or self._backend is None or self._closed.is_set() or not self._idle_seconds:
            return
        generation = self._idle_generation
        self._idle_timer = threading.Timer(self._idle_seconds, self._expire, args=(generation,))
        self._idle_timer.name = "ails-embedding-idle"
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def _expire(self, generation):
        with self._condition:
            if generation != self._idle_generation or self._active or self._warming:
                return
            backend, self._backend = self._backend, None
            self._idle_timer = None
        if backend is not None:
            backend.close()

    def _ready_locked(self):
        return self._backend is not None and (not self._backend.degraded or time.monotonic() < self._retry_at)

    def get_backend(self):
        self.check_cancelled()
        with self._condition:
            if self._ready_locked():
                self._schedule_idle_locked()
                return BackendHandle(self, self._backend)
        while not self._load_lock.acquire(timeout=0.025):
            self.check_cancelled()
        try:
            with self._condition:
                self.check_cancelled()
                if self._ready_locked():
                    return BackendHandle(self, self._backend)
                old, self._backend = self._backend, None
                self._warming = True
            backend = None
            try:
                if old is not None:
                    old.close()
                backend = self._backend_factory()
                with self._condition:
                    self.check_cancelled()
                    self._loading_backend = backend
                backend.prepare(self.cancelled)
                with self._condition:
                    self.check_cancelled()
                    self._backend = backend
                    self._retry_at = time.monotonic() + self._retry_seconds if backend.degraded else 0.0
                    return BackendHandle(self, backend)
            except BaseException:
                if backend is not None:
                    backend.close()
                raise
            finally:
                with self._condition:
                    self._loading_backend = None
                    self._warming = False
                    self._schedule_idle_locked()
        finally:
            self._load_lock.release()

    def status(self):
        with self._condition:
            if self._closed.is_set():
                return {"status": "closed", "backend": "", "degraded": False}
            if self._ready_locked():
                return {"status": "ready", "backend": self._backend.name, "degraded": bool(self._backend.degraded)}
            return {"status": "loading" if self._warming else "idle", "backend": "", "degraded": False}

    def warm(self):
        with self._condition:
            self.check_cancelled()
            if self._ready_locked() or self._warming:
                return self.status()
            self._warming = True
            def load():
                try:
                    with self.scope(), self.activity():
                        self.get_backend()
                except EmbeddingCancelled:
                    pass
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception("Embedding preparation failed")
                finally:
                    with self._condition:
                        self._warming = False
                        self._schedule_idle_locked()
            self._warm_thread = threading.Thread(target=load, name="ails-embedding-warmup", daemon=True)
            self._warm_thread.start()
            return {"status": "loading", "backend": "", "degraded": False}

    def discard(self, backend):
        with self._condition:
            if self._backend is backend:
                self._backend = None
                self._cancel_idle_locked()
        backend.close()

    def unload(self):
        with self._condition:
            if self._active or self._warming:
                return False
            backend, self._backend = self._backend, None
            self._cancel_idle_locked()
        if backend is not None:
            backend.close()
        return backend is not None

    def enqueue(self, path):
        normalized = os.path.abspath(str(path or ""))
        if os.path.splitext(normalized)[1].casefold() not in {".pdf", ".md", ".txt", ".ipynb"} or not os.path.isfile(normalized):
            return False
        stat = os.stat(normalized)
        signature = (stat.st_size, stat.st_mtime_ns)
        with self._condition:
            self.check_cancelled()
            model = getattr(self._backend, "model_key", None)
            same_model = model is None or self._statuses.get(normalized, {}).get("embedding_model_key") == model
            if normalized in self._jobs or (self._signatures.get(normalized) == signature and same_model):
                return False
            cancel = self._jobs[normalized] = threading.Event()
            self._statuses[normalized] = {"status": "indexing", "document_id": normalized}
            self._queue.put((normalized, cancel))
            if self._index_thread is None or not self._index_thread.is_alive():
                self._index_thread = threading.Thread(target=self._index_loop, name="ails-rag-index", daemon=True)
                self._index_thread.start()
            return True

    def _index_loop(self):
        from chat.theory_search import index_document
        while True:
            job = self._queue.get()
            if job is None:
                self._queue.task_done()
                return
            path, cancel = job
            try:
                with self.scope(cancel), self.activity():
                    self.wait_for_foreground()
                    result = index_document(path)
                    self.check_cancelled()
                    stat = os.stat(path)
                    with self._condition:
                        if result.get("status") == "ready" and not result.get("degraded"):
                            self._signatures[path] = (stat.st_size, stat.st_mtime_ns)
                        self._statuses[path] = result
            except EmbeddingCancelled:
                with self._condition:
                    self._statuses[path] = {"status": "cancelled", "document_id": path}
            except Exception as error:
                with self._condition:
                    self._statuses[path] = {"status": "unavailable", "document_id": path, "reason": str(error)[:500]}
            finally:
                with self._condition:
                    self._jobs.pop(path, None)
                self._queue.task_done()

    def index_status(self, path):
        normalized = os.path.abspath(str(path or ""))
        with self._condition:
            return dict(self._statuses.get(normalized) or {"status": "unavailable", "document_id": normalized})

    def cancel_index(self, path=None):
        normalized = os.path.abspath(str(path)) if path is not None else None
        with self._condition:
            jobs = [event for key, event in self._jobs.items() if normalized is None or key == normalized]
            for event in jobs:
                event.set()
            self._condition.notify_all()
            return len(jobs)

    def close(self):
        with self._condition:
            if self._closed.is_set():
                return
            self._closed.set()
            timer = self._idle_timer
            self._cancel_idle_locked()
            self.cancel_index()
            backends = {id(value): value for value in (self._backend, self._loading_backend) if value is not None}
            self._backend = self._loading_backend = None
            while True:
                try:
                    pending = self._queue.get_nowait()
                except Empty:
                    break
                if pending is not None:
                    path, _cancel = pending
                    self._statuses[path] = {"status": "cancelled", "document_id": path}
                    self._jobs.pop(path, None)
                self._queue.task_done()
            self._queue.put(None)
            self._condition.notify_all()
        for backend in backends.values():
            backend.close()
        for thread in (self._warm_thread, self._index_thread, timer):
            if thread is not None and thread is not threading.current_thread():
                thread.join(3.0)
                if thread.is_alive():
                    raise RuntimeError(f"Embedding worker did not stop: {thread.name}")
