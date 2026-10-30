from __future__ import annotations

import re
from difflib import SequenceMatcher


IMAGE_LINK_DISPLAY_SIZE = "900x600"

def normalize_image_link_alt_text(alt_text="slide", size=IMAGE_LINK_DISPLAY_SIZE):
    alt = str(alt_text or "slide").strip() or "slide"
    alt = re.sub(r"\|\s*\d+\s*x\s*\d+\s*$", "", alt, flags=re.IGNORECASE).strip() or "slide"
    return f"{alt}|{size}"

def format_markdown_image_link(image_path, alt_text="slide"):
    normalized_path = str(image_path or "").replace("\\", "/").strip()
    normalized_path = normalized_path.replace("<", "%3C").replace(">", "%3E")
    return f"![{normalize_image_link_alt_text(alt_text)}](<{normalized_path}>)"

def normalize_markdown_image_link_sizes(text, size=IMAGE_LINK_DISPLAY_SIZE):
    current = str(text or "")
    if not current:
        return current

    image_link_pattern = re.compile(r"!\[([^\]]*)\]\((\s*(?:<[^>\n]*>|[^)\n]*)\s*)\)")

    def replace_image_alt(match):
        return f"![{normalize_image_link_alt_text(match.group(1), size)}]({match.group(2)})"

    normalized_lines = []
    in_code_block = False
    for line in current.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            in_code_block = not in_code_block
            normalized_lines.append(line)
            continue
        if in_code_block:
            normalized_lines.append(line)
            continue
        normalized_lines.append(image_link_pattern.sub(replace_image_alt, line))
    return "".join(normalized_lines)


def extract_outline(md_text):
    if not md_text:
        return "작성 전"
    headers = []
    seen = set()
    for line in md_text.split('\n'):
        stripped = line.strip()
        if not re.match(r"^#{2,4}\s+", stripped):
            continue
        if "Mastery Challenge" in stripped:
            continue
        if stripped in seen:
            continue
        seen.add(stripped)
        headers.append(stripped)
    return "\n".join(headers[-20:]) if headers else "목차 없음"

def normalize_heading_key(text):
    normalized = str(text or "").strip()
    normalized = re.sub(r'^#+\s*', '', normalized)
    normalized = normalized.replace("(계속)", "")
    normalized = re.sub(r'^\[실습 추적\]\s*', '', normalized, flags=re.IGNORECASE)
    normalized = re.sub(r'\bstep\s*\d+\b', '', normalized, flags=re.IGNORECASE)
    normalized = re.sub(r'^\d+\.\s*', '', normalized)
    normalized = re.sub(r'\s+', ' ', normalized)
    return normalized.strip().lower()

def extract_used_heading_keys(md_text):
    keys = []
    seen = set()
    for line in str(md_text or "").splitlines():
        stripped = line.strip()
        if not re.match(r"^#{2,4}\s+", stripped):
            continue
        if "Mastery Challenge" in stripped:
            continue
        key = normalize_heading_key(stripped)
        if not key or key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys

def extract_used_section_titles(md_text, max_items=24):
    titles = []
    seen = set()
    for line in str(md_text or "").splitlines():
        stripped = line.strip()
        if not (stripped.startswith("## ") or stripped.startswith("### ")):
            continue
        if "Mastery Challenge" in stripped:
            continue
        title = re.sub(r'^#+\s*', '', stripped).strip()
        key = normalize_heading_key(title)
        if not key or key in seen:
            continue
        seen.add(key)
        titles.append(f"- {title}")
    return "\n".join(titles[-max_items:]) if titles else "없음"

def has_more_marker(text):
    return "[MORE]" in str(text or "")

def strip_more_markers(text):
    return str(text or "").replace("[MORE]", "").strip()

