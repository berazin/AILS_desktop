import { createContext, useContext, useEffect, useRef } from "react"
import type { PracticeTutorContext } from "../../lib/api/practice-tutor.ts"
import type { PracticeTutorWorkspace } from "./hooks/use-practice-tutor-workspace.ts"

const PracticeTutorContextChannel = createContext<PracticeTutorWorkspace | null>(null)
export const PracticeTutorProvider = PracticeTutorContextChannel.Provider
export const usePracticeTutor = () => useContext(PracticeTutorContextChannel)

export function usePracticeTutorQuestion(context: PracticeTutorContext | null, sidebarWidth: number, active = true, normalSidebarWidth = sidebarWidth) {
  const tutor = usePracticeTutor()
  const owner = useRef(crypto.randomUUID())
  const publish = tutor?.publish
  useEffect(() => { if (active) publish?.(owner.current, context, sidebarWidth, normalSidebarWidth) }, [active, context, publish, sidebarWidth, normalSidebarWidth])
  useEffect(() => () => { if (active) publish?.(owner.current, null) }, [active, publish])
  return tutor
}
