import { Activity, useState, type ReactNode } from "react"

type Entry = { id: string; view: ReactNode }
type Props = { activeId: string; openIds: readonly string[]; children: ReactNode; maxViews?: number }

// Open browser-style pages retain their DOM while hidden effects are suspended.
// A caller may cap auxiliary panes; the primary reader stays resident until closed.

export function CachedTabViews(props: Props) {
  const [cache, setCache] = useState<{ input: Props | null; entries: Entry[] }>({ input: null, entries: [] })
  if (cache.input !== props) {
    const open = new Set(props.openIds)
    const entries = cache.entries.filter((entry) => open.has(entry.id))
    if (props.activeId) {
      const index = entries.findIndex((entry) => entry.id === props.activeId)
      const active = { id: props.activeId, view: props.children }
      if (index < 0) entries.push(active)
      else if (Number.isFinite(props.maxViews)) { entries.splice(index, 1); entries.push(active) }
      else entries[index] = active
    }
    setCache({ input: props, entries: props.maxViews == null ? entries : entries.slice(-props.maxViews) })
  }

  return cache.entries.map((entry) => (
    <Activity key={entry.id} mode={entry.id === props.activeId ? "visible" : "hidden"}>
      {entry.view}
    </Activity>
  ))
}
