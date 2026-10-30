import { useMemo, useState } from "react"
import type { PracticeRetryMode } from "../../../lib/api.ts"

type Session = { scope: string; mode: PracticeRetryMode | null; ids: string[] }

function readSession(scope: string): Session {
  try {
    const saved = JSON.parse(localStorage.getItem(`ails_practice_retry_${scope}`) || "null")
    if (saved && ["wrong", "selected", "all"].includes(saved.mode) && Array.isArray(saved.ids) && saved.ids.every((id: unknown) => typeof id === "string")) return { scope, mode: saved.mode, ids: saved.ids }
  } catch { /* A damaged UI filter must not block the stored problem data. */ }
  return { scope, mode: null, ids: [] }
}

export function usePracticeRetrySession<T extends { id: string }>(scope: string, items: T[]) {
  const [stored, setStored] = useState<Session>(() => readSession(scope))
  const session = useMemo(() => stored.scope === scope ? stored : readSession(scope), [scope, stored])
  const visible = useMemo(() => session.mode ? items.filter(item => session.ids.includes(item.id)) : items, [items, session])
  const begin = (mode: PracticeRetryMode, ids: string[]) => {
    const next = { scope, mode, ids }
    try { localStorage.setItem(`ails_practice_retry_${scope}`, JSON.stringify(next)) } catch { /* Session remains usable in memory. */ }
    setStored(next)
  }
  const clear = () => {
    try { localStorage.removeItem(`ails_practice_retry_${scope}`) } catch { /* Session remains usable in memory. */ }
    setStored({ scope, mode: null, ids: [] })
  }
  return { items: visible, mode: session.mode, begin, clear }
}
