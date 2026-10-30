import { useCallback, useState } from "react"
import type { LectureMaterialFolder } from "../../../lib/api"

const normalizedPath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

export function getWorkspaceParentFolderPath(path: string, folders: readonly LectureMaterialFolder[]): string {
  function findParent(list: readonly LectureMaterialFolder[], parent: string): string | undefined {
    for (const folder of list) {
      if (normalizedPath(folder.path) === normalizedPath(path)) return parent
      const found = findParent(folder.children ?? [], folder.is_virtual ? parent : folder.path)
      if (found !== undefined) return found
    }
  }
  if (!path) return ""
  const found = findParent(folders, "")
  if (found !== undefined) return found
  // A shallow catalog has not visited this folder's ancestors yet. Stay under
  // a known workspace root while still returning the immediate physical parent.
  const parent = path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "")
  return folders.some((folder) => !folder.is_virtual && (normalizedPath(parent).startsWith(`${normalizedPath(folder.path)}/`)
    || normalizedPath(parent) === normalizedPath(folder.path))) ? parent : ""
}

export function useWorkspaceFolderNavigation(folders: readonly LectureMaterialFolder[] = []) {
  const [history, setHistory] = useState({ paths: [""], index: 0 })
  const currentFolderPath = history.paths[history.index]
  const navigateToFolder = useCallback((path: string) => {
    setHistory((current) => visitFolder(current, path))
  }, [])
  const goParent = useCallback(() => {
    setHistory((current) => visitFolder(current, getWorkspaceParentFolderPath(current.paths[current.index], folders)))
  }, [folders])
  const goBack = useCallback(() => {
    setHistory((current) => current.index > 0 ? { ...current, index: current.index - 1 } : current)
  }, [])
  const goForward = useCallback(() => {
    setHistory((current) => current.index < current.paths.length - 1 ? { ...current, index: current.index + 1 } : current)
  }, [])
  return { currentFolderPath, navigateToFolder, goParent, canGoParent: Boolean(currentFolderPath),
    goBack, goForward, canGoBack: history.index > 0, canGoForward: history.index < history.paths.length - 1 }
}

function visitFolder(current: { paths: string[]; index: number }, path: string) {
  if (normalizedPath(current.paths[current.index]) === normalizedPath(path)) return current
  const paths = [...current.paths.slice(0, current.index + 1), path]
  return { paths, index: paths.length - 1 }
}
