import { useEffect, useRef, type RefObject } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { createPracticeWheelNavigation, practiceWheelDirection, practiceWheelHasScrollTarget } from "../lib/practice-wheel-navigation.ts"

type Props = {
  enabled: boolean
  activeKey: string | null
  blocked: boolean
  isCode: boolean
  rootRef: RefObject<HTMLElement | null>
  answerRef: RefObject<HTMLElement | null>
  codeInputRef?: RefObject<{ focus: () => void } | null>
  onPrevious?: () => void
  onNext?: () => void
}

export function practiceNavigationDirection(event: KeyboardEvent, isCode: boolean) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.altKey) {
    if (event.key === "ArrowLeft") return "previous"
    if (event.key === "ArrowRight") return "next"
  } else if (event.key === "Enter" && !isCode) {
    return "next"
  }
  return null
}

export function usePracticeNavigation({
  enabled, activeKey, blocked, isCode, rootRef, answerRef, codeInputRef, onPrevious, onNext,
}: Props) {
  const wheelNavigation = useRef(createPracticeWheelNavigation())
  const handleWheel = useEventCallback((event: WheelEvent) => {
    const root = rootRef.current
    const target = event.target
    if (!enabled || !activeKey || !root || !(target instanceof Element)
      || !root.contains(target) || event.defaultPrevented) return
    if (target.closest("[role='dialog']") !== root
      || target.closest("select, nav, [data-practice-problem-navigator], [role='menu'], [data-practice-actions-popup], [data-problem-batch-progress]")
      || root.querySelector("[data-practice-actions-popup], [aria-haspopup='dialog'][aria-expanded='true']")) return
    if (practiceWheelHasScrollTarget(target, root)) return
    const direction = practiceWheelDirection(event)
    if (!direction) return
    // A non-passive native listener also consumes boundary events, preventing
    // a wheel gesture from simultaneously changing the problem and scrolling.
    event.preventDefault()
    event.stopPropagation()
    if (blocked || !wheelNavigation.current.step(direction, performance.now())) return
    if (direction === "previous") onPrevious?.()
    else onNext?.()
  })

  useEffect(() => {
    if (!enabled) {
      wheelNavigation.current.reset()
      return
    }
    window.addEventListener("wheel", handleWheel, { capture: true, passive: false })
    return () => window.removeEventListener("wheel", handleWheel, true)
  }, [enabled, handleWheel])

  useEffect(() => {
    if (!enabled || !activeKey) return
    function handleKeyDown(event: KeyboardEvent) {
      const root = rootRef.current
      const target = event.target
      if (!root || !(target instanceof Element) || !root.contains(target)) return
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if (event.key === "Enter" && !event.altKey && target.closest("[data-practice-question-copy]")) return
      if (target.closest("[role='dialog']") !== root
        || target.closest("select, [role='menu'], [data-practice-actions-popup], [data-problem-batch-progress]")
        || root.querySelector("[data-practice-actions-popup], [aria-haspopup='dialog'][aria-expanded='true']")) return
      const direction = practiceNavigationDirection(event, isCode)
      if (!direction) return
      // Consume boundary and held keys too, so they cannot activate a button or browser history.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (blocked || event.repeat) return
      if (direction === "previous") onPrevious?.()
      else onNext?.()
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [enabled, activeKey, blocked, isCode, rootRef, onPrevious, onNext])

  useEffect(() => {
    if (!enabled || !activeKey || blocked) return
    const root = rootRef.current
    if (!root) return
    let frame = 0
    const observer = new MutationObserver(() => scheduleFocus())
    const focusAnswer = () => {
      if (root.querySelector("[data-practice-grading-context-dialog]")) return
      if (root.querySelector("[data-practice-actions-popup], [aria-haspopup='dialog'][aria-expanded='true']")) return
      if (isCode) {
        // Monaco mounts asynchronously. Observe its mount instead of polling for readiness.
        if (!codeInputRef?.current || !root.querySelector(".monaco-editor .inputarea")) {
          root.focus({ preventScroll: true })
          return
        }
        codeInputRef.current.focus()
      } else {
        const answer = answerRef.current
        const control = answer?.querySelector<HTMLElement>("button[aria-pressed='true']:not(:disabled)")
          ?? answer?.querySelector<HTMLElement>("textarea:not(:disabled), input:not(:disabled), button:not(:disabled)")
        const focusTarget = control ?? root
        focusTarget.focus({ preventScroll: true })
      }
      observer.disconnect()
    }
    function scheduleFocus() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(focusAnswer)
    }
    observer.observe(root, { childList: true, subtree: true })
    scheduleFocus()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [enabled, activeKey, blocked, isCode, rootRef, answerRef, codeInputRef])
}
