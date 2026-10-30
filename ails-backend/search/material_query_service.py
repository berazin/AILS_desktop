"""MaterialQueryService: feature operations and owned state."""
from __future__ import annotations
from search.material_query_support import (
    Any,
    Callable,
    Mapping,
    MaterialSearchService,
    chat,
    dataclass,
    search_materials_keyword,
)
from search.material_query_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class MaterialQueryServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]

class MaterialQueryService:
    def __init__(self, ports: MaterialQueryServicePorts):
        self._ports = ports
        self._material_search_service_instance = self._create_material_search_service()

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def _create_material_search_service(self):
        return MaterialSearchService(
            get_root=lambda: str(self.config.get("md_save_path") or ""),
            keyword_search=lambda *args, **kwargs: search_materials_keyword(*args, **kwargs),
            semantic_search=lambda *args, **kwargs: chat.theory_search.search_materials_semantic(*args, **kwargs),
            backend_status=lambda: chat.theory_search.embedding_backend_status(),
            warm_backend=lambda: chat.theory_search.warm_embedding_backend(),
        )

    def search_materials(self, payload: Mapping) -> dict:
        service = getattr(self, "_material_search_service_instance", None)
        if service is None:
            service = self._create_material_search_service()
            self._material_search_service_instance = service
        return service.search(payload)

    def prepare_material_search(self, payload: Mapping) -> dict:
        del payload
        return chat.theory_search.warm_embedding_backend()

    def material_search_status(self, payload: Mapping) -> dict:
        del payload
        return chat.theory_search.embedding_backend_status()
