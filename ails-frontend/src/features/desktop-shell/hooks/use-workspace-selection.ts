import { useMemo, useState } from "react"
import { renamedWorkspacePath } from "../lib/workspace-rename.ts"

export type WorkspaceSelectionModifiers = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }

export function useWorkspaceSelection(orderedPaths: readonly string[]) {
  const [selection, setSelection] = useState<{ paths: Set<string>; anchor: string }>(() => ({ paths: new Set(), anchor: "" }))
  const selectedPaths = useMemo(() => new Set(orderedPaths.filter((path) => selection.paths.has(path))), [orderedPaths, selection.paths])

  function select(path: string, modifiers: WorkspaceSelectionModifiers = {}) {
    setSelection((previous) => {
      const additive = modifiers.ctrlKey || modifiers.metaKey
      const paths = additive ? new Set(orderedPaths.filter((value) => previous.paths.has(value))) : new Set<string>()
      const anchorIndex = orderedPaths.indexOf(previous.anchor)
      const targetIndex = orderedPaths.indexOf(path)
      if (modifiers.shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
        for (const value of orderedPaths.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)) paths.add(value)
        return { paths, anchor: previous.anchor }
      }
      if (additive && paths.has(path)) paths.delete(path)
      else paths.add(path)
      return { paths, anchor: path }
    })
  }

  function clear() {
    setSelection({ paths: new Set(), anchor: "" })
  }

  function selectAll() {
    setSelection((previous) => ({
      paths: new Set(orderedPaths),
      anchor: orderedPaths.includes(previous.anchor) ? previous.anchor : orderedPaths[0] ?? "",
    }))
  }

  function replace(paths: Iterable<string>, anchor?: string) {
    const requested = new Set(paths)
    setSelection((previous) => {
      const next = new Set(orderedPaths.filter((path) => requested.has(path)))
      const candidate = anchor ?? previous.anchor
      const nextAnchor = next.has(candidate) ? candidate : next.values().next().value ?? ""
      if (nextAnchor === previous.anchor && next.size === previous.paths.size
        && [...next].every((path) => previous.paths.has(path))) return previous
      return { paths: next, anchor: nextAnchor }
    })
  }

  function renamePath(oldPath: string, newPath: string) {
    setSelection(previous => ({ paths: new Set([...previous.paths].map(path => renamedWorkspacePath(path, oldPath, newPath))),
      anchor: renamedWorkspacePath(previous.anchor, oldPath, newPath) }))
  }

  function selectTransferredPaths(paths: readonly string[]) {
    // The parent's refreshed catalog may arrive after this completion callback.
    // Keep the server's new paths until selectedPaths can match that catalog.
    setSelection({ paths: new Set(paths), anchor: paths[0] ?? "" })
  }

  return { selectedPaths, anchor: selection.anchor, select, selectAll, replace, renamePath, selectTransferredPaths, clear }
}
