"""KernelService: feature operations and owned state."""
from __future__ import annotations
from code_services.kernel_support import (
    Any,
    Callable,
    build_notebook_kernel_argv,
    child_environment,
    data_root,
    dataclass,
    documents,
    environment_activity,
    execute_kernel_cell,
    execution_error,
    independent_python_spawn,
    json,
    notebook_execution_output_text,
    notebook_source_to_text,
    notebook_worker,
    os,
    parse_notebook_json,
    python_runtime,
    read_notebook_json_file,
    resolve_app_path,
    resolve_environment,
    threading,
    uuid,
)
from code_services.kernel_support import __name__ as _support_name
from importlib import import_module as _import_module
import time
import logging

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class KernelServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    read_material_file: Callable[..., Any]

class KernelService:
    def close(self):
        with self.notebook_kernel_lock:
            self._closing = True
            workers = list(self._notebook_workers.items())
        pending = []
        for path, worker in workers:
            future = worker.close(lambda path=path: self._release_kernel(path))
            if future is not None:
                pending.append(future)
        deadline = time.monotonic() + 3.0
        for future in pending:
            try:
                future.result(timeout=max(0.0, deadline - time.monotonic()))
            except Exception:
                logging.getLogger(__name__).exception("Notebook cleanup did not finish before shutdown")

    def __init__(self, ports: KernelServicePorts):
        self._ports = ports
        self.read_material_file = ports.read_material_file
        self.notebook_kernel_lock = threading.Lock()
        self.notebook_kernels = {}
        self._notebook_workers = {}
        self._closing = False

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def python_runtime_status(self) -> dict:
        from ide_policy import require_ide
        require_ide()
        return python_runtime.runtime_status(self.config)

    def validate_python_executable(self, payload: dict) -> dict:
        return python_runtime.validate_python_executable(payload.get("path"))

    def get_notebook_kernel(self, notebook_path: str):
        try:
            from jupyter_client.manager import KernelManager
            from jupyter_client.kernelspec import KernelSpec
            from jupyter_client.provisioning.local_provisioner import LocalProvisioner
        except ImportError as error:
            raise RuntimeError("ipynb 코드 실행에는 jupyter_client와 ipykernel이 필요합니다.") from error

        normalized = os.path.abspath(notebook_path)
        environment = resolve_environment(normalized, self.config)
        with self.notebook_kernel_lock:
            current = self.notebook_kernels.get(normalized)
            manager = current.get("manager") if isinstance(current, dict) else None
            client = current.get("client") if isinstance(current, dict) else None
            if manager is not None and client is not None:
                try:
                    if manager.is_alive() and current.get("environment", {}).get("id") == environment["id"]:
                        return current
                except Exception:
                    pass
                try:
                    client.stop_channels()
                    manager.shutdown_kernel(now=True)
                except Exception:
                    pass
                self.notebook_kernels.pop(normalized, None)

            kernel_dir = os.path.dirname(normalized)
            kernel_manager = KernelManager(kernel_name="")
            kernel_manager.kernel_id = str(uuid.uuid4())
            kernel_manager._kernel_spec = KernelSpec(
                argv=build_notebook_kernel_argv(self.config, kernel_dir, environment),
                display_name="AILS Python",
                language="python",
            )
            kernel_manager.provisioner = LocalProvisioner(
                kernel_id=kernel_manager.kernel_id,
                kernel_spec=kernel_manager.kernel_spec,
                parent=kernel_manager,
            )
            kernel_env = child_environment(environment["python"], data_root())
            with independent_python_spawn():
                kernel_manager.start_kernel(cwd=os.path.dirname(normalized) or None, env=kernel_env)
            kernel_client = kernel_manager.client()
            kernel_client.start_channels()
            try:
                # A fresh Windows environment may still be populating its bytecode
                # cache. Keep startup bounded without killing a healthy cold kernel.
                kernel_client.wait_for_ready(timeout=60)
            except Exception:
                try:
                    kernel_client.stop_channels()
                    kernel_manager.shutdown_kernel(now=True)
                except Exception:
                    pass
                raise

            kernel = {"manager": kernel_manager, "client": kernel_client, "environment": environment, "python_warning": ""}
            self.notebook_kernels[normalized] = kernel
            return kernel

    def restart_notebook_kernel(self, payload: dict):
        from ide_policy import require_ide
        require_ide()
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        path = documents.material_workspace_support.ensure_safe_material_path(payload.get("path", "") or payload.get("file_path", ""), base_dir)
        worker = notebook_worker(self, path)
        worker.cancelled.set()
        return worker.run(lambda: self._restart_notebook_kernel(payload))

    def _restart_notebook_kernel(self, payload: dict):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        normalized = documents.material_workspace_support.ensure_safe_material_path(payload.get("path", "") or payload.get("file_path", ""), base_dir)
        return self._release_kernel(normalized)

    def _release_kernel(self, normalized: str):
        # Already-owned resources must close even after the workspace changes.
        with self.notebook_kernel_lock:
            current = self.notebook_kernels.pop(normalized, None)
            if isinstance(current, dict):
                try:
                    if current.get("client"):
                        current["client"].stop_channels()
                except Exception:
                    pass
                try:
                    if current.get("manager"):
                        current["manager"].shutdown_kernel(now=True)
                except Exception:
                    pass
            return {"restarted": True}

    def execute_notebook_cell(self, payload: dict, emit=None):
        from ide_policy import require_ide
        require_ide()
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        path = documents.material_workspace_support.ensure_safe_material_path(payload.get("path", "") or payload.get("file_path", ""), base_dir)
        worker = notebook_worker(self, path)

        def execute():
            worker.begin_execution()
            return self._execute_notebook_cell(payload, emit, worker.cancelled)

        return worker.run(execute)

    def _execute_notebook_cell(self, payload: dict, emit, cancelled):
        base_dir = resolve_app_path(self.config.get("md_save_path", ""))
        normalized = documents.material_workspace_support.ensure_safe_material_path(payload.get("path", "") or payload.get("file_path", ""), base_dir)
        if os.path.splitext(normalized)[1].lower() != ".ipynb":
            raise ValueError("ipynb 파일의 code 셀만 실행할 수 있습니다.")

        try:
            cell_index = int(payload.get("cell_index", -1))
        except (TypeError, ValueError) as error:
            raise ValueError("실행할 셀 번호가 올바르지 않습니다.") from error

        try:
            timeout_seconds = int(payload.get("timeout", 60))
        except (TypeError, ValueError):
            timeout_seconds = 60
        timeout_seconds = max(5, min(timeout_seconds, 300))

        notebook = parse_notebook_json(read_notebook_json_file(normalized))
        cells = notebook.get("cells", []) if isinstance(notebook, dict) else []
        if not isinstance(cells, list) or cell_index < 0 or cell_index >= len(cells):
            raise ValueError("실행할 ipynb 셀을 찾을 수 없습니다.")
        cell = cells[cell_index]
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            raise ValueError("code 셀만 실행할 수 있습니다.")

        code = notebook_source_to_text(cell.get("source", ""))
        changes_packages = any(line.lstrip().startswith(("%pip ", "%uv ")) for line in code.splitlines())
        if changes_packages and "timeout" not in payload:
            timeout_seconds = 900
        outputs: list[dict] = []
        execution_count = None
        kernel = None

        def send(event):
            if callable(emit):
                emit(event)

        if code.strip():
            try:
                send({"type": "status", "phase": "preparing", "timeout_seconds": timeout_seconds})
                kernel = self.get_notebook_kernel(normalized)
            except (BrokenPipeError, ConnectionResetError):
                return {}
            except Exception as error:
                outputs = [execution_error(type(error).__name__, error)]
                send({"type": "output", "outputs": outputs, "execution_count": None})
            else:
                try:
                    with environment_activity(kernel["environment"]["python"], mutate=changes_packages):
                        outputs, execution_count = execute_kernel_cell(kernel, code, timeout_seconds, send, cancelled)
                except (BrokenPipeError, ConnectionResetError):
                    return {}
                except Exception as error:
                    outputs = [execution_error(type(error).__name__, error)]
                    send({"type": "output", "outputs": outputs, "execution_count": None})
        else:
            execution_count = None

        # Edits in another cell may have been saved while this one was running.
        latest = parse_notebook_json(read_notebook_json_file(normalized))
        latest_cells = latest.get("cells", [])
        if cell_index < len(latest_cells) and notebook_source_to_text(latest_cells[cell_index].get("source", "")) == code:
            notebook = latest
            cell = latest_cells[cell_index]
        else:
            raise RuntimeError("실행 중 셀 구조 또는 코드가 변경되어 실행 결과를 저장하지 못했습니다.")
        cell["outputs"] = outputs
        cell["execution_count"] = execution_count
        with open(normalized, "w", encoding="utf-8", errors="replace") as handle:
            handle.write(json.dumps(notebook, ensure_ascii=False, indent=2))

        text = "\n".join(notebook_execution_output_text(output) for output in outputs).strip()
        result = {
            **({"file": self.read_material_file(normalized)} if payload.get("return_file", True) else {}),
            "outputs": outputs,
            "execution_count": execution_count,
            "text": text,
            "python_warning": "패키지를 변경했다면 Kernel 메뉴에서 커널을 재시작해 주세요." if changes_packages else "",
            "restart_required": changes_packages,
        }
        send({"type": "done", **result})
        return result
