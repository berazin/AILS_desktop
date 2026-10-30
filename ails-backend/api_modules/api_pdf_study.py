"""Compatibility exports. Implementation belongs to documents.study_records_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("documents.study_records_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class PdfStudyMixin:
    """Stable API methods delegating to the study service."""
    def _create_pdf_study_service(self):
        return _service_call(self, "study", '_create_pdf_study_service')

    def _pdf_study_service(self):
        return _service_call(self, "study", '_pdf_study_service')

    def _ails_state_dir(self):
        return _service_call(self, "study", '_ails_state_dir')

    def _pdf_page_state_path(self):
        return _service_call(self, "study", '_pdf_page_state_path')

    def _normalize_pdf_page_key(self, value: str):
        return _service_call(self, "study", '_normalize_pdf_page_key', value)

    def _pdf_page_key_exists(self, path_key: str):
        return _service_call(self, "study", '_pdf_page_key_exists', path_key)

    def _write_pdf_page_state(self, state_path: str, pages: dict[str, int]):
        return _service_call(self, "study", '_write_pdf_page_state', state_path, pages)

    def read_pdf_page_state(self):
        return _service_call(self, "study", 'read_pdf_page_state')

    def save_pdf_page_state(self, payload: dict):
        return _service_call(self, "study", 'save_pdf_page_state', payload)

    def sync_pdf_page_state(self, payload: dict):
        return _service_call(self, "study", 'sync_pdf_page_state', payload)

    def update_pdf_page_state(self, payload: dict):
        return _service_call(self, "study", 'update_pdf_page_state', payload)

    def _pdf_study_store(self) -> StudyStore:
        return _service_call(self, "study", '_pdf_study_store')

    def pdf_outline_status(self, path: str) -> dict:
        return _service_call(self, "study", 'pdf_outline_status', path)

    def save_pdf_chat_turn(self, payload: Mapping):
        return _service_call(self, "study", 'save_pdf_chat_turn', payload)

    def list_pdf_chat_turns(self, payload: Mapping):
        return _service_call(self, "study", 'list_pdf_chat_turns', payload)

    def list_pdf_chat_sessions(self, payload: Mapping):
        return _service_call(self, "study", 'list_pdf_chat_sessions', payload)

    def list_pdf_chat_concepts(self, payload: Mapping):
        return _service_call(self, "study", 'list_pdf_chat_concepts', payload)

    def delete_pdf_chat_turns(self, payload: Mapping):
        return _service_call(self, "study", 'delete_pdf_chat_turns', payload)

    def delete_pdf_chat_turn(self, payload: Mapping):
        return _service_call(self, "study", 'delete_pdf_chat_turn', payload)

    def save_pdf_annotation(self, payload: Mapping):
        return _service_call(self, "study", 'save_pdf_annotation', payload)

    def list_pdf_annotations(self, payload: Mapping):
        return _service_call(self, "study", 'list_pdf_annotations', payload)

    def delete_pdf_annotation(self, payload: Mapping):
        return _service_call(self, "study", 'delete_pdf_annotation', payload)

    def start_pdf_study_session(self, payload: Mapping):
        return _service_call(self, "study", 'start_pdf_study_session', payload)

    def record_pdf_study_activity(self, payload: Mapping):
        return _service_call(self, "study", 'record_pdf_study_activity', payload)

    def pdf_study_document_info(self, payload: Mapping):
        return _service_call(self, "study", 'pdf_study_document_info', payload)

    def toggle_pdf_bookmark(self, payload: Mapping):
        return _service_call(self, "study", 'toggle_pdf_bookmark', payload)

    def save_pdf_document_note(self, payload: Mapping):
        return _service_call(self, "study", 'save_pdf_document_note', payload)

    def save_pdf_document_tags(self, payload: Mapping):
        return _service_call(self, "study", 'save_pdf_document_tags', payload)

    def list_pdf_document_metas(self):
        return _service_call(self, "study", 'list_pdf_document_metas')
