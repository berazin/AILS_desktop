import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { pdfPageFitScale } from './pdf-page-fit.ts'

export type PdfJsView = {
  slotWidth: number
  slotHeight: number
  zoom: number
  rotation: number
  dpr: number
}

export type PdfJsRender = {
  rotation: number
  page: number
  canvas: HTMLCanvasElement
  width: number
  height: number
  cssWidth: number
  cssHeight: number
  baseWidth: number
  baseHeight: number
  scale: number
  bytes: number
  predictive: boolean
  renderMs: number
}

type Request = { page: number; priority: number; generation: number; view: PdfJsView; predictive: boolean }
type ViewRequest = { current: number; visible: readonly number[]; pageCount: number; view: PdfJsView }
type PageShape = { width: number; height: number }

/** One PDF.js render lane and one decoded-canvas budget per viewer. */
export class PdfJsRenderManager {
  private cache = new Map<string, PdfJsRender>()
  private shapes = new Map<string, PageShape>()
  private queue: Request[] = []
  private predictive: number[] = []
  private active: { request: Request; task: RenderTask | null } | null = null
  private generation = 0
  private signature = ''
  private running = false
  private disposed = false
  private usedBytes = 0
  private inFlightBytes = 0
  private current = 1
  private visible = new Set<number>()
  private displayed = new Set<PdfJsRender>()
  private notify: (page: number, render: PdfJsRender) => void = () => {}
  private notifyError: (error: Error) => void = () => {}
  private counters = { hits: 0, misses: 0, predictiveHits: 0, cancellations: 0, evictions: 0, renders: 0, lastRenderMs: 0, totalRenderMs: 0 }
  private document: PDFDocumentProxy
  private documentId: string
  private budgetBytes: number
  private fetchError: Error | null = null

  constructor(document: PDFDocumentProxy, documentId: string, budgetBytes: number, fetchFailure?: Promise<never>) {
    this.document = document
    this.documentId = documentId
    this.budgetBytes = budgetBytes
    void fetchFailure?.catch((error: Error) => { this.fetchError = error; this.active?.task?.cancel() })
  }

  private shapeKey(page: number, rotation: number) { return `${page}|${rotation}` }

  private dimensions(shape: PageShape, view: PdfJsView) {
    const scale = pdfPageFitScale(shape.width, shape.height, view.slotWidth, view.slotHeight, view.zoom)
    // Reserve half the budget for the previously displayed frame during replacement.
    const pixels = Math.max(1, Math.floor(this.budgetBytes / (8 * Math.max(1, this.visible.size))))
    const requestedWidth = Math.max(1, Math.ceil(shape.width * scale * view.dpr))
    const requestedHeight = Math.max(1, Math.ceil(shape.height * scale * view.dpr))
    const ratio = Math.min(1, Math.sqrt(pixels / (requestedWidth * requestedHeight)))
    const width = Math.max(1, Math.floor(requestedWidth * ratio))
    const height = Math.max(1, Math.min(Math.floor(requestedHeight * ratio), Math.floor(pixels / width)))
    return { scale, width, height, rasterScale: Math.min(width / shape.width, height / shape.height) }
  }

  private key(page: number, view: PdfJsView, shape: PageShape) {
    const { width, height } = this.dimensions(shape, view)
    return JSON.stringify([this.documentId, page - 1, view.zoom, view.rotation, view.dpr, width, height])
  }

  getCached(page: number, view: PdfJsView): PdfJsRender | undefined {
    const shape = this.shapes.get(this.shapeKey(page, view.rotation))
    if (!shape) return undefined
    const key = this.key(page, view, shape)
    const entry = this.cache.get(key)
    if (entry) { this.cache.delete(key); this.cache.set(key, entry) }
    return entry
  }

  stats() {
    return { ...this.counters, averageRenderMs: this.counters.renders ? this.counters.totalRenderMs / this.counters.renders : 0, usedBytes: this.usedBytes, inFlightBytes: this.inFlightBytes, totalBytes: this.usedBytes + this.inFlightBytes, budgetBytes: this.budgetBytes, entries: this.cache.size, queued: this.queue.length, rendering: this.active ? 1 : 0 }
  }

