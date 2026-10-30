"""MaterialWorkspaceService: feature operations and owned state."""
from __future__ import annotations
from typing import Any
from collections.abc import Callable
from dataclasses import dataclass
import threading
_support_name = "documents.material_workspace_support"
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class MaterialWorkspaceServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    _ready_pdf_text_payload: Callable[..., Any]
    append_idle_log: Callable[..., Any]
    get_background_work: Callable[[], Any]
    call_managed_gateway_chat: Callable[..., Any]
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    current_semester_folder_name: Callable[..., Any]
    list_pdf_chat_turns: Callable[..., Any]
    local_provider_model: Callable[..., Any]
    get_lock: Callable[[], Any]
    managed_ai_action: Callable[..., Any]
    managed_workflow_options: Callable[..., Any]
    memory_enabled: Callable[..., Any]
    memory_service: Callable[..., Any]
    pdf_study_document_info: Callable[..., Any]
    get_processed_results: Callable[[], Any]
    refresh_reports_from_disk: Callable[..., Any]
    refresh_retry_candidates_from_disk: Callable[..., Any]
    resolve_chatbot_openai_config: Callable[..., Any]
    get_session_report_titles: Callable[[], Any]
    start_pdf_text_extraction: Callable[..., Any]
    verified_memory_user_id: Callable[..., Any]
    workflow_uses_managed_ai: Callable[..., Any]

