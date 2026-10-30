const NAME_BASE = 240
const KIND_BASE = 112
const MODIFIED_BASE = 160
const ACTION_WIDTH = 40
const KIND_MIN = 64
const MODIFIED_MIN = 128

/** Distribute list-column resize deltas toward the right; discard unreadably small columns. */
export function workspaceListColumns(availableWidth: number, actionWidth = ACTION_WIDTH) {
  const width = Math.max(0, Number.isFinite(availableWidth) ? availableWidth : 0)
  // At tiny split-pane widths the row context menu replaces the action button.
  const actions = actionWidth > 0 && width >= actionWidth * 2 ? actionWidth : null
  const remaining = width - (actions ?? 0)
  const count = actions === null ? 1 : 2
  const allDelta = (remaining - NAME_BASE - KIND_BASE - MODIFIED_BASE) / 6
  const modified = MODIFIED_BASE + allDelta * 3
  if (modified >= MODIFIED_MIN) {
    return { name: NAME_BASE + allDelta, kind: KIND_BASE + allDelta * 2, modified, actions, count: count + 2 }
  }
  const pairDelta = (remaining - NAME_BASE - KIND_BASE) / 3
  const kind = KIND_BASE + pairDelta * 2
  if (kind >= KIND_MIN) {
    return { name: NAME_BASE + pairDelta, kind, modified: null, actions, count: count + 1 }
  }
  return { name: remaining, kind: null, modified: null, actions, count }
}
