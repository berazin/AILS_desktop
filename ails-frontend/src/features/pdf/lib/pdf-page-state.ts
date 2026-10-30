import { savePdfPageState } from "../../../lib/api"

export const PDF_PAGE_STORAGE_KEY = "ails-pdf-page-by-path"
const PDF_PAGE_SAVE_DEBOUNCE_MS = 250
const pendingPdfPageSaves = new Map<string, number>()
const pdfPageSaveTimers = new Map<string, number>()

export function readSavedPdfPages() {
  try {
    const raw = localStorage.getItem(PDF_PAGE_STORAGE_KEY)
    if (!raw) return {} as Record<string, number>
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {} as Record<string, number>
    const pages: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const page = Number(value)
      if (key && Number.isFinite(page) && page >= 1) pages[key] = Math.floor(page)
    }
    return pages
  } catch {
    return {} as Record<string, number>
  }
}

export function savePdfPageForPath(pathKey: string, page: number) {
  if (!pathKey || !Number.isFinite(page) || page < 1) return
  const nextPage = Math.floor(page)
  pendingPdfPageSaves.set(pathKey, nextPage)
  const existingTimer = pdfPageSaveTimers.get(pathKey)
  if (existingTimer) window.clearTimeout(existingTimer)
  const timer = window.setTimeout(() => {
    pdfPageSaveTimers.delete(pathKey)
    const pendingPage = pendingPdfPageSaves.get(pathKey)
    pendingPdfPageSaves.delete(pathKey)
    if (!pendingPage) return
    const pages = readSavedPdfPages()
    pages[pathKey] = pendingPage
    localStorage.setItem(PDF_PAGE_STORAGE_KEY, JSON.stringify(pages))
    void savePdfPageState({ path: pathKey, page: pendingPage }).catch((error) => {
      console.warn("[PDF page state] save failed", error)
    })
  }, PDF_PAGE_SAVE_DEBOUNCE_MS)
  pdfPageSaveTimers.set(pathKey, timer)
}
