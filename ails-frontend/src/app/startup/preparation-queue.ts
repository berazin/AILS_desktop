type Preparation = { name: string; run: (signal: AbortSignal) => unknown | Promise<unknown> }

/** Optional preparation never competes with itself and stops with its window. */
export class PreparationQueue {
  private readonly controller = new AbortController()
  private readonly tasks: Preparation[] = []
  private running: Promise<void> | undefined
  private readonly onError: (name: string, error: unknown) => void

  constructor(onError: (name: string, error: unknown) => void) {
    this.onError = onError
  }

  add(name: string, run: Preparation["run"]) {
    if (this.controller.signal.aborted) return
    if (this.tasks.some(task => task.name === name)) return
    this.tasks.push({ name, run })
  }

  start() {
    return this.running ??= this.drain()
  }

  cancel() {
    this.controller.abort()
    this.tasks.length = 0
  }

  private async drain() {
    while (!this.controller.signal.aborted) {
      const task = this.tasks.shift()
      if (!task) return
      try {
        await task.run(this.controller.signal)
      } catch (error) {
        if (!this.controller.signal.aborted) this.onError(task.name, error)
      }
    }
  }
}
