"""Literal title/body search with '*' gaps, independent of embeddings/reranking."""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path

from documents.material_keyword_sources import (
    document_text, pdf_sources, workspace_paths,
)


def normalized_text(value: str) -> str:
    return " ".join(str(value or "").split())


class KeywordPattern:
    def __init__(self, query: str):
        # Escaping each literal separately avoids FTS operators, regex injection,
        # and backtracking from chains of wildcard expressions.
        literals = [part for part in normalized_text(query).split("*") if part.strip()]
        self.parts = [re.compile(re.escape(part), re.IGNORECASE) for part in literals]
        # A literal word is a necessary condition even when the full pattern
        # spans whitespace or wildcard gaps. Unicode letters with case variants
        # use the full matcher instead of SQLite's ASCII-only LIKE case folding.
        anchors = [word for part in literals for word in part.split()
                   if re.fullmatch(r"[ -~가-힣]+", word)]
        self.anchor = max(anchors, key=len, default="")

    def find(self, text: str) -> list[tuple[int, int]]:
        if not self.parts:
            return []  # '*' alone must not enumerate every workspace document.
        spans = []
        cursor = 0
        for part in self.parts:
            match = part.search(text, cursor)
            if match is None:
                return []
            spans.append(match.span())
            cursor = match.end()
        return spans


def marked_snippet(text: str, spans: list[tuple[int, int]]) -> str:
    # Cap long wildcard gaps while still showing the literal anchors. The UI
    # renders this as text/mark segments, never as HTML.
    windows = []
    for start, end in spans:
        window = (max(0, start - 55), min(len(text), end + 90))
        if windows and window[0] <= windows[-1][1]:
            windows[-1] = (windows[-1][0], max(window[1], windows[-1][1]))
        else:
            windows.append(window)
    pieces = []
    for left, right in windows[:3]:
        cursor = left
        piece = ""
        for start, end in spans:
            if start < left or start >= right:
                continue
            piece += text[cursor:start] + "<mark>" + text[start:min(end, right)] + "</mark>"
            cursor = min(end, right)
        pieces.append(piece + text[cursor:right])
    return ("… " if windows[0][0] else "") + " … ".join(pieces) + (" …" if windows[-1][1] < len(text) else "")


def _result(path: str, page: int, text: str, spans, source: str) -> dict:
    start, end = spans[0][0], spans[-1][1]
    # Give the PDF viewer real matched text rather than a '*' expression. A title
    # match has no body coordinates, so opening it clears the old highlight.
    match_text = text[start:end] if end - start <= 160 else text[spans[0][0]:spans[0][1]]
    return {"path": path, "title": Path(path).stem, "page": page,
            "snippet": marked_snippet(text, spans), "match_source": source,
            "match_text": match_text if source == "body" else ""}


def search_materials(root: str, query: str, limit: int = 40, *, pdf_reader) -> dict:
    value = str(query or "").strip()
    response = {"query": value, "status": "ready", "results": []}
    pattern = KeywordPattern(value)
    if not pattern.parts or not str(root or "").strip() or not os.path.isdir(root):
        return response
    root = os.path.realpath(root)
    paths = list(workspace_paths(root))
    results = {}
    title_matches = set()
    unreadable = False
    for path in paths:
        title = normalized_text(Path(path).stem)
        spans = pattern.find(title)
        if spans:
            title_matches.add(path)
            results[path] = _result(path, 1, title, spans, "title")
        try:
            body = normalized_text(document_text(path))
        except (OSError, ValueError):
            unreadable = True
            continue
        spans = pattern.find(body)
        if spans:
            results[path] = _result(path, 1, body, spans, "body")
    # The first matching page opens at the body occurrence; keep one result per
    # document so a long PDF cannot hide matches in other workspace documents.
    found_pdf = set()
    try:
        for path, page, text in pdf_reader(pdf_sources(paths), literal=pattern.anchor):
            if path in found_pdf:
                continue
            body = normalized_text(text)
            spans = pattern.find(body)
            if spans:
                results[path] = _result(path, page, body, spans, "body")
                found_pdf.add(path)
    except (OSError, sqlite3.Error, ValueError):
        unreadable = True
    ordered = sorted(results, key=lambda path: (path not in title_matches, Path(path).stem.casefold(), path.casefold()))
    response["results"] = [results[path] for path in ordered[:max(1, min(int(limit), 200))]]
    if unreadable:
        response.update(status="partial", reason="일부 문서의 본문을 읽지 못했습니다.")
    return response
