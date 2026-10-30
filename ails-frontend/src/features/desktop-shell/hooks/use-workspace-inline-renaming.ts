import { useRef, useState } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { uniqueContextItems } from "../lib/material-context-targets.ts"
import { renamedWorkspacePath } from "../lib/workspace-rename.ts"
import type { MaterialItem } from "./use-materials-listing.ts"

type Session = { items: MaterialItem[]; pending: boolean; index: number; total: number }
const empty: Session = { items: [], pending: false, index: 0, total: 0 }

export function useWorkspaceInlineRenaming(onPrepare: (item: MaterialItem) => void) {
  const [session, setSession] = useState(empty)
  const current = useRef(session), prepare = useEventCallback(onPrepare)
  function update(next: Session) { current.current = next; setSession(next) }
  function start(items: readonly MaterialItem[]) {
    const targets = uniqueContextItems(items)
    if (!targets.length) return
    update({ items: targets, pending: true, index: 0, total: targets.length })
    prepare(targets[0])
  }
  function activate(path: string) {
    const state = current.current
    if (state.pending && state.items[0]?.path === path) update({ ...state, pending: false })
  }
  function finish(oldPath: string, newPath: string, advance: boolean, cancelled: boolean) {
    const state = current.current
    // A previous request may finish after the user starts another session.
    if (state.items[0]?.path !== oldPath) return null
    const rest = advance && !cancelled ? state.items.slice(1).map(item => ({ ...item,
      path: renamedWorkspacePath(item.path, oldPath, newPath) })) : []
    if (!rest.length) { update(empty); return false }
    update({ items: rest, pending: true, index: state.index + 1, total: state.total })
    prepare(rest[0])
    return true
  }
  return { activePath: session.pending ? "" : session.items[0]?.path ?? "", pending: session.pending,
    index: session.index, total: session.total, start, activate, finish, cancel: () => update(empty) }
}
