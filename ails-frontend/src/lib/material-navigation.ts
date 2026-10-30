import type { LectureMaterialFile, LectureMaterialFolder, LectureMaterialReport, LectureMaterialsPayload, MaterialKind } from "./api"
import { t } from "./i18n.ts"

export type VoiceMaterialTarget = {
  candidate_id: string
  title: string
  folder: string
  kind: string
  path: string
}

export function voiceMaterialTargets(materials: LectureMaterialsPayload | null): VoiceMaterialTarget[] {
  const result: VoiceMaterialTarget[] = []
  const seen = new Set<string>()
  const add = (title: string, path: string, kind: string, folder: string) => {
    const key = path.trim().replace(/\\/g, "/").toLocaleLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    // IDs must survive filtering, pagination and a refreshed/reordered library.
    let first = 2166136261
    let second = 2166136261
    for (let i = 0; i < key.length; i += 1) {
      first = Math.imul(first ^ key.charCodeAt(i), 16777619)
      second = Math.imul(second ^ key.charCodeAt(key.length - i - 1), 16777619)
    }
    const candidateId = `material-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`
    result.push({ candidate_id: candidateId, title, folder, kind, path })
  }
  const visit = (folder: LectureMaterialFolder, parents: string[]) => {
    const names = [...parents, folder.name].filter(Boolean)
    const breadcrumb = names.join(" / ")
    for (const file of folder.files || []) add(file.title, file.file_path, file.kind, breadcrumb)
    for (const week of folder.weeks || []) {
      for (const report of week.reports || []) {
        add(report.title, report.file_path, "md", t("{p0} / {p1}주차", { p0: breadcrumb, p1: week.week }))
      }
    }
    for (const child of folder.children || []) visit(child, names)
  }
  for (const folder of materials?.folders || []) visit(folder, [])
  return result
}

export function getDocumentBreadcrumb(
  filePath: string | undefined,
  title: string | undefined,
  materials: LectureMaterialsPayload | null,
): string {
  if (!filePath) return title ?? ""
  const normalized = filePath.replace(/\\/g, "/")
  if (materials?.folders) {
    const targets = voiceMaterialTargets(materials)
    const matched = targets.find(
      (target) => target.path === filePath || target.path.replace(/\\/g, "/").toLowerCase() === normalized.toLowerCase(),
    )
    if (matched?.folder) return `${matched.folder} / ${title || matched.title}`
  }
  const parts = normalized.split("/").filter(Boolean)
  const lectureIdx = parts.findIndex((part) => part === "강의" || part === "Machine-Learning-2023" || part === "Optional Labs")
  if (lectureIdx >= 0 && lectureIdx < parts.length - 1) {
    const relevant = parts.slice(lectureIdx + 1)
    relevant[relevant.length - 1] = title || relevant[relevant.length - 1].replace(/\.[^.]+$/, "")
    return relevant.join(" / ")
  }
  const lastParts = parts.slice(-3)
  if (lastParts.length > 0) {
    lastParts[lastParts.length - 1] = title || lastParts[lastParts.length - 1].replace(/\.[^.]+$/, "")
    return lastParts.join(" / ")
  }
  return title ?? filePath
}

/** 자료 경로 정규화와 컨텍스트 대상 타입. 자료·PDF 여러 기능이 함께 쓰는 중립 도메인 유틸. */
export type MaterialContextTarget = {
  path: string
  fileName: string
  title: string
  kind: MaterialKind
}

export type MaterialFolderContextTarget = {
  path: string
  name: string
  weeks: number[]
  reportCount: number
  folder: LectureMaterialFolder
}

export function normalizedMaterialPath(path: string) {
  return path.replace(/\\/g, "/")
}

export function naturalSortCompare(a: string, b: string): number {
  return a.localeCompare(b, "ko", { numeric: true, sensitivity: "base" })
}

export type SiblingNavigationResult = {
  previous: MaterialContextTarget | null
  next: MaterialContextTarget | null
  files?: MaterialContextTarget[]
}

