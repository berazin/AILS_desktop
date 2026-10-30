"""Server settlement receipts for video reports; never persist session tokens."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from collections.abc import Mapping

from task_persistence import build_retry_registry_path, load_retry_registry, upsert_retry_registry_entry

_BLOCK = re.compile(r"\n*<!-- AILS_SERVER_SETTLEMENT_START -->.*?<!-- AILS_SERVER_SETTLEMENT_END -->", re.S)
_DATA = re.compile(r"<!-- AILS_SERVER_SETTLEMENT_DATA (.*?) -->")
_COST_BLOCK = re.compile(r"<!-- AILS_REPORT_COST_START -->.*?<!-- AILS_REPORT_COST_END -->", re.S)
_SOURCE_URL = re.compile(r"<!-- AILS_SOURCE_URL: ([^\r\n>]+) -->")

_PHASES = {"stt", "stt_cleanup", "video_visual", "image_analysis", "summary", "verification", "web_search"}


def report_content_digest(content):
    """Fingerprint user content independently of the app-owned cost card."""
    text = _COST_BLOCK.sub("<<<AI_USAGE_PLACEHOLDER>>>", str(content).replace("\r\n", "\n"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def tag_managed_session(session, phase):
    """Attach attribution to a live session; preserve later settlement mutation.

    Pre-reserved sessions receive `settlement` during task cleanup. Their
    record must reference that same dict until merge_settlements strips tokens.
    """
    tagged = session if isinstance(session, dict) else dict(session)
    tagged["phase"] = phase if phase in _PHASES else "unknown"
    tagged["attempt"] = "current"
    return tagged


def prior_settlements(records):
    """Move saved receipts into a retry without changing their server amounts."""
    return [{**record, "attempt": "prior"} for record in records or [] if isinstance(record, Mapping)]


def prior_usage_events(events):
    return [{**event, "attempt": "prior"} for event in events or [] if isinstance(event, Mapping)]


def usage_cost_sources(events):
    """Classify BYOK usage events supplied by the caller; do not mix with receipts.

    `actual_cost_usd` is a provider response amount. `estimated_cost` is a
    price-table estimate. Missing amounts remain unknown rather than zero.
    Only events explicitly tagged BYOK are counted; managed events use receipts.
    """
    totals = {name: 0.0 for name in (
        "provider_response_usd", "price_estimate_usd",
        "current_provider_response_usd", "current_price_estimate_usd",
    )}
    unknown = 0
    unattributed = 0
    mixed_attempt = 0
    unknown_attempt = 0
    uncertain_sources = set()
    stages = {}
    unknown_stages = set()
    unattributed_stages = set()
    for event in events or []:
        if not isinstance(event, Mapping):
            continue
        # Older cached local STT events inherited the BYOK default. They have
        # no provider bill; retain their audio duration in usage, not API cost.
        if event.get("phase") == "stt" and event.get("source") == "local":
            continue
        if event.get("billing_mode") == "chatgpt":
            continue
        if event.get("billing_mode") not in {"byok", "managed"}:
            unattributed += 1
            phase = event.get("phase") or "unknown"
            unattributed_stages.add("image_analysis" if phase == "image" else phase if phase in _PHASES else "unknown")
            continue
        if event["billing_mode"] != "byok":
            continue
        amount = event.get("actual_cost_usd")
        source = "provider_response_usd" if amount is not None else "price_estimate_usd"
        if amount is None:
            amount = event.get("price_estimate_usd", event.get("estimated_cost"))
        if amount is None:
            from usage_metering import calculate_usage_cost
            amount = calculate_usage_cost(
                event.get("pricing_model") or event.get("model"),
                int(event.get("input_tokens") or 0), int(event.get("output_tokens") or 0),
                event.get("input_type", "text"),
                audio_seconds=float(event.get("audio_seconds") or 0),
                cached_input_tokens=int(event.get("cached_input_tokens") or 0),
                cache_write_tokens=int(event.get("cache_write_tokens") or 0),
            )
        if amount is None:
            unknown += 1
            phase = event.get("phase") or "unknown"
            unknown_stages.add("image_analysis" if phase == "image" else phase if phase in _PHASES else "unknown")
            continue
        amount = float(amount)
        totals[source] += amount
        phase = event.get("phase") or "unknown"
        phase = "image_analysis" if phase == "image" else phase if phase in _PHASES else "unknown"
        stage = stages.setdefault(phase, {})
        stage[source] = stage.get(source, 0.0) + amount
        attempt = event.get("attempt")
        if attempt == "mixed":
            mixed_attempt += 1
            uncertain_sources.add(source)
        elif attempt not in {"current", "prior"}:
            unknown_attempt += 1
            uncertain_sources.add(source)
        elif attempt == "current":
            totals["current_" + source] += amount
    for source in uncertain_sources:
        totals["current_" + source] = None
    return {**totals, "stage_costs_usd": stages, "unknown_stages": sorted(unknown_stages),
            "unattributed_stages": sorted(unattributed_stages),
            "unknown_count": unknown, "unattributed_count": unattributed,
            "mixed_attempt_count": mixed_attempt, "unknown_attempt_count": unknown_attempt}


def merge_settlements(previous, sessions):
    receipts = {}
    for value in [*(previous or []), *(sessions or [])]:
        if not isinstance(value, Mapping):
            continue
        receipt = value.get("settlement")
        if not isinstance(receipt, Mapping):
            receipt = value
        session_id = str(value.get("session_id") or receipt.get("session_id") or "")
        if not session_id:
            continue
        status = str(receipt.get("status") or "closing")
        cost = receipt.get("actual_cost_microusd")
        if status == "completed" and (type(cost) is not int or cost < 0):
            status = "failed"  # A terminal response without a confirmed amount cannot be priced.
        existing = receipts.get(session_id, {})
        if existing.get("status") in {"completed", "failed"}:
            continue
        phase = value.get("phase") or receipt.get("phase") or existing.get("phase")
        attempt = value.get("attempt") or receipt.get("attempt") or existing.get("attempt")
        entry = {
            "session_id": session_id,
            "status": status if status in {"completed", "failed"} else "closing",
            "actual_cost_microusd": max(0, int(cost)) if status == "completed" else None,
            "observed_usage_microusd": max(0, int(receipt.get("observed_usage_microusd") or 0)),
            "phase": phase if phase in _PHASES else "unknown",
            "attempt": attempt if attempt in {"current", "prior"} else "unknown",
        }
        lookup_failures = value.get("lookup_failures", existing.get("lookup_failures", 0))
        if type(lookup_failures) is int and lookup_failures > 0 and entry["status"] == "closing":
            entry["lookup_failures"] = lookup_failures
        receipts[session_id] = entry
    return list(receipts.values())


def _settlement_store_path(base_dir, title, content="", report_path=""):
    store_dir = os.path.join(os.path.dirname(build_retry_registry_path(base_dir)), "report_settlements")
    source = _SOURCE_URL.search(str(content or ""))
    identity = (f"url:{source[1].strip()}\ntitle:{title}" if source else
                f"path:{os.path.normcase(os.path.abspath(report_path))}" if report_path else f"title:{title}")
    key = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return os.path.join(store_dir, f"{key}.json")


def _save_settlements(base_dir, title, records, *, content="", report_path=""):
    path = _settlement_store_path(base_dir, title, content, report_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=os.path.dirname(path),
                                         delete=False) as handle:
            temporary = handle.name
            json.dump(records, handle, ensure_ascii=True)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary and os.path.exists(temporary):
            os.remove(temporary)


def read_settlements(content, *, base_dir="", title="", report_path=""):
    match = _DATA.search(str(content or ""))
    try:
        if match:
            payload = json.loads(match[1])
        elif title:
            with open(_settlement_store_path(base_dir, title, content, report_path), encoding="utf-8") as handle:
                payload = json.load(handle)
        else:
            payload = []
        return merge_settlements(payload if isinstance(payload, list) else [], [])
    except (OSError, ValueError, TypeError):
        return []


def previous_report_settlements(base_dir, title, report_path, source_url=""):
    """Retain paid history when an existing report is explicitly regenerated."""
    try:
        with open(report_path, encoding="utf-8") as handle:
            content = handle.read()
    except (OSError, UnicodeError):
        return []
    source = _SOURCE_URL.search(content)
    if source_url and (not source or source[1].strip() != source_url.strip()):
        return []
    return prior_settlements(read_settlements(
        content, base_dir=base_dir, title=title, report_path=report_path
    ))


def apply_settlements(result, records):
    records = merge_settlements(records, [])
    if not records:
        return
    pending = sum(record["status"] == "closing" for record in records)
    stage_costs = {}
    current_stage_costs = {}
    unknown_attempt_count = 0
    unknown_attempt_phases = set()
    for record in records:
        if record["status"] != "completed":
            continue
        phase = record["phase"]
        stage_costs[phase] = stage_costs.get(phase, 0) + record["actual_cost_microusd"]
        if record["attempt"] == "current":
            current_stage_costs[phase] = current_stage_costs.get(phase, 0) + record["actual_cost_microusd"]
        elif record["attempt"] == "unknown":
            unknown_attempt_count += 1
            unknown_attempt_phases.add(phase)
    for phase in unknown_attempt_phases:
        current_stage_costs[phase] = None
    actual_microusd = sum(stage_costs.values())
    current_microusd = None if unknown_attempt_count else sum(current_stage_costs.values())
    result["usage_summary"] = {
        **(result.get("usage_summary") or {}),
        "managed_settlement": {
            "actual_cost_usd": actual_microusd / 1_000_000, "actual_cost_microusd": actual_microusd,
            "current_cost_microusd": current_microusd,
            "stage_costs_microusd": stage_costs,
            "current_stage_costs_microusd": current_stage_costs,
            "pending_count": pending, "unknown_attempt_count": unknown_attempt_count,
            "sessions": records,
        },
    }
    from usage_metering import refresh_report_cost_markdown
    result["content"] = refresh_report_cost_markdown(str(result.get("content") or ""), result["usage_summary"])
    result["content"] = _BLOCK.sub("", str(result.get("content") or ""))


def _preserve_other_costs(previous_content, refreshed_content):
    """On restart only receipts are rehydrated; keep the saved BYOK display."""
    previous = _COST_BLOCK.search(previous_content)
    refreshed = _COST_BLOCK.search(refreshed_content)
    if not previous or not refreshed:
        return refreshed_content
    old_lines = previous.group().splitlines()
    new_lines = refreshed.group().splitlines()
    managed_lines = [line for line in new_lines
                     if line.startswith("**관리형") or line.startswith("**정산 상태")]
    def stage_bounds(lines):
        try:
            detail = next(i for i, line in enumerate(lines)
                          if line == "> <!-- AILS_REPORT_COST_DETAIL_START -->")
            header = next(i for i, line in enumerate(lines[:detail])
                          if line.startswith("> | 단계 |"))
            total = next(i for i, line in enumerate(lines[header + 1:detail], header + 1)
                         if line.startswith("> | 누적 합계"))
            return header, total
        except StopIteration:
            return None

    old_bounds = stage_bounds(old_lines)
    new_bounds = stage_bounds(new_lines)
    if not old_bounds or not new_bounds:
        return previous_content
    old_header, old_total = old_bounds
    new_header, new_total = new_bounds
    new_stage_rows = {line.split("|")[1].strip(): line for line in new_lines[new_header + 2:new_total]
                      if line.startswith("> | ") and len(line.split("|")) >= 5}
    old_stage_labels = {line.split("|")[1].strip() for line in old_lines[old_header + 2:old_total]
                        if line.startswith("> | ") and len(line.split("|")) >= 5}
    merged_lines = []
    inserted = False
    for index, line in enumerate(old_lines):
        if index < old_header and (line.startswith("**관리형") or line.startswith("**정산 상태")):
            if not inserted:
                merged_lines.extend(managed_lines)
                inserted = True
            continue
        if (index < old_header and line.startswith("**상태:** 유료 AI 사용 내역 없음")
                and line not in new_lines[:new_header]):
            continue
        if index == old_total:
            for label, row in new_stage_rows.items():
                if label not in old_stage_labels:
                    merged_lines.append(row)
            fresh = new_lines[new_total]
        elif old_header + 2 <= index < old_total:
            fresh = new_stage_rows.get(line.split("|")[1].strip()) if line.startswith("> | ") else None
        else:
            fresh = None
        if fresh and len(line.split("|")) >= 5 and len(fresh.split("|")) >= 5:
            cells = line.split("|")
            cells[2] = fresh.split("|")[2]
            line = "|".join(cells)
        merged_lines.append(line)
    return refreshed_content[:refreshed.start()] + "\n".join(merged_lines) + refreshed_content[refreshed.end():]


def persist_settlement_result(result, base_dir):
    if result.get("status") == "failed" and result.get("retry_task"):
        upsert_retry_registry_entry(base_dir, result["title"], {
            **result, "last_logs": result.get("logs") or result.get("last_logs") or [],
        })
    elif result.get("status") in {"success", "needs_review"} and result.get("file_path"):
        path = os.path.abspath(result["file_path"])
        # Preserve edits made to the report since it was loaded into the UI.
        with open(path, encoding="utf-8") as existing:
            result["content"] = existing.read()
        previous_content = result["content"]
        if not _COST_BLOCK.search(previous_content):
            return
        apply_settlements(result, result["usage_summary"]["managed_settlement"]["sessions"])
        result["content"] = _preserve_other_costs(previous_content, result["content"])
        _save_settlements(base_dir, result["title"], result["usage_summary"]["managed_settlement"]["sessions"],
                          content=result["content"], report_path=path)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=os.path.dirname(path), delete=False) as handle:
                temporary = handle.name
                handle.write(result["content"])
            os.replace(temporary, path)
        finally:
            if temporary and os.path.exists(temporary):
                os.remove(temporary)
        if result.get("status") == "needs_review":
            entry = load_retry_registry(base_dir).get(result["title"])
            if isinstance(entry, dict):
                upsert_retry_registry_entry(base_dir, result["title"], {
                    **entry, "usage_summary": result["usage_summary"],
                })
