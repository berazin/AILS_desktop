"""Local API wiring for notebook environments, on the existing kernel owner thread."""
from common import resolve_app_path
from documents.material_workspace_support import ensure_safe_material_path
from code_services.notebook_worker import notebook_worker
from code_services import notebook_environments as environments, notebook_packages as packages


def notebook_environment_request(state, payload, emit=None):
    from ide_policy import require_ide
    require_ide()
    path = ensure_safe_material_path(payload.get("path", ""), resolve_app_path(state.config.get("md_save_path", "")))
    action = payload.get("action", "status")
    if action == "search":
        return packages.search_package(str(payload.get("query", "")))
    if action == "status":
        return environments.environment_status(path, state.config)
    if action == "packages":
        return packages.list_packages(environments.resolve_environment(path, state.config, prepare=False))

    def change():
        if action in ("create", "register", "select"):
            result = environments.change_environment(path, state.config, payload)
            state._restart_notebook_kernel({"path": path})
            return result
        if action in ("install", "uninstall"):
            environment = environments.resolve_environment(path, state.config)
            return packages.change_packages(environment, payload, emit or (lambda event: None))
        raise ValueError("Unknown notebook environment action")

    # Do not cancel running cells to satisfy a package request; the UI can retry after completion.
    return notebook_worker(state, path).run(change)
