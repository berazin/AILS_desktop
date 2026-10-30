"""Thread-safe, lazy application composition with a finite lifetime."""
from collections.abc import Callable
import threading
from typing import Any


class ServiceRegistry:
    def __init__(self, factories: dict[str, Callable[[], Any]]):
        self._factories = factories
        self._instances: dict[str, Any] = {}
        self._lock = threading.RLock()
        self._closed = False
        self._constructing: set[str] = set()

    def get(self, name: str):
        with self._lock:
            if self._closed:
                raise RuntimeError("AILS services have closed")
            if name in self._instances:
                return self._instances[name]
            if name in self._constructing:
                raise RuntimeError(f"Circular service construction: {name}")
            self._constructing.add(name)
            try:
                instance = self._factories[name]()
                self._instances[name] = instance
                return instance
            finally:
                self._constructing.remove(name)

    def peek(self, name: str):
        """Shutdown and diagnostics must never initialize an unused feature."""
        with self._lock:
            return self._instances.get(name)

    def instantiated(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._instances)

    def close(self):
        with self._lock:
            self._closed = True
