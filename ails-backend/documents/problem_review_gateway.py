"""AI 검수 게이트웨이 multimodal OCR correction for detected PDF problems.

Validated page-batch results are applied automatically by the API layer. This
module keeps both the latest review and append-only audit snapshots.
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import threading
import time
import urllib.error
import uuid
from pathlib import Path
from typing import Any, Mapping

from language_support import language_display_name, normalize_app_language

GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions"
GEMINI_FLASH_LITE = "google/gemini-2.5-flash-lite"
GPT5_NANO = "openai/gpt-5-nano"
LUNA_MEDIUM = "openai/gpt-5.6-luna"
PRIMARY_REVIEW_MODEL = GPT5_NANO
SECONDARY_REVIEW_MODEL = LUNA_MEDIUM
FALLBACK_REVIEW_MODEL = GEMINI_FLASH_LITE
SUPPORTED_MODELS = (PRIMARY_REVIEW_MODEL, SECONDARY_REVIEW_MODEL, FALLBACK_REVIEW_MODEL)
MAX_BENCHMARK_COST_USD = 2.0
AUTO_APPLY_CONFIDENCE = 0.95
MIN_SPANNING_TEXT_COVERAGE = 0.70
MAX_CODE_BLOCKS = 16
MAX_PROPOSAL_EXPANSION = 3.0
VALID_ANSWER_TYPES = frozenset({"multiple_choice", "short_answer", "ox", "code", "unknown"})
REQUIRED_PROPOSAL_FIELDS = frozenset({
    "id", "number", "page", "page_end", "problem_text", "choices", "code",
    "answer_type", "reason", "confidence",
})
_queue_lock = threading.RLock()


def page_batch_response_schema() -> dict[str, Any]:
    """Strict OpenAI-compatible schema for one page-batched OCR response."""
    proposal = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "number": {"type": "integer"},
            "page": {"type": "integer"},
            "page_end": {"type": "integer"},
            "problem_text": {"type": "string"},
            "choices": {"type": "array", "items": {"type": "string"}},
            "code": {"type": "array", "items": {"type": "string"}},
            "code_positions": {"type": "array", "items": {"type": "integer"}},
            "answer_type": {
                "type": "string",
                "enum": ["multiple_choice", "short_answer", "ox", "code", "unknown"],
            },
            "reason": {"type": "string"},
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": (
                    "Confidence that the returned transcription, problem boundary, "
                    "and field separation exactly match the visible page; not confidence "
                    "in solving the problem."
                ),
            },
        },
        "required": [
            "id", "number", "page", "page_end", "problem_text", "choices",
            "code", "code_positions", "answer_type", "reason", "confidence",
        ],
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "proposals": {"type": "array", "items": proposal},
        },
        "required": ["proposals"],
    }


def _has_usable_response_cost(usage: Any) -> bool:
    """Return whether AI 검수 게이트웨이 supplied a finite, non-negative cost."""
    if not isinstance(usage, Mapping) or "cost" not in usage:
        return False
    try:
        value = float(usage.get("cost"))
    except (TypeError, ValueError, OverflowError):
        return False
    return math.isfinite(value) and value >= 0


def _response_diagnostics(content: Any) -> dict[str, Any]:
    """Keep bounded local evidence for malformed model output, never full output."""
    text = str(content or "")
    encoded = text.encode("utf-8", errors="replace")
    return {
        "content_sha256": hashlib.sha256(encoded).hexdigest(),
        "content_length": len(text),
        "content_preview": text[:1_000],
    }


class GatewayResponseError(ValueError):
    """Whole-response failure carrying usage so paid calls remain accounted for."""

    def __init__(
        self,
        message: str,
        *,
        usage: Mapping[str, Any] | None = None,
        response_id: Any = "",
        latency_ms: int = 0,
        content: Any = "",
        call_made: bool = True,
        response_truncated: bool = False,
    ) -> None:
        super().__init__(message)
        self.usage = dict(usage or {})
        self.response_id = str(response_id or "")
        self.latency_ms = int(latency_ms or 0)
        self.response_diagnostics = _response_diagnostics(content) if content else {}
        self.call_made = bool(call_made)
        self.response_truncated = bool(response_truncated)
        self.cost_accounting_complete = (
            not self.call_made or _has_usable_response_cost(self.usage)
        )


class TruncatedJsonResponseError(ValueError):
    """The model began one JSON object but stopped before closing it."""


def _looks_like_truncated_json(error: json.JSONDecodeError, value: str) -> bool:
    message = str(error.msg or "").casefold()
    if "unterminated string" in message:
        return True
    end_messages = (
        "expecting value",
        "expecting ',' delimiter",
        "expecting ':' delimiter",
        "expecting property name enclosed in double quotes",
    )
    return error.pos >= max(0, len(value.rstrip()) - 1) and any(
        marker in message for marker in end_messages
    )


def normalize_gemini_flash_lite_model(value: Any) -> str:
    """Return exact configured AI 검수 게이트웨이 Gemini Flash Lite slug."""
    model = str(value or "").strip()
    if model.casefold().startswith("google/"):
        bare = model[len("google/"):]
    else:
        bare = model
    if not re.fullmatch(
        r"gemini-\d+(?:\.\d+)?(?:-[a-z0-9]+)*-flash-lite(?:-[a-z0-9]+)*",
        bare,
        flags=re.IGNORECASE,
    ):
        raise ValueError("Gemini fallback must be a Gemini Flash Lite model.")
    return f"google/{bare}"


def _supported_request_model(model: str) -> bool:
    if model in {PRIMARY_REVIEW_MODEL, SECONDARY_REVIEW_MODEL}:
        return True
    try:
        normalize_gemini_flash_lite_model(model)
        return True
    except ValueError:
        return False


def _audit_path(base_dir: str, pdf_path: str, problem_id: str, model: str = "") -> Path:
    key = hashlib.sha256(os.path.abspath(pdf_path).encode("utf-8")).hexdigest()[:32]
    safe_id = hashlib.sha256(str(problem_id).encode("utf-8")).hexdigest()[:20]
    model_suffix = ""
    if model:
        model_suffix = "-" + hashlib.sha256(str(model).encode("utf-8")).hexdigest()[:12]
    return Path(base_dir) / ".ails-problems" / "multimodal-review" / key / f"{safe_id}{model_suffix}.json"


def _benchmark_path(base_dir: str, pdf_path: str) -> Path:
    key = hashlib.sha256(os.path.abspath(pdf_path).encode("utf-8")).hexdigest()[:32]
    return Path(base_dir) / ".ails-problems" / "multimodal-review" / key / "gold-samples.json"


def _review_queue_path(base_dir: str, pdf_path: str) -> Path:
    key = hashlib.sha256(os.path.abspath(pdf_path).encode("utf-8")).hexdigest()[:32]
    return Path(base_dir) / ".ails-problems" / "multimodal-review" / key / "review-queue.json"


def _review_queue_history_dir(base_dir: str, pdf_path: str) -> Path:
    return _review_queue_path(base_dir, pdf_path).parent / "queue-resolution-history"


def _history_path(
    base_dir: str,
    pdf_path: str,
    problem_id: str,
    model: str,
    record: Mapping[str, Any],
) -> Path:
    latest = _audit_path(base_dir, pdf_path, problem_id, model)
    created_ns = int(float(record.get("created_at") or time.time()) * 1_000_000_000)
    event_ns = time.time_ns()
    run_id = str(record.get("batch_id") or record.get("response_id") or "review")
    safe_run = hashlib.sha256(run_id.encode("utf-8")).hexdigest()[:12]
    status = str(record.get("application_status") or "proposed")
    return latest.parent / "history" / latest.stem / f"{event_ns}-{created_ns}-{safe_run}-{status}.json"


def _read(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(
        f"{path.name}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        temp.write_text(json.dumps(dict(value), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for attempt in range(12):
            try:
                os.replace(temp, path)
                return
            except PermissionError:
                if attempt >= 11:
                    raise
                time.sleep(min(0.75, 0.05 * (attempt + 1)))
    finally:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass


def _write_once(path: Path, value: Mapping[str, Any]) -> None:
    """Create one immutable history entry without replacing an existing file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(dict(value), ensure_ascii=False, indent=2) + "\n"
    with path.open("x", encoding="utf-8") as output:
        output.write(serialized)


