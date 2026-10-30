import { GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { markDocumentStartupPhase } from '../../../lib/document-presentation-diagnostics.ts'
import { takePreparedPdfWorkerPort } from './pdf-worker-bootstrap.ts'

GlobalWorkerOptions.workerSrc = workerUrl
type WorkerEntry = { worker: PDFWorker; ready: Promise<void>; leases: number; dispose: () => void; timer?: ReturnType<typeof setTimeout> }
let active: WorkerEntry | undefined

function retireWhenIdle(entry: WorkerEntry) {
  clearTimeout(entry.timer)
  if (entry.leases || entry.worker.destroyed) return
  entry.timer = setTimeout(() => {
    if (!entry.leases) entry.dispose()
  }, 30_000)
}

/** One renderer owns the PDF worker; open documents borrow it until disposal. */
export function acquirePdfWorker() {
  if (!active || active.worker.destroyed) {
    active?.dispose()
    markDocumentStartupPhase('pdf-worker-create')
    const port = takePreparedPdfWorkerPort()
    let worker: PDFWorker
    try { worker = port ? PDFWorker.create({ port: port.port }) : new PDFWorker() }
    catch (error) { port?.dispose(); throw error }
    const entry: WorkerEntry = { worker, leases: 0,
      ready: Promise.all([worker.promise, port?.ready]).then(() => { markDocumentStartupPhase('pdf-worker-ready') }),
      dispose() {
        clearTimeout(entry.timer); worker.destroy(); port?.dispose()
        window.removeEventListener('pagehide', entry.dispose)
        if (active === entry) active = undefined
      },
    }
    active = entry
    window.addEventListener('pagehide', entry.dispose, { once: true })
    void entry.ready.catch(() => entry.dispose())
  }
  const current = active
  clearTimeout(current.timer)
  current.leases += 1
  let released = false
  return { worker: current.worker, ready: current.ready, release() {
    if (released) return
    released = true
    current.leases -= 1
    retireWhenIdle(current)
  } }
}

export async function preparePdfWorker() {
  const lease = acquirePdfWorker()
  try { await lease.ready }
  finally { lease.release() }
}
