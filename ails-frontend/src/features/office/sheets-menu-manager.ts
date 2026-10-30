import type { Injector, IConfigService } from '@univerjs/core'
import { MenuManagerService } from '@univerjs/ui'

/** Coalesce notifications, keeping menu data and the final notification synchronous. */
export class SheetsMenuManager extends MenuManagerService {
  private depth = 0
  private pending = false
  private closed = false
  private readonly notify: () => void

  constructor(injector: Injector, config: IConfigService) {
    super(injector, config)
    // This service owns its Subject. Univer 1.1 publishes once per matching
    // tree node; each publication rebuilds all ribbon observables. Intercept
    // only this instance, retaining the public Subject and scoped menu APIs.
    this.notify = this.menuChanged$.next.bind(this.menuChanged$)
    this.menuChanged$.next = () => {
      if (this.closed) return
      if (this.depth) this.pending = true
      else this.notify()
    }
  }

  batch(action: () => void) {
    this.depth++
    try { action() }
    finally {
      this.depth--
      if (!this.depth && this.pending) {
        this.pending = false
        if (!this.closed) this.notify()
      }
    }
  }

  override mergeMenu(...args: Parameters<MenuManagerService['mergeMenu']>) {
    this.batch(() => super.mergeMenu(...args))
  }

  override dispose() {
    this.closed = true
    this.pending = false
    super.dispose()
  }
}
