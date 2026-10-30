import type { LectureMaterialFolder, LectureMaterialsPayload } from "../../lib/api"
import { normalizedMaterialPath } from "../../lib/material-navigation.ts"

export function hideDeletingMaterialFiles(
  materials: LectureMaterialsPayload | null,
  deletingPaths: ReadonlySet<string>,
): LectureMaterialsPayload | null {
  if (!materials || deletingPaths.size === 0) return materials
  const visit = (folder: LectureMaterialFolder): LectureMaterialFolder => {
    const files = folder.files.filter((file) => !deletingPaths.has(normalizedMaterialPath(file.file_path)))
    const weeks = folder.weeks.map((week) => ({
      ...week,
      reports: week.reports.filter((report) => !deletingPaths.has(normalizedMaterialPath(report.file_path))),
    })).filter((week) => week.reports.length > 0)
    const children = folder.children?.map(visit)
    const removedDirect = folder.weeks.reduce((total, week) => total + week.reports.length, 0)
      - weeks.reduce((total, week) => total + week.reports.length, 0)
    const removedChildren = (folder.children ?? []).reduce((total, child, index) =>
      total + child.report_count - (children?.[index].report_count ?? 0), 0)
    return {
      ...folder,
      files,
      weeks,
      children,
      report_count: Math.max(0, folder.report_count - removedDirect - removedChildren
        - (folder.is_virtual ? folder.files.length - files.length : 0)),
      ...(folder.direct_report_count === undefined ? {} : {
        direct_report_count: Math.max(0, folder.direct_report_count - removedDirect),
      }),
    }
  }
  return { ...materials, folders: materials.folders.map(visit) }
}
