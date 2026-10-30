/** One startup read, handed to its first consumer and never retained as a cache. */
export class PreparedRead<T> {
  private entry: { key: string; promise: Promise<T>; controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined

  private readonly read: (key: string, signal?: AbortSignal) => Promise<T>
  private readonly initialRead: (key: string, signal?: AbortSignal) => Promise<T>

  constructor(read: (key: string, signal?: AbortSignal) => Promise<T>, initialRead = read) {
    this.read = read
    this.initialRead = initialRead
  }

  prepare(key: string, onRead?: (value: T) => void | Promise<void>) {
    this.cancel()
    const controller = new AbortController()
    const read = this.initialRead(key, controller.signal)
    const promise = onRead ? read.then(async value => {
      controller.signal.throwIfAborted()
      await onRead(value)
      controller.signal.throwIfAborted()
      return value
    }) : read
    const entry = { key, promise, controller, timer: setTimeout(() => this.cancel(), 5000) }
    this.entry = entry
    void promise.catch(() => { if (this.entry === entry) this.cancel() })
    return promise
  }

  take(key: string, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const entry = this.entry
    if (!entry || entry.key !== key) return this.read(key, signal)
    this.entry = undefined
    clearTimeout(entry.timer)
    const abort = () => entry.controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    return entry.promise.then(value => { signal?.throwIfAborted(); return value })
      .finally(() => signal?.removeEventListener('abort', abort))
  }

  cancel() {
    if (!this.entry) return
    clearTimeout(this.entry.timer)
    this.entry.controller.abort()
    this.entry = undefined
  }
}
