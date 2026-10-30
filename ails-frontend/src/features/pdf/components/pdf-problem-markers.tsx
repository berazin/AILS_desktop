import { Check, Circle, Edit3, RotateCcw } from "lucide-react"
import { memo, useLayoutEffect, useRef, useState } from "react"

import { t } from "../../../lib/i18n.ts"
import type { PdfProblem } from "../../../lib/api"
import { pdfProblemMarkerPosition, pdfProblemStatusLabel } from "../../../lib/problem-study.ts"

function pdfProblemStatusClass(problem: PdfProblem) {
  if (problem.status === "completed") return "border-emerald-300/50 bg-emerald-600/90 text-white"
  if (problem.status === "retry") return "border-amber-300/60 bg-amber-500/95 text-black"
  if (problem.status === "in_progress") return "border-sky-300/50 bg-sky-600/90 text-white"
  return "border-white/25 bg-zinc-800/90 text-white"
}

function PdfProblemStatusIcon({ problem, size }: { problem: PdfProblem; size: number }) {
  if (problem.status === "completed") return <Check aria-hidden="true" size={size} strokeWidth={3} />
  if (problem.status === "retry") return <RotateCcw aria-hidden="true" size={size} strokeWidth={2.5} />
  if (problem.status === "in_progress") return <Edit3 aria-hidden="true" size={size} strokeWidth={2.5} />
  return <Circle aria-hidden="true" size={size} strokeWidth={2.5} />
}

export const PdfProblemMarkers = memo(function PdfProblemMarkers({
  problems,
  large = false,
  onSelect,
}: {
  problems: PdfProblem[]
  large?: boolean
  onSelect?: (problem: PdfProblem) => void
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const markerRefs = useRef(new Map<string, HTMLButtonElement>())
  const [measuredPositions, setMeasuredPositions] = useState<Record<string, { left: number; top: number }>>({})

  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer || problems.length === 0) {
      setMeasuredPositions({})
      return
    }

    const measure = () => {
      const width = layer.clientWidth
      const height = layer.clientHeight
      if (width <= 0 || height <= 0) return
      const next: Record<string, { left: number; top: number }> = {}
      for (const problem of problems) {
        const labelBox = problem.label_bbox
        const marker = markerRefs.current.get(problem.id)
        if (!labelBox || !marker) continue
        const position = pdfProblemMarkerPosition({
          labelBox,
          layerWidth: width,
          layerHeight: height,
          markerWidth: marker.offsetWidth,
          markerHeight: marker.offsetHeight,
          inset: large ? 6 : 4,
          gap: large ? 6 : 4,
        })
        if (position) next[problem.id] = position
      }
      setMeasuredPositions((current) => {
        const currentKeys = Object.keys(current)
        const nextKeys = Object.keys(next)
        if (
          currentKeys.length === nextKeys.length
          && nextKeys.every((key) => current[key]?.left === next[key].left && current[key]?.top === next[key].top)
        ) return current
        return next
      })
    }

    measure()
    const frame = window.requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(layer)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [large, problems])

  if (problems.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-40 select-none" data-pdf-problem-markers="true" ref={layerRef}>
      {problems.map((problem, index) => {
        const labelBox = problem.label_bbox
        const left = Number(labelBox?.left)
        const top = Number(labelBox?.top)
        const bottom = Number(labelBox?.bottom)
        const hasLabelPosition = Boolean(
          labelBox
          && Number.isFinite(left)
          && Number.isFinite(top)
          && Number.isFinite(bottom),
        )
        const measuredPosition = measuredPositions[problem.id]
        const statusLabel = pdfProblemStatusLabel(problem.status)
        return (
          <button
            aria-label={t("{p0}번 문제: {p1}", { p0: problem.number, p1: statusLabel })}
            className={`pointer-events-auto absolute flex items-center justify-center rounded border shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${large ? "h-6 w-6" : "h-5 w-5"} ${pdfProblemStatusClass(problem)}`}
            data-pdf-annotation-control="true"
            data-pdf-problem-status-marker="true"
            key={problem.id}
            ref={(node) => {
              if (node) markerRefs.current.set(problem.id, node)
              else markerRefs.current.delete(problem.id)
            }}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSelect?.(problem)
            }}
            style={hasLabelPosition && measuredPosition ? {
              left: measuredPosition.left,
              top: measuredPosition.top,
            } : hasLabelPosition ? {
              visibility: "hidden",
            } : {
              right: large ? 12 : 8,
              top: (large ? 12 : 8) + index * (large ? 34 : 26),
            }}
            title={t("{p0} · {p1}번 문제 · {p2}", { p0: problem.chapter, p1: problem.number, p2: statusLabel })}
          >
            <PdfProblemStatusIcon problem={problem} size={large ? 13 : 11} />
            <span className="sr-only">{statusLabel}</span>
          </button>
        )
      })}
    </div>
  )
})
