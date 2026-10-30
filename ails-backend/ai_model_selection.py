"""One persisted selection contract for cloud AI workflows.

Local OCR, STT and llama.cpp choices remain separate because they are not
account gateway models.
"""

from collections.abc import Mapping
import re


def is_managed_model_id(value) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*/[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,180}", value))


MANAGED_WORKFLOWS = (
    "chatbot", "grading", "insight_book", "code_assist", "practice_generation",
    "pdf_translation", "image_analysis", "video_stt_cleanup", "video_summary", "video_verification", "video_visual", "voice_agent",
    "problem_review",
)
VISION_MANAGED_MODELS = frozenset({
    "qwen/qwen3.5-9b", "google/gemini-2.5-flash-lite",
    "openai/gpt-5-nano", "openai/gpt-5.6-luna", "openai/gpt-6-luna",
    "deepseek/deepseek-v4.1-flash",
})
VERIFICATION_MANAGED_MODELS = frozenset({
    "openai/gpt-5-nano", "openai/gpt-5.6-luna", "openai/gpt-6-luna",
    "deepseek/deepseek-v4.1-flash",
})
LEGACY_CLOUD_CHATBOT_IDS = frozenset({
    "alibaba/qwen3.7-flash", "deepseek/deepseek-v4-flash",
    "google/gemini-2.5-flash-lite", "zai/glm-5.3-flash",
    "openai/gpt-5.6-luna", "mistral/ministral-8b",
})
def normalize_model_selection(value) -> dict:
    if not isinstance(value, Mapping):
        return {"mode": "managed_default"}
    mode = str(value.get("mode") or "").strip()
    if mode in {"codex", "chatgpt"}:
        return {"mode": mode, "modelId": str(value.get("modelId") or "")}
    model_id = str(value.get("modelId") or "").strip()
    if mode == "managed" and model_id:
        return {"mode": mode, "modelId": model_id}
    # Old local selections shared the BYOK discriminator. Cloud selections are discarded.
    if mode in {"local", "byok"} and value.get("provider") in {"llama.cpp", "LM Studio"} and model_id:
        return {"mode": "local", "provider": value["provider"], "modelId": model_id}
    return {"mode": "managed_default"}


def normalize_model_settings(value) -> dict:
    value = value if isinstance(value, Mapping) else {}
    features = value.get("features") if isinstance(value.get("features"), Mapping) else {}
    return {
        "default": normalize_model_selection(value.get("default")),
        "features": {
            workflow: normalize_model_selection(selection)
            for workflow, selection in features.items()
            if workflow in MANAGED_WORKFLOWS
        },
    }


def validate_model_settings_for_save(value) -> None:
    if not isinstance(value, Mapping):
        return
    selections = [("기본", value.get("default"))]
    features = value.get("features")
    if isinstance(features, Mapping):
        selections.extend((workflow, selection) for workflow, selection in features.items())
    for workflow, selection in selections:
        if isinstance(selection, Mapping) and selection.get("mode") == "local":
            if not str(selection.get("modelId") or "").strip():
                raise ValueError(f"{workflow} 개인 모델 ID를 입력해 주세요.")


def migrate_legacy_model_selection(config: Mapping, *, allow_byok: bool = False) -> dict:
    features = {}
    for workflow in MANAGED_WORKFLOWS:
        model_id = str(config.get(f"cloud_model_{workflow}") or "").strip()
        if model_id and model_id.casefold() not in {"auto", "default", "none"}:
            features[workflow] = {"mode": "managed", "modelId": model_id}
    return normalize_model_settings({"default": {"mode": "managed_default"}, "features": features})


