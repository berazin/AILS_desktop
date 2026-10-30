"""One live configuration owner, shared through explicit service ports."""
import threading
from settings.development_mode import runtime_configuration


class Configuration:
    def __init__(self, value: dict):
        self.value = runtime_configuration(value)
        # Some existing workflows replace settings while holding this lock.
        self.lock = threading.RLock()

    def replace(self, value: dict):
        with self.lock:
            self.value = runtime_configuration(value)
