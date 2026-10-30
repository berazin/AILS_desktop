"""Reasoning settings and provider request options for text workflows."""

REASONING_EFFORTS = frozenset({"none", "minimal", "low", "medium", "high", "xhigh", "max"})


def normalize_reasoning_effort(value):
    effort = str(value or "default").strip().lower()
    return effort if effort in REASONING_EFFORTS else "default"


def byok_reasoning_options(provider, effort):
    if effort is None:
        return {}
    if effort not in REASONING_EFFORTS:
        raise ValueError("지원하지 않는 추론 수준입니다.")
    if provider in {"OpenRouter", "Vercel AI Gateway"}:
        return {"reasoning": {"effort": effort}}
    if provider == "DeepSeek":
        if effort not in {"none", "low", "high", "max"}:
            raise ValueError("DeepSeek 추론 수준은 none, low, high, max 중 선택해 주세요.")
        return {"thinking": {"type": "disabled" if effort == "none" else "enabled"},
                **({"reasoning_effort": effort} if effort != "none" else {})}
    return {"reasoning_effort": effort}


def gemini_reasoning_options(effort):
    if effort is None:
        return {}
    if effort == "none":
        return {"thinking_config": {"thinking_budget": 0}}
    if effort not in {"minimal", "low", "medium", "high"}:
        raise ValueError("Gemini 추론 수준은 none, minimal, low, medium, high 중 선택해 주세요.")
    return {"thinking_config": {"thinking_level": effort}}
