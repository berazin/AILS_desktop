const path = require("node:path")
const { randomUUID } = require("node:crypto")

function workspaceWindowBounds(screen, point, tabWindow = false) {
  const area = (point ? screen.getDisplayNearestPoint(point) : screen.getPrimaryDisplay()).workArea
  const width = Math.min(1280, Math.max(tabWindow ? 720 : 800, Math.round(area.width * (tabWindow ? 0.6 : 0.55))))
  const height = Math.min(960, Math.max(tabWindow ? 480 : 600, Math.round(area.height * 0.85)))
  return { width, height, ...(point ? {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, point.x - 100))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, point.y - 16))),
  } : {}) }
}

async function createAuxiliaryWorkspaceWindow({ BrowserWindow, screen, shell, baseUrl, preload, icon, port, token,
  installCsp, installMedia, register, normalizeExternalUrl, isSameOriginUrl, targetPath = "", point, tabWindow = false, onCreated }) {
  const url = new URL(baseUrl)
  url.searchParams.delete("openMaterial")
  if (targetPath) url.searchParams.set("openMaterial", String(targetPath))
  url.searchParams.set("windowMode", tabWindow ? "workspace-tab" : "split")
  url.searchParams.delete("tabTransferPending")
  if (tabWindow) url.searchParams.set("tabTransferPending", "1")
  url.searchParams.set("workspaceWindowId", randomUUID())
  const window = new BrowserWindow({ ...workspaceWindowBounds(screen, point, tabWindow),
    minWidth: 720, minHeight: 480, title: targetPath ? `${path.basename(targetPath)} - AILS` : "AILS",
    frame: false, thickFrame: true, resizable: true, show: false, backgroundColor: "#f7f9fc", icon,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, spellcheck: false } })
  installCsp(window.webContents, baseUrl, port)
  installMedia(window.webContents, baseUrl, port, token)
  register(window, true)
  window.on("maximize", () => window.webContents.send("ails-window:maximize-change", true))
  window.on("unmaximize", () => window.webContents.send("ails-window:maximize-change", false))
  window.webContents.setWindowOpenHandler(({ url: external }) => {
    if (external.startsWith("blob:")) return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { spellcheck: false } } }
    try { void shell.openExternal(normalizeExternalUrl(external)) } catch { /* Unsupported protocols stay inside the permission boundary. */ }
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, target) => {
    if (isSameOriginUrl(target, baseUrl)) return
    event.preventDefault()
    try { void shell.openExternal(normalizeExternalUrl(target)) } catch { /* Unsupported external navigation. */ }
  })
  try { onCreated?.(window); await window.loadURL(url.toString()); return window }
  catch (error) { window.destroy(); throw error }
}
module.exports = { createAuxiliaryWorkspaceWindow, workspaceWindowBounds }
