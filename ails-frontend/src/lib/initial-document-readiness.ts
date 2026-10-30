/** A window owns one initial document phase; optional preparation follows it. */
export class InitialDocumentReadiness {
  private pending: Promise<void> | undefined
  private resolve: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  begin(timeoutMs = 3000) {
    this.finish()
    this.pending = new Promise<void>(resolve => { this.resolve = resolve })
    // Failed/unsupported documents must not prevent the rest of the app loading.
    this.timer = setTimeout(() => this.finish(), timeoutMs)
  }

  get waiting() { return this.pending !== undefined }

  finish() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.resolve?.()
    this.resolve = undefined
    this.pending = undefined
  }

  async wait(signal?: AbortSignal) {
    signal?.throwIfAborted()
    const pending = this.pending
    if (!pending) return
    if (!signal) return pending
    await new Promise<void>((resolve, reject) => {
      const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')) }
      const cleanup = () => signal.removeEventListener('abort', abort)
      signal.addEventListener('abort', abort, { once: true })
      void pending.then(() => { cleanup(); resolve() })
    })
    signal.throwIfAborted()
  }
}

export const initialDocumentReadiness = new InitialDocumentReadiness()
export const waitForInitialDocument = (signal?: AbortSignal) => initialDocumentReadiness.wait(signal)