def _write_review_record(
    base_dir: str,
    pdf_path: str,
    problem_id: str,
    model: str,
    record: Mapping[str, Any],
) -> None:
    # Append immutable evidence before moving the latest pointer. A failed
    # latest write therefore cannot erase the event from history.
    _write_once(_history_path(base_dir, pdf_path, problem_id, model, record), record)
    _write(_audit_path(base_dir, pdf_path, problem_id, model), record)




def _candidate(problem: Mapping[str, Any]) -> dict[str, Any]:
    candidate = {
        key: problem.get(key)
        for key in (
            "id", "number", "page", "page_end", "problem_text", "choices",
            "code", "code_positions", "answer_type", "kind",
        )
    }
    paddle_original = problem.get("paddleocr_original")
    if isinstance(paddle_original, Mapping):
        for key in (
            "number", "page", "page_end", "problem_text", "choices",
            "code", "code_positions", "answer_type",
        ):
            if key in paddle_original:
                candidate[key] = paddle_original[key]
    return candidate


def _batch_prompt(
    problems: list[Mapping[str, Any]],
    page_numbers: list[int] | None = None,
    language: str = "korean",
) -> str:
    candidates = [_candidate(problem) for problem in problems]
    language_name = language_display_name(language)
    return f"""You are OCR verifier. Read only supplied page image(s) and PaddleOCR candidates below.
Return strict JSON object with one key, proposals. proposals must be an array containing exactly one
object for every candidate id. Each object must contain id, number, page, page_end, problem_text,
choices, code, code_positions, answer_type, reason, confidence.

Confidence scoring (required, 0.0 through 1.0):
- Measure confidence in exact visual transcription, candidate boundary, and separation among
  problem_text, choices, and code. Do not measure confidence in knowing the answer.
- Use 0.95 or higher only when every relevant visible character, choice, code block, and continuation
  boundary is clear and the returned fields exactly match the page.
- Lower the score for blur, clipping, ambiguous glyphs, uncertain boundaries, missing continuation
  context, or uncertain field separation. Briefly identify that uncertainty in reason.
- Use 0.0 only when the candidate cannot be read or reliably matched. An unchanged PaddleOCR candidate
  must still receive its visual transcription confidence; do not return 0 merely because no correction
  was needed.

Required content separation:
- problem_text is prose/stem/body only. Never place answer choices or code-box content in problem_text.
- choices is a JSON array of answer-choice strings only. Preserve every visible label and the original
  choice order. Use [] when there are no answer choices.
- code is a JSON array of strings, one string for each visually distinct code box in reading order.
  Preserve every character, indentation, whitespace, and line break exactly as visible. Do not add
  markdown fences, invented separators, example solutions, or code copied from another problem. Use []
  when there is no visible code box, even when the stem asks the student to write code.
- code_positions is one integer per code item: character offset in prose-only problem_text where that
  code box appeared. Use [] when code is []. This preserves stem/code/follow-up reading order while
  keeping code exclusively in code.

answer_type is required and must use only multiple_choice, short_answer, ox, code, or unknown. Use ox
for O/X or true/false selection questions. Use code
when the student must write, modify, complete, or debug code; multiple_choice only when selectable
options are visible; short_answer for prose, calculation, or execution-result answers; unknown only
when the task type is genuinely unclear. page and page_end are 1-based PDF routing indexes,
not printed book page numbers; return candidate routing indexes unchanged. Correct transcription/boundary
mistakes only. Never solve the problem, invent missing content, rewrite code, or include markdown. Keep
{language_name} text exactly as visible. Read attached PDF pages in numeric order; page_end is inclusive, so
inspect every attached continuation page before returning a proposal. When page_end is greater than
page, preserve candidate continuation text beyond the start page; do not remove it merely because it
is not visible on the first page. Keep each proposal inside its candidate boundary: stop before the next
numbered problem or range header, and never copy text or code from another candidate on an attached page.
Attached image PDF indexes: """ + json.dumps(page_numbers or [], ensure_ascii=False) + "\nPaddleOCR candidates:\n" + json.dumps(candidates, ensure_ascii=False)


