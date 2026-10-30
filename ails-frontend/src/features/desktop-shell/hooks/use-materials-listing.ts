import { useMemo } from "react"
import { t } from "../../../lib/i18n.ts"
import type { LectureMaterialFolder, LectureMaterialsPayload } from "../../../lib/api"
import { workspacePinKey } from "./use-workspace-pins.ts"

export type MaterialItem = {
  id: string
  title: string
  kind: string
  size?: string
  date: string
  timestamp?: number
  lastOpenedAt?: string
  lastPage?: number
  totalPages?: number
  readRange?: string
  percent?: number
  ocrStatus?: string
  problemCount?: number
  solvedProblemCount?: number
  sttStatus?: string
  summaryDone?: boolean
  itemCount?: number
  path: string
  coverTheme?: string
  isPinned?: boolean
}

export type MaterialSortOption = "updated_desc" | "updated_asc" | "name_asc" | "name_desc" | "kind_asc"

export function formatRelativeTime(dateString?: string): string {
  if (!dateString) return t("시간 기록 없음")
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return t("시간 기록 없음")

  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 0) return t("방금 전")

  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHour / 24)

  if (diffMin < 1) return t("방금 전")
  if (diffMin < 60) return `${diffMin}분 전`
  if (diffHour < 24) return `${diffHour}시간 전`
  if (diffDays === 1) return t("어제")
  if (diffDays < 7) return `${diffDays}일 전`

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(date)
}

function getSavedPdfPage(filePath: string, pagesMap?: Record<string, number>): number {
  if (!filePath) return 1
  const normalized = filePath.replace(/\\/g, "/")
  const lower = normalized.toLowerCase()

  if (pagesMap) {
    if (pagesMap[normalized] && pagesMap[normalized] >= 1) return pagesMap[normalized]
    if (pagesMap[filePath] && pagesMap[filePath] >= 1) return pagesMap[filePath]
    for (const [k, v] of Object.entries(pagesMap)) {
      if (k.toLowerCase() === lower && v >= 1) return v
    }
  }

  try {
    const raw = localStorage.getItem("ails-pdf-page-by-path")
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed[normalized] && parsed[normalized] >= 1) return parsed[normalized]
      if (parsed[filePath] && parsed[filePath] >= 1) return parsed[filePath]
      for (const [k, v] of Object.entries(parsed)) {
        if (k.toLowerCase() === lower && Number(v) >= 1) return Math.floor(Number(v))
      }
    }
  } catch {
    void 0
  }

  return 1
}

type RecentFileInput = {
  path: string
  title: string
  kind: string
  lastOpenedAt?: string
  pageCount?: number
}

function modifiedTime(updatedAt?: number): Pick<MaterialItem, "date" | "timestamp"> {
  const date = new Date(typeof updatedAt === "number" ? updatedAt * 1000 : NaN)
  if (!Number.isFinite(date.getTime())) return { date: "—", timestamp: 0 }
  return {
    date: date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }),
    timestamp: date.getTime(),
  }
}

