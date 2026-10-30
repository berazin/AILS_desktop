"""Shared support for the app-wide natural-language setting.

The ``language`` config key selects the language used by OCR, PDF
translation, STT, voice mode, and every AI-generated output (summaries,
chatbot answers, quizzes, grading feedback). Korean stays the default so
existing installations keep their current behavior unchanged.
"""

from __future__ import annotations

APP_LANGUAGE_DEFAULT = "korean"
APP_LANGUAGES = ("korean", "english", "japanese", "chinese")

# Aliases accepted from configs and API payloads, mapped to canonical values.
_APP_LANGUAGE_ALIASES = {
    "korean": "korean",
    "ko": "korean",
    "한국어": "korean",
    "english": "english",
    "en": "english",
    "영어": "english",
    "japanese": "japanese",
    "ja": "japanese",
    "jp": "japanese",
    "일본어": "japanese",
    "chinese": "chinese",
    "zh": "chinese",
    "zh-cn": "chinese",
    "중국어": "chinese",
}

# English names used inside AI prompts and PDF metadata.
LANGUAGE_DISPLAY_NAMES = {
    "korean": "Korean",
    "english": "English",
    "japanese": "Japanese",
    "chinese": "Chinese",
}

# Korean names used inside Korean-authored prompts ("한국어 강의" ...).
LANGUAGE_KOREAN_NAMES = {
    "korean": "한국어",
    "english": "영어",
    "japanese": "일본어",
    "chinese": "중국어",
}

# ISO 639-1 codes for STT engines (faster-whisper, whisper.cpp, Groq, ...).
STT_LANGUAGE_CODES = {
    "korean": "ko",
    "english": "en",
    "japanese": "ja",
    "chinese": "zh",
}

# Forced-decoder language tokens for Whisper prompt-based language pinning.
WHISPER_LANGUAGE_TOKENS = {
    "korean": "<|ko|>",
    "english": "<|en|>",
    "japanese": "<|ja|>",
    "chinese": "<|zh|>",
}

# PaddleOCR recognition model per language. Japanese and Chinese share the
# unified PP-OCRv5 recognition model, which covers Chinese, English, and
# Japanese in one model.
PADDLE_RECOGNITION_MODELS = {
    "korean": "korean_PP-OCRv5_mobile_rec",
    "english": "en_PP-OCRv5_mobile_rec",
    "japanese": "PP-OCRv5_mobile_rec",
    "chinese": "PP-OCRv5_mobile_rec",
}

# Windows font file candidates (best first) for rendering each target
# language into PDFs. .ttc collections work with reportlab's TTFont.
TRANSLATION_FONT_CANDIDATES = {
    "korean": (("malgun.ttf",), ("malgunbd.ttf",), ("batang.ttc",)),
    "english": (("malgun.ttf",), ("malgunbd.ttf",), ("batang.ttc",)),
    "japanese": (("YuGothM.ttc", "meiryo.ttc"), ("YuGothB.ttc", "meiryob.ttc"), ("YuGothM.ttc", "meiryo.ttc")),
    "chinese": (("msyh.ttc",), ("msyhbd.ttc",), ("simsun.ttc",)),
}

# Character-class fragments matching text written in the language; used to
# detect target-language output and untranslated source text.
LANGUAGE_TEXT_PATTERNS = {
    "korean": r"[가-힣]",
    "english": r"[A-Za-z]",
    "japanese": r"[ぁ-んァ-ヶ]",
    "chinese": r"[一-龥]",
}

# Word tokens long enough to look like real recognized words.
LANGUAGE_TOKEN_PATTERNS = {
    "korean": r"[가-힣]{2,}",
    "english": r"[A-Za-z]{2,}",
    "japanese": r"[ぁ-んァ-ヶ一-龥々]{2,}",
    "chinese": r"[一-龥]{2,}",
}


def normalize_app_language(value, default=APP_LANGUAGE_DEFAULT):
    """Map an arbitrary config/request value onto a supported language."""
    key = str(value or "").strip().casefold()
    normalized = _APP_LANGUAGE_ALIASES.get(key)
    if normalized:
        return normalized
    fallback = str(default or "").strip().casefold()
    return _APP_LANGUAGE_ALIASES.get(fallback, APP_LANGUAGE_DEFAULT)


def stt_language_code(value):
    return STT_LANGUAGE_CODES[normalize_app_language(value)]


def whisper_language_token(value):
    return WHISPER_LANGUAGE_TOKENS[normalize_app_language(value)]


def paddle_recognition_model(value):
    return PADDLE_RECOGNITION_MODELS[normalize_app_language(value)]


def language_display_name(value):
    return LANGUAGE_DISPLAY_NAMES[normalize_app_language(value)]


def language_korean_name(value):
    return LANGUAGE_KOREAN_NAMES[normalize_app_language(value)]


def language_text_pattern(value):
    return LANGUAGE_TEXT_PATTERNS[normalize_app_language(value)]


def language_token_pattern(value):
    return LANGUAGE_TOKEN_PATTERNS[normalize_app_language(value)]


def language_output_directive(value):
    """Directive appended to AI prompts so outputs follow the language setting.

    Korean keeps the existing prompts untouched, so the return value is an
    empty string for the default language.
    """
    language = normalize_app_language(value)
    if language == "korean":
        return ""
    name = LANGUAGE_DISPLAY_NAMES[language]
    return (
        f"IMPORTANT: Write every user-facing sentence you produce in {name} — "
        f"including titles, headings, option labels, explanations, hints, and "
        f"feedback. Never mix in sentences written in other languages."
    )


def is_korean_language(value):
    return normalize_app_language(value) == "korean"
