const { workspaceWindowBounds } = require("./workspace-window.cjs")
const { releasedTabWindowBounds } = require("./workspace-tab-window-position.cjs")

// One hidden renderer is reused after cancelled drags or docking into an
// existing window. Showing its native frame never waits for a tab snapshot.
function createTabWindowReserve({ createWindow, screen, markReserved, getTabOrigin = () => null }) {
  let spare = null
  let disposed = false
  const align = ticket => {
    const window = ticket.window
    if (!window || window.isDestroyed()) return
    const initial = workspaceWindowBounds(screen, ticket.point, true)
    const origin = getTabOrigin(window) ?? ticket.origin
    if (!origin || !ticket.anchor) { if (!ticket.presented) window.setBounds(initial); return }
    const outer = window.getBounds(), content = window.getContentBounds()
    const next = releasedTabWindowBounds({ point: ticket.point, size: ticket.presented ? outer : initial, origin,
      anchor: ticket.anchor, zoom: window.webContents.getZoomFactor(),
      inset: { x: content.x - outer.x, y: content.y - outer.y } })
    if (outer.x !== next.x || outer.y !== next.y || outer.width !== next.width || outer.height !== next.height) window.setBounds(next)
  }
  const present = ticket => {
    const window = ticket.window
    if (!window || window.isDestroyed() || ticket.presented) return
    if (disposed) { window.destroy(); return }
    align(ticket)
    window.setSkipTaskbar(false)
    window.show()
    window.focus()
    ticket.presented = true
  }
  const prepare = point => {
    if (disposed) return null
    if (spare && !spare.error && (!spare.window || !spare.window.isDestroyed())) return spare
    const ticket = { window: null, loaded: null, error: null, claimed: false, presented: false, point }
    spare = ticket
    // The factory reports the native window synchronously, before loadURL.
    // Retain any load failure until a drop needs it; warming is speculative.
    try {
      ticket.loaded = Promise.resolve(createWindow(point, window => {
        ticket.window = window
        if (disposed) { window.destroy(); return }
        markReserved(window, true)
        window.setSkipTaskbar(true)
        if (ticket.claimed) present(ticket)
      }))
    } catch (error) { ticket.loaded = Promise.reject(error) }
    ticket.loaded = ticket.loaded.then(window => {
      ticket.window ??= window
      if (disposed && !window.isDestroyed()) window.destroy()
      else if (ticket.claimed) present(ticket)
      return window
    }).catch(error => { ticket.error = error; return null })
    return ticket
  }
  return {
    prepare,
    claim(point, placement = {}) {
      const ticket = prepare(point)
      if (!ticket) throw new Error("새 창 준비가 종료되었습니다.")
      spare = null
      ticket.claimed = true
      ticket.point = point
      ticket.anchor = placement.anchor
      ticket.origin = placement.origin
      present(ticket)
      return ticket
    },
    activate(ticket) {
      if (ticket?.window && !ticket.window.isDestroyed()) { align(ticket); markReserved(ticket.window, false) }
    },
    dispose() {
      disposed = true
      if (spare?.window && !spare.window.isDestroyed()) spare.window.destroy()
      spare = null
    },
  }
}
module.exports = { createTabWindowReserve }
