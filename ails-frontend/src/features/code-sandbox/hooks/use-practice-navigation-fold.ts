import { useCallback, useState } from "react"
import { usePracticeTutor } from "../../practice-tutor/practice-tutor-provider.tsx"

export function usePracticeNavigationFold() {
  const [manualCollapsed, setManualCollapsed] = useState(false)
  const tutor = usePracticeTutor()
  const open = tutor?.open ?? false
  const setExpanded = tutor?.setNavigationExpanded
  const collapsed = open ? !tutor?.navigationExpanded : manualCollapsed
  const toggle = useCallback(() => {
    if (open && setExpanded) setExpanded(collapsed)
    else setManualCollapsed(current => !current)
  }, [open, collapsed, setExpanded])
  return { collapsed, manualCollapsed, toggle }
}
