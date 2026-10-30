"""Application input policy shared by generation transports and chunk planners.

Output limits belong to the selected provider/model. No application output cap
is sent. Input estimates include schemas, tools, history and image allowances.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache

AI_REQUEST_MAX_INPUT_TOKENS = 272_000
OUTPUT_TOKEN_KEYS = frozenset({
    "max_tokens", "max_completion_tokens", "max_output_tokens", "maxOutputTokens",
    "max_completion_token", "max_tokens_to_sample", "num_predict",
})
_CONTEXTS = {
    "gpt-6-luna": 1_050_000, "gpt-5.6-luna": 1_050_000,
    "gpt-5.6-sol": 1_050_000, "gpt-5-nano": 400_000,
    "gpt-4o": 128_000, "gpt-4o-mini": 128_000,
    "deepseek-v4.1-flash": 1_000_000, "deepseek-v4-flash": 1_000_000,
    "deepseek-flash": 1_000_000, "deepseek-v4-flash-vision-exp": 1_000_000,
}


class AIInputLimitExceeded(ValueError):
    code = "ai_input_limit_exceeded"


def request_input_limit(model: str = "", context_tokens: int | None = None) -> int:
    context = context_tokens or _CONTEXTS.get(str(model).lower().split("/")[-1])
    return min(AI_REQUEST_MAX_INPUT_TOKENS, context) if context and context > 0 else AI_REQUEST_MAX_INPUT_TOKENS


def request_working_limit(model: str = "", context_tokens: int | None = None) -> int:
    context = context_tokens or _CONTEXTS.get(str(model).lower().split("/")[-1])
    # Planning headroom is not an output-generation limit. Keep room for the
    # response/tools inside small models, and for envelope/tokenizer variation.
    limit = AI_REQUEST_MAX_INPUT_TOKENS - 8_192
    if context and context > 0:
        limit = min(limit, context - min(128_000, context // 5))
    return max(1, limit)


@lru_cache(maxsize=1)
def _encoding():
    try:
        import tiktoken
        return tiktoken.get_encoding("o200k_base")
    except ImportError:
        return None


def estimate_text_tokens(text) -> int:
    value = str(text or "")
    encoding = _encoding()
    if encoding is None:
        return len(value.encode("utf-8"))  # Conservative fallback, never chars/4.
    return len(encoding.encode(value, disallowed_special=()))


def without_output_limits(options: dict | None) -> dict:
    result = {key: value for key, value in (options or {}).items() if key not in OUTPUT_TOKEN_KEYS}
    # Only generation options: never remove identically named tool arguments
    # or JSON-schema properties from messages/tools.
    for key in ("generation_config", "generationConfig", "options", "extra_body", "providerOptions"):
        if isinstance(result.get(key), dict):
            if key == "providerOptions":
                result[key] = {name: without_output_limits(value) if isinstance(value, dict) else value
                               for name, value in result[key].items()}
            else:
                result[key] = without_output_limits(result[key])
    return result


def estimate_request_tokens(payload: dict) -> int:
    image_tokens = 0

    def input_value(value):
        nonlocal image_tokens
        if isinstance(value, dict):
            if value.get("type") in {"image_url", "input_image"}:
                image_tokens += 8_192
                return {"type": "image", "detail": value.get("detail", "auto")}
            if value.get("type") in {"input_audio", "input_file"}:
                raise AIInputLimitExceeded("이 입력 형식은 공급자 토큰 계수 경로로 처리해야 합니다.")
            return {key: input_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [input_value(item) for item in value]
        return value

    input_keys = ("messages", "input", "instructions", "tools", "functions", "response_format", "text")
    content = input_value({key: payload[key] for key in input_keys if key in payload})
    text = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    count = estimate_text_tokens(text)
    model = str(payload.get("model") or "").lower()
    # Non-OpenAI tokenizers differ; leave estimation room rather than counting
    # base64 transport bytes as text. Provider usage remains the billing source.
    if "gpt-" not in model:
        count = math.ceil(count * 1.15)
    return count + image_tokens + 64


def enforce_request_input_limit(payload: dict) -> int:
    tokens = estimate_request_tokens(payload)
    limit = request_input_limit(str(payload.get("model") or ""))
    if tokens > limit:
        raise AIInputLimitExceeded(f"AI 입력이 호출당 한도를 넘습니다: 약 {tokens:,} / {limit:,} 토큰. 입력을 나누어 주세요.")
    return tokens


def prepare_generation_request(payload: dict) -> dict:
    request = without_output_limits(payload)
    enforce_request_input_limit(request)
    return request
