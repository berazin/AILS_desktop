"""StudyRecordsService: feature operations and owned state."""
from __future__ import annotations
from documents.study_records_support import (
    Any,
    Callable,
    Mapping,
    Path,
    StudyStore,
    dataclass,
    normalize_practice_context,
    os,
    pdf,
    resolve_app_path,
)
from documents.study_records_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class StudyRecordsServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]

class StudyRecordsService:
    def __init__(self, ports: StudyRecordsServicePorts):
        self._ports = ports
        self._pdf_study_service_instance = self._create_pdf_study_service()

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def _create_pdf_study_service(self):
        from documents.pdf_study_service import PdfStudyService
        return PdfStudyService(lambda: resolve_app_path(self.config.get("md_save_path", "")))

    def _pdf_study_service(self):
        service = getattr(self, "_pdf_study_service_instance", None)
        if service is None:
            service = self._create_pdf_study_service()
            self._pdf_study_service_instance = service
        return service

    def _ails_state_dir(self):
        return self._pdf_study_service()._ails_state_dir()

    def _pdf_page_state_path(self):
        return self._pdf_study_service()._pdf_page_state_path()

    def _normalize_pdf_page_key(self, value: str):
        return self._pdf_study_service()._normalize_pdf_page_key(value)

    def _pdf_page_key_exists(self, path_key: str):
        return self._pdf_study_service()._pdf_page_key_exists(path_key)

    def _write_pdf_page_state(self, state_path: str, pages: dict[str, int]):
        return self._pdf_study_service()._write_pdf_page_state(state_path, pages)

    def read_pdf_page_state(self):
        return self._pdf_study_service().read_pdf_page_state()

    def save_pdf_page_state(self, payload: dict):
        return self._pdf_study_service().save_pdf_page_state(payload)

    def sync_pdf_page_state(self, payload: dict):
        return self._pdf_study_service().sync_pdf_page_state(payload)

    def update_pdf_page_state(self, payload: dict):
        return self._pdf_study_service().update_pdf_page_state(payload)

    def _pdf_study_store(self) -> StudyStore:
        return self._pdf_study_service()._pdf_study_store()


    def pdf_outline_status(self, path: str) -> dict:
        import pdf.pdf_ocr
        state_dir = self._ails_state_dir()
        if not state_dir:
            appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
            state_dir = os.path.join(appdata, "AILS", ".ails")
        return pdf.pdf_ocr.pdf_ocr_status(path, outline_state_dir=state_dir)


    def save_pdf_chat_turn(self, payload: Mapping):
        return self._pdf_study_store().save_chat_turn(
            pdf_path=payload.get("pdf_path", ""),
            turn_id=payload.get("turn_id", ""),
            question=payload.get("question", ""),
            answer=payload.get("answer", ""),
            concept_summary=str(payload.get("concept_summary") or "").strip(),
            session_id=payload.get("session_id", ""),
            model=payload.get("model", ""),
            provider=payload.get("provider", ""),
            created_at=payload.get("created_at"),
            answer_evidence=payload.get("answer_evidence"),
            web_search=payload.get("web_search"),
            **({"practice_context": normalize_practice_context(payload["practice_context"])} if isinstance(payload.get("practice_context"), Mapping) else {}),
        )

    def list_pdf_chat_turns(self, payload: Mapping):
        return self._pdf_study_store().list_chat_turns(
            pdf_path=payload.get("path", payload.get("pdf_path", "")),
            session_id=payload.get("session_id", ""),
        )

    def list_pdf_chat_sessions(self, payload: Mapping):
        return self._pdf_study_store().list_chat_sessions(
            pdf_path=payload.get("path", payload.get("pdf_path", "")),
        )

    def list_pdf_chat_concepts(self, payload: Mapping):
        return self._pdf_study_store().list_chat_concepts(
            pdf_path=payload.get("path", payload.get("pdf_path", "")),
        )

    def delete_pdf_chat_turns(self, payload: Mapping):
        return self._pdf_study_store().delete_chat_turns(
            pdf_path=payload.get("path", payload.get("pdf_path", "")),
            session_id=payload.get("session_id", ""),
            purge_document=payload.get("purge") in (True, "1", "true", "yes"),
        )

    def delete_pdf_chat_turn(self, payload: Mapping):
        return self._pdf_study_store().delete_chat_turn(
            turn_id=payload.get("turn_id", ""),
        )

    def save_pdf_annotation(self, payload: Mapping):
        return self._pdf_study_store().save_annotation(
            pdf_path=payload.get("pdf_path", payload.get("path", "")),
            annotation=payload.get("annotation"),
        )

    def list_pdf_annotations(self, payload: Mapping):
        return self._pdf_study_store().list_annotations(
            pdf_path=payload.get("path", payload.get("pdf_path", "")),
        )

    def delete_pdf_annotation(self, payload: Mapping):
        return self._pdf_study_store().delete_annotation(
            pdf_path=payload.get("path", payload.get("pdf_path", "")),
            annotation_id=payload.get("annotation_id", ""),
        )

    def start_pdf_study_session(self, payload: Mapping):
        return self._pdf_study_store().start_session(
            pdf_path=payload.get("pdf_path", payload.get("path", "")),
        )

    def record_pdf_study_activity(self, payload: Mapping):
        return self._pdf_study_store().record_session_activity(
            session_id=payload.get("session_id", ""),
            active_seconds=payload.get("active_seconds", 0),
            page=payload.get("page"),
        )

    def pdf_study_document_info(self, payload: Mapping):
        return self._pdf_study_store().document_info(
            pdf_path=payload.get("path", payload.get("pdf_path", "")),
        )

    def toggle_pdf_bookmark(self, payload: Mapping):
        return self._pdf_study_store().toggle_bookmark(
            pdf_path=payload.get("pdf_path", payload.get("path", "")),
            page=payload.get("page"),
            label=payload.get("label", ""),
        )

    def save_pdf_document_note(self, payload: Mapping):
        return self._pdf_study_store().save_document_note(
            pdf_path=payload.get("pdf_path", payload.get("path", "")),
            note=payload.get("note", ""),
        )

    def save_pdf_document_tags(self, payload: Mapping):
        return self._pdf_study_store().save_document_tags(
            pdf_path=payload.get("pdf_path", payload.get("path", "")),
            tags=payload.get("tags"),
        )

    def list_pdf_document_metas(self):
        # The home workspace requests this list before a save folder is set.
        # There are no persisted records to list; writes still require a folder.
        if not resolve_app_path(self.config.get("md_save_path", "")):
            return {"metas": []}
        return self._pdf_study_store().list_document_metas()
