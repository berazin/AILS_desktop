type WheelInput = Pick<WheelEvent, "deltaX" | "deltaY" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">
export type PracticeWheelDirection = "previous" | "next"

export function practiceWheelDirection(event: WheelInput): PracticeWheelDirection | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    || !Number.isFinite(event.deltaY) || event.deltaY === 0
    || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return null
  return event.deltaY > 0 ? "next" : "previous"
}

export function practiceWheelHasScrollTarget(target: Element, root: Element): boolean {
  for (let element: Element | null = target; element; element = element.parentElement) {
    if (element.scrollHeight > element.clientHeight
      && /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY)) {
      // A scrollable region owns the gesture even at either end of its content.
      return true
    }
    if (element === root) break
  }
  return false
}

export function createPracticeWheelNavigation() {
  let lastStepAt = Number.NEGATIVE_INFINITY
  let lastDirection: PracticeWheelDirection | null = null
  return {
    step(direction: PracticeWheelDirection, now: number) {
      // Keep this gate across question changes: one burst must not skip a set
      // just because the first wheel event re-rendered the navigation controls.
      if (direction === lastDirection && now - lastStepAt < 150) return false
      lastStepAt = now
      lastDirection = direction
      return true
    },
    reset() {
      lastStepAt = Number.NEGATIVE_INFINITY
      lastDirection = null
    },
  }
}
