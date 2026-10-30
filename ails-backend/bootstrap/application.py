"""Local application composition and public API facade."""
from __future__ import annotations
import os
import sys
import subprocess
import threading
from pathlib import Path
from settings.configuration import Configuration
from jobs.lifecycle import ApplicationLifetime
from search.embedding_runtime import EmbeddingRuntime
from bootstrap.state_facade import ServiceStateFacade
from bootstrap.service_adapter import services_for
from bootstrap.shutdown import configure_shutdown
import python_runtime
from server_config import load_config
from common import append_status_log
from server_config import config_for_ui
from server_config import PhoenixTelemetry
from common import is_debug_trace_enabled
from edition_manifest import EditionFeatureDisabled
from edition_manifest import EDITION_MANIFEST
from api_modules.api_managed_auth import ManagedAuthMixin
from api_modules.api_problem_review import ProblemReviewMixin
from api_modules.api_lms_browser import ApiLmsBrowserMixin
from api_modules.api_code_assist import ApiCodeAssistMixin
from api_modules.api_chat_memory import ChatMemoryMixin
from api_modules.api_chatbot import ApiChatbotMixin
from api_modules.api_research_tools import ResearchToolsMixin
from api_modules.api_material_search import MaterialSearchMixin
from api_modules.api_pdf_work import PdfWorkMixin
from api_modules.api_pdf_viewer import PdfViewerMixin
from api_modules.api_notebook import NotebookMixin
from api_modules.api_model_options import ModelOptionsMixin
from api_modules.api_work_preflight import WorkPreflightMixin
from api_modules.api_voice_video import VoiceVideoAiMixin
from api_modules.api_pdf_study import PdfStudyMixin
from api_modules.api_lecture_materials import LectureMaterialsMixin
from api_modules.api_material_practice import MaterialPracticeMixin
from api_modules.api_insight_book import InsightBookMixin
from api_modules.api_engine_tasks import EngineTasksMixin


class ApiState(ServiceStateFacade, ManagedAuthMixin, ProblemReviewMixin, ApiLmsBrowserMixin, ApiCodeAssistMixin, ChatMemoryMixin, ApiChatbotMixin, ResearchToolsMixin, MaterialSearchMixin, PdfWorkMixin, PdfViewerMixin, NotebookMixin, ModelOptionsMixin, WorkPreflightMixin, VoiceVideoAiMixin, PdfStudyMixin, LectureMaterialsMixin, MaterialPracticeMixin, InsightBookMixin,
    EngineTasksMixin):
    def __init__(self, *, load_disk: bool = True):
        self._configuration = Configuration(load_config())
        self._services = services_for(self)
        self._engine = None
        self._engine_lock = threading.RLock()
        self.search_runtime = EmbeddingRuntime()
        self.phoenix = PhoenixTelemetry() if PhoenixTelemetry is not None else None
        self.lifetime = ApplicationLifetime()
        configure_shutdown(self)
        python_runtime.set_config_source(lambda: self.config)
        if load_disk:
            self.refresh_reports_from_disk()
            self.refresh_retry_candidates_from_disk()

    def close(self):
        self.lifetime.close()

    @property
    def background_work(self):
        return services_for(self).get("background_documents")

    @property
    def engine(self):
        with self._engine_lock:
            if self._engine is None:
                if self.lifetime.stopping.is_set():
                    raise RuntimeError("AILS is shutting down")
                from summary_generation import BackgroundEngine
                self._engine = BackgroundEngine()
            return self._engine

    @engine.setter
    def engine(self, value):
        self._engine = value
        if not hasattr(self, "_engine_lock"):
            self._engine_lock = threading.RLock()

    @property
    def config(self):
        return self._configuration.value

    @config.setter
    def config(self, value):
        if not hasattr(self, "_configuration"):
            self._configuration = Configuration(value)
        else:
            self._configuration.replace(value)

    @property
    def lock(self):
        return self._configuration.lock

    @lock.setter
    def lock(self, value):
        if not hasattr(self, "_configuration"):
            self._configuration = Configuration({})
        self._configuration.lock = value

    def append_idle_log(self, message: str):
        with self.engine.lock:
            logs = self.engine.status.setdefault("logs", [])
            append_status_log(logs, message)

    def append_ai_debug_trace(self, label: str, content, event_type: str, *, source: str, model: str = "") -> None:
        engine = getattr(self, "engine", None)
        debug_enabled = is_debug_trace_enabled(self.config)
        phoenix = getattr(self, "phoenix", None)
        phoenix_enabled = bool(phoenix is not None and phoenix.enabled(self.config))
        if engine is None or not (debug_enabled or phoenix_enabled):
            return
        direction = "input" if event_type in {"prompt", "request", "input"} else "output"
        if debug_enabled:
            engine.append_debug_trace(
                label,
                content,
                event_type,
                source=source,
                direction=direction,
                model=model,
            )
        if phoenix_enabled:
            phoenix.record_event(
                self.config,
                label=label,
                event_type=event_type,
                source=source,
                model=model,
                content_length=len(str(content or "")),
            )

    def open_local_path(self, path: str):
        normalized = str(path or "").strip()
        if not normalized:
            raise ValueError("열 경로가 비어 있습니다.")
        if not os.path.exists(normalized):
            raise ValueError(f"경로를 찾을 수 없습니다: {normalized}")
        if sys.platform.startswith("win"):
            os.startfile(normalized)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", normalized])
        else:
            subprocess.Popen(["xdg-open", normalized])
        return {"opened": True, "path": os.path.abspath(normalized)}

    def open_distribution_licenses(self):
        candidates = []
        if getattr(sys, "frozen", False):
            executable_dir = Path(sys.executable).resolve().parent
            candidates.append(executable_dir.parents[1] / "licenses")
        candidates.extend([
            Path(__file__).resolve().parents[2] / "docs",
            Path.cwd() / "licenses",
        ])
        license_dir = next((path for path in candidates if path.is_dir()), None)
        if license_dir is None:
            raise FileNotFoundError("배포 라이선스 폴더를 찾을 수 없습니다.")
        return self.open_local_path(str(license_dir))

    def public_config(self, include_secrets=False):
        return config_for_ui(self.config, include_secrets, self.has_lms_saved_password())

    def phoenix_status(self) -> dict:
        if self.phoenix is None:
            raise EditionFeatureDisabled("developer_tools", EDITION_MANIFEST["id"])
        return self.phoenix.status(self.config)
