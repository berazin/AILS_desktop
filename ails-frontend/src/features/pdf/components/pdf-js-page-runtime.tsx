import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { apiHeaders, apiResourceUrl, getPdfPageVersion } from '../../../lib/api'
import { t } from '../../../lib/i18n.ts'
import type { PdfJsRenderManager, PdfJsRender, PdfJsView } from "../lib/pdf-js-render-manager.ts"
import { pdfJsSessions } from "../lib/pdf-js-session-cache.ts"
import { createPdfJsSession } from '../lib/pdf-js-session.ts'
import { pdfSpreadZoomShiftX } from "../lib/pdf-image-view-layout.ts"
import { observePdfPageGeometry, type PdfPageGeometry } from "../lib/pdf-page-geometry.ts"
import { pdfPageFitScale } from "../lib/pdf-page-fit.ts"
import './pdf-js-page.css'
import { PdfEvidenceHighlight } from './pdf-evidence-highlight.tsx'
import { observeDocumentPresentation } from '../../../lib/document-presentation-diagnostics.ts'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Props = {
  pdfPath: string
  pageCount: number
  pageNumber: number
  pageNumbers?: readonly (number | null)[]
  className?: string
  style?: CSSProperties
  invertColors?: boolean
  matchThemeColors?: boolean
  themeBrightness?: number
  themeContrast?: number
  renderScale?: number
  visualScale?: number
  rotation?: number
  onPageRendered?: (info: { width: number; height: number; pageCount: number }) => void
  onNavigate?: (direction: -1 | 1) => void
  overlay?: ReactNode | ((pageNumber: number) => ReactNode)
  pageLayerRef?: RefObject<HTMLDivElement | null>
  onPageClick?: (event: ReactMouseEvent<HTMLDivElement>) => void
  capturePagePointer?: boolean
  onPagePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPagePointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPagePointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPagePointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void
}

type OpenDocument = { document: PDFDocumentProxy; manager: PdfJsRenderManager }

