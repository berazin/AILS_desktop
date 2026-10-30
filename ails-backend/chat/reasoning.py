"""Validate a per-question reasoning choice without changing model defaults."""
from ai_reasoning import REASONING_EFFORTS, byok_reasoning_options


def question_reasoning_effort(payload):
    value = payload.get("reasoning_effort")
    if value is None or value == "default":
        return None
    if not isinstance(value, str) or value not in REASONING_EFFORTS | {"enabled", "disabled"}:
        raise ValueError("지원하지 않는 추론 수준입니다.")
    return value


def chatbot_reasoning_options(provider, effort, options=None):
    if provider in {"OpenRouter", "Vercel AI Gateway"} and effort in {"enabled", "disabled"}:
        return {**(options or {}), "reasoning": {"enabled": effort == "enabled"}}
    return {**(options or {}), **byok_reasoning_options(provider, effort)} or None


def chatbot_managed_options(options, effort):
    return {**options, **({"reasoning_effort": effort} if effort is not None else {})}
