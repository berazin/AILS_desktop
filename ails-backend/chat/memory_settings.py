"""Stored configuration compatibility; no memory execution or storage."""
from typing import Any, Mapping

DEFAULT_MEMORY_SETTINGS: dict[str, Any] = {
    # profile 기억은 안정적 선호이므로 요청당 이 예산 안에서 항상 우선 포함된다.
    "profile_token_budget": 260,
    # user_memory 전체 예산(context_budgets["user_memory"], 기본 1500) 안에서
    # 검색 결과를 importance 순으로 채운다.
    "retrieval_top_k": 12,
    "similarity_weight": 0.6,
    "importance_weight": 0.25,
    "recency_weight": 0.15,
    # episodic/goal 기준 반감기(일). profile·learning은 3배로 완만히 감쇠한다.
    "recency_half_life_days": 30.0,
    # summary 기억에 더해지는 가점. 압축된 요약이 원본보다 먼저 보이도록 한다.
    "summary_boost": 0.05,
    # 동일·매우 유사 기억 판정 유사도. 이상이면 새로 만들지 않고 갱신한다.
    "dedupe_similarity_threshold": 0.92,
    # 같은 주제 episodic 기억이 이 수에 도달하면 summary로 압축한다.
    "summary_cluster_threshold": 5,
    "min_question_chars": 8,
    # mastery EWMA 스텝. 한 번의 관측으로 mastery가 크게 바뀌지 않는다.
    "mastery_step": 0.05,
    "mastery_confidence_gain": 0.02,
    "max_concepts_per_grading": 8,
}

def normalize_memory_settings(raw: Any) -> dict[str, Any]:
    settings = dict(DEFAULT_MEMORY_SETTINGS)
    if isinstance(raw, Mapping):
        for key in settings:
            if key not in raw:
                continue
            value = raw.get(key)
            if isinstance(settings[key], bool):
                settings[key] = bool(value)
            elif isinstance(settings[key], int):
                try:
                    settings[key] = max(0, int(value))
                except (TypeError, ValueError):
                    continue
            elif isinstance(settings[key], float):
                try:
                    settings[key] = min(1.0, max(0.0, float(value)))
                except (TypeError, ValueError):
                    continue
            else:
                settings[key] = value
    return settings
