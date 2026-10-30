"""Recognize explicit adoption of a saved model correction without another gate call."""
from __future__ import annotations

import time


def accepted_correction(store, value, parent_id, db):
    parent = store.require("raw", parent_id, db)
    source = store.require("run", parent["run_id"], db)
    gate = source.get("gate", {})
    suggestion = gate.get("improved_insight", "")
    if (gate.get("verdict") not in {"PARTIALLY_CORRECT", "INCORRECT", "UNCERTAIN"}
            or not isinstance(suggestion, str) or not suggestion.strip() or value != suggestion):
        return None
    return {"source_raw_id": parent_id, "source_run_id": source["id"], "accepted_at": time.time()}
