from __future__ import annotations

import json
import re

def notebook_json_to_markdown(raw_json: str) -> str:
    notebook = parse_notebook_json(raw_json)
    cells = notebook.get("cells", []) if isinstance(notebook, dict) else []
    blocks = []
    for index, cell in enumerate(cells, start=1):
        if not isinstance(cell, dict):
            continue
        cell_type = str(cell.get("cell_type", "") or "").strip()
        source = cell.get("source", "")
        if isinstance(source, list):
            source_text = "".join(str(part) for part in source).strip()
        else:
            source_text = str(source or "").strip()
        if not source_text:
            continue
        if cell_type == "markdown":
            blocks.append(source_text)
        elif cell_type == "code":
            blocks.append(f"```python\n{source_text}\n```")
        else:
            blocks.append(f"### Cell {index}: {cell_type or 'unknown'}\n\n{source_text}")
    return "\n\n".join(blocks)


def format_notebook_json(raw_json: str) -> str:
    parsed = parse_notebook_json(raw_json)
    return json.dumps(parsed, ensure_ascii=False, indent=2)


def parse_notebook_json(raw_json: str):
    return json.loads(str(raw_json or "").lstrip("\ufeff"))


def read_notebook_json_file(path: str):
    with open(path, "r", encoding="utf-8-sig", errors="replace") as handle:
        return handle.read()


def notebook_source_to_text(source) -> str:
    if isinstance(source, list):
        return "".join(str(part) for part in source)
    return str(source or "")


ANSI_ESCAPE_PATTERN = re.compile(r"\[[0-?]*[ -/]*[@-~]")


def strip_ansi_escapes(text: object) -> str:
    return ANSI_ESCAPE_PATTERN.sub("", str(text or ""))


def notebook_execution_output_text(output: dict) -> str:
    if not isinstance(output, dict):
        return ""
    if output.get("output_type") == "stream":
        return strip_ansi_escapes(output.get("text", ""))
    if output.get("output_type") == "error":
        traceback = output.get("traceback")
        if isinstance(traceback, list) and traceback:
            return "\n".join(strip_ansi_escapes(line) for line in traceback)
        return f"{output.get('ename', 'Error')}: {output.get('evalue', '')}".strip()
    data = output.get("data")
    if isinstance(data, dict):
        text_plain = data.get("text/plain")
        if isinstance(text_plain, list):
            return "".join(strip_ansi_escapes(part) for part in text_plain)
        if text_plain is not None:
            return strip_ansi_escapes(text_plain)
    return ""


