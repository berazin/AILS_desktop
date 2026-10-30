from __future__ import annotations

import math
import re
import time

from markdown_latex_utils import normalize_markdown_tables

USD_KRW_RATE_API_URL = "https://open.er-api.com/v6/latest/USD"
USD_KRW_RATE_TTL_SEC = 300
_USD_KRW_RATE_CACHE = {"rate": None, "fetched_at": 0.0, "source": ""}

DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"
# common.py와 순환 임포트를 피하려고 값만 복제한다. common의 동일 상수와 함께 갱신한다.
DEEPSEEK_RETIRED_MODEL_MIGRATIONS = {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
}
GEMINI_RETIRED_MODEL_MIGRATIONS = {
    "gemini-1.5-flash": "gemini-3.6-flash",
    "gemini-1.5-flash-8b": "gemini-3.5-flash-lite",
    "gemini-2.5-flash": "gemini-3.6-flash",
    "gemini-2.5-flash-preview-09-2025": "gemini-3.6-flash",
    "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite-preview-09-2025": "gemini-3.5-flash-lite",
    "gemini-2.5-pro": "gemini-3.5-flash",
    "gemini-2.5-pro-preview-09-2025": "gemini-3.5-flash",
    "gemini-3-flash-preview": "gemini-3.6-flash",
    "gemini-3.1-flash-preview": "gemini-3.6-flash",
    "gemini-3.1-flash-lite-preview": "gemini-3.5-flash-lite",
    "gemini-3.1-pro-preview": "gemini-3.5-flash",
}
SUMMARY_PRIORITY_LIST = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
]

PRICING_REFERENCE_CHECKED_AT = "2026-08-03 KST"
SUMMARY_PIPELINE_VERSION = "v2.6"
PRICING_REFERENCE_MARKDOWN = (
    "[Gemini](https://ai.google.dev/gemini-api/docs/pricing), "
    "[Groq](https://console.groq.com/docs/models), "
    "[DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/), "
    "[Deepgram](https://deepgram.com/pricing), "
    "[OpenAI](https://developers.openai.com/api/docs/pricing)"
)
MODEL_PRICING_USD_PER_1M = {
    "gemini-3.6-flash": {"input_text": 1.50, "input_audio": 1.50, "output": 7.50},
    "gemini-3.5-flash": {"input_text": 1.50, "input_audio": 1.50, "output": 9.00},
    "gemini-3.5-flash-lite": {"input_text": 0.30, "input_audio": 0.30, "output": 2.50},
    "gemini-3.1-pro-preview": {
        "input_text": 2.00,
        "input_audio": 2.00,
        "output": 12.00,
        "threshold": 200_000,
        "input_text_large": 4.00,
        "input_audio_large": 4.00,
        "output_large": 18.00
    },
    "gemini-3.1-pro-preview-customtools": {
        "input_text": 2.00,
        "input_audio": 2.00,
        "output": 12.00,
        "threshold": 200_000,
        "input_text_large": 4.00,
        "input_audio_large": 4.00,
        "output_large": 18.00
    },
    "gemini-3.1-flash-lite-preview": {"input_text": 0.25, "input_audio": 0.50, "output": 1.50},
    "gemini-3-flash-preview": {"input_text": 0.50, "input_audio": 1.00, "output": 3.00},
    "gemini-2.5-pro": {
        "input_text": 1.25,
        "input_audio": 1.25,
        "output": 10.00,
        "threshold": 200_000,
        "input_text_large": 2.50,
        "input_audio_large": 2.50,
        "output_large": 15.00
    },
    "gemini-2.5-flash": {"input_text": 0.30, "input_audio": 1.00, "output": 2.50},
    "gemini-2.5-flash-lite": {"input_text": 0.10, "input_audio": 0.30, "output": 0.40},
    "gemini-2.5-flash-lite-preview-09-2025": {"input_text": 0.10, "input_audio": 0.30, "output": 0.40},
    "llama-3.1-8b-instant": {"input_text": 0.05, "output": 0.08},
    "llama-3.3-70b-versatile": {"input_text": 0.59, "output": 0.79},
    "meta-llama/llama-4-scout-17b-16e-instruct": {"input_text": 0.11, "input_image": 0.11, "output": 0.34},
    "openai/gpt-oss-20b": {"input_text": 0.075, "output": 0.30},
    "openai/gpt-oss-120b": {"input_text": 0.15, "output": 0.60},
    "qwen/qwen3-32b": {"input_text": 0.29, "output": 0.59},
    "whisper-large-v3": {"per_hour": 0.111},
    "whisper-large-v3-turbo": {"per_hour": 0.04},
    "deepseek-v4-flash": {"input_text": 0.14, "output": 0.28},
    "deepseek-v4.1-flash": {"input_text": 0.15, "output": 0.60},
    "deepseek-v4-pro": {"input_text": 0.435, "output": 0.87},
    "gpt-5.6-luna": {
        "input_text": 0.20,
        "cached_input_text": 0.02,
        "cache_write_input_text": 0.25,
        "output": 1.20,
    },
    "nova-3": {"per_minute": 0.0077},
    "nova-2": {"per_minute": 0.0058},
}
MODEL_PRICING_ALIASES = {
    **GEMINI_RETIRED_MODEL_MIGRATIONS,
    **DEEPSEEK_RETIRED_MODEL_MIGRATIONS,
}


