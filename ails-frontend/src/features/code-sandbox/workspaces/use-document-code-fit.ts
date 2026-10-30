import { useLayoutEffect, type RefObject } from "react"
import type { DocumentCodeFit } from "./session.ts"

export function documentCodeFitRatio(width: number, height: number, aspect: number, documentOnRight: boolean): number | null {
  const available = width - 6
  if (available <= 0 || height <= 0 || !Number.isFinite(aspect) || aspect <= 0) return null
  const ideMinimum = Math.min(320, available / 2)
  const documentWidth = Math.min(height * aspect, available - ideMinimum)
  const share = documentWidth / available
  return documentOnRight ? 1 - share : share
}

export function useDocumentCodeFit({ containerRef, documentPaneRef, documentId, page, split, fit, apply }: {
  containerRef: RefObject<HTMLDivElement | null>
  documentPaneRef: RefObject<HTMLDivElement | null>
  documentId: string
  page: number
  split: [string, string] | null
  fit: DocumentCodeFit | null
  apply: (ratio: number, aspect: number) => void
}) {
  useLayoutEffect(() => {
    const container = containerRef.current
    const pane = documentPaneRef.current
    if (!container || !pane || !fit || fit.id !== documentId || !split?.includes(fit.id)) return
    const measure = () => {
      const layers = Array.from(pane.querySelectorAll<HTMLElement>(`[data-pdf-page-number="${page}"]`))
      const layer = layers.find((element) => element.getBoundingClientRect().height > 0)
      const pageBounds = layer?.getBoundingClientRect()
      const aspect = layer && pageBounds?.height
        ? (parseFloat(layer.style.width) || pageBounds.width) / (parseFloat(layer.style.height) || pageBounds.height)
        : fit.aspect
      if (!aspect) return
      const bounds = container.getBoundingClientRect()
      const viewer = layer?.closest<HTMLElement>("[data-ails-pdf-viewer]")
      const height = viewer?.getBoundingClientRect().height || bounds.height
      const ratio = documentCodeFitRatio(bounds.width, height, aspect, split[1] === fit.id)
      if (ratio !== null) apply(ratio, aspect)
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(container)
    resize.observe(pane)
    const mutations = new MutationObserver(measure)
    mutations.observe(pane, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "data-pdf-page-number"] })
    return () => { resize.disconnect(); mutations.disconnect() }
  }, [apply, containerRef, documentId, documentPaneRef, fit, page, split])
}
