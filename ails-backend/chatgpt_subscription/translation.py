"""Reuse document segmentation, protected text and validation with local sessions."""
from documents.document_translation_provider import OpenAICompatibleTranslationProvider

from .protocol import RESOURCE
from .runtime import ENDPOINT


class ChatGPTTranslationProvider(OpenAICompatibleTranslationProvider):
    provider_name = "chatgpt-plan"

    def __init__(self, session):
        # Hash the actual public endpoint for persistent cache identity. The
        # opaque handle is only dispatched through the local runtime adapter.
        super().__init__({"api_key": session["token"], "base_url": RESOURCE + "/responses",
                          "model": session["model_id"]})
        self._base_url = ENDPOINT