def resolve_pricing_model(model_name):
    return MODEL_PRICING_ALIASES.get(model_name, model_name)

def get_model_pricing(model_name):
    return MODEL_PRICING_USD_PER_1M.get(resolve_pricing_model(model_name))


def normalize_deepseek_model_name(model_name):
    normalized = str(model_name or "").strip()
    if not normalized:
        return DEEPSEEK_DEFAULT_MODEL
    return DEEPSEEK_RETIRED_MODEL_MIGRATIONS.get(normalized.lower(), normalized)

def normalize_gemini_model_name(model_name, default_model=None):
    normalized = str(model_name or "").strip()
    if not normalized:
        return default_model or SUMMARY_PRIORITY_LIST[0]
    return GEMINI_RETIRED_MODEL_MIGRATIONS.get(normalized.lower(), normalized)

def fetch_usd_krw_rate():
    import requests
    now = time.time()
    cached_rate = _USD_KRW_RATE_CACHE.get("rate")
    cached_at = float(_USD_KRW_RATE_CACHE.get("fetched_at", 0.0) or 0.0)
    if cached_rate and now - cached_at <= USD_KRW_RATE_TTL_SEC:
        return cached_rate, _USD_KRW_RATE_CACHE.get("source", "cache")

    try:
        response = requests.get(USD_KRW_RATE_API_URL, timeout=10)
        response.raise_for_status()
        payload = response.json()
        rate = float(payload.get("rates", {}).get("KRW", 0.0) or 0.0)
        if rate > 0:
            _USD_KRW_RATE_CACHE["rate"] = rate
            _USD_KRW_RATE_CACHE["fetched_at"] = now
            _USD_KRW_RATE_CACHE["source"] = payload.get("time_last_update_utc", "live")
            return rate, _USD_KRW_RATE_CACHE["source"]
    except Exception:
        pass

    if cached_rate:
        return cached_rate, _USD_KRW_RATE_CACHE.get("source", "cache")
    return None, ""

def format_cost_pair(usd_amount, krw_amount=None):
    if krw_amount is None:
        return f"${usd_amount:.4f}"
    return f"${usd_amount:.4f} / 약 ₩{int(round(krw_amount)):,}"


_REPORT_COST_BLOCK = re.compile(r"<!-- AILS_REPORT_COST_START -->.*?<!-- AILS_REPORT_COST_END -->", re.S)
_REPORT_COST_DETAIL = re.compile(r"> <!-- AILS_REPORT_COST_DETAIL_START -->\n(.*?)\n> <!-- AILS_REPORT_COST_DETAIL_END -->", re.S)
_COST_PHASE_LABELS = {
    "stt": "STT", "stt_cleanup": "STT 정제", "video_visual": "영상 장면 분석",
    "image_analysis": "이미지 분석", "summary": "정리문 작성",
    "verification": "AI 검증", "web_search": "웹 검색", "unknown": "단계 미확인",
}


def _display_usd(amount, exact_micro=False):
    if amount is None:
        return "확인 불가"
    if exact_micro:
        return f"${amount // 1_000_000}.{amount % 1_000_000:06d}"
    rendered = f"{amount:.12f}".rstrip("0")
    if amount and float(rendered or 0) == 0:
        return f"${amount:.3e}"
    if rendered.endswith("."):
        rendered += "0"
    fraction = rendered.partition(".")[2]
    return "$" + rendered + "0" * max(0, 6 - len(fraction))