def resolve_model_selection(settings, workflow: str, *, allow_byok: bool) -> dict:
    from subscription_policy import require_selection
    raw = settings if isinstance(settings, Mapping) else {}
    features = raw.get("features") if isinstance(raw.get("features"), Mapping) else {}
    require_selection(features.get(workflow, raw.get("default")))
    normalized = normalize_model_settings(settings)
    overridden = workflow in normalized["features"]
    selection = normalized["features"].get(workflow, normalized["default"])
    from subscription_policy import require_selection
    require_selection(selection)
    if selection["mode"] == "local" and not allow_byok:
        return {"mode": "managed_default"}
    if selection["mode"] == "local":
        if workflow != "chatbot":
            if overridden:
                raise ValueError("Local models are supported for chat only.")
            return {"mode": "managed_default"}
        if selection["provider"] == "llama.cpp":
            from voice.local_model_catalog import model_spec
            model_spec(selection["modelId"])
    if selection["mode"] == "managed":
        model_id = selection["modelId"]
        if not is_managed_model_id(model_id):
            raise ValueError("관리형 모델 ID 형식이 올바르지 않습니다.")
        # The authenticated Worker owns the allowlist for newly registered models.
        if model_id not in MANAGED_AI_MODELS:
            return dict(selection)
        compatible = (
            (workflow not in {"image_analysis", "video_visual", "problem_review"} or model_id in VISION_MANAGED_MODELS)
            and (workflow != "video_verification" or model_id in VERIFICATION_MANAGED_MODELS)
        )
        if not compatible:
            if overridden:
                raise ValueError(f"Model {model_id} lacks the capability required for {workflow}.")
            return {"mode": "managed_default"}
    return dict(selection)


def preview_model_selections(settings, workflow_defaults, *, allow_byok: bool) -> dict:
    """Resolve settings for display without saving them or starting model calls."""
    normalized = normalize_model_settings(settings)
    workflow_defaults = workflow_defaults if isinstance(workflow_defaults, Mapping) else {}
    preview = {}

    for workflow in MANAGED_WORKFLOWS:
        override = normalized["features"].get(workflow)
        requested = override or normalized["default"]
        if override:
            source = "ails" if override["mode"] == "managed_default" else "workflow"
        else:
            source = "common"
        fallback_reason = None
        try:
            resolved = resolve_model_selection(normalized, workflow, allow_byok=allow_byok)
        except (ValueError, PermissionError) as error:
            preview[workflow] = {"mode": "error", "source": source, "error": str(error)}
            continue

        if resolved["mode"] == "managed_default":
            if requested["mode"] != "managed_default" and source != "ails":
                if requested["mode"] == "local" and not allow_byok:
                    fallback_reason = "개인 API 모델은 이 에디션에서 사용할 수 없어 AILS 기본 모델을 사용합니다."
                else:
                    fallback_reason = "선택한 공통 모델을 이 단계에서 사용할 수 없어 AILS 기본 모델을 사용합니다."
                source = "ails"
            preview[workflow] = {
                "mode": "managed",
                "model_id": str(workflow_defaults.get(workflow) or ""),
                "source": source,
                "fallback_reason": fallback_reason,
            }
        elif resolved["mode"] == "managed":
            preview[workflow] = {
                "mode": "managed",
                "model_id": resolved["modelId"],
                "source": source,
                "fallback_reason": fallback_reason,
            }
        else:
            preview[workflow] = {
                "mode": "local",
                "provider": resolved["provider"],
                "model_id": resolved["modelId"],
                "source": source,
                "fallback_reason": fallback_reason,
            }
            if resolved["provider"] == "llama.cpp":
                from voice.local_model_catalog import model_spec
                preview[workflow]["model_name"] = model_spec(resolved["modelId"])["label"]

    return preview


# api_server에서 이동: 관리형 게이트웨이 모델 카탈로그와 워크플로 정책
import os

