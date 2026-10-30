from __future__ import annotations

from collections import Counter
import re
import statistics
from typing import Protocol, Sequence


class OutlineWord(Protocol):
    text: str
    left: float
    top: float
    right: float
    bottom: float


TOC_DISCOVERY_LIMIT = 20
TOC_CONTINUATION_LIMIT = 32

_TOC_TITLE_PATTERN = re.compile(
    r"(?<![가-힣])(?:목\s*차|차\s*례)(?![가-힣])|"
    r"(?<![A-Za-z])contents?(?![A-Za-z])",
    re.IGNORECASE,
)
_TOC_ENTRY_PATTERN = re.compile(
    r"^(?P<title>.+?)(?:\s*[.…·•_-]{2,}\s*|\s+)(?P<page>\d{1,4})\s*$"
)
_TOC_ATTACHED_PAGE_PATTERN = re.compile(r"^(?P<title>.+?)(?P<page>\d{1,4})\s*$")
_TOC_ENGLISH_CHAPTER_PATTERN = re.compile(
    r"c\s*[hn]\s*a\s*p\s*t\s*e\s*r\s*[이Il|]?\s*(?P<number>(?:[o0dDuUbB]\s*)?[0-9gG]{1,2})(?=\D|$)",
    re.IGNORECASE,
)
_TOC_CHAPTER_PATTERN = re.compile(
    r"(?:c\s*[hn]\s*a\s*p\s*t\s*e\s*r\s*[이Il|]?\s*(?:[o0dDuUbB]\s*)?[0-9gG]{1,2}(?=\D|$)|"
    r"part\s*\d+|제\s*\d+\s*(?:장|편|부)(?![가-힣])|\d+\s*(?:장|챕터)(?![가-힣]))",
    re.IGNORECASE,
)
_TOC_SECTION_PATTERN = re.compile(
    r"^\s*(?:\d{1,3}\s+)?(?P<section>\d{1,2}(?:\s*[.．]\s*\d{1,3}){1,3})(?=\D|$)"
)
_ATTACHED_PAGE_LABEL_PATTERN = re.compile(
    r"^(?:과제|질문|연습문제|프로그래밍|와이어샤크|인터뷰|참고문헌|찾아보기)",
    re.IGNORECASE,
)


def _word_height(word: OutlineWord) -> float:
    return max(0.0, float(word.bottom) - float(word.top))


def _text_lines(words: Sequence[OutlineWord]) -> list[str]:
    # PP-OCR can return a good whole-line box and smaller, overlapping
    # fragments of the same print. Keep the larger reading for TOC parsing.
    visible = [word for word in words if str(word.text or "").strip()]
    def covered_by_larger(word: OutlineWord) -> bool:
        area = max(0.0, float(word.right) - float(word.left)) * _word_height(word)
        if area <= 0:
            return False
        for other in visible:
            if other is word or _word_height(other) < _word_height(word) * 1.35:
                continue
            if float(getattr(other, "confidence", 0.0)) < 0.8:
                continue
            overlap = max(0.0, min(float(word.right), float(other.right)) - max(float(word.left), float(other.left))) * max(
                0.0, min(float(word.bottom), float(other.bottom)) - max(float(word.top), float(other.top))
            )
            if overlap / area >= 0.72:
                return True
        return False

    ordered = sorted(
        (word for word in visible if not covered_by_larger(word)),
        key=lambda word: ((float(word.top) + float(word.bottom)) / 2.0, float(word.left)),
    )
    if not ordered:
        return []
    median_height = max(1e-6, statistics.median(_word_height(word) for word in ordered))
    groups: list[list[OutlineWord]] = []
    for word in ordered:
        center = (float(word.top) + float(word.bottom)) / 2.0
        if not groups:
            groups.append([word])
            continue
        previous_center = statistics.mean(
            (float(item.top) + float(item.bottom)) / 2.0 for item in groups[-1]
        )
        if abs(center - previous_center) > median_height * 0.75:
            groups.append([word])
        else:
            groups[-1].append(word)
    return [
        " ".join(str(word.text).strip() for word in sorted(group, key=lambda word: float(word.left)))
        for group in groups
    ]


