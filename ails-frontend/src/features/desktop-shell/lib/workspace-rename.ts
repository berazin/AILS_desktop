export type WorkspaceRenameTarget = { path: string; title: string; kind: string; newName?: string }
export type WorkspaceRenameResult = { error: string; path?: string; warning?: string }
export type WorkspaceRenameAction = (target: WorkspaceRenameTarget) => void | WorkspaceRenameResult | Promise<void | WorkspaceRenameResult>

/** Rebase a renamed folder's descendants without changing sibling prefixes. */
export function renamedWorkspacePath(path: string, oldPath: string, newPath: string) {
  const original = path.replace(/\\/g, "/"), old = oldPath.replace(/\\/g, "/").replace(/\/+$/, "")
  const key = original.toLowerCase(), oldKey = old.toLowerCase()
  if (!oldKey || (key !== oldKey && !key.startsWith(oldKey + "/"))) return path
  const updated = newPath.replace(/[\\/]+$/, "") + original.slice(old.length)
  return newPath.includes("\\") ? updated.replace(/\//g, "\\") : updated
}