def _cost_report_markdown(summary, detail):
    byok = summary.get("byok_cost_sources") or {}
    managed = summary.get("managed_settlement") or {}
    receipts = managed.get("sessions") or []
    pending = managed.get("pending_count", 0)
    unavailable = sum(record.get("status") == "failed" or record.get("lookup_failures", 0) >= 3 for record in receipts)
    known_managed = bool(receipts) and not pending and not unavailable
    rates = summary.get("fx_rates") or []

    def managed_amount(micro):
        value = _display_usd(micro, exact_micro=True)
        if micro is None:
            return value
        if len(rates) == 1:
            return value + f" (약 ₩{round(micro / 1_000_000 * rates[0]):,})"
        if rates:
            low = round(micro / 1_000_000 * rates[0])
            high = round(micro / 1_000_000 * rates[-1])
            return value + f" (약 ₩{low:,}~₩{high:,})"
        return value + " (원화 환산 미확인)"

    lines = ["<!-- AILS_REPORT_COST_START -->", "**AI 비용 요약**"]
    if summary.get("chatgpt_requests"):
        lines.append("**ChatGPT 구독 사용:** API 요금으로 환산하지 않습니다. [사용량 관리](https://chatgpt.com/#settings/Usage)  ")
    pipeline_version = summary.get("pipeline_version") or SUMMARY_PIPELINE_VERSION
    if pipeline_version:
        lines.append(f"**파이프라인 버전:** `{pipeline_version}`  ")
    cached_tokens = int(summary.get("cached_input_tokens", 0) or 0)
    total_input = int(summary.get("input_tokens", 0) or 0)
    if cached_tokens > 0:
        ratio = (cached_tokens / total_input * 100) if total_input > 0 else 0.0
        lines.append(f"**프롬프트 캐시 적중:** {cached_tokens:,} tok ({ratio:.1f}%)  ")
    source_stages = byok.get("stage_costs_usd") or {}
    has_response = any("provider_response_usd" in costs for costs in source_stages.values())
    has_estimate = any("price_estimate_usd" in costs for costs in source_stages.values())
    if receipts:
        if known_managed:
            lines.append(f"**관리형 서버 확정 청구 · 누적:** {managed_amount(managed['actual_cost_microusd'])}  ")
            lines.append(f"**관리형 서버 확정 청구 · 이번 실행:** {managed_amount(managed.get('current_cost_microusd'))}  ")
            lines.append("**정산 상태:** 완료  ")
        else:
            settlement_label = "정산 확인 필요" if unavailable else "정산 중"
            lines.append(f"**관리형 서버 청구:** {settlement_label}  ")
            lines.append(f"**정산 상태:** 대기 {pending}건, 확인 불가 {unavailable}건. 모든 관리형 금액은 확인 후 표시합니다.  ")
    else:
        lines.append("**관리형 서버 청구:** 사용 내역 없음  ")
    if has_response:
        lines.append(f"**개인 API 응답 비용 · 누적:** {_display_usd(byok['provider_response_usd'])}  ")
        lines.append(f"**개인 API 응답 비용 · 이번 실행:** {_display_usd(byok.get('current_provider_response_usd'))}  ")
    if has_estimate:
        lines.append(f"**개인 API 가격표 추정 · 누적:** {_display_usd(byok['price_estimate_usd'])}  ")
        lines.append(f"**개인 API 가격표 추정 · 이번 실행:** {_display_usd(byok.get('current_price_estimate_usd'))}  ")
    if byok.get("unknown_count"):
        lines.append(f"**개인 API 비용 미확인:** {byok['unknown_count']}건  ")
    if byok.get("unattributed_count"):
        lines.append(f"**청구 출처 미확인 사용량:** {byok['unattributed_count']}건  ")
    if (not receipts and not has_response and not has_estimate and not byok.get("unknown_count")
            and not byok.get("unattributed_count") and not summary.get("chatgpt_requests")):
        lines.append("**상태:** 유료 AI 사용 내역 없음 (로컬·무료 단계)  ")
    lines.extend(["", "> [!AI 비용 상세]-", "> **누적 단계별 비용**", "> | 단계 | 관리형 서버 확정 청구 | 개인 API 응답 비용 | 개인 API 가격표 추정 |", "> | --- | ---: | ---: | ---: |"])
    managed_stages = managed.get("stage_costs_microusd") or {}
    byok_stages = {phase: dict(costs) for phase, costs in (byok.get("stage_costs_usd") or {}).items()}
    unknown_stages = set(byok.get("unknown_stages") or [])
    unattributed_stages = set(byok.get("unattributed_stages") or [])
    phases = ("stt", "stt_cleanup", "video_visual", "image_analysis", "summary", "verification", "web_search")
    managed_receipt_phases = {record.get("phase") for record in receipts}
    if "image" in byok_stages:
        legacy = byok_stages["image"]
        current = byok_stages.setdefault("image_analysis", {})
        for source in ("provider_response_usd", "price_estimate_usd"):
            if source in legacy:
                current[source] = current.get(source, 0.0) + legacy[source]
        byok_stages = {phase: amount for phase, amount in byok_stages.items() if phase != "image"}
    if "image" in unknown_stages:
        unknown_stages.discard("image")
        unknown_stages.add("image_analysis")
    if "unknown" in managed_stages or "unknown" in byok_stages or "unknown" in unknown_stages or "unknown" in unattributed_stages or "unknown" in managed_receipt_phases:
        phases += ("unknown",)
    for phase in phases:
        b = byok_stages.get(phase) or {}
        m = managed_stages.get(phase)
        if phase not in managed_receipt_phases:
            m_display = "유료 AI 작업 없음"
        elif known_managed:
            m_display = managed_amount(m)
        else:
            m_display = "정산 확인 필요" if unavailable else "정산 중"
        if b or phase in unknown_stages:
            response = _display_usd(b["provider_response_usd"]) if "provider_response_usd" in b else "비용 미확인"
            estimate = _display_usd(b["price_estimate_usd"]) if "price_estimate_usd" in b else "비용 미확인"
            if "provider_response_usd" not in b and phase not in unknown_stages:
                response = "유료 AI 작업 없음"
            if "price_estimate_usd" not in b and phase not in unknown_stages:
                estimate = "유료 AI 작업 없음"
            if phase in unknown_stages:
                if "provider_response_usd" in b:
                    response += " (확인된 일부, 추가 비용 미확인)"
                if "price_estimate_usd" in b:
                    estimate += " (확인된 일부, 추가 비용 미확인)"
        else:
            response = estimate = "유료 AI 작업 없음"
        if phase in unattributed_stages:
            response = ("청구 출처 미확인" if response == "유료 AI 작업 없음" else response + " (청구 출처 미확인 사용량 별도)")
            estimate = ("청구 출처 미확인" if estimate == "유료 AI 작업 없음" else estimate + " (청구 출처 미확인 사용량 별도)")
        label = _COST_PHASE_LABELS[phase] + (" (일부 비용 미확인)" if phase in unknown_stages and b else "")
        if phase in unattributed_stages:
            label += " (청구 출처 미확인 사용량)"
        lines.append(f"> | {label} | {m_display} | {response} | {estimate} |")
    m_total = managed_amount(managed["actual_cost_microusd"]) if known_managed else ("정산 확인 필요" if unavailable else "정산 중" if pending else "유료 AI 작업 없음")
    response = _display_usd(byok["provider_response_usd"]) if has_response else ("비용 미확인" if byok.get("unknown_count") else "유료 AI 작업 없음")
    estimate = _display_usd(byok["price_estimate_usd"]) if has_estimate else ("비용 미확인" if byok.get("unknown_count") else "유료 AI 작업 없음")
    if byok.get("unknown_count"):
        if has_response:
            response += " (확인된 일부, 추가 비용 미확인)"
        if has_estimate:
            estimate += " (확인된 일부, 추가 비용 미확인)"
    if byok.get("unattributed_count"):
        response = (response + " (청구 출처 미확인 사용량 별도)" if has_response else "청구 출처 미확인")
        estimate = (estimate + " (청구 출처 미확인 사용량 별도)" if has_estimate else "청구 출처 미확인")
    total_label = "누적 합계" + (" (일부 비용 미확인)" if byok.get("unknown_count") else "") + (" (청구 출처 미확인 사용량)" if byok.get("unattributed_count") else "")
    lines.append(f"> | {total_label} | {m_total} | {response} | {estimate} |")
    if not detail:
        detail = "> **토큰·음성·모델·환율·가격표:** 사용 기록 없음"
    lines.extend([">", "> **토큰·음성·모델·환율·가격표**", "> <!-- AILS_REPORT_COST_DETAIL_START -->", detail, "> <!-- AILS_REPORT_COST_DETAIL_END -->", "<!-- AILS_REPORT_COST_END -->"])
    return "\n".join(lines)


