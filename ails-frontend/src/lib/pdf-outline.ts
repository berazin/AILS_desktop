import { t } from "./i18n.ts"
export type PdfOutlineEntry = {
  title: string
  page: number
  level: number
}

export type PdfOutlineNode = PdfOutlineEntry & {
  id: string
  children: PdfOutlineNode[]
}

export type PdfChapterRange = {
  id: string
  title: string
  startPage: number
  endPage: number
}

function normalizedOutlineLevel(value: unknown) {
  const level = Number(value)
  return Number.isFinite(level) && level >= 1 ? Math.trunc(level) : 1
}

function validChapterNumber(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : null
}

function chapterNumberFromTitle(title: string) {
  const patterns = [
    /^\s*chapter\s*0*(\d{1,2})\b/i,
    /^\s*\uC81C\s*0*(\d{1,2})\s*(?:\uC7A5|\uD3B8|\uBD80)(?:\s|$)/,
    /^\s*0*(\d{1,2})\s*(?:\uC7A5|\uCC55\uD130)(?:\s|$)/,
    /^\s*0*(\d{1,2})\s+(?![.\d])/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(title)
    if (match) return validChapterNumber(Number(match[1]))
  }
  return null
}

function chapterNumberFromSectionTitle(title: string) {
  const match = /^\s*(?:\d{1,3}\s+)?0*(\d{1,2})\s*[.\uFF0E]\s*\d+/.exec(title)
  return match ? validChapterNumber(Number(match[1])) : null
}

function appendToChapter(
  node: PdfOutlineNode,
  ancestors: PdfOutlineNode[],
) {
  node.level = Math.max(2, node.level)
  while (ancestors.length > 1 && ancestors[ancestors.length - 1].level >= node.level) {
    ancestors.pop()
  }
  ancestors[ancestors.length - 1].children.push(node)
  ancestors.push(node)
  return ancestors
}

export function buildPdfOutlineTree(outline: readonly PdfOutlineEntry[]): PdfOutlineNode[] {
  const roots: PdfOutlineNode[] = []
  const chapters = new Map<number, PdfOutlineNode>()
  const chapterAncestors = new Map<number, PdfOutlineNode[]>()
  const sectionCounts = new Map<number, number>()
  const genericAncestors: PdfOutlineNode[] = []
  let activeChapterNumber: number | null = null

  for (const entry of outline) {
    const chapterNumber = chapterNumberFromSectionTitle(String(entry.title || ""))
    if (chapterNumber !== null) {
      sectionCounts.set(chapterNumber, (sectionCounts.get(chapterNumber) || 0) + 1)
    }
  }

  outline.forEach((entry, index) => {
    const node: PdfOutlineNode = {
      title: String(entry.title || ""),
      page: Number(entry.page),
      level: normalizedOutlineLevel(entry.level),
      id: `pdf-outline-${index}`,
      children: [],
    }

    const explicitChapterNumber = chapterNumberFromTitle(node.title)
    if (explicitChapterNumber !== null) {
      node.level = 1
      roots.push(node)
      chapters.set(explicitChapterNumber, node)
      chapterAncestors.set(explicitChapterNumber, [node])
      genericAncestors.length = 0
      activeChapterNumber = explicitChapterNumber
      return
    }

    const sectionChapterNumber = chapterNumberFromSectionTitle(node.title)
    if (sectionChapterNumber !== null) {
      let chapter = chapters.get(sectionChapterNumber)
      if (!chapter && (sectionCounts.get(sectionChapterNumber) || 0) >= 2) {
        chapter = {
          title: t("{p0}장", { p0: sectionChapterNumber }),
          page: node.page,
          level: 1,
          id: `pdf-outline-synthetic-${sectionChapterNumber}-${index}`,
          children: [],
        }
        roots.push(chapter)
        chapters.set(sectionChapterNumber, chapter)
        chapterAncestors.set(sectionChapterNumber, [chapter])
      }
      if (chapter) {
        const ancestors = chapterAncestors.get(sectionChapterNumber) || [chapter]
        chapterAncestors.set(
          sectionChapterNumber,
          appendToChapter(node, ancestors),
        )
        activeChapterNumber = sectionChapterNumber
        return
      }

      // A subsection from another chapter must not be placed under the
      // previously active chapter when its chapter heading was not detected.
      roots.push(node)
      genericAncestors.length = 0
      genericAncestors.push(node)
      activeChapterNumber = null
      return
    }

    if (activeChapterNumber !== null) {
      const chapter = chapters.get(activeChapterNumber)
      if (chapter) {
        const ancestors = chapterAncestors.get(activeChapterNumber) || [chapter]
        chapterAncestors.set(
          activeChapterNumber,
          appendToChapter(node, ancestors),
        )
        return
      }
    }

    while (genericAncestors.length > 0 && genericAncestors[genericAncestors.length - 1].level >= node.level) {
      genericAncestors.pop()
    }
    if (genericAncestors.length > 0) {
      genericAncestors[genericAncestors.length - 1].children.push(node)
    } else {
      roots.push(node)
    }
    genericAncestors.push(node)
  })

  if (roots.length > 0 && !roots.some((node) => chapterNumberFromTitle(node.title) !== null)) {
    roots.forEach((node, index) => { node.title = t("{p0}장 {p1}", { p0: index + 1, p1: node.title }) })
  }

  return roots
}

function stableChapterId(title: string, startPage: number) {
  const normalizedTitle = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
  return `pdf-chapter-${startPage}-${normalizedTitle || "untitled"}`
}

export function buildPdfChapterRanges(
  outline: readonly PdfOutlineEntry[],
  pageCount: number,
): PdfChapterRange[] {
  const boundedPageCount = Math.max(1, Math.trunc(Number(pageCount) || 1))
  const outlineRoots = buildPdfOutlineTree(outline)
  const numberedRoots = outlineRoots.filter((node) => (
    chapterNumberFromTitle(node.title) !== null || node.id.startsWith("pdf-outline-synthetic-")
  ))
  const chapterRoots = (numberedRoots.length > 0 ? numberedRoots : outlineRoots)
    .map((node) => ({
      title: node.title.trim() || t("이름 없는 장"),
      startPage: Math.min(boundedPageCount, Math.max(1, Math.trunc(Number(node.page) || 1))),
    }))
    .sort((left, right) => left.startPage - right.startPage)
    .filter((chapter, index, all) => (
      all.findIndex((candidate) => candidate.startPage === chapter.startPage) === index
    ))

  if (chapterRoots.length === 0) {
    return [{
      id: "pdf-document-all",
      title: t("전체 문서"),
      startPage: 1,
      endPage: boundedPageCount,
    }]
  }

  return chapterRoots.map((chapter, index) => ({
    id: stableChapterId(chapter.title, chapter.startPage),
    title: chapter.title,
    startPage: chapter.startPage,
    endPage: Math.max(
      chapter.startPage,
      Math.min(
        boundedPageCount,
        index + 1 < chapterRoots.length
          ? chapterRoots[index + 1].startPage - 1
          : boundedPageCount,
      ),
    ),
  }))
}

export function pdfChapterForPage(
  outline: readonly PdfOutlineEntry[],
  pageCount: number,
  page: number,
): PdfChapterRange | null {
  const ranges = buildPdfChapterRanges(outline, pageCount)
  const boundedPage = Math.max(1, Math.trunc(Number(page) || 1))
  return ranges.find((range) => boundedPage >= range.startPage && boundedPage <= range.endPage) ?? null
}
