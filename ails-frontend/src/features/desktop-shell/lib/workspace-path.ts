import type { LectureMaterialFolder } from "../../../lib/api"

const cleanPath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "")

export function workspaceRelativePath(rootPath: string, path: string): string | null {
  const root = cleanPath(rootPath)
  const current = cleanPath(path || rootPath)
  if (!root) return null
  if (current.toLowerCase() === root.toLowerCase()) return ""
  return current.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? current.slice(root.length + 1) : null
}

function realFolders(folders: readonly LectureMaterialFolder[]): LectureMaterialFolder[] {
  return folders.flatMap(folder => [
    ...(folder.is_virtual || ["분류되지 않은 파일", "기타 자료"].includes(folder.name) ? [] : [folder]),
    ...realFolders(folder.children ?? []),
  ])
}

export type WorkspaceBreadcrumb = { label: string; path: string; available: boolean }

export function workspaceBreadcrumbs(rootPath: string, currentPath: string, folders: readonly LectureMaterialFolder[]): WorkspaceBreadcrumb[] {
  const relative = workspaceRelativePath(rootPath, currentPath)
  if (!relative) return []
  const known = realFolders(folders)
  let path = cleanPath(rootPath)
  return relative.split("/").filter(Boolean).map(part => {
    path += `/${part}`
    const folder = known.find(folder => cleanPath(folder.path).toLowerCase() === path.toLowerCase())
    return { label: folder?.name || part, path: folder?.path || path, available: Boolean(folder) }
  })
}

type FolderInputResult = { path: string; error?: never } | { error: "outside" | "not-found"; path?: never }

export function resolveWorkspaceFolderInput(input: string, rootPath: string, folders: readonly LectureMaterialFolder[]): FolderInputResult {
  if (!rootPath) return { error: "not-found" }
  const value = input.trim().replace(/^"(.*)"$/, "$1").replace(/\\/g, "/")
  const relative = /^[a-z]:|^\/\//i.test(value) ? workspaceRelativePath(rootPath, value) : value.replace(/^\/+/, "")
  if (relative === null) return { error: "outside" }
  const parts: string[] = []
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!parts.length) return { error: "outside" }
      parts.pop()
    } else parts.push(part)
  }
  if (!parts.length) return { path: "" }
  const target = `${cleanPath(rootPath)}/${parts.join("/")}`.toLowerCase()
  const folder = realFolders(folders).find(folder => cleanPath(folder.path).toLowerCase() === target)
  return folder ? { path: folder.path } : { error: "not-found" }
}
