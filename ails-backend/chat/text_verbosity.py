"""Per-question response detail for the ChatGPT Responses transport only."""


def validate_text_verbosity(value):
    if not isinstance(value, str) or value not in {"low", "medium", "high"}:
        raise ValueError("지원하지 않는 답변 길이입니다.")
    return value


def question_text_verbosity(payload):
    value = payload.get("text_verbosity")
    return None if value is None else validate_text_verbosity(value)


def chatbot_text_options(selection, verbosity, options=None):
    if selection.get("mode") != "chatgpt" or verbosity is None:
        return options
    return {**(options or {}), "text": {"verbosity": verbosity}}