def _normalized_choices(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("AI 검수 게이트웨이 proposal choices must be an array.")
    choices = []
    for item in value:
        choice = str(item or "").strip()
        if choice:
            choices.append(choice)
    return choices


def _normalized_code_blocks(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("AI 검수 게이트웨이 proposal code must be an array.")
    blocks = []
    for item in value:
        block = str(item or "")
        if block.strip():
            blocks.append(block)
        if len(blocks) > MAX_CODE_BLOCKS:
            raise ValueError(f"AI 검수 게이트웨이 proposal has more than {MAX_CODE_BLOCKS} code boxes.")
    return blocks


def _strip_terminal_choice_lines(problem_text: str, choices: list[str]) -> tuple[str, list[str]]:
    """Remove only an exact, ordered choice-line suffix; ambiguous overlap is rejected."""
    if not choices:
        return problem_text, []
    text_lines = problem_text.splitlines()
    choice_lines = [
        line.strip()
        for choice in choices
        for line in choice.splitlines()
        if line.strip()
    ]
    if not choice_lines:
        return problem_text, []
    normalized_text_lines = [line.strip() for line in text_lines]
    if (
        len(text_lines) >= len(choice_lines)
        and normalized_text_lines[-len(choice_lines):] == choice_lines
    ):
        stem = "\n".join(text_lines[:-len(choice_lines)]).rstrip()
        if not stem:
            raise ValueError(
                "AI 검수 게이트웨이 proposal contains only duplicated choices in problem_text."
            )
        return stem, ["removed_terminal_choices_from_problem_text"]
    if any(choice_line in normalized_text_lines for choice_line in choice_lines):
        raise ValueError(
            "AI 검수 게이트웨이 proposal ambiguously duplicates choices inside problem_text."
        )
    return problem_text, []


def _strip_exact_code_lines(problem_text: str, code_blocks: list[str]) -> tuple[str, list[str]]:
    """Remove exact standalone code-box lines without guessing at fuzzy matches."""
    if not code_blocks:
        return problem_text, []
    text_lines = problem_text.splitlines()
    actions = []
    for block in code_blocks:
        block_lines = block.splitlines()
        if not block_lines:
            continue
        starts = [
            index
            for index in range(0, len(text_lines) - len(block_lines) + 1)
            if text_lines[index:index + len(block_lines)] == block_lines
        ]
        if len(starts) == 1:
            start = starts[0]
            del text_lines[start:start + len(block_lines)]
            actions.append("removed_exact_code_box_from_problem_text")
            continue
        compact_block = re.sub(r"\s+", "", block)
        compact_text = re.sub(r"\s+", "", "\n".join(text_lines))
        if compact_block and compact_block in compact_text:
            raise ValueError(
                "AI 검수 게이트웨이 proposal ambiguously duplicates code inside problem_text."
            )
    stem = "\n".join(text_lines).strip()
    if actions and not stem:
        raise ValueError(
            "AI 검수 게이트웨이 proposal contains only duplicated code in problem_text."
        )
    return stem or problem_text, actions


def _validated_proposal(raw: Mapping[str, Any], problem: Mapping[str, Any]) -> dict[str, Any]:
    missing = REQUIRED_PROPOSAL_FIELDS - set(raw)
    if missing:
        raise ValueError(f"AI 검수 게이트웨이 proposal is missing required fields: {sorted(missing)}")
    expected_id = str(problem.get("id", ""))
    if str(raw.get("id", "")) != expected_id:
        raise ValueError("AI 검수 게이트웨이 proposal id does not match its candidate.")
    answer_type = str(raw.get("answer_type") or "").strip().lower()
    if answer_type not in VALID_ANSWER_TYPES:
        raise ValueError("AI 검수 게이트웨이 proposal has invalid answer_type.")
    problem_text = str(raw.get("problem_text") or "").strip()
    if not problem_text:
        raise ValueError("AI 검수 게이트웨이 proposal problem_text is empty.")
    choices = _normalized_choices(raw.get("choices"))
    code_blocks = _normalized_code_blocks(raw.get("code"))
    raw_code_positions = raw.get("code_positions", [])
    if not isinstance(raw_code_positions, list):
        raise ValueError("AI 검수 게이트웨이 proposal code_positions must be an array.")
    separation_actions = []
    problem_text, code_actions = _strip_exact_code_lines(problem_text, code_blocks)
    separation_actions.extend(code_actions)
    problem_text, choice_actions = _strip_terminal_choice_lines(problem_text, choices)
    separation_actions.extend(choice_actions)
    if not code_blocks:
        code_like_lines = sum(
            bool(
                re.search(r"[{};]", line)
                and re.search(
                    r"\b(?:class|struct|public|private|protected|virtual|void|int|double|return|cout|cin|include)\b",
                    line,
                    re.IGNORECASE,
                )
            )
            for line in problem_text.splitlines()
        )
        if code_like_lines >= 3:
            raise ValueError(
                "AI 검수 게이트웨이 proposal leaves a visible code block in problem_text while code is empty."
            )
    try:
        code_positions = [max(0, min(len(problem_text), int(value))) for value in raw_code_positions]
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("AI 검수 게이트웨이 proposal code_positions are invalid.") from error
    if code_positions and len(code_positions) != len(code_blocks):
        raise ValueError("AI 검수 게이트웨이 proposal code_positions must match code length.")
    if code_blocks and not code_positions:
        code_positions = [len(problem_text)] * len(code_blocks)
        separation_actions.append("missing_code_positions_defaulted_to_end")
    try:
        number = int(raw.get("number"))
        confidence = float(raw.get("confidence"))
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("AI 검수 게이트웨이 proposal has invalid number or confidence.") from error
    if number < 1 or number > 9_999:
        raise ValueError("AI 검수 게이트웨이 proposal number is outside the allowed range.")

    proposal = dict(raw)
    proposal["number"] = number
    proposal["problem_text"] = problem_text
    proposal["choices"] = choices
    proposal["code"] = code_blocks
    proposal["code_positions"] = code_positions
    proposal["answer_type"] = answer_type
    proposal["reason"] = str(raw.get("reason") or "").strip()
    proposal["confidence"] = max(0.0, min(1.0, confidence))
    proposal["separation_actions"] = separation_actions
    proposal["auto_apply_eligible"] = "missing_code_positions_defaulted_to_end" not in separation_actions
    paddle_original = problem.get("paddleocr_original")
    source = paddle_original if isinstance(paddle_original, Mapping) else problem
    source_text = str(source.get("problem_text") or "")
    source_text += "".join(str(choice or "") for choice in (source.get("choices") or []))
    source_text += "".join(str(block or "") for block in (source.get("code") or []))
    original_text = "".join(source_text.split())
    proposed_text = "".join(problem_text.split())
    proposed_text += "".join("".join(choice.split()) for choice in choices)
    proposed_text += "".join("".join(block.split()) for block in code_blocks)
    text_coverage = len(proposed_text) / max(1, len(original_text))
    proposal["text_coverage"] = round(text_coverage, 6)
    if text_coverage > MAX_PROPOSAL_EXPANSION:
        raise ValueError(
            "AI 검수 게이트웨이 proposal invents or imports content outside the OCR candidate "
            f"(text expansion {text_coverage:.3f})."
        )
    source_tokens = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}|[가-힣]{2,}|[ぁ-んァ-ヶ一-龥々]{2,}", source_text.casefold()))
    for block in code_blocks:
        block_tokens = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}|[가-힣]{2,}|[ぁ-んァ-ヶ一-龥々]{2,}", block.casefold()))
        required_overlap = max(2, math.ceil(len(block_tokens) * 0.15))
        if len(block_tokens) >= 5 and len(block_tokens & source_tokens) < required_overlap:
            raise ValueError(
                "AI 검수 게이트웨이 proposal contains a code block unsupported by the PaddleOCR candidate."
            )
    start_page = int(problem.get("page") or 1)
    end_page = int(problem.get("page_end") or start_page)
    if end_page > start_page and text_coverage < MIN_SPANNING_TEXT_COVERAGE:
        raise ValueError(
            "AI 검수 게이트웨이 proposal truncates a multi-page candidate "
            f"(text coverage {text_coverage:.3f})."
        )
    # Models can mistake printed book folios for PDF indexes. Routing metadata
    # is not OCR content and must remain stable during automatic application.
    proposal["page"] = int(problem.get("page") or 1)
    proposal["page_end"] = int(problem.get("page_end") or proposal["page"])
    original_answer_type = str(problem.get("answer_type") or "unknown").strip().lower()
    proposal["changed"] = any((
        proposal["number"] != int(problem.get("number") or 1),
        proposal["problem_text"] != str(problem.get("problem_text") or "").strip(),
        proposal["choices"] != [str(choice or "").strip() for choice in (problem.get("choices") or []) if str(choice or "").strip()],
        proposal["code"] != [str(block or "") for block in (problem.get("code") or []) if str(block or "").strip()],
        proposal["code_positions"] != [int(position) for position in (problem.get("code_positions") or [])],
        proposal["answer_type"] != original_answer_type,
    ))
    return proposal


