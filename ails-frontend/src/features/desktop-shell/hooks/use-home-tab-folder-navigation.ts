import { useCallback, useState } from "react"
import type { LectureMaterialFolder } from "../../../lib/api"
import { getWorkspaceParentFolderPath } from "./use-workspace-folder-navigation.ts"

export function useHomeTabFolderNavigation(tabId: string, folders: readonly LectureMaterialFolder[] = []) {
  const [paths, setPaths] = useState<Record<string, string>>({})
  const currentFolderPath = paths[tabId] ?? ""
  const navigateToFolder = useCallback((path: string) => {
    setPaths((current) => current[tabId] === path ? current : { ...current, [tabId]: path })
  }, [tabId])
  const restoreFolder = useCallback((homeTabId: string, path: string) => {
    setPaths((current) => current[homeTabId] === path ? current : { ...current, [homeTabId]: path })
  }, [])
  const goParent = useCallback(() => {
    setPaths((current) => ({ ...current, [tabId]: getWorkspaceParentFolderPath(current[tabId] ?? "", folders) }))
  }, [folders, tabId])
  return { currentFolderPath, paths, navigateToFolder, restoreFolder, goParent, canGoParent: Boolean(currentFolderPath) }
}
