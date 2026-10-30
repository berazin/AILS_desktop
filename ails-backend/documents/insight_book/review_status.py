"""Derive review queues without changing originals or verification/history records."""


def review_statuses(raws, runs):
    by_run = {run["id"]: run for run in runs}
    by_raw = {raw["id"]: raw for raw in raws}
    statuses = {}
    for raw in raws:
        run = by_run.get(raw["run_id"], {})
        complete = (run.get("state") == "done"
                    and (run.get("gate", {}).get("verdict") == "VERIFIED" or run.get("accepted_correction"))
                    and run.get("outcome") in {"committed", "already_covered"})
        statuses[raw["id"]] = "completed" if complete else "pending"
    for raw in raws:
        if statuses[raw["id"]] != "completed":
            continue
        parent = raw.get("parent_id")
        seen = {raw["id"]}
        while parent in by_raw and parent not in seen:
            seen.add(parent)
            if statuses[parent] == "pending":
                statuses[parent] = "revised"
            parent = by_raw[parent].get("parent_id")
    return statuses
