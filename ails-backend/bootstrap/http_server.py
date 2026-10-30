"""HTTP transport and process entrypoint; domain work is composed separately."""
from __future__ import annotations
import argparse
import os
import sys
import threading
from pathlib import Path
from urllib.parse import urlparse
from http.server import ThreadingHTTPServer
from bootstrap.application import ApiState
from api_request_handler import AILSRequestHandler
from api_context import LOCAL_API_TOKEN_ENV, UI_ORIGIN_ENV
from code_services.code_executor import CodeExecutionManager
from edition_manifest import feature_enabled as _edition_feature_enabled
from documents.startup_material_scan import DeferredMaterialScan
from pdf.pdf_viewer_data import install_pypdf_wrong_pointing_log_filter
from bootstrap.startup_diagnostics import mark_startup_phase


def _normalized_ui_origin():
    raw = str(os.environ.get(UI_ORIGIN_ENV) or "").strip().rstrip("/").lower()
    return raw if raw.startswith(("http://", "https://")) else ""


class AILSThreadingHTTPServer(ThreadingHTTPServer):
    # The gateway forwards concurrent workspace reads. The default backlog of
    # five can drop local connection attempts while the first handlers import
    # their services, forcing otherwise tiny reads to wait for TCP retries.
    request_queue_size = 128

    def __init__(self, server_address, handler_class, state: ApiState, frontend_dir: Path, local_api_token: str = ""):
        self.code_execution_manager = CodeExecutionManager() if _edition_feature_enabled("ide") else None
        try:
            super().__init__(server_address, handler_class)
        except Exception:
            if self.code_execution_manager is not None:
                self.code_execution_manager.close()
            raise
        self.state = state
        self.frontend_dir = frontend_dir
        self.local_api_token = str(local_api_token or "")
        actual_host, actual_port = self.server_address[:2]
        allowed_origins = {f"http://127.0.0.1:{actual_port}", f"http://localhost:{actual_port}"}
        host_headers = {
            f"127.0.0.1:{actual_port}",
            f"localhost:{actual_port}",
            "127.0.0.1",
            "localhost",
        }
        if str(actual_host).lower().startswith("::1"):
            allowed_origins.update({"http://[::1]:%d" % actual_port, "http://ip6-localhost:%d" % actual_port})
            host_headers.update({f"[::1]:{actual_port}", f"ip6-localhost:{actual_port}"})
        ui_origin = _normalized_ui_origin()
        if ui_origin:
            allowed_origins.add(ui_origin)
            netloc = urlparse(ui_origin).netloc.rpartition("@")[2]
            if netloc:
                host_headers.add(netloc)
        self.allowed_origins = frozenset(allowed_origins)
        self.allowed_host_headers = frozenset(host_headers)

    def handle_error(self, request, client_address):
        """Do not print tracebacks for clients that closed an HTTP socket."""
        error = sys.exc_info()[1]
        if isinstance(error, Exception) and AILSRequestHandler.is_client_disconnect(error):
            return
        super().handle_error(request, client_address)

    def server_close(self):
        if self.code_execution_manager is not None:
            self.code_execution_manager.close()
        try:
            self.state.close()
        finally:
            super().server_close()


def default_frontend_dir() -> str:
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        candidates = [
            os.path.join(exe_dir, "ails-frontend", "dist"),
            os.path.join(exe_dir, "_internal", "ails-frontend", "dist"),
        ]
        for candidate in candidates:
            if os.path.exists(candidate):
                return os.path.abspath(candidate)
        return os.path.abspath(candidates[0])
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ails-frontend", "dist"))


def main():
    parser = argparse.ArgumentParser(description="AILS local React API server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--frontend", default=default_frontend_dir())
    parser.add_argument(
        "--probe-ocr-runtime",
        choices=("cuda", "openvino", "directml", "cpu"),
        help=argparse.SUPPRESS,
    )
    parser.add_argument("--verify-ocr-runtime", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.probe_ocr_runtime:
        from ocr_runtime import probe_packaged_ocr_runtime

        raise SystemExit(0 if probe_packaged_ocr_runtime(args.probe_ocr_runtime) else 1)
    if args.verify_ocr_runtime:
        from pdf.pdf_ocr import validate_ocr_runtime
        try:
            validate_ocr_runtime()
        except Exception:
            raise SystemExit(1)
        raise SystemExit(0)
    local_api_token = str(os.environ.get(LOCAL_API_TOKEN_ENV) or "").strip()
    if not local_api_token:
        print(
            f"Refusing to start: local API access token is required. Set the {LOCAL_API_TOKEN_ENV} environment variable.",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(2)
    state = ApiState(load_disk=False)
    mark_startup_phase("state-ready")
    state.startup_material_scan = DeferredMaterialScan(
        (lambda: state.background_work.configure(state.config, resume_pending=True),
         state.migrate_material_system_storage, state.refresh_reports_from_disk,
         state.refresh_retry_candidates_from_disk), state.append_idle_log,
    )
    install_pypdf_wrong_pointing_log_filter()
    server = AILSThreadingHTTPServer(
        (args.host, args.port),
        AILSRequestHandler,
        state,
        Path(args.frontend),
        local_api_token=local_api_token,
    )
    actual_host, actual_port = server.server_address[:2]
    mark_startup_phase("http-bound")
    if os.environ.get("AILS_PARENT_PIPE") == "1":
        def watch_parent():
            # The inherited pipe is private to the launcher; no shutdown API or
            # credentials are exposed to renderer content or network clients.
            try:
                while True:
                    command = sys.stdin.readline()
                    if not command or command.strip() == "shutdown":
                        server.shutdown()
                        return
            except (OSError, ValueError):
                server.shutdown()
        threading.Thread(target=watch_parent, name="ails-parent-lifetime", daemon=True).start()
    print(f"AILS API server listening on http://{actual_host}:{actual_port}", flush=True)
    if Path(args.frontend).exists():
        print(f"Serving frontend from {Path(args.frontend).resolve()}", flush=True)
    try:
        state.startup_material_scan.start()
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
