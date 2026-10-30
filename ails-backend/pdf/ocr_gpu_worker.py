"""Isolated native OCR worker lifecycle and recovery protocol."""

from __future__ import annotations

import atexit
import multiprocessing
import os
import queue
import threading
import traceback
import uuid
from collections.abc import Callable


_FATAL_OPENVINO_MARKERS = (
    "CL_OUT_OF_RESOURCES",
    "CL_INVALID_EVENT",
    "PROGRAMBUILDER BUILD FAILED",
)


def is_fatal_openvino_error(error) -> bool:
    message = str(error or "").upper()
    return any(marker in message for marker in _FATAL_OPENVINO_MARKERS)


class GpuOcrWorkerCancelled(RuntimeError):
    pass


class GpuOcrWorkerRemoteError(RuntimeError):
    def __init__(self, message: str, *, fatal: bool, error_type: str = ""):
        super().__init__(message)
        self.fatal = bool(fatal)
        self.error_type = str(error_type or "")


class GpuOcrWorkerExitedError(GpuOcrWorkerRemoteError):
    pass


def _release_worker_engines() -> None:
    try:
        import pdf.pdf_ocr as pdf_ocr
        pdf_ocr.release_all_ocr_engines()
    except Exception:
        pass


def _worker_main(request_queue, response_queue, idle_timeout_seconds: float):
    os.environ["AILS_OCR_GPU_WORKER"] = "1"
    import pdf.pdf_ocr as pdf_ocr
    while True:
        try:
            envelope = request_queue.get(timeout=idle_timeout_seconds)
        except queue.Empty:
            _release_worker_engines()
            continue
        if envelope.get("type") == "shutdown":
            _release_worker_engines()
            return
        if envelope.get("type") == "release":
            _release_worker_engines()
            response_queue.put({
                "type": "released",
                "request_id": envelope["request_id"],
            })
            continue
        if envelope.get("type") == "telemetry":
            import pdf.paddlex_engine_compat as paddlex_engine_compat
            response_queue.put({
                "type": "telemetry",
                "request_id": envelope["request_id"],
                "snapshot": paddlex_engine_compat.active_session_snapshot(),
                "log": paddlex_engine_compat.get_session_creation_log(),
            })
            continue
        request_id = envelope["request_id"]
        request = envelope["request"]

        def emit(event: dict) -> None:
            response_queue.put({
                "type": "event",
                "request_id": request_id,
                "event": event,
            })

        token = pdf_ocr._CURRENT_OCR_GPU_PRIORITY.set(
            int(request.get("priority") or 0)
        )
        fatal = False
        try:
            result = pdf_ocr._analyze_pdf_pages_structure_inline(
                request["render_source"],
                int(request["total"]),
                request["profile"],
                request["language"],
                request["model_variant"],
                emit,
                None,
                page_indexes=request.get("page_indexes"),
            )
            response_queue.put({
                "type": "result",
                "request_id": request_id,
                "result": result,
            })
        except BaseException as error:
            fatal = is_fatal_openvino_error(error)
            response_queue.put({
                "type": "error",
                "request_id": request_id,
                "fatal": fatal,
                "error_type": type(error).__name__,
                "error": str(error),
                "traceback": traceback.format_exc(),
            })
        finally:
            pdf_ocr._CURRENT_OCR_GPU_PRIORITY.reset(token)
        if fatal:
            _release_worker_engines()
            return


