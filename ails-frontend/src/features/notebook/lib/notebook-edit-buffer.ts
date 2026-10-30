import { updateNotebookCellSource } from "../components/notebook-utils.tsx"

// The textarea owns keystrokes. Publish a notebook snapshot after a short pause,
// and serialize disk writes so an older response cannot replace a newer draft.
export class NotebookEditBuffer {
  raw: string
  private drafts = new Map<number, string>()
  private version = 0
  private savedVersion = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private saving: Promise<void> | undefined
  private observedRaw: string
  private publish: (raw: string) => void
  private persist: (raw: string) => Promise<unknown>
  private onError: (error: unknown) => void

  constructor(raw: string, publish: (raw: string) => void,
    persist: (raw: string) => Promise<unknown>, onError: (error: unknown) => void) {
    this.raw = this.observedRaw = raw
    this.publish = publish
    this.persist = persist
    this.onError = onError
  }

  sync(raw: string) {
    if (raw !== this.observedRaw) {
      this.observedRaw = raw
      this.raw = raw
    }
  }

  edit(index: number, source: string) {
    this.drafts.set(index, source)
    this.schedule()
  }

  snapshot() {
    this.applyDrafts()
    return this.raw
  }

  private applyDrafts() {
    if (!this.drafts.size) return
    for (const [index, source] of this.drafts) this.raw = updateNotebookCellSource(this.raw, index, source)
    this.drafts.clear()
    this.version++
    this.publish(this.raw)
  }

  update(action: (raw: string) => string) {
    this.applyDrafts()
    this.raw = action(this.raw)
    this.version++
    this.publish(this.raw)
    this.schedule()
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush().catch(this.onError) }, 400)
  }

  async flush() {
    clearTimeout(this.timer)
    this.applyDrafts()
    if (this.saving) {
      await this.saving
      if (this.savedVersion < this.version) await this.flush()
      return
    }
    this.saving = (async () => {
      while (this.savedVersion < this.version) {
        const version = this.version
        await this.persist(this.raw)
        this.savedVersion = version
      }
    })()
    try { await this.saving } finally { this.saving = undefined }
  }
}
