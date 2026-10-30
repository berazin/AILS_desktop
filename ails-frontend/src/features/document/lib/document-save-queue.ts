/** Own disk-write ordering independently from editor rendering and mode changes. */
export class DocumentSaveQueue {
  private pending: Promise<unknown> = Promise.resolve()
  private readonly savedContent = new Map<string, string>()

  enqueue<T>(write: () => Promise<T>): Promise<T> {
    const task = this.pending.catch(() => undefined).then(write)
    this.pending = task
    return task
  }

  async waitForIdle(): Promise<void> {
    let pending: Promise<unknown>
    do {
      pending = this.pending
      await pending
    } while (pending !== this.pending)
  }

  lastSaved(path: string): string | undefined {
    return this.savedContent.get(path)
  }

  remember(path: string, content: string): void {
    this.savedContent.delete(path)
    this.savedContent.set(path, content)
    if (this.savedContent.size > 16) this.savedContent.delete(this.savedContent.keys().next().value!)
  }
}
