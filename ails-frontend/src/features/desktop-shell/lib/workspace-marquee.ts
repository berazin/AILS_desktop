export type WorkspacePoint = { x: number; y: number }
export type WorkspaceSelectionRect = { left: number; top: number; width: number; height: number }
export type WorkspaceItemLayout = {
  left: number; top: number; columns: readonly number[]; columnGap: number; rowGap: number; itemHeight: number
}

export function workspaceSelectionRect(start: WorkspacePoint, end: WorkspacePoint): WorkspaceSelectionRect {
  return { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

// Derive every item from the measured fixed list/grid layout, including rows
// currently omitted by virtualization. Gaps and edge-only contact do not hit.
export function workspaceMarqueePaths(paths: readonly string[], rect: WorkspaceSelectionRect, layout: WorkspaceItemLayout): string[] {
  const columns = layout.columns.length, stride = layout.itemHeight + layout.rowGap
  if (!columns || stride <= 0 || !paths.length) return []
  const first = Math.max(0, Math.floor((rect.top - layout.top) / stride))
  const last = Math.min(Math.ceil(paths.length / columns) - 1, Math.floor((rect.top + rect.height - layout.top) / stride))
  const selected: string[] = []
  for (let row = first; row <= last; row++) {
    const top = layout.top + row * stride
    if (rect.top + rect.height <= top || rect.top >= top + layout.itemHeight) continue
    let left = layout.left
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column, width = layout.columns[column]
      if (index < paths.length && rect.left + rect.width > left && rect.left < left + width) selected.push(paths[index])
      left += width + layout.columnGap
    }
  }
  return selected
}
