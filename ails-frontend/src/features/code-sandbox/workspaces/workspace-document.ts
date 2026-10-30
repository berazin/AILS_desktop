import { getMaterialFile } from "../../../lib/api"
import { titleFromPath, viewerFromMaterial, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { workspaceRequest, type CodeWorkspace, type WorkspaceFile } from "./api.ts"

export async function loadWorkspaceDocument(workspace: CodeWorkspace | undefined, path: string, documents: readonly ViewerDocument[]) {
  const normalized = path.replace(/\\/g, "/")
  const existing = documents.find((item) => !item.loading && item.file_path.replace(/\\/g, "/").toLowerCase() === normalized.toLowerCase())
  if (existing) return existing
  const root = workspace?.path.replace(/\\/g, "/").replace(/\/+$/, "")
  if (workspace && root && normalized.toLowerCase().endsWith(".md") && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    // The workspace read API verifies its UUID, relative path and symlinks.
    // Project Markdown uses that boundary rather than the materials save root.
    const file = await workspaceRequest<WorkspaceFile>("read", { id: workspace.id, path: normalized.slice(root.length + 1) })
    return { id: path, title: titleFromPath(path), kind: "md", content: file.text, raw_content: file.text, file_path: path, read_only: true, source: "material" } satisfies ViewerDocument
  }
  return viewerFromMaterial((await getMaterialFile(path)).file)
}