def refresh_report_cost_markdown(content, summary):
    match = _REPORT_COST_BLOCK.search(content)
    if not match:
        return content
    if not summary.get("pipeline_version"):
        ver_match = re.search(r"\*\*파이프라인 버전:\*\*\s*`([^`]+)`", match.group())
        if ver_match:
            summary["pipeline_version"] = ver_match.group(1)
        else:
            summary["pipeline_version"] = SUMMARY_PIPELINE_VERSION
    detail_match = _REPORT_COST_DETAIL.search(match.group())
    detail = detail_match.group(1) if detail_match else ""
    return _REPORT_COST_BLOCK.sub(lambda _: _cost_report_markdown(summary, detail), content, count=1)



def estimate_token_count(text):
    if not text:
        return 0

    normalized = str(text).strip()
    if not normalized:
        return 0

    cjk_chars = len(re.findall(r'[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]', normalized))
    ascii_words = re.findall(r'[A-Za-z0-9_]+', normalized)
    ascii_tokens = sum(max(1, math.ceil(len(word) / 4)) for word in ascii_words)
    stripped = re.sub(r'[A-Za-z0-9_\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]', '', normalized)
    punctuation_tokens = math.ceil(len(re.findall(r'[^\s]', stripped)) / 2)
    whitespace_tokens = math.ceil(len(re.findall(r'\s', normalized)) / 6)
    return cjk_chars + ascii_tokens + punctuation_tokens + whitespace_tokens