def strip_prompt_control_artifacts(text):
    cleaned_lines = []
    for raw_line in str(text or "").replace("\r\n", "\n").split("\n"):
        stripped = raw_line.strip()
        if re.search(r"\bSOURCE\s+BLOCK\b|\bSOURCE\s+ID\b|LAST_SOURCE_ID", stripped, flags=re.I):
            continue
        if stripped in {"[기존 정리본]", "[삭제될 후보 전체]", "[현재 청크 원문 전체]", "[출력]", "[판정 기준]"}:
            continue
        cleaned_lines.append(raw_line)
    cleaned = "\n".join(cleaned_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

def has_fun_fact_section(text):
    return bool(re.search(r"(^|\n)###\s*흥미 포인트\b", str(text or "")))

def has_mastery_or_quiz_section(text):
    normalized = str(text or "")
    if re.search(r"(^|\n)###\s*Mastery Challenge\b", normalized):
        return True
    if len(re.findall(r"(^|\n)###\s*문제\s*\d+\b", normalized)) >= 2:
        return True
    if len(re.findall(r"(^|\n)\s*문제\s*\d+\b", normalized)) >= 3:
        return True
    return False

def strip_summary_restart_artifacts(text, used_heading_keys=None):
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    cleaned_lines = list(lines)
    while cleaned_lines:
        line = cleaned_lines[0].strip()
        if not line:
            cleaned_lines.pop(0)
            continue
        if re.match(r'^#\s*.*요약(?:\s*\(계속\))?\s*$', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^>\s*🤖', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^>\s*\*\*AI 사용량', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^>\s*\*\*단계별', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^>\s*\*\*모델별', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^>\s*\*\*기준', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^>\s*\*\*환율', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^-{3,}$', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^#\s+', line):
            cleaned_lines.pop(0)
            continue
        if re.match(r'^#{2,3}\s+', line):
            heading_key = normalize_heading_key(line)
            if "(계속)" in line or (used_heading_keys and heading_key in used_heading_keys):
                cleaned_lines.pop(0)
                continue
        break
    cleaned = "\n".join(cleaned_lines).strip()
    cleaned = re.sub(r'^#\s*📚.*?요약(?:\s*\(계속\))?\s*\n+', '', cleaned, flags=re.M)
    cleaned = strip_prompt_control_artifacts(cleaned)
    return cleaned.strip()

def build_context_bookmark(text, limit=50):
    cleaned = strip_summary_restart_artifacts(text)
    cleaned = re.sub(r'!\[.*?\]\(.*?\)', '', cleaned)
    cleaned = re.sub(r'^\s*>.*$', '', cleaned, flags=re.M)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned[-limit:] if cleaned else "시작"





def strip_secondary_sections_for_llm(content):
    text = str(content or "")
    text = re.sub(r"(?ms)^##\s*(?:Mastery Challenge|마스터리 챌린지).*?(?=^##|\Z)", "", text)
    text = re.sub(r"(?ms)^##\s*(?:재미있는 상식|알아두면 좋은 상식|Fun Fact).*?(?=^##|\Z)", "", text)
    return text.strip()


def split_markdown_sections(content):
    text = strip_secondary_sections_for_llm(content)
    if not text:
        return []

    sections = []
    current_title = "문서 서두"
    current_lines = []
    for line in text.splitlines():
        if re.match(r"^#{2,4}\s+", line.strip()):
            if current_lines:
                sections.append({"title": current_title, "body": "\n".join(current_lines).strip()})
            current_title = line.strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_lines:
        sections.append({"title": current_title, "body": "\n".join(current_lines).strip()})
    return [section for section in sections if section["body"] or section["title"] != "문서 서두"]


def normalize_markdown_separators(text):
    current = str(text or "").replace("\r\n", "\n")
    current = re.sub(r"(?m)^\s*---\s*$\n?", "\n", current)
    current = re.sub(r"\n{3,}", "\n\n", current)
    return current.strip() + ("\n" if current.strip() else "")




def trim_chunk_boundary_overlap(previous_text, current_text, min_overlap=60, max_overlap=800):
    prev = str(previous_text or "").strip()
    curr = str(current_text or "").strip()
    if not prev or not curr:
        return curr

    prev_compact = re.sub(r'\s+', ' ', prev)
    curr_compact = re.sub(r'\s+', ' ', curr)
    max_size = min(len(prev_compact), len(curr_compact), max_overlap)

    overlap_compact = ""
    for size in range(max_size, min_overlap - 1, -1):
        if prev_compact[-size:] == curr_compact[:size]:
            overlap_compact = curr_compact[:size]
            break

    if overlap_compact:
        compact_index = curr_compact.find(overlap_compact)
        if compact_index == 0:
            raw_index = 0
            compact_seen = []
            for idx, ch in enumerate(curr):
                if ch.isspace():
                    if compact_seen and compact_seen[-1] != " ":
                        compact_seen.append(" ")
                else:
                    compact_seen.append(ch)
                built = "".join(compact_seen).lstrip()
                if len(built) >= len(overlap_compact):
                    raw_index = idx + 1
                    break
            curr = curr[raw_index:].lstrip()
    return curr.strip()



def normalize_markdown_tables(text):
    if not text:
        return text

    lines = str(text).splitlines()
    callout_pattern = re.compile(r"^\s*>\s*(\[\![^\]]+\].*)$")
    normalized_lines = []
    for line in lines:
        callout_match = callout_pattern.match(line)
        if callout_match:
            normalized_lines.append(f">{callout_match.group(1).strip()}")
        else:
            normalized_lines.append(line)
    lines = normalized_lines
    normalized = []
    i = 0

    def get_table_context(line):
        callout_match = re.match(r"^(\s*>\s?)(.*)$", line)
        if callout_match:
            prefix = callout_match.group(1)
            content = callout_match.group(2).strip()
            if content.startswith("|") and content.endswith("|"):
                indent_match = re.match(r"^(\s*)>", prefix)
                blank_line = f"{indent_match.group(1)}>" if indent_match else ">"
                return {"prefix": prefix, "content": content, "blank": blank_line}
            return None

        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            return {"prefix": "", "content": stripped, "blank": ""}
        return None

    def is_table_line(line, prefix):
        context = get_table_context(line)
        return bool(context and context["prefix"] == prefix)

    def is_separator_line(line, prefix):
        context = get_table_context(line)
        if not context or context["prefix"] != prefix:
            return False
        return bool(re.match(r"^\|(?:\s*:?-+:?\s*\|)+\s*$", context["content"]))

    def is_blank_line(line, blank_marker):
        stripped = line.strip()
        return not stripped or stripped == blank_marker.strip()

    while i < len(lines):
        context = get_table_context(lines[i])
        if context and i + 1 < len(lines) and is_separator_line(lines[i + 1], context["prefix"]):
            blank_line = context["blank"]
            if normalized and not is_blank_line(normalized[-1], blank_line):
                normalized.append(blank_line)
            while i < len(lines) and is_table_line(lines[i], context["prefix"]):
                normalized.append(lines[i])
                i += 1
            if i < len(lines) and not is_blank_line(lines[i], blank_line):
                normalized.append(blank_line)
            continue

        normalized.append(lines[i])
        i += 1

    return "\n".join(normalized)

def normalize_latex_math_syntax(text):
    if not text:
        return text

    current = str(text).replace("\r\n", "\n").replace("\r", "\n")

    def protect_inline_code(segment):
        placeholders = {}

        def replace_inline_code(match):
            key = f"@@AILS_INLINE_CODE_{len(placeholders)}@@"
            placeholders[key] = match.group(0)
            return key

        protected = re.sub(r"`+[^`\n]*`+", replace_inline_code, segment)
        return protected, placeholders

    def restore_inline_code(segment, placeholders):
        for key, value in placeholders.items():
            segment = segment.replace(key, value)
        return segment

    def normalize_display_match(match):
        body = str(match.group(1) or "").strip()
        if not body:
            return ""
        if "\n" in body:
            return f"\n$$\n{body}\n$$\n"
        return f"$$\n{body}\n$$"

    def normalize_existing_display_blocks(segment):
        lines = segment.split("\n")
        output = []
        index = 0

        while index < len(lines):
            line = lines[index]
            trimmed = line.strip()
            if not trimmed.startswith("$$"):
                output.append(line)
                index += 1
                continue

            body_lines = []
            suffix_lines = []
            first_body = trimmed[2:].strip()
            cursor = index
            if first_body:
                if "$$" in first_body:
                    body, suffix = first_body.split("$$", 1)
                    if body.strip():
                        body_lines.append(body.strip())
                    if suffix.strip():
                        suffix_lines.append(suffix.strip())
                else:
                    body_lines.append(first_body)
                    cursor = index + 1
                    while cursor < len(lines):
                        next_line = lines[cursor]
                        next_trimmed = next_line.strip()
                        if "$$" in next_trimmed:
                            body, suffix = next_trimmed.split("$$", 1)
                            if body.strip():
                                body_lines.append(body.strip())
                            if suffix.strip():
                                suffix_lines.append(suffix.strip())
                            break
                        body_lines.append(next_line.rstrip())
                        cursor += 1
            else:
                cursor = index + 1
                while cursor < len(lines):
                    next_line = lines[cursor]
                    next_trimmed = next_line.strip()
                    if "$$" in next_trimmed:
                        body, suffix = next_trimmed.split("$$", 1)
                        if body.strip():
                            body_lines.append(body.strip())
                        if suffix.strip():
                            suffix_lines.append(suffix.strip())
                        break
                    body_lines.append(next_line.rstrip())
                    cursor += 1

            while output and not output[-1].strip():
                output.pop()
            if output:
                output[-1] = output[-1].rstrip()
            if output:
                output.append("")
            output.append("$$")
            output.extend(body_lines)
            output.append("$$")
            output.extend(suffix_lines)
            if cursor < len(lines) - 1:
                output.append("")
            index = max(cursor + 1, index + 1)

        return "\n".join(output)

    def normalize_text_segment(segment):
        protected, placeholders = protect_inline_code(segment)
        protected = re.sub(
            r"\\\[\s*(.*?)\s*\\\]",
            normalize_display_match,
            protected,
            flags=re.S,
        )
        protected = re.sub(
            r"\\\[\s*(.*?)\s*\\\)",
            normalize_display_match,
            protected,
            flags=re.S,
        )
        protected = re.sub(
            r"\\\(\s*(.*?)\s*\\\)",
            lambda match: f"${str(match.group(1) or '').strip()}$",
            protected,
            flags=re.S,
        )
        protected = re.sub(
            r"\\\(\s*(.*?)\s*\\\]",
            lambda match: f"${str(match.group(1) or '').strip()}$",
            protected,
            flags=re.S,
        )
        protected = re.sub(
            r"\$\(([^$\n]*(?:\\[A-Za-z]+|=|\\frac|\\sigma)[^$\n]*?)\]\$",
            lambda match: f"${str(match.group(1) or '').strip()}$",
            protected,
        )
        protected = normalize_existing_display_blocks(protected)
        return restore_inline_code(protected, placeholders)

    blocks = []
    buffer = []
    in_fence = False
    fence_marker = ""
    for line in current.splitlines():
        stripped = line.lstrip()
        fence_match = re.match(r"^(```+|~~~+)", stripped)
        if fence_match:
            if buffer:
                blocks.append(("code" if in_fence else "text", "\n".join(buffer)))
                buffer = []
            marker = fence_match.group(1)
            if in_fence and marker.startswith(fence_marker[0]):
                buffer.append(line)
                blocks.append(("code", "\n".join(buffer)))
                buffer = []
                in_fence = False
                fence_marker = ""
            else:
                in_fence = True
                fence_marker = marker
                buffer.append(line)
            continue
        buffer.append(line)
    if buffer:
        blocks.append(("code" if in_fence else "text", "\n".join(buffer)))

    normalized_blocks = [
        block if kind == "code" else normalize_text_segment(block)
        for kind, block in blocks
    ]
    normalized = "\n".join(normalized_blocks)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized

