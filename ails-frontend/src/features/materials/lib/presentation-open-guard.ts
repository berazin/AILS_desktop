/** Bound the whole presentation read, including queued fetches and status errors. */
export function createPresentationOpenGuard(controller: AbortController, timeoutMessage: string, timeoutMs = 205_000) {
  let failure: Error | null = null
  let activeSeen = false
  let disposed = false
  let rejectFailure: (error: Error) => void = () => undefined
  const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject })
  void failed.catch(() => undefined)
  const fail = (message: string) => {
    if (disposed || failure) return
    failure = new Error(message)
    rejectFailure(failure)
    controller.abort()
  }
  const timer = setTimeout(() => fail(timeoutMessage), timeoutMs)
  return {
    wait<T>(read: Promise<T>): Promise<T> { return Promise.race([read, failed]) },
    observe(status: { active: boolean; state: string; error: string }) {
      // A failed previous export must not cancel a fresh retry before it starts.
      if (status.active) activeSeen = true
      else if (activeSeen && status.state === "failed") fail(status.error || timeoutMessage)
    },
    error: () => failure,
    dispose() { disposed = true; clearTimeout(timer) },
  }
}
