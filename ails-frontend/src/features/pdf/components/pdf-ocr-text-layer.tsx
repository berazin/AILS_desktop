import { memo, useEffect, useMemo, useState } from "react"

import type { PdfOcrWord } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import {
  cachedPdfOcrPageWords,
  loadPdfOcrPageWords,
  pdfOcrOverlayWords,
  pdfOcrPageCacheKey,
} from "./pdf-ocr-text-layer-data.ts"

export const PdfOcrTextLayer = memo(function PdfOcrTextLayer({
  path,
  page,
  pageCount,
  visible,
}: {
  path: string
  page: number
  pageCount: number
  visible: boolean
}) {
  const cacheKey = pdfOcrPageCacheKey(path, page)
  const [renderedWords, setRenderedWords] = useState<{ cacheKey: string; words: PdfOcrWord[] }>(() => ({
    cacheKey,
    words: cachedPdfOcrPageWords(path, page) ?? [],
  }))
  const words = useMemo(() => (
    renderedWords.cacheKey === cacheKey ? pdfOcrOverlayWords(renderedWords.words) : []
  ), [cacheKey, renderedWords])

  useEffect(() => {
    if (!visible || !path) return
    const cached = cachedPdfOcrPageWords(path, page)
    setRenderedWords({ cacheKey, words: cached ?? [] })
    let disposed = false
    void loadPdfOcrPageWords(path, page).then((currentWords) => {
      if (!disposed) setRenderedWords({ cacheKey, words: currentWords })
      const nearbyPages: number[] = []
      for (let offset = 1; offset <= 3; offset += 1) {
        if (page + offset <= pageCount) nearbyPages.push(page + offset)
        if (page - offset >= 1) nearbyPages.push(page - offset)
      }
      return Promise.all(nearbyPages.map((nearbyPage) => loadPdfOcrPageWords(path, nearbyPage).catch(() => [])))
    }).catch((error) => {
      if (!disposed) console.warn("Failed to load PDF OCR text layer", error)
    })
    return () => {
      disposed = true
    }
  }, [cacheKey, page, pageCount, path, visible])

  if (!visible || words.length === 0) return null
  return (
    <div
      aria-label={t("OCR 인식 글씨 {p0}개", { p0: words.length })}
      className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden [container-type:size]"
      data-pdf-ocr-text-layer="true"
      style={{ containerType: "size" }}
    >
      {words.map((word) => {
        const width = Math.max(0.002, word.right - word.left)
        const height = Math.max(0.002, word.bottom - word.top)
        const textLength = Math.max(1, word.text.replace(/\s/g, "").length)
        const vertical = textLength > 1 && height > width * 1.8
        return (
          <span
            className="absolute flex items-center justify-center overflow-hidden whitespace-nowrap border border-sky-500/35 bg-amber-100/55 px-[1px] font-medium leading-none text-sky-950 shadow-[0_0_1px_rgba(255,255,255,0.9)]"
            key={`${word.index}-${word.left}-${word.top}`}
            style={{
              left: `${word.left * 100}%`,
              top: `${word.top * 100}%`,
              width: `${width * 100}%`,
              height: `${height * 100}%`,
              fontSize: vertical
                ? `clamp(6px, min(${width * 72}cqw, ${height * 88 / textLength}cqh), 22px)`
                : `clamp(6px, min(${height * 72}cqh, ${width * 112 / textLength}cqw), 22px)`,
              opacity: Math.max(0.16, Math.min(0.9, word.confidence)),
              textOrientation: vertical ? "upright" : undefined,
              writingMode: vertical ? "vertical-rl" : undefined,
            }}
            title={`${word.text} (${Math.round(word.confidence * 100)}%)`}
          >
            {word.text}
          </span>
        )
      })}
    </div>
  )
})
