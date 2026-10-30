"""Compatibility exports. Implementation belongs to chat.conversation_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("chat.conversation_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class ApiChatbotMixin:
    """Stable API methods delegating to the chat service."""
    def practice_tutor_capabilities(self) -> dict:
        return _service_call(self, "chat", 'practice_tutor_capabilities')

    def prepare_chatbot_turn(self, payload: dict) -> dict:
        return _service_call(self, "chat", 'prepare_chatbot_turn', payload)

    def _chatbot_context_metrics(self, *, assembly: Mapping, budget: int, limits: Mapping, schema_tokens: int, tool_count: int, categories_selected: list[str], rounds_tokens: int, round_stats: Mapping, question_tokens: int, cache_hit: bool, base_message_count: int, message_count: int) -> dict:
        return _service_call(self, "chat", '_chatbot_context_metrics', assembly=assembly, budget=budget, limits=limits, schema_tokens=schema_tokens, tool_count=tool_count, categories_selected=categories_selected, rounds_tokens=rounds_tokens, round_stats=round_stats, question_tokens=question_tokens, cache_hit=cache_hit, base_message_count=base_message_count, message_count=message_count)

    def chatbot_gateway_request_options(self, request_options=None, *, model_name='', provider='Vercel AI Gateway', transport=None):
        return _service_call(self, "chat", 'chatbot_gateway_request_options', request_options, model_name=model_name, provider=provider, transport=transport)

    def chatbot_expert_answer(self, payload: dict):
        return _service_call(self, "chat", 'chatbot_expert_answer', payload)

    def resolve_chatbot_openai_config(self, provider: str, model_name: str):
        return _service_call(self, "chat", 'resolve_chatbot_openai_config', provider, model_name)

    def stream_chatbot_reply(self, payload: dict, emit, *, cancel_check=None):
        return _service_call(self, "chat", 'stream_chatbot_reply', payload, emit, cancel_check=cancel_check)

    def _stream_chatbot_reply(self, payload: dict, emit, *, timing: ChatbotRequestTiming, cancel_check=None):
        return _service_call(self, "chat", '_stream_chatbot_reply', payload, emit, timing=timing, cancel_check=cancel_check)

    def chatbot_reply(self, payload: dict):
        return _service_call(self, "chat", 'chatbot_reply', payload)

    def extract_pdf_ocr_region(self, payload: dict):
        return _service_call(self, "chat", 'extract_pdf_ocr_region', payload)

    def save_chatbot_answer(self, payload: dict):
        return _service_call(self, "chat", 'save_chatbot_answer', payload)

    def get_report(self, title: str):
        return _service_call(self, "chat", 'get_report', title)

    def latex_postprocess_reports(self):
        return _service_call(self, "chat", 'latex_postprocess_reports')

    def search_context(self, payload: Mapping) -> dict:
        return _service_call(self, "chat", 'search_context', payload)

    def chatbot_turn_cache(self) -> ChatbotTurnCache:
        return _service_call(self, "chat", 'chatbot_turn_cache')

    def chatbot_section_budgets(self) -> dict[str, int]:
        return _service_call(self, "chat", 'chatbot_section_budgets')

    def build_chatbot_messages(self, payload: dict):
        return _service_call(self, "chat", 'build_chatbot_messages', payload)
