const path = require("node:path")

// SVG/CSS pixels are converted with this renderer's zoom; screen points and
// BrowserWindow bounds are already Windows device-independent pixels.
function tabDragDropletBounds(point, zoom = 1) {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return { x: Math.round(point.x - 30 * scale), y: Math.round(point.y - 30 * scale),
    width: Math.round(72 * scale), height: Math.round(72 * scale) }
}

function createTabDragDroplet(BrowserWindow, baseUrl) {
  const window = new BrowserWindow({ width: 72, height: 72, frame: false, transparent: true, show: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, resizable: false, hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "tab-drag-droplet-preload.cjs"), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } })
  window.setIgnoreMouseEvents(true)
  // The default floating level is below the Windows taskbar. Keep the cursor
  // visual above app chrome, menus and other topmost windows without focus.
  window.setAlwaysOnTop(true, "screen-saver")
  const url = new URL(baseUrl)
  url.searchParams.delete("openMaterial")
  url.searchParams.set("windowMode", "tab-drag-droplet")
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", event => event.preventDefault())
  void window.loadURL(url.toString())
  return window
}
module.exports = { createTabDragDroplet, tabDragDropletBounds }
