"""Billing-provider preference, independent of account sessions and server models."""
from collections.abc import Mapping

FEATURES = {
    "chatbot": "일반 채팅 · PDF 질문·답변",
    "grading": "문제 채점 · 힌트",
    "insight_book": "인사이트 검증",
    "code_assist": "코드 보조 및 평가",
    "practice_generation": "연습문제 생성",
    "pdf_translation": "PDF 번역",
    "image_analysis": "문서 이미지 분석",
    "video_stt_cleanup": "강의 전사 텍스트 정제",
    "video_summary": "강의 정리 작성 · 검증",
    "video_visual": "강의 화면 분석",
    "voice_agent": "클라우드 음성 대화",
    "problem_review": "PDF 문제 자동 검수 (ChatGPT 미지원)",
}


def normalize_provider_settings(value):
    if value is None:
        value = {}
    if not isinstance(value, Mapping):
        raise ValueError("AI 공급자 설정이 올바르지 않습니다.")
    default = value.get("default", "ails")
    if default == "codex":
        default = "chatgpt"
    if default not in {"ails", "chatgpt"}:
        raise ValueError("기본 AI 공급자가 올바르지 않습니다.")
    features = value.get("features", {})
    if not isinstance(features, Mapping):
        raise ValueError("기능별 AI 설정이 올바르지 않습니다.")
    normalized = {}
    for key, provider in features.items():
        if provider == "codex":
            provider = "chatgpt"
        if key not in FEATURES or provider not in {"default", "ails", "chatgpt"}:
            raise ValueError("기능별 AI 공급자가 올바르지 않습니다.")
        if provider != "default":
            normalized[key] = provider
    model = value.get("chatgpt_model", "")
    if not isinstance(model, str) or len(model) > 200:
        raise ValueError("ChatGPT 모델 선택이 올바르지 않습니다.")
    return {"default": default, "features": normalized, "chatgpt_model": model.strip()}


def provider_for(config, workflow):
    import personal_mode
    if personal_mode.enabled():
        return "chatgpt"
    settings = normalize_provider_settings(config.get("ai_provider_settings"))
    # The existing lecture pipeline deliberately shares writer/verifier identity.
    workflow = "video_summary" if workflow == "video_verification" else workflow
    if workflow not in FEATURES:
        raise ValueError("지원하지 않는 AI 기능입니다.")
    provider = settings["features"].get(workflow, settings["default"])
    if provider == "chatgpt":
        from subscription_policy import require_subscription
        require_subscription()
    return provider
