import type { AILSConfig } from "../../../lib/api"
import type { SettingsSnapshot } from "../hooks/use-settings-controller.ts"

export type SettingsSaveState = "saved" | "pending" | "saving" | "error"

function signature(value: unknown) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item)
}
export const settingsValuesEqual = (left: unknown, right: unknown) => signature(left) === signature(right)
const equal = settingsValuesEqual

// Accept server normalization only for fields the user has not edited since submission.
export function reconcileSavedConfig(submitted: AILSConfig, saved: AILSConfig, current: AILSConfig): AILSConfig {
  const result = { ...current }
  for (const key of new Set([...Object.keys(submitted), ...Object.keys(saved)])) {
    if (!equal(current[key], submitted[key])) continue
    if (key in saved) result[key] = saved[key]
    else delete result[key]
  }
  return result
}

type Callbacks = {
  save: (snapshot: SettingsSnapshot, previous: SettingsSnapshot) => Promise<SettingsSnapshot>
  onSaved: (saved: SettingsSnapshot, submitted: SettingsSnapshot) => void
  onSettled: (saved: SettingsSnapshot, previous: SettingsSnapshot) => void
  onState: (state: SettingsSaveState, pending: boolean) => void
  onError: (error: unknown) => void
}

export class SettingsAutoSave {
  private current: SettingsSnapshot | null = null
  private saved: SettingsSnapshot | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private flight: Promise<boolean> | null = null
  private disposed = false
  private reportedState: SettingsSaveState | null = null
  private reportedPending = false

  private callbacks: Callbacks
  private delay: number

  constructor(callbacks: Callbacks, delay = 450) {
    this.callbacks = callbacks
    this.delay = delay
  }

  begin(snapshot: SettingsSnapshot) {
    // A failed or unfinished save must survive closing and reopening settings.
    if (this.flight || (this.current && !equal(this.current, this.saved))) return
    this.current = snapshot
    this.saved = snapshot
    this.reportState("saved", false)
  }

  update(snapshot: SettingsSnapshot) {
    if (!this.saved || equal(snapshot, this.current)) return
    this.current = snapshot
    this.clearTimer()
    const pending = Boolean(this.flight) || !equal(this.current, this.saved)
    this.reportState(this.flight ? "saving" : pending ? "pending" : "saved", pending)
    if (pending && !this.flight) this.timer = setTimeout(() => { void this.flush() }, this.delay)
  }

  flush(): Promise<boolean> {
    this.clearTimer()
    if (this.flight) return this.flight
    if (!this.current || !this.saved || equal(this.current, this.saved)) return Promise.resolve(true)
    this.reportState("saving", true)
    this.flight = this.drain().finally(() => { this.flight = null })
    return this.flight
  }

  private async drain() {
    const previous = this.saved!
    try {
      while (!this.disposed && !equal(this.current, this.saved)) {
        const submitted = this.current!
        const saved = await this.callbacks.save(submitted, this.saved!)
        if (this.disposed) return false
        const current = this.current!
        const reconciled = { ...saved, config: reconcileSavedConfig(submitted.config, saved.config, current.config) }
        // Local view preferences may also have changed during the request.
        for (const key of Object.keys(current) as (keyof SettingsSnapshot)[]) {
          if (key !== "config" && !equal(current[key], submitted[key])) Object.assign(reconciled, { [key]: current[key] })
        }
        this.callbacks.onSaved(saved, submitted)
        this.saved = saved
        this.current = reconciled
      }
      if (this.disposed) return false
      this.reportState("saved", false)
      this.callbacks.onSettled(this.saved!, previous)
      return true
    } catch (error) {
      if (!this.disposed) {
        this.reportState("error", true)
        this.callbacks.onError(error)
      }
      return false
    }
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private reportState(state: SettingsSaveState, pending: boolean) {
    if (state === this.reportedState && pending === this.reportedPending) return
    this.reportedState = state
    this.reportedPending = pending
    this.callbacks.onState(state, pending)
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
  }
}
