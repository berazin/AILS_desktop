"""Keep reading AI deltas while one worker applies completed problem results."""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

from documents.problem_batch_response_stream import BatchGradingCancelled, BatchResultStream


class BatchStreamApplication:
    def __init__(self, prepared, *, complete, publish, is_cancelled):
        self.prepared = {item["payload"]["problem_id"]: item for item in prepared}
        self.parser = BatchResultStream(list(self.prepared))
        self.complete = complete
        self.publish = publish
        self.is_cancelled = is_cancelled
        self.stopped = threading.Event()
        self.metadata = {}
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="problem-batch-results")
        self.futures = []
        self.queued = set()

    def check_cancelled(self):
        if self.stopped.is_set() or self.is_cancelled():
            raise BatchGradingCancelled("Batch grading was cancelled.")

    def started(self, metadata):
        self.metadata = {key: metadata.get(key) for key in ("provider", "model")}

    def text(self, delta):
        self.check_cancelled()
        for problem_id, grading in self.parser.feed(delta):
            self.enqueue(problem_id, grading)

    def enqueue(self, problem_id, grading):
        if problem_id in self.queued:
            return
        self.check_cancelled()
        self.queued.add(problem_id)
        self.futures.append(self.executor.submit(self.apply, problem_id, grading))

    def apply(self, problem_id, grading):
        if self.stopped.is_set() or self.is_cancelled():
            return
        try:
            result = self.complete(self.prepared[problem_id], grading, {**self.metadata, "usage": None})
            item = {"problem_id": problem_id, "result": result}
        except Exception as error:
            item = {"problem_id": problem_id, "error": str(error)}
        if self.stopped.is_set() or self.is_cancelled():
            return
        try:
            self.publish(item)
        except Exception:
            # A disconnected consumer must stop the upstream request, rather
            # than turn already-applied grading into a replay of a paid batch.
            self.stopped.set()
            raise

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=self.stopped.is_set() or self.is_cancelled())
        for future in self.futures:
            if not future.cancelled():
                future.result()
