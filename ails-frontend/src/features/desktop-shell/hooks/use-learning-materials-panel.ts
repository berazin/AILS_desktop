import { useCallback, useEffect, useState, type SetStateAction } from "react"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"

export function useLearningMaterialsPanel(surface: WorkspaceSurface) {
  const [openSurface, setOpenSurface] = useState<WorkspaceSurface | null>(null)
  const open = openSurface === surface && (surface === "document" || surface === "dashboard" || surface === "home")
  const setOpen = useCallback((next: SetStateAction<boolean>) => {
    setOpenSurface((current) => (typeof next === "function" ? next(current === surface) : next) ? surface : null)
  }, [surface])
  const close = useCallback(() => setOpenSurface(null), [])
  const toggle = useCallback(() => setOpen((current) => !current), [setOpen])
  useEffect(close, [surface, close])
  return { open, setOpen, close, toggle }
}
