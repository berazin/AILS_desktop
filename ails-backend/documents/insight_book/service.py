"""Gate first, locally edit, independently verify, then atomically publish."""
from __future__ import annotations

import time

from .contracts import digest, normalized, validate_edit, validate_gate, validate_verification
from .harness import InsightCancelled, InsightHarness
from .retrieval import encode_sections, public_sections, related_sections, toc
from .store import new_id


class InsightBookService:
    def __init__(self, store, call_ai, check_access, encoder):
        self.store, self.call_ai, self.check_access = store, call_ai, check_access
        self.encoder = encoder

    def process(self, run_id):
        run = self.store.require("run", run_id)
        if run["state"] == "done":
            return run
        if run.get("attempt", 0) >= 3:
            raise ValueError("이 작업의 최대 재시도 횟수(3회)를 초과했습니다.")
        self.store.update_run(run_id, state="running", error="", attempt=run.get("attempt", 0) + 1)
        harness = InsightHarness(self.store, run_id, self.call_ai, self.check_access)
        try:
            harness.check()
            if run["kind"] == "insight":
                self._insight(run, harness)
            elif run["kind"] == "maintain":
                self._maintain(run, harness)
            else:
                from .review import process_review
                process_review(self.store, run, harness)
            current = self.store.require("run", run_id)
            if current["state"] == "done":
                return current
            harness.check()
            return self.store.update_run(run_id, state="done", phase=current.get("outcome", "done"))
        except InsightCancelled as error:
            return self.store.update_run(run_id, state="cancelled", error=str(error))
        except Exception as error:
            return self.store.update_run(run_id, state="failed", error=str(error))
        finally:
            harness.finish_phase()

    def _insight(self, run, harness):
        raw = self.store.require("raw", run["payload"]["raw_id"])
        if run.get("accepted_correction"):
            # Acceptance is recorded separately; do not manufacture an AI verification result.
            gate = {"knowledge": raw["text"], "claims": [], "evidence": []}
        elif run.get("gate"):
            gate = run["gate"]
        else:
            evidence = []
            payload = {"original": raw["text"], "evidence": evidence}
            prior_inputs = self.store.call_input_digests(run["id"], "gate")
            if prior_inputs and digest(["gate", payload, "insight-v1"]) not in prior_inputs:
                raise ValueError("자료 검색을 사용한 이전 검증 요청은 자동 재호출하지 않습니다. 새 Insight로 등록해 주세요.")
            gate = harness.ask("gate", payload,
                               lambda result: validate_gate(result, raw["text"], evidence))
            self._save_gate(run, raw, gate)
        # The Book and its related insights are deliberately untouched before this branch.
        if not run.get("accepted_correction") and gate["verdict"] != "VERIFIED":
            self.store.update_run(run["id"], outcome="pending" if gate["verdict"] == "UNCERTAIN" else "needs_correction")
            return
        harness.phase("book_retrieval")
        committed = self.store.list("committed")
        duplicate = next((row for row in committed if normalized(row["knowledge"]) == normalized(gate["knowledge"])), None)
        if duplicate:
            self.store.update_run(run["id"], outcome="already_covered", duplicate_of=duplicate["raw_id"])
            return
        sections = self.store.list("section")
        meta = self.store.require("meta", "book")
        scope = related_sections(gate["knowledge"], sections, self.encoder)
        related = self._related_insights(gate["knowledge"], committed)
        context = {"knowledge": gate["knowledge"], "claims": gate["claims"], "evidence": gate["evidence"],
                   "related_sections": public_sections(scope), "toc": toc(sections), "related_insights": related}
        candidate = harness.ask("edit", context, lambda result: validate_edit(result, sections, scope, run["id"]))
        if not sections and not candidate["changes"]:
            raise ValueError("빈 Book에는 검증된 Insight를 담을 절이 필요합니다.")
        verification = harness.ask("verify", {**context, "mode": "integration", "candidate": candidate},
                                   lambda result: validate_verification(result, candidate["changes"]))
        self.store.update_run(run["id"], candidate=candidate, verification=verification)
        if not verification["passed"]:
            raise ValueError("Book 결과 검증 실패: " + str(verification["findings"]))
        harness.phase("embedding")
        vectors = encode_sections(candidate["changes"], sections, self.encoder)
        harness.phase("commit")
        self._commit(run, candidate, vectors, meta["revision"], raw=raw, gate=gate, verification=verification)

    def _save_gate(self, run, raw, gate):
        with self.store.transaction() as db:
            current = self.store.require("run", run["id"], db)
            current.update(gate=gate, phase="gate_complete", updated_at=time.time())
            self.store.put("run", run["id"], current, db)
            for claim in gate["claims"]:
                if claim["verdict"] not in {"INCORRECT", "PARTIALLY_CORRECT"}:
                    continue
                key = f"{raw['id']}:{claim['id']}"
                if self.store.get("wrong", key, db) is None:
                    self.store.put("wrong", key, {"id": key, "raw_id": raw["id"], "claim": claim,
                                                 "evidence": gate["evidence"], "status": "learning",
                                                 "next_review": time.time(), "created_at": time.time(),
                                                 "mastery": {"successes": 0, "forms": [], "first_success": None},
                                                 "review_ids": []}, db)

    def _related_insights(self, query, committed):
        terms = set(query.casefold().split())
        correct = [{"id": row["raw_id"], "kind": "verified", "text": row["knowledge"]} for row in committed]
        wrong = [{"id": row["id"], "kind": "misconception_not_evidence", "text": row["claim"]["text"],
                  "correction": row["claim"]["corrected"]} for row in self.store.list("wrong")]
        return sorted(correct + wrong, key=lambda row: -len(terms.intersection(row["text"].casefold().split())))[:6]

    def _maintain(self, run, harness):
        harness.phase("maintenance_scope")
        meta = self.store.require("meta", "book")
        sections = self.store.list("section")
        if not sections:
            self.store.update_run(run["id"], outcome="no_changes")
            return
        # Prefer duplicate titles/large sections, then sections least recently maintained.
        titles = [normalized(s["title"]) for s in sections]
        scope = sorted(sections, key=lambda s: (-int(titles.count(normalized(s["title"])) > 1),
                                                -int(len(s["content"]) > meta["settings"]["section_max_chars"]),
                                                s.get("maintained_revision", 0), s["position"]))[:meta["settings"]["maintenance_scope"]]
        context = {"toc": toc(sections), "scope": public_sections(scope)}
        candidate = harness.ask("maintain", context, lambda result: validate_edit(result, sections, scope, run["id"]))
        verification = harness.ask("verify", {**context, "mode": "maintenance", "candidate": candidate},
                                   lambda result: validate_verification(result, candidate["changes"]))
        self.store.update_run(run["id"], candidate=candidate, verification=verification)
        if not verification["passed"]:
            raise ValueError("구조 재편성 검증 실패: " + str(verification["findings"]))
        harness.phase("embedding")
        vectors = encode_sections(candidate["changes"], sections, self.encoder)
        harness.phase("commit")
        self._commit(run, candidate, vectors, meta["revision"], verification=verification, scope=scope)

    def _commit(self, run, candidate, vectors, base_revision, *, raw=None, gate=None, verification, scope=()):
        with self.store.transaction() as db:
            current = self.store.require("run", run["id"], db)
            if current.get("published_revision") is not None:
                return
            if current.get("cancel_requested"):
                raise InsightCancelled("확정 전에 취소되었습니다.")
            meta = self.store.require("meta", "book", db)
            if meta["revision"] != base_revision:
                raise ValueError("Book 버전이 변경됐습니다. 최신 교재를 기준으로 재시도하세요.")
            changes = candidate["changes"]
            revision = base_revision + 1 if changes else base_revision
            previous = {s["id"]: s for s in self.store.list("section", db)}
            provenance = []
            for old in previous.values():
                if old["id"] in {c["id"] for c in changes}:
                    provenance.extend(old.get("provenance", []))
            if raw:
                provenance.append({"raw_id": raw["id"], "claim_ids": [c["id"] for c in gate["claims"]],
                                   "evidence_ids": [e["id"] for e in gate["evidence"]]})
            provenance = list({digest(item): item for item in provenance}.values())
            before, after = [], []
            for change in changes:
                key = change["id"]
                old = previous.get(key)
                if old:
                    before.append({k: v for k, v in old.items() if k != "embedding"})
                if change["action"] == "delete":
                    self.store.delete("section", key, db)
                    continue
                embedding = vectors.get(key) or (old or {}).get("embedding")
                if not embedding:
                    raise ValueError("변경 절의 임베딩이 준비되지 않았습니다.")
                section = {k: change[k] for k in ("id", "chapter", "title", "position", "content")}
                section.update(embedding=embedding, provenance=provenance, revision=revision,
                               maintained_revision=revision if run["kind"] == "maintain" else (old or {}).get("maintained_revision", 0))
                self.store.put("section", key, section, db)
                after.append({k: v for k, v in section.items() if k != "embedding"})
            if changes:
                self.store.put("revision", str(revision), {"id": str(revision), "revision": revision,
                               "run_id": run["id"], "kind": run["kind"], "reason": candidate["reason"],
                               "before": before, "after": after, "changes": changes, "verification": verification,
                               "created_at": time.time()}, db)
            if raw:
                self.store.put("committed", raw["id"], {"raw_id": raw["id"], "knowledge": gate["knowledge"],
                               "revision": revision, "run_id": run["id"]}, db)
            meta["revision"] = revision
            if run["kind"] == "maintain":
                meta["last_maintenance"] = revision
                for item in scope:
                    section = self.store.get("section", item["id"], db)
                    if section:
                        section["maintained_revision"] = revision
                        self.store.put("section", section["id"], section, db)
            elif changes and meta["settings"]["maintainer_enabled"]:
                oversized = any(len(s["content"]) > meta["settings"]["section_max_chars"] for s in after)
                if oversized or revision - meta["last_maintenance"] >= meta["settings"]["maintainer_every"]:
                    followup = self.store.new_run("maintain", {"trigger_run_id": run["id"]}, db)
                    current["followup_run_id"] = followup["id"]
            self.store.put("meta", "book", meta, db)
            outcome = "committed" if changes else "already_covered"
            current.update(published_revision=revision, outcome=outcome, state="done", phase=outcome, updated_at=time.time())
            self.store.put("run", run["id"], current, db)
