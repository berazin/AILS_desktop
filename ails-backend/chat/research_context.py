"""Keep citations and arithmetic evidence valid under existing tool token budgets."""
import json
from collections.abc import Mapping
from chat.context_composer import estimate_tokens, truncate_to_tokens


def reduce_research_result(parsed, budget):
    if isinstance(parsed.get("result"), str):
        try:
            nested = json.loads(parsed["result"])
            if isinstance(nested, Mapping): parsed = nested
        except ValueError: pass
    if not isinstance(parsed, Mapping): return {"truncated": True}
    reduced = {}

    def fits(candidate):
        return estimate_tokens(json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))) <= max(0, budget - 12)

    # Locations, success/limits and exact computation precede verbose source text.
    for key in ("status", "ok", "path", "page", "line_start", "line_end", "result", "fraction", "approximate", "image_attached", "revision", "reason", "error", "next_offset"):
        if key in parsed:
            if fits({**reduced, key: parsed[key]}): reduced[key] = parsed[key]
            else: reduced["truncated"] = True
    for key in ("results", "items"):
        if key in parsed:
            reduced[key] = []
            for item in parsed[key]:
                if fits({**reduced, key: [*reduced[key], item]}): reduced[key].append(item)
                else:
                    reduced["truncated"] = True
                    break
    if parsed.get("text"):
        reserve = estimate_tokens(json.dumps(reduced, ensure_ascii=False)) + 25
        clipped = truncate_to_tokens(str(parsed["text"]), max(0, budget - reserve))
        if clipped: reduced["text"] = clipped
        if clipped != parsed["text"]: reduced["truncated"] = True
    if parsed.get("truncated"): reduced["truncated"] = True
    # Small budgets still get valid JSON, never a truncated JSON string.
    while not fits(reduced) and reduced:
        reduced.pop(next(reversed(reduced)))
    return reduced or {"truncated": True}
