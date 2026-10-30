// Only session reads use this retry; workspace writes and AI requests are never replayed.
export async function retrySessionRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const delays = [250, 750]
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted()
    try {
      return await read()
    } catch (error) {
      if (signal.aborted || !(error instanceof TypeError) || attempt >= delays.length) throw error
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(signal.reason)
        }
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort)
          resolve()
        }, delays[attempt])
        signal.addEventListener("abort", abort, { once: true })
      })
    }
  }
}
