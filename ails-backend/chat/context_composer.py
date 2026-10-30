"""Budget 기반 AI context 조립.

모든 AI 요청 경로가 공유하는 토큰 예산 계산기. 숫자는 기본값일 뿐이며
설정(``context_budgets``, ``model_context_limit_tokens``)으로 전부 조정할 수 있다.

우선순위(높음 → 낮음):
    1. system            System / Agent instructions
    2. question          현재 사용자 질문
    3. document_rag      현재 문서 및 RAG 결과
    4. agent_state       현재 Agent 작업 상태
    5. user_memory       관련 User Memory (검색 결과만)
    6. recent_conversation  최근 대화
    7. older_conversation   오래된 대화

"기억은 계속 쌓이지만 한 요청에 모델이 보는 기억은 항상 작다" 원칙을 위해
모듈은 순수 함수만 제공한다(네트워크·DB 접근 없음).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence
from ai_request_limits import AI_REQUEST_MAX_INPUT_TOKENS

SECTION_ORDER: tuple[str, ...] = (
    "system",
    "question",
    "document_rag",
    "agent_state",
    "user_memory",
    "recent_conversation",
    "older_conversation",
)

# 토큰 기본값. 설정 파일의 context_budgets 키로 전부 대체 가능하다.
DEFAULT_CONTEXT_BUDGETS: dict[str, int] = {
    "system": 1500,
    "question": 4000,
    "document_rag": 7000,
    "agent_state": 2000,
    "user_memory": 1500,
    "recent_conversation": 3000,
    "older_conversation": 1000,
}

DEFAULT_MODEL_CONTEXT_LIMIT_TOKENS = AI_REQUEST_MAX_INPUT_TOKENS
# 응답 토큰과 추정 오차를 위한 안전 여유.
CONTEXT_LIMIT_SAFETY_RATIO = 0.9

_CJK_RANGES: tuple[tuple[int, int], ...] = (
    (0x1100, 0x11FF),  # Hangul Jamo
    (0x2E80, 0x9FFF),  # CJK Radicals · Kangxi · CJK Unified
    (0xAC00, 0xD7A3),  # Hangul Syllables
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
    (0xFF00, 0xFFEF),  # Full-width Forms
)

_WS_RE = re.compile(r"\s+")


def estimate_tokens(text: Any) -> int:
    """한국어 위주 텍스트의 보수적 토큰 추정.

    CJK(한글 포함) 1자 ≈ 1 토큰으로 세고 나머지 문자는 4자 ≈ 1 토큰으로 센다.
    과소 추정보다 과대 추정이 안전하므로 절삭 없이 올림만 적용한다.
    """

    value = str(text or "")
    if not value:
        return 0
    cjk = 0
    other = 0
    for char in value:
        code = ord(char)
        if any(start <= code <= end for start, end in _CJK_RANGES):
            cjk += 1
        else:
            other += 1
    return cjk + math.ceil(other / 4)


def normalize_budgets(raw: Any) -> dict[str, int]:
    """설정에서 온 budget 값을 기본값과 병합해 정수 dict로 정규화한다."""

    budgets = dict(DEFAULT_CONTEXT_BUDGETS)
    if isinstance(raw, Mapping):
        for name in SECTION_ORDER:
            if name not in raw:
                continue
            try:
                value = int(raw.get(name))
            except (TypeError, ValueError):
                continue
            if value < 0:
                value = 0
            budgets[name] = value
    return budgets


def resolve_section_budgets(
    budgets: Mapping[str, int] | None,
    model_context_limit: int | None = None,
) -> dict[str, int]:
    """섹션 budget 합이 모델 한도(안전 비율 적용)를 넘으면 비례 축소한다."""

    normalized = normalize_budgets(budgets)
    total = sum(normalized[name] for name in SECTION_ORDER)
    model_context_limit = min(model_context_limit or AI_REQUEST_MAX_INPUT_TOKENS, AI_REQUEST_MAX_INPUT_TOKENS)
    cap = max(1, int(float(model_context_limit) * CONTEXT_LIMIT_SAFETY_RATIO))
    if total <= cap:
        return normalized
    scale = cap / total
    resolved: dict[str, int] = {}
    for name in SECTION_ORDER:
        value = normalized[name]
        resolved[name] = min(value, max(1, math.floor(value * scale))) if value else 0
    return resolved


def truncate_to_tokens(text: Any, limit_tokens: int) -> str:
    """토큰 예산 안으로 문자열을 앞부분부터 절단한다."""

    value = _WS_RE.sub(" ", str(text or "")).strip()
    if limit_tokens <= 0:
        return ""
    if estimate_tokens(value) <= limit_tokens:
        return value
    # CJK 비중이 높을수록 1 토큰 ≈ 1 문자이므로 문자 수를 상한으로 이진 탐색한다.
    low = 0
    high = len(value)
    while low < high:
        mid = (low + high + 1) // 2
        if estimate_tokens(value[:mid]) <= limit_tokens:
            low = mid
        else:
            high = mid - 1
    truncated = value[:low].rstrip()
    return truncated


@dataclass(frozen=True)
class ComposedSection:
    name: str
    text: str
    requested_tokens: int
    used_tokens: int
    truncated: bool


@dataclass(frozen=True)
class ComposedContext:
    sections: dict[str, ComposedSection]
    total_tokens: int
    total_budget: int
    model_context_limit: int | None

    def text(self, name: str) -> str:
        section = self.sections.get(name)
        return section.text if section else ""

    def dropped_names(self) -> list[str]:
        return [name for name, section in self.sections.items() if section.used_tokens == 0 and section.requested_tokens > 0]

    def truncated_names(self) -> list[str]:
        return [name for name, section in self.sections.items() if section.truncated]


def compose_context(
    *,
    budgets: Mapping[str, int] | None,
    sections: Mapping[str, Any],
    model_context_limit: int | None = None,
) -> ComposedContext:
    """영역별 텍스트를 budget 안으로 절단해 ComposedContext로 묶는다."""

    resolved = resolve_section_budgets(budgets, model_context_limit)
    composed: dict[str, ComposedSection] = {}
    total_used = 0
    for name in SECTION_ORDER:
        if name not in sections:
            continue
        raw = _WS_RE.sub(" ", str(sections.get(name) or "")).strip()
        requested = estimate_tokens(raw)
        limit = int(resolved.get(name, 0) or 0)
        if limit <= 0:
            section = ComposedSection(name=name, text="", requested_tokens=requested, used_tokens=0, truncated=requested > 0)
        else:
            text = truncate_to_tokens(raw, limit)
            used = estimate_tokens(text)
            section = ComposedSection(
                name=name,
                text=text,
                requested_tokens=requested,
                used_tokens=used,
                truncated=used < requested,
            )
        composed[name] = section
        total_used += section.used_tokens
    total_budget = sum(int(resolved.get(name, 0) or 0) for name in composed)
    return ComposedContext(
        sections=composed,
        total_tokens=total_used,
        total_budget=total_budget,
        model_context_limit=int(model_context_limit) if model_context_limit else None,
    )


def fit_conversation_turns(
    turns: Sequence[Any],
    budget_tokens: int,
    *,
    keep: str = "recent",
) -> list[str]:
    """대화 턴 목록을 budget 안에 맞춘 문자열 리스트로 반환한다.

    keep="recent"면 최근 턴부터 남기고 오래된 턴부터 제외한다. 단일 턴이
    예산보다 크면 그 턴만 예산 안으로 절단한다.
    """

    normalized = [_WS_RE.sub(" ", str(turn or "")).strip() for turn in turns]
    normalized = [turn for turn in normalized if turn]
    if budget_tokens <= 0:
        return []
    if keep != "recent":
        raise ValueError("keep은 'recent'만 지원합니다.")
    selected: list[str] = []
    used = 0
    for turn in reversed(normalized):
        cost = estimate_tokens(turn)
        if cost > budget_tokens:
            turn = truncate_to_tokens(turn, budget_tokens)
            cost = budget_tokens
        if used + cost > budget_tokens:
            break
        selected.append(turn)
        used += cost
    selected.reverse()
    return selected


def budget_summary(sections: Iterable[ComposedSection]) -> dict[str, dict[str, int | bool]]:
    """디버그/노출용으로 섹션별 사용량 요약을 만든다."""

    return {
        section.name: {
            "requested_tokens": section.requested_tokens,
            "used_tokens": section.used_tokens,
            "truncated": section.truncated,
        }
        for section in sections
    }
