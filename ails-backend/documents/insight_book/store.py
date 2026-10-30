"""SQLite atomic publication, immutable originals, and durable AI checkpoints."""
from __future__ import annotations

from contextlib import contextmanager
import json
import os
import sqlite3
import time
import uuid

from .contracts import DEFAULT_SETTINGS, digest, text


def new_id():
    return uuid.uuid4().hex


class InsightStore:
    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with self.transaction() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS raw_insights (
                  id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS raw_immutable_update BEFORE UPDATE ON raw_insights
                  BEGIN SELECT RAISE(ABORT, 'Raw Insight is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS raw_immutable_delete BEFORE DELETE ON raw_insights
                  BEGIN SELECT RAISE(ABORT, 'Raw Insight is immutable'); END;
                CREATE TABLE IF NOT EXISTS insight_records (
                  kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
                  PRIMARY KEY(kind, id));
            """)
            db.execute("BEGIN IMMEDIATE")
            if self.get("meta", "book", db) is None:
                self.put("meta", "book", {"revision": 0, "last_maintenance": 0,
                                           "settings": dict(DEFAULT_SETTINGS)}, db)

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute("PRAGMA busy_timeout=30000")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def get(self, kind, key, db=None):
        if db is None:
            with self.transaction() as connection:
                return self.get(kind, key, connection)
        if kind == "raw":
            row = db.execute("SELECT body FROM raw_insights WHERE id=?", (key,)).fetchone()
        else:
            row = db.execute("SELECT body FROM insight_records WHERE kind=? AND id=?", (kind, key)).fetchone()
        return json.loads(row[0]) if row else None

    def require(self, kind, key, db=None):
        result = self.get(kind, key, db)
        if result is None:
            raise ValueError("해당 Insight Book 기록을 찾을 수 없습니다.")
        return result

    def list(self, kind, db=None):
        if db is None:
            with self.transaction() as connection:
                return self.list(kind, connection)
        query, args = (("SELECT body FROM raw_insights ORDER BY rowid DESC", ()) if kind == "raw" else
                       ("SELECT body FROM insight_records WHERE kind=? ORDER BY rowid DESC", (kind,)))
        return [json.loads(row[0]) for row in db.execute(query, args)]

    def put(self, kind, key, value, db=None):
        if kind == "raw":
            raise ValueError("Raw Insight는 변경할 수 없습니다.")
        if db is None:
            with self.transaction() as connection:
                return self.put(kind, key, value, connection)
        db.execute("INSERT INTO insight_records(kind,id,body) VALUES(?,?,?) "
                   "ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
                   (kind, key, json.dumps(value, ensure_ascii=False)))

    def call_input_digests(self, run_id, operation):
        with self.transaction() as db:
            return [row[0] for row in db.execute(
                "SELECT json_extract(body, '$.input_digest') FROM insight_records "
                "WHERE kind='call' AND json_extract(body, '$.run_id')=? "
                "AND json_extract(body, '$.operation')=?", (run_id, operation))]

    def record_call_timing(self, key, timing):
        with self.transaction() as db:
            call = self.require("call", key, db)
            call["timing"] = timing
            self.put("call", key, call, db)
            run = self.require("run", call["run_id"], db)
            entries = run.setdefault("call_timings", [])
            entries[:] = [entry for entry in entries if entry["call_id"] != key]
            entries.append({"call_id": key, "operation": call["operation"], "state": call["state"],
                            "started_at": call.get("started_at"), "received_at": call.get("received_at"), **timing})
            response = call.get("response") or {}
            usage = response.get("usage") or {}
            if response.get("model"):
                entries[-1]["model"] = response["model"]
            for field in ("requested_reasoning_effort", "reported_reasoning_effort", "thought_tokens"):
                if field in usage:
                    entries[-1][field] = usage[field]
                elif field in response:
                    entries[-1][field] = response[field]
            self.put("run", run["id"], run, db)

    def record_phase_timing(self, run_id, timing):
        with self.transaction() as db:
            run = self.require("run", run_id, db)
            run.setdefault("phase_timings", []).append(timing)
            self.put("run", run_id, run, db)

    def delete(self, kind, key, db):
        if kind != "section":
            raise ValueError("학습 이력은 삭제할 수 없습니다.")
        db.execute("DELETE FROM insight_records WHERE kind=? AND id=?", (kind, key))

    def submit(self, value, request_key, sources, parent_id="", *, approve_correction=False):
        text(value, "Insight", 10000)
        text(request_key, "요청 ID", 100)
        identity = digest([value, sources, parent_id])
        with self.transaction() as db:
            alias = self.get("raw_request", request_key, db)
            if alias:
                if alias["identity"] != identity:
                    raise ValueError("동일 요청 ID에 다른 Insight를 제출할 수 없습니다.")
                return self.require("run", alias["run_id"], db)
            prior = db.execute("SELECT body FROM raw_insights WHERE request_key=?", (request_key,)).fetchone()
            if prior:
                raw = json.loads(prior[0])
                if raw["identity"] != identity:
                    raise ValueError("동일 요청 ID에 다른 Insight를 제출할 수 없습니다.")
                return self.require("run", raw["run_id"], db)
            duplicate = db.execute("SELECT body FROM raw_insights WHERE json_extract(body, '$.identity')=? LIMIT 1", (identity,)).fetchone()
            if duplicate:
                raw = json.loads(duplicate[0])
                self.put("raw_request", request_key, {"identity": identity, "run_id": raw["run_id"]}, db)
                return self.require("run", raw["run_id"], db)
            acceptance = None
            if parent_id:
                self.require("raw", parent_id, db)
                if approve_correction:
                    from .correction import accepted_correction
                    acceptance = accepted_correction(self, value, parent_id, db)
            raw_id, run_id = new_id(), new_id()
            raw = {"id": raw_id, "run_id": run_id, "text": value, "sources": sources,
                   "parent_id": parent_id, "identity": identity, "created_at": time.time()}
            db.execute("INSERT INTO raw_insights VALUES(?,?,?)", (raw_id, request_key, json.dumps(raw, ensure_ascii=False)))
            run = self.new_run("insight", {"raw_id": raw_id}, db, run_id=run_id)
            if acceptance:
                run["accepted_correction"] = acceptance
                self.put("run", run_id, run, db)
            return run

    def new_run(self, kind, payload, db=None, *, run_id=None):
        run_id = run_id or new_id()
        run = {"id": run_id, "kind": kind, "payload": payload, "state": "queued", "phase": "queued",
               "error": "", "created_at": time.time(), "updated_at": time.time(), "attempt": 0}
        self.put("run", run_id, run, db)
        return run

    def update_run(self, run_id, **values):
        with self.transaction() as db:
            run = self.require("run", run_id, db)
            run.update(values, updated_at=time.time())
            self.put("run", run_id, run, db)
            return run

    def cancel(self, run_id):
        with self.transaction() as db:
            run = self.require("run", run_id, db)
            if run["state"] in {"queued", "running"}:
                run.update(cancel_requested=True, updated_at=time.time())
                if run["state"] == "queued":
                    run["state"] = "cancelled"
                self.put("run", run_id, run, db)
            return run

    def snapshot(self, raw_offset=0, revision_offset=0, review_filter="all"):
        from .review_status import review_statuses
        if review_filter not in {"all", "pending", "completed"}:
            raise ValueError("검토 목록 필터가 잘못됐습니다.")
        with self.transaction() as db:
            meta = self.require("meta", "book", db)
            sections = sorted(self.list("section", db), key=lambda row: (row["position"], row["id"]))
            raw_all = self.list("raw", db)
            runs = self.list("run", db)
            statuses = review_statuses(raw_all, runs)
            counts = {"pending": sum(status == "pending" for status in statuses.values()),
                      "completed": sum(status != "pending" for status in statuses.values())}
            filtered = [raw for raw in raw_all if review_filter == "all"
                        or (statuses[raw["id"]] == "pending") == (review_filter == "pending")]
            raw_page = [{**raw, "review_status": statuses[raw["id"]]}
                        for raw in filtered[raw_offset:raw_offset + 100]]
            required_runs = {r["run_id"] for r in raw_page}
            visible_runs = [r for i, r in enumerate(runs) if i < 100 or r["id"] in required_runs or r["state"] in {"queued", "running"}]
            revisions = self.list("revision", db)
            return {**meta, "sections": [{k: v for k, v in s.items() if k != "embedding"} for s in sections],
                    "raw_insights": raw_page, "runs": visible_runs, "raw_count": len(raw_all), "revision_count": len(revisions),
                    "review_filter": review_filter, "review_count": len(filtered), "review_counts": counts,
                    "wrong_insights": self.list("wrong", db), "revisions": revisions[revision_offset:revision_offset + 50],
                    "reviews": [public_review(row) for row in self.list("review", db)],
                    "now": time.time()}


def public_review(row):
    return {key: value for key, value in row.items() if row.get("graded_at") or key not in {"expected", "rubric"}}
