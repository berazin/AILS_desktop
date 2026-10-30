"""No notebook/runtime imports in the commercial API composition."""
from ide_policy import require_ide
NOTEBOOK_KERNEL_LAUNCH_ARG = "--ails-ipykernel"
def disabled(*args, **kwargs):
    require_ide()
build_notebook_kernel_argv = run_notebook_kernel_launcher = disabled
class NotebookMixin:
    python_runtime_status = validate_python_executable = execute_notebook_cell = restart_notebook_kernel = disabled
