"""챗봇 문맥 예산·캐시 친화 조립 헬퍼.

순수 함수만 제공한다(네트워크·DB 접근 없음). 토큰 수치는 context_composer의
보수적 한글 추정기를 공유하며, 모든 기본값은 설정으로 줄일 수 있고 0은
해당 섹션 비활성화를 뜻한다.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any

from chat.context_composer import estimate_tokens, truncate_to_tokens
from chat.material_tool_context import reduce_material_list
from ai_request_limits import AI_REQUEST_MAX_INPUT_TOKENS
from chat.research_context import reduce_research_result
from chat.research_tool_schemas import RESEARCH_TOOL_NAMES

CHATBOT_PROFILE_HOME = "home"
CHATBOT_PROFILE_DOCUMENT = "document"

# 입력 기본 상한(추정 토큰). 도구 스키마·호출 인자·결과·직렬화 오버헤드까지 합산한다.
CHATBOT_DEFAULT_INPUT_BUDGET_TOKENS = {
    CHATBOT_PROFILE_HOME: 4096,
    CHATBOT_PROFILE_DOCUMENT: 6144,
}
# 필수 입력이 기본 상한을 넘을 때만 여기까지 확장한다.
CHATBOT_MAX_INPUT_TOKENS = AI_REQUEST_MAX_INPUT_TOKENS
CHATBOT_OUTPUT_RESERVE_TOKENS = 2048
CHATBOT_CONTEXT_HEADROOM_TOKENS = 512

# 동적 문맥 섹션 기본 상한. context_budgets 설정값이 더 작으면 그 값을 존중하고 0이면 끈다.
CHATBOT_SECTION_DEFAULT_TOKENS = {
    "recent_conversation": 1200,
    "user_memory": 300,
    "agent_state": 200,
    "document_rag": 1800,
}

# 도구 결과 예산: 현재(마지막) 라운드 합계와 이전 라운드 상태 합계.
CHATBOT_CURRENT_ROUND_RESULT_BUDGET_TOKENS = 1500
CHATBOT_HISTORY_ROUND_RESULT_BUDGET_TOKENS = 300

# 최초 문서 검색 발췌 개수.
CHATBOT_RAG_TOP_K = 5
CHATBOT_RAG_TYPICAL_TOKENS = 1200
CHATBOT_RAG_EXCERPT_MAX_TOKENS = 600

# 메시지 직렬화(role·구분자·프레이밍) 오버헤드와 동적 문맥 라벨 예비분.
CHATBOT_SERIALIZATION_OVERHEAD_TOKENS = 64
CHATBOT_DYNAMIC_LABEL_RESERVE_TOKENS = 96

# turn 조립 캐시: 최대 32건, TTL 10분, LRU 제거.
CHATBOT_TURN_CACHE_MAX_ENTRIES = 32
CHATBOT_TURN_CACHE_TTL_SECONDS = 600.0

_CONTEXT_BUDGET_EXCEEDED_CODE = "context_budget_exceeded"


class ContextBudgetExceeded(ValueError):
    """필수 입력만으로 최대 입력 상한을 넘어 모델 호출 전에 중단한다."""

    code = _CONTEXT_BUDGET_EXCEEDED_CODE

    def __init__(self, message: str):
        super().__init__(message)


def section_budget(section: str, config_budgets: Any) -> int:
    """설정값이 있으면 기본 상한과 min, 0이면 비활성화한다."""

    default = int(CHATBOT_SECTION_DEFAULT_TOKENS.get(section, 0))
    if isinstance(config_budgets, Mapping) and section in config_budgets:
        try:
            configured = int(config_budgets.get(section))
        except (TypeError, ValueError):
            return default
        if configured < 0:
            return 0
        return min(configured, default)
    return default


def input_budget_limits(profile: str, model_context_limit: int | None) -> dict[str, int]:
    """기본 상한과 모델 한도 기반 하드 캡을 계산한다."""

    default = int(CHATBOT_DEFAULT_INPUT_BUDGET_TOKENS.get(profile) or CHATBOT_DEFAULT_INPUT_BUDGET_TOKENS[CHATBOT_PROFILE_HOME])
    hard_cap = CHATBOT_MAX_INPUT_TOKENS
    if model_context_limit and int(model_context_limit) > 0:
        hard_cap = min(hard_cap, int(model_context_limit) - CHATBOT_OUTPUT_RESERVE_TOKENS - CHATBOT_CONTEXT_HEADROOM_TOKENS)
    hard_cap = max(1, hard_cap)
    return {
        "default": max(1, min(default, hard_cap)),
        "hard_cap": hard_cap,
    }


def tool_schema_tokens(tool_schemas: list[dict] | None) -> int:
    """도구 스키마의 결정적 직렬화 추정 토큰."""

    if not tool_schemas:
        return 0
    return estimate_tokens(json.dumps(tool_schemas, ensure_ascii=False, separators=(",", ":")))


def select_rag_excerpts(question: str, chunks: list[Mapping], budget_tokens: int, *, selected_chunks: list | None = None) -> list[str]:
    """Use enough ranked evidence for the question without repeating chunk overlap."""
    if budget_tokens <= 0:
        return []
    comparative = bool(re.search(r"비교|차이|공통|각각|종합|대조|compare|difference|both", question, re.I))
    candidates = [chunk for chunk in chunks[:CHATBOT_RAG_TOP_K] if isinstance(chunk, Mapping) and str(chunk.get("text") or "").strip()]
    if not candidates:
        return []
    reranked = all(chunk.get("score_type") == "reranker" for chunk in candidates)
    try:
        first_score = float(candidates[0].get("score"))
        second_score = float(candidates[1].get("score")) if len(candidates) > 1 else 0.0
    except (TypeError, ValueError):
        first_score = second_score = 0.0
    first_text = str(candidates[0].get("text") or "")
    question_terms = []
    for raw_term in re.findall(r"[가-힣A-Za-z0-9]{2,}", question):
        term = raw_term.rstrip("은는이가을를의와과에서")
        if len(term) >= 2 and term not in {"설명", "설명해", "설명해줘", "알려줘", "요약", "요약해줘", "무엇인가", "어떻게", "please", "explain"}:
            question_terms.append(term)
    first_sufficient = (
        first_score >= 0.65
        and estimate_tokens(first_text) >= 250
        and bool(question_terms)
        and all(term in first_text for term in question_terms)
    )
    if not reranked and not comparative and (first_sufficient or (first_score >= 0.65 and second_score <= first_score * 0.8)):
        candidates = candidates[:1]
    elif not reranked and not comparative:
        candidates = candidates[:2]
    remaining = min(budget_tokens, 1800 if (comparative or reranked) else CHATBOT_RAG_TYPICAL_TOKENS)
    excerpts: list[str] = []
    previous_texts: list[str] = []
    for candidate_index, chunk in enumerate(candidates):
        text = str(chunk.get("text") or "").strip()
        if any(text in previous or previous in text for previous in previous_texts):
            continue
        for previous in previous_texts:
            # Search chunks overlap at their edges; preserve only new evidence.
            for width in range(min(len(previous), len(text)), 49, -1):
                if previous.endswith(text[:width]):
                    text = text[width:].lstrip()
                    break
        if not text:
            continue
        try:
            page = int(chunk.get("page") or 0)
        except (TypeError, ValueError):
            page = 0
        label = f"[{page}페이지] " if page > 0 else "[발췌] "
        allowance = min(CHATBOT_RAG_EXCERPT_MAX_TOKENS, remaining)
        if reranked:
            # Do not starve ranks 4/5 with the old 1-2 passage heuristic. Spread
            # the existing section budget; model context limits remain intact.
            allowance = min(allowance, remaining // (len(candidates) - candidate_index))
        if allowance <= estimate_tokens(label):
            break
        # Whole paragraphs are preferred when the source provides boundaries.
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
        kept: list[str] = []
        for paragraph in paragraphs:
            proposal = "\n\n".join([*kept, paragraph])
            if estimate_tokens(label + proposal) <= allowance:
                kept.append(paragraph)
            else:
                if not kept:
                    kept.append(truncate_to_tokens(paragraph, allowance - estimate_tokens(label)))
                break
        body = "\n\n".join(kept).strip()
        if not body:
            continue
        excerpt = label + body
        excerpts.append(excerpt)
        if selected_chunks is not None:
            selected_chunks.append(chunk)
        remaining -= estimate_tokens(excerpt)
        previous_texts.append(str(chunk.get("text") or "").strip())
    return excerpts


def tool_rounds_tokens(rounds: list[dict]) -> int:
    """도구 호출/결과 직렬화(오버헤드 포함) 추정 토큰."""

    if not rounds:
        return 0
    return estimate_tokens(json.dumps(rounds, ensure_ascii=False, separators=(",", ":")))


def fit_history_messages(
    history: Any,
    budget_tokens: int,
) -> tuple[list[dict], int]:
    """이전 대화를 user/assistant 메시지로 보존하고 예산을 넘으면 오래된 것부터 제거한다.

    반환값은 (유지된 메시지, 제거된 메시지 수)이며 메시지 순서는 입력과 같다.
    최신 메시지 하나가 예산보다 크면 그 메시지만 토큰 절단한다.
    """

    messages: list[dict] = []
    for item in history if isinstance(history, list) else []:
        if not isinstance(item, Mapping):
            continue
        role = str(item.get("role") or "").strip()
        if role not in {"user", "assistant"}:
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        messages.append({"role": role, "content": content})
    if budget_tokens <= 0:
        return [], len(messages)
    kept: list[dict] = []
    used = 0
    dropped = 0
    for message in reversed(messages):
        cost = estimate_tokens(message["content"])
        if cost > budget_tokens:
            if not kept:
                content = truncate_to_tokens(message["content"], budget_tokens)
                kept.append({"role": message["role"], "content": content})
                continue
            dropped += 1
            continue
        if used + cost > budget_tokens:
            dropped += 1
            continue
        kept.append(message)
        used += cost
    kept.reverse()
    return kept, dropped


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _loads_json(text: str):
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def _unwrap_search_payload(name: str, parsed: Any):
    """search_context 결과는 renderer가 result로 감싸기도 하므로 벗겨낸다."""

    if name not in {"search_context", "list_materials"} or not isinstance(parsed, Mapping):
        return parsed
    nested = parsed.get("result")
    if isinstance(nested, str):
        nested = _loads_json(nested.strip())
    if isinstance(nested, Mapping) and ("chunks" in nested or "status" in nested or "materials" in nested):
        merged = dict(nested)
        for key in ("ok",):
            if key in parsed and key not in merged:
                merged[key] = parsed[key]
        return merged
    return parsed


def _reduce_search_result(parsed: Mapping, budget_tokens: int) -> dict:
    reduced: dict[str, Any] = {}
    for key in ("ok", "status", "document_id"):
        if key in parsed:
            reduced[key] = parsed[key]
    chunks = [chunk for chunk in (parsed.get("chunks") or []) if isinstance(chunk, Mapping)]
    reduced["chunks"] = []
    if not chunks:
        return reduced
    share = max(0, (budget_tokens - 32) // len(chunks))
    for chunk in chunks:
        entry: dict[str, Any] = {}
        for key in ("id", "page", "section", "score"):
            if key in chunk:
                entry[key] = chunk[key]
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue
        text_budget = max(0, share - estimate_tokens(_dumps(entry)) - 8)
        if text_budget <= 0:
            entry["truncated"] = True
            reduced["chunks"].append(entry)
            continue
        clipped = truncate_to_tokens(text, text_budget)
        if clipped and estimate_tokens(clipped) < estimate_tokens(text):
            entry["truncated"] = True
        if clipped:
            entry["text"] = clipped
        reduced["chunks"].append(entry)
    return reduced


def _reduce_json_result(parsed: Mapping, budget_tokens: int) -> dict:
    priority = ("ok", "status", "error", "id", "control_id")
    reduced: dict[str, Any] = {}
    used = 0
    for key in priority:
        if key in parsed:
            reduced[key] = parsed[key]
            used += estimate_tokens(key) + estimate_tokens(_dumps(parsed[key]))
    for key, value in parsed.items():
        if key in priority:
            continue
        cost = estimate_tokens(key) + estimate_tokens(_dumps(value))
        if used + cost <= budget_tokens:
            reduced[key] = value
            used += cost
            continue
        if isinstance(value, str) and value.strip():
            share = max(0, budget_tokens - used - 16)
            clipped = truncate_to_tokens(value, share) if share > 0 else ""
            if clipped:
                reduced[key] = clipped
                reduced["truncated"] = True
                used += estimate_tokens(key) + estimate_tokens(clipped) + 16
                continue
        reduced["truncated"] = True
    return reduced


def _reduce_current_result(name: str, content: str, budget_tokens: int) -> tuple[str, bool]:
    """현재 라운드 결과를 예산 안으로 줄인다. JSON 유효성과 ID를 보존한다."""

    text = str(content or "").strip()
    if not text:
        return "", False
    parsed = _loads_json(text)
    parsed = _unwrap_search_payload(name, parsed)
    if name == "list_materials" and isinstance(parsed, Mapping) and "materials" in parsed:
        reduced = reduce_material_list(parsed, budget_tokens)
        return _dumps(reduced), bool(reduced.get("truncated"))
    if name in RESEARCH_TOOL_NAMES and isinstance(parsed, Mapping):
        reduced = reduce_research_result(parsed, budget_tokens)
        return _dumps(reduced), bool(reduced.get("truncated"))
    if isinstance(parsed, Mapping) and ("chunks" in parsed or name == "search_context"):
        reduced = _reduce_search_result(parsed, budget_tokens)
    elif isinstance(parsed, Mapping):
        reduced = _reduce_json_result(parsed, budget_tokens)
    else:
        if estimate_tokens(text) <= budget_tokens:
            return text, False
        clipped = truncate_to_tokens(text, max(0, budget_tokens - 8))
        return (f"{clipped}\n[truncated]" if clipped else "[truncated]"), True
    rendered = _dumps(reduced)
    if estimate_tokens(rendered) <= budget_tokens:
        return rendered, bool(reduced.get("truncated"))
    share = max(0, budget_tokens - 16)
    clipped = truncate_to_tokens(rendered, share)
    return (f"{clipped}" if clipped else '{"truncated": true}'), True


def _history_state_content(name: str, content: str) -> str:
    """이전 라운드 결과는 수행 동작·실패 여부만 남긴다(중복 원문 제거)."""

    text = str(content or "").strip()
    parsed = _loads_json(text)
    parsed = _unwrap_search_payload(name, parsed)
    if name == "list_materials" and isinstance(parsed, Mapping) and "materials" in parsed:
        return _dumps(reduce_material_list(parsed, 200))
    if name in RESEARCH_TOOL_NAMES and isinstance(parsed, Mapping):
        return _dumps(reduce_research_result(parsed, 150))
    if isinstance(parsed, Mapping):
        state: dict[str, Any] = {}
        if "chunks" in parsed or name == "search_context":
            state["status"] = str(parsed.get("status") or "ready")
            pages = []
            for chunk in parsed.get("chunks") or []:
                if isinstance(chunk, Mapping):
                    try:
                        page = int(chunk.get("page") or 0)
                    except (TypeError, ValueError):
                        page = 0
                    if page > 0 and page not in pages:
                        pages.append(page)
            state["pages"] = pages[:12]
        elif "ok" in parsed:
            state["ok"] = bool(parsed.get("ok"))
        elif "status" in parsed:
            state["status"] = str(parsed.get("status") or "")
        else:
            state["ok"] = True
        error = str(parsed.get("error") or "").strip()
        if error:
            state["error"] = truncate_to_tokens(error, 40)
        return _dumps(state)
    if not text:
        return '{"ok": true}'
    return truncate_to_tokens(text, 40)


def reduce_tool_rounds_for_model(
    tool_rounds: Any,
    *,
    current_budget_tokens: int = CHATBOT_CURRENT_ROUND_RESULT_BUDGET_TOKENS,
    history_budget_tokens: int = CHATBOT_HISTORY_ROUND_RESULT_BUDGET_TOKENS,
) -> tuple[list[dict], dict[str, int]]:
    """모델에 보내는 도구 라운드를 예산에 맞게 축소한다.

    호출(call) 쪽은 건드리지 않고 결과(content)만 줄인다. 호출/결과 짝과
    JSON 유효성은 유지되며, 제거된 발췌는 ``truncated``로 표시된다.
    """

    rounds = [round_value for round_value in tool_rounds if isinstance(round_value, Mapping)] if isinstance(tool_rounds, list) else []
    rounds = rounds[-5:]
    tokens_before = 0
    tokens_after = 0
    truncated_count = 0
    reduced_rounds: list[dict] = []
    history_budget = max(0, history_budget_tokens)
    history_used = 0
    for index, round_value in enumerate(rounds):
        calls = [call for call in (round_value.get("calls") or []) if isinstance(call, Mapping)]
        call_names = {str(call.get("id") or ""): str(call.get("name") or "") for call in calls}
        is_current = index == len(rounds) - 1
        reduced_results = []
        round_before = 0
        round_after = 0
        for result in round_value.get("results") or []:
            if not isinstance(result, Mapping):
                continue
            call_id = str(result.get("tool_call_id") or "")
            name = call_names.get(call_id, "")
            content = str(result.get("content") or "")
            round_before += estimate_tokens(content)
            if is_current:
                remaining = max(0, current_budget_tokens - round_after)
                reduced, was_truncated = _reduce_current_result(name, content, remaining)
            else:
                state = _history_state_content(name, content)
                cost = estimate_tokens(state)
                if history_used + cost > history_budget:
                    state = '{"truncated": true}'
                    cost = estimate_tokens(state)
                    was_truncated = True
                else:
                    history_used += cost
                    was_truncated = cost < estimate_tokens(content)
                reduced = state
            round_after += estimate_tokens(reduced)
            if was_truncated:
                truncated_count += 1
            reduced_results.append({"tool_call_id": call_id, "content": reduced})
        tokens_before += round_before
        tokens_after += round_after
        reduced_rounds.append({"calls": list(calls), "results": reduced_results})
    stats = {
        "rounds": len(reduced_rounds),
        "tool_result_tokens_before": tokens_before,
        "tool_result_tokens_after": tokens_after,
        "truncated_tool_results": truncated_count,
    }
    return reduced_rounds, stats


def excerpt_overlaps_selection(excerpt: str, selection: str) -> bool:
    """선택 문맥과 중복되는 발췌인지 검사한다(정규화 부분 일치)."""

    def normalize(value: str) -> str:
        return "".join(str(value or "").split())

    a = normalize(excerpt)
    b = normalize(selection)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    probe = a[:60]
    return len(probe) >= 24 and probe in b


def turn_fingerprint(parts: Mapping[str, Any]) -> str:
    """턴 조립 재사용 판정용 fingerprint(설정·초기 요청 격리)."""

    canonical = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ChatbotTurnCache:
    """한 질문(턴)의 기본 메시지 조립 결과를 재사용하는 인메모리 LRU 캐시."""

    def __init__(
        self,
        *,
        max_entries: int = CHATBOT_TURN_CACHE_MAX_ENTRIES,
        ttl_seconds: float = CHATBOT_TURN_CACHE_TTL_SECONDS,
        clock=time.monotonic,
    ):
        self._max_entries = max(1, int(max_entries))
        self._ttl_seconds = float(ttl_seconds)
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def lookup(self, turn_id: str, fingerprint: str) -> dict[str, Any] | None:
        if not turn_id:
            return None
        with self._lock:
            entry = self._entries.get(turn_id)
            if entry is None:
                return None
            if self._clock() - entry["stored_at"] > self._ttl_seconds:
                del self._entries[turn_id]
                return None
            if entry["fingerprint"] != fingerprint:
                del self._entries[turn_id]
                return None
            self._entries.move_to_end(turn_id)
            return entry

    def store(
        self,
        turn_id: str,
        fingerprint: str,
        *,
        messages: list[dict],
        assembly: Mapping[str, Any],
    ) -> None:
        if not turn_id:
            return
        with self._lock:
            self._entries[turn_id] = {
                "fingerprint": fingerprint,
                "messages": messages,
                "assembly": dict(assembly),
                "stored_at": self._clock(),
            }
            self._entries.move_to_end(turn_id)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)
