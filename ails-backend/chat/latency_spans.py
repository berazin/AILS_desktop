"""Request-scoped numeric spans. Never retain arguments, results or exceptions."""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import time

_current = ContextVar("chat_latency", default=None)
NAMES = frozenset({
    "prompt_prepare", "history", "memory_identity", "memory_retrieve", "memory_save",
    "document_retrieval", "document_read", "embedding_ready", "query_embedding",
    "passage_embeddings", "dense_search", "reranking", "catalog", "capabilities",
    "lease_issue", "local_ready", "local_cold_load",
})


@contextmanager
def capture(timing):
    token = _current.set(timing)
    try:
        yield
    finally:
        _current.reset(token)


@contextmanager
def span(name):
    timing = _current.get()
    if timing is None or name not in NAMES:
        yield
        return
    start = time.monotonic()
    precise_start = time.perf_counter()
    try:
        yield
    finally:
        # Stored at existing stage checkpoints, never extra per-span disk I/O.
        values = timing.record.setdefault("spans", [])
        if len(values) < 100:
            values.append({"name": name, "start_ms": round((start - timing.started_at) * 1000, 1),
                           "duration_ms": round((time.perf_counter() - precise_start) * 1000, 1)})


def measured(name):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            with span(name):
                return function(*args, **kwargs)
        return wrapped
    return decorate
