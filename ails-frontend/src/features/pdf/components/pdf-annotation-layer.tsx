import { t } from "../../../lib/i18n.ts"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { Eraser } from "lucide-react"
import rough from "roughjs"

import type { PdfAnnotation, PdfOcrWord } from "../../../lib/api"
import {
  annotationConnectorPointsFromGesture,
  annotationConnectorPointsToPath,
  annotationHandwrittenArrowHeadPath,
  annotationHandwrittenEllipsePath,
  annotationHandwrittenHighlightPath,
  annotationHandwrittenLinePath,
  annotationHandwrittenUnderlinePath,
  annotationPointsToPath,
  annotationPointerWithinPlusRange,
  annotationPlusPointNearestToPointer,
  annotationSelectionFlowRects,
  annotationSpreadEdgePoints,
  clampAnnotationPoint,
  compactAnnotationPoints,
  correctHeldPdfShape,
  type CorrectedPdfShape,
  type PdfAnnotationPoint,
  type PdfAnnotationRect,
} from "../lib/pdf-annotation-geometry.ts"
import { cn } from "../../../lib/utils.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { usePdfSelectionDismissal } from "../hooks/use-pdf-selection-dismissal.ts"
import { usePdfSelectionCopy } from "../hooks/use-pdf-selection-copy.ts"
import { pdfSelectableCharacters, pdfSelectionText, type PdfSelectableCharacter } from "../lib/pdf-selection-text.ts"
import { selectionBubbleOutsideToolbar } from "../lib/pdf-selection-bubble.ts"
import { PdfAnnotationNote, type PdfAnnotationNoteValue } from "./pdf-annotation-note.tsx"

export type PdfAnnotationMode = "default" | "erase"

export type PdfAnnotationSettings = {
  color: string
  strokeWidth: number
  fontSize: number
  shapeCorrection: boolean
  shapeHoldMs: number
}

type PdfAnnotationLayerProps = {
  annotations: PdfAnnotation[]
  mode: PdfAnnotationMode
  page: number
  pdfPath: string
  settings: PdfAnnotationSettings
  loadWords: (path: string, page: number) => Promise<PdfOcrWord[]>
  onCommit: (annotation: PdfAnnotation) => void
  onDelete: (annotationId: string) => void
}

type Gesture = {
  kind: "draw" | "select"
  pointerId: number
  pointerType: string
  start: PdfAnnotationPoint
  points: PdfAnnotationPoint[]
  moved: boolean
  dismissSelectionOnClick?: boolean
  startCharacterPosition?: number
  endCharacterPosition?: number
  endPage?: number
  pageSegments?: Array<{ page: number; points: PdfAnnotationPoint[] }>
  activePageBounds?: DOMRect
  previewPoints?: PdfAnnotationPoint[]
  sourcePageLayer?: HTMLElement
}

type SelectedText = {
  text: string
  plus: PdfAnnotationPoint
  rects: PdfAnnotationRect[]
  pageRects: Array<{ page: number; rects: PdfAnnotationRect[] }>
  toolbar: PdfAnnotationPoint & { below: boolean }
}

type SelectionPointerPosition = Pick<PointerEvent, "clientX" | "clientY" | "pressure">

type TextDraft = PdfAnnotationNoteValue

const roughGenerator = rough.generator()
const ROUGH_COORDINATE_SCALE = 1000
const CONNECTOR_RING_PADDING_X = 0.011
const CONNECTOR_RING_PADDING_Y = 0.007
const ERASER_DIAMETER = 28
const RIGHT_CLICK_HOLD_MS = 300
const PDF_SELECTION_CLEAR_EVENT = "ails-pdf-annotation-clear-selection"
const annotationPageRegistry = new WeakMap<HTMLElement, { characters: PdfSelectableCharacter[]; page: number }>()

function roughSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) & 0x7fffffff) || 1
}

function HandwrittenEllipse({
  color,
  paddingX = 0,
  paddingY = 0,
  rect,
  seed,
  strokeWidth,
}: {
  color: string
  paddingX?: number
  paddingY?: number
  rect: PdfAnnotationRect
  seed: number
  strokeWidth: number
}) {
  const path = useMemo(
    () => annotationHandwrittenEllipsePath(rect, seed, paddingX, paddingY),
    [paddingX, paddingY, rect, seed],
  )
  return (
    <path
      d={path}
      fill="none"
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  )
}

