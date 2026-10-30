"""Notebook kernel lifecycle and ipynb cell execution.

Extracted from api_server.py to isolate Jupyter kernel management and
cell execution into a dedicated mixin.
"""

from __future__ import annotations

import json
import os
import sys
import uuid

from common import resolve_app_path
from code_services.notebook_execution import execute_kernel_cell, execution_error
from code_services.notebook_worker import notebook_worker
from code_services.notebook_environments import resolve_environment, environment_activity
from code_services.notebook_bundle import data_root
from code_services.notebook_process import child_environment, independent_python_spawn
from code_services.notebook_service import (
    notebook_execution_output_text,
    notebook_source_to_text,
    parse_notebook_json,
    read_notebook_json_file,
)

import documents.material_workspace_support
import python_runtime


def build_notebook_kernel_argv(config: dict | None = None, notebook_dir: str = "", environment: dict | None = None):
    from ide_policy import require_ide
    require_ide()
    selected = environment or resolve_environment(os.path.join(notebook_dir or os.getcwd(), "notebook.ipynb"), config)
    return [selected["python"], "-m", "ipykernel_launcher", "-f", "{connection_file}"]


def run_notebook_kernel_launcher():
    from ide_policy import require_ide
    require_ide()
    import runpy

    sys.argv = [sys.argv[0], *[arg for arg in sys.argv[1:] if arg != NOTEBOOK_KERNEL_LAUNCH_ARG]]
    runpy.run_module("ipykernel_launcher", run_name="__main__")


from dataclasses import dataclass
from collections.abc import Callable
from typing import Any
import threading



# api_server에서 이동: 노트북 커널 실행 인자 상수
NOTEBOOK_KERNEL_LAUNCH_ARG = "--ails-ipykernel"
