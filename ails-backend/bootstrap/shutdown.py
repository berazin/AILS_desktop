"""Compose resource teardown; unused domain services remain uninitialized."""
import sys


def configure_shutdown(state):
    lifetime = state.lifetime
    lifetime.register("service registry", state._services.close)
    lifetime.register("embedding runtime", state.search_runtime.close)
    lifetime.register("OCR process", lambda: _close_loaded("pdf.ocr_gpu_worker", "_worker_client"))
    # Reverse registration order: cancel work before closing its resources.
    lifetime.register("voice models", lambda: _close_loaded("voice.llama_cpp_voice_agent", "VOICE_AGENT_RUNTIME"))
    lifetime.register("voice recognition", lambda: _close_loaded("voice.voice_recognition", "VOICE_RECOGNITION_SERVICE"))
    for key in ("memory", "lms_browser", "notebook", "pdf_viewer", "auto_review", "materials", "office_studio"):
        lifetime.register(key, lambda key=key: _close_service(state, key))
    lifetime.register("background documents", lambda: _close_service(state, "background_documents", "stop"))
    lifetime.register("summary engine", lambda: state._engine.close() if state._engine is not None else None)
    lifetime.register("startup recovery", lambda: _close_scan(state))


def _close_loaded(module_name, resource):
    module = sys.modules.get(module_name)
    instance = getattr(module, resource, None) if module is not None else None
    if instance is not None:
        shutdown = getattr(instance, "shutdown", None) or instance.close
        shutdown()


def _close_service(state, key, method="close"):
    instance = state._services.peek(key)
    if instance is not None:
        getattr(instance, method)()


def _close_scan(state):
    scan = getattr(state, "startup_material_scan", None)
    if scan is not None:
        scan.close()
