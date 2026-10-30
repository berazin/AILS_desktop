import { useEffect, useState } from "react"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"

export function useWorkspaceWindowLifecycle() {
  const [canCloseLastTab, setCanCloseLastTab] = useState(false)
  useEffect(() => {
    const api = getAppDesktopApi()
    let active = true
    let revision = 0
    const unsubscribe = api?.on_tab_window_event?.(event => {
      if (event.type !== "window-state" || !event.windowState) return
      revision++
      setCanCloseLastTab(event.windowState.canCloseLastTab)
    })
    void api?.get_tab_window_state?.().then(state => {
      if (active && revision === 0) setCanCloseLastTab(state.canCloseLastTab)
    }).catch(() => {})
    return () => { active = false; unsubscribe?.() }
  }, [])
  return { canCloseLastTab }
}
