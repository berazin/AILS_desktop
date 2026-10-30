export type PdfPageLayout = "single" | "spread"
export type PdfSpreadSide = "even-left" | "odd-left"
export type PdfColorMode = "original" | "theme"
export type PdfRenderQuality = "full" | "preview"

export type PdfPracticeSplitLayoutInput = {
  viewportWidth: number
  viewportHeight: number
  splitX: number
  titleBarHeight?: number
  minEditorWidth?: number
  minPdfWidth?: number
}

export type PdfGlobalPageNavigationInput = {
  key: string
  hasSlideDocument: boolean
  textEntryActive: boolean
  keyboardCaptured: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

export type PdfPageCachePlan = {
  hotPages: number[]
  hotSpreads: number[][]
  previewSpreads: number[][]
  warmPages: number[]
}

export const PDF_VIEW_ZOOM_MIN = 0.75
export const PDF_VIEW_ZOOM_MAX = 3
export const PDF_VIEW_ZOOM_STEP = 0.05

export function pdfPracticeSplitLayout({
  viewportWidth,
  viewportHeight,
  splitX,
  titleBarHeight = 32,
  minEditorWidth = 420,
  minPdfWidth = 360,
}: PdfPracticeSplitLayoutInput) {
  const width = Math.max(0, viewportWidth)
  const height = Math.max(0, viewportHeight)
  const contentTop = Math.min(height, Math.max(0, titleBarHeight))
  const contentHeight = height - contentTop
  const maxSplitX = Math.max(minEditorWidth, width - minPdfWidth)
  const nextSplitX = Math.min(maxSplitX, Math.max(minEditorWidth, splitX))

  return {
    splitX: nextSplitX,
    editor: {
      position: { x: 0, y: contentTop },
      size: { width: nextSplitX, height: contentHeight },
    },
    pdf: {
      position: { x: nextSplitX, y: contentTop },
      size: { width: Math.max(minPdfWidth, width - nextSplitX), height: contentHeight },
    },
  }
}

export function pdfPracticeSurfacePlan(codingModeActive: boolean) {
  return codingModeActive
    ? { showPdfImagePage: false, showCodingImage: true } as const
    : { showPdfImagePage: true, showCodingImage: false } as const
}

export function pdfGlobalPageNavigationDirection({
  key,
  hasSlideDocument,
  textEntryActive,
  keyboardCaptured,
  ctrlKey,
  altKey,
  metaKey,
}: PdfGlobalPageNavigationInput): -1 | 0 | 1 {
  if (!hasSlideDocument || textEntryActive || keyboardCaptured || ctrlKey || altKey || metaKey) return 0
  if (key === "ArrowRight") return 1
  if (key === "ArrowLeft") return -1
  return 0
}

export function normalizePdfViewZoom(value: unknown) {
  if (value == null || String(value).trim() === "") return 1
  const zoom = Number(value)
  return Number.isFinite(zoom)
    ? Math.min(PDF_VIEW_ZOOM_MAX, Math.max(PDF_VIEW_ZOOM_MIN, zoom))
    : 1
}

export function pdfViewZoomFromWheel(current: number, deltaY: number) {
  if (!deltaY) return normalizePdfViewZoom(current)
  const next = normalizePdfViewZoom(current) + (deltaY < 0 ? PDF_VIEW_ZOOM_STEP : -PDF_VIEW_ZOOM_STEP)
  return Math.round(normalizePdfViewZoom(next) * 100) / 100
}

export function pdfPageNavigationDelta(
  delta: number,
  layout: PdfPageLayout,
  codingModeActive: boolean,
  isPdf: boolean,
) {
  return Math.trunc(delta) * (layout === "spread" && !codingModeActive && isPdf ? 2 : 1)
}

export function pdfSpreadPages(
  currentPage: number,
  pageCount: number,
  side: PdfSpreadSide,
): [number | null, number | null] {
  const current = Math.max(1, Math.min(Math.floor(currentPage || 1), Math.max(1, Math.floor(pageCount || 1))))
  const leftParity = side === "even-left" ? 0 : 1
  const left = current % 2 === leftParity ? current : current - 1
  return [left >= 1 ? left : null, left + 1 <= pageCount ? left + 1 : null]
}

export function pdfSpreadNavigationTarget(
  currentPage: number,
  pageCount: number,
  side: PdfSpreadSide,
  delta: number,
) {
  const safePageCount = Math.max(1, Math.floor(pageCount || 1))
  let target = Math.max(1, Math.min(Math.floor(currentPage || 1), safePageCount))
  const direction = Math.sign(Math.trunc(delta))
  for (let step = 0; step < Math.abs(Math.trunc(delta)); step += 1) {
    const visible = pdfSpreadPages(target, safePageCount, side).filter((page): page is number => page != null)
    const boundary = direction > 0 ? Math.max(...visible) : Math.min(...visible)
    if ((direction > 0 && boundary >= safePageCount) || (direction < 0 && boundary <= 1)) break
    target = boundary + direction
  }
  return target
}

export function pdfPageCachePlan(
  pageNumbers: readonly (number | null)[],
  pageCount: number,
  warmRadius?: number,
): PdfPageCachePlan {
  const safePageCount = Math.max(1, Math.floor(pageCount || 1))
  const visible = pageNumbers
    .filter((page): page is number => page != null)
    .map((page) => Math.max(1, Math.min(Math.floor(page), safePageCount)))
  if (visible.length === 0) return { hotPages: [], hotSpreads: [], previewSpreads: [], warmPages: [] }

  const slotCount = Math.max(1, pageNumbers.length)
  const minVisible = Math.min(...visible)
  const maxVisible = Math.max(...visible)
  const safeWarmRadius = Math.max(0, Math.floor(warmRadius ?? (pageNumbers.length > 1 ? 20 : 2)))
  const warmStart = Math.max(1, minVisible - safeWarmRadius)
  const warmEnd = Math.min(safePageCount, maxVisible + safeWarmRadius)
  const warmPages = Array.from({ length: warmEnd - warmStart + 1 }, (_, index) => warmStart + index)

  const spreadAt = (direction: -1 | 1, distance: number) => {
    const start = direction > 0
      ? maxVisible + ((distance - 1) * slotCount) + 1
      : minVisible - (distance * slotCount)
    return Array.from({ length: slotCount }, (_, index) => start + index)
      .filter((page) => page >= warmStart && page <= warmEnd)
  }

  const nextSpread = spreadAt(1, 1)
  const previousSpread = spreadAt(-1, 1)
  const hotSpreads = [visible, nextSpread, previousSpread].filter((spread) => spread.length > 0)
  const hotPages = Array.from(new Set(hotSpreads.flat()))
  const previewSpreads: number[][] = []
  for (let distance = 2; ; distance += 1) {
    const next = spreadAt(1, distance)
    const previous = spreadAt(-1, distance)
    if (next.length === 0 && previous.length === 0) break
    if (next.length > 0) previewSpreads.push(next)
    if (previous.length > 0) previewSpreads.push(previous)
  }
  return { hotPages, hotSpreads, previewSpreads, warmPages }
}

export function pdfSpreadRenderQuality(
  pageNumbers: readonly (number | null)[],
  fullPages: ReadonlySet<number>,
  previewPages: ReadonlySet<number>,
  allowPreview = true,
): PdfRenderQuality | null {
  const pages = pageNumbers.filter((page): page is number => page != null)
  if (pages.length === 0) return null
  if (pages.every((page) => fullPages.has(page))) return "full"
  if (allowPreview && pages.every((page) => previewPages.has(page))) return "preview"
  return null
}