export function PdfJsPage({
  pdfPath, pageCount, pageNumber, pageNumbers, className = '', style,
  invertColors = false, matchThemeColors = false, themeBrightness = 0.8,
  themeContrast = 1, renderScale = 1, visualScale = 1, rotation = 0,
  onPageRendered, onNavigate, overlay, pageLayerRef,
  onPageClick, capturePagePointer = false, onPagePointerDown, onPagePointerMove, onPagePointerUp, onPagePointerCancel,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerId = useId()
  const textHostsRef = useRef(new Map<number, HTMLDivElement>())
  const [geometry, setGeometry] = useState<PdfPageGeometry | null>(null)
  const [opened, setOpened] = useState<OpenDocument | null>(null)
  const [versionState, setVersionState] = useState({ path: '', version: '' })
  const fileVersion = versionState.path === pdfPath ? versionState.version : ''
  const sessionKey = `${viewerId}|${pdfPath}|${fileVersion}`
  const [versionError, setVersionError] = useState({ path: '', message: '' })
  const [retry, setRetry] = useState(0)
  const [displayed, setDisplayed] = useState<Array<number | null>>([])
  const [renders, setRenders] = useState<Record<number, PdfJsRender>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const viewRequestRef = useRef(0)
  const displayStartRef = useRef(0)
  const openStartRef = useRef(0)
  const firstPageRecordedRef = useRef(false)
  const previousScaleRef = useRef(visualScale)
  const zoomRequestRef = useRef(false)
  const onPageRenderedRef = useRef(onPageRendered)
  useLayoutEffect(() => { onPageRenderedRef.current = onPageRendered }, [onPageRendered])

  const requested = useMemo(() => {
    const max = Math.max(1, pageCount || 1)
    return (pageNumbers?.length ? pageNumbers : [pageNumber]).map((page) => page == null ? null : Math.max(1, Math.min(max, Math.floor(page))))
  }, [pageCount, pageNumber, pageNumbers])
  const requestedKey = requested.join(',')

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    return observePdfPageGeometry(element, setGeometry)
  }, [])

  useEffect(() => {
    if (!pdfPath) return
    let disposed = false
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const { version } = await getPdfPageVersion(pdfPath)
        if (!disposed) {
          setVersionState((current) => current.path === pdfPath && current.version === version ? current : { path: pdfPath, version })
          setVersionError({ path: pdfPath, message: '' })
        }
      } catch (caught) {
        if (!disposed) setVersionError({ path: pdfPath, message: caught instanceof Error ? caught.message : String(caught) })
      } finally { checking = false }
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 5000)
    window.addEventListener('focus', check)
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', check) }
  }, [pdfPath, retry])

  useLayoutEffect(() => {
    if (!pdfPath || !fileVersion) {
      setOpened(null); setDisplayed([]); setRenders({}); setLoading(true); setError('')
      return
    }
    let disposed = false
    const started = performance.now()
    openStartRef.current = started
    setError('')
    const lease = pdfJsSessions.acquire(sessionKey, () => {
      const url = apiResourceUrl(`/files?path=${encodeURIComponent(pdfPath)}&version=${encodeURIComponent(fileVersion)}`)
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      const budget = deviceMemory != null && deviceMemory <= 2 ? 64 : deviceMemory != null && deviceMemory <= 4 ? 128 : 256
      return createPdfJsSession(url, apiHeaders(), `${pdfPath}|${fileVersion}`, budget * 1024 * 1024)
    })
    if (lease.current) setOpened(lease.current)
    else {
      setLoading(true); setOpened(null); setDisplayed([]); setRenders({})
      firstPageRecordedRef.current = false
    }
    void lease.promise.then((session) => {
      if (disposed) return
      ;(window as unknown as { __AILS_PDFJS_OPEN_MS?: number }).__AILS_PDFJS_OPEN_MS = performance.now() - started
      setOpened(session)
    }).catch((caught) => { if (!disposed) { setLoading(false); setError(caught instanceof Error ? caught.message : String(caught)) } })
    return () => { disposed = true; lease.release() }
  }, [fileVersion, pdfPath, sessionKey, retry])

  useLayoutEffect(() => {
    if (!opened || !geometry?.width || !geometry.height) return
    const visible = requested.filter((page): page is number => page != null && page <= opened.document.numPages)
    if (!visible.length) return
    const current = visible.includes(pageNumber) ? pageNumber : visible[0]
    const view: PdfJsView = {
      slotWidth: geometry.width / requested.length,
      slotHeight: geometry.height,
      zoom: visualScale,
      rotation,
      dpr: geometry.dpr * renderScale,
    }
    const requestId = ++viewRequestRef.current
    zoomRequestRef.current = previousScaleRef.current !== visualScale
    previousScaleRef.current = visualScale
    displayStartRef.current = performance.now()
    setLoading(true)
    setError('')
    const commit = () => {
      if (requestId !== viewRequestRef.current) return
      const ready = visible.map((page) => opened.manager.getCached(page, view))
      if (ready.some((entry) => !entry)) return
      const next: Record<number, PdfJsRender> = {}
      visible.forEach((page, index) => { next[page] = ready[index]! })
      setRenders((current) => Object.keys(current).length === visible.length && visible.every((page) => current[page] === next[page]) ? current : next)
      setDisplayed((current) => current.length === requested.length && current.every((page, index) => page === requested[index]) ? current : Array.from(requested))
      setLoading(false)
      const anchor = next[current]
      onPageRenderedRef.current?.({ width: anchor.baseWidth, height: anchor.baseHeight, pageCount: opened.document.numPages })
    }
    opened.manager.setView(
      { current, visible, pageCount: opened.document.numPages, view },
      (readyPage) => {
        if (requestId !== viewRequestRef.current) return
        ;(window as unknown as { __AILS_PDFJS_STATS?: ReturnType<PdfJsRenderManager['stats']> }).__AILS_PDFJS_STATS = opened.manager.stats()
        if (visible.includes(readyPage)) commit()
      },
      (caught) => { if (requestId === viewRequestRef.current) { setLoading(false); setError(caught.message) } },
    )
    commit()
    return () => { viewRequestRef.current += 1 }
  }, [opened, geometry, pageNumber, requested, requestedKey, renderScale, rotation, visualScale])

  useLayoutEffect(() => {
    opened?.manager.setDisplayedRenders(Object.values(renders))
  }, [opened, renders])

  useLayoutEffect(() => {
    if (!displayed.length) return
    const first = !firstPageRecordedRef.current
    const started = first ? openStartRef.current : displayStartRef.current
    const zoom = zoomRequestRef.current
    const requestId = viewRequestRef.current
    const pages = displayed.join(',')
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
      if (requestId !== viewRequestRef.current) return
      const latency = performance.now() - started
      const debug = window as unknown as { __AILS_PDFJS_PERF_EVENTS?: Array<Record<string, string | number>> }
      const events = debug.__AILS_PDFJS_PERF_EVENTS ??= []
      events.push({ phase: first ? 'first-page' : zoom ? 'zoom' : 'page-switch', pages, latencyMs: latency })
      if (events.length > 100) events.shift()
      firstPageRecordedRef.current = true
    }) })
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [displayed, renders])

  useEffect(() => {
    if (displayed.length) return observeDocumentPresentation('pdf', () => containerRef.current?.querySelector('canvas')?.closest('[data-pdf-page-number]'))
  }, [displayed, renders])

  useEffect(() => {
    if (!opened || !displayed.length) return
    let disposed = false
    const layers: TextLayer[] = []
    for (const pageNumber of displayed) {
      if (pageNumber == null) continue
      const entry = renders[pageNumber]
      const host = textHostsRef.current.get(pageNumber)
      if (!entry || !host) continue
      const layerKey = JSON.stringify([pdfPath, fileVersion, pageNumber, entry.width, entry.height, entry.scale, rotation])
      if (host.dataset.pdfTextLayerKey === layerKey) continue
      delete host.dataset.pdfTextLayerKey
      host.replaceChildren()
      void opened.document.getPage(pageNumber).then((page) => {
        if (disposed) return
        const viewport = page.getViewport({ scale: entry.scale, rotation })
        host.style.setProperty('--scale-factor', String(entry.scale))
        host.style.setProperty('--total-scale-factor', String(entry.scale))
        const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: host, viewport })
        layers.push(layer)
        return layer.render().then(() => { if (!disposed) host.dataset.pdfTextLayerKey = layerKey })
      }).catch(() => {})
    }
    return () => { disposed = true; layers.forEach((layer) => layer.cancel()) }
  }, [displayed, opened, renders, rotation, pdfPath, fileVersion])

  const themeFilter = `invert(1) hue-rotate(180deg) contrast(${themeContrast}) brightness(${themeBrightness})`
  const displayError = error || (!fileVersion && versionError.path === pdfPath ? versionError.message : '')
  const retryPage = () => {
    viewRequestRef.current += 1
    pdfJsSessions.invalidate(sessionKey)
    setOpened(null); setDisplayed([]); setRenders({}); setLoading(true); setError('')
    setVersionError({ path: pdfPath, message: '' })
    setRetry((current) => current + 1)
  }
  return (
    <div data-pdf-scroll-viewport ref={containerRef} style={style} className={`relative flex items-center justify-center overflow-hidden bg-[var(--panel)] ${className}`}>
      <div className="flex h-full w-full items-center justify-center" data-pdf-page-spread="true">
        {displayed.map((page, index) => {
          const entry = page == null ? undefined : renders[page]
          const shiftX = displayed.length > 1 ? pdfSpreadZoomShiftX(geometry!.width / displayed.length, visualScale, index === 0 ? 'left' : 'right') : 0
          // Keep the displayed canvas fitted while a new-size/DPR render is pending.
          const displayScale = entry && geometry
            ? pdfPageFitScale(entry.baseWidth, entry.baseHeight, geometry.width / displayed.length, geometry.height, visualScale) / entry.scale
            : 1
          const transform = [shiftX ? `translateX(${shiftX}px)` : '', Math.abs(displayScale - 1) > 0.00001 ? `scale(${displayScale})` : ''].filter(Boolean).join(' ') || undefined
          return <div data-pdf-scroll-viewport className="flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden" key={`slot-${index}`}>
            {page != null && entry && <div
              className={`relative isolate shrink-0 ${matchThemeColors && invertColors ? 'bg-[var(--panel)]' : 'bg-white'}`}
              data-pdf-page-layer="true"
              data-pdf-page-number={page}
              data-pdf-source-path={pdfPath}
              ref={(element) => { if (pageLayerRef) pageLayerRef.current = element }}
              onClick={onPageClick}
              onPointerDownCapture={capturePagePointer ? onPagePointerDown : undefined}
              onPointerDown={!capturePagePointer ? onPagePointerDown : undefined}
              onPointerMoveCapture={capturePagePointer ? onPagePointerMove : undefined}
              onPointerMove={!capturePagePointer ? onPagePointerMove : undefined}
              onPointerUpCapture={capturePagePointer ? onPagePointerUp : undefined}
              onPointerUp={!capturePagePointer ? onPagePointerUp : undefined}
              onPointerCancel={onPagePointerCancel}
              style={{ width: entry.cssWidth, height: entry.cssHeight, transform }}
              onContextMenu={(event) => {
                if (!onNavigate) return
                event.preventDefault(); event.stopPropagation()
                if ((event.target as HTMLElement).closest("[data-pdf-annotation-control='true']")) return
                if (displayed.length > 1) { onNavigate(index === 0 ? -1 : 1); return }
                const bounds = event.currentTarget.getBoundingClientRect()
                onNavigate(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1)
              }}
            >
              <div className="absolute inset-0" style={matchThemeColors && invertColors ? { filter: themeFilter, mixBlendMode: 'screen' } : undefined}
                ref={(host) => { if (host && entry.canvas.parentElement !== host) host.replaceChildren(entry.canvas) }} />
              <div className="ails-pdfjs-text-layer" style={onPageClick || capturePagePointer ? { pointerEvents: 'none' } : undefined} ref={(host) => { if (host) textHostsRef.current.set(page, host); else textHostsRef.current.delete(page) }} />
              {typeof overlay === 'function' ? overlay(page) : overlay}
              {opened && <PdfEvidenceHighlight key={fileVersion} document={opened.document} path={pdfPath} page={page} rotation={entry.rotation} />}
            </div>}
          </div>
        })}
      </div>
      {loading && !displayed.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--panel)] text-xs text-[var(--muted-foreground)]">{t('PDF 페이지 불러오는 중...')}</div>}
      {loading && displayed.length > 0 && <div role="status" data-pdf-page-transition-loading="true" className="pointer-events-none absolute right-3 top-3 rounded bg-[var(--panel)]/90 px-3 py-2 text-xs text-[var(--muted-foreground)]">{t('PDF 페이지 전환 중...')}</div>}
      {displayError && <div role="alert" data-pdf-page-error="true" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--panel)] p-4 text-center text-sm text-red-600">
        <div>{t('PDF 페이지를 표시하지 못했습니다: ')}{displayError}</div>
        <button type="button" className="rounded border border-current px-3 py-2" onClick={(event) => { event.stopPropagation(); retryPage() }}>{t('다시 시도')}</button>
      </div>}
    </div>
  )
}