export function siblingNavigation(
  folders: LectureMaterialFolder[],
  viewerDocument: { file_path?: string } | null,
  diskSiblings?: SiblingNavigationResult | null,
): SiblingNavigationResult {
  if (!viewerDocument?.file_path) {
    return { previous: null, next: null }
  }

  // Reuse the folder's order immediately after selecting a loading/new tab.
  // The cached previous/next pair still belongs to the formerly active file.
  if (diskSiblings?.files) {
    const path = normalizedMaterialPath(viewerDocument.file_path).toLowerCase()
    const index = diskSiblings.files.findIndex((file) => normalizedMaterialPath(file.path).toLowerCase() === path)
    if (index >= 0) return {
      previous: diskSiblings.files[index - 1] ?? null,
      next: diskSiblings.files[index + 1] ?? null,
      files: diskSiblings.files,
    }
  } else if (diskSiblings) {
    return {
      previous: diskSiblings.previous ?? null,
      next: diskSiblings.next ?? null,
      files: diskSiblings.files,
    }
  }

  const currentPath = normalizedMaterialPath(viewerDocument.file_path)
  const lastSlash = currentPath.lastIndexOf("/")
  const currentDir = lastSlash >= 0 ? currentPath.substring(0, lastSlash) : ""

  const fileTarget = (file: LectureMaterialFile): MaterialContextTarget => ({
    path: file.file_path,
    fileName: file.file_name,
    title: file.title,
    kind: file.kind,
  })
  const reportTarget = (report: LectureMaterialReport): MaterialContextTarget => ({
    path: report.file_path,
    fileName: report.file_name,
    title: report.title,
    kind: "md",
  })

  // 1. Locate folder by exact directory path
  let targetFolder: LectureMaterialFolder | null = null
  const findFolderByPath = (items: LectureMaterialFolder[]): LectureMaterialFolder | null => {
    for (const folder of items) {
      if (normalizedMaterialPath(folder.path) === currentDir) return folder
      const child = findFolderByPath(folder.children ?? [])
      if (child) return child
    }
    return null
  }
  if (currentDir) {
    targetFolder = findFolderByPath(folders)
  }

  // 2. Locate folder by item containment fallback
  if (!targetFolder) {
    const findFolderByItem = (items: LectureMaterialFolder[]): LectureMaterialFolder | null => {
      for (const folder of items) {
        if (folder.files.some((f) => normalizedMaterialPath(f.file_path) === currentPath)) return folder
        if (folder.weeks.some((w) => w.reports.some((r) => normalizedMaterialPath(r.file_path) === currentPath))) return folder
        const child = findFolderByItem(folder.children ?? [])
        if (child) return child
      }
      return null
    }
    targetFolder = findFolderByItem(folders)
  }

  if (targetFolder) {
    const isMd = currentPath.toLowerCase().endsWith(".md")
    const allReports = targetFolder.weeks.flatMap((w) => w.reports.map(reportTarget))
    const allFiles = targetFolder.files.map(fileTarget)

    let candidateList: MaterialContextTarget[]
    if (isMd && allReports.length > 0) {
      candidateList = allReports
    } else if (!isMd && allFiles.length > 0) {
      candidateList = allFiles
    } else {
      candidateList = [...allFiles, ...allReports]
    }

    // Natural sort: 머신러닝_1주차2 is followed by 머신러닝_2주차1, NOT 머신러닝_10주차1
    candidateList.sort((a, b) => naturalSortCompare(a.fileName || a.title, b.fileName || b.title))

    const index = candidateList.findIndex((item) => normalizedMaterialPath(item.path) === currentPath)
    if (index >= 0) {
      return {
        previous: index > 0 ? candidateList[index - 1] : null,
        next: index < candidateList.length - 1 ? candidateList[index + 1] : null,
        files: candidateList,
      }
    }
  }

  return { previous: null, next: null }
}