  setDisplayedRenders(renders: readonly PdfJsRender[]) {
    this.displayed = new Set(renders)
    // Release obsolete resolutions only after React has attached their replacements.
    for (const [key, entry] of this.cache) {
      if (renders.some((render) => render.page === entry.page) && !this.displayed.has(entry) && !this.isRequested(key, entry)) this.remove(key, entry)
    }
    this.evict()
  }

  private isRequested(key: string, entry: PdfJsRender) {
    const shape = this.shapes.get(this.shapeKey(entry.page, this.currentView?.rotation ?? 0))
    return this.visible.has(entry.page) && !!this.currentView && !!shape && key === this.key(entry.page, this.currentView, shape)
  }

  private remove(key: string, entry: PdfJsRender) {
    this.cache.delete(key)
    this.usedBytes -= entry.bytes
    entry.canvas.width = 0
    entry.canvas.height = 0
    this.counters.evictions += 1
  }

  setView(input: ViewRequest, onReady: (page: number, render: PdfJsRender) => void, onError: (error: Error) => void = () => {}) {
    if (this.disposed) return
    this.notify = onReady
    this.notifyError = onError
    const signature = JSON.stringify([input.current, input.visible, input.pageCount, input.view])
    if (signature === this.signature) return
    this.signature = signature
    const generation = ++this.generation
    this.current = input.current
    this.visible = new Set(input.visible)
    this.currentView = input.view
    this.queue = []
    this.predictive = []
    if (this.active) {
      this.active.task?.cancel()
      this.counters.cancellations += 1
    }
    const direction = input.current >= (this.previousPage ?? input.current) ? 1 : -1
    this.previousPage = input.current
    const planned = new Set<number>()
    const add = (page: number, priority: number, predictive = false) => {
      if (page < 1 || page > input.pageCount || planned.has(page)) return
      planned.add(page)
      const cached = this.getCached(page, input.view)
      if (cached) {
        if (this.visible.has(page)) {
          this.counters.hits += 1
          if (cached.predictive) this.counters.predictiveHits += 1
          onReady(page, cached)
        }
        return
      }
      if (this.visible.has(page)) this.counters.misses += 1
      if (predictive) this.predictive.push(page)
      else if (this.queue.length < 8) this.queue.push({ page, priority, generation, view: input.view, predictive: priority > 1 })
    }
    add(input.current, 0)
    input.visible.filter((page) => page !== input.current).forEach((page) => add(page, 1))
    const forward = direction === 1 ? Math.max(...input.visible) : Math.min(...input.visible)
    const backward = direction === 1 ? Math.min(...input.visible) : Math.max(...input.visible)
    add(forward + direction, 2)
    add(backward - direction, 2)
    add(forward + direction * 2, 3, true)
    add(forward + direction * 3, 3, true)
    this.queue.sort((a, b) => a.priority - b.priority)
    void this.pump()
  }

  private previousPage: number | null = null

  private evict(requiredBytes = 0) {
    while (this.usedBytes + this.inFlightBytes + requiredBytes > this.budgetBytes) {
      let victim: string | undefined
      for (const [key, entry] of this.cache) {
        if (!this.isRequested(key, entry) && !this.displayed.has(entry) && Math.abs(entry.page - this.current) > 1) { victim = key; break }
      }
      if (!victim) {
        for (const [key, entry] of this.cache) {
          if (!this.isRequested(key, entry) && !this.displayed.has(entry)) { victim = key; break }
        }
      }
      if (!victim) break
      const entry = this.cache.get(victim)!
      this.remove(victim, entry)
    }
  }

