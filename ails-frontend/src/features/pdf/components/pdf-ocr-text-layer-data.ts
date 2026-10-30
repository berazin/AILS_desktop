import { AILSApiError, getPdfOcrPage, type PdfOcrWord } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"

const pdfOcrPageCache = new Map<string, PdfOcrWord[]>()
const pdfOcrPageRequests = new Map<string, Promise<PdfOcrWord[]>>()
const pdfOcrUnavailablePaths = new Set<string>()

function normalizedPdfPath(path: string) {
  return path.replace(/\\/g, "/").toLocaleLowerCase()
}

function pdfOcrBoxArea(word: PdfOcrWord) {
  return Math.max(0, word.right - word.left) * Math.max(0, word.bottom - word.top)
}

function pdfOcrBoxIntersection(left: PdfOcrWord, right: PdfOcrWord) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
  return width * height
}

export function pdfOcrOverlayWords(words: PdfOcrWord[]) {
  return words.filter((word, index) => {
    const area = pdfOcrBoxArea(word)
    if (area <= 0 || !word.text.trim()) return false
    const width = word.right - word.left
    const height = word.bottom - word.top
    if (word.right >= 0.999 && height >= 0.08 && height > width * 2.2) return false
    const isNearDuplicate = words.some((candidate, candidateIndex) => {
      if (candidateIndex === index) return false
      const candidateArea = pdfOcrBoxArea(candidate)
      const intersection = pdfOcrBoxIntersection(word, candidate)
      const union = area + candidateArea - intersection
      if (intersection / Math.max(union, 0.000001) < 0.78) return false
      const candidatePriority = [candidate.confidence, candidate.text.replace(/\s/g, "").length]
      const wordPriority = [word.confidence, word.text.replace(/\s/g, "").length]
      return candidatePriority[0] > wordPriority[0]
        || (candidatePriority[0] === wordPriority[0] && (
          candidatePriority[1] > wordPriority[1]
          || (candidatePriority[1] === wordPriority[1] && candidateIndex < index)
        ))
    })
    if (isNearDuplicate) return false
    return !words.some((parent, parentIndex) => {
      if (parentIndex === index || parent.confidence < 0.8 || parent.text.replace(/\s/g, "").length < 5) return false
      const parentWidth = parent.right - parent.left
      const parentHeight = parent.bottom - parent.top
      return parentWidth >= 2 * parentHeight
        && parentWidth >= 1.5 * width
        && parentHeight >= 1.25 * height
        && pdfOcrBoxIntersection(parent, word) / area >= 0.85
    })
  })
}

export function pdfOcrPageCacheKey(path: string, page: number) {
  return `${normalizedPdfPath(path)}\u0000${page}`
}

export function cachedPdfOcrPageWords(path: string, page: number) {
  return pdfOcrPageCache.get(pdfOcrPageCacheKey(path, page))
}

export function loadPdfOcrPageWords(path: string, page: number) {
  const normalizedPath = normalizedPdfPath(path)
  if (pdfOcrUnavailablePaths.has(normalizedPath)) return Promise.resolve([])
  const cacheKey = pdfOcrPageCacheKey(path, page)
  const cached = pdfOcrPageCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)
  const pending = pdfOcrPageRequests.get(cacheKey)
  if (pending) return pending
  const request = getPdfOcrPage(path, page).then((result) => {
    pdfOcrPageCache.set(cacheKey, result.words)
    return result.words
  }).catch((error) => {
    if (error instanceof AILSApiError && error.message.includes("PaddleOCR") && error.message.includes(t("인덱스"))) {
      pdfOcrUnavailablePaths.add(normalizedPath)
      pdfOcrPageCache.set(cacheKey, [])
      return []
    }
    throw error
  }).finally(() => {
    pdfOcrPageRequests.delete(cacheKey)
  })
  pdfOcrPageRequests.set(cacheKey, request)
  return request
}

export function invalidatePdfOcrTextLayer(path: string) {
  const normalizedPath = normalizedPdfPath(path)
  pdfOcrUnavailablePaths.delete(normalizedPath)
  for (const key of pdfOcrPageCache.keys()) {
    if (key.startsWith(`${normalizedPath}\u0000`)) pdfOcrPageCache.delete(key)
  }
}
