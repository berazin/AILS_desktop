"""Keep searchable material pages valid and navigable inside tool-result budgets."""
from __future__ import annotations

import json
from collections.abc import Mapping

from chat.context_composer import estimate_tokens, truncate_to_tokens


def reduce_material_list(parsed: Mapping, budget_tokens: int) -> dict:
    def tokens(value):
        return estimate_tokens(json.dumps(value, ensure_ascii=False, separators=(",", ":")))

    reduced = {key: parsed[key] for key in ("ok", "status", "error", "total", "library_total", "offset") if key in parsed}
    reduced["query"] = truncate_to_tokens(str(parsed.get("query") or ""), 60)
    reduced["materials"] = []
    offset = max(0, int(parsed.get("offset") or 0))
    entries = [item for item in parsed.get("materials") or [] if isinstance(item, Mapping)]
    reduced.update(has_more=bool(parsed.get("has_more")), next_offset=parsed.get("next_offset"))
    for item in entries:
        entry = {key: str(item.get(key) or "") for key in ("candidate_id", "title", "folder", "kind")}
        reduced["materials"].append(entry)
        if tokens(reduced) + 40 > budget_tokens:
            reduced["materials"].pop()
            break
    if len(reduced["materials"]) < len(entries):
        reduced.update(truncated=True, has_more=True, next_offset=offset + len(reduced["materials"]))
    workspaces = [item for item in parsed.get("code_workspaces") or [] if isinstance(item, Mapping)]
    if workspaces:
        reduced["code_workspaces"] = []
        for item in workspaces:
            reduced["code_workspaces"].append(dict(item))
            if tokens(reduced) + 24 > budget_tokens:
                reduced["code_workspaces"].pop()
                reduced["workspaces_truncated"] = True
                break
    if parsed.get("workspace_error"):
        reduced["workspace_error"] = truncate_to_tokens(str(parsed["workspace_error"]), 30)
    if tokens(reduced) > budget_tokens:
        return {"truncated": True}
    return reduced
