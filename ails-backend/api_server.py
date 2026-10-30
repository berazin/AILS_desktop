"""Stable AILS backend entrypoint. Runtime composition lives in bootstrap."""
from __future__ import annotations
import sys
import os

_DIR = os.path.abspath(os.path.dirname(__file__))
_ROOT = os.path.dirname(_DIR)
for _path in (_DIR, _ROOT):
    if _path not in sys.path:
        sys.path.insert(0, _path)

sys.modules.setdefault("api_server", sys.modules[__name__])

if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--lightweight-viewer":
    from documents.lightweight_viewer import main as viewer_main
    viewer_main(sys.argv[2:])
    raise SystemExit(0)

if "--ails-ipykernel" in sys.argv:
    from code_services.kernel_support import run_notebook_kernel_launcher
    run_notebook_kernel_launcher()
    raise SystemExit(0)

from bootstrap.console import configure_console
configure_console()
from bootstrap.startup_diagnostics import mark_startup_phase
mark_startup_phase("python-entry")

from bootstrap.numerical_runtime import prepare_numerical_runtime
prepare_numerical_runtime()
mark_startup_phase("numerical-runtime-ready")

from bootstrap.application import ApiState
from bootstrap.http_server import AILSThreadingHTTPServer, default_frontend_dir, main
from bootstrap.legacy_exports import resolve as _resolve_legacy_export
mark_startup_phase("python-imports-ready")


def __getattr__(name):
    return _resolve_legacy_export(name)


if __name__ == "__main__":
    if sys.argv[1:] == ["--desktop-bootstrap"]:
        from bootstrap.desktop_handshake import accept_desktop_start
        if not accept_desktop_start():
            raise SystemExit(0)
    if getattr(sys, "frozen", False):
        import multiprocessing
        multiprocessing.freeze_support()
    main()
