"""Compare native table line wrapping against an explicit unwrapped answer."""
import re


def _safe_text(candidate):
    text = candidate["answer"]
    # Whitespace inside literals or a formatted program can carry meaning.
    if candidate["method"] != "native_pdf_grid" or candidate["kind"] not in {"short", "essay"} or any(c in text for c in "\"'`{}"):
        return None
    return re.sub(r"[^\S\n]+", " ", text).strip()


def matching_keys(candidates):
    references = {}
    for item in candidates:
        text = _safe_text(item)
        if text is not None and "\n" not in text:
            group = (item["number"], item.get("subquestion", ""), item.get("criteria", "").strip(), bool(item.get("continues_after_page")))
            references.setdefault(group, set()).add((text, item["kind"]))
    result = {}
    for item in candidates:
        text = _safe_text(item)
        if text is None:
            continue
        key = (text, item["kind"])
        if "\n" in text:
            group = (item["number"], item.get("subquestion", ""), item.get("criteria", "").strip(), bool(item.get("continues_after_page")))
            # Each PDF layout break may split a word or fall between words.
            # Only an exact, unique, unwrapped source establishes which it is.
            pattern = " ?".join(re.escape(line.strip()) for line in text.splitlines())
            matches = [reference for reference in references.get(group, ()) if re.fullmatch(pattern, reference[0])]
            if len(matches) == 1:
                key = matches[0]
        result[item["id"]] = key
    return result