def chapter_number(title: str) -> int | None:
    english_match = _TOC_ENGLISH_CHAPTER_PATTERN.search(title)
    if english_match:
        raw_number = re.sub(r"\s+", "", english_match.group("number"))
        raw_number = raw_number.translate(str.maketrans("oOdDuUbBgG", "0000000099"))
        if raw_number.isdigit():
            number = int(raw_number)
            return number if 0 <= number <= 30 else None
    for pattern in (
        r"^\s*제\s*0*(\d{1,2})\s*(?:장|편|부)(?![가-힣])",
        r"^\s*0*(\d{1,2})\s*(?:장|챕터)(?![가-힣])",
        r"^\s*0*(\d{1,2})\s+(?=[가-힣A-Za-z])",
    ):
        match = re.match(pattern, title, re.IGNORECASE)
        if match:
            number = int(match.group(1))
            return number if 0 <= number <= 30 else None
    return None


def chapter_title(line: str) -> str | None:
    english_match = _TOC_ENGLISH_CHAPTER_PATTERN.search(line)
    if english_match:
        number = chapter_number(english_match.group(0))
        if number is None:
            return None
        suffix = line[english_match.end():].strip(" \t.:：·•_-")
        repeated_match = _TOC_ENGLISH_CHAPTER_PATTERN.match(suffix)
        if repeated_match and chapter_number(repeated_match.group(0)) == number:
            suffix = suffix[repeated_match.end():].strip(" \t.:：·•_-")
        return f"CHAPTER {number:02d}" + (f" {suffix}" if suffix else "")
    match = _TOC_CHAPTER_PATTERN.search(line)
    if not match:
        return None
    return line[match.start():].strip()


def _section_parts(title: str) -> tuple[int, ...] | None:
    match = _TOC_SECTION_PATTERN.match(title)
    if not match:
        return None
    parts = tuple(int(part) for part in re.split(r"\s*[.．]\s*", match.group("section")))
    if not parts or not 1 <= parts[0] <= 30:
        return None
    return parts


def _attached_page_allowed(title: str, page_digits: str) -> bool:
    if chapter_number(title) is None and _section_parts(title) is None and not _ATTACHED_PAGE_LABEL_PATTERN.match(title):
        return False
    if len(page_digits) == 1 and title and title[-1].isascii() and title[-1].isalpha():
        return False
    return not title.endswith(("/", ".", "．"))


def entry_for_line(line: str, page_count: int) -> tuple[str, int] | None:
    line = re.sub(r"\s+", " ", line).strip()
    match = _TOC_ENTRY_PATTERN.match(line)
    if match:
        title = match.group("title").strip(" .…·•_-\t")
        target_page = int(match.group("page"))
        numeric_tail = re.search(r"\s(?P<numbers>\d{1,4}(?:\s+\d{1,4})+)\s*$", line)
        if numeric_tail:
            candidates = [
                int(value)
                for value in numeric_tail.group("numbers").split()
                if 1 <= int(value) <= page_count
            ]
            repaired_page = max(candidates, default=target_page)
            if repaired_page > target_page and repaired_page >= target_page * 3:
                target_page = repaired_page
                title = line[:numeric_tail.start()].strip(" .…·•_-\t")
    else:
        match = _TOC_ATTACHED_PAGE_PATTERN.match(line)
        if not match:
            return None
        title = match.group("title").strip(" .…·•_-\t")
        page_digits = match.group("page")
        if not _attached_page_allowed(title, page_digits):
            return None
        target_page = int(page_digits)

    if (
        len(title) < 2
        or _TOC_TITLE_PATTERN.search(title)
        or not 1 <= target_page <= page_count
    ):
        return None
    return title, target_page


def _entries_for_lines(lines: Sequence[str], page_count: int) -> list[tuple[str, int]]:
    return [entry for line in lines if (entry := entry_for_line(line, page_count)) is not None]