class GpuOcrWorkerClient:
    def __init__(
        self,
        *,
        worker_target: Callable = _worker_main,
        poll_seconds: float = 0.05,
        idle_timeout_seconds: float = 120.0,
    ):
        self._context = multiprocessing.get_context("spawn")
        self._worker_target = worker_target
        self._poll_seconds = max(0.01, float(poll_seconds))
        self._idle_timeout_seconds = max(0.1, float(idle_timeout_seconds))
        self._lock = threading.Lock()
        self._closed = threading.Event()
        self._process = None
        self._request_queue = None
        self._response_queue = None
        self.restart_count = 0

    def is_alive(self) -> bool:
        process = self._process
        return bool(process is not None and process.is_alive())

    def _start_locked(self) -> None:
        if self._closed.is_set():
            raise GpuOcrWorkerCancelled("OCR worker has closed")
        if self.is_alive():
            return
        self._dispose_locked()
        self._request_queue = self._context.Queue()
        self._response_queue = self._context.Queue()
        self._process = self._context.Process(
            target=self._worker_target,
            args=(
                self._request_queue,
                self._response_queue,
                self._idle_timeout_seconds,
            ),
            name="ails-ocr",
            daemon=True,
        )
        self._process.start()

    def _dispose_locked(self, *, graceful: bool = False) -> None:
        process = self._process
        request_queue = self._request_queue
        response_queue = self._response_queue
        if process is not None:
            if graceful and process.is_alive() and request_queue is not None:
                try:
                    request_queue.put({"type": "shutdown"})
                    process.join(2.0)
                except (OSError, ValueError):
                    pass
            if process.is_alive():
                process.terminate()
                process.join(5.0)
            else:
                process.join(0.1)
            if process.is_alive():
                process.kill()
                process.join(2.0)
            process.close()
        for work_queue in (request_queue, response_queue):
            if work_queue is None:
                continue
            try:
                # A killed reader cannot drain queued requests. Joining its
                # feeder would hang shutdown indefinitely.
                work_queue.cancel_join_thread()
                work_queue.close()
            except (OSError, ValueError):
                pass
        self._process = None
        self._request_queue = None
        self._response_queue = None

    def shutdown(self) -> None:
        # The request loop owns the process lock. Signal it before waiting for
        # that lock so native inference can be terminated immediately.
        self._closed.set()
        with self._lock:
            self._dispose_locked(graceful=True)

    close = shutdown

    def _request_envelope(self, envelope_type: str):
        """Send a simple command envelope and return its matching response."""
        with self._lock:
            if not self.is_alive():
                return None
            process = self._process
            request_queue = self._request_queue
            response_queue = self._response_queue
            request_id = uuid.uuid4().hex
            try:
                request_queue.put({
                    "type": envelope_type,
                    "request_id": request_id,
                })
            except (OSError, ValueError):
                self._dispose_locked()
                return None
            while True:
                if self._closed.is_set():
                    self._dispose_locked()
                    return None
                if not process.is_alive():
                    self._dispose_locked()
                    return None
                try:
                    response = response_queue.get(timeout=self._poll_seconds)
                except queue.Empty:
                    continue
                except (OSError, ValueError):
                    self._dispose_locked()
                    return None
                if response.get("request_id") != request_id:
                    continue
                return response

    def release_engines(self) -> bool:
        response = self._request_envelope("release")
        return bool(response is not None and response.get("type") == "released")

    def telemetry(self) -> dict | None:
        response = self._request_envelope("telemetry")
        if response is None or response.get("type") != "telemetry":
            return None
        return {
            "snapshot": response.get("snapshot") or {},
            "log": response.get("log") or [],
        }

    def analyze(
        self,
        request: dict,
        *,
        emit: Callable[[dict], None] | None = None,
        cancel_event: threading.Event | None = None,
    ):
        with self._lock:
            for attempt in range(2):
                self._start_locked()
                process = self._process
                request_queue = self._request_queue
                response_queue = self._response_queue
                request_id = uuid.uuid4().hex
                request_queue.put({
                    "type": "analyze",
                    "request_id": request_id,
                    "attempt": attempt,
                    "request": request,
                })
                retry = False
                while True:
                    if self._closed.is_set() or (cancel_event is not None and cancel_event.is_set()):
                        self._dispose_locked()
                        raise GpuOcrWorkerCancelled(
                            "OCR GPU worker cancelled"
                        )
                    try:
                        response = response_queue.get(
                            timeout=self._poll_seconds
                        )
                    except queue.Empty:
                        if process.is_alive():
                            continue
                        exit_code = process.exitcode
                        self._dispose_locked()
                        if attempt == 0:
                            self.restart_count += 1
                            retry = True
                            break
                        raise GpuOcrWorkerExitedError(
                            f"OCR GPU worker exited with code {exit_code}",
                            fatal=True,
                            error_type="WorkerExitError",
                        )
                    if response.get("request_id") != request_id:
                        continue
                    response_type = response.get("type")
                    if response_type == "event":
                        if emit is not None:
                            emit(response.get("event") or {})
                        continue
                    if response_type == "result":
                        return response.get("result")
                    if response_type == "error":
                        error = GpuOcrWorkerRemoteError(
                            response.get("error") or "OCR GPU worker failed",
                            fatal=bool(response.get("fatal")),
                            error_type=response.get("error_type") or "",
                        )
                        if error.fatal:
                            self._dispose_locked()
                            if attempt == 0:
                                self.restart_count += 1
                                retry = True
                                break
                        raise error
                if retry:
                    continue
            raise GpuOcrWorkerExitedError(
                "OCR GPU worker retry exhausted",
                fatal=True,
                error_type="WorkerExitError",
            )


_worker_client = GpuOcrWorkerClient(
    idle_timeout_seconds=float(
        os.environ.get("AILS_OCR_GPU_WORKER_IDLE_SECONDS", "120")
    )
)


def analyze_in_gpu_worker(
    request: dict,
    emit: Callable[[dict], None] | None = None,
    cancel_event: threading.Event | None = None,
):
    return _worker_client.analyze(
        request,
        emit=emit,
        cancel_event=cancel_event,
    )


def shutdown_gpu_worker() -> None:
    _worker_client.shutdown()


def release_gpu_worker_engines() -> bool:
    return _worker_client.release_engines()


def gpu_worker_telemetry() -> dict | None:
    """Return the worker's session snapshot/log, or None when not running."""
    return _worker_client.telemetry()


atexit.register(shutdown_gpu_worker)
