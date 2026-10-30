"""Bounded, read-only research over the existing material text/OCR sources."""
import os
from pathlib import Path
import re
import time

from documents.material_keyword_search import KeywordPattern
from documents.material_keyword_sources import (
    CODE_EXTENSIONS, MATERIAL_EXTENSIONS, document_text, inside_root, workspace_paths,
)
from pdf.pdf_keyword_source import indexed_pdf_text

MAX_TEXT_BYTES = 8 * 1024 * 1024
MAX_PDF_BYTES = 64 * 1024 * 1024


def safe_path(root, path, *, check_size=True):
    if not str(root or "").strip() or not os.path.isdir(root):
        raise ValueError("An accessible material folder or registered workspace is required.")
    root = os.path.realpath(root)
    path = os.path.abspath(str(path or ""))
    if not inside_root(path, root) or not os.path.isfile(path):
        raise ValueError("File is outside the accessible workspace or does not exist.")
    for candidate in (path, os.path.realpath(path)):
        parts = Path(os.path.relpath(candidate, root)).parts
        if any(not p[0].isalnum() or p.casefold() in {"node_modules", "venv", "__pycache__", "build", "dist"} for p in parts):
            raise ValueError("Hidden, generated and dependency files are not accessible research materials.")
    extension = Path(path).suffix.casefold()
    if extension not in MATERIAL_EXTENSIONS | CODE_EXTENSIONS:
        raise ValueError("Unsupported research document type.")
    if check_size and os.path.getsize(path) > (MAX_PDF_BYTES if extension == ".pdf" else MAX_TEXT_BYTES):
        raise ValueError("Document exceeds the research read limit.")
    return path


def revision(path):
    stat = os.stat(path)
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def pdf_page_text(path, page):
    from documents.answer_key_visibility import hidden, redact_page
    from pdf.pdf_ocr import indexed_pdf_search_pages
    cached = indexed_pdf_search_pages([(path, page)]).get((path, page))
    if cached:
        # Search's compact cache has no word boxes. For an explicitly read
        # shared question/key page, recover boxes instead of hiding the stem.
        from documents.answer_key_visibility import regions_for
        regions = regions_for(path, page)
        if regions and all(region.get("bbox") for region in regions) and not cached.get("words"):
            from pdf.pdf_ocr_search import indexed_pdf_page
            cached = indexed_pdf_page(path, page)
        return redact_page(path, cached)["text"], "ocr_index"
    if hidden(path, page):
        from pdf.pdf_ocr_search import indexed_pdf_page
        return redact_page(path, indexed_pdf_page(path, page))["text"], "redacted_index"
    from pdf.pdf_password import open_pdf_reader
    reader = open_pdf_reader(path)
    if not 1 <= page <= len(reader.pages):
        raise ValueError("PDF page is out of range.")
    return str(reader.pages[page - 1].extract_text() or ""), "native_pdf"


def read_context(root, arguments):
    path = safe_path(root, arguments.get("path"))
    version = revision(path)
    if arguments.get("revision") and arguments["revision"] != version:
        return {"status": "stale", "path": path, "revision": version,
                "reason": "Source changed. Search again before citing the previous location."}
    page = int(arguments.get("page") or 1)
    if page < 1:
        raise ValueError("Page must be positive.")
    if Path(path).suffix.casefold() == ".pdf":
        text, source = pdf_page_text(path, page)
    else:
        if page != 1:
            raise ValueError("Text documents have page 1; use line coordinates.")
        text, source = document_text(path), "document_text"
    if revision(path) != version:
        return {"status": "stale", "path": path, "reason": "Source changed while reading."}
    lines = text.splitlines() or [""]
    line = int(arguments.get("line") or 1)
    anchor = str(arguments.get("anchor") or "").strip()[:240]
    if anchor:
        # Semantic snippets collapse whitespace. Map that normalized anchor back to raw lines.
        match = re.search(r"\s+".join(re.escape(part) for part in anchor.split()), text, re.IGNORECASE)
        if match is None:
            return {"status": "not_found", "path": path, "page": page, "reason": "Anchor not found; inspect the outline or use grep_search."}
        line = text[:match.start()].count("\n") + 1
    if not 1 <= line <= len(lines):
        raise ValueError("Line is out of range.")
    before = max(0, min(int(arguments.get("before", 8)), 50))
    after = max(0, min(int(arguments.get("after", 30)), 100))
    first, last = max(1, line - before), min(len(lines), line + after)
    selected = []
    used = 0
    for candidate in lines[first - 1:last]:
        if used + len(candidate) + 1 > 6000:
            if not selected:
                selected.append(candidate[:6000])
            break
        selected.append(candidate)
        used += len(candidate) + 1
    return {"status": "ready" if text.strip() else "unavailable", "path": path,
            "page": page, "line_start": first, "line_end": first + len(selected) - 1,
            "text": "\n".join(selected), "source": source, "revision": version,
            "truncated": len(selected) < last - first + 1 or len("\n".join(selected)) < len(text),
            **({"reason": "No text layer or current OCR. inspect_pdf_page can examine the original page."} if not text.strip() else {})}


