import { useEffect, useMemo, useState } from "react"
import { getLectureMaterials, type LectureMaterialsPayload } from "../../../lib/api"
import { hideDeletingMaterialFiles } from "../optimistic-file-deletion.ts"
import { withVisibleMaterialMetadata } from "../visible-material-metadata.ts"
import { t } from "../../../lib/i18n.ts"

const key = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

/** Visible directories have their own fast requests; full scans cannot delay them. */
export function useVisibleMaterialDirectory(path: string, catalog: LectureMaterialsPayload | null, pendingFileDeletes?: Set<string>, setNotice?: (message: string) => void) {
  const [cache, setCache] = useState(() => new Map<string, LectureMaterialsPayload>())
  const directoryKey = key(path)
  useEffect(() => {
    const controller = new AbortController()
    let progressTimer: ReturnType<typeof setTimeout> | undefined
    void getLectureMaterials({ directory: path, signal: controller.signal }).then((rows) => {
      if (controller.signal.aborted) return
      setCache((current) => new Map(current).set(directoryKey, rows))
      // Publish file names first. Only the visible directory needs saved counts;
      // resuming a cached Home also refreshes progress after solving a document.
      progressTimer = setTimeout(() => {
        void getLectureMaterials({ directory: path, includeProblemProgress: true, signal: controller.signal }).then((updated) => {
          if (controller.signal.aborted) return
          setCache((current) => new Map(current).set(directoryKey, updated))
          const failed = updated.folders.flatMap((folder) => folder.files).find((file) => file.problem_progress_error)
          if (failed) setNotice?.(`${failed.file_name}: ${failed.problem_progress_error}`)
        }).catch((error: unknown) => {
          if (!controller.signal.aborted) setNotice?.(t("문제 풀이 기록을 불러오지 못했습니다: {p0}", { p0: error instanceof Error ? error.message : String(error) }))
        })
      }, 150)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && path) setNotice?.(t("폴더 목록을 불러오지 못했습니다: {p0}", { p0: error instanceof Error ? error.message : String(error) }))
    })
    return () => { controller.abort(); clearTimeout(progressTimer) }
  }, [path, directoryKey, catalog, setNotice])
  const cached = cache.get(directoryKey)
  const enriched = useMemo(() => cached ? withVisibleMaterialMetadata(cached, catalog) : null, [cached, catalog])
  if (cached && (!catalog?.base_path || key(cached.base_path) === key(catalog.base_path))) {
    return pendingFileDeletes ? hideDeletingMaterialFiles(enriched, pendingFileDeletes) : enriched
  }
  if (!path) return catalog
  // A not-yet-loaded child must not briefly display its parent's root entries.
  const pending = [...(catalog?.folders ?? [])]
  while (pending.length) {
    const folder = pending.pop()!
    if (key(folder.path) === directoryKey) return catalog
    pending.push(...(folder.children ?? []))
  }
  return { base_path: catalog?.base_path ?? "", folders: [{ name: path.split(/[\\/]/).at(-1) ?? path,
    path, files: [], weeks: [], children: [], report_count: 0 }] }
}
