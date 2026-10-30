/** Stop waiting for a running tool without starting any later chat round. */
export function waitForChatTask<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    task.then(value => {
      signal.removeEventListener("abort", abort)
      if (signal.aborted) reject(signal.reason)
      else resolve(value)
    }, error => {
      signal.removeEventListener("abort", abort)
      reject(error)
    })
    if (signal.aborted) abort()
  })
}