  private async pump() {
    if (this.running || this.disposed) return
    this.running = true
    try {
      while (!this.disposed) {
        const request = this.queue.shift() ?? (this.predictive.length
          ? { page: this.predictive.shift()!, priority: 3, generation: this.generation, view: this.currentView!, predictive: true }
          : undefined)
        if (!request) break
        if (request.generation !== this.generation) continue
        try {
          if (this.fetchError) throw this.fetchError
          await this.render(request)
        } catch (error) {
          if (request.generation === this.generation && this.visible.has(request.page) && (error as Error).name !== 'RenderingCancelledException') this.notifyError(error as Error)
        }
      }
    } finally {
      this.running = false
      if (!this.disposed && (this.queue.length || this.predictive.length)) void this.pump()
    }
  }

  private currentView: PdfJsView | null = null

  private async render(request: Request) {
    this.currentView = request.view
    const page = await this.document.getPage(request.page) as PDFPageProxy
    if (request.generation !== this.generation || this.disposed) return
    const base = page.getViewport({ scale: 1, rotation: request.view.rotation })
    const shape = { width: base.width, height: base.height }
    this.shapes.set(this.shapeKey(request.page, request.view.rotation), shape)
    const cached = this.getCached(request.page, request.view)
    if (cached) { if (this.visible.has(request.page)) this.notify(request.page, cached); return }
    const dims = this.dimensions(shape, request.view)
    const bytes = dims.width * dims.height * 4
    this.evict(bytes)
    if (this.usedBytes + this.inFlightBytes + bytes > this.budgetBytes) {
      if (this.visible.has(request.page)) throw new Error('PDF canvas memory budget exhausted')
      return // Prefetch must never displace a displayed frame or exceed the budget.
    }
    const viewport = page.getViewport({ scale: dims.rasterScale, rotation: request.view.rotation })
    const canvas = document.createElement('canvas')
    let retained = false
    this.inFlightBytes = bytes
    try {
      canvas.width = dims.width
      canvas.height = dims.height
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('PDF Canvas context unavailable')
      const started = performance.now()
      const task = page.render({ canvas, canvasContext: context, viewport, background: 'rgb(255,255,255)' })
      this.active = { request, task }
      try { await task.promise } catch (error) { throw this.fetchError ?? error } finally { if (this.active?.request === request) this.active = null }
      if (request.generation !== this.generation || this.disposed) { canvas.width = 0; return }
      const entry: PdfJsRender = {
        rotation: request.view.rotation,
        page: request.page, canvas, width: dims.width, height: dims.height,
        cssWidth: shape.width * dims.scale, cssHeight: shape.height * dims.scale,
        baseWidth: shape.width, baseHeight: shape.height, scale: dims.scale,
        bytes: dims.width * dims.height * 4, predictive: request.predictive,
        renderMs: performance.now() - started,
      }
      const key = this.key(request.page, request.view, shape)
      this.cache.set(key, entry)
      this.usedBytes += entry.bytes
      this.inFlightBytes = 0
      retained = true
      this.counters.renders += 1
      this.counters.lastRenderMs = entry.renderMs
      this.counters.totalRenderMs += entry.renderMs
      this.evict()
      this.notify(request.page, entry)
    } finally {
      this.inFlightBytes = 0
      if (!retained) { canvas.width = 0; canvas.height = 0 }
    }
  }

  suspend() {
    this.generation += 1
    this.signature = ''
    if (this.active?.task) { this.active.task.cancel(); this.counters.cancellations += 1 }
    this.active = null
    this.queue = []
    this.predictive = []
    this.notify = () => {}
    this.notifyError = () => {}
    for (const [key, entry] of this.cache) {
      if (this.displayed.has(entry)) continue
      this.cache.delete(key)
      this.usedBytes -= entry.bytes
      entry.canvas.width = 0
      entry.canvas.height = 0
    }
  }

  dispose() {
    this.disposed = true
    this.generation += 1
    if (this.active?.task) { this.active.task.cancel(); this.counters.cancellations += 1 }
    this.queue = []
    this.predictive = []
    for (const entry of this.cache.values()) { entry.canvas.width = 0; entry.canvas.height = 0 }
    this.cache.clear()
    this.displayed.clear()
    this.usedBytes = 0
  }
}
