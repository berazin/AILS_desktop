"""Content-free latency measurements for one Insight AI attempt."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import threading
import time

_current = ContextVar("insight_call_timing", default=None)


class CallTiming:
    def __init__(self):
        self.started = time.monotonic()
        self.started_precise = time.perf_counter()
        self.events = {}
        self.spans = []
        self.open_spans = {}
        self.lock = threading.RLock()

    def event(self, name, details=None):
        if name not in {"provider_request_start", "headers_received", "first_sse_event", "first_content", "provider_request_end",
                        "provider_auth_start", "provider_auth_end", "session_setup_start", "session_setup_end"}:
            return
        at = (details or {}).get("at")
        at = time.monotonic() if at is None else at
        precise = (details or {}).get("precise_at")
        if precise is not None:
            at = self.started + float(precise) - self.started_precise
        with self.lock:
            if name in {"provider_auth_start", "session_setup_start"}:
                self.open_spans[name[:-6]] = float(at)
                return
            if name in {"provider_auth_end", "session_setup_end"}:
                span = name[:-4]
                start = self.open_spans.pop(span, None)
                if start is not None:
                    self.spans.append((span, start, float(at), (details or {}).get("duration_s", float(at) - start)))
                return
            self.events.setdefault(name, float(at))

    @contextmanager
    def span(self, name):
        precise = time.perf_counter()
        start = self.started + precise - self.started_precise
        try:
            yield
        finally:
            with self.lock:
                duration = time.perf_counter() - precise
                self.spans.append((name, start, start + duration, duration))

    def snapshot(self):
        with self.lock:
            end = time.monotonic()
            spans, events = list(self.spans), dict(self.events)
        result = {"total_s": round(time.perf_counter() - self.started_precise, 6)}
        for name in ("auth_check", "auth_remote", "provider_auth", "session_setup", "access_guard"):
            selected = [duration for n, a, b, duration in spans if n == name]
            result[name + "_s"] = round(sum(selected), 6)
            result[name + "_count"] = len(selected)
        start = events.get("provider_request_start")
        finish = events.get("provider_request_end", end)
        if start is not None:
            result["ai_response_s"] = round(max(0, finish - start), 6)
            result["ai_non_auth_s"] = round(max(0, finish - start - sum(
                max(0, min(b, finish) - max(a, start)) for n, a, b, duration in spans if n in {"auth_check", "provider_auth"})), 6)
            for event, field in (("headers_received", "ai_headers_s"), ("first_sse_event", "ai_first_event_s"), ("first_content", "ai_first_output_s")):
                if event in events:
                    result[field] = round(max(0, events[event] - start), 6)
        return result


@contextmanager
def measure_call():
    timing = CallTiming()
    token = _current.set(timing)
    try:
        yield timing
    finally:
        _current.reset(token)


@contextmanager
def measure_span(name):
    timing = _current.get()
    if timing is None:
        yield
    else:
        with timing.span(name):
            yield


def provider_timing_callback():
    timing = _current.get()
    return timing.event if timing else None
