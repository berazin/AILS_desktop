"""Compatibility exports. Implementation belongs to documents.insight_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("documents.insight_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class InsightBookMixin:
    """Stable API methods delegating to the insight service."""
    def _insight_user_id(self):
        return _service_call(self, "insight", '_insight_user_id')

    def _insight_context(self):
        return _service_call(self, "insight", '_insight_context')

    def _insight_service(self, user_id, store):
        return _service_call(self, "insight", '_insight_service', user_id, store)

    def insight_snapshot(self, raw_offset=0, revision_offset=0, review_filter='all'):
        return _service_call(self, "insight", 'insight_snapshot', raw_offset, revision_offset, review_filter)

    def insight_record(self, raw_id):
        return _service_call(self, "insight", 'insight_record', raw_id)

    def insight_submit(self, payload):
        return _service_call(self, "insight", 'insight_submit', payload)

    def _insight_submit(self, payload, timing):
        return _service_call(self, "insight", '_insight_submit', payload, timing)

    def insight_action(self, payload):
        return _service_call(self, "insight", 'insight_action', payload)

    def cancel_all_insight_work(self):
        return _service_call(self, "insight", 'cancel_all_insight_work')
