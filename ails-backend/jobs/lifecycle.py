"""Idempotent application shutdown without starting unused features."""
from collections.abc import Callable
import logging
import threading

logger = logging.getLogger(__name__)


class ApplicationLifetime:
    def __init__(self):
        self.stopping = threading.Event()
        self.closed = threading.Event()
        self._lock = threading.Lock()
        self._callbacks: list[tuple[str, Callable[[], None]]] = []

    def register(self, name: str, close: Callable[[], None]):
        with self._lock:
            if self.stopping.is_set():
                raise RuntimeError("AILS is shutting down")
            self._callbacks.append((name, close))

    def close(self):
        with self._lock:
            if self.stopping.is_set():
                return
            self.stopping.set()
            callbacks = list(reversed(self._callbacks))
        try:
            for name, close in callbacks:
                try:
                    close()
                except Exception:
                    logger.exception("Failed to close AILS resource: %s", name)
        finally:
            self.closed.set()
