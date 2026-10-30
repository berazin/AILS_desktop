import type { LectureMaterialFile, LectureMaterialFolder, LectureMaterialReport, LectureMaterialsPayload } from "../../lib/api"

const key = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

/** Enrich the visible rows without importing descendants into their directory. */
export function withVisibleMaterialMetadata(directory: LectureMaterialsPayload, catalog: LectureMaterialsPayload | null): LectureMaterialsPayload {
  if (!catalog || catalog.shallow || key(directory.base_path) !== key(catalog.base_path)) return directory
  const sources = new Map<string, LectureMaterialFolder>()
  const sourceFiles = new Map<string, LectureMaterialFile | LectureMaterialReport>()
  const pending = [...catalog.folders]
  while (pending.length) {
    const folder = pending.pop()!
    sources.set(key(folder.path), folder)
    for (const file of folder.files) sourceFiles.set(key(file.file_path), file)
    for (const week of folder.weeks) for (const report of week.reports) sourceFiles.set(key(report.file_path), report)
    pending.push(...(folder.children ?? []))
  }
  const visit = (folder: LectureMaterialFolder): LectureMaterialFolder => {
    const source = sources.get(key(folder.path))
    return { ...folder,
      ...(source ? { item_count: source.files.length + source.report_count + (source.children?.length ?? 0) } : {}),
      files: folder.files.map((file) => ({ ...sourceFiles.get(key(file.file_path)), ...file })),
      children: folder.children?.map(visit),
    }
  }
  return { ...directory, folders: directory.folders.map(visit) }
}