def _toc_pages(pages: Sequence[Sequence[OutlineWord]]) -> list[tuple[int, list[str]]]:
    page_count = len(pages)
    discovery_limit = min(
        page_count,
        max(8, min(TOC_DISCOVERY_LIMIT, (page_count + 9) // 10)),
    )
    cached: dict[int, tuple[list[str], int, int, bool]] = {}

    def page_info(page_index: int) -> tuple[list[str], int, int, bool]:
        if page_index not in cached:
            lines = _text_lines(pages[page_index])
            entry_count = len(_entries_for_lines(lines, page_count))
            chapter_count = sum(1 for line in lines if chapter_title(line))
            has_title = bool(_TOC_TITLE_PATTERN.search("\n".join(lines)))
            cached[page_index] = (lines, entry_count, chapter_count, has_title)
        return cached[page_index]

    best: list[tuple[int, list[str]]] = []
    best_score = 0
    for start in range(discovery_limit):
        _lines, entries, _chapters, title = page_info(start)
        if not (title or entries >= 3):
            continue
        candidate: list[tuple[int, list[str]]] = []
        score = 0
        for page_index in range(start, min(page_count, start + TOC_CONTINUATION_LIMIT)):
            lines, entry_count, chapter_count, has_title = page_info(page_index)
            if not (has_title or entry_count >= 2 or (chapter_count and entry_count)):
                break
            candidate.append((page_index, lines))
            score += entry_count + min(chapter_count, 5) + int(has_title)
        if score > best_score:
            best, best_score = candidate, score
    return best


def toc_page_indexes(pages: Sequence[Sequence[OutlineWord]]) -> list[int]:
    return [page_index for page_index, _lines in _toc_pages(pages)]


def _body_chapter_number(
    words: Sequence[OutlineWord],
    page_size: tuple[float, float] | None,
) -> int | None:
    if not words:
        return None
    page_height = float(page_size[1]) if page_size else max(float(word.bottom) for word in words)
    if page_height <= 0:
        return None
    top_words = [word for word in words if float(word.top) <= page_height * 0.35]
    if not top_words:
        return None
    median_height = max(1e-6, statistics.median(_word_height(word) for word in words))
    has_chapter_word = bool(re.search(
        r"c\s*h\s*a\s*p\s*t\s*e\s*r",
        "\n".join(_text_lines(top_words)),
        re.IGNORECASE,
    ))
    if not has_chapter_word:
        return None
    for word in top_words:
        value = str(word.text).strip()
        number_match = re.match(r"^0*([1-9]|[12]\d|30)(?=\D|$)", value)
        if number_match and _word_height(word) >= median_height * 2.0:
            return int(number_match.group(1))
    for word in top_words:
        number = chapter_number(str(word.text))
        if number is not None and _word_height(word) >= median_height * 1.5:
            return number
    return None


def _unnumbered_body_chapter_opening(
    words: Sequence[OutlineWord], page_size: tuple[float, float] | None,
) -> bool:
    if not words:
        return False
    page_height = float(page_size[1]) if page_size else max(float(word.bottom) for word in words)
    median_height = max(1e-6, statistics.median(_word_height(word) for word in words))
    for heading in words:
        if (re.fullmatch(r"chapter", str(heading.text).strip(), re.IGNORECASE)
                and float(heading.top) < page_height * 0.15
                and _word_height(heading) >= median_height * 1.8):
            return any(
                float(word.top) > float(heading.bottom)
                and float(word.top) < page_height * 0.25
                and _word_height(word) >= median_height * 2.0
                for word in words
            )
    return False


def _printed_page_offset(
    pages: Sequence[Sequence[OutlineWord]],
    page_sizes: Sequence[tuple[float, float]] | None,
    toc_end_index: int,
    chapter_pages: dict[int, int],
) -> int:
    footer_offsets: list[int] = []
    for page_index in range(toc_end_index + 1, len(pages)):
        page_size = page_sizes[page_index] if page_sizes and page_index < len(page_sizes) else None
        page_width = float(page_size[0]) if page_size else max((float(word.right) for word in pages[page_index]), default=0.0)
        page_height = float(page_size[1]) if page_size else max((float(word.bottom) for word in pages[page_index]), default=0.0)
        footer_numbers = {
            int(str(word.text).strip())
            for word in pages[page_index]
            if re.fullmatch(r"\d{1,4}", str(word.text).strip())
            and float(word.top) >= page_height * 0.88
            and (float(word.left) <= page_width * 0.12 or float(word.right) >= page_width * 0.88)
            and float(getattr(word, "confidence", 1.0)) >= 0.8
        }
        if len(footer_numbers) == 1:
            offset = page_index + 1 - next(iter(footer_numbers))
            if abs(offset) <= max(32, len(pages) // 5):
                footer_offsets.append(offset)
    if footer_offsets:
        offset, count = Counter(footer_offsets).most_common(1)[0]
        if count >= 3 and count >= len(footer_offsets) * 0.5:
            return offset

    offsets: list[int] = []
    for page_index in range(toc_end_index + 1, len(pages)):
        page_size = page_sizes[page_index] if page_sizes and page_index < len(page_sizes) else None
        number = _body_chapter_number(pages[page_index], page_size)
        printed_page = chapter_pages.get(number or 0)
        if printed_page is not None:
            offsets.append((page_index + 1) - printed_page)
    if not offsets:
        return 0
    offset, count = Counter(offsets).most_common(1)[0]
    return offset if count >= 2 else 0


def build_outline(
    pages: Sequence[Sequence[OutlineWord]],
    page_sizes: Sequence[tuple[float, float]] | None = None,
) -> list[dict]:
    toc_pages = _toc_pages(pages)
    if not toc_pages:
        return []

    page_count = len(pages)
    chapter_order: list[int] = []
    chapter_titles: dict[int, str] = {}
    chapter_pages: dict[int, int] = {}
    children: dict[int, list[tuple[str, int, int]]] = {}
    child_keys: dict[int, set[tuple[str, int]]] = {}
    loose: list[tuple[str, int, int]] = []
    active_chapter: int | None = None
    last_chapter_page: int | None = None
    pending_chapter_number = False
    saw_chapter = False

    def remember_chapter(number: int, title: str | None = None) -> None:
        nonlocal saw_chapter
        if number == 2 and not chapter_order and loose:
            chapter_order.append(1)
            chapter_titles[1] = "CHAPTER 01"
            chapter_pages[1] = loose[0][1]
            children[1] = [(item_title, page, max(2, level)) for item_title, page, level in loose]
            loose.clear()
        saw_chapter = True
        if number not in chapter_order:
            chapter_order.append(number)
        if title:
            chapter_titles.setdefault(number, title)

    for _page_index, lines in toc_pages:
        header_lines = []
        for line in lines[:3]:
            if entry_for_line(line, page_count):
                break
            header_lines.append(line)
        has_explicit_heading = any(
            re.match(r"^\W*(?:c\w{0,3}apter|appendix)\b", line, re.IGNORECASE)
            or re.match(r"^[\"'“”‘’]?\s*\d{2}\s+", line)
            for line in header_lines
        )
        if len(_entries_for_lines(lines, page_count)) >= 3 and not has_explicit_heading:
            for raw_header in header_lines:
                possible_header = re.sub(r"\s+", " ", raw_header).strip()
                if entry_for_line(possible_header, page_count):
                    break
                alphanumeric = sum(char.isalnum() for char in possible_header)
                if (
                    6 <= len(possible_header) <= 80
                    and alphanumeric >= len(possible_header) * 0.7
                    and not _TOC_TITLE_PATTERN.search(possible_header)
                    and not re.match(r"^c\w{0,3}apter\b", possible_header, re.IGNORECASE)
                    and not re.search(r"https?://|www\.", possible_header, re.IGNORECASE)
                    and not re.match(r"^[\"'“”‘’]?\s*\d{1,2}\b", possible_header)
                    and chapter_title(possible_header) is None
                ):
                    number = (active_chapter or 0) + 1
                    if number <= 30:
                        remember_chapter(number, f"CHAPTER {number:02d} {possible_header}")
                        active_chapter = number
                    break
        for line in lines:
            normalized_line = re.sub(r"\s+", " ", line).strip()
            repeated_number = re.match(
                r"^\s*(\d{3})\s+0*([1-9]|[12]\d|30)\s*[|Il]?\s+(?:chapter\s+)?(.+)$",
                normalized_line,
                re.IGNORECASE,
            )
            if repeated_number and int(repeated_number.group(1)) % 100 == int(repeated_number.group(2)):
                number = int(repeated_number.group(2))
                remember_chapter(number, f"CHAPTER {number:02d} {repeated_number.group(3)}")
                active_chapter = number
                pending_chapter_number = False
                continue
            split_number = re.match(
                r"^[\"'“”‘’]?\s*0*(0|[1-9]|[12]\d|30)(?:\s+\1)?\s+(.+)$",
                normalized_line,
            )
            if split_number and entry_for_line(normalized_line, page_count) is None and (
                pending_chapter_number
                or (active_chapter is not None and int(split_number.group(1)) == active_chapter + 1)
                or re.match(r"^[\"'“”‘’]?\s*\d{2}\s+", normalized_line)
            ):
                number = int(split_number.group(1))
                remember_chapter(number, f"CHAPTER {number:02d} {split_number.group(2)}")
                active_chapter = number
                pending_chapter_number = False
                continue
            pending_chapter_number = bool(
                re.match(r"^\s*chapter\b", normalized_line, re.IGNORECASE)
                and chapter_number(normalized_line) is None
            )
            parsed = entry_for_line(normalized_line, page_count)
            header = chapter_title(normalized_line)
            if parsed is None:
                header_number = chapter_number(header or "")
                if header_number is not None:
                    remember_chapter(header_number, header)
                    active_chapter = header_number
                continue

            title, printed_page = parsed
            normalized_chapter_title = chapter_title(title)
            explicit_chapter = chapter_number(normalized_chapter_title or "")
            section = _section_parts(title)
            if explicit_chapter is not None:
                remember_chapter(explicit_chapter, normalized_chapter_title)
                active_chapter = explicit_chapter
                if last_chapter_page is None or printed_page >= last_chapter_page:
                    chapter_pages.setdefault(explicit_chapter, printed_page)
                    last_chapter_page = printed_page
                continue

            if section is not None:
                number = section[0]
                if number not in chapter_order:
                    remember_chapter(number, f"CHAPTER {number:02d}")
                active_chapter = number
                level = max(2, len(section))
                if number in chapter_order:
                    key = (title, printed_page)
                    if key not in child_keys.setdefault(number, set()):
                        children.setdefault(number, []).append((title, printed_page, level))
                        child_keys[number].add(key)
                else:
                    loose.append((title, printed_page, level))
                continue

            if active_chapter is not None and active_chapter in chapter_order:
                key = (title, printed_page)
                if key not in child_keys.setdefault(active_chapter, set()):
                    children.setdefault(active_chapter, []).append((title, printed_page, 2))
                    child_keys[active_chapter].add(key)
            else:
                loose.append((title, printed_page, 1))

    if not chapter_order:
        return [
            {"title": title, "page": page, "level": level}
            for title, page, level in loose
        ]

    for number in chapter_order:
        if number not in chapter_pages and children.get(number):
            chapter_pages[number] = children[number][0][1]

    offset = _printed_page_offset(pages, page_sizes, toc_pages[-1][0], chapter_pages)

    def physical_page(printed_page: int) -> int:
        mapped = printed_page + offset
        return mapped if 1 <= mapped <= page_count else printed_page

    # A damaged TOC can lose a whole chapter heading while retaining its
    # section rows. Use a numbered opening in the body to restore that parent.
    if chapter_pages:
        known = set(chapter_pages)
        missing = [number for number in range(min(known) + 1, max(known) + 2) if number not in known]
        if missing:
            body_hits: dict[int, list[int]] = {}
            unnumbered_openings: list[int] = []
            for page_index in range(toc_pages[-1][0] + 1, page_count):
                page_size = page_sizes[page_index] if page_sizes and page_index < len(page_sizes) else None
                number = _body_chapter_number(pages[page_index], page_size)
                if number in missing:
                    body_hits.setdefault(number, []).append(page_index + 1)
                elif number is None and _unnumbered_body_chapter_opening(pages[page_index], page_size):
                    unnumbered_openings.append(page_index + 1)
            for number in missing:
                previous = max((item for item in chapter_pages if item < number), default=None)
                following = min((item for item in chapter_pages if item > number), default=None)
                if previous is None:
                    continue
                if following is None and len(body_hits.get(number, [])) < 2:
                    continue
                previous_page = physical_page(chapter_pages[previous])
                following_page = physical_page(chapter_pages[following]) if following in chapter_pages else page_count + 1
                opening = next((page for page in body_hits.get(number, []) if previous_page < page < following_page), None)
                unnumbered_opening = False
                if opening is None and following is not None:
                    opening = next((page for page in unnumbered_openings if previous_page < page < following_page), None)
                    if opening is not None:
                        unnumbered_opening = True
                        unnumbered_openings.remove(opening)
                if opening is None:
                    continue
                if number not in chapter_order:
                    chapter_order.append(number)
                chapter_titles.setdefault(number, f"CHAPTER {number:02d}")
                if unnumbered_opening:
                    body_lines = _text_lines(pages[opening - 1])
                    for line_index, line in enumerate(body_lines[:-1]):
                        if not re.fullmatch(r"chapter", line.strip(), re.IGNORECASE):
                            continue
                        title = body_lines[line_index + 1].strip()
                        if 6 <= len(title) <= 80 and sum(char.isalnum() for char in title) >= len(title) * 0.7:
                            chapter_titles[number] = f"CHAPTER {number:02d} {title}"
                        break
                chapter_pages[number] = opening - offset
                previous_children = children.get(previous, [])
                children[previous] = [item for item in previous_children if physical_page(item[1]) < opening]
                children[number] = [item for item in previous_children if physical_page(item[1]) >= opening]

    outline = [
        {"title": title, "page": physical_page(page), "level": level}
        for title, page, level in loose
    ]
    for number in sorted(chapter_order):
        printed_page = chapter_pages.get(number)
        if printed_page is None:
            continue
        outline.append({
            "title": chapter_titles.get(number, f"CHAPTER {number:02d}"),
            "page": physical_page(printed_page),
            "level": 1,
        })
        outline.extend(
            {"title": title, "page": physical_page(page), "level": level}
            for title, page, level in children.get(number, [])
        )
    return outline


def native_outline_for_reader(reader) -> list[dict]:
    try:
        items = reader.outline
    except Exception:
        return []

    outline: list[dict] = []

    def visit(children, level: int) -> None:
        for item in children:
            if isinstance(item, list):
                visit(item, level + 1)
                continue
            title = str(getattr(item, "title", "") or "").strip()
            try:
                page = reader.get_destination_page_number(item) + 1
            except Exception:
                continue
            if title and 1 <= page <= len(reader.pages):
                outline.append({"title": title, "page": page, "level": level})

    visit(items, 1)
    return outline


def choose_outline(
    native_outline: Sequence[dict],
    parsed_outline: Sequence[dict],
    *,
    is_ails_ocr: bool = False,
    source_hint: str = "",
) -> list[dict]:
    native = [dict(item) for item in native_outline]
    parsed = [dict(item) for item in parsed_outline]
    if source_hint == "generated":
        return parsed
    if not native:
        return parsed
    if not parsed:
        return native
    if source_hint == "native" or not is_ails_ocr:
        return native

    native_pages = [int(item.get("page", 0)) for item in native]
    duplicate_destinations = len(native_pages) - len(set(native_pages))
    native_is_flat = all(int(item.get("level", 1)) == 1 for item in native)
    parsed_chapters = sum(1 for item in parsed if chapter_number(str(item.get("title", ""))) is not None)
    parsed_has_children = any(int(item.get("level", 1)) > 1 for item in parsed)
    looks_like_legacy_generated = (
        native_is_flat
        and duplicate_destinations >= max(2, len(native) // 4)
        and parsed_chapters >= 2
        and parsed_has_children
    )
    return parsed if looks_like_legacy_generated else native


def choose_app_outline(
    native_outline: Sequence[dict],
    parsed_outline: Sequence[dict],
    page_count: int,
    *,
    is_ails_ocr: bool,
) -> list[dict]:
    """Choose the viewer outline using coverage and destination sanity."""
    native = [dict(item) for item in native_outline]
    parsed = [dict(item) for item in parsed_outline]
    if not is_ails_ocr:
        return native or parsed
    if not native:
        return parsed
    if not parsed:
        return native

    native_pages = [int(item.get("page", 0)) for item in native]
    reversals = sum(left > right for left, right in zip(native_pages, native_pages[1:]))
    duplicates = len(native_pages) - len(set(native_pages))
    flat = all(int(item.get("level", 1)) == 1 for item in native)
    native_is_usable = (
        len(native) >= max(3, len(parsed) * 0.75)
        and not (flat and len(native) >= page_count * 0.75)
        and reversals <= max(1, len(native) // 100)
        and duplicates <= len(native) * 0.3
    )
    if not native_is_usable:
        return parsed
    if len(native) < len(parsed) * 1.1:
        return parsed
    if not flat:
        return native

    chapter_pages = {
        number: int(item["page"])
        for item in native
        if (number := chapter_number(str(item.get("title", "")))) is not None
    }
    if len(chapter_pages) < 2:
        return native
    additions = []
    for item in parsed:
        if int(item.get("level", 1)) != 1:
            continue
        number = chapter_number(str(item.get("title", "")))
        if number is None or number in chapter_pages:
            continue
        previous = max((known for known in chapter_pages if known < number), default=None)
        following = min((known for known in chapter_pages if known > number), default=None)
        page = int(item.get("page", 0))
        if previous is not None and following is not None and chapter_pages[previous] < page < chapter_pages[following]:
            additions.append(item)
    return sorted(native + additions, key=lambda item: (int(item["page"]), 0 if item in additions else 1))
