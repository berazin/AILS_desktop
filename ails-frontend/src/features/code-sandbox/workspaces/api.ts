import { requestJson, waitForLocalBackend } from "../../../lib/api/core.ts"

export type CodeWorkspace = {
  id: string
  path: string
  name: string
  available: boolean
  opened: number
  pdfs: { id: string; path: string; available: boolean }[]
}
export type WorkspaceEntry = { name: string; path: string; directory: boolean; symlink: boolean }
export type WorkspaceFile = { path: string; text: string; revision: string }
export type WorkspaceProject = CodeWorkspace & { modified: number; error: string }

export async function workspaceRequest<T>(operation: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) {
  // These POST-shaped catalog reads are safe to wait for; workspace mutations
  // remain immediate failures before readiness and are never silently replayed.
  if (operation === "list" || operation === "browse") await waitForLocalBackend(signal)
  return requestJson<T>("/code/workspaces", {
    method: "POST", body: JSON.stringify({ operation, ...payload }), signal,
  })
}
export const listWorkspaces = (signal?: AbortSignal) => workspaceRequest<{ workspaces: CodeWorkspace[] }>("list", {}, signal)
export const browseWorkspaceProjects = (signal?: AbortSignal) => workspaceRequest<{ root: string; projects: WorkspaceProject[] }>("browse", {}, signal)
export const createWorkspace = () => workspaceRequest<{ workspace: CodeWorkspace }>("new")
export const openWorkspace = (path: string, create = false, fork = false, expectedId?: string) =>
  workspaceRequest<{ workspace: CodeWorkspace }>("open", { path, create, fork, expected_id: expectedId })
