"""Locate answer sections from existing PDF text, without chapter metadata or AI."""
import re

from documents.answer_key_sources import MAX_PAGES, normalize_region
from documents.problem_answer_key_boundary import is_answer_key_heading

_PROBLEMS_HEADING = re.compile(r"^(?:연습\s*문제|확인\s*문제|문제|exercises?|practice\s+questions?)\s*$", re.I)
_NUMBER = re.compile(r"^(?:문제\s*)?(\d{1,4})(?:\s*[.．:：)]|\s*번|\s+|$)")
_PAIRS = re.compile(r"(?:^|\s)(\d{1,4})\s*[.:：)]?\s+([①-⑳])(?=\s|$)")


def _lines(words):
    lines = []
    for word in sorted(words, key=lambda item: (item["top"] + item["bottom"]) / 2):
        middle = (word["top"] + word["bottom"]) / 2
        if lines and abs(middle - lines[-1]["middle"]) <= max(.003, (word["bottom"] - word["top"]) * .5):
            line = lines[-1]
            line["words"].append(word)
            line["top"] = min(line["top"], word["top"])
            line["bottom"] = max(line["bottom"], word["bottom"])
        else:
            lines.append({"middle": middle, "top": word["top"], "bottom": word["bottom"], "words": [word]})
    for line in lines:
        line["text"] = " ".join(word["text"] for word in sorted(line.pop("words"), key=lambda item: item["left"]))
    return lines


def read_pages(path):
    from pdf.pdf_password import open_pdf_reader
    from pdf.pdf_native_text import native_text_pages
    from pdf.pdf_ocr_search import indexed_pdf_page
    reader = open_pdf_reader(path)
    pages, sizes = native_text_pages(path, reader, visible_only=True)
    result = []
    for index, (native, (width, height)) in enumerate(zip(pages, sizes), 1):
        words = [{"text": word.text, "left": word.left / width, "top": word.top / height,
                  "right": word.right / width, "bottom": word.bottom / height} for word in native]
        if not words:
            try:
                words = indexed_pdf_page(path, index).get("words") or []
            except ValueError:
                words = []  # No new OCR is started by discovery.
        result.append({"page": index, "lines": _lines(words)})
    return result


def discover(path, problems, *, same_document=True):
    pages = read_pages(path)
    numbers = {item["number"] for item in problems}
    problem_pages = {page for item in problems for page in range(item["page"], item["page_end"] + 1)} if same_document else set()
    boxes = {}
    active = False
    for page in pages:
        lines = page["lines"]
        headings = [i for i, line in enumerate(lines) if is_answer_key_heading(line["text"], lines[i + 1]["text"] if i + 1 < len(lines) else "")]
        # A table of contents mention alone does not establish an answer section.
        start = headings[0] if headings else 0
        stops = [i for i in range(start + (1 if headings else 0), len(lines)) if _PROBLEMS_HEADING.fullmatch(lines[i]["text"])]
        end = stops[0] if stops else len(lines)
        section = lines[start:end]
        table_header = any(re.search(r"(?:number|문항|번호|문제번호)\s+(?:answer|정답)", line["text"], re.I) for line in section)
        numbered = {int(match[1]) for line in section if (match := _NUMBER.match(line["text"])) and int(match[1]) in numbers
                    and (line["text"][match.end():].strip() or table_header)}
        pairs = {int(match[1]) for line in section for match in _PAIRS.finditer(line["text"]) if int(match[1]) in numbers}
        if headings and (numbered or pairs):
            active = True
        elif active and page["page"] not in problem_pages and (numbered or table_header and len(section) > 1):
            pass
        elif not headings and page["page"] not in problem_pages and len(pairs) >= 2:
            active = True  # A compact numbered choice key can omit its heading.
        else:
            active = False
            continue
        boxes[str(page["page"])] = {"left": 0, "top": max(0, lines[start]["top"] - .001) if headings else 0,
                                    "right": 1, "bottom": lines[end]["top"] if end < len(lines) else 1}
        if stops:
            active = False
    if not boxes:
        return {"status": "not_found", "reason": "텍스트에서 답지 구간을 찾지 못했습니다. 페이지 범위를 직접 지정해 주세요."}
    if len(boxes) > MAX_PAGES:
        return {"status": "not_found", "reason": "답지 후보가 30쪽을 넘습니다. 필요한 페이지 범위를 직접 좁혀 주세요."}
    selected = sorted(map(int, boxes))
    return {"status": "detected", "page_count": len(selected), "region": normalize_region({"page_start": selected[0], "page_end": selected[-1], "page_boxes": boxes}),
            "reason": "텍스트에서 답지 구간을 찾았습니다."}