def _search_pages(path):
    if Path(path).suffix.casefold() != ".pdf":
        yield 1, document_text(path), "document_text"
        return
    # Initialize the OCR facade before its mutually dependent search module.
    from pdf import pdf_ocr
    indexed = False
    for _path, page, text in indexed_pdf_text({path: path}):
        indexed = True
        yield page, text, "ocr_index"
    if not indexed:
        from pdf.pdf_password import open_pdf_reader
        reader = open_pdf_reader(path)
        for page, value in enumerate(reader.pages[:500], 1):
            from documents.answer_key_visibility import hidden
            if hidden(path, page):
                continue
            yield page, str(value.extract_text() or ""), "native_pdf"
        if len(reader.pages) > 500:
            raise ValueError("Native PDF search reached its 500-page limit.")


def grep_search(root, arguments):
    query = str(arguments.get("query") or "").strip()
    if not query or len(query) > 256:
        raise ValueError("Search query must contain 1 to 256 characters.")
    limit = max(1, min(int(arguments.get("limit") or 10), 20))
    scope = str(arguments.get("scope") or "content")
    if scope not in {"content", "names"}:
        raise ValueError("Search scope must be content or names.")
    regex_mode = arguments.get("regex") is True
    if regex_mode:
        # regex is already provided by the pinned tiktoken dependency. Its timeout
        # prevents pathological user/model patterns from blocking the API thread.
        try:
            import regex
        except ImportError:
            return {"status": "unavailable", "results": [], "reason": "Regex runtime unavailable; use literal search."}
        try:
            pattern = regex.compile(query, regex.IGNORECASE | regex.MULTILINE)
        except regex.error as error:
            raise ValueError(f"Invalid regular expression: {error}") from None
    else:
        pattern = KeywordPattern(query)
        if not pattern.parts:
            raise ValueError("Search needs at least one literal term.")
    if not str(root or "").strip() or not os.path.isdir(root):
        return {"status": "unavailable", "results": [], "reason": "No accessible workspace is configured."}
    root = os.path.realpath(root)
    paths = [safe_path(root, arguments["path"], check_size=scope != "names")] if arguments.get("path") else workspace_paths(root, include_code=True)
    results, skipped = [], 0
    started = time.monotonic()
    scanned = 0
    partial = False
    for candidate in paths:
        if time.monotonic() - started > 5 or scanned >= 1000:
            partial = True
            break
        try:
            path = safe_path(root, candidate, check_size=scope != "names")
            version = revision(path)
            scanned += 1
            pages = [(None, os.path.relpath(path, root), "name")] if scope == "names" else _search_pages(path)
            for page, text, source in pages:
                if time.monotonic() - started > 5:
                    partial = True
                    break
                # Bound individual regex subject size as well as execution time.
                for line, value in enumerate(text.splitlines(), 1):
                    if line % 100 == 0 and time.monotonic() - started > 5:
                        partial = True
                        break
                    if len(value) > 20000:
                        value = value[:20000]
                        partial = True
                    if regex_mode:
                        match = pattern.search(value, timeout=0.05)
                        span = match.span() if match else None
                    else:
                        value = " ".join(value.split())
                        spans = pattern.find(value)
                        span = spans[0] if spans else None
                    if span:
                        if revision(path) != version:
                            partial = True
                            break
                        results.append({"path": path, "title": Path(path).stem, "page": page,
                                        "line": line if source != "name" else None, "snippet": value[max(0, span[0] - 60):span[1] + 100][:240],
                                        "source": source, "revision": version})
                        if len(results) >= limit:
                            return {"status": "partial" if partial or skipped else "ready", "results": results, "truncated": True, "scanned_files": scanned, "skipped_files": skipped}
        except TimeoutError:
            return {"status": "partial", "results": results, "reason": "Regex time limit reached; simplify the expression."}
        except (OSError, ValueError):
            skipped += 1
    return {"status": "partial" if partial or skipped else "ready", "results": results,
            "scanned_files": scanned, "skipped_files": skipped, "truncated": partial}


def document_outline(root, arguments):
    path = safe_path(root, arguments.get("path"))
    version = revision(path)
    items = []
    if Path(path).suffix.casefold() == ".pdf":
        from pdf.pdf_password import open_pdf_reader
        from pdf.pdf_outline import native_outline_for_reader
        from pdf.pdf_ocr import indexed_pdf_search_pages
        reader = open_pdf_reader(path)
        cached = indexed_pdf_search_pages([(path, 1)]).get((path, 1))
        items = (cached or {}).get("outline") or native_outline_for_reader(reader)
        page_count = len(reader.pages)
    else:
        page_count = 1
        fence = None
        for number, line in enumerate(document_text(path).splitlines(), 1):
            marker = re.match(r"^\s*(`{3,}|~{3,})", line)
            if marker:
                fence = None if fence == marker[1][0] else marker[1][0]
            elif fence is None:
                heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
                if heading:
                    items.append({"title": heading[2], "level": len(heading[1]), "page": 1, "line": number})
    offset = max(0, int(arguments.get("offset") or 0))
    if revision(path) != version:
        return {"status": "stale", "path": path, "reason": "Source changed while reading the outline."}
    return {"status": "ready", "path": path, "page_count": page_count,
            "items": items[offset:offset + 80], "total": len(items),
            "next_offset": offset + 80 if offset + 80 < len(items) else None, "revision": version}
