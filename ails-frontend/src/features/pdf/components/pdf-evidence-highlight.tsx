import { useContext, useEffect, useRef, useState } from "react"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { EvidenceNavigationContext } from "../../chat/lib/evidence-navigation-context.ts"
import { requestJson } from "../../../lib/api/core.ts"

/** Ephemeral viewport overlay, never an annotation or a PDF mutation. */
export function PdfEvidenceHighlight({ document, path, page, rotation }: {
  document: PDFDocumentProxy; path: string; page: number; rotation: number
}) {
  const target = useContext(EvidenceNavigationContext)?.highlight
  const [geometry, setGeometry] = useState<{ target: typeof target; boxes: number[][]; rotation: number; document: PDFDocumentProxy }>()
  const host = useRef<HTMLDivElement>(null)
  const movedLayer = useRef<HTMLElement | null>(null)
  // The fit-page viewer clips a centered zoomed canvas. Negative overflow cannot
  // be reached with scrollTop; a local translation moves canvas and overlay together.
  useEffect(() => {
    return () => { if (movedLayer.current) movedLayer.current.style.translate = '' }
  }, [target, page, document])
  const key = (value: string) => value.replace(/\\/g, "/").toLowerCase()
  const matches = target && key(target.path) === key(path) && target.page === page
  useEffect(() => {
    if (!matches || !target || target.expires <= Date.now()) return
    let disposed = false
    const timer = setTimeout(() => setGeometry(undefined), target.expires - Date.now())
    void Promise.all([document.getPage(page), requestJson<{ evidence: { revision: string }[] }>("/chatbot/evidence/anchor", {
      method: "POST", body: JSON.stringify({ path, page }),
    })]).then(([pdfPage, current]) => {
      if (disposed || target.expires <= Date.now()) return
      if (current.evidence[0]?.revision !== target.revision) return
      const viewport = pdfPage.getViewport({ scale: 1, rotation })
      const boxes = target.boxes.map(box => {
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(box)
        return [Math.min(x1, x2) / viewport.width, Math.min(y1, y2) / viewport.height,
          Math.abs(x2 - x1) / viewport.width, Math.abs(y2 - y1) / viewport.height]
      })
      if (boxes.every(box => box.every(Number.isFinite))) setGeometry({ target, boxes, rotation, document })
    }).catch(() => { if (!disposed) setGeometry(undefined) })
    return () => { disposed = true; clearTimeout(timer) }
  }, [document, matches, page, path, rotation, target])
  useEffect(() => {
    if (geometry?.target !== target || geometry?.rotation !== rotation || geometry?.document !== document || !matches) return
    const focus = () => {
      // Center the retained excerpt, which may include a heading far above its body.
      const words = host.current?.children
      const word = words?.[Math.floor(words.length / 2)]
      const layer = host.current?.closest<HTMLElement>('[data-pdf-page-layer]')
      if (!word || !layer?.parentElement) return
      movedLayer.current = layer
      layer.style.translate = ''
      word.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" })
      const bounds = word.getBoundingClientRect()
      const clip = layer.parentElement.getBoundingClientRect()
      const dx = bounds.left < clip.left || bounds.right > clip.right ? (clip.left + clip.right - bounds.left - bounds.right) / 2 : 0
      const dy = bounds.top < clip.top || bounds.bottom > clip.bottom ? (clip.top + clip.bottom - bounds.top - bounds.bottom) / 2 : 0
      layer.style.translate = `${dx}px ${dy}px`
    }
    const frame = requestAnimationFrame(focus)
    const observer = new ResizeObserver(focus)
    if (host.current) observer.observe(host.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [document, geometry, matches, rotation, target])
  if (!matches || !geometry || geometry.target !== target || geometry.rotation !== rotation || geometry.document !== document) return null
  return <div ref={host} aria-hidden="true" data-pdf-evidence-highlight className="pointer-events-none absolute inset-0 z-20">
    {geometry.boxes.map(([left, top, width, height], index) => <div key={index}
      className="absolute rounded-sm" style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`,
        background: "rgba(255, 196, 0, 0.32)", outline: "1px solid rgba(180, 120, 0, 0.7)" }} />)}
  </div>
}
