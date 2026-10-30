"""Local, bounded answer-key extraction. No model or tool execution is performed."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
from functools import lru_cache
from pathlib import Path

PARSER_VERSION = 4
MAX_TEXT = 200_000
MAX_EVIDENCE = 12_000
MAX_PAGES = 30


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def file_version(path):
    path = normalized_path(path)
    stat = os.stat(path)
    return _file_version(path, stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


@lru_cache(maxsize=128)
def _file_version(path, *_signature):
    hasher = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def normalized_path(path):
    return os.path.realpath(os.path.expanduser(str(path or "")))


def validate_source(path, base_dir, pdf_path):
    source = normalized_path(path)
    base = normalized_path(base_dir)
    if source != normalized_path(pdf_path) and os.path.commonpath([base, source]) != base:
        raise ValueError("답지는 자료 저장 폴더 안에 두거나 현재 PDF에서 영역을 선택해 주세요.")
    if not os.path.isfile(source):
        raise ValueError("답지 파일을 찾을 수 없습니다.")
    return source


def normalize_region(region):
    region = region or {}
    start = int(region.get("page_start", 1))
    end = int(region.get("page_end", start))
    page_boxes = region.get("page_boxes")
    if start < 1 or end < start or (end - start >= MAX_PAGES and not page_boxes):
        raise ValueError("한 번에 1~30페이지의 필요한 답지 영역만 선택해 주세요.")
    first_line = int(region.get("line_start", 1))
    last_line = int(region.get("line_end", MAX_TEXT))
    if first_line < 1 or last_line < first_line:
        raise ValueError("답지 줄 범위가 잘못되었습니다.")
    box = region.get("bbox")
    if box is not None:
        if not isinstance(box, dict) or any(key not in box for key in ("left", "top", "right", "bottom")):
            raise ValueError("영역 좌표가 필요합니다.")
        box = {key: float(box[key]) for key in ("left", "top", "right", "bottom")}
        if not (0 <= box["left"] < box["right"] <= 1 and 0 <= box["top"] < box["bottom"] <= 1):
            raise ValueError("영역 좌표는 0~1 범위여야 합니다.")
    result = {"page_start": start, "page_end": end, "line_start": first_line, "line_end": last_line, "bbox": box}
    if page_boxes is not None:
        if not isinstance(page_boxes, dict) or not 1 <= len(page_boxes) <= MAX_PAGES:
            raise ValueError("답지 페이지별 영역이 잘못되었습니다.")
        result["page_boxes"] = {}
        for page, page_box in page_boxes.items():
            if not start <= int(page) <= end or page_box is None:
                raise ValueError("답지 페이지별 영역이 범위를 벗어났습니다.")
            result["page_boxes"][str(int(page))] = normalize_region({"bbox": page_box})["bbox"]
    return result


def extract_regions(path, region):
    extension = Path(path).suffix.lower()
    if extension in {".txt", ".md", ".csv", ".tsv"}:
        if region["page_start"] != 1 or region["page_end"] != 1 or region["bbox"] or region.get("page_boxes"):
            raise ValueError("텍스트/표 답지는 1페이지의 줄 범위를 선택해 주세요.")
        if os.path.getsize(path) > 2_000_000:
            raise ValueError("큰 텍스트 답지는 필요한 부분을 별도 텍스트 파일로 나눠 주세요.")
        text = Path(path).read_text(encoding="utf-8-sig", errors="strict")
        return [{"page": 1, "text": text, "method": "text", "confidence": 1.0, "bbox": None}]
    if extension != ".pdf":
        return []
    from pdf.pdf_password import open_pdf_reader
    reader = open_pdf_reader(path)
    if region["page_end"] > len(reader.pages):
        raise ValueError("답지 페이지 범위를 벗어났습니다.")
    pages = []
    numbers = sorted(map(int, region["page_boxes"])) if "page_boxes" in region else range(region["page_start"], region["page_end"] + 1)
    for number in numbers:
        # PDFium preserves glyph numbering where pypdf can lose custom-font digits.
        from pdf.pdf_native_text import visible_native_index_words
        native = visible_native_index_words(path, number)
        box = region.get("page_boxes", {}).get(str(number), region["bbox"])
        words = [{"text": word.text, "left": word.left, "top": word.top, "right": word.right, "bottom": word.bottom, "confidence": word.confidence} for word in native]
        method = "native_index"
        if not words:
            from pdf.pdf_ocr_search import indexed_pdf_page
            page = indexed_pdf_page(path, number)
            words = page.get("words") or []
            method = "saved_ocr"
        selected = [word for word in words if not box or (
            word["right"] > box["left"] and word["left"] < box["right"]
            and word["bottom"] > box["top"] and word["top"] < box["bottom"])]
        from pdf.pdf_ocr_search import _reconstruct_indexed_region_text
        text = _reconstruct_indexed_region_text([(word["text"], word["left"], word["top"], word["right"], word["bottom"]) for word in selected])
        confidence = min((float(word.get("confidence") or 0) for word in selected), default=0)
        entry = {"page": number, "text": text, "method": method, "confidence": confidence, "bbox": box}
        if method == "native_index":
            from documents.answer_key_pdf_tables import table_edges, extract_table_candidates
            entry["table_candidates"] = extract_table_candidates(selected, table_edges(path, number, reader.pages[number - 1]), number)
        pages.append(entry)
    return pages


def _kind(answer):
    if re.match(r"^[①-⑳](?:\s|$)", answer) or re.fullmatch(r"[1-9]\s*(?:번)?", answer):
        return "choice"
    if re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*[^\d\s]*", answer):
        return "numeric"
    return "short" if len(answer) <= 60 and "\n" not in answer else "essay"


def parse_candidates(pages, region):
    candidates = []
    chapter = ""
    total = 0
    for page in pages:
        if page.get("table_candidates") and region["line_start"] == 1 and region["line_end"] == MAX_TEXT:
            for row in page["table_candidates"]:
                item = dict(row)
                total += len(item["original_text"])
                if total > MAX_TEXT:
                    raise ValueError("선택한 답지 영역이 큽니다. 필요한 페이지/줄만 선택해 주세요.")
                if item["number"] is None:
                    previous = next((c for c in reversed(candidates) if c.get("table_column") == item["table_column"]
                                     and c.get("continues_after_page")
                                     and c.get("continuation_locations", [c["location"]])[-1]["page"] == page["page"] - 1), None)
                    if previous:
                        if item["answer"]:
                            previous["answer"] += "\n" + item["answer"]
                        if item["explanation"]:
                            previous["explanation"] += "\n" + item["explanation"]
                        if item["criteria"]:
                            previous["criteria"] += "\n" + item["criteria"]
                        previous.setdefault("continuation_locations", []).append(item["location"])
                        previous["original_text"] += "\n" + item["original_text"]
                        previous["continues_after_page"] = item["continues_after_page"]
                        previous["kind"] = _kind(previous["answer"])
                    continue
                item["kind"] = _kind(item["answer"])
                candidates.append(item)
            continue
        lines = page["text"].splitlines()
        selected = list(enumerate(lines, 1))[region["line_start"] - 1:region["line_end"]]
        total += sum(len(line) for _, line in selected)
        if total > MAX_TEXT:
            raise ValueError("선택한 답지 영역이 큽니다. 필요한 페이지/줄만 선택해 주세요.")
        headers = None
        for number, line in selected:
            raw = line.strip()
            if not raw:
                continue
            from documents.problem_answer_key_boundary import is_answer_key_heading
            if is_answer_key_heading(raw) or re.fullmatch(r"(?:answer\s*key|answers?|solutions?)(?:\s+\d+)?", raw, re.I):
                continue
            pairs = list(re.finditer(r"(?:^|\s)(\d{1,4})\s*[.:：)]?\s+([①-⑳])(?=\s|$)", raw))
            if pairs and not re.sub(r"(?:^|\s)(\d{1,4})\s*[.:：)]?\s+([①-⑳])(?=\s|$)", "", raw).strip():
                for pair in pairs:
                    candidates.append({"chapter": chapter, "number": int(pair[1]), "subquestion": "", "answer": pair[2], "criteria": "", "question": "", "kind": "choice", "original_text": line, "location": {"page": page["page"], "line_start": number, "line_end": number, "bbox": page["bbox"]}, "method": page["method"], "confidence": page["confidence"]})
                continue
            cells = [part.strip() for part in raw.strip("|").split("|")] if "|" in raw else next(csv.reader([raw], delimiter="\t" if "\t" in raw else ","))
            cells = [part.strip() for part in cells]
            aliases = {"chapter": "chapter", "단원": "chapter", "number": "number", "번호": "number", "문제번호": "number", "subquestion": "subquestion", "소문항": "subquestion", "answer": "answer", "정답": "answer", "답": "answer", "criteria": "criteria", "기준": "criteria", "question": "question", "문제": "question", "kind": "kind", "유형": "kind"}
            normalized = [aliases.get(cell.lower(), "") for cell in cells]
            if "number" in normalized and "answer" in normalized:
                headers = normalized
                continue
            if headers and len(cells) == len(headers):
                row = dict(zip(headers, cells))
                if not re.fullmatch(r"\d+", row.get("number", "")):
                    continue
                answer = row.get("answer", "").strip()
                item = {"chapter": row.get("chapter", chapter), "number": int(row["number"]), "subquestion": row.get("subquestion", ""), "answer": answer, "criteria": row.get("criteria", ""), "question": row.get("question", ""), "kind": row.get("kind") or _kind(answer)}
            else:
                heading = re.match(r"^(?:#+\s*)?((?:CHAPTER\s*\d+|\d+\s*장|제\s*\d+\s*장|단원\s*\d+).*)$", raw, re.I)
                if heading:
                    chapter = heading[1].strip()
                    continue
                match = re.match(r"^(?:문제\s*)?(\d{1,4})\s*(?:[.．:：)]|번)\s*(?:\(([a-zA-Z가-힣0-9]+)\)\s*)?(?:(?:정답|답|해답)\s*[:：]\s*)?(.+)$", raw)
                if not match:
                    # Long solutions stay attached to their numbered source, without interpreting instructions.
                    if candidates and candidates[-1]["location"]["page"] == page["page"] and candidates[-1]["kind"] in {"essay", "short"}:
                        candidates[-1]["kind"] = "essay"
                        candidates[-1]["answer"] += "\n" + raw
                        candidates[-1]["original_text"] += "\n" + line
                        candidates[-1]["location"]["line_end"] = number
                    elif candidates and candidates[-1]["location"]["page"] == page["page"] and candidates[-1]["kind"] == "choice":
                        previous = candidates[-1]
                        previous["explanation"] = (previous.get("explanation", "") + "\n" + raw).strip()
                        previous["original_text"] += "\n" + line
                        previous["location"]["line_end"] = number
                    continue
                answer = match[3].strip()
                item = {"chapter": chapter, "number": int(match[1]), "subquestion": match[2] or "", "answer": answer, "criteria": "", "question": "", "kind": _kind(answer)}
            if not item["answer"]:
                continue
            item.update({"original_text": line, "location": {"page": page["page"], "line_start": number, "line_end": number, "bbox": page["bbox"]}, "method": page["method"], "confidence": page["confidence"]})
            candidates.append(item)
    for index, item in enumerate(candidates):
        # Explicit circled choice markers remain the answer when a solution
        # repeats the choice label and explanation. Retain the complete source.
        if item["kind"] == "choice" and re.match(r"^[①-⑳]\s+", item["answer"]):
            item["choice_label"] = item["answer"][1:].strip()
            item["answer"] = item["answer"][0]
        if max(len(item["answer"]), len(item["criteria"])) > MAX_EVIDENCE:
            raise ValueError("문항 답지가 너무 깁니다. 해당 문항의 필요한 영역만 선택해 주세요.")
        item["id"] = digest({"index": index, "item": item})[:24]
    return candidates


def read_only_json(path):
    """Memoize immutable read views; mutations always use the store's uncached reader."""
    try:
        stat = os.stat(path)
    except FileNotFoundError:
        return {}
    return _read_only_json(path, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


@lru_cache(maxsize=16)
def _read_only_json(path, *_signature):
    with open(path, encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError("답지 저장 데이터가 손상되었습니다.")
    return value
