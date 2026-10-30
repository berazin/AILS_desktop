"""Durable bounded AI calls; completed responses survive cancellation and application failures."""
from __future__ import annotations

import time

from .contracts import digest
from .timing import measure_call, measure_span


class InsightCancelled(RuntimeError):
    pass


class InsightHarness:
    def __init__(self, store, run_id, call_ai, check_access):
        self.store, self.run_id = store, run_id
        self.call_ai, self.check_access = call_ai, check_access
        self._last_access_check = 0.0
        self._phase = None

    def check(self, *, force=False):
        run = self.store.require("run", self.run_id)
        if run.get("cancel_requested"):
            raise InsightCancelled("작업이 취소됐습니다. 저장된 응답은 재개할 때 재사용합니다.")
        if force or time.monotonic() - self._last_access_check >= 2:
            with measure_span("access_guard"):
                self.check_access()
            self._last_access_check = time.monotonic()

    def phase(self, name):
        self.check(force=True)
        self.finish_phase()
        self.store.update_run(self.run_id, phase=name)
        self._phase = (name, time.perf_counter(), time.time())

    def finish_phase(self):
        if self._phase is not None:
            name, started, wall_started = self._phase
            self._phase = None
            self.store.record_phase_timing(self.run_id, {"phase": name, "started_at": wall_started,
                                                       "ended_at": time.time(), "elapsed_s": round(time.perf_counter() - started, 6)})

    def ask(self, operation, payload, validate):
        original = payload
        for repair in range(2):
            with measure_call() as timing:
                new_call = False
                try:
                    self.phase(operation)
                    self.check(force=True)
                    identity = digest([operation, payload, "insight-v1"])
                    key = f"{self.run_id}:{identity}"
                    cached = self.store.get("call", key)
                    generation = self.store.require("run", self.run_id).get("unknown_retry", 0)
                    if cached and cached["state"] != "received" and generation:
                        original_key = key
                        # Preserve a paid response from an earlier approved attempt.
                        for attempt in range(1, generation + 1):
                            key = original_key + f":approved-retry-{attempt}"
                            cached = self.store.get("call", key)
                            if cached and cached["state"] == "received":
                                break
                    if cached and cached["state"] == "received":
                        response = cached["response"]
                    else:
                        if cached:
                            raise RuntimeError("이전 AI 요청의 응답 여부가 확인되지 않습니다. 중복 과금 가능성을 확인한 뒤 새 시도를 승인하세요.")
                        with self.store.transaction() as db:
                            if self.store.get("call", key, db):
                                raise RuntimeError("동일 AI 요청이 이미 진행 중입니다. 저장된 응답을 확인한 뒤 재개하세요.")
                            record = {"id": key, "run_id": self.run_id, "operation": operation,
                                      "state": "started", "started_at": time.time(), "input_digest": identity}
                            self.store.put("call", key, record, db)
                        new_call = True
                        response = self.call_ai(operation, payload, self.check)
                        timing.event("provider_request_end")
                        # Preserve the start timestamp and paid response before further checks.
                        self.store.put("call", key, {**record, "state": "received", "response": response,
                                                     "received_at": time.time()})
                    self.check(force=True)
                    try:
                        return validate(response["raw"])
                    except (ValueError, KeyError, TypeError) as error:
                        if repair:
                            raise ValueError(f"구조화 응답 교정 후에도 적용할 수 없습니다: {error}") from error
                        payload = {**original, "contract_repair": {"error": str(error), "invalid_response": response["raw"]}}
                finally:
                    if new_call:
                        self.store.record_call_timing(key, timing.snapshot())
        raise AssertionError("bounded repair exhausted")
