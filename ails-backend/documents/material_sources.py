"""Render document-local Markdown links without depending on the HTTP API."""

from __future__ import annotations

import os
import re
from urllib.parse import quote, unquote
from system_storage import IMAGE_DIR_NAMES, resolve_system_path, visible_data_folder

MARKDOWN_IMAGE_RE = re.compile(
    r'''(!\[[^\]\n]*\]\(\s*)(<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+?)(\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\))'''
)

HTML_IMAGE_RE = re.compile(r'''(<img\b[^>]*?\bsrc=["'])([^"']+)(["'])''', re.IGNORECASE)

OBSIDIAN_IMAGE_RE = re.compile(r"!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]")

MARKDOWN_LINK_RE = re.compile(r"(?<!!)(\[[^\]]+\]\()([^)]+\.md(?:#[^)]+|\?[^)]*)?)(\))", re.IGNORECASE)

def rewrite_report_image_sources(
    content: str,
    report_path: str,
    *,
    fallback_base_dir: str = "",
    fallback_title: str = "",
) -> str:
    if not content or not report_path:
        return content

    report_dir = os.path.dirname(os.path.abspath(report_path))
    fallback_base_dir = fallback_base_dir or report_dir
    fallback_title = fallback_title or title_from_report_path(report_path)

    def fallback_image_path(src: str) -> str:
        base_dir = os.path.abspath(fallback_base_dir) if fallback_base_dir else ""
        if not base_dir or not os.path.isdir(base_dir):
            return ""
        normalized_src = src.replace("\\", "/").lstrip("./")
        suffix = next((normalized_src.split(name + "/", 1)[1] for name in IMAGE_DIR_NAMES if name + "/" in normalized_src), "")
        basename = os.path.basename(normalized_src)
        fallback_folder = f"{fallback_title}_images" if fallback_title else ""
        for root, dirs, _files in os.walk(base_dir):
            dirs[:] = [name for name in dirs if visible_data_folder(os.path.join(root, name))]
            if suffix:
                candidate = resolve_system_path(os.path.join(root, ".images", *suffix.split("/")))
                if os.path.isfile(candidate):
                    return candidate
            if fallback_folder and basename:
                candidate = resolve_system_path(os.path.join(root, ".images", fallback_folder, basename))
                if os.path.isfile(candidate):
                    return candidate
        return ""

    def replace(match: re.Match) -> str:
        raw_src = match.group(2).strip()
        if not raw_src:
            return match.group(0)

        legacy_local_url = re.match(
            r"^https?://(?:127\.0\.0\.1|localhost)(?::\d+)?(?P<path>/api/files(?:\?.*)?)$",
            raw_src,
            re.IGNORECASE,
        )
        if legacy_local_url:
            return f"{match.group(1)}{legacy_local_url.group('path')}{match.group(3)}"
        if raw_src.startswith(("http://", "https://", "data:", "/api/files")):
            return match.group(0)

        src = unquote(raw_src[1:-1] if raw_src.startswith("<") and raw_src.endswith(">") else raw_src)
        image_path = resolve_system_path(src if os.path.isabs(src) else os.path.abspath(os.path.join(report_dir, src)))
        if not os.path.isfile(image_path):
            image_path = fallback_image_path(src)
            if not image_path:
                return match.group(0)

        encoded_path = quote(image_path)
        return f"{match.group(1)}/api/files?path={encoded_path}{match.group(3)}"

    rewritten = HTML_IMAGE_RE.sub(replace, MARKDOWN_IMAGE_RE.sub(replace, content))

    def replace_obsidian(match: re.Match) -> str:
        raw_src = match.group(1).strip()
        if not raw_src or raw_src.startswith(("http://", "https://", "data:", "/api/files")):
            return match.group(0)
        normalized_src = unquote(raw_src).replace("\\", "/")
        image_path = resolve_system_path(normalized_src if os.path.isabs(normalized_src) else os.path.abspath(os.path.join(report_dir, normalized_src)))
        if not os.path.isfile(image_path):
            image_path = fallback_image_path(normalized_src)
        if not image_path or not os.path.isfile(image_path):
            return match.group(0)
        encoded_path = quote(image_path)
        alt = os.path.basename(raw_src) or "image"
        return f"![{alt}](/api/files?path={encoded_path})"

    return OBSIDIAN_IMAGE_RE.sub(replace_obsidian, rewritten)

def rewrite_report_markdown_links(content: str, report_path: str) -> str:
    if not content or not report_path:
        return content

    report_dir = os.path.dirname(os.path.abspath(report_path))

    def replace(match: re.Match) -> str:
        raw_src = match.group(2).strip()
        if not raw_src or raw_src.startswith(("http://", "https://", "data:", "/api/material-file")):
            return match.group(0)
        src_without_fragment = re.split(r"[#?]", raw_src, maxsplit=1)[0]
        src = src_without_fragment[1:-1] if src_without_fragment.startswith("<") and src_without_fragment.endswith(">") else src_without_fragment
        markdown_path = src if os.path.isabs(src) else os.path.abspath(os.path.join(report_dir, src))
        if not os.path.isfile(markdown_path):
            return match.group(0)
        encoded_path = quote(markdown_path)
        return f"{match.group(1)}/api/material-file?path={encoded_path}{match.group(3)}"

    return MARKDOWN_LINK_RE.sub(replace, content)

def rewrite_report_sources(content: str, report_path: str) -> str:
    return rewrite_report_markdown_links(rewrite_report_image_sources(content, report_path), report_path)

def title_from_report_path(report_path: str) -> str:
    file_name = os.path.basename(report_path)
    return os.path.splitext(file_name)[0]
