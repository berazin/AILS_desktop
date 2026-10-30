const FORMAT = "application/x-ails-workspace-files"

function validClipboard(value) {
  return value && value.version === 1 && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
    && ["copy", "cut"].includes(value.mode) && typeof value.root === "string" && value.root.length > 0 && value.root.length <= 32768 && !value.root.includes("\0")
    && Array.isArray(value.paths) && value.paths.length > 0 && value.paths.length <= 10000
    && value.paths.every(path => typeof path === "string" && path.length > 0 && path.length <= 32768 && !path.includes("\0"))
}

function registerWorkspaceClipboard({ ipcMain, clipboard, BrowserWindow, isTrusted }) {
  const authorize = event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !isTrusted(event, window)) throw new Error("Only an AILS workspace can use the file clipboard.")
  }
  const read = () => {
    try {
      const buffer = clipboard.readBuffer(FORMAT)
      if (!buffer.length || buffer.length > 4 * 1024 * 1024) return null
      const value = JSON.parse(buffer.toString("utf8"))
      return validClipboard(value) ? value : null
    } catch { return null }
  }
  const broadcast = value => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed?.()) continue
      try {
        if (isTrusted({ senderFrame: window.webContents.mainFrame }, window)) window.webContents.send("ails-workspace:clipboard-changed", value)
      } catch { /* A closing window must not fail a completed clipboard write. */ }
    }
  }
  ipcMain.handle("ails-workspace:read-clipboard", event => { authorize(event); return read() })
  ipcMain.handle("ails-workspace:write-clipboard", (event, value, expectedId) => {
    authorize(event)
    if (!validClipboard(value)) throw new Error("Invalid workspace clipboard.")
    if (expectedId !== undefined && read()?.id !== expectedId) return false
    const buffer = Buffer.from(JSON.stringify(value), "utf8")
    if (buffer.length > 4 * 1024 * 1024) throw new Error("Workspace clipboard is too large.")
    clipboard.writeBuffer(FORMAT, buffer)
    broadcast(value)
    return true
  })
  ipcMain.handle("ails-workspace:clear-clipboard", (event, expectedId) => {
    authorize(event)
    if (!expectedId || read()?.id !== expectedId) return false
    clipboard.clear()
    broadcast(null)
    return true
  })
}

module.exports = { registerWorkspaceClipboard, FORMAT, validClipboard }