def validated_review_resolution_content(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize a user-edited queue result with same strict field boundaries as models."""
    if not isinstance(raw, Mapping):
        raise ValueError("final_content must be an object.")
    missing = sorted({"problem_text", "choices", "code", "answer_type"}.difference(raw.keys()))
    if missing:
        raise ValueError(f"final_content is missing required fields: {', '.join(missing)}")
    problem_text = str(raw.get("problem_text") or "").strip()
    if not problem_text:
        raise ValueError("final_content.problem_text is empty.")
    choices = _normalized_choices(raw.get("choices"))
    code = _normalized_code_blocks(raw.get("code"))
    problem_text, _code_actions = _strip_exact_code_lines(problem_text, code)
    problem_text, _choice_actions = _strip_terminal_choice_lines(problem_text, choices)
    answer_type = str(raw.get("answer_type", "") or "").strip()
    if answer_type not in VALID_ANSWER_TYPES:
        raise ValueError("final_content.answer_type is invalid.")
    raw_positions = raw.get("code_positions", [])
    if not isinstance(raw_positions, list):
        raise ValueError("final_content.code_positions must be an array.")
    try:
        code_positions = [max(0, min(len(problem_text), int(value))) for value in raw_positions]
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("final_content.code_positions are invalid.") from error
    if code_positions and len(code_positions) != len(code):
        raise ValueError("final_content.code_positions must match code length.")
    if code and not code_positions:
        code_positions = [len(problem_text)] * len(code)
    return {
        "problem_text": problem_text,
        "choices": choices,
        "code": code,
        "code_positions": code_positions,
        "answer_type": answer_type,
    }


def _extract_json_with_diagnostics(text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Parse one complete JSON object, tolerating common markdown/prose wrappers."""
    value = str(text or "").strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[-1]
        closing = value.rfind("```")
        if closing >= 0:
            value = value[:closing].rstrip()
    start = value.find("{")
    if start < 0:
        raise ValueError("AI 검수 게이트웨이 response did not contain JSON proposal.")
    decoder = json.JSONDecoder()
    fragment = value[start:]
    try:
        parsed, consumed = decoder.raw_decode(fragment)
    except json.JSONDecodeError as error:
        if _looks_like_truncated_json(error, fragment):
            raise TruncatedJsonResponseError(
                f"AI 검수 게이트웨이 response JSON is truncated: {error.msg}."
            ) from error
        raise ValueError(f"AI 검수 게이트웨이 response JSON is malformed: {error.msg}.") from error
    if not isinstance(parsed, dict):
        raise ValueError("AI 검수 게이트웨이 proposal must be JSON object.")
    trailing = value[start + consumed:].strip()
    diagnostics = {}
    if trailing:
        try:
            decoder.raw_decode(trailing)
        except json.JSONDecodeError:
            diagnostics = {
                "ignored_trailing_sha256": hashlib.sha256(trailing.encode("utf-8", errors="replace")).hexdigest(),
                "ignored_trailing_length": len(trailing),
            }
        else:
            raise ValueError("AI 검수 게이트웨이 응답에 JSON 값이 여러 개 포함되어 있습니다.")
    return parsed, diagnostics




def request_batch_proposals(
    *,
    api_key: str,
    model: str,
    problems: list[Mapping[str, Any]],
    images: list[bytes],
    page_numbers: list[int] | None = None,
    timeout: int = 90,
    endpoint: str = GATEWAY_ENDPOINT,
    language: str = "korean",
) -> dict[str, Any]:
    import urllib.request
    language = normalize_app_language(language)
    if not _supported_request_model(model):
        raise ValueError("지원하지 않는 AI 검수 게이트웨이 모델입니다.")
    if not api_key:
        raise RuntimeError("Vercel AI Gateway API Key가 필요합니다.")
    endpoint = endpoint or GATEWAY_ENDPOINT
    if not problems or not images:
        raise ValueError("검수할 문제와 페이지 이미지가 필요합니다.")
    # Do not request reasoning/thinking.  Both benchmark candidates must receive
    # identical non-reasoning image prompts so latency and cost stay comparable.
    content = [{"type": "text", "text": _batch_prompt(problems, page_numbers, language)}]
    content.extend({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode("ascii")}} for image in images)
    body = {
        "model": model,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "ails_page_batch_problem_proposals",
                "strict": True,
                "schema": page_batch_response_schema(),
            },
        },
        "messages": [{"role": "user", "content": content}],
    }
    import managed_direct
    body, _direct = managed_direct.prepare_request(api_key, endpoint, model, body)
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode("utf-8"), headers={"Authorization": f"Bearer {managed_direct.provider_key(api_key)}", "Content-Type": "application/json", "HTTP-Referer": "https://ails.local", "X-Title": "AILS PDF OCR review"}, method="POST")
    started = time.monotonic()
    usage: dict[str, Any] = {}
    response_id = ""
    response_content = ""
    try:
        direct_request_id = managed_direct.record_dispatch(api_key, model)
        import provider_credentials
        open_request = provider_credentials.open_without_redirects if _direct else urllib.request.urlopen
        with open_request(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8")
        try:
            payload = json.loads(response_body)
            managed_direct.record_generation(api_key, direct_request_id, payload)
        except json.JSONDecodeError as error:
            raise GatewayResponseError(
                f"AI 검수 게이트웨이 응답이 JSON이 아닙니다.: {error.msg}.",
                latency_ms=round((time.monotonic() - started) * 1000),
                content=response_body,
            ) from error
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"AI 검수 게이트웨이 요청 실패: HTTP {error.code}") from error
    if not isinstance(payload, Mapping):
        raise GatewayResponseError(
            "AI 검수 게이트웨이 response envelope must be an object.",
            latency_ms=round((time.monotonic() - started) * 1000),
        )
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
    response_id = payload.get("id", "")
    response_content = ""
    try:
        choice = ((payload.get("choices") or [{}])[0].get("message") or {})
        response_content = choice.get("content", "") if isinstance(choice, Mapping) else ""
        parsed, response_diagnostics = _extract_json_with_diagnostics(response_content)
        proposals = parsed.get("proposals")
        if not isinstance(proposals, list):
            raise ValueError("AI 검수 게이트웨이 response must contain proposals array.")
        expected_ids = [str(problem.get("id", "")) for problem in problems]
        response_ids = [str(item.get("id", "")) for item in proposals if isinstance(item, Mapping)]
        if len(response_ids) != len(proposals) or sorted(response_ids) != sorted(expected_ids):
            raise ValueError("AI 검수 게이트웨이 response did not map exactly one proposal to every candidate id.")
    except GatewayResponseError:
        raise
    except TruncatedJsonResponseError as error:
        raise GatewayResponseError(
            f"Model batch response failed: {error}",
            usage=usage,
            response_id=response_id,
            latency_ms=round((time.monotonic() - started) * 1000),
            content=response_content,
            response_truncated=True,
        ) from error
    except (TypeError, ValueError, IndexError, KeyError) as error:
        raise GatewayResponseError(
            f"Model batch response failed: {error}",
            usage=usage,
            response_id=response_id,
            latency_ms=round((time.monotonic() - started) * 1000),
            content=response_content,
        ) from error
    by_id = {str(item.get("id", "")): item for item in proposals if isinstance(item, Mapping)}
    validated = {}
    validation_errors = {}
    for problem_id, problem in zip(expected_ids, problems):
        try:
            validated[problem_id] = _validated_proposal(by_id[problem_id], problem)
        except (TypeError, ValueError) as error:
            # One malformed candidate must not discard other valid candidates
            # from the same paid page-batch response. The raw proposal remains
            # audit evidence and this candidate is ineligible for auto-apply.
            validation_errors[problem_id] = str(error)
    return {
        "proposals": validated,
        "raw_proposals": {problem_id: dict(by_id[problem_id]) for problem_id in expected_ids},
        "validation_errors": validation_errors,
        "usage": usage,
        "latency_ms": round((time.monotonic() - started) * 1000),
        "response_id": response_id,
        "response_diagnostics": response_diagnostics,
        "cost_accounting_complete": _has_usable_response_cost(usage),
    }




