from __future__ import annotations

import contextlib
import heapq
import itertools
import threading
import uuid
from collections.abc import Callable, Iterator
from enum import IntEnum


class GpuPriority(IntEnum):
    CRITICAL = 5
    HIGH = 10
    NORMAL = 20
    BACKGROUND = 30


def normalize_gpu_priority(priority: int | str | None, default: int = GpuPriority.NORMAL) -> int:
    if priority is None:
        return int(default)
    if isinstance(priority, (int, float)):
        return int(priority)
    key = str(priority).strip().lower()
    if key in {"critical", "interactive", "realtime", "voice", "chat"}:
        return int(GpuPriority.CRITICAL)
    if key in {"high", "urgent", "stt"}:
        return int(GpuPriority.HIGH)
    if key in {"normal", "standard", "medium", "default"}:
        return int(GpuPriority.NORMAL)
    if key in {"background", "low", "batch", "idle"}:
        return int(GpuPriority.BACKGROUND)
    return int(default)


class GpuScheduler:
    """Priority queue gate for long-running local GPU inference work.

    Tasks with lower priority numerical values (e.g. HIGH=10) execute before
    higher values (e.g. NORMAL=20, BACKGROUND=30). Tasks with identical priority
    preserve strict FIFO order. Reentrant calls on the same thread are supported.
    """

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._heap: list[tuple[int, int, str, str]] = []
        self._counter = itertools.count()
        self._active: tuple[int, int, str, str] | None = None
        self._active_thread: int | None = None
        self._active_depth: int = 0

    @contextlib.contextmanager
    def acquire(
        self,
        job_type: str,
        priority: int | str | Callable[[], None] | None = GpuPriority.NORMAL,
        cancel_check: Callable[[], None] | None = None,
    ) -> Iterator[None]:
        if callable(priority) and cancel_check is None:
            cancel_check = priority
            prio = int(GpuPriority.NORMAL)
        else:
            prio = normalize_gpu_priority(priority, default=GpuPriority.NORMAL)
        ticket = (prio, next(self._counter), str(job_type or "local-ai"), uuid.uuid4().hex)
        current_thread = threading.get_ident()
        with self._condition:
            if self._active_thread == current_thread:
                self._active_depth += 1
                is_reentrant = True
            else:
                is_reentrant = False
                heapq.heappush(self._heap, ticket)
                try:
                    while self._active is not None or (self._heap and self._heap[0] != ticket):
                        if cancel_check is not None:
                            cancel_check()
                        self._condition.wait(0.1)
                    heapq.heappop(self._heap)
                    self._active = ticket
                    self._active_thread = current_thread
                    self._active_depth = 1
                except BaseException:
                    if ticket in self._heap:
                        self._heap.remove(ticket)
                        heapq.heapify(self._heap)
                    self._condition.notify_all()
                    raise
        try:
            yield
        finally:
            with self._condition:
                if is_reentrant:
                    self._active_depth -= 1
                else:
                    self._active_depth -= 1
                    if self._active_depth <= 0:
                        self._active = None
                        self._active_thread = None
                        self._active_depth = 0
                        self._condition.notify_all()

    def status(self) -> dict:
        with self._condition:
            sorted_waiting = sorted(self._heap)
            return {
                "active": self._active[2] if self._active else "",
                "waiting": [item[2] for item in sorted_waiting],
                "concurrency": 1,
            }


GPU_SCHEDULER = GpuScheduler()
