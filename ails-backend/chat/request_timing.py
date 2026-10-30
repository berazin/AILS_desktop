"""Bounded, content-free chatbot latency records, independent of debug tracing."""
from __future__ import annotations

import json
import logging
import math
import os
from pathlib import Path
import re
import threading
import time
import uuid
from datetime import datetime, timezone

_storage_lock = threading.Lock()
MAX_RECORDS = 300
_STAGES = frozenset({
    "priority_ready", "prepare_completed", "session_request_start", "session_ready",
    "provider_request_start", "headers_received", "first_sse_event", "first_content",
    "first_output", "response_completed", "settlement_start", "settlement_completed",
    "retry", "fallback", "token_count_start", "token_count_completed",
})
_IDENTIFIER = re.compile(r"\w[\w./ -]{0,127}\Z")


def timing_directory() -> Path:
    override = str(os.environ.get("AILS_RUNTIME_DATA_DIR", "") or "").strip()
    if override:
        root = Path(os.path.abspath(os.path.expandvars(os.path.expanduser(override))))
    else:
        root = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
                    or os.path.join(os.path.expanduser("~"), ".local", "share")) / "AILS"
    return root / "diagnostics" / "chatbot-timings"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _duration(stages: dict, start: str, end: str) -> float | None:
    if start not in stages or end not in stages:
        return None
    return round(max(0.0, stages[end] - stages[start]), 1)


class ChatbotRequestTiming:
    def __init__(self, *, round_index: int = 1):
        self.started_at = time.monotonic()
        self.path = timing_directory() / f"{uuid.uuid4()}.json"
        self.record = {
            "schema_version": 1, "request_id": self.path.stem,
            "started_at": _utc_now(), "status": "running", "last_stage": "request_started",
            "round_index": round_index, "stages_ms": {}, "attempts": [],
            "retry_count": 0, "fallback_count": 0,
        }
        self._warned = False
        self._save(prune=True)

    def identify(self, *, model=None, provider=None, session_id=None, memory_retrieve_ms=None):
        # Only identifiers and one numeric preparation measurement are accepted.
        # Never accept payloads, URLs, prompt/answer text, credentials or errors.
        for name, value in (("model", model), ("provider", provider), ("session_id", session_id)):
            if isinstance(value, str) and _IDENTIFIER.fullmatch(value) and ".." not in value:
                self.record[name] = value
        if isinstance(memory_retrieve_ms, (int, float)) and math.isfinite(memory_retrieve_ms):
            self.record["memory_retrieve_ms"] = round(max(0, memory_retrieve_ms), 1)

    def mark(self, stage: str, details=None, *, at: float | None = None):
        if stage not in _STAGES:
            return
        details = details or {}
        observed_at = at if at is not None else details.get("at")
        if not isinstance(observed_at, (int, float)) or not math.isfinite(observed_at):
            observed_at = time.monotonic()
        elapsed = round(max(0.0, (observed_at - self.started_at) * 1000), 1)
        stages = self.record["stages_ms"]
        attempts = self.record["attempts"]
        if stage == "provider_request_start":
            # Separate retries and local-to-cloud calls so their waits are not mixed.
            if len(attempts) < 20:
                attempts.append({"index": len(attempts) + 1,
                                 "model": self.record.get("model"),
                                 "provider": self.record.get("provider"),
                                 "stages_ms": {stage: elapsed}})
        elif stage in {"headers_received", "first_sse_event", "first_content", "response_completed"} and attempts:
            attempt = attempts[-1]
            if stage in attempt["stages_ms"]:
                return  # Never write on each chunk.
            attempt["stages_ms"][stage] = elapsed
            if stage == "headers_received":
                provider = details.get("provider")
                self.identify(provider=provider)
                attempt["provider"] = self.record.get("provider")
        elif stage in {"retry", "fallback"}:
            self.record[f"{stage}_count"] += 1
        elif stage in stages:
            return
        if stage == "response_completed":
            stages[stage] = elapsed
        else:
            stages.setdefault(stage, elapsed)
        self.record["last_stage"] = stage
        if stage == "token_count_completed":
            self.record["reservation"] = {key: details[key] for key in ("input_tokens", "forecast_output_tokens", "reservation_microusd")
                                          if isinstance(details.get(key), int) and not isinstance(details.get(key), bool) and details[key] >= 0}
        self._save()

    def failed(self, error: BaseException):
        self.record.setdefault("error_type", type(error).__name__)
        self.record.setdefault("failure_stage", self.record["last_stage"])
        code = getattr(error, "error_code", None)
        if isinstance(code, str) and re.fullmatch(r"[a-zA-Z0-9_.-]{1,100}", code):
            self.record.setdefault("error_code", code)
        status = getattr(error, "status_code", None)
        if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599:
            self.record.setdefault("http_status", status)

    def finish(self, error: BaseException | None = None):
        self.record["status"] = (
            "cancelled" if isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError))
            else "failed" if error is not None else "completed"
        )
        if error is not None:
            self.failed(error)
        self.record["total_ms"] = round(max(0, (time.monotonic() - self.started_at) * 1000), 1)
        self.record["finished_at"] = _utc_now()
        self._save(prune=True)

    def _save(self, *, prune=False):
        stages = self.record["stages_ms"]
        self.record["durations_ms"] = {
            "preparation": _duration(stages, "priority_ready", "prepare_completed"),
            "session_acquisition": _duration(stages, "session_request_start", "session_ready"),
            "token_counting": _duration(stages, "token_count_start", "token_count_completed"),
            "settlement": _duration(stages, "settlement_start", "settlement_completed"),
        }
        for attempt in self.record["attempts"]:
            points = attempt["stages_ms"]
            attempt["durations_ms"] = {
                "response_headers": _duration(points, "provider_request_start", "headers_received"),
                "first_sse_after_headers": _duration(points, "headers_received", "first_sse_event"),
                "first_content_from_request": _duration(points, "provider_request_start", "first_content"),
                "stream_after_first_content": _duration(points, "first_content", "response_completed"),
                "generation": _duration(points, "provider_request_start", "response_completed"),
            }
        self.record["updated_at"] = _utc_now()
        temporary = self.path.with_suffix(".tmp")
        try:
            with _storage_lock:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                temporary.write_text(json.dumps(self.record, ensure_ascii=False, allow_nan=False), encoding="utf-8")
                os.replace(temporary, self.path)
                if prune:
                    records = sorted(self.path.parent.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
                    for old in records[MAX_RECORDS:]:
                        old.unlink(missing_ok=True)
        except OSError as error:
            # Diagnostics must not fail the user's answer or expose error text.
            if not self._warned:
                logging.getLogger(__name__).warning("Chatbot timing storage unavailable (%s)", type(error).__name__)
                self._warned = True
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