// 홈 대시보드 자료 목록 순수 계산: 이어서 작업하기 카드, 폴더 트리/검색 결과, 정렬 결과.
// 외부 호출(fetch)은 하지 않고 입력만으로 파생 값을 만든다.
export function useMaterialsListing({
  lectureMaterials,
  searchQuery,
  currentFolderPath,
  recentFiles,
  pdfPageByDocument,
  documentTags,
  sortOption,
  pinnedPaths,
  hiddenRecentPaths,
  recentLimit = 4,
}: {
  lectureMaterials?: LectureMaterialsPayload | null
  searchQuery: string
  currentFolderPath: string
  recentFiles: RecentFileInput[]
  pdfPageByDocument?: Record<string, number>
  documentTags?: Record<string, string[]>
  sortOption: MaterialSortOption
  pinnedPaths: string[]
  hiddenRecentPaths: string[]
  recentLimit?: number
}) {
  // 최근 파일은 열람 순서를 유지한다. 상단 고정은 작업공간 정렬에만 적용한다.
  const studyCards = useMemo<MaterialItem[]>(() => {
    const visibleFiles = recentFiles.filter((rf) => !hiddenRecentPaths.includes(rf.path))
    if (visibleFiles.length > 0) {
      return visibleFiles.slice(0, recentLimit).map((rf, idx) => {
        const isEpub = rf.kind?.toUpperCase() === "EPUB"
        const isPinned = pinnedPaths.some((path) => workspacePinKey(path) === workspacePinKey(rf.path))
        const cardLastPage = getSavedPdfPage(rf.path, pdfPageByDocument) || 1
        // 진행 바는 실제 전체 페이지 수 기준 마지막 위치. 페이지 수를 모르는
        // 기존 항목은 이전처럼 100페이지 기준 추정치를 쓴다.
        const cardPercent = isEpub
          ? 100
          : rf.pageCount && rf.pageCount > 0
            ? Math.min(100, Math.max(5, Math.round((cardLastPage / rf.pageCount) * 100)))
            : Math.min(100, Math.max(5, Math.round((cardLastPage / 100) * 100)))
        return {
          id: `study-${rf.path || idx}`,
          title: rf.title,
          kind: (rf.kind?.toUpperCase() || "PDF") as MaterialItem["kind"],
          readRange: isEpub ? "eBook" : ["PDF", "PPT", "PPTX"].includes(rf.kind.toUpperCase()) ? `${cardLastPage} p` : undefined,
          percent: cardPercent,
          date: rf.lastOpenedAt ? formatRelativeTime(rf.lastOpenedAt) : t("최근 열람"),
          lastOpenedAt: rf.lastOpenedAt,
          lastPage: isEpub ? 1 : cardLastPage,
          coverTheme: isEpub
            ? "from-violet-900 via-purple-950 to-slate-950"
            : idx === 0
              ? "from-blue-900 to-indigo-950"
              : idx === 1
                ? "from-sky-900 to-slate-900"
                : idx === 2
                  ? "from-indigo-900 to-slate-950"
                  : "from-slate-800 to-slate-950",
          path: rf.path,
          isPinned,
        }
      })
    }
    return []
  }, [recentFiles, pdfPageByDocument, pinnedPaths, hiddenRecentPaths, recentLimit])

  // 정리본 저장 폴더 위치 기준 실제 자료 목록 계산
  const { currentFolderTitle, allMaterials } = useMemo(() => {
    const folders = lectureMaterials?.folders || []
    const basePath = lectureMaterials?.base_path || ""

    // 1. 검색어가 있는 경우: 정리본 폴더 내 모든 파일 및 정리본 검색
    const query = searchQuery.trim().toLowerCase()
    if (query) {
      const results: MaterialItem[] = []

      const searchFolder = (folder: LectureMaterialFolder) => {
        const isVirtual =
          Boolean(folder.is_virtual) ||
          folder.name === "분류되지 않은 파일" ||
          folder.name === "기타 자료"

        if (!isVirtual && folder.name.toLowerCase().includes(query)) {
          results.push({
            id: `folder-${folder.path}`,
            title: folder.name,
            kind: "folder",
            itemCount: folder.item_count ?? (folder.children_loaded === false ? undefined : folder.files.length + folder.report_count + (folder.children?.length ?? 0)),
            ...modifiedTime(folder.updated_at),
            path: folder.path,
          })
        }

        for (const file of folder.files) {
          const fileTags = documentTags?.[file.file_path.replace(/\\/g, "/")]
          const matchesTag = Boolean(fileTags?.some((tag) => tag.toLowerCase().includes(query)))
          if (
            file.title.toLowerCase().includes(query) ||
            file.file_name.toLowerCase().includes(query) ||
            matchesTag
          ) {
            const kindUpper = (file.kind ? file.kind.toUpperCase() : "PDF") as MaterialItem["kind"]
            results.push({
              id: file.id || file.file_path,
              title: file.title || file.file_name,
              kind: kindUpper,
              ...modifiedTime(file.updated_at),
              path: file.file_path,
              lastPage: getSavedPdfPage(file.file_path, pdfPageByDocument) || 1,
              coverTheme: kindUpper === "EPUB" ? "from-violet-900 via-purple-950 to-slate-950" : "from-blue-900 to-indigo-950",
            })
          }
        }

        for (const week of folder.weeks) {
          for (const report of week.reports) {
            if (
              report.title.toLowerCase().includes(query) ||
              report.file_name.toLowerCase().includes(query)
            ) {
              results.push({
                id: report.id || report.file_path,
                title: report.title || report.file_name,
                kind: "MD",
                summaryDone: true,
                ...modifiedTime(report.updated_at),
                path: report.file_path,
                coverTheme: "from-emerald-900 to-teal-950",
              })
            }
          }
        }

        if (folder.children) {
          for (const child of folder.children) {
            searchFolder(child)
          }
        }
      }

      for (const folder of folders) {
        searchFolder(folder)
      }

      return {
        currentFolderTitle: t("검색 결과"),
        allMaterials: results,
      }
    }

    // 2. 특정 폴더 경로로 진입한 상태
    if (currentFolderPath) {
      const findFolder = (list: LectureMaterialFolder[]): LectureMaterialFolder | null => {
        for (const f of list) {
          if (f.path === currentFolderPath) return f
          if (f.children) {
            const m = findFolder(f.children)
            if (m) return m
          }
        }
        return null
      }

      const target = findFolder(folders)
      if (target) {
        const items: MaterialItem[] = []

        if (target.children) {
          for (const child of target.children) {
            const isChildVirtual =
              Boolean(child.is_virtual) ||
              child.name === "분류되지 않은 파일" ||
              child.name === "기타 자료"

            if (isChildVirtual) {
              for (const file of child.files) {
                const kindUpper = (file.kind ? file.kind.toUpperCase() : "PDF") as MaterialItem["kind"]
                items.push({
                  id: file.id || file.file_path,
                  title: file.title || file.file_name,
                  kind: kindUpper,
                  ...modifiedTime(file.updated_at),
                  path: file.file_path,
                  lastPage: getSavedPdfPage(file.file_path, pdfPageByDocument) || 1,
                  coverTheme: kindUpper === "EPUB" ? "from-violet-900 via-purple-950 to-slate-950" : "from-blue-900 to-indigo-950",
                })
              }
            } else {
              items.push({
                id: `folder-${child.path}`,
                title: child.name,
                kind: "folder",
                itemCount: child.item_count ?? (child.children_loaded === false ? undefined : child.files.length + child.report_count + (child.children?.length ?? 0)),
                ...modifiedTime(child.updated_at),
                path: child.path,
              })
            }
          }
        }

        for (const file of target.files) {
          const kindUpper = (file.kind ? file.kind.toUpperCase() : "PDF") as MaterialItem["kind"]
          items.push({
            id: file.id || file.file_path,
            title: file.title || file.file_name,
            kind: kindUpper,
            ...modifiedTime(file.updated_at),
            path: file.file_path,
            lastPage: getSavedPdfPage(file.file_path, pdfPageByDocument) || 1,
            coverTheme: kindUpper === "EPUB" ? "from-violet-900 via-purple-950 to-slate-950" : "from-blue-900 to-indigo-950",
          })
        }

        for (const week of target.weeks) {
          for (const report of week.reports) {
            items.push({
              id: report.id || report.file_path,
              title: report.title || report.file_name,
              kind: "MD",
              summaryDone: true,
              ...modifiedTime(report.updated_at),
              path: report.file_path,
              coverTheme: "from-emerald-900 to-teal-950",
            })
          }
        }

        return {
          currentFolderTitle: target.name,
          allMaterials: items,
        }
      }
    }

    // 3. 루트: 정리본 저장 폴더 최상위 (과목 폴더 + 루트 직속 파일 직접 파일명으로 나열)
    if (folders.length > 0) {
      const realFolders: MaterialItem[] = []
      const rootFiles: MaterialItem[] = []

      for (const folder of folders) {
        const isVirtual =
          Boolean(folder.is_virtual) ||
          folder.name === "분류되지 않은 파일" ||
          folder.name === "기타 자료"

        if (isVirtual) {
          // 정리본 저장 폴더 직속 파일들을 가상 폴더로 묶지 않고 각각의 파일명으로 직접 나열!
          for (const file of folder.files) {
            const kindUpper = (file.kind ? file.kind.toUpperCase() : "PDF") as MaterialItem["kind"]
            rootFiles.push({
              id: file.id || file.file_path,
              title: file.title || file.file_name,
              kind: kindUpper,
              ...modifiedTime(file.updated_at),
              path: file.file_path,
              lastPage: getSavedPdfPage(file.file_path, pdfPageByDocument) || 1,
              coverTheme: kindUpper === "EPUB" ? "from-violet-900 via-purple-950 to-slate-950" : "from-blue-900 to-indigo-950",
            })
          }

          for (const week of folder.weeks) {
            for (const report of week.reports) {
              rootFiles.push({
                id: report.id || report.file_path,
                title: report.title || report.file_name,
                kind: "MD",
                summaryDone: true,
                ...modifiedTime(report.updated_at),
                path: report.file_path,
                coverTheme: "from-emerald-900 to-teal-950",
              })
            }
          }
        } else {
          // 실제 과목/디렉토리 폴더
          realFolders.push({
            id: `folder-${folder.path}`,
            title: folder.name,
            kind: "folder",
            itemCount: folder.item_count ?? (folder.children_loaded === false ? undefined : folder.files.length + folder.report_count + (folder.children?.length ?? 0)),
            ...modifiedTime(folder.updated_at),
            path: folder.path,
          })
        }
      }

      return {
        currentFolderTitle: basePath || t("작업공간"),
        allMaterials: [...realFolders, ...rootFiles],
      }
    }

    // Loading, empty, or unavailable roots must never become a recent-file listing.
    return {
      currentFolderTitle: basePath || t("작업공간"),
      allMaterials: [],
    }
  }, [lectureMaterials, currentFolderPath, searchQuery, pdfPageByDocument, documentTags])

  const materialsWithProgress = useMemo(() => {
    const byPath = new Map<string, { solved: number; total: number }>()
    const pending = [...(lectureMaterials?.folders ?? [])]
    while (pending.length) {
      const folder = pending.pop()!
      for (const file of [...folder.files, ...folder.weeks.flatMap((week) => week.reports)]) {
        if (file.problem_progress) byPath.set(workspacePinKey(file.file_path), file.problem_progress)
      }
      pending.push(...(folder.children ?? []))
    }
    return allMaterials.map((item) => {
      const progress = item.kind === "folder" ? undefined : byPath.get(workspacePinKey(item.path))
      return progress ? { ...item, problemCount: progress.total, solvedProblemCount: progress.solved } : item
    })
  }, [allMaterials, lectureMaterials])

  // 정렬된 자료 목록 계산
  const sortedMaterials = useMemo(() => {
    const pinned = new Set(pinnedPaths.map(workspacePinKey))
    const list = materialsWithProgress.map((item) => ({ ...item, isPinned: item.kind !== "folder" && pinned.has(workspacePinKey(item.path)) }))
    return list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      // 1. 폴더는 기본적으로 최상단에 배치
      const isFolderA = a.kind === "folder"
      const isFolderB = b.kind === "folder"
      if (isFolderA !== isFolderB) {
        return isFolderA ? -1 : 1
      }

      // 2. 정렬 옵션에 따라 정렬
      switch (sortOption) {
        case "updated_desc": {
          const timeA = a.timestamp ?? 0
          const timeB = b.timestamp ?? 0
          if (timeB !== timeA) return timeB - timeA
          return a.title.localeCompare(b.title, "ko", { numeric: true, sensitivity: "base" })
        }
        case "updated_asc": {
          const timeA = a.timestamp ?? 0
          const timeB = b.timestamp ?? 0
          if (timeA !== timeB) return timeA - timeB
          return a.title.localeCompare(b.title, "ko", { numeric: true, sensitivity: "base" })
        }
        case "name_asc":
          return a.title.localeCompare(b.title, "ko", { numeric: true, sensitivity: "base" })
        case "name_desc":
          return b.title.localeCompare(a.title, "ko", { numeric: true, sensitivity: "base" })
        case "kind_asc": {
          const kindCompare = a.kind.localeCompare(b.kind)
          if (kindCompare !== 0) return kindCompare
          return a.title.localeCompare(b.title, "ko", { numeric: true, sensitivity: "base" })
        }
        default:
          return 0
      }
    })
  }, [materialsWithProgress, sortOption, pinnedPaths])

  return { studyCards, allMaterials: materialsWithProgress, sortedMaterials, currentFolderTitle }
}
