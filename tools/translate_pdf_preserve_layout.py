from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "ails-backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from pdf.pdf_translation import (  # noqa: E402,F401
    DEFAULT_TEST_PAGES,
    deepseek_config,
    extract_indexed_layout,
    extract_native_layout,
    is_high_confidence_untranslated,
    parse_pages,
    run_pdf_translation,
    translation_request_options,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Translate PDF pages while preserving visual lines and artwork. "
            "This implementation uses pypdfium2, pypdf, and ReportLab instead of PyMuPDF."
        )
    )
    parser.add_argument("--input", required=True)
    parser.add_argument(
        "--pages",
        default=",".join(str(page) for page in DEFAULT_TEST_PAGES),
        help="Comma-separated page numbers or ranges. Use 'all' for the full document.",
    )
    parser.add_argument("--config", default=str(ROOT_DIR / "last_config.json"))
    parser.add_argument(
        "--output",
        default=str(ROOT_DIR / "output" / "pdf" / "pythonlearn-ko-layout-test-10p.pdf"),
    )
    parser.add_argument(
        "--cache",
        default=str(
            ROOT_DIR
            / "tmp"
            / "pdfs"
            / "deepseek-translation"
            / "pythonlearn-ko-layout-test-10p.json"
        ),
    )
    return parser.parse_args()


def _console_event(event: dict[str, Any]) -> None:
    event_type = str(event.get("type", ""))
    if event_type == "stage":
        print(f"[단계] {event.get('label', event.get('stage', ''))}")
    elif event_type in {"translation_progress", "render_progress", "verify_progress"}:
        print(
            f"[진행] {event.get('completed', 0)}/{event.get('total', 0)} "
            f"(원본 {event.get('page', '-')}쪽)"
        )
    elif event_type == "done":
        print(f"[완료] PDF: {event.get('output_path', '')}")
        print(f"[완료] QA: {event.get('qa_path', '')}")
        print(f"[상태] {event.get('status', '')}")


def main() -> int:
    args = parse_args()
    source_path = Path(args.input).expanduser().resolve()
    config_path = Path(args.config).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    with config_path.open("r", encoding="utf-8") as handle:
        app_config = json.load(handle)
    pages = None if str(args.pages).strip().lower() == "all" else parse_pages(args.pages)
    run_pdf_translation(
        source_path,
        app_config,
        output_path=args.output,
        cache_path=args.cache,
        pages=pages,
        emit=_console_event,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