def render_page_batch_images(pdf_path: str, problems: list[Mapping[str, Any]], *, dpi: int = 180) -> tuple[list[bytes], str, list[int]]:
    """Render shared candidate pages, including every declared continuation page."""
    try:
        import fitz  # PyMuPDF
    except ImportError as error:
        raise RuntimeError("PDF 문제 이미지 검수에는 PyMuPDF가 필요합니다.") from error
    start_page = max(1, min(int(problem.get("page") or 1) for problem in problems))
    page_numbers = {start_page}
    for problem in problems:
        problem_start = max(1, int(problem.get("page") or start_page))
        problem_end = max(problem_start, int(problem.get("page_end") or problem_start))
        # A problem can continue onto the next PDF page. Include complete
        # ranges for every candidate, not only the first candidate's range.
        page_numbers.update(range(problem_start, problem_end + 1))
    requested_pages = sorted(page_numbers)
    doc = fitz.open(pdf_path)
    try:
        if requested_pages[-1] > len(doc):
            raise ValueError("검수할 PDF 페이지가 문서 범위를 벗어났습니다.")
        scale = max(1.0, min(4.0, dpi / 72.0))
        rendered = []
        for page_no in requested_pages:
            pix = doc[page_no - 1].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            rendered.append(pix.tobytes("png"))
        return rendered, "image/png", requested_pages
    finally:
        doc.close()