MANAGED_AI_RESERVATION_HEADROOM = 1.2
MANAGED_GATEWAY_CHAT_ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions"
CHATBOT_CLOUD_AGENT_MODELS = (
    {"id": "alibaba/qwen3.7-flash", "name": "Qwen 3.7 Flash", "provider": "Alibaba", "input_price": 0.03, "output_price": 0.13},
    {"id": "deepseek/deepseek-v4-flash", "name": "DeepSeek V4 Flash", "provider": "DeepSeek", "input_price": 0.13, "output_price": 0.26},
    {"id": "google/gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite", "provider": "Google", "input_price": 0.10, "output_price": 0.40},
    {"id": "zai/glm-5.3-flash", "name": "GLM 5.3 Flash", "provider": "Z.AI", "input_price": 0.15, "output_price": 0.50},
    {"id": "openai/gpt-5.6-luna", "name": "GPT 5.6 Luna", "provider": "OpenAI", "input_price": 0.20, "output_price": 1.20},
    {"id": "mistral/ministral-8b", "name": "Ministral 8B", "provider": "Mistral", "input_price": 0.15, "output_price": 0.15},
)
CHATBOT_LOCAL_AGENT_MODELS = (
    {"id": "qwen3-4b-instruct-2507-q4-k-m", "name": "Qwen3 4B Instruct 2507", "provider": "llama.cpp Vulkan", "input_price": 0.0, "output_price": 0.0, "local": True},
    {"id": "qwen3-8b-q4-k-m", "name": "Qwen3 8B", "provider": "llama.cpp Vulkan", "input_price": 0.0, "output_price": 0.0, "local": True},
)
CHATBOT_AGENT_MODELS = CHATBOT_CLOUD_AGENT_MODELS + CHATBOT_LOCAL_AGENT_MODELS
CHATBOT_EXPERT_MODELS = (
    {"id": "deepseek/deepseek-v4-pro", "name": "DeepSeek V4 Pro", "provider": "DeepSeek", "input_price": 0.66, "output_price": 1.98},
    {"id": "zai/glm-5.3", "name": "GLM 5.3", "provider": "Z.AI", "input_price": 1.40, "output_price": 4.40},
    {"id": "openai/gpt-5.6-sol", "name": "GPT 5.6 Sol", "provider": "OpenAI", "input_price": 2.00, "output_price": 10.00},
    {"id": "google/gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro Preview", "provider": "Google", "input_price": 2.00, "output_price": 12.00},
    {"id": "anthropic/claude-sonnet-5", "name": "Claude Sonnet 5", "provider": "Anthropic", "input_price": 2.00, "output_price": 10.00},
)
CHATBOT_CLOUD_AGENT_MODEL_IDS = frozenset(model["id"] for model in CHATBOT_CLOUD_AGENT_MODELS)
CHATBOT_LOCAL_AGENT_MODEL_IDS = frozenset(model["id"] for model in CHATBOT_LOCAL_AGENT_MODELS)
CHATBOT_EXPERT_MODEL_IDS = frozenset(model["id"] for model in CHATBOT_EXPERT_MODELS)
CHATBOT_EXPERT_DEFAULT_MODEL = str(
    os.getenv("AILS_CHATBOT_EXPERT_MODEL") or CHATBOT_EXPERT_MODELS[0]["id"]
).strip()
if CHATBOT_EXPERT_DEFAULT_MODEL not in CHATBOT_EXPERT_MODEL_IDS:
    CHATBOT_EXPERT_DEFAULT_MODEL = CHATBOT_EXPERT_MODELS[0]["id"]
MANAGED_AI_WORKFLOWS = frozenset({
    "chatbot", "practice_generation", "grading", "insight_book", "code_assist", "pdf_translation", "image_analysis", "video_visual", "video_stt_cleanup", "video_summary", "video_verification",
    "voice_agent",
})
OPENROUTER_MODEL_ALIASES = {
    "qwen/qwen3.7-flash": "alibaba/qwen3.7-flash",
    "z-ai/glm-5.3-flash": "zai/glm-5.3-flash",
    "mistralai/ministral-8b": "mistral/ministral-8b",
}
VERCEL_TO_OPENROUTER_ALIASES = {v: k for k, v in OPENROUTER_MODEL_ALIASES.items()}

