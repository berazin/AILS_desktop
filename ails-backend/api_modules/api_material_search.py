"""Compatibility exports. Implementation belongs to search.material_query_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("search.material_query_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class MaterialSearchMixin:
    """Stable API methods delegating to the search service."""
    def _create_material_search_service(self):
        return _service_call(self, "search", '_create_material_search_service')

    def search_materials(self, payload: Mapping) -> dict:
        return _service_call(self, "search", 'search_materials', payload)

    def prepare_material_search(self, payload: Mapping) -> dict:
        return _service_call(self, "search", 'prepare_material_search', payload)

    def material_search_status(self, payload: Mapping) -> dict:
        return _service_call(self, "search", 'material_search_status', payload)