def review_page_batch(*, base_dir: str, pdf_path: str, problems: list[Mapping[str, Any]], api_key: str, model: str, endpoint: str = GATEWAY_ENDPOINT, language: str = "korean") -> dict[str, dict[str, Any]]:
    """One AI 검수 게이트웨이 request per start page; write independent audit records."""
    language = normalize_app_language(language)
    images, mime, pages = render_page_batch_images(pdf_path, problems)
    result = request_batch_proposals(
        api_key=api_key,
        model=model,
        problems=problems,
        images=images,
        page_numbers=pages,
        endpoint=endpoint,
        language=language,
    )
    batch_id = hashlib.sha256((str(pages) + model + str(time.time())).encode("utf-8")).hexdigest()[:20]
    image_hashes = [hashlib.sha256(image).hexdigest() for image in images]
    total_cost = float((result["usage"] or {}).get("cost") or 0.0)
    allocated_cost = total_cost / len(problems)
    records: dict[str, dict[str, Any]] = {}
    for problem in problems:
        problem_id = str(problem.get("id", ""))
        original = {key: value for key, value in problem.items() if not str(key).startswith("review_crop_")}
        usage = dict(result["usage"] or {})
        usage["batch_cost_usd"] = total_cost
        usage["allocated_cost_usd"] = allocated_cost
        record = {"schema_version": 4, "created_at": time.time(), "model": model, "problem_id": problem_id,
                  "original": original, "proposal": result["proposals"].get(problem_id),
                  "raw_proposal": result["raw_proposals"][problem_id], "usage": usage,
                  "latency_ms": result["latency_ms"], "response_id": result["response_id"], "batch_id": batch_id,
                  "batch_pages": pages, "page_image_sha256": image_hashes, "crop_mime": mime,
                  "response_diagnostics": dict(result.get("response_diagnostics") or {}),
                  "call_made": True,
                  "cost_accounting_complete": bool(result.get("cost_accounting_complete", False)),
                  "validation_error": (result.get("validation_errors") or {}).get(problem_id, ""),
                  "application_status": "proposed", "applied": False}
        _write_review_record(base_dir, pdf_path, problem_id, model, record)
        records[problem_id] = record
    return records


