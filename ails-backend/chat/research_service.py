"""ResearchService: feature operations and owned state."""
from __future__ import annotations
from chat.research_support import (
    Any,
    Callable,
    Path,
    calculate,
    common,
    dataclass,
    document_outline,
    grep_search,
    page_image,
    read_context,
    safe_path,
    supports_vision,
)
from chat.research_support import __name__ as _support_name
from importlib import import_module as _import_module

def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_import_module(_support_name), name)

@dataclass(frozen=True)
class ResearchServicePorts:
    """Only the collaborators required by this feature; no API state object."""
    get_config: Callable[[], Any]
    replace_config: Callable[[dict], None]
    local_provider_model: Callable[..., Any]
    managed_workflow_model: Callable[..., Any]
    search_materials: Callable[..., Any]
    selected_ai_model: Callable[..., Any]

class ResearchService:
    def __init__(self, ports: ResearchServicePorts):
        self._ports = ports
        self.local_provider_model = ports.local_provider_model
        self.managed_workflow_model = ports.managed_workflow_model
        self.search_materials = ports.search_materials
        self.selected_ai_model = ports.selected_ai_model

    @property
    def config(self):
        return self._ports.get_config()

    @config.setter
    def config(self, value):
        self._ports.replace_config(value)

    def research_scope(self, workspace_id=None):
        if workspace_id:
            from ide_policy import require_ide
            require_ide()
            from code_services.workspace_store import WorkspaceStore
            database = Path(common.APP_BASE_DIR) / ".ails" / "code-workspaces.sqlite3"
            if not database.is_file():
                raise ValueError("Code workspace is not registered.")
            return str(WorkspaceStore(database)._root(str(workspace_id)))
        return str(self.config.get("md_save_path") or "")

    def research_vision_supported(self):
        selection = self.selected_ai_model("chatbot")
        if selection["mode"] == "local":
            provider, model = self.local_provider_model("chatbot")
        else:
            provider = "ChatGPT 구독" if selection["mode"] == "chatgpt" else "AILS"
            model = selection.get("modelId") or self.managed_workflow_model("chatbot") or ""
        return supports_vision(provider, model)

    def execute_research_tool(self, payload):
        result = self._execute_research_tool(payload)
        from chat.answer_evidence import evidence_for_chunks
        if result.get("path") and result.get("text") and result.get("status") != "stale":
            result["evidence"] = evidence_for_chunks(result["path"], [result])
        for item in result.get("results", []):
            if item.get("path") and (item.get("snippet") or item.get("text")):
                item["evidence"] = evidence_for_chunks(item["path"], [item])
        return result

    def _execute_research_tool(self, payload):
        name = str(payload.get("name") or "")
        args = payload.get("arguments")
        if not isinstance(args, dict):
            raise ValueError("Tool arguments must be an object.")
        if name == "calculator":
            return calculate(args.get("expression"))
        root = self.research_scope(args.get("workspace_id"))
        if name == "grep_search": return grep_search(root, args)
        if name == "read_context": return read_context(root, args)
        if name == "get_document_outline": return document_outline(root, args)
        if name == "semantic_search":
            if not root or not Path(root).is_dir():
                return {"status": "unavailable", "results": [], "reason": "No accessible workspace is configured."}
            # Reuse readiness, vector matrix and reranker through the existing API.
            if args.get("workspace_id"):
                import chat.theory_search as source
                if source.embedding_backend_status().get("status") != "ready":
                    source.warm_embedding_backend()
                    return {"status": "loading", "results": []}
                return source.search_materials_semantic(root, str(args.get("query") or ""), limit=max(1, min(int(args.get("limit") or 5), 5)))
            return self.search_materials({"query": args.get("query"), "mode": "semantic", "limit": max(1, min(int(args.get("limit") or 5), 5))})
        if name == "inspect_pdf_page":
            path = safe_path(root, args.get("path"))
            if Path(path).suffix.casefold() != ".pdf": raise ValueError("Expected a PDF document.")
            if int(args.get("page") or 0) < 1: raise ValueError("Page must be positive.")
            result = read_context(root, {**args, "line": 1, "before": 0, "after": 100})
            if result["status"] == "stale": return result
            from documents.answer_key_visibility import hidden
            visual = self.research_vision_supported() and not hidden(path, int(args.get("page") or 0))
            if visual:
                page_image(path, int(args.get("page") or 0), result["revision"])
            return {**result, "status": "ready" if visual else "text_only", "image_attached": visual,
                    "reason": "Original page image will be included in the next chatbot round." if visual
                    else "Selected model has no confirmed vision support. Only available OCR/native text can be read; visual details remain unverified."}
        raise ValueError("Unknown research tool.")
