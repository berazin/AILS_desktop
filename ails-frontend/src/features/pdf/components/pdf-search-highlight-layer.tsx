import { memo, useEffect, useMemo, useState } from "react"

import type { PdfOcrWord } from "../../../lib/api"
import { searchHighlightBoxes } from "../search-highlight.ts"
import {
  cachedPdfOcrPageWords,
  loadPdfOcrPageWords,
  pdfOcrPageCacheKey,
} from "./pdf-ocr-text-layer-data.ts"

// 검색 모달에서 결과를 열 때 해당 페이지의 매칭 단어 영역을 강조한다.
export const PdfSearchHighlightLayer = memo(function PdfSearchHighlightLayer({
  page,
  path,
  query,
}: {
  page: number
  path: string
  query: string
}) {
  const trimmed = query.trim()
  const cacheKey = pdfOcrPageCacheKey(path, page)
  const [words, setWords] = useState<PdfOcrWord[]>(() => cachedPdfOcrPageWords(path, page) ?? [])

  useEffect(() => {
    if (!trimmed || !path) return undefined
    let disposed = false
    const cached = cachedPdfOcrPageWords(path, page)
    setWords(cached ?? [])
    if (!cached) {
      void loadPdfOcrPageWords(path, page).then((loaded) => {
        if (!disposed) setWords(loaded)
      }).catch(() => {})
    }
    return () => {
      disposed = true
    }
  }, [cacheKey, page, path, trimmed])

  const boxes = useMemo(
    () => (trimmed && words.length > 0 ? searchHighlightBoxes(words, trimmed) : []),
    [trimmed, words],
  )

  if (!trimmed || boxes.length === 0) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      data-pdf-search-highlight="true"
    >
      {boxes.map((box) => (
        <div
          className="absolute rounded-[2px] border border-[var(--brand)]/70 bg-[var(--brand)]/20 mix-blend-multiply dark:mix-blend-screen"
          key={`${box.left}:${box.top}:${box.right}:${box.bottom}`}
          style={{
            height: `${(box.bottom - box.top) * 100}%`,
            left: `${box.left * 100}%`,
            top: `${box.top * 100}%`,
            width: `${(box.right - box.left) * 100}%`,
          }}
        />
      ))}
    </div>
  )
})
