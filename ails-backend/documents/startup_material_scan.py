"""Keep recursive report/retry recovery behind the first visible listing."""

from collections.abc import Callable
import threading


class DeferredMaterialScan:
    def __init__(self, callbacks: tuple[Callable[[], None], ...], on_error: Callable[[str], None], *, fallback_seconds: float = 2.0):
        self.callbacks = callbacks
        self.on_error = on_error
        self.fallback_seconds = fallback_seconds
        self.ready = threading.Event()
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._run, name="ails-startup-material-scan", daemon=True)

    def start(self):
        self.thread.start()

    def release(self):
        self.ready.set()

    def close(self):
        self.stopped.set()
        self.ready.set()
        if self.thread.ident is not None and self.thread is not threading.current_thread():
            self.thread.join(timeout=2.0)

    def _run(self):
        # A one-shot fallback also supports API-only clients that never open Home.
        self.ready.wait(self.fallback_seconds)
        for callback in self.callbacks:
            if self.stopped.is_set():
                return
            try:
                callback()
            except Exception as error:
                self.on_error(f"Startup material recovery failed: {type(error).__name__}")