def mark_review_applied(
    base_dir: str,
    pdf_path: str,
    record: Mapping[str, Any],
    problem: Mapping[str, Any],
) -> dict[str, Any]:
    updated = dict(record)
    updated["application_status"] = "applied"
    updated["applied"] = True
    updated["applied_at"] = time.time()
    updated["applied_problem"] = dict(problem)
    _write_review_record(
        base_dir,
        pdf_path,
        str(updated.get("problem_id", "")),
        str(updated.get("model", "")),
        updated,
    )
    return updated


def mark_review_application_failed(
    base_dir: str,
    pdf_path: str,
    record: Mapping[str, Any],
    error: BaseException,
) -> dict[str, Any]:
    updated = dict(record)
    updated["application_status"] = "failed"
    updated["applied"] = False
    updated["application_failed_at"] = time.time()
    updated["application_error"] = str(error or "")[:1_000]
    _write_review_record(
        base_dir,
        pdf_path,
        str(updated.get("problem_id", "")),
        str(updated.get("model", "")),
        updated,
    )
    return updated


def mark_review_status(
    base_dir: str,
    pdf_path: str,
    record: Mapping[str, Any],
    status: str,
    reason: str,
    **details: Any,
) -> dict[str, Any]:
    """Append a terminal routing decision without mutating proposal evidence."""
    allowed = {
        "needs_user_review", "superseded", "not_selected",
        "user_selected", "user_not_selected", "response_failed",
    }
    normalized_status = str(status or "").strip()
    if normalized_status not in allowed:
        raise ValueError("Unsupported review application status.")
    updated = dict(record)
    updated["application_status"] = normalized_status
    updated["applied"] = False
    updated["resolution_at"] = time.time()
    updated["resolution_reason"] = str(reason or "")[:1_000]
    updated.update(details)
    _write_review_record(
        base_dir,
        pdf_path,
        str(updated.get("problem_id", "")),
        str(updated.get("model", "")),
        updated,
    )
    return updated


def list_review_queue(base_dir: str, pdf_path: str) -> list[dict[str, Any]]:
    with _queue_lock:
        value = _read(_review_queue_path(base_dir, pdf_path))
    items = value.get("items") if isinstance(value.get("items"), list) else []
    return [dict(item) for item in items if isinstance(item, Mapping)]


def upsert_review_queue_item(
    base_dir: str,
    pdf_path: str,
    item: Mapping[str, Any],
) -> dict[str, Any]:
    problem_id = str(item.get("problem_id", "") or "").strip()
    if not problem_id:
        raise ValueError("Review queue item requires problem_id.")
    queued = dict(item)
    queued["problem_id"] = problem_id
    queued.setdefault("queued_at", time.time())
    queued.setdefault("resolution_history", [])
    queued["status"] = "needs_user_review"
    path = _review_queue_path(base_dir, pdf_path)
    with _queue_lock:
        existing = _read(path)
        previous = next(
            (
                dict(value) for value in (existing.get("items") or [])
                if isinstance(value, Mapping) and str(value.get("problem_id", "")) == problem_id
            ),
            {},
        )
        if previous:
            queued["queued_at"] = previous.get("queued_at") or queued.get("queued_at")
            queued["resolution_history"] = [
                dict(value) for value in (previous.get("resolution_history") or [])
                if isinstance(value, Mapping)
            ]
        items = [
            dict(value)
            for value in (existing.get("items") or [])
            if isinstance(value, Mapping) and str(value.get("problem_id", "")) != problem_id
        ]
        items.append(queued)
        items.sort(key=lambda value: float(value.get("queued_at") or 0.0))
        _write(path, {"schema_version": 1, "items": items, "updated_at": time.time()})
    return queued


def remove_review_queue_item(base_dir: str, pdf_path: str, problem_id: str) -> None:
    wanted = str(problem_id or "").strip()
    if not wanted:
        return
    path = _review_queue_path(base_dir, pdf_path)
    with _queue_lock:
        existing = _read(path)
        items = [
            dict(value)
            for value in (existing.get("items") or [])
            if isinstance(value, Mapping) and not (
                str(value.get("problem_id", "")) == wanted
                and str(value.get("status", "")) != "resolved"
            )
        ]
        if len(items) != len(existing.get("items") or []):
            _write(path, {"schema_version": 1, "items": items, "updated_at": time.time()})


