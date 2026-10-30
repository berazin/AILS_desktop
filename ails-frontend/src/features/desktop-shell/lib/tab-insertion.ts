/** Preserve the relative order of a moved split group or entire window. */
export function insertWorkspaceTabIds(current: readonly string[], incoming: readonly string[], beforeId: string | null) {
  const moving = [...new Set(incoming)]
  const remaining = current.filter(id => !moving.includes(id))
  const index = beforeId ? remaining.indexOf(beforeId) : -1
  const slot = index < 0 ? remaining.length : index
  return [...remaining.slice(0, slot), ...moving, ...remaining.slice(slot)]
}
