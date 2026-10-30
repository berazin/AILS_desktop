"""A disposable model process. Native initialization never runs on HTTP threads."""
from __future__ import annotations

import threading
import time


class EmbeddingCancelled(RuntimeError):
    pass


def model_worker(connection, tier):
    try:
        # NumPy is initialized before native inference libraries in this process.
        import numpy as np
        from chat.theory_search import _create_e5_backend, _create_model_backend, _LexicalFallbackBackend
        try:
            backend = _create_model_backend(tier) if tier else _create_e5_backend()
        except Exception as error:
            backend = _LexicalFallbackBackend(str(error))
        connection.send({"ready": True, "metadata": {
            key: getattr(backend, key, default) for key, default in (
                ("name", ""), ("model_key", ""), ("dimensions", 384),
                ("degraded", False), ("error", ""), ("evidence", {}))}})
        while True:
            request = connection.recv()
            if request["operation"] == "close":
                return
            try:
                connection.send({"started": True})
                vectors = np.asarray(backend.encode(request["texts"], request["input_type"]), dtype="<f4")
                connection.send({"shape": vectors.shape, "vectors": vectors.tobytes()})
            except Exception as error:
                connection.send({"error": str(error), "error_type": type(error).__name__})
    except (EOFError, BrokenPipeError, OSError):
        pass
    finally:
        connection.close()


class EmbeddingProcess:
    def __init__(self, *, tier=None, worker_target=model_worker):
        import multiprocessing
        self._context = multiprocessing.get_context("spawn")
        self._tier = tier
        self._target = worker_target
        self._state_lock = threading.RLock()
        self._request_lock = threading.Lock()
        self._process = None
        self._connection = None
        self._closed = False
        self._metadata = None
        self.execution_started = threading.Event()

    @property
    def pid(self):
        with self._state_lock:
            return self._process.pid if self._process is not None else None

    def _check(self, cancelled):
        if self._closed or (cancelled is not None and cancelled()):
            raise EmbeddingCancelled("Embedding operation cancelled")

    def _receive(self, cancelled, timeout=300.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self._check(cancelled)
            with self._state_lock:
                connection, process = self._connection, self._process
            if connection is None or process is None:
                raise EmbeddingCancelled("Embedding process closed")
            try:
                if connection.poll(0.025):
                    response = connection.recv()
                    if response.get("started"):
                        self.execution_started.set()
                        continue
                    if "error" in response:
                        raise RuntimeError(response["error"])
                    return response
                if not process.is_alive():
                    raise RuntimeError(f"Embedding process exited ({process.exitcode})")
            except (EOFError, OSError, TypeError, ValueError) as error:
                self._check(cancelled)
                raise RuntimeError("Embedding process disconnected") from error
        self.close()
        raise TimeoutError("Embedding process did not respond")

    def prepare(self, cancelled=None):
        with self._request_lock:
            self._check(cancelled)
            if self._metadata is not None:
                return self
            with self._state_lock:
                self._check(cancelled)
                parent, child = self._context.Pipe()
                self._connection = parent
                self._process = self._context.Process(target=self._target,
                    args=(child, self._tier), name="ails-embedding-model", daemon=True)
                try:
                    self._process.start()
                except BaseException:
                    parent.close()
                    self._connection = None
                    self._process = None
                    raise
                finally:
                    child.close()
            try:
                self._metadata = self._receive(cancelled)["metadata"]
            except BaseException:
                self.close()
                raise
            return self

    def __getattr__(self, name):
        if name in {"name", "model_key", "dimensions", "degraded", "error", "evidence"}:
            if self._metadata is None:
                raise RuntimeError("Embedding model is not prepared")
            return self._metadata[name]
        raise AttributeError(name)

    def encode(self, texts, input_type, *, cancelled=None):
        import numpy as np
        while not self._request_lock.acquire(timeout=0.025):
            self._check(cancelled)
        try:
            self._check(cancelled)
            if self._metadata is None:
                raise RuntimeError("Embedding model is not prepared")
            if not texts:
                return np.empty((0, self.dimensions), dtype=np.float32)
            with self._state_lock:
                self._check(cancelled)
                connection = self._connection
            self.execution_started.clear()
            connection.send({"operation": "encode", "texts": list(texts), "input_type": input_type})
            response = self._receive(cancelled)
            return np.frombuffer(response["vectors"], dtype="<f4").reshape(response["shape"]).copy()
        except EmbeddingCancelled:
            # Discard the process and its pending reply before accepting another request.
            self.close()
            raise
        finally:
            self._request_lock.release()

    def close(self):
        # Never acquire the request lock: a native operation may be blocked.
        with self._state_lock:
            if self._closed:
                return
            self._closed = True
            process, connection = self._process, self._connection
            self._process = self._connection = None
        if process is not None:
            if process.is_alive():
                process.terminate()
            process.join(2.0)
            if process.is_alive():
                process.kill()
                process.join(2.0)
            if not process.is_alive():
                process.close()
        if connection is not None:
            connection.close()
