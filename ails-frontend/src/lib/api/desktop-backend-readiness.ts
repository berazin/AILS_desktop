type State = "starting" | "ready" | "failed"

export class BackendReadinessError extends Error {
  code: string
  status = 503
  constructor(state: State) {
    super(state === "failed" ? "로컬 백엔드를 시작하지 못했습니다. 다시 시도해 주세요." : "로컬 백엔드를 준비 중입니다. 잠시 후 다시 시도해 주세요.")
    this.code = state === "failed" ? "AILS_BACKEND_FAILED" : "AILS_BACKEND_STARTING"
  }
}

/** Wait before opening HTTP reads: otherwise six queued reads starve the UI's
 * status/abort/mutation requests in Chromium's per-origin connection pool. */
export function createBackendReadiness(probe: () => Promise<{ state: State }>, intervalMs = 25, timeoutMs = 300000) {
  let ready = false
  let waiting: Promise<void> | undefined
  async function check() {
    if (ready) return
    const { state } = await probe()
    if (state !== "ready") throw new BackendReadinessError(state)
    ready = true
  }
  function begin() {
    if (waiting) return waiting
    waiting = (async () => {
      const deadline = Date.now() + timeoutMs
      while (!ready && Date.now() < deadline) {
        try { await check(); return } catch (error) {
          if (!(error instanceof BackendReadinessError) || error.code !== "AILS_BACKEND_STARTING") throw error
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
      if (!ready) throw new BackendReadinessError("failed")
    })().finally(() => { waiting = undefined })
    return waiting
  }
  async function wait(signal?: AbortSignal | null) {
    signal?.throwIfAborted()
    if (ready) return
    if (!signal) return begin()
    return new Promise<void>((resolve, reject) => {
      const abort = () => { cleanup(); reject(signal.reason ?? new DOMException("Aborted", "AbortError")) }
      const cleanup = () => signal.removeEventListener("abort", abort)
      signal.addEventListener("abort", abort, { once: true })
      void begin().then(() => { cleanup(); resolve() }, error => { cleanup(); reject(error) })
    })
  }
  return { wait, check }
}