class MaterialWorkspaceService:
    def close(self):
        with self._component_lock:
            self._closed = True
            practice = self._practice_instance
        if practice is not None:
            practice.close()

    def __init__(self, ports: MaterialWorkspaceServicePorts):
        self._ports = ports
        self._ready_pdf_text_payload = ports._ready_pdf_text_payload
        self.append_idle_log = ports.append_idle_log
        self.call_managed_gateway_chat = ports.call_managed_gateway_chat
        self.current_semester_folder_name = ports.current_semester_folder_name
        self.list_pdf_chat_turns = ports.list_pdf_chat_turns
        self.local_provider_model = ports.local_provider_model
        self.managed_ai_action = ports.managed_ai_action
        self.managed_workflow_options = ports.managed_workflow_options
        self.memory_enabled = ports.memory_enabled
        self.memory_service = ports.memory_service
        self.pdf_study_document_info = ports.pdf_study_document_info
        self.refresh_reports_from_disk = ports.refresh_reports_from_disk
        self.refresh_retry_candidates_from_disk = ports.refresh_retry_candidates_from_disk
        self.resolve_chatbot_openai_config = ports.resolve_chatbot_openai_config
        self.start_pdf_text_extraction = ports.start_pdf_text_extraction
        self.verified_memory_user_id = ports.verified_memory_user_id
        self.workflow_uses_managed_ai = ports.workflow_uses_managed_ai

        self._catalog_instance = None
        self._files_instance = None
        self._content_instance = None
        self._practice_instance = None
        self._component_lock = threading.RLock()
        self._closed = False

    def _component(self, name, create):
        with self._component_lock:
            if self._closed:
                raise RuntimeError("Material workspace is closed")
            instance = getattr(self, name)
            if instance is None:
                instance = create()
                setattr(self, name, instance)
            return instance

    @property
    def _catalog(self):
        return self._component("_catalog_instance", self._create_catalog)

    @property
    def _files(self):
        return self._component("_files_instance", self._create_files)

    def _create_catalog(self):
        from documents.material_catalog import MaterialCatalog, MaterialCatalogPorts
        return MaterialCatalog(MaterialCatalogPorts(
            append_idle_log=lambda *args, **kwargs: self.append_idle_log(*args, **kwargs),
            current_semester_folder_name=lambda *args, **kwargs: self.current_semester_folder_name(*args, **kwargs),
            material_trash_items=lambda *args, **kwargs: self.material_trash_items(*args, **kwargs),
            get_background_work=lambda: self.background_work,
            get_config=lambda: self.config,
        ))

    def _create_files(self):
        from documents.material_file_operations import MaterialFileOperations, MaterialFileOperationsPorts
        return MaterialFileOperations(MaterialFileOperationsPorts(
            get_material_file_service=self._material_file_service,
            _ready_pdf_text_payload=lambda *args, **kwargs: self._ready_pdf_text_payload(*args, **kwargs),
            invalidate_lecture_materials_cache=lambda *args, **kwargs: self.invalidate_lecture_materials_cache(*args, **kwargs),
            lecture_materials=lambda *args, **kwargs: self.lecture_materials(*args, **kwargs),
            refresh_reports_from_disk=lambda *args, **kwargs: self.refresh_reports_from_disk(*args, **kwargs),
            refresh_retry_candidates_from_disk=lambda *args, **kwargs: self.refresh_retry_candidates_from_disk(*args, **kwargs),
            start_pdf_text_extraction=lambda *args, **kwargs: self.start_pdf_text_extraction(*args, **kwargs),
            get_background_work=lambda: self.background_work,
            get_config=lambda: self.config,
            get_lecture_materials_cache_lock=lambda: self.lecture_materials_cache_lock,
            get_lock=lambda: self.lock,
            get_processed_results=lambda: self.processed_results,
            get_session_report_titles=lambda: self.session_report_titles,
        ))

    @property
    def _practice(self):
        with self._component_lock:
            if self._closed:
                raise RuntimeError("Material workspace is closed")
            if self._practice_instance is None:
                from documents.practice_generation import PracticeGeneration, PracticeGenerationPorts
                self._practice_instance = PracticeGeneration(PracticeGenerationPorts(
                    call_managed_gateway_chat=lambda *args, **kwargs: self.call_managed_gateway_chat(*args, **kwargs),
                    invalidate_lecture_materials_cache=lambda *args, **kwargs: self.invalidate_lecture_materials_cache(*args, **kwargs),
                    lecture_materials=lambda *args, **kwargs: self.lecture_materials(*args, **kwargs),
                    list_pdf_chat_turns=lambda *args, **kwargs: self.list_pdf_chat_turns(*args, **kwargs),
                    local_provider_model=lambda *args, **kwargs: self.local_provider_model(*args, **kwargs),
                    managed_ai_action=lambda *args, **kwargs: self.managed_ai_action(*args, **kwargs),
                    managed_workflow_options=lambda *args, **kwargs: self.managed_workflow_options(*args, **kwargs),
                    memory_enabled=lambda *args, **kwargs: self.memory_enabled(*args, **kwargs),
                    memory_service=lambda *args, **kwargs: self.memory_service(*args, **kwargs),
                    pdf_study_document_info=lambda *args, **kwargs: self.pdf_study_document_info(*args, **kwargs),
                    read_material_file=lambda *args, **kwargs: self.read_material_file(*args, **kwargs),
                    refresh_reports_from_disk=lambda *args, **kwargs: self.refresh_reports_from_disk(*args, **kwargs),
                    refresh_retry_candidates_from_disk=lambda *args, **kwargs: self.refresh_retry_candidates_from_disk(*args, **kwargs),
                    resolve_chatbot_openai_config=lambda *args, **kwargs: self.resolve_chatbot_openai_config(*args, **kwargs),
                    verified_memory_user_id=lambda *args, **kwargs: self.verified_memory_user_id(*args, **kwargs),
                    workflow_uses_managed_ai=lambda *args, **kwargs: self.workflow_uses_managed_ai(*args, **kwargs),
                    get_config=lambda: self.config,
                    get_lecture_materials_cache_lock=lambda: self.lecture_materials_cache_lock,
                ))
            return self._practice_instance

    @property
    def background_work(self):
        return self._ports.get_background_work()

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

    @property
    def session_report_titles(self):
        return self._ports.get_session_report_titles()

    def migrate_material_system_storage(self):
        return self._catalog.migrate_material_system_storage()

    def lecture_material_directory(self, directory: str = "", *, include_problem_progress: bool = False):
        return self._catalog.lecture_material_directory(directory, include_problem_progress=include_problem_progress)

    def invalidate_lecture_materials_cache(self):
        return self._catalog.invalidate_lecture_materials_cache()

    def lecture_materials(self):
        return self._catalog.lecture_materials()

    def material_trash_dir(self, base_dir: str) -> str:
        return self._files.material_trash_dir(base_dir)

    def material_trash_items(self, base_dir: str | None = None) -> list[dict]:
        return self._files.material_trash_items(base_dir)

    def ensure_material_trash_entry_path(self, raw_path: str, base_dir: str) -> str:
        return self._files.ensure_material_trash_entry_path(raw_path, base_dir)

    def remove_material_trash_path(self, target_path: str):
        return self._files.remove_material_trash_path(target_path)

    def delete_material_trash_item(self, payload: dict):
        return self._files.delete_material_trash_item(payload)

    def empty_material_trash(self):
        return self._files.empty_material_trash()

    def restore_material_trash_item(self, payload: dict):
        return self._files.restore_material_trash_item(payload)

    def unique_material_trash_path(self, source_path: str, base_dir: str) -> str:
        return self._files.unique_material_trash_path(source_path, base_dir)


    def _create_material_file_service(self):
        from common import resolve_app_path
        from documents.material_file_service import MaterialFileService

        def read_page_count(path):
            from pdf.viewer_support import read_pdf_page_count
            return read_pdf_page_count(path)

        def on_saved(path):
            if not path.lower().endswith(".ipynb"):
                self.refresh_reports_from_disk()
            self.invalidate_lecture_materials_cache()

        return MaterialFileService(
            get_base_dir=lambda: resolve_app_path(self.config.get("md_save_path", "")),
            start_pdf_text_extraction=self.start_pdf_text_extraction,
            ready_pdf_text_payload=self._ready_pdf_text_payload,
            read_pdf_page_count=read_page_count,
            on_saved=on_saved,
            on_text_ready=lambda path: self.background_work.note_material_paths(embedding_paths=[path])
                if self.config.get("background_document_embedding", True) else None,
        )

    def _material_file_service(self):
        return self._component("_content_instance", self._create_material_file_service)

    def read_material_file(self, file_path: str):
        return self._material_file_service().read(file_path)

    def save_material_file(self, payload: dict):
        return self._material_file_service().save(payload)

    def material_file_siblings(self, file_path: str) -> dict:
        return self._files.material_file_siblings(file_path)

    def unlock_material_pdf(self, payload: dict):
        return self._files.unlock_material_pdf(payload)


    def rename_material_file(self, payload: dict):
        return self._files.rename_material_file(payload)

    def delete_material_file(self, payload: dict):
        return self._files.delete_material_file(payload)

    def create_material_file(self, payload: dict):
        return self._files.create_material_file(payload)

    def create_material_folder(self, payload: dict):
        return self._files.create_material_folder(payload)

    def rename_material_folder(self, payload: dict):
        return self._files.rename_material_folder(payload)

    def delete_material_folder(self, payload: dict):
        return self._files.delete_material_folder(payload)

    def transfer_material_entries(self, payload: dict):
        return self._files.transfer_material_entries(payload)

    def move_material_file(self, payload: dict):
        return self._files.move_material_file(payload)

    def move_material_entry(self, payload: dict):
        return self._files.move_material_entry(payload)

    def _material_practice_events(self):
        return self._practice._material_practice_events()

    def cancel_material_practice_generation(self, payload: dict):
        return self._practice.cancel_material_practice_generation(payload)

    def cancel_all_material_practice_generations(self):
        return self._practice.cancel_all_material_practice_generations()

    def generate_material_practice(self, payload: dict):
        return self._practice.generate_material_practice(payload)

    def _generate_material_practice_impl(self, payload: dict, generation_id: str, cancel_event: threading.Event):
        return self._practice._generate_material_practice_impl(payload, generation_id, cancel_event)

    @property
    def lecture_materials_cache_lock(self):
        return self._catalog.lecture_materials_cache_lock

    @lecture_materials_cache_lock.setter
    def lecture_materials_cache_lock(self, value):
        self._catalog.lecture_materials_cache_lock = value

    @property
    def _lecture_materials_cache(self):
        return self._catalog._lecture_materials_cache

    @_lecture_materials_cache.setter
    def _lecture_materials_cache(self, value):
        self._catalog._lecture_materials_cache = value

    @property
    def _lecture_materials_cache_key(self):
        return self._catalog._lecture_materials_cache_key

    @_lecture_materials_cache_key.setter
    def _lecture_materials_cache_key(self, value):
        self._catalog._lecture_materials_cache_key = value

    @property
    def _lecture_materials_cache_at(self):
        return self._catalog._lecture_materials_cache_at

    @_lecture_materials_cache_at.setter
    def _lecture_materials_cache_at(self, value):
        self._catalog._lecture_materials_cache_at = value

    @property
    def _material_file_service_instance(self):
        return self._material_file_service()

    @_material_file_service_instance.setter
    def _material_file_service_instance(self, value):
        with self._component_lock:
            if self._closed:
                raise RuntimeError("Material workspace is closed")
            self._content_instance = value

    @property
    def _material_practice_events_lock(self):
        return self._practice._material_practice_events_lock

    @_material_practice_events_lock.setter
    def _material_practice_events_lock(self, value):
        self._practice._material_practice_events_lock = value

    @property
    def _material_practice_active_events(self):
        return self._practice._material_practice_active_events

    @_material_practice_active_events.setter
    def _material_practice_active_events(self, value):
        self._practice._material_practice_active_events = value