function RoughEllipse({
  color,
  paddingX,
  paddingY,
  rect,
  seed,
  strokeWidth,
}: {
  color: string
  paddingX: number
  paddingY: number
  rect: PdfAnnotationRect
  seed: number
  strokeWidth: number
}) {
  const paths = useMemo(() => roughGenerator.toPaths(roughGenerator.ellipse(
    (rect.x + rect.width / 2) * ROUGH_COORDINATE_SCALE,
    (rect.y + rect.height / 2) * ROUGH_COORDINATE_SCALE,
    (rect.width + paddingX * 2) * ROUGH_COORDINATE_SCALE,
    (rect.height + paddingY * 2) * ROUGH_COORDINATE_SCALE,
    {
      curveFitting: 0.98,
      disableMultiStroke: true,
      roughness: 0.38,
      seed,
      stroke: color,
      strokeWidth,
    },
  )), [color, paddingX, paddingY, rect.height, rect.width, rect.x, rect.y, seed, strokeWidth])
  return paths.map((path, index) => (
    <path
      d={path.d}
      fill={path.fill ?? "none"}
      key={`${seed}-${index}`}
      pointerEvents="none"
      stroke={path.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      transform={`scale(${1 / ROUGH_COORDINATE_SCALE})`}
      vectorEffect="non-scaling-stroke"
    />
  ))
}

function unionRects(rects: readonly PdfAnnotationRect[]): PdfAnnotationRect {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function mergeSelectionRects(rects: readonly PdfAnnotationRect[]) {
  const sorted = rects
    .map(({ x, y, width, height }) => ({ x, y, width, height }))
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => left.y - right.y || left.x - right.x)
  const lines: PdfAnnotationRect[] = []
  for (const rect of sorted) {
    const line = lines[lines.length - 1]
    if (!line) {
      lines.push(rect)
      continue
    }
    const overlap = Math.max(0, Math.min(line.y + line.height, rect.y + rect.height) - Math.max(line.y, rect.y))
    if (overlap / Math.max(0.000001, Math.min(line.height, rect.height)) < 0.35) {
      lines.push(rect)
      continue
    }
    lines[lines.length - 1] = unionRects([line, rect])
  }
  return lines.slice(0, 100)
}

function annotationMarkerId(annotationId: string) {
  return `pdf-annotation-arrow-${annotationId.replace(/[^a-zA-Z0-9_-]/g, "")}`
}

function annotationPath(annotation: PdfAnnotation, seed: number) {
  if (annotation.kind === "line" && annotation.points.length >= 2) {
    return annotationHandwrittenLinePath([annotation.points[0], annotation.points[annotation.points.length - 1]], seed)
  }
  if (annotation.kind === "connector") return annotationConnectorPointsToPath(annotation.points)
  return annotationPointsToPath(annotation.points)
}

export const PdfAnnotationLayer = memo(function PdfAnnotationLayer({
  annotations,
  mode,
  page,
  pdfPath,
  settings,
  loadWords,
  onCommit,
  onDelete,
}: PdfAnnotationLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const connectorRef = useRef<{
    anchor: PdfAnnotationPoint
    dismissSelectionOnClick: boolean
    moved: boolean
    pointerId: number
    points: PdfAnnotationPoint[]
  } | null>(null)
  const eraserCursorRef = useRef<HTMLDivElement | null>(null)
  const rightButtonEraseUsedRef = useRef(false)
  const eraserDraggingRef = useRef(false)
  const rightButtonHoldTimerRef = useRef<number | null>(null)
  const rightButtonStartRef = useRef<{ x: number; y: number } | null>(null)
  const draftFrameRef = useRef<number | null>(null)
  const selectionFrameRef = useRef<number | null>(null)
  const pendingSelectionRef = useRef<{ end: PdfAnnotationPoint; endPosition: number; startPosition: number } | null>(null)
  const hoverCharacterPositionRef = useRef(-1)
  const holdTimerRef = useRef<number | null>(null)
  const correctedShapeRef = useRef<CorrectedPdfShape | null>(null)
  const textInputRef = useRef<HTMLTextAreaElement | null>(null)
  const plusButtonRef = useRef<HTMLButtonElement | null>(null)
  const selectionActionsRef = useRef<HTMLDivElement | null>(null)
  const selectedTextRef = useRef<SelectedText | null>(null)
  const hasSelectionRef = useRef(false)
  const selectionPageLayerRef = useRef<HTMLElement | null>(null)
  const overflowConnectorRef = useRef(false)
  const [draftPoints, setDraftPoints] = useState<PdfAnnotationPoint[]>([])
  const [selectedText, setSelectedText] = useState<SelectedText | null>(null)
  const [selectionComplete, setSelectionComplete] = useState(false)
  const [pageWords, setPageWords] = useState<PdfOcrWord[]>([])
  const [correctedShape, setCorrectedShape] = useState<CorrectedPdfShape | null>(null)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
  const [rightButtonErasing, setRightButtonErasing] = useState(false)
  const erasing = mode === "erase" || rightButtonErasing
  const selectableCharacters = useMemo(() => pdfSelectableCharacters(pageWords), [pageWords])
  usePdfSelectionCopy(rootRef, selectedText?.text ?? "", selectionComplete)
  const textDraftId = textDraft?.annotationId

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    annotationPageRegistry.set(root, { characters: selectableCharacters, page })
    return () => { annotationPageRegistry.delete(root) }
  }, [page, selectableCharacters])

  const clearSelectedText = useCallback(() => {
    if (selectionPageLayerRef.current) {
      selectionPageLayerRef.current.style.zIndex = overflowConnectorRef.current ? "20" : ""
    }
    selectionPageLayerRef.current = null
    hasSelectionRef.current = false
    selectedTextRef.current = null
    setSelectedText(null)
    setSelectionComplete(false)
  }, [])

  usePdfSelectionDismissal(rootRef, selectionComplete, clearSelectedText)

  useEffect(() => {
    const root = rootRef.current
    const spread = root?.closest("[data-pdf-page-spread='true']")
    if (!root || !spread) return
    const clearOtherSelection = (event: Event) => {
      if ((event as CustomEvent<{ source: HTMLElement }>).detail?.source === root || !hasSelectionRef.current) return
      event.preventDefault()
      clearSelectedText()
    }
    spread.addEventListener(PDF_SELECTION_CLEAR_EVENT, clearOtherSelection)
    return () => spread.removeEventListener(PDF_SELECTION_CLEAR_EVENT, clearOtherSelection)
  }, [clearSelectedText])

  useEffect(() => {
    if (mode !== "default") {
      clearSelectedText()
      return
    }
    let disposed = false
    clearSelectedText()
    setPageWords([])
    void loadWords(pdfPath, page).then((words) => {
      if (!disposed) setPageWords(words)
    }).catch(() => {
      if (!disposed) setPageWords([])
    })
    return () => {
      disposed = true
    }
  }, [clearSelectedText, loadWords, mode, page, pdfPath])

  useEffect(() => {
    if (!textDraftId) return
    const frame = window.requestAnimationFrame(() => {
      const input = textInputRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      input.setSelectionRange(input.value.length, input.value.length)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [textDraftId])

  useEffect(() => () => {
    if (draftFrameRef.current != null) window.cancelAnimationFrame(draftFrameRef.current)
    if (selectionFrameRef.current != null) window.cancelAnimationFrame(selectionFrameRef.current)
    if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current)
    if (rightButtonHoldTimerRef.current != null) window.clearTimeout(rightButtonHoldTimerRef.current)
  }, [])

  useEffect(() => {
    if (rootRef.current) rootRef.current.style.cursor = erasing ? "none" : "default"
    if (!erasing && eraserCursorRef.current) eraserCursorRef.current.style.opacity = "0"
  }, [erasing])

  useEffect(() => {
    const stopRightButtonErase = (event: PointerEvent) => {
      eraserDraggingRef.current = false
      if (event.button !== 2 && (event.buttons & 2) !== 0) return
      if (rightButtonHoldTimerRef.current != null) window.clearTimeout(rightButtonHoldTimerRef.current)
      rightButtonHoldTimerRef.current = null
      rightButtonStartRef.current = null
      setRightButtonErasing(false)
    }
    const cancelRightButtonErase = () => {
      eraserDraggingRef.current = false
      if (rightButtonHoldTimerRef.current != null) window.clearTimeout(rightButtonHoldTimerRef.current)
      rightButtonHoldTimerRef.current = null
      rightButtonStartRef.current = null
      setRightButtonErasing(false)
    }
    window.addEventListener("pointerup", stopRightButtonErase)
    window.addEventListener("pointercancel", cancelRightButtonErase)
    window.addEventListener("blur", cancelRightButtonErase)
    return () => {
      window.removeEventListener("pointerup", stopRightButtonErase)
      window.removeEventListener("pointercancel", cancelRightButtonErase)
      window.removeEventListener("blur", cancelRightButtonErase)
    }
  }, [])

  function pointFromPointer(event: SelectionPointerPosition): PdfAnnotationPoint {
    const bounds = rootRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return clampAnnotationPoint({
      x: (event.clientX - bounds.left) / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) / Math.max(1, bounds.height),
      pressure: event.pressure || undefined,
    })
  }

  function connectorPointFromPointer(event: ReactPointerEvent<HTMLElement>) {
    const rootBounds = rootRef.current?.getBoundingClientRect()
    const spread = rootRef.current?.closest("[data-pdf-page-spread='true']")
    const pageLayers = spread?.querySelectorAll<HTMLElement>("[data-pdf-page-layer='true']") ?? []
    if (!rootBounds || pageLayers.length < 2) return pointFromPointer(event)
    const bounds = Array.from(pageLayers, (layer) => layer.getBoundingClientRect())
    const left = Math.min(...bounds.map((item) => item.left))
    const right = Math.max(...bounds.map((item) => item.right))
    const top = Math.min(...bounds.map((item) => item.top))
    const bottom = Math.max(...bounds.map((item) => item.bottom))
    return {
      x: (Math.max(left, Math.min(right, event.clientX)) - rootBounds.left) / Math.max(1, rootBounds.width),
      y: (Math.max(top, Math.min(bottom, event.clientY)) - rootBounds.top) / Math.max(1, rootBounds.height),
      pressure: event.pressure || undefined,
    }
  }

  function pointWithinBounds(event: SelectionPointerPosition, bounds: DOMRect) {
    return clampAnnotationPoint({
      x: (event.clientX - bounds.left) / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) / Math.max(1, bounds.height),
      pressure: event.pressure || undefined,
    })
  }

  function spreadPageFromPointer(event: SelectionPointerPosition) {
    const spread = rootRef.current?.closest("[data-pdf-page-spread='true']")
    const pageLayer = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pdf-page-layer='true']")
    if (!spread || !pageLayer || pageLayer.closest("[data-pdf-page-spread='true']") !== spread) return null
    const targetPage = Number(pageLayer.dataset.pdfPageNumber)
    if (!Number.isInteger(targetPage) || targetPage < 1) return null
    const bounds = pageLayer.getBoundingClientRect()
    const annotationLayer = pageLayer.querySelector<HTMLElement>("[data-pdf-annotation-layer='true']")
    const registration = annotationLayer ? annotationPageRegistry.get(annotationLayer) : undefined
    return { bounds, page: targetPage, point: pointWithinBounds(event, bounds), registration }
  }

  function appendSpreadDrawPoint(gesture: Gesture, event: ReactPointerEvent<HTMLElement>) {
    const sourceBounds = rootRef.current?.getBoundingClientRect()
    if (!sourceBounds || !gesture.pageSegments || !gesture.previewPoints) return false
    const previewPoint = {
      x: (event.clientX - sourceBounds.left) / Math.max(1, sourceBounds.width),
      y: (event.clientY - sourceBounds.top) / Math.max(1, sourceBounds.height),
      pressure: event.pressure || undefined,
    }
    const previousPreview = gesture.previewPoints.at(-1)!
    if (Math.hypot(previewPoint.x - previousPreview.x, previewPoint.y - previousPreview.y) >= 0.001) {
      gesture.previewPoints.push(previewPoint)
    }
    const target = spreadPageFromPointer(event)
    if (!target) {
      scheduleDraftPaint(gesture.previewPoints)
      return false
    }
    let segment = gesture.pageSegments.at(-1)!
    if (segment.page !== target.page) {
      const previousBounds = gesture.activePageBounds
      if (previousBounds) {
        const previousPoint = segment.points.at(-1)!
        const edges = annotationSpreadEdgePoints(previousPoint, previousBounds, target.bounds, {
          x: event.clientX,
          y: event.clientY,
        })
        const previousEnd = { ...edges.previous, pressure: event.pressure || undefined }
        if (Math.hypot(previousEnd.x - segment.points.at(-1)!.x, previousEnd.y - segment.points.at(-1)!.y) >= 0.001) {
          segment.points.push(previousEnd)
        }
        const targetStart = { ...edges.target, pressure: event.pressure || undefined }
        segment = { page: target.page, points: [targetStart] }
      } else {
        segment = { page: target.page, points: [target.point] }
      }
      gesture.pageSegments.push(segment)
      gesture.points = segment.points
      gesture.activePageBounds = target.bounds
      gesture.moved = true
      clearShapeTimer()
      clearCorrectedShape()
    }
    const previous = segment.points.at(-1)!
    if (Math.hypot(target.point.x - previous.x, target.point.y - previous.y) >= 0.001) segment.points.push(target.point)
    scheduleDraftPaint(gesture.previewPoints)
    return gesture.pageSegments.length > 1
  }

  function moveEraserCursor(event: ReactPointerEvent<HTMLElement>) {
    const bounds = rootRef.current?.getBoundingClientRect()
    const cursor = eraserCursorRef.current
    if (!bounds || !cursor) return
    cursor.style.opacity = "1"
    cursor.style.transform = `translate3d(${event.clientX - bounds.left - ERASER_DIAMETER / 2}px, ${event.clientY - bounds.top - ERASER_DIAMETER / 2}px, 0)`
  }

  function annotationIdFromTarget(target: EventTarget) {
    return target instanceof Element
      ? target.closest("[data-pdf-annotation-id]")?.getAttribute("data-pdf-annotation-id") ?? ""
      : ""
  }

  function eraseWithMouse(event: ReactMouseEvent<HTMLDivElement>) {
    if (!erasing || event.button !== 0) return
    const annotationId = annotationIdFromTarget(document.elementFromPoint(event.clientX, event.clientY) ?? event.target)
    event.preventDefault()
    event.stopPropagation()
    if (rightButtonErasing || (event.buttons & 2) !== 0) rightButtonEraseUsedRef.current = true
    eraserDraggingRef.current = true
    if (annotationId) onDelete(annotationId)
  }

  function eraseWithPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!erasing || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    eraserDraggingRef.current = true
    const annotationId = annotationIdFromTarget(event.target)
    if (annotationId) onDelete(annotationId)
  }

  function findSelectableCharacterPosition(
    point: PdfAnnotationPoint,
    preferredPosition = -1,
    characters = selectableCharacters,
  ) {
    const contains = (position: number) => {
      const rect = characters[position]
      if (!rect) return false
      const padding = 0.001
      return point.x >= rect.x - padding
        && point.x <= rect.x + rect.width + padding
        && point.y >= rect.y - padding
        && point.y <= rect.y + rect.height + padding
    }
    if (preferredPosition >= 0) {
      for (const offset of [0, 1, -1, 2, -2]) {
        const position = preferredPosition + offset
        if (contains(position)) return position
      }
    }
    let match = -1
    let smallestArea = Number.POSITIVE_INFINITY
    characters.forEach((rect, position) => {
      if (!contains(position)) return
      const area = rect.width * rect.height
      if (area < smallestArea) {
        match = position
        smallestArea = area
      }
    })
    return match
  }

  function updateSelectedTextPages(
    pages: Array<{ bounds: DOMRect; page: number; rects: PdfAnnotationRect[]; text: string }>,
    end: PdfAnnotationPoint,
  ) {
    const sourceBounds = rootRef.current?.getBoundingClientRect()
    if (!sourceBounds) return null
    const pageRects = pages
      .map(({ page: annotationPage, rects }) => ({ page: annotationPage, rects }))
      .filter(({ rects }) => rects.length > 0)
    const rects = pages.flatMap(({ bounds, rects: localRects }) => localRects.map((rect) => ({
      height: rect.height * bounds.height / sourceBounds.height,
      width: rect.width * bounds.width / sourceBounds.width,
      x: (bounds.left - sourceBounds.left + rect.x * bounds.width) / sourceBounds.width,
      y: (bounds.top - sourceBounds.top + rect.y * bounds.height) / sourceBounds.height,
    })))
    if (rects.length === 0) return null
    const plus = annotationPlusPointNearestToPointer(rects, end, sourceBounds.width, sourceBounds.height, pages.length === 1)
    const selectedBounds = unionRects(rects)
    const toolbarGap = 8 / Math.max(1, sourceBounds.height)
    const below = selectedBounds.y < 34 / Math.max(1, sourceBounds.height)
    const selection: SelectedText = {
      text: [...pages].sort((left, right) => left.page - right.page).map(item => item.text).filter(Boolean).join("\n"),
      plus,
      pageRects,
      rects,
      toolbar: {
        below,
        x: pages.length === 1
          ? Math.max(0.12, Math.min(0.88, selectedBounds.x + selectedBounds.width / 2))
          : selectedBounds.x + selectedBounds.width / 2,
        y: below ? selectedBounds.y + selectedBounds.height + toolbarGap : selectedBounds.y - toolbarGap,
      },
    }
    selectedTextRef.current = selection
    setSelectedText(selection)
    return selection
  }

  function updateSelectedText(startPosition: number, endPosition: number, end: PdfAnnotationPoint) {
    const bounds = rootRef.current?.getBoundingClientRect()
    if (!bounds) return null
    return updateSelectedTextPages([{
      bounds,
      page,
      rects: mergeSelectionRects(annotationSelectionFlowRects(selectableCharacters, startPosition, endPosition)),
      text: pdfSelectionText(selectableCharacters, startPosition, endPosition),
    }], end)
  }

  function updateGestureSelection(
    gesture: Gesture,
    event: SelectionPointerPosition,
    immediate = false,
  ) {
    const sourceBounds = rootRef.current?.getBoundingClientRect()
    const target = spreadPageFromPointer(event)
    if (
      !sourceBounds
      || !target?.registration
      || target.registration.page !== target.page
      || gesture.startCharacterPosition == null
    ) return null
    const preferredPosition = gesture.endPage === target.page ? gesture.endCharacterPosition : -1
    const endPosition = findSelectableCharacterPosition(target.point, preferredPosition, target.registration.characters)
    if (endPosition < 0) return null
    gesture.endCharacterPosition = endPosition
    gesture.endPage = target.page
    hoverCharacterPositionRef.current = target.page === page ? endPosition : -1
    const end = {
      x: (event.clientX - sourceBounds.left) / Math.max(1, sourceBounds.width),
      y: (event.clientY - sourceBounds.top) / Math.max(1, sourceBounds.height),
    }
    if (target.page === page) {
      if (!immediate) {
        scheduleSelectedText(gesture.startCharacterPosition, endPosition, end)
        return selectedText
      }
      return updateSelectedText(gesture.startCharacterPosition, endPosition, end)
    }
    const movingRight = target.bounds.left > sourceBounds.left
    return updateSelectedTextPages([
      {
        bounds: sourceBounds,
        page,
        text: pdfSelectionText(selectableCharacters, gesture.startCharacterPosition, movingRight ? selectableCharacters.length - 1 : 0),
        rects: mergeSelectionRects(annotationSelectionFlowRects(
          selectableCharacters,
          gesture.startCharacterPosition,
          movingRight ? selectableCharacters.length - 1 : 0,
        )),
      },
      {
        bounds: target.bounds,
        page: target.page,
        text: pdfSelectionText(target.registration.characters, movingRight ? 0 : target.registration.characters.length - 1, endPosition),
        rects: mergeSelectionRects(annotationSelectionFlowRects(
          target.registration.characters,
          movingRight ? 0 : target.registration.characters.length - 1,
          endPosition,
        )),
      },
    ], end)
  }

  function scheduleSelectedText(startPosition: number, endPosition: number, end: PdfAnnotationPoint) {
    pendingSelectionRef.current = { end, endPosition, startPosition }
    if (selectionFrameRef.current != null) return
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      selectionFrameRef.current = null
      const pending = pendingSelectionRef.current
      pendingSelectionRef.current = null
      if (pending) updateSelectedText(pending.startPosition, pending.endPosition, pending.end)
    })
  }

  function clearSelectionPaint() {
    if (selectionFrameRef.current != null) window.cancelAnimationFrame(selectionFrameRef.current)
    selectionFrameRef.current = null
    pendingSelectionRef.current = null
  }

  const completeTextSelection = useEventCallback((gesture: Gesture, event: SelectionPointerPosition) => {
    const pending = pendingSelectionRef.current
    clearSelectionPaint()
    if (pending) updateSelectedText(pending.startPosition, pending.endPosition, pending.end)
    const selection = updateGestureSelection(gesture, event, true) ?? selectedTextRef.current
    if (selection) {
      hasSelectionRef.current = true
      selectionPageLayerRef.current = gesture.sourcePageLayer ?? null
      setSelectionComplete(true)
    } else if (gesture.sourcePageLayer) {
      gesture.sourcePageLayer.style.zIndex = ""
    }
  })

  useEffect(() => {
    const finishOutsidePage = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (gesture?.kind !== "select" || gesture.pointerId !== event.pointerId
        || (event.target instanceof Node && rootRef.current?.contains(event.target))) return
      gestureRef.current = null
      completeTextSelection(gesture, event)
    }
    window.addEventListener("pointerup", finishOutsidePage, true)
    return () => window.removeEventListener("pointerup", finishOutsidePage, true)
  }, [completeTextSelection])

  const moveFloatingPlus = useEventCallback((pointer: PdfAnnotationPoint) => {
    if (mode !== "default" || !selectionComplete || !selectedText) return
    const bounds = rootRef.current?.getBoundingClientRect()
    if (!bounds) return
    const candidate = annotationPlusPointNearestToPointer(selectedText.rects, pointer, bounds.width, bounds.height)
    const plus = selectionBubbleOutsideToolbar(candidate, bounds,
      selectionActionsRef.current?.getBoundingClientRect() ?? null, selectedText.toolbar.below,
      plusButtonRef.current?.getBoundingClientRect().width || 28)
    if (plusButtonRef.current) {
      plusButtonRef.current.style.left = `${plus.x * 100}%`
      plusButtonRef.current.style.top = `${plus.y * 100}%`
    }
  })

  useLayoutEffect(() => {
    if (selectedText && selectionComplete) moveFloatingPlus(selectedText.plus)
  }, [moveFloatingPlus, selectedText, selectionComplete])

  function scheduleDraftPaint(points: PdfAnnotationPoint[]) {
    if (draftFrameRef.current != null) return
    draftFrameRef.current = window.requestAnimationFrame(() => {
      draftFrameRef.current = null
      setDraftPoints([...points])
    })
  }

  function clearDraftPaint() {
    if (draftFrameRef.current != null) window.cancelAnimationFrame(draftFrameRef.current)
    draftFrameRef.current = null
    setDraftPoints([])
  }

  function clearShapeTimer() {
    if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
  }

  function clearCorrectedShape() {
    correctedShapeRef.current = null
    setCorrectedShape(null)
  }

  function scheduleShapeCorrection(gesture: Gesture) {
    clearShapeTimer()
    clearCorrectedShape()
    if (!settings.shapeCorrection || !gesture.moved || gesture.points.length < 4) return
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      const shape = correctHeldPdfShape(compactAnnotationPoints(gesture.points))
      correctedShapeRef.current = shape
      setCorrectedShape(shape)
    }, settings.shapeHoldMs)
  }

  function beginGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 2) {
      rightButtonEraseUsedRef.current = false
      rightButtonStartRef.current = { x: event.clientX, y: event.clientY }
      rightButtonHoldTimerRef.current = window.setTimeout(() => {
        rightButtonHoldTimerRef.current = null
        rightButtonEraseUsedRef.current = true
      }, RIGHT_CLICK_HOLD_MS)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.style.cursor = "none"
      setRightButtonErasing(true)
      return
    }
    if (event.button !== 0 || mode !== "default" || rightButtonErasing) return
    if ((event.target as HTMLElement).closest("[data-pdf-selection-actions='true']")) return
    const root = rootRef.current
    const clearedOtherSelection = root?.closest("[data-pdf-page-spread='true']")?.dispatchEvent(new CustomEvent(
      PDF_SELECTION_CLEAR_EVENT,
      { cancelable: true, detail: { source: root } },
    )) === false
    if (clearedOtherSelection) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const point = pointFromPointer(event)
    const startCharacterPosition = event.pointerType === "pen"
      ? -1
      : findSelectableCharacterPosition(point, hoverCharacterPositionRef.current)
    const bounds = rootRef.current?.getBoundingClientRect()
    if (
      selectionComplete
      && selectedText
      && annotationPointerWithinPlusRange(selectedText.rects, point, bounds?.width ?? 1, bounds?.height ?? 1)
    ) {
      beginConnector(event, startCharacterPosition < 0)
      return
    }
    if ((event.target as HTMLElement).closest("[data-pdf-annotation-control='true']")) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startPoints = [point]
    const sourcePageLayer = rootRef.current?.closest<HTMLElement>("[data-pdf-page-layer='true']") ?? undefined
    const pageLayerBounds = sourcePageLayer?.getBoundingClientRect()
    if (sourcePageLayer) sourcePageLayer.style.zIndex = "30"
    const gesture: Gesture = {
      kind: startCharacterPosition >= 0 ? "select" : "draw",
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      start: point,
      points: startPoints,
      moved: event.pointerType === "pen",
      dismissSelectionOnClick: Boolean(selectionComplete && selectedText && startCharacterPosition < 0),
      startCharacterPosition: startCharacterPosition >= 0 ? startCharacterPosition : undefined,
      endCharacterPosition: startCharacterPosition >= 0 ? startCharacterPosition : undefined,
      endPage: startCharacterPosition >= 0 ? page : undefined,
      pageSegments: startCharacterPosition < 0 ? [{ page, points: startPoints }] : undefined,
      activePageBounds: startCharacterPosition < 0 ? pageLayerBounds : undefined,
      previewPoints: startCharacterPosition < 0 ? [point] : undefined,
      sourcePageLayer,
    }
    gestureRef.current = gesture
    clearSelectionPaint()
    clearCorrectedShape()
    if (gesture.kind === "select") {
      // The drag suppresses native selection. Give its copy shortcut ownership
      // even when a chat input or a file list had focus before the drag.
      event.currentTarget.focus({ preventScroll: true })
      setSelectionComplete(false)
      updateSelectedText(startCharacterPosition, startCharacterPosition, point)
    } else {
      clearSelectedText()
      setDraftPoints([point])
    }
  }

  function moveGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (erasing) {
      moveEraserCursor(event)
      if (eraserDraggingRef.current) {
        const annotationId = annotationIdFromTarget(document.elementFromPoint(event.clientX, event.clientY) ?? event.target)
        if (annotationId) {
          event.preventDefault()
          event.stopPropagation()
          onDelete(annotationId)
        }
      }
      const start = rightButtonStartRef.current
      if (rightButtonErasing && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 3) {
        rightButtonEraseUsedRef.current = true
      }
    }
    if (connectorRef.current) {
      moveConnector(event)
      return
    }
    const gesture = gestureRef.current
    if (!gesture) {
      if (erasing) return
      const point = pointFromPointer(event)
      const overControl = Boolean((event.target as HTMLElement).closest("[data-pdf-annotation-control='true']"))
      const hoverPosition = overControl ? -1 : findSelectableCharacterPosition(point, hoverCharacterPositionRef.current)
      hoverCharacterPositionRef.current = hoverPosition
      if (rootRef.current) rootRef.current.style.cursor = hoverPosition >= 0 ? "text" : "default"
      if (!overControl) {
        moveFloatingPlus(point)
      }
      return
    }
    if (gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const point = pointFromPointer(event)
    const bounds = rootRef.current?.getBoundingClientRect()
    const movedPixels = bounds
      ? Math.hypot((point.x - gesture.start.x) * bounds.width, (point.y - gesture.start.y) * bounds.height)
      : 0
    gesture.moved = gesture.moved || movedPixels >= 5
    if (gesture.kind === "select") {
      const previous = gesture.points[gesture.points.length - 1]
      if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.0005) gesture.points.push(point)
      updateGestureSelection(gesture, event)
      return
    }
    const crossedPage = appendSpreadDrawPoint(gesture, event)
    if (!crossedPage) scheduleShapeCorrection(gesture)
  }

  function newAnnotation(
    kind: PdfAnnotation["kind"],
    points: PdfAnnotationPoint[] = [],
    rects: PdfAnnotationRect[] = [],
    text = "",
    annotationPage = page,
  ): PdfAnnotation {
    const annotationId = crypto.randomUUID()
    return {
      annotation_id: annotationId,
      page: annotationPage,
      kind,
      seed: roughSeed(annotationId),
      color: settings.color,
      stroke_width: settings.strokeWidth,
      font_size: settings.fontSize,
      text,
      points,
      rects,
    }
  }

  function finishGesture(event: ReactPointerEvent<HTMLDivElement>) {
    if (connectorRef.current) {
      finishConnector(event)
      return
    }
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    clearShapeTimer()
    const point = pointFromPointer(event)
    gestureRef.current = null

    if (gesture.kind === "select") {
      completeTextSelection(gesture, event)
      return
    }
    if (gesture.sourcePageLayer) gesture.sourcePageLayer.style.zIndex = ""

    if ((gesture.pageSegments?.length ?? 0) > 1) {
      for (const segment of gesture.pageSegments ?? []) {
        const points = compactAnnotationPoints(segment.points)
        if (points.length >= 2 && Math.hypot(points.at(-1)!.x - points[0].x, points.at(-1)!.y - points[0].y) >= 0.005) {
          onCommit(newAnnotation("stroke", points, [], "", segment.page))
        }
      }
    } else if (!gesture.moved && gesture.pointerType !== "pen") {
      if (!gesture.dismissSelectionOnClick) {
        const annotationId = crypto.randomUUID()
        setTextDraft({
          annotationId,
          color: settings.color,
          fontSize: settings.fontSize,
          text: "",
          pinned: true,
          x: Math.min(point.x, 0.92),
          y: Math.min(point.y, 0.96),
        })
      }
    } else {
      const compacted = compactAnnotationPoints([...gesture.points, point])
      const shape = correctedShapeRef.current
      if (shape?.kind === "line") onCommit(newAnnotation("line", shape.points))
      else if (shape?.kind === "ellipse") onCommit(newAnnotation("ellipse", [], [shape.rect]))
      else onCommit(newAnnotation("stroke", compacted))
    }
    clearDraftPaint()
    clearCorrectedShape()
  }

  function cancelGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const connector = connectorRef.current
    if (connector?.pointerId === event.pointerId) {
      connectorRef.current = null
      clearDraftPaint()
      return
    }
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    clearSelectionPaint()
    if (gesture.sourcePageLayer) gesture.sourcePageLayer.style.zIndex = ""
    clearShapeTimer()
    clearCorrectedShape()
    clearDraftPaint()
    if (gesture.kind === "select") setSelectionComplete(false)
  }

  function beginConnector(event: ReactPointerEvent<HTMLElement>, dismissSelectionOnClick = false) {
    if (!selectedText || event.button !== 0 || erasing) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const anchor = connectorPointFromPointer(event)
    const points = [anchor]
    connectorRef.current = { anchor, dismissSelectionOnClick, moved: false, pointerId: event.pointerId, points }
    setDraftPoints(points)
  }

  function moveConnector(event: ReactPointerEvent<HTMLElement>) {
    const connector = connectorRef.current
    if (!connector || connector.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const point = connectorPointFromPointer(event)
    const bounds = rootRef.current?.getBoundingClientRect()
    connector.moved = connector.moved || Boolean(bounds && Math.hypot(
      (point.x - connector.anchor.x) * bounds.width,
      (point.y - connector.anchor.y) * bounds.height,
    ) >= 5)
    const previous = connector.points[connector.points.length - 1]
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.001) connector.points.push(point)
    if (selectedText) {
      scheduleDraftPaint(annotationConnectorPointsFromGesture(
        selectedText.rects,
        connector.points,
        CONNECTOR_RING_PADDING_X,
        CONNECTOR_RING_PADDING_Y,
        connector.anchor,
        bounds?.width ?? 1,
        bounds?.height ?? 1,
        true,
      ))
    }
  }

  function finishConnector(event: ReactPointerEvent<HTMLElement>) {
    const connector = connectorRef.current
    if (!connector || connector.pointerId !== event.pointerId || !selectedText) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const end = connectorPointFromPointer(event)
    const bounds = rootRef.current?.getBoundingClientRect()
    const moved = connector.moved || Boolean(bounds && Math.hypot(
      (end.x - connector.anchor.x) * bounds.width,
      (end.y - connector.anchor.y) * bounds.height,
    ) >= 5)
    const points = annotationConnectorPointsFromGesture(
      selectedText.rects,
      compactAnnotationPoints([...connector.points, end], 0.0015, false),
      CONNECTOR_RING_PADDING_X,
      CONNECTOR_RING_PADDING_Y,
      connector.anchor,
      bounds?.width ?? 1,
      bounds?.height ?? 1,
      true,
    )
    connectorRef.current = null
    clearDraftPaint()
    if (moved && points.length >= 2 && Math.hypot(points.at(-1)!.x - points[0].x, points.at(-1)!.y - points[0].y) >= 0.015) {
      onCommit(newAnnotation("connector", points, selectedText.rects))
      clearSelectedText()
    } else if (connector.dismissSelectionOnClick) {
      clearSelectedText()
    }
  }

  function commitSelectedTextMark(kind: "highlight" | "underline") {
    if (!selectedText) return
    for (const selectedPage of selectedText.pageRects) {
      onCommit(newAnnotation(kind, [], selectedPage.rects, "", selectedPage.page))
    }
    clearSelectedText()
  }

  function commitTextDraft() {
    if (!textDraft) return
    const text = textDraft.text.trim()
    if (text) {
      const existing = annotations.find((annotation) => annotation.annotation_id === textDraft.annotationId)
      onCommit({
        ...(existing ?? newAnnotation("text")),
        annotation_id: textDraft.annotationId,
        kind: "text",
        color: textDraft.color,
        font_size: textDraft.fontSize,
        text,
        pinned: textDraft.pinned,
        points: [{ x: textDraft.x, y: textDraft.y }],
        rects: [],
      })
    }
    setTextDraft(null)
  }

  function editText(annotation: PdfAnnotation) {
    const point = annotation.points[0]
    if (!point || mode !== "default") return
    setTextDraft({
      annotationId: annotation.annotation_id,
      color: annotation.color,
      fontSize: annotation.font_size,
      text: annotation.text,
      pinned: annotation.pinned !== false,
      x: point.x,
      y: point.y,
    })
  }

  const visibleAnnotations = annotations.filter((annotation) => annotation.page === page)
  const hasOverflowConnector = visibleAnnotations.some((annotation) => annotation.kind === "connector" && (
    annotation.points.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)
    || annotation.rects.some((rect) => rect.x < 0 || rect.x + rect.width > 1 || rect.y < 0 || rect.y + rect.height > 1)
  ))
  const draftMarkerId = `pdf-annotation-arrow-draft-${page}`

  useEffect(() => {
    overflowConnectorRef.current = hasOverflowConnector
    const pageLayer = rootRef.current?.closest<HTMLElement>("[data-pdf-page-layer='true']")
    if (!pageLayer || selectionPageLayerRef.current === pageLayer) return
    pageLayer.style.zIndex = hasOverflowConnector ? "20" : ""
    return () => {
      if (selectionPageLayerRef.current !== pageLayer) pageLayer.style.zIndex = ""
    }
  }, [hasOverflowConnector])

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 select-none overflow-visible outline-none",
        !erasing && "cursor-default",
        erasing && "cursor-none",
      )}
      data-pdf-annotation-layer="true"
      tabIndex={-1}
      onContextMenu={(event) => {
        if (!rightButtonEraseUsedRef.current) return
        event.preventDefault()
        event.stopPropagation()
        rightButtonEraseUsedRef.current = false
      }}
      onMouseDownCapture={eraseWithMouse}
      onPointerCancel={cancelGesture}
      onPointerDown={beginGesture}
      onPointerDownCapture={eraseWithPointer}
      onPointerLeave={() => {
        if (eraserCursorRef.current) eraserCursorRef.current.style.opacity = "0"
        if (!gestureRef.current && rootRef.current) rootRef.current.style.cursor = erasing ? "none" : "default"
      }}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      ref={rootRef}
      style={{ touchAction: "none" }}
    >
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 1 1">
        <defs>
          <marker id={draftMarkerId} markerHeight="6" markerUnits="strokeWidth" markerWidth="6" orient="auto" refX="5.2" refY="3" viewBox="0 0 6 6">
            <path d={annotationHandwrittenArrowHeadPath(roughSeed(`draft-${page}`))} fill="none" stroke={settings.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.05" />
          </marker>
          {visibleAnnotations.filter((annotation) => annotation.kind === "connector").map((annotation) => (
            <marker id={annotationMarkerId(annotation.annotation_id)} key={annotation.annotation_id} markerHeight="6" markerUnits="strokeWidth" markerWidth="6" orient="auto" refX="5.2" refY="3" viewBox="0 0 6 6">
              <path d={annotationHandwrittenArrowHeadPath(annotation.seed ?? roughSeed(annotation.annotation_id))} fill="none" stroke={annotation.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.05" />
            </marker>
          ))}
        </defs>

        {visibleAnnotations.map((annotation) => {
          const seed = annotation.seed ?? roughSeed(annotation.annotation_id)
          if (annotation.kind === "text") return null
          if (annotation.kind === "highlight") {
            return (
              <g data-pdf-annotation-id={annotation.annotation_id} key={annotation.annotation_id}>
                {annotation.rects.map((rect, index) => (
                  <g key={`${annotation.annotation_id}-highlight-${index}`}>
                    {erasing && <path d={annotationHandwrittenHighlightPath(rect, seed + index * 101)} fill="transparent" pointerEvents="all" stroke="transparent" strokeWidth={ERASER_DIAMETER} vectorEffect="non-scaling-stroke" />}
                    <path d={annotationHandwrittenHighlightPath(rect, seed + index * 101)} fill={annotation.color} fillOpacity={0.24} pointerEvents="none" stroke="none" />
                  </g>
                ))}
              </g>
            )
          }
          if (annotation.kind === "underline") {
            return (
              <g data-pdf-annotation-id={annotation.annotation_id} key={annotation.annotation_id}>
                {annotation.rects.map((rect, index) => (
                  <g key={`${annotation.annotation_id}-underline-${index}`}>
                    {erasing && <path d={annotationHandwrittenUnderlinePath(rect, seed + index * 101)} fill="none" pointerEvents="stroke" stroke="transparent" strokeWidth={ERASER_DIAMETER} vectorEffect="non-scaling-stroke" />}
                    <path d={annotationHandwrittenUnderlinePath(rect, seed + index * 101)} fill="none" pointerEvents="none" stroke={annotation.color} strokeLinecap="round" strokeWidth={Math.max(1.2, annotation.stroke_width * (0.68 + index % 3 * 0.04))} vectorEffect="non-scaling-stroke" />
                  </g>
                ))}
              </g>
            )
          }
          if (annotation.kind === "ellipse") {
            const rect = annotation.rects[0]
            if (!rect) return null
            return (
              <g data-pdf-annotation-id={annotation.annotation_id} key={annotation.annotation_id}>
                {erasing && <ellipse cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} fill="none" pointerEvents="stroke" rx={rect.width / 2} ry={rect.height / 2} stroke="transparent" strokeWidth={ERASER_DIAMETER} vectorEffect="non-scaling-stroke" />}
                <HandwrittenEllipse color={annotation.color} rect={rect} seed={seed} strokeWidth={annotation.stroke_width} />
              </g>
            )
          }
          const path = annotationPath(annotation, seed)
          return (
            <g data-pdf-annotation-id={annotation.annotation_id} key={annotation.annotation_id}>
              {annotation.kind === "connector" && annotation.rects.map((rect, index) => (
                <g key={`${annotation.annotation_id}-ring-${index}`}>
                  {erasing && <ellipse cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} fill="none" pointerEvents="stroke" rx={rect.width / 2 + CONNECTOR_RING_PADDING_X} ry={rect.height / 2 + CONNECTOR_RING_PADDING_Y} stroke="transparent" strokeWidth={ERASER_DIAMETER} vectorEffect="non-scaling-stroke" />}
                  <RoughEllipse color={annotation.color} paddingX={CONNECTOR_RING_PADDING_X} paddingY={CONNECTOR_RING_PADDING_Y} rect={rect} seed={seed + index * 101} strokeWidth={Math.min(2.5, annotation.stroke_width)} />
                </g>
              ))}
              {erasing && <path d={path} fill="none" pointerEvents="stroke" stroke="transparent" strokeWidth={ERASER_DIAMETER} vectorEffect="non-scaling-stroke" />}
              <path
                d={path}
                fill="none"
                markerEnd={annotation.kind === "connector" ? `url(#${annotationMarkerId(annotation.annotation_id)})` : undefined}
                pointerEvents="none"
                stroke={annotation.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={annotation.stroke_width}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}

        {selectedText?.rects.map((rect, index) => (
          <rect fill={settings.color} fillOpacity={0.18} height={rect.height} key={`selected-${index}`} pointerEvents="none" rx={0.003} stroke="none" width={rect.width} x={rect.x} y={rect.y} />
        ))}
        {draftPoints.length > 0 && (
          <path
            d={selectedText ? annotationConnectorPointsToPath(draftPoints) : annotationPointsToPath(draftPoints)}
            fill="none"
            markerEnd={selectedText && draftPoints.length > 0 ? `url(#${draftMarkerId})` : undefined}
            opacity={correctedShape ? 0.28 : 0.9}
            pointerEvents="none"
            stroke={settings.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={settings.strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {correctedShape?.kind === "line" && <path d={annotationHandwrittenLinePath(correctedShape.points, roughSeed(`preview-${page}`))} fill="none" stroke={settings.color} strokeLinecap="round" strokeWidth={settings.strokeWidth} vectorEffect="non-scaling-stroke" />}
        {correctedShape?.kind === "ellipse" && <HandwrittenEllipse color={settings.color} rect={correctedShape.rect} seed={roughSeed(`preview-${page}`)} strokeWidth={settings.strokeWidth} />}
      </svg>

      {visibleAnnotations.filter((annotation) => annotation.kind === "text").map((annotation) => {
        const point = annotation.points[0]
        if (!point || annotation.annotation_id === textDraft?.annotationId) return null
        return <PdfAnnotationNote key={annotation.annotation_id} pageRef={rootRef} erasing={erasing}
          value={{ annotationId: annotation.annotation_id, color: annotation.color, fontSize: annotation.font_size, text: annotation.text, x: point.x, y: point.y, pinned: annotation.pinned !== false }}
          onEdit={() => editText(annotation)} onPin={(pinned) => onCommit({ ...annotation, pinned })}
          onMove={(position) => onCommit({ ...annotation, points: [position] })}
          onRightErase={() => { rightButtonEraseUsedRef.current = false; setRightButtonErasing(true) }} />
      })}

      {erasing && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-50 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--foreground)]/65 bg-[var(--panel)]/75 text-[var(--foreground)] opacity-0 shadow-sm backdrop-blur-sm"
          data-pdf-eraser-cursor="true"
          ref={eraserCursorRef}
        >
          <Eraser size={14} strokeWidth={2.2} />
        </div>
      )}

      {textDraft && (
        <PdfAnnotationNote value={textDraft} editing erasing={erasing} pageRef={rootRef} inputRef={textInputRef}
          onCommit={commitTextDraft} onCancel={() => setTextDraft(null)}
          onChange={(text) => setTextDraft((current) => current ? { ...current, text } : null)}
          onPin={(pinned) => setTextDraft((current) => current ? { ...current, pinned } : null)}
          onMove={(position) => setTextDraft((current) => current ? { ...current, ...position } : null)}
          onRightErase={() => { rightButtonEraseUsedRef.current = false; setRightButtonErasing(true) }} />
      )}

      {selectedText && selectionComplete && (
        <>
          <div
            className="absolute z-20 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]/96 p-1 text-[10px] font-semibold text-[var(--foreground)] shadow-lg backdrop-blur-sm"
            data-pdf-annotation-control="true"
            data-pdf-selection-actions="true"
            ref={selectionActionsRef}
            style={{
              left: `${selectedText.toolbar.x * 100}%`,
              top: `${selectedText.toolbar.y * 100}%`,
              transform: selectedText.toolbar.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            }}
          >
            <button className="rounded-md px-2 py-1 hover:bg-[var(--muted)]" onClick={() => commitSelectedTextMark("highlight")} type="button">{t("하이라이트")}</button>
            <button className="rounded-md px-2 py-1 hover:bg-[var(--muted)]" onClick={() => commitSelectedTextMark("underline")} type="button">{t("밑줄")}</button>
          </div>
          <button
            aria-label={t("선택한 글씨에서 설명 화살표 그리기")}
            className="absolute z-20 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[var(--brand)] text-base font-bold leading-none text-white shadow-lg active:scale-95"
            data-pdf-annotation-control="true"
            onPointerCancel={() => {
              connectorRef.current = null
              clearDraftPaint()
            }}
            onPointerDown={beginConnector}
            onPointerMove={moveConnector}
            onPointerUp={finishConnector}
            ref={plusButtonRef}
            style={{
              left: `${selectedText.plus.x * 100}%`,
              top: `${selectedText.plus.y * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
            title={t("누른 채 끌어서 화살표 그리기")}
            type="button"
          >
            +
          </button>
        </>
      )}

    </div>
  )
})
