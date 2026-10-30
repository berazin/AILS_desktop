"""ConversationService: feature operations and owned state."""
from __future__ import annotations
from chat.turn_preparation import TurnPreparation, TurnPreparationPorts
from chat.response_workflow import ResponseWorkflow, ResponseWorkflowPorts
from chat.answer_documents import AnswerDocuments, AnswerDocumentsPorts
from chat.conversation_support import (Any, Callable, ChatbotRequestTiming, ChatbotTurnCache, Mapping, dataclass)
from chat.conversation_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class ConversationServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    append_ai_debug_trace: Callable[..., Any]
    append_idle_log: Callable[..., Any]
    call_managed_gateway_chat: Callable[..., Any]
    collect_engine_results: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    local_provider_model: Callable[..., Any]
    get_lock: Callable[[], Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_model: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    memory_enabled: Callable[..., Any]
    memory_service: Callable[..., Any]
    memory_settings: Callable[..., Any]
    get_processed_results: Callable[[], Any]
    refresh_reports_from_disk: Callable[..., Any]
    research_scope: Callable[..., Any]
    selected_ai_model: Callable[..., Any]
    verified_memory_user_id: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class ConversationService:
    def __init__(self, ports: ConversationServicePorts):
        self._ports = ports
        self.append_ai_debug_trace = ports.append_ai_debug_trace
        self.append_idle_log = ports.append_idle_log
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.collect_engine_results = ports.collect_engine_results
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_model = ports.managed_workflow_model
        self.managed_workflow_options = ports.managed_workflow_options
        self.memory_enabled = ports.memory_enabled
        self.memory_service = ports.memory_service
        self.memory_settings = ports.memory_settings
        self.refresh_reports_from_disk = ports.refresh_reports_from_disk
        self.research_scope = ports.research_scope
        self.selected_ai_model = ports.selected_ai_model
        self.verified_memory_user_id = ports.verified_memory_user_id
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

        self._turns = TurnPreparation(TurnPreparationPorts(
            append_idle_log=lambda *args, **kwargs: self.append_idle_log(*args, **kwargs),
            local_provider_model=lambda *args, **kwargs: self.local_provider_model(*args, **kwargs),
            managed_workflow_model=lambda *args, **kwargs: self.managed_workflow_model(*args, **kwargs),
            memory_enabled=lambda *args, **kwargs: self.memory_enabled(*args, **kwargs),
            memory_service=lambda *args, **kwargs: self.memory_service(*args, **kwargs),
            memory_settings=lambda *args, **kwargs: self.memory_settings(*args, **kwargs),
            research_scope=lambda *args, **kwargs: self.research_scope(*args, **kwargs),
            selected_ai_model=lambda *args, **kwargs: self.selected_ai_model(*args, **kwargs),
            verified_memory_user_id=lambda *args, **kwargs: self.verified_memory_user_id(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: self.workflow_uses_managed_ai(*args, **kwargs),
            get_config=lambda: self.config,
        ))
        self._responses = ResponseWorkflow(ResponseWorkflowPorts(
            append_ai_debug_trace=lambda *args, **kwargs: self.append_ai_debug_trace(*args, **kwargs),
            append_idle_log=lambda *args, **kwargs: self.append_idle_log(*args, **kwargs),
            call_managed_gateway_chat=lambda *args, **kwargs: self.call_managed_gateway_chat(*args, **kwargs),
            local_provider_model=lambda *args, **kwargs: self.local_provider_model(*args, **kwargs),
            managed_ai_action=lambda *args, **kwargs: self.managed_ai_action(*args, **kwargs),
            managed_workflow_options=lambda *args, **kwargs: self.managed_workflow_options(*args, **kwargs),
            prepare_chatbot_turn=lambda *args, **kwargs: self.prepare_chatbot_turn(*args, **kwargs),
            selected_ai_model=lambda *args, **kwargs: self.selected_ai_model(*args, **kwargs),
            workflow_uses_managed_ai=lambda *args, **kwargs: self.workflow_uses_managed_ai(*args, **kwargs),
            get_config=lambda: self.config,
        ))
        self._documents = AnswerDocuments(AnswerDocumentsPorts(
            append_idle_log=lambda *args, **kwargs: self.append_idle_log(*args, **kwargs),
            collect_engine_results=lambda *args, **kwargs: self.collect_engine_results(*args, **kwargs),
            refresh_reports_from_disk=lambda *args, **kwargs: self.refresh_reports_from_disk(*args, **kwargs),
            get_config=lambda: self.config,
            get_lock=lambda: self.lock,
            get_processed_results=lambda: self.processed_results,
        ))

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    @property
    def lock(self):
        return self._ports.get_lock()

    @property
    def processed_results(self):
        return self._ports.get_processed_results()

    def practice_tutor_capabilities(self) -> dict:
        return self._turns.practice_tutor_capabilities()

    def prepare_chatbot_turn(self, payload: dict) -> dict:
        return self._turns.prepare_chatbot_turn(payload)

    def _chatbot_context_metrics(
        self,
        *,
        assembly: Mapping,
        budget: int,
        limits: Mapping,
        schema_tokens: int,
        tool_count: int,
        categories_selected: list[str],
        rounds_tokens: int,
        round_stats: Mapping,
        question_tokens: int,
        cache_hit: bool,
        base_message_count: int,
        message_count: int,
    ) -> dict:
        return self._turns._chatbot_context_metrics(assembly=assembly, budget=budget, limits=limits, schema_tokens=schema_tokens, tool_count=tool_count, categories_selected=categories_selected, rounds_tokens=rounds_tokens, round_stats=round_stats, question_tokens=question_tokens, cache_hit=cache_hit, base_message_count=base_message_count, message_count=message_count)

    def chatbot_gateway_request_options(self, request_options=None, *, model_name="", provider="Vercel AI Gateway", transport=None):
        return self._responses.chatbot_gateway_request_options(request_options, model_name=model_name, provider=provider, transport=transport)

    def chatbot_expert_answer(self, payload: dict):
        return self._responses.chatbot_expert_answer(payload)

    def resolve_chatbot_openai_config(self, provider: str, model_name: str):
        return self._responses.resolve_chatbot_openai_config(provider, model_name)

    def stream_chatbot_reply(self, payload: dict, emit, *, cancel_check=None):
        return self._responses.stream_chatbot_reply(payload, emit, cancel_check=cancel_check)

    def _stream_chatbot_reply(self, payload: dict, emit, *, timing: ChatbotRequestTiming, cancel_check=None):
        return self._responses._stream_chatbot_reply(payload, emit, timing=timing, cancel_check=cancel_check)

    def chatbot_reply(self, payload: dict):
        return self._responses.chatbot_reply(payload)



    def extract_pdf_ocr_region(self, payload: dict):
        return self._documents.extract_pdf_ocr_region(payload)

    def save_chatbot_answer(self, payload: dict):
        return self._documents.save_chatbot_answer(payload)

    def get_report(self, title: str):
        return self._documents.get_report(title)

    def latex_postprocess_reports(self):
        return self._documents.latex_postprocess_reports()

    def search_context(self, payload: Mapping) -> dict:
        return self._documents.search_context(payload)

    def chatbot_turn_cache(self) -> ChatbotTurnCache:
        return self._turns.chatbot_turn_cache()

    def chatbot_section_budgets(self) -> dict[str, int]:
        return self._turns.chatbot_section_budgets()

    def build_chatbot_messages(self, payload: dict):
        return self._turns.build_chatbot_messages(payload)

    @property
    def _chatbot_turn_cache_lock(self):
        return self._turns._chatbot_turn_cache_lock

    @_chatbot_turn_cache_lock.setter
    def _chatbot_turn_cache_lock(self, value):
        self._turns._chatbot_turn_cache_lock = value

    @property
    def _chatbot_turn_cache(self):
        return self._turns._chatbot_turn_cache

    @_chatbot_turn_cache.setter
    def _chatbot_turn_cache(self, value):
        self._turns._chatbot_turn_cache = value
