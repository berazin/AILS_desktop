import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { markDocumentStartupPhase } from '../../../lib/document-presentation-diagnostics.ts'

type PreparedPort = { port: Worker; ready: Promise<void>; dispose: () => void }
let prepared: PreparedPort | undefined
let expiry: ReturnType<typeof setTimeout> | undefined

/** Start only the worker script, before loading the PDF.js UI module graph. */
export function preparePdfWorkerPort() {
  if (prepared) return
  markDocumentStartupPhase('pdf-worker-port-create')
  const port = new Worker(workerUrl, { type: 'module' })
  let finish!: () => void, fail!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
  let stopped = false, settled = false
  const cleanup = () => {
    clearTimeout(timeout)
    port.removeEventListener('message', message)
    port.removeEventListener('error', error)
  }
  const message = (event: MessageEvent) => {
    // PDF.js 5.x announces that its MessageHandler is listening on this port.
    if (event.data?.sourceName !== 'worker' || event.data?.targetName !== 'main' || event.data?.action !== 'ready') return
    settled = true; cleanup(); finish()
    markDocumentStartupPhase('pdf-worker-port-ready')
  }
  const error = () => { settled = true; cleanup(); fail(new Error('PDF worker failed to start')) }
  const timeout = setTimeout(error, 15000)
  port.addEventListener('message', message)
  port.addEventListener('error', error)
  const entry: PreparedPort = { port, ready, dispose() {
    if (stopped) return
    stopped = true; cleanup(); port.terminate()
    if (prepared === entry) { prepared = undefined; clearTimeout(expiry) }
    if (!settled) { settled = true; fail(new DOMException('PDF preparation cancelled', 'AbortError')) }
    window.removeEventListener('pagehide', entry.dispose)
  } }
  prepared = entry
  window.addEventListener('pagehide', entry.dispose, { once: true })
  void ready.catch(() => { entry.dispose(); if (prepared === entry) { prepared = undefined; clearTimeout(expiry) } })
  // If startup is abandoned before a viewer claims the worker, release it.
  expiry = setTimeout(() => { if (prepared === entry) { prepared = undefined; entry.dispose() } }, 30000)
}

export function takePreparedPdfWorkerPort() {
  const entry = prepared
  prepared = undefined
  clearTimeout(expiry)
  if (entry) window.removeEventListener('pagehide', entry.dispose)
  return entry
}
