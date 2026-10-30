import { IDE_ENABLED, documentAllowed } from '../../../lib/ide-policy.ts'
import { workspaceWindowStorage } from "../../../lib/workspace-window-storage.ts"
import type { TransferSplitGroup } from "../../../shared/workspace-tab-transfer.ts"

export const WORKBENCH_SESSION_KEY = IDE_ENABLED ? "ails-folder-workbench-v1" : "ails-folder-workbench-commercial-v1"
export const SPLIT_PICKER_ID = "ails:split-picker"
export const CODE_START_ID = "ails:code-start"
export type DocumentCodeFit = { id: string; aspect: number | null }
export type WorkbenchSession = {
  folders: string[]
  documents: { path: string; id: string }[]
  active: string
  split: [string, string] | null
  ratio: number
  documentFit?: DocumentCodeFit
  groups?: TransferSplitGroup[]
  singleCodeStart?: boolean
  excludedIde?: boolean
}
export const folderTabId = (id: string) => `workspace:${id}`
export const folderId = (tabId: string) => tabId.startsWith("workspace:") ? tabId.slice(10) : ""
export const isDocumentPane = (id: string) => id !== SPLIT_PICKER_ID && id !== CODE_START_ID && !folderId(id)
export const clampSplitRatio = (ratio: number) => Number.isFinite(ratio) ? Math.max(0.2, Math.min(0.8, ratio)) : 0.5

export function readWorkbenchSession(): WorkbenchSession {
  const empty: WorkbenchSession = { folders: [], documents: [], active: "", split: null, ratio: 0.5 }
  try {
    const value = JSON.parse(workspaceWindowStorage().getItem(WORKBENCH_SESSION_KEY) || (!IDE_ENABLED ? workspaceWindowStorage().getItem("ails-folder-workbench-v1") : null) || "null")
    if (!value || typeof value !== "object") return empty
    let excludedIde = false
    if (!IDE_ENABLED) {
      const documents = Array.isArray(value.documents) ? value.documents.filter((doc: { path?: unknown; id?: unknown }) =>
        doc && typeof doc.path === "string" && typeof doc.id === "string" && documentAllowed(doc.path)) : []
      const allowed = (id: unknown) => typeof id === "string" && isDocumentPane(id) && documents.some((doc: { id: string }) => doc.id === id)
      excludedIde = Boolean(value.folders?.length || value.singleCodeStart
        || (Array.isArray(value.documents) && documents.length !== value.documents.length)
        || (Array.isArray(value.split) && value.split.some((id: unknown) => !allowed(id))))
      value.folders = []
      value.documents = documents
      value.active = allowed(value.active) ? value.active : ""
      value.split = Array.isArray(value.split) && value.split.every(allowed) ? value.split : null
      value.groups = Array.isArray(value.groups) ? value.groups.filter((group: TransferSplitGroup) => Array.isArray(group?.pair) && group.pair.every(allowed)) : []
      value.singleCodeStart = false
    }
    const fit = value.documentFit
    const documentFit = fit && typeof fit.id === "string" && Array.isArray(value.split) && value.split.includes(fit.id) && isDocumentPane(fit.id)
      ? { id: fit.id, aspect: Number.isFinite(fit.aspect) && fit.aspect > 0 ? fit.aspect : null } : undefined
    const groups: TransferSplitGroup[] = Array.isArray(value.groups) ? value.groups.flatMap((group: TransferSplitGroup) => {
      if (!group || !Array.isArray(group.pair) || group.pair.length !== 2 || group.pair.some(id => typeof id !== "string") || group.pair[0] === group.pair[1]) return []
      return [{ pair: group.pair, ratio: Number.isFinite(group.ratio) && group.ratio > 0 && group.ratio < 1 ? group.ratio : 0.5,
        fit: group.fit && group.pair.includes(group.fit.id) ? { id: group.fit.id, aspect: Number.isFinite(group.fit.aspect) && group.fit.aspect! > 0 ? group.fit.aspect : null } : null,
        linkSource: typeof group.linkSource === "string" ? group.linkSource : "" }]
    }) : []
    return {
      ...(excludedIde ? { excludedIde: true } : {}),
      folders: Array.isArray(value.folders) ? value.folders.filter((id: unknown) => typeof id === "string") : [],
      documents: Array.isArray(value.documents) ? value.documents.filter((doc: { path?: unknown; id?: unknown }) =>
        doc && typeof doc.path === "string" && typeof doc.id === "string") : [],
      active: typeof value.active === "string" ? value.active : "",
      split: Array.isArray(value.split) && value.split.length === 2
        && value.split.every((id: unknown) => typeof id === "string") && value.split[0] !== value.split[1]
        ? value.split : null,
      ratio: documentFit && Number.isFinite(value.ratio) && value.ratio > 0 && value.ratio < 1 ? value.ratio : clampSplitRatio(value.ratio),
      ...(documentFit ? { documentFit } : {}),
      ...(groups.length ? { groups } : {}),
      ...(value.singleCodeStart === true ? { singleCodeStart: true } : {}),
    }
  } catch { return empty }
}