def _usage_field(usage, *names):
    for name in names:
        if isinstance(usage, dict) and usage.get(name) is not None:
            try:
                return int(usage.get(name))
            except Exception:
                continue
        value = getattr(usage, name, None)
        if value is not None:
            try:
                return int(value)
            except Exception:
                continue
    return 0

def _usage_float(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None

def extract_usage_metadata(response, prompt_text="", output_text=""):
    usage = getattr(response, "usage_metadata", None) or getattr(response, "usageMetadata", None)
    prompt_tokens = _usage_field(usage, "prompt_token_count", "promptTokenCount")
    output_tokens = _usage_field(usage, "candidates_token_count", "candidatesTokenCount", "output_token_count", "outputTokenCount")
    total_tokens = _usage_field(usage, "total_token_count", "totalTokenCount")
    thought_tokens = _usage_field(usage, "thoughts_token_count", "thoughtsTokenCount")
    cached_tokens = _usage_field(usage, "cached_content_token_count", "cachedContentTokenCount")
    source = "api"

    if not any([prompt_tokens, output_tokens, total_tokens, thought_tokens]):
        prompt_tokens = estimate_token_count(prompt_text)
        output_tokens = estimate_token_count(output_text)
        total_tokens = prompt_tokens + output_tokens
        source = "estimated"
    elif not output_tokens and total_tokens:
        output_tokens = max(0, total_tokens - prompt_tokens)

    return {
        "input_tokens": prompt_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens or (prompt_tokens + output_tokens),
        "thought_tokens": thought_tokens,
        "cached_input_tokens": cached_tokens,
        "source": source
    }

def extract_openai_compat_usage(payload, prompt_text="", output_text=""):
    usage = payload.get("usage") if isinstance(payload, dict) else None
    prompt_tokens = _usage_field(usage, "prompt_tokens")
    output_tokens = _usage_field(usage, "completion_tokens")
    total_tokens = _usage_field(usage, "total_tokens")
    cache_hit_tokens = _usage_field(usage, "prompt_cache_hit_tokens")
    cache_miss_tokens = _usage_field(usage, "prompt_cache_miss_tokens")
    prompt_details = usage.get("prompt_tokens_details") if isinstance(usage, dict) else None
    if isinstance(prompt_details, dict) and isinstance(usage, dict) and usage.get("prompt_cache_hit_tokens") is None:
        cache_hit_tokens = _usage_field(prompt_details, "cached_tokens")
    completion_details = (
        usage.get("completion_tokens_details")
        if isinstance(usage, dict)
        else None
    )
    thought_tokens = _usage_field(
        completion_details,
        "reasoning_tokens",
        "reasoning_token_count",
    )
    source = "api"

    if not any([prompt_tokens, output_tokens, total_tokens]):
        prompt_tokens = estimate_token_count(prompt_text)
        output_tokens = estimate_token_count(output_text)
        total_tokens = prompt_tokens + output_tokens
        source = "estimated"
    elif not output_tokens and total_tokens:
        output_tokens = max(0, total_tokens - prompt_tokens)

    result = {
        "input_tokens": prompt_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens or (prompt_tokens + output_tokens),
        "source": source,
    }
    # 미제공 캐시·추론·비용 필드는 키 자체를 생략해 확인된 0과 구별한다.
    if isinstance(completion_details, dict) and any(
        completion_details.get(name) is not None
        for name in ("reasoning_tokens", "reasoning_token_count")
    ):
        result["thought_tokens"] = thought_tokens
    if isinstance(usage, dict):
        if usage.get("prompt_cache_hit_tokens") is not None or (
            isinstance(prompt_details, dict) and prompt_details.get("cached_tokens") is not None
        ):
            result["prompt_cache_hit_tokens"] = cache_hit_tokens
        if usage.get("prompt_cache_miss_tokens") is not None:
            result["prompt_cache_miss_tokens"] = cache_miss_tokens
        if isinstance(prompt_details, dict) and prompt_details.get("cache_write_tokens") is not None:
            result["cache_write_tokens"] = _usage_field(prompt_details, "cache_write_tokens")
    if isinstance(payload, dict) and payload.get("model"):
        result["model"] = str(payload.get("model"))
    cost = _usage_float(usage.get("cost")) if isinstance(usage, dict) else None
    if cost is not None:
        result["actual_cost_usd"] = cost
    return result



def calculate_usage_cost(
    model_name,
    input_tokens,
    output_tokens,
    input_type="text",
    audio_seconds=0.0,
    cached_input_tokens=0,
    cache_write_tokens=0,
):
    pricing = get_model_pricing(model_name)
    if pricing is None:
        return None

    if audio_seconds:
        if pricing.get("per_hour") is not None:
            return (float(audio_seconds) / 3600.0) * float(pricing["per_hour"])
        if pricing.get("per_minute") is not None:
            return (float(audio_seconds) / 60.0) * float(pricing["per_minute"])

    if input_type == "audio":
        input_rate_key = "input_audio"
    elif input_type == "image":
        input_rate_key = "input_image"
    else:
        input_rate_key = "input_text"
    input_rate = pricing.get(input_rate_key, pricing.get("input_text"))
    output_rate = pricing.get("output", 0.0)

    threshold = pricing.get("threshold")
    if threshold and input_tokens > threshold:
        input_rate = pricing.get(f"{input_rate_key}_large", pricing.get("input_text_large", input_rate))
        output_rate = pricing.get("output_large", output_rate)

    cached_input_tokens = max(0, min(int(cached_input_tokens or 0), int(input_tokens or 0)))
    cache_write_tokens = max(
        0,
        min(
            int(cache_write_tokens or 0),
            max(0, int(input_tokens or 0) - cached_input_tokens),
        ),
    )
    uncached_input_tokens = max(
        0,
        int(input_tokens or 0) - cached_input_tokens - cache_write_tokens,
    )
    cached_input_rate = pricing.get(f"cached_{input_rate_key}", input_rate)
    cache_write_rate = pricing.get(f"cache_write_{input_rate_key}", input_rate)
    return (
        uncached_input_tokens * input_rate
        + cached_input_tokens * cached_input_rate
        + cache_write_tokens * cache_write_rate
        + output_tokens * output_rate
    ) / 1_000_000

def build_usage_event(phase, model_name, usage, input_type="text"):
    if not usage:
        return None
    usd_krw_rate, fx_source = fetch_usd_krw_rate()
    local_stt = phase == "stt" and usage.get("source") == "local"
    return {
        "phase": phase,
        "model": usage.get("display_model", model_name),
        "pricing_model": usage.get("pricing_model", model_name),
        "input_type": input_type,
        "input_tokens": int(usage.get("input_tokens", 0) or 0),
        "cached_input_tokens": int(
            usage.get("cached_input_tokens", usage.get("prompt_cache_hit_tokens", 0)) or 0
        ),
        "cache_write_tokens": int(usage.get("cache_write_tokens", 0) or 0),
        "output_tokens": int(usage.get("output_tokens", 0) or 0),
        "audio_seconds": float(usage.get("audio_seconds", 0.0) or 0.0),
        "usd_krw_rate": float(usd_krw_rate or 0.0),
        "fx_source": fx_source,
        "source": usage.get("source", "estimated"),
        "actual_cost_usd": 0.0 if local_stt else usage.get("actual_cost_usd"),
        "billing_mode": "local" if local_stt else usage.get("billing_mode", "byok"),
        "attempt": "current",
    }

def summarize_usage_events(events):
    summary = {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "cache_write_tokens": 0,
        "output_tokens": 0,
        "audio_seconds": 0.0,
        "estimated_cost": 0.0,
        "estimated_cost_krw": 0.0,
        "actual_cost_event_count": 0,
        "estimated_cost_event_count": 0,
        "phases": {},
        "models": {},
        "unknown_models": [],
        "sources": [],
        "fx_rates": []
    }
    unknown_models = set()
    sources = set()
    fx_rates = set()

    for event in events or []:
        if not event:
            continue
        phase = event.get("phase", "other")
        model_name = event.get("model", "unknown")
        pricing_model = event.get("pricing_model", model_name)
        input_tokens = int(event.get("input_tokens", 0) or 0)
        cached_input_tokens = int(event.get("cached_input_tokens", 0) or 0)
        cache_write_tokens = int(event.get("cache_write_tokens", 0) or 0)
        output_tokens = int(event.get("output_tokens", 0) or 0)
        audio_seconds = float(event.get("audio_seconds", 0.0) or 0.0)
        usd_krw_rate = float(event.get("usd_krw_rate", 0.0) or 0.0)
        input_type = event.get("input_type", "text")
        source = event.get("source", "estimated")
        sources.add(source)
        if usd_krw_rate > 0:
            fx_rates.add(round(usd_krw_rate, 4))

        phase_entry = summary["phases"].setdefault(phase, {
            "input_tokens": 0,
            "cached_input_tokens": 0,
            "cache_write_tokens": 0,
            "output_tokens": 0,
            "audio_seconds": 0.0,
            "estimated_cost": 0.0,
            "estimated_cost_krw": 0.0
        })
        phase_entry["input_tokens"] += input_tokens
        phase_entry["cached_input_tokens"] += cached_input_tokens
        phase_entry["cache_write_tokens"] += cache_write_tokens
        phase_entry["output_tokens"] += output_tokens
        phase_entry["audio_seconds"] += audio_seconds
        summary["input_tokens"] += input_tokens
        summary["cached_input_tokens"] += cached_input_tokens
        summary["cache_write_tokens"] += cache_write_tokens
        summary["output_tokens"] += output_tokens
        summary["audio_seconds"] += audio_seconds

        model_entry = summary["models"].setdefault(model_name, {
            "pricing_model": pricing_model,
            "input_tokens": 0,
            "cached_input_tokens": 0,
            "cache_write_tokens": 0,
            "output_tokens": 0,
            "audio_seconds": 0.0,
            "estimated_cost": 0.0,
            "estimated_cost_krw": 0.0
        })
        model_entry["input_tokens"] += input_tokens
        model_entry["cached_input_tokens"] += cached_input_tokens
        model_entry["cache_write_tokens"] += cache_write_tokens
        model_entry["output_tokens"] += output_tokens
        model_entry["audio_seconds"] += audio_seconds

        if event.get("billing_mode") == "chatgpt":
            summary["chatgpt_requests"] = summary.get("chatgpt_requests", 0) + 1
            continue
        actual_cost = (0.0 if phase == "stt" and source == "local"
                       else event.get("actual_cost_usd"))
        if actual_cost is not None:
            summary["actual_cost_event_count"] += 1
        else:
            summary["estimated_cost_event_count"] += 1
        cost = float(actual_cost) if actual_cost is not None else calculate_usage_cost(
            pricing_model,
            input_tokens,
            output_tokens,
            input_type,
            audio_seconds=audio_seconds,
            cached_input_tokens=cached_input_tokens,
            cache_write_tokens=cache_write_tokens,
        )
        if cost is None:
            unknown_models.add(model_name)
        else:
            cost_krw = cost * usd_krw_rate if usd_krw_rate > 0 else None
            phase_entry["estimated_cost"] += cost
            model_entry["estimated_cost"] += cost
            summary["estimated_cost"] += cost
            if cost_krw is not None:
                phase_entry["estimated_cost_krw"] += cost_krw
                model_entry["estimated_cost_krw"] += cost_krw
                summary["estimated_cost_krw"] += cost_krw

    summary["unknown_models"] = sorted(unknown_models)
    summary["sources"] = sorted(sources)
    summary["fx_rates"] = sorted(fx_rates)
    return summary

def build_usage_table_row(label, data):
    audio_minutes = data.get("audio_seconds", 0.0) / 60.0 if data.get("audio_seconds", 0.0) > 0 else "-"
    if isinstance(audio_minutes, float):
        audio_minutes = f"{audio_minutes:.2f}"
    return (
        f"| {label} | "
        f"{int(data.get('input_tokens', 0) or 0):,} | "
        f"{int(data.get('output_tokens', 0) or 0):,} | "
        f"{audio_minutes} |"
    )

def build_usage_markdown(events, engine_line=None, pipeline_version=SUMMARY_PIPELINE_VERSION):
    from pipeline_utils import normalize_markdown_tables

    from summary_generation.managed_costs import usage_cost_sources

    def finish(detail, summary):
        summary["byok_cost_sources"] = usage_cost_sources(events)
        summary["pipeline_version"] = pipeline_version or summary.get("pipeline_version") or SUMMARY_PIPELINE_VERSION
        detail_lines = detail.splitlines()
        if detail_lines and detail_lines[0].startswith(">[!AI 사용량]"):
            detail_lines.pop(0)
        return _cost_report_markdown(summary, "\n".join(detail_lines)), summary

    if not events:
        lines = [">[!AI 사용량]-"]
        if engine_line:
            lines.append(f"> {engine_line}")
            lines.append(">")
        lines.append("> **상태:** 없음")
        lines.append("> **기준:** API 호출이 없었거나 비용 계산 대상이 아닌 로컬 모델만 사용했습니다.")
        return finish(normalize_markdown_tables("\n".join(lines)), summarize_usage_events(events))

    summary = summarize_usage_events(events)
    total_row = build_usage_table_row("총합", summary)
    lines = [
        ">[!AI 사용량]-",
    ]
    if engine_line:
        lines.extend([
            f"> {engine_line}",
            ">",
        ])
    lines.extend([
        "> 사용 모델 기준의 토큰·음성 사용량을 표시합니다.",
        ">",
        "> **총합**",
        "> | 구분 | 입력 tok | 출력 tok | 음성 분 |",
        "> | --- | ---: | ---: | ---: |",
        f"> {total_row}",
    ])

    phase_labels = {
        "summary": "정리문 작성",
        "stt": "STT",
        "stt_cleanup": "STT 정제",
        "image": "이미지 분석",
        "image_analysis": "이미지 분석",
        "video_visual": "영상 장면 분석",
        "verification": "AI 검증",
        "web_search": "웹 검색",
    }
    phase_rows = []
    for phase_key in ("stt", "stt_cleanup", "video_visual", "image_analysis", "image", "summary", "verification", "web_search"):
        phase_data = summary["phases"].get(phase_key)
        if not phase_data:
            continue
        phase_rows.append(build_usage_table_row(phase_labels[phase_key], phase_data))
    if phase_rows:
        lines.extend([
            ">",
            "> **단계별**",
            "> | 단계 | 입력 tok | 출력 tok | 음성 분 |",
            "> | --- | ---: | ---: | ---: |",
        ])
        lines.extend(f"> {row}" for row in phase_rows)

    verification_detail_rows = []
    for stage, label in (("fidelity", "정제 STT·초안 대조"), ("concept", "오개념 검토")):
        stage_events = [event for event in events
                        if isinstance(event, dict) and event.get("phase") == "verification"
                        and event.get("verification_stage") == stage]
        if stage_events:
            verification_detail_rows.append(build_usage_table_row(
                label, summarize_usage_events(stage_events)))
    if verification_detail_rows:
        lines.extend([">", "> **AI 검증 세부**",
                      "> | 작업 | 입력 tok | 출력 tok | 음성 분 |",
                      "> | --- | ---: | ---: | ---: |"])
        lines.extend(f"> {row}" for row in verification_detail_rows)

    model_rows = []
    for model_name, model_data in summary["models"].items():
        model_rows.append(build_usage_table_row(f"`{model_name}`", model_data))
    if model_rows:
        lines.extend([
            ">",
            "> **모델별**",
            "> | 모델 | 입력 tok | 출력 tok | 음성 분 |",
            "> | --- | ---: | ---: | ---: |",
        ])
        lines.extend(f"> {row}" for row in model_rows)

    basis = "API usage 메타데이터 (금액은 위 단계별 출처 구분 표 참조)"
    lines.extend([
        ">",
        f"> **기준:** {basis}",
        f"> **가격표 확인일:** `{PRICING_REFERENCE_CHECKED_AT}`",
        f"> **참고:** {PRICING_REFERENCE_MARKDOWN}",
    ])
    if summary["fx_rates"]:
        if len(summary["fx_rates"]) == 1:
            lines.append(f"> **환율 스냅샷:** 1 USD ≈ ₩{summary['fx_rates'][0]:,.4f}")
        else:
            lines.append(
                f"> **환율 스냅샷:** 1 USD ≈ ₩{summary['fx_rates'][0]:,.4f} ~ ₩{summary['fx_rates'][-1]:,.4f}"
            )
    else:
        lines.append("> **환율 스냅샷:** 조회 실패로 USD만 표시했습니다.")

    if summary["unknown_models"]:
        unknown_list = ", ".join(summary["unknown_models"])
        lines.append(f"> **가격표 미등록 모델:** `{unknown_list}`")

    return finish(normalize_markdown_tables("\n".join(lines)), summary)
