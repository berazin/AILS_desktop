"""Number/subquestion matching and lossless consolidation of repeated answers."""
import unicodedata

from documents.answer_key_sources import digest


def text_key(value):
    return unicodedata.normalize("NFC", str(value or "")).strip()


def _decimal_key(value):
    if value.is_zero():
        return (0, (0,), 0)
    sign, digits, exponent = value.as_tuple()
    digits = list(digits)
    while digits[-1] == 0:
        digits.pop()
        exponent += 1
    return sign, digits, exponent


def consolidate(candidates):
    from documents.answer_key_grading import choice_index, numeric_value
    from documents.answer_key_layout import matching_keys
    layout = matching_keys(candidates)
    grouped = {}
    for candidate in candidates:
        answer = text_key(candidate["answer"])
        kind = candidate["kind"]
        answer, kind = layout.get(candidate["id"], (answer, kind))
        if kind == "choice":
            index = choice_index(answer)
            answer = str(index) if index is not None else answer
        elif kind == "numeric":
            numeric = numeric_value(answer)
            if numeric:
                answer = (_decimal_key(numeric[0]), numeric[1])
        signature = digest({"number": candidate["number"], "subquestion": text_key(candidate.get("subquestion")),
                            "kind": kind, "answer": answer, "criteria": text_key(candidate.get("criteria")),
                            "unfinished": bool(candidate.get("continues_after_page"))})
        grouped.setdefault(signature, []).append(candidate)
    result = []
    for signature, entries in grouped.items():
        item = dict(next((entry for entry in entries if "\n" not in entry["answer"]), entries[0]))
        if len(entries) > 1:
            item["id"] = digest({"answer_group": signature, "evidence": sorted(entry["id"] for entry in entries)})[:24]
            item["occurrences"] = [{key: entry[key] for key in ("id", "chapter", "original_text", "location", "method", "confidence", "continuation_locations") if key in entry} for entry in entries]
            item["confidence"] = min(entry["confidence"] for entry in entries)
            if any(entry["method"] == "saved_ocr" for entry in entries):
                item["method"] = "saved_ocr"
        result.append(item)
    return result


def options_for(problem, candidates, parts):
    options = [item for item in candidates if item["number"] == problem["number"]]
    subquestion = text_key(problem.get("subquestion"))
    if subquestion:
        return [item for item in options if text_key(item.get("subquestion")) == subquestion]
    if not parts:
        return [item for item in options if not text_key(item.get("subquestion"))]
    return options
