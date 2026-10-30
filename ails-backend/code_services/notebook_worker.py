"""Keep a notebook's Jupyter/ZMQ objects on one owning thread.

HTTP handlers run on different threads. Serializing calls with a lock alone
still moves Jupyter sockets between threads, and restart must not close them
while an execution is receiving messages.
"""

from concurrent.futures import ThreadPoolExecutor
import threading


class NotebookWorker:
    def __init__(self):
        self.cancelled = threading.Event()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ails-notebook")
        self._closed = False
        self._lock = threading.Lock()

    def run(self, action):
        with self._lock:
            if self._closed:
                raise RuntimeError("Notebook worker has closed")
            future = self.executor.submit(action)
        return future.result()

    def begin_execution(self):
        with self._lock:
            if self._closed:
                raise RuntimeError("Notebook worker has closed")
            self.cancelled.clear()

    def close(self, release):
        """Run socket/kernel cleanup on the same thread that owns them."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self.cancelled.set()
            future = self.executor.submit(release)
            self.executor.shutdown(wait=False)
        return future


def notebook_worker(state, path):
    from ide_policy import require_ide
    require_ide()
    with state.notebook_kernel_lock:
        if getattr(state, "_closing", False):
            raise RuntimeError("Notebook service has closed")
        workers = getattr(state, "_notebook_workers", None)
        if workers is None:
            workers = state._notebook_workers = {}
        if path not in workers:
            workers[path] = NotebookWorker()
        return workers[path]
