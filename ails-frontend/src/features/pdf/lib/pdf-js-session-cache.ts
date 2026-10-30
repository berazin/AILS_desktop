import type { PDFDocumentProxy } from "pdfjs-dist"
import type { PdfJsRenderManager } from "./pdf-js-render-manager.ts"

export type PdfJsSession = { document: PDFDocumentProxy; manager: PdfJsRenderManager }
type Request = { promise: Promise<PdfJsSession>; dispose: () => void }
type Entry = { request: Request; promise: Promise<PdfJsSession>; current: PdfJsSession | null; users: number }

// Each viewer owns a render lane. Retain eight idle lanes and at most 64 MiB of
// their displayed canvases; inactive lanes do no background rendering.
export class PdfJsSessionCache {
  private entries = new Map<string, Entry>()
  private maxIdle: number

  constructor(maxIdle = 8) { this.maxIdle = maxIdle }

  acquire(key: string, create: () => Request) {
    let entry = this.entries.get(key)
    if (!entry) {
      const resource = create()
      let disposed = false
      const request = { promise: resource.promise, dispose: () => {
        if (disposed) return
        disposed = true
        resource.dispose()
      } }
      entry = { request, promise: request.promise, current: null, users: 0 }
      const created = entry
      created.promise = request.promise.then((session) => {
        created.current = session
        if (this.entries.get(key) !== created) request.dispose()
        else if (!created.users) { session.manager.suspend(); this.trim() }
        return session
      }, (error) => {
        if (this.entries.get(key) === created) this.entries.delete(key)
        request.dispose()
        throw error
      })
      this.entries.set(key, created)
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    entry.users += 1
    const leased = entry
    let released = false
    return {
      current: entry.current,
      promise: entry.promise,
      release: () => {
        if (released) return
        released = true
        leased.users -= 1
        if (!leased.users && this.entries.get(key) === leased) leased.current?.manager.suspend()
        this.trim()
      },
    }
  }

  invalidate(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    entry.request.dispose()
  }

  private trim() {
    const idle = [...this.entries].filter(([, entry]) => entry.users === 0)
    let bytes = idle.reduce((total, [, entry]) => total + (entry.current?.manager.stats().usedBytes ?? 0), 0)
    while (idle.length > this.maxIdle || bytes > 64 * 1024 * 1024) {
      const [key, entry] = idle.shift()!
      bytes -= entry.current?.manager.stats().usedBytes ?? 0
      this.entries.delete(key)
      entry.request.dispose()
    }
  }
}

export const pdfJsSessions = new PdfJsSessionCache()