def record_review_queue_resolution(
    base_dir: str,
    pdf_path: str,
    problem_id: str,
    resolution: Mapping[str, Any],
) -> dict[str, Any]:
    """Append user-resolution evidence while retaining the queue item for re-editing."""
    wanted = str(problem_id or "").strip()
    if not wanted:
        raise ValueError("Review queue resolution requires problem_id.")
    entry = dict(resolution)
    entry.setdefault("recorded_at", time.time())
    entry["problem_id"] = wanted
    entry["resolution_id"] = str(
        entry.get("resolution_id")
        or hashlib.sha256(
            f"{wanted}\0{time.time_ns()}\0{os.getpid()}".encode("utf-8")
        ).hexdigest()[:24]
    )
    status = str(entry.get("status", "") or "").strip()
    if status not in {"requested", "applied", "failed"}:
        raise ValueError("Unsupported queue resolution status.")

    path = _review_queue_path(base_dir, pdf_path)
    with _queue_lock:
        existing = _read(path)
        items = [dict(value) for value in (existing.get("items") or []) if isinstance(value, Mapping)]
        index = next(
            (index for index, value in enumerate(items) if str(value.get("problem_id", "")) == wanted),
            None,
        )
        if index is None:
            raise KeyError("Review queue item was not found.")
        item = dict(items[index])
        history = [dict(value) for value in (item.get("resolution_history") or []) if isinstance(value, Mapping)]
        history.append(entry)
        item["resolution_history"] = history
        item["last_resolution"] = entry
        if status == "applied":
            item["status"] = "resolved"
            item["selected_source"] = str(entry.get("selected_source", "") or "")
            item["resolved_at"] = entry["recorded_at"]
            item["final_content"] = dict(entry.get("final_content") or {})
        elif status == "failed":
            item["status"] = "needs_user_review"
            item["resolution_error"] = str(entry.get("error", "") or "")[:1_000]
        items[index] = item
        _write(path, {"schema_version": 2, "items": items, "updated_at": time.time()})

        history_dir = _review_queue_history_dir(base_dir, pdf_path)
        history_dir.mkdir(parents=True, exist_ok=True)
        history_path = history_dir / f"{entry['resolution_id']}-{status}.json"
        _write(history_path, {
            "schema_version": 1,
            "queue_item_snapshot": item,
            "resolution": entry,
        })
    return item


def get_review(base_dir: str, pdf_path: str, problem_id: str, model: str = "") -> dict[str, Any]:
    return _read(_audit_path(base_dir, pdf_path, problem_id, model))


def list_gold_samples(base_dir: str, pdf_path: str) -> list[dict[str, Any]]:
    value = _read(_benchmark_path(base_dir, pdf_path))
    samples = value.get("samples") if isinstance(value.get("samples"), list) else []
    return [dict(sample) for sample in samples if isinstance(sample, Mapping)]


def save_gold_sample(base_dir: str, pdf_path: str, problem: Mapping[str, Any]) -> dict[str, Any]:
    """Store only user-confirmed current catalog content; never infer gold truth."""
    samples = list_gold_samples(base_dir, pdf_path)
    sample = {
        "problem_id": str(problem.get("id", "")),
        "saved_at": time.time(),
        "human_confirmed": True,
        "truth": {
            key: problem.get(key)
            for key in ("number", "page", "page_end", "problem_text", "choices", "code", "code_positions", "answer_type", "kind")
        },
    }
    samples = [item for item in samples if item.get("problem_id") != sample["problem_id"]]
    if len(samples) >= 40:
        raise ValueError("정답 기준 표본은 최대 40개입니다.")
    samples.append(sample)
    _write(_benchmark_path(base_dir, pdf_path), {"schema_version": 1, "samples": samples})
    return {"sample": sample, "count": len(samples), "target_count": 40}


def choose_model(results: list[Mapping[str, Any]]) -> str:
    """Gemini wins exact tie unless it has more critical errors."""
    grouped: dict[str, list[Mapping[str, Any]]] = {LUNA_MEDIUM: []}
    for item in results:
        raw_model = str(item.get("model", "") or "")
        if raw_model == LUNA_MEDIUM:
            grouped[LUNA_MEDIUM].append(item)
            continue
        try:
            model = normalize_gemini_flash_lite_model(raw_model)
        except ValueError:
            continue
        grouped.setdefault(model, []).append(item)
    def score(model: str) -> tuple[float, int]:
        rows = grouped.get(model, [])
        if not rows: return (-1.0, 10**9)
        return (sum(float(row.get("exact_match", 0)) for row in rows) / len(rows), sum(int(row.get("critical_errors", 0)) for row in rows))
    gemini_models = [model for model in grouped if model != LUNA_MEDIUM]
    if not gemini_models:
        return LUNA_MEDIUM
    gemini_model = max(gemini_models, key=lambda model: (score(model)[0], -score(model)[1], model))
    gemini, luna = score(gemini_model), score(LUNA_MEDIUM)
    return gemini_model if gemini[0] >= luna[0] and gemini[1] <= luna[1] else LUNA_MEDIUM


# api_server에서 이동: 검수 라우트 모델 목록
MANAGED_REVIEW_MODELS = (PRIMARY_REVIEW_MODEL, SECONDARY_REVIEW_MODEL, FALLBACK_REVIEW_MODEL)
