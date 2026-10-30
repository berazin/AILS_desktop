"""Bounded web citation snapshots; never credentials, page text, or PDF locations."""
import hashlib
import json
import re
from urllib.parse import parse_qsl, urlsplit

from openrouter_web_search import ENGINES, safe_url

_SECRET = re.compile(r"(?i)\b(?:bearer\s+\S+|sk-[\w-]{8,}|ails-lease-[\w-]+)")
_SECRET_PARAMETER = re.compile(r"(?i)(token|secret|password|credential|authorization|signature|api.?key|^key$|^code$|^auth$|^x-amz-|^x-goog-)")


def normalize_report(value):
    if not isinstance(value, dict):
        return None
    engine = value.get("engine")
    if not isinstance(engine, str) or len(engine) > 100:
        return None
    engines = list(dict.fromkeys(engine.split(" / ")))
    if not engines or any(item not in ENGINES for item in engines):
        return None
    count = value.get("requests")
    count = count if type(count) is int and 0 <= count <= 10000 else None
    status = value.get("status")
    if status not in {"searched", "not_searched", "unreported"}:
        return None
    if count is not None:
        status = "searched" if count > 0 else "not_searched"
    elif status == "not_searched":
        status = "unreported"
    sources = {}
    for source in value.get("sources", [])[:100] if isinstance(value.get("sources"), list) else []:
        if not isinstance(source, dict):
            continue
        url, title = safe_url(source.get("url")), source.get("title")
        if not url or not isinstance(title, str) or _SECRET.search(url + " " + title):
            continue
        parsed = urlsplit(url)
        if any(_SECRET_PARAMETER.search(key) for key, _ in parse_qsl(parsed.query + "&" + parsed.fragment)):
            continue
        title = re.sub(r"[\x00-\x1f\x7f]", " ", title).strip()[:300]
        sources.setdefault(url, {"url": url, "title": title or url})
        if len(sources) == 25:
            break
    return {"engine": " / ".join(engines), "requests": count, "status": status, "sources": list(sources.values())}


def encode_web_sources(value, answer):
    report = normalize_report(value)
    if report is None:
        return ""
    return json.dumps({"version": 1, "provenance": "openrouter_url_citation",
                       "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(), "report": report},
                      ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def decode_web_sources(value, answer):
    if not isinstance(value, str) or not value or len(value) > 100000:
        return None
    try:
        data = json.loads(value)
    except (TypeError, ValueError):
        return None
    if (not isinstance(data, dict) or data.get("version") != 1
            or data.get("provenance") != "openrouter_url_citation"
            or data.get("answer_sha256") != hashlib.sha256(answer.encode("utf-8")).hexdigest()):
        return None
    return normalize_report(data.get("report"))
