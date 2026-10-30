"""Compatibility exports. Implementation belongs to code_services.kernel_service."""
from __future__ import annotations
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module("code_services.kernel_service"), name)

from bootstrap.service_adapter import service_call as _service_call


class NotebookMixin:
    """Stable API methods delegating to the notebook service."""
    def python_runtime_status(self) -> dict:
        return _service_call(self, "notebook", 'python_runtime_status')

    def validate_python_executable(self, payload: dict) -> dict:
        return _service_call(self, "notebook", 'validate_python_executable', payload)

    def get_notebook_kernel(self, notebook_path: str):
        return _service_call(self, "notebook", 'get_notebook_kernel', notebook_path)

    def restart_notebook_kernel(self, payload: dict):
        return _service_call(self, "notebook", 'restart_notebook_kernel', payload)

    def _restart_notebook_kernel(self, payload: dict):
        return _service_call(self, "notebook", '_restart_notebook_kernel', payload)

    def execute_notebook_cell(self, payload: dict, emit=None):
        return _service_call(self, "notebook", 'execute_notebook_cell', payload, emit)

    def _execute_notebook_cell(self, payload: dict, emit, cancelled):
        return _service_call(self, "notebook", '_execute_notebook_cell', payload, emit, cancelled)
