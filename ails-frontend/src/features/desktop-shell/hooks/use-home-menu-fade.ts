import { useCallback, useEffect, useState, type SetStateAction, type TransitionEvent } from "react"

export function useHomeMenuFade<OpenMode extends string>(defaultOpenMode: OpenMode) {
  type Mode = OpenMode | "closed"
  const [mode, setPhase] = useState<Mode | "closing">("closed")
  const open = mode !== "closed" && mode !== "closing"
  const present = mode !== "closed"

  const setMode = useCallback((next: SetStateAction<Mode>) => {
    setPhase((phase) => {
      const current = phase === "closing" ? "closed" : phase
      const nextMode = typeof next === "function" ? next(current) : next
      return nextMode === "closed" && phase !== "closed" ? "closing" : nextMode
    })
  }, [])
  const setOpen = useCallback((next: SetStateAction<boolean>) => {
    setMode((current) => (typeof next === "function" ? next(current !== "closed") : next) ? defaultOpenMode : "closed")
  }, [defaultOpenMode, setMode])
  useEffect(() => {
    if (mode !== "closing") return
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250
    const timer = window.setTimeout(() => setPhase((phase) => phase === "closing" ? "closed" : phase), delay)
    return () => window.clearTimeout(timer)
  }, [mode])
  function onTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && event.propertyName === "opacity" && !open
      && Number(getComputedStyle(event.currentTarget).opacity) === 0) {
      setPhase((phase) => phase === "closing" ? "closed" : phase)
    }
  }
  return { mode, open, present, setMode, setOpen, onTransitionEnd }
}
