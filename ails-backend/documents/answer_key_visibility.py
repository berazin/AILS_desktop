"""Learning-mode redaction shared by PDF and workspace search consumers.

Keep word-based reads outside selected regions; coarse page indexes exclude
pages containing protected regions.
Keep the exclusion after source changes: a new version must not expose old answers.
Original files and explicit answer-key management previews remain available.
"""
import os
import tempfile
from documents.answer_key_sources import digest, normalized_path, read_only_json


def registry_path():
    root = os.environ.get("AILS_RUNTIME_DATA_DIR") or os.path.join(os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or tempfile.gettempdir(), "AILS")
    return os.path.join(root, "answer-key-visibility.json")


def protect_source(owner, source, *, enabled=True):
    from documents import problem_manager as store
    path = registry_path()
    with store._path_lock(path):
        data = store._read_json(path)
        key = digest({"owner": normalized_path(owner), "source": source["path"], "region": source["region"]})
        data[key] = {"owner": normalized_path(owner), "path": normalized_path(source["path"]), "region": source["region"], "enabled": enabled}
        store._atomic_write_json(path, data)


def hidden(path, page=None):
    from documents import problem_manager as store
    entries = read_only_json(registry_path()).values()
    source = normalized_path(path)
    return any(item.get("enabled") and item["path"] == source and (page is None or _page_region(item["region"], page)) for item in entries)


def filter_pages(path, pages):
    return [page for page in pages if not hidden(path, page.get("page", 1))]


def filter_results(rows):
    return [row for row in rows if not hidden(row.get("path") or row.get("file_path") or "", row.get("page", 1))]


def regions_for(path, page):
    from documents import problem_manager as store
    source = normalized_path(path)
    return [region for item in read_only_json(registry_path()).values() if item.get("enabled") and item["path"] == source and (region := _page_region(item["region"], page))]


def _page_region(region, page):
    if not region["page_start"] <= int(page) <= region["page_end"]:
        return None
    if "page_boxes" in region:
        box = region["page_boxes"].get(str(page))
        return {**region, "bbox": box} if box else None
    return region


def redact_page(path, page):
    regions = regions_for(path, page.get("page", 1))
    if not regions:
        return page
    if any(region.get("bbox") is None for region in regions):
        return {**page, "text": "", "words": [], "blocks": [], "answer_key_redacted": True}
    def visible(word):
        return not any(word["right"] > region["bbox"]["left"] and word["left"] < region["bbox"]["right"] and word["bottom"] > region["bbox"]["top"] and word["top"] < region["bbox"]["bottom"] for region in regions)
    words = [word for word in page.get("words", []) if visible(word)]
    from pdf.pdf_ocr_search import _reconstruct_indexed_region_text
    text = _reconstruct_indexed_region_text([(word["text"], word["left"], word["top"], word["right"], word["bottom"]) for word in words])
    # Block text may include an answer even when only one word overlaps the selection.
    return {**page, "text": text, "words": words, "blocks": [block for block in page.get("blocks", []) if visible(block)], "answer_key_redacted": True}


def problem_redaction_context(path, data):
    """Snapshot protected regions and excerpts once for a public catalog read."""
    source_path = normalized_path(path)
    regions = [item["region"] for item in read_only_json(registry_path()).values()
               if item.get("enabled") and item["path"] == source_path]
    if not regions:
        return None
    excerpts = []
    for preview in data.get("previews", {}).values():
        source = preview["source"]
        if source["path"] != source_path:
            continue
        excerpts.extend(item["original_text"] for item in preview.get("candidates", []))
        excerpts.extend(occurrence["original_text"] for item in preview.get("candidates", []) for occurrence in item.get("occurrences", []))
    return {"regions": regions, "excerpts": excerpts}


def redact_problem(path, problem, *, context=None):
    """A catalog stem can accidentally contain inline answers. Use exact source text only."""
    if context is None:
        data = read_only_json(store_path_for_problem(path, problem)) if problem.get("_answer_key_base_dir") else {}
        context = problem_redaction_context(path, data) or {"regions": [], "excerpts": []}
    excerpts = context["excerpts"]
    overlaps = any(_page_region(region, page) for region in context["regions"] for page in
                   range(int(problem.get("page") or 1), int(problem.get("page_end") or problem.get("page") or 1) + 1))
    def redact(value):
        if isinstance(value, str):
            if overlaps:
                from documents.problem_answer_key_boundary import trim_answer_key_tail
                value = trim_answer_key_tail(value)
            for excerpt in excerpts:
                value = value.replace(excerpt, "[숨긴 답지]")
            return value
        if isinstance(value, list):
            return [redact(item) for item in value]
        if isinstance(value, dict):
            return {key: redact(item) for key, item in value.items()}
        return value
    return {**problem, **{key: redact(problem[key]) for key in ("problem_text", "paddleocr_original", "problem_edit", "choices", "code") if key in problem}}


def store_path_for_problem(path, problem):
    from documents.answer_key_store import store_path
    return store_path(path, problem["_answer_key_base_dir"])