MANAGED_MODEL_CATALOG = (
    {"id": "alibaba/qwen3.7-flash", "openrouter_id": "qwen/qwen3.7-flash", "name": "Qwen 3.7 Flash", "provider": "Alibaba", "input_price": 0.03, "output_price": 0.13},
    {"id": "deepseek/deepseek-v4-flash", "openrouter_id": "deepseek/deepseek-v4-flash", "name": "DeepSeek V4 Flash", "provider": "DeepSeek", "input_price": 0.13, "output_price": 0.26},
    {"id": "deepseek/deepseek-v4.1-flash", "openrouter_id": "deepseek/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "provider": "DeepSeek", "input_price": 0.15, "output_price": 0.60},
    {"id": "qwen/qwen3.5-9b", "openrouter_id": "qwen/qwen3.5-9b", "name": "Qwen 3.5 9B", "provider": "Qwen", "input_price": 0.05, "output_price": 0.25},
    {"id": "google/gemini-2.5-flash-lite", "openrouter_id": "google/gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite", "provider": "Google", "input_price": 0.10, "output_price": 0.40},
    {"id": "mistral/ministral-8b", "openrouter_id": "mistralai/ministral-8b", "name": "Ministral 8B", "provider": "Mistral", "input_price": 0.15, "output_price": 0.15},
    {"id": "zai/glm-5.3-flash", "openrouter_id": "z-ai/glm-5.3-flash", "name": "GLM 5.3 Flash", "provider": "Z.AI", "input_price": 0.15, "output_price": 0.50},
    {"id": "openai/gpt-5-nano", "openrouter_id": "openai/gpt-5-nano", "name": "GPT 5 Nano", "provider": "OpenAI", "input_price": 0.20, "output_price": 1.00},
    {"id": "openai/gpt-5.6-luna", "openrouter_id": "openai/gpt-5.6-luna", "name": "GPT 5.6 Luna", "provider": "OpenAI", "input_price": 0.20, "output_price": 1.20},
    {"id": "openai/gpt-6-luna", "openrouter_id": "openai/gpt-6-luna", "name": "GPT 6 Luna", "provider": "OpenAI", "input_price": 0.10, "output_price": 0.50},
)

MANAGED_WORKFLOW_LABELS = {
    "chatbot": {"label": "챗봇 에이전트", "description": "대화형 질의응답 및 학습 보조"},
    "grading": {"label": "문제 채점", "description": "퀴즈 및 실습 문제 답안 채점과 피드백"},
    "insight_book": {"label": "Insight Book", "description": "Insight 주장 검증, 교재 통합·결과 검증, 구조 점검과 오개념 복습"},
    "code_assist": {"label": "코드 보조 및 평가", "description": "코드 샌드박스 실행 분석 및 코드 진단"},
    "practice_generation": {"label": "연습문제 생성", "description": "학습자료 기반 복습용 문제 및 해설 생성"},
    "pdf_translation": {"label": "PDF 한국어 번역", "description": "원문 PDF 문서 전체 번역"},
    "image_analysis": {"label": "첨부 PDF 이미지 설명", "description": "오디오 정리 작업에 첨부한 PDF 페이지 이미지 설명 생성"},
    "video_stt_cleanup": {"label": "영상 STT 정제", "description": "원본 STT를 보존하며 중복과 맞춤법을 정제"},
    "video_summary": {"label": "영상 텍스트 요약", "description": "강의 영상 자막 및 음성 텍스트 정리본 생성"},
    "video_verification": {"label": "영상 근거 검증", "description": "정리본에 적힌 기술 개념 검토"},
    "video_visual": {"label": "영상 시각 분석", "description": "강의 화면 슬라이드 및 시각 자료 분석"},
    "voice_agent": {"label": "보이스 모드 에이전트", "description": "음성 명령 처리 및 발화 응답"},
}

MANAGED_AI_MODELS = frozenset({
    "openai/gpt-5-nano",
    "openai/gpt-5.6-luna",
    "openai/gpt-6-luna",
    "google/gemini-2.5-flash-lite",
    "qwen/qwen3.5-9b",
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4.1-flash",
}) | CHATBOT_CLOUD_AGENT_MODEL_IDS | frozenset(OPENROUTER_MODEL_ALIASES.keys())


# api_server에서 이동: 관리형 AI 요청당 예상 비용(USD)
MANAGED_AI_ACTION_ESTIMATE_USD = 0.01
