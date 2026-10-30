"""Compatibility exports. Implementation belongs to summary_generation.video_ai_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("summary_generation.video_ai_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class VoiceVideoAiMixin:
    """Stable API methods delegating to the video service."""
    def call_video_verification_web_search(self, claim_ids: list[str], query: str, config: Mapping, request_id: str) -> dict:
        return _service_call(self, "video", 'call_video_verification_web_search', claim_ids, query, config, request_id)

    def call_video_verification_with_tools(self, messages: list[dict], config: Mapping, tools: list[dict], execute_tool_call, *, response_format: dict, max_tool_rounds: int=3, log_list=None, on_round_complete=None, prior_usages=None, prior_tool_rounds: int=0, prior_tool_outcomes=None, validate_structured_result=None, on_tool_complete=None, prior_correction_used: bool=False, available_tools=None, correction_source_ids=None, locked_claim_quotes=None):
        return _service_call(self, "video", 'call_video_verification_with_tools', messages, config, tools, execute_tool_call, response_format=response_format, max_tool_rounds=max_tool_rounds, log_list=log_list, on_round_complete=on_round_complete, prior_usages=prior_usages, prior_tool_rounds=prior_tool_rounds, prior_tool_outcomes=prior_tool_outcomes, validate_structured_result=validate_structured_result, on_tool_complete=on_tool_complete, prior_correction_used=prior_correction_used, available_tools=available_tools, correction_source_ids=correction_source_ids, locked_claim_quotes=locked_claim_quotes)

    def stream_realtime_voice_agent(self, payload: Mapping, emit) -> None:
        return _service_call(self, "voice", 'stream_realtime_voice_agent', payload, emit)

    def warm_realtime_voice_agent(self) -> dict:
        return _service_call(self, "voice", 'warm_realtime_voice_agent')

    def ai_assist_status(self) -> dict:
        return _service_call(self, "voice", 'ai_assist_status')

    def warm_ai_assist(self, payload: Mapping | None=None) -> dict:
        return _service_call(self, "voice", 'warm_ai_assist', payload)

    @staticmethod
    def stop_ai_assist() -> dict:
        return _import_module("voice.agent_service").VoiceAgentService.stop_ai_assist()

    def call_managed_video_summary(self, prompt: str, config: Mapping, log_list=None):
        return _service_call(self, "video", 'call_managed_video_summary', prompt, config, log_list)

    def call_video_stt_cleanup(self, prompt: str, config: Mapping, log_list=None):
        return _service_call(self, "video", 'call_video_stt_cleanup', prompt, config, log_list)

    def call_image_analysis_batch(self, batch, image_dir, config: Mapping, log_list=None):
        return _service_call(self, "video", 'call_image_analysis_batch', batch, image_dir, config, log_list)

    def call_video_visual_event(self, messages: list[dict], config: Mapping, log_list=None, *, response_format: dict, max_tokens: int | None=None):
        return _service_call(self, "video", 'call_video_visual_event', messages, config, log_list, response_format=response_format, max_tokens=max_tokens)

    def call_personal_video_summary(self, prompt: str, config: Mapping, log_list=None):
        return _service_call(self, "video", 'call_personal_video_summary', prompt, config, log_list)

    def call_video_verification(self, prompt: str, config: Mapping, log_list=None):
        return _service_call(self, "video", 'call_video_verification', prompt, config, log_list)
