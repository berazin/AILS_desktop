const { randomUUID } = require("node:crypto")
const { tabDragDropletBounds } = require("./tab-drag-droplet.cjs")
const { createTabWindowReserve } = require("./workspace-tab-window-reserve.cjs")

const CHANNEL = "ails-tabs:event"
const inside = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height

function createWorkspaceTabTransfer({ ipcMain, screen, createWindow, createDroplet, isTrusted, cursor = () => screen.getCursorScreenPoint() }) {
  const windows = new Map()
  const requests = new Map()
  const closingLastTab = new WeakSet()
  const reserved = new WeakSet()
  const reserve = createTabWindowReserve({ createWindow, screen,
    getTabOrigin: window => windows.get(window.webContents.id)?.strip?.tabOrigin,
    markReserved: (window, value) => { if (value) reserved.add(window); else reserved.delete(window) } })
  let drag = null
  let timer = null
  let droplet = null
  let dropletPoint = null
  let dropletShowing = false
  const send = (entry, value) => { if (entry && !entry.window.isDestroyed()) entry.window.webContents.send(CHANNEL, value) }
  const entryFor = event => {
    const entry = windows.get(event.sender.id)
    return entry && isTrusted(event, entry.window) ? entry : null
  }
  const workspaceWindows = () => [...windows.values()].filter(entry => entry.ready && !entry.window.isDestroyed()
    && !reserved.has(entry.window) && !closingLastTab.has(entry.window) && (entry.window.isVisible() || entry.window.isMinimized()))
  const windowState = () => {
    const count = workspaceWindows().length
    return { count, canCloseLastTab: count > 1 }
  }
  const publishWindowState = () => {
    const state = windowState()
    for (const entry of windows.values()) send(entry, { type: "window-state", windowState: state })
  }
  const request = (entry, type, value = {}) => new Promise((resolve, reject) => {
    if (!entry || entry.window.isDestroyed()) { reject(new Error("대상 창이 닫혔습니다.")); return }
    const requestId = randomUUID()
    const timeout = setTimeout(() => { requests.delete(requestId); reject(new Error("탭 이동 응답을 받지 못했습니다.")) }, 15000)
    requests.set(requestId, { sender: entry.window.webContents.id, resolve, reject, timeout })
    send(entry, { ...value, type, requestId })
  })
  const waitForReady = entry => {
    if (!entry || entry.window.isDestroyed()) return Promise.reject(new Error("새 창이 닫혔습니다."))
    if (entry.ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = error => {
        clearTimeout(timeout); entry.readyWaiters.delete(done)
        if (error) reject(error); else resolve()
      }
      const timeout = setTimeout(() => done(new Error("새 창을 준비하지 못했습니다.")), 15000)
      entry.readyWaiters.add(done)
    })
  }
  const stripRect = entry => {
    const bounds = entry.window.getContentBounds()
    const zoom = entry.window.webContents.getZoomFactor()
    return { x: bounds.x + entry.strip.x * zoom, y: bounds.y + entry.strip.y * zoom,
      width: entry.strip.width * zoom, height: entry.strip.height * zoom }
  }
  const clearPreview = active => {
    if (active?.target) send(active.target, { type: "preview", dragId: active.id, preview: null })
  }
  const hideDroplet = () => {
    if (dropletShowing && droplet && !droplet.isDestroyed()) {
      droplet.webContents.send("ails-tabs:droplet-motion", { x: 0, y: 0, visible: false })
      droplet.hide()
    }
    dropletShowing = false; dropletPoint = null
  }
  const stop = () => {
    clearInterval(timer); timer = null
    clearPreview(drag)
    if (drag?.kind === "window" && drag.opacity !== 1 && !drag.source.window.isDestroyed()) drag.source.window.setOpacity(1)
    hideDroplet()
    if (drag) send(drag.source, { type: "drag-stopped", dragId: drag.id })
    drag = null
  }
  const poll = (point = cursor()) => {
    const active = drag
    if (!active || active.finishing) return
    if (active.source.window.isDestroyed()) { stop(); return }
    const sourceRect = stripRect(active.source)
    if (!inside(point, sourceRect)) active.floating = true
    let target = null
    // Focus/z-order is retained in the registry; overlays and unrelated windows
    // are never candidates. Whole-window drags cannot dock into themselves.
    for (const entry of [...windows.values()].sort((a, b) => b.focused - a.focused)) {
      if (!entry.ready || !entry.strip || reserved.has(entry.window) || entry.window.isDestroyed() || !entry.window.isVisible() || entry.window.isMinimized()) continue
      if (active.kind === "window" && entry === active.source) continue
      if (inside(point, stripRect(entry))) { target = entry; break }
    }
    if (target !== active.target) { clearPreview(active); active.target = target }
    const sourceBounds = active.source.window.getContentBounds()
    const zoom = active.source.window.webContents.getZoomFactor()
    const local = { x: (point.x - sourceBounds.x) / zoom, y: (point.y - sourceBounds.y) / zoom }
    send(active.source, { type: "drag-position", dragId: active.id, point: local,
      floating: active.floating || (target && target !== active.source), previewing: Boolean(target && (active.floating || target !== active.source)) })
    if (target && (active.floating || target !== active.source || active.kind === "window")) {
      const bounds = target.window.getContentBounds()
      const targetZoom = target.window.webContents.getZoomFactor()
      send(target, { type: "preview", dragId: active.id, preview: active.items,
        own: target === active.source, ids: active.ids, point: { x: (point.x - bounds.x) / targetZoom, y: (point.y - bounds.y) / targetZoom } })
    }
    if (active.kind === "window") {
      const opacity = target ? 0.28 : 1
      if (opacity !== active.opacity) { active.source.window.setOpacity(opacity); active.opacity = opacity }
    }
    if (active.floating && !target && active.kind === "tab") {
      reserve.prepare(point)
      droplet ??= createDroplet()
      if (!droplet.isDestroyed()) {
        const { x, y, width, height } = tabDragDropletBounds(point, droplet.webContents.getZoomFactor())
        if (!dropletPoint || x !== dropletPoint.x || y !== dropletPoint.y || width !== dropletPoint.width || height !== dropletPoint.height) {
          droplet.webContents.send("ails-tabs:droplet-motion", { x: dropletPoint ? x - dropletPoint.x : 0,
            y: dropletPoint ? y - dropletPoint.y : 0, visible: true })
          if (!dropletPoint || dropletPoint.width !== width || dropletPoint.height !== height) droplet.setBounds({ x, y, width, height })
          else droplet.setPosition(x, y)
          dropletPoint = { x, y, width, height }
        }
        if (!dropletShowing) { droplet.showInactive(); dropletShowing = true }
        // Reassert z-order even if another topmost app/menu appeared mid-drag.
        droplet.moveTop()
      }
    } else hideDroplet()
  }
  const begin = (source, descriptor, kind = "tab") => {
    if (!source?.strip || !descriptor || typeof descriptor.id !== "string" || !Array.isArray(descriptor.ids)
      || !descriptor.ids.length || descriptor.ids.length > 512 || !descriptor.ids.every(id => typeof id === "string" && source.items.some(item => item.id === id))) return false
    stop()
    const anchor = descriptor.anchor && [descriptor.anchor.x, descriptor.anchor.y].every(value => Number.isFinite(value) && value >= 0 && value <= 20000)
      ? { x: descriptor.anchor.x, y: descriptor.anchor.y } : { x: 20, y: 14 }
    drag = { id: descriptor.id, ids: [...new Set(descriptor.ids)], items: descriptor.ids.map(id => source.items.find(item => item.id === id)), anchor,
      kind, source, floating: kind === "window", target: null, finishing: false, cancelled: false, opacity: 1 }
    timer = setInterval(poll, 16)
    if (kind === "tab") droplet ??= createDroplet()
    poll()
    return true
  }
  const finish = async (source, id, cancel = false, releasedAt) => {
    const active = drag
    if (!active || active.source !== source || active.id !== id || active.finishing) return false
    if (cancel || active.cancelled) { stop(); return false }
    const point = releasedAt && Number.isFinite(releasedAt.x) && Number.isFinite(releasedAt.y) ? releasedAt : cursor()
    poll(point)
    active.finishing = true
    clearInterval(timer); timer = null
    let created = null
    let opening = null
    try {
      let target = active.target
      if (target === source && !active.floating && active.kind === "tab") { stop(); return true }
      if (!target && active.kind === "window") { stop(); return false }
      if (!target) {
        opening = reserve.claim(point, { anchor: active.anchor, origin: source.strip.tabOrigin })
        created = opening.window
        hideDroplet()
      }
      const payload = await request(source, "collect", { ids: active.ids })
      if (active.cancelled) throw new Error("탭 이동을 취소했습니다.")
      if (!payload?.version || !Array.isArray(payload.ids) || payload.ids.length !== active.ids.length) throw new Error("이동할 탭의 상태를 읽지 못했습니다.")
      let beforeId = null
      if (!target) {
        created = await opening.loaded
        if (!created || created.isDestroyed()) throw opening.error ?? new Error("새 창을 열지 못했습니다.")
        target = windows.get(created.webContents.id)
        await waitForReady(target)
      } else {
        const bounds = target.window.getContentBounds()
        const zoom = target.window.webContents.getZoomFactor()
        beforeId = await request(target, "insertion", { dragId: active.id, ids: active.ids, own: target === source,
          preview: active.items,
          point: { x: (point.x - bounds.x) / zoom, y: (point.y - bounds.y) / zoom } })
      }
      const received = await request(target, "receive", { payload, beforeId, own: target === source, replace: Boolean(created) })
      if (received !== true) throw new Error(typeof received === "string" ? received : "탭을 복원하지 못했습니다.")
      if (opening) {
        reserve.activate(opening)
        send(target, { type: "transfer-ready" })
        publishWindowState()
      }
      // The receiving renderer has painted/restored the tab before its source
      // is removed. A failed load/import leaves the source intact.
      if (target !== source) {
        const removed = await request(source, "remove", { ids: active.ids, payload })
        if (removed?.empty && source.auxiliary) source.window.close()
      }
      target.window.show(); target.window.focus()
      stop()
      return true
    } catch (error) {
      if (created && !created.isDestroyed()) created.close()
      send(source, { type: "error", message: error.message })
      stop()
      return false
    }
  }
  ipcMain.handle("ails-tabs:strip", (event, strip, items) => {
    const entry = entryFor(event)
    if (!entry || !strip || ![strip.x, strip.y, strip.width, strip.height].every(Number.isFinite)
      || strip.width < 0 || strip.height <= 0 || strip.height > 120 || !Array.isArray(items) || items.length > 512) return false
    entry.strip = strip
    if (strip.tabOrigin && ![strip.tabOrigin.x, strip.tabOrigin.y].every(Number.isFinite)) delete entry.strip.tabOrigin
    entry.items = items.filter(item => item && typeof item.id === "string" && typeof item.title === "string")
      .map(({ id, title, kind }) => ({ id, title: title.slice(0, 2048), kind: String(kind || "md") }))
    return true
  })
  ipcMain.handle("ails-tabs:ready", event => {
    const entry = entryFor(event); if (!entry) return false
    entry.ready = true
    for (const done of entry.readyWaiters) done()
    if (!reserved.has(entry.window)) send(entry, { type: "transfer-ready" })
    publishWindowState(); return true
  })
  ipcMain.handle("ails-tabs:window-state", event => entryFor(event) ? windowState() : { count: 0, canCloseLastTab: false })
  ipcMain.handle("ails-tabs:close-last", (event, id) => {
    const entry = entryFor(event)
    if (!entry || typeof id !== "string" || closingLastTab.has(entry.window)) return false
    const tabs = entry.items.filter(item => item.kind !== "split-picker")
    if (tabs.length !== 1 || tabs[0].id !== id || !workspaceWindows().some(other => other !== entry)) return false
    closingLastTab.add(entry.window)
    // Mark it before close so two simultaneous requests cannot close every window.
    entry.window.once("close", closeEvent => {
      queueMicrotask(() => {
        if (closeEvent.defaultPrevented) { closingLastTab.delete(entry.window); publishWindowState() }
      })
    })
    entry.window.close()
    publishWindowState()
    return true
  })
  ipcMain.handle("ails-tabs:begin", (event, descriptor) => begin(entryFor(event), descriptor))
  ipcMain.handle("ails-tabs:finish", (event, id, cancel, point) => finish(entryFor(event), id, cancel === true, point))
  ipcMain.on("ails-tabs:reply", (event, requestId, value, error) => {
    const pending = requests.get(requestId)
    if (!entryFor(event) || !pending || pending.sender !== event.sender.id) return
    requests.delete(requestId); clearTimeout(pending.timeout)
    if (error) pending.reject(new Error(String(error))); else pending.resolve(value)
  })
  return {
    register(window, auxiliary = false) {
      const senderId = window.webContents.id
      const entry = { window, auxiliary, ready: false, readyWaiters: new Set(), strip: null, items: [], focused: Date.now() }
      windows.set(senderId, entry)
      for (const event of ["show", "hide", "minimize", "restore"]) window.on(event, publishWindowState)
      window.on("focus", () => { entry.focused = Date.now() })
      window.webContents.on("before-input-event", (_event, input) => {
        if (drag?.source === entry && input.type === "keyDown" && input.key === "Escape") drag.cancelled = true
      })
      window.on("closed", () => {
        windows.delete(senderId)
        for (const done of entry.readyWaiters) done(new Error("새 창이 닫혔습니다."))
        publishWindowState()
        if (drag?.source === entry) stop()
        else if (drag?.target === entry) drag.target = null
        for (const [id, pending] of requests) if (pending.sender === senderId) {
          clearTimeout(pending.timeout); requests.delete(id); pending.reject(new Error("대상 창이 닫혔습니다."))
        }
        // A hidden cursor overlay must not keep Electron/backend alive after
        // every workspace window has closed.
        if (![...windows.values()].some(other => !reserved.has(other.window))) {
          reserve.dispose()
          stop()
          if (droplet && !droplet.isDestroyed()) droplet.destroy()
          droplet = null; dropletPoint = null
        }
      })
      if (auxiliary && process.platform === "win32") {
        let moving = false
        window.hookWindowMessage(0x0231, () => { moving = false }) // WM_ENTERSIZEMOVE
        window.on("will-move", () => {
          if (!moving && !drag && entry.items.length) { moving = begin(entry, { id: randomUUID(), ids: entry.items.map(item => item.id) }, "window") }
          if (moving && drag?.source === entry) poll()
        })
        window.on("moved", () => { if (moving && drag?.source === entry) { void finish(entry, drag.id); moving = false } })
        window.hookWindowMessage(0x0232, () => { // WM_EXITSIZEMOVE also covers release without another move event.
          if (moving && drag?.source === entry) void finish(entry, drag.id)
          moving = false
        })
      }
    },
    isRegisteredWorkspaceWindow: window => Boolean(window && !window.isDestroyed() && windows.has(window.webContents.id) && !reserved.has(window)),
    isWorkspaceWindow: window => Boolean(window && !window.isDestroyed() && windows.get(window.webContents.id)?.ready && !reserved.has(window)),
    isAuxiliary: window => Boolean(window && !window.isDestroyed() && windows.get(window.webContents.id)?.auxiliary),
    isClosingLastTab: window => Boolean(window && closingLastTab.has(window)),
    getWorkspaceWindow: () => workspaceWindows()[0]?.window ?? null,
    dispose() { stop(); reserve.dispose(); if (droplet && !droplet.isDestroyed()) droplet.destroy() },
  }
}

module.exports = { createWorkspaceTabTransfer }
