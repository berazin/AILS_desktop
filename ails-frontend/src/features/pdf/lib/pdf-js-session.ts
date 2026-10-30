import { getDocument, PDFDataRangeTransport, type PDFDocumentLoadingTask } from 'pdfjs-dist'
import { PdfJsRenderManager } from './pdf-js-render-manager.ts'
import { acquirePdfWorker } from './pdf-worker-lifetime.ts'

const CHUNK_SIZE = 262144

/** Own the network lifetime so failed range requests cannot strand the PDF.js worker. */
export function createPdfJsSession(url: string, headers: Record<string, string>, documentId: string, budget: number) {
  const controller = new AbortController()
  let rejectFailure!: (error: unknown) => void
  const fetchFailure = new Promise<never>((_, reject) => { rejectFailure = reject })
  // A range can fail between render requests. Retain that error for the next
  // uncached page without producing an unhandled rejection in the meantime.
  void fetchFailure.catch(() => {})
  let task: PDFDocumentLoadingTask | null = null
  let manager: PdfJsRenderManager | null = null
  let workerLease: ReturnType<typeof acquirePdfWorker> | null = null

  const retryFetch = async <T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await read(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      } catch (error) {
        if (controller.signal.aborted || attempt >= 2) throw error
      }
    }
  }

  // Content-Length is CORS-safelisted; Content-Range need not be exposed by the
  // local API. Read only the first chunk of a normal GET to learn the full size.
  const readInitial = () => retryFetch(async (signal) => {
    const response = await fetch(url, { headers, signal })
    if (!response.ok) throw new Error(`PDF HTTP ${response.status}`)
    const length = Number(response.headers.get('Content-Length'))
    if (!Number.isSafeInteger(length) || length <= 0 || !response.body) throw new Error('PDF file size is unavailable')
    const reader = response.body.getReader()
    const bytes = new Uint8Array(Math.min(CHUNK_SIZE, length))
    let offset = 0
    try {
      while (offset < bytes.length) {
        const { value, done } = await reader.read()
        if (done) throw new Error('PDF response is incomplete')
        const chunk = value.subarray(0, bytes.length - offset)
        bytes.set(chunk, offset); offset += chunk.length
      }
    } finally { await reader.cancel() }
    return { bytes, length }
  })

  class RangeTransport extends PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      void retryFetch(async (signal) => {
        const response = await fetch(url, { headers: { ...headers, Range: `bytes=${begin}-${end - 1}` }, signal })
        if (!response.ok) throw new Error(`PDF HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (response.status !== 206 || bytes.length !== end - begin) throw new Error('PDF range response is incomplete')
        return bytes
      }).then((bytes) => {
        if (!controller.signal.aborted) this.onDataRange(begin, bytes)
      }).catch((error) => { if (!controller.signal.aborted) rejectFailure(error) })
    }
    abort() { controller.abort() }
  }

  return {
    promise: (async () => {
      const { bytes, length } = await readInitial()
      controller.signal.throwIfAborted()
      const range = new RangeTransport(length, bytes, true)
      workerLease = acquirePdfWorker()
      await workerLease.ready
      controller.signal.throwIfAborted()
      task = getDocument({ worker: workerLease.worker, range, disableAutoFetch: true, disableStream: true, rangeChunkSize: CHUNK_SIZE })
      const document = await Promise.race([task.promise, fetchFailure])
      controller.signal.throwIfAborted()
      manager = new PdfJsRenderManager(document, documentId, budget, fetchFailure)
      return { document, manager }
    })(),
    dispose: () => {
      controller.abort(); manager?.dispose()
      void Promise.resolve(task?.destroy()).finally(() => { workerLease?.release(); workerLease = null })
    },
  }
}
