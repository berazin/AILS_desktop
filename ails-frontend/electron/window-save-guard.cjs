const { randomUUID } = require("node:crypto")

// The renderer owns drafts; keep it and the backend alive until its writes finish.
function createWindowSaveGuard({ app, ipcMain, isTrusted, onError, timeoutMs = 30000 }) {
  const windows = new Map(), requests = new Map(), closing = new WeakSet()
  let quitApproved = false, quitPending = false
  const trusted = event => {
    const entry = windows.get(event.sender.id)
    return entry && !entry.window.isDestroyed() && isTrusted(event, entry.window) ? entry : null
  }
  ipcMain.on("ails-window:save-register", (event, ready) => {
    const entry = trusted(event)
    if (entry) entry.ready = ready === true
  })
  ipcMain.on("ails-window:save-result", (event, id, error) => {
    const entry = trusted(event), pending = requests.get(id)
    if (!entry || !pending || pending.sender !== event.sender.id) return
    pending.finish(error ? new Error(String(error)) : null)
  })
  function flush(entry) {
    if (entry.pending) return entry.pending
    if (!entry.ready || entry.window.isDestroyed()) return Promise.resolve()
    const id = randomUUID()
    entry.pending = new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("저장 응답을 기다리는 시간이 초과되었습니다. 다시 종료해 주세요.")), timeoutMs)
      const finish = error => {
        clearTimeout(timer); requests.delete(id)
        if (error) reject(error); else resolve()
      }
      requests.set(id, { sender: entry.window.webContents.id, finish })
      entry.window.webContents.send("ails-window:save-request", id)
    }).finally(() => { entry.pending = null })
    return entry.pending
  }
  function cancel(entry, error) {
    for (const item of windows.values()) {
      if (!item.window.isDestroyed()) item.window.webContents.send("ails-window:save-cancelled")
    }
    onError(entry?.window, error)
  }
  app.on("before-quit", event => {
    if (quitApproved || ![...windows.values()].some(entry => entry.ready)) return
    event.preventDefault()
    if (quitPending) return
    quitPending = true
    const entries = [...windows.values()]
    // Wait for every renderer, including inactive notebook tabs in other windows.
    void Promise.allSettled(entries.map(flush)).then(results => {
      quitPending = false
      const failed = results.findIndex(result => result.status === "rejected")
      if (failed >= 0) { cancel(entries[failed], results[failed].reason); return }
      quitApproved = true
      app.quit()
    })
  })
  return {
    isClosing: window => closing.has(window),
    register(window) {
      const sender = window.webContents.id
      const entry = { window, ready: false, pending: null }
      windows.set(sender, entry)
      window.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) entry.ready = false
      })
      window.on("close", event => {
        if (quitApproved || closing.has(window) || event.defaultPrevented || !entry.ready) return
        event.preventDefault()
        if (entry.closing) return
        entry.closing = true
        void flush(entry).then(() => {
          if (!window.isDestroyed()) { closing.add(window); window.close(); closing.delete(window) }
        }).catch(error => cancel(entry, error)).finally(() => { entry.closing = false })
      })
      window.on("closed", () => {
        windows.delete(sender)
        for (const pending of requests.values()) {
          if (pending.sender === sender) pending.finish(new Error("저장 확인 전에 창이 종료되었습니다."))
        }
      })
    },
  }
}
module.exports = { createWindowSaveGuard }
