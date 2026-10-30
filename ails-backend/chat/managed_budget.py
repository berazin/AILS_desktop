"""Client-owned chatbot reservation from local estimates and output forecasts.

Local token counts are conservative serialization estimates, not usage receipts.
Provider credential caps enforce spending independently of this preflight estimate.
"""
from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal, InvalidOperation, ROUND_CEILING
import hashlib
import json
import time

ANSWER_TOKENS = 2048
REASONING_TOKENS = {
    "none": 0, "disabled": 0, "minimal": 1024, "low": 2048,
    "medium": 4096, "enabled": 4096, "high": 8192,
    "xhigh": 16384, "max": 32768,
}


def _content_blocks(content):
    if content is None:
        return []
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    if not isinstance(content, list):
        raise ValueError("토큰 계수에 지원하지 않는 메시지 형식입니다.")
    result = []
    for part in content:
        if part.get("type") == "text":
            result.append({"type": "text", "text": part["text"]})
        elif part.get("type") == "image_url":
            image = part["image_url"]
            url = image["url"] if isinstance(image, Mapping) else image
            if url.startswith("data:"):
                header, data = url.split(",", 1)
                if not header.endswith(";base64"):
                    raise ValueError("토큰 계수에는 base64 이미지가 필요합니다.")
                source = {"type": "base64", "media_type": header[5:-7], "data": data}
            elif url.startswith("https://"):
                source = {"type": "url", "url": url}
            else:
                raise ValueError("토큰 계수에 지원하지 않는 이미지 형식입니다.")
            result.append({"type": "image", "source": source})
        else:
            raise ValueError("토큰 계수에 지원하지 않는 입력이 있습니다. 입력을 생략해 계산하지 않습니다.")
    return result


def token_count_payload(model_id: str, messages: list[dict], options=None, *, zdr_enabled=False) -> dict:
    """Convert the complete chat/tool/image input to the Gateway count format."""
    system, converted = [], []
    for message in messages:
        role = message["role"]
        blocks = _content_blocks(message.get("content"))
        if role in {"system", "developer"}:
            system.extend(blocks)
            continue
        if role == "tool":
            blocks = [{"type": "tool_result", "tool_use_id": message["tool_call_id"], "content": blocks}]
            role = "user"
        elif role == "assistant":
            for call in message.get("tool_calls") or []:
                function = call["function"]
                arguments = function.get("arguments") or "{}"
                blocks.append({"type": "tool_use", "id": call["id"], "name": function["name"],
                               "input": json.loads(arguments) if isinstance(arguments, str) else arguments})
        elif role != "user":
            raise ValueError("토큰 계수에 지원하지 않는 메시지 역할입니다.")
        if blocks:
            if converted and converted[-1]["role"] == role:
                converted[-1]["content"].extend(blocks)
            else:
                converted.append({"role": role, "content": blocks})
    payload = {"model": model_id, "messages": converted}
    if zdr_enabled is True:
        payload["providerOptions"] = {"gateway": {"zeroDataRetention": True}}
    if system:
        payload["system"] = system
    tools = (options or {}).get("tools")
    if tools:
        payload["tools"] = []
        for tool in tools:
            if tool.get("type") != "function":
                raise ValueError("토큰 계수에 지원하지 않는 도구 형식입니다.")
            function = tool["function"]
            value = {"name": function["name"], "input_schema": function.get("parameters") or {"type": "object"}}
            if function.get("description"):
                value["description"] = function["description"]
            payload["tools"].append(value)
    return payload


def forecast_output_tokens(model: Mapping, input_tokens: int, effort=None) -> int:
    reasoning = model.get("reasoning") or {}
    selected = effort or reasoning.get("default_effort") or ("medium" if reasoning.get("values") else "none")
    if selected not in REASONING_TOKENS:
        raise ValueError("추론 수준의 예상 출력량을 계산할 수 없습니다.")
    forecast = ANSWER_TOKENS + REASONING_TOKENS[selected]
    limits = [forecast]
    for field in ("max_output_tokens", "context_length"):
        limit = model.get(field)
        if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0:
            limits.append(limit if field == "max_output_tokens" else limit - input_tokens)
    if min(limits) <= 0:
        raise ValueError("입력이 선택한 모델의 문맥 한도를 초과했습니다.")
    return min(limits)


def reservation_microusd(input_tokens: int, output_tokens: int, input_rate, output_rate) -> int:
    """Rates are USD per token; round up once at the money boundary."""
    try:
        rates = [Decimal(str(value)) for value in (input_rate, output_rate)]
    except InvalidOperation as error:
        raise ValueError("모델 가격을 확인할 수 없습니다.") from error
    if any(not rate.is_finite() or rate < 0 for rate in rates):
        raise ValueError("모델 가격을 확인할 수 없습니다.")
    amount = int(((input_tokens * rates[0] + output_tokens * rates[1]) * 1_000_000).to_integral_value(rounding=ROUND_CEILING))
    if amount > 9_007_199_254_740_991:
        raise ValueError("예상 비용이 지원 범위를 초과했습니다.")
    return max(1, amount)


class ChatbotBudget:
    def __init__(self, count_api, model: Mapping, *, effort=None, timing_callback=None, zdr_enabled=False):
        self.count_api, self.model = count_api, model
        self.effort, self.timing_callback = effort, timing_callback
        self.zdr_enabled = zdr_enabled is True
        self._cached = None
        self.measurement = {}

    def budget(self, messages: list[dict], options=None) -> int:
        payload = token_count_payload(self.model["id"], messages, options, zdr_enabled=self.zdr_enabled)
        digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).digest()
        if self._cached and self._cached[0] == digest:
            return self._cached[1]
        if self.timing_callback:
            self.timing_callback("token_count_start", {"at": time.monotonic()})
        from client_ai_catalog import local_token_estimate
        result = local_token_estimate(payload)
        if not isinstance(result, Mapping):
            raise ValueError("모델의 입력 토큰 계수 응답이 올바르지 않습니다.")
        tokens = result.get("input_tokens")
        if (result.get("model_id") != self.model["id"] or not isinstance(tokens, int)
                or isinstance(tokens, bool) or tokens < 0 or tokens > 9_007_199_254_740_991):
            raise ValueError("모델의 입력 토큰 계수 응답이 올바르지 않습니다.")
        output = forecast_output_tokens(self.model, tokens, self.effort)
        # Prefer the endpoint's current per-token prices over the cached catalog.
        input_rate = result.get("input_usd_per_token", self.model.get("reservation_input_price"))
        output_rate = result.get("output_usd_per_token", self.model.get("reservation_output_price"))
        amount = reservation_microusd(tokens, output, input_rate, output_rate)
        self.measurement = {"input_tokens": tokens, "forecast_output_tokens": output,
                            "reservation_microusd": amount, "source": result["source"], "estimated": True}
        self._cached = digest, amount
        if self.timing_callback:
            self.timing_callback("token_count_completed", {"at": time.monotonic(), **self.measurement})
        return amount
