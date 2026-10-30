import type { LectureMaterialsPayload } from "../../../lib/api"
import type { MaterialBulkDeleteTarget } from "../../materials/hooks/use-materials-controller.ts"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"
import { workspacePinKey } from "../hooks/use-workspace-pins.ts"

export type MaterialContextMenuState = { item: MaterialItem; items?: MaterialItem[]; x: number; y: number }

export function uniqueContextItems(items: readonly MaterialItem[]): MaterialItem[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = workspacePinKey(item.path)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function workspaceContextItems(item: MaterialItem, selected: ReadonlySet<string>, ordered: readonly MaterialItem[]) {
  return uniqueContextItems(selected.has(item.path) ? ordered.filter(candidate => selected.has(candidate.path)) : [item])
}

export function contextOcrItems(items: readonly MaterialItem[]) {
  // The existing foreground OCR endpoint opens PDF bytes directly. Office
  // sources require their converted PDF and cannot be sent as original files.
  return uniqueContextItems(items).filter(item => item.kind !== "folder" && /\.pdf$/i.test(item.path))
}

export function contextDeleteTarget(items: readonly MaterialItem[], materials?: LectureMaterialsPayload | null): MaterialBulkDeleteTarget {
  const selected = uniqueContextItems(items), folders = [...(materials?.folders ?? [])]
  const byPath = new Map(folders.map(folder => [workspacePinKey(folder.path), folder]))
  for (let index = 0; index < folders.length; index++) for (const child of folders[index].children ?? []) {
    folders.push(child); byPath.set(workspacePinKey(child.path), child)
  }
  const parents = selected.filter(item => item.kind === "folder").map(item => workspacePinKey(item.path))
  const targets = selected.filter(item => !parents.some(parent => workspacePinKey(item.path).startsWith(parent + "/")))
  return { files: targets.filter(item => item.kind !== "folder").map(item => ({ path: item.path,
    title: item.title, fileName: item.path.split(/[\\/]/).pop() || item.title, kind: item.kind.toLowerCase() })),
  folders: targets.filter(item => item.kind === "folder").map(item => {
    const folder = byPath.get(workspacePinKey(item.path))
    if (!folder || folder.is_virtual) throw new Error(`폴더 정보를 확인할 수 없습니다: ${item.title}`)
    return { path: folder.path, name: folder.name, weeks: folder.weeks.map(week => week.week),
      reportCount: folder.report_count + folder.files.filter(file => file.kind === "md").length, folder }
  }) }
}

export async function applyContextItems(items: readonly MaterialItem[], action: (item: MaterialItem) => unknown | Promise<unknown>, onError?: (message: string) => void) {
  const errors: string[] = []
  for (const item of uniqueContextItems(items)) {
    try { if (await action(item) === false) throw new Error("작업을 완료하지 못했습니다.") }
    catch (error) { errors.push(`${item.title}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  if (errors.length) onError?.(errors.join("\n"))
}
