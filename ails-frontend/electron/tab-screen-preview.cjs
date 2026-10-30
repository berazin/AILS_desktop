function registerTabScreenPreview({ ipcMain, BrowserWindow, isTrusted }) {
  const capturing = new WeakSet()
  ipcMain.handle("ails-tabs:capture-screen", async (event, rect) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || !isTrusted(event, window) || !window.isVisible() || window.isMinimized()
      || capturing.has(window) || !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) return null
    const bounds = window.getContentBounds()
    const zoom = window.webContents.getZoomFactor()
    // capturePage rectangles use window DIP; callers measure in CSS pixels.
    const x = Math.round(rect.x * zoom), y = Math.round(rect.y * zoom)
    const width = Math.min(Math.round(rect.width * zoom), bounds.width - x)
    const height = Math.min(Math.round(rect.height * zoom), bounds.height - y)
    if (width <= 0 || height <= 0) return null
    capturing.add(window)
    try {
      const image = await window.webContents.capturePage({ x, y, width, height }, { stayHidden: true, stayAwake: false })
      if (window.isDestroyed() || image.isEmpty()) return null
      const size = image.getSize(), scale = Math.min(1, 360 / size.width, 220 / size.height)
      const thumbnail = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "good" })
      const jpeg = thumbnail.toJPEG(70)
      if (jpeg.length > 256000) return null
      return { dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`, ...thumbnail.getSize() }
    } catch { return null }
    finally { capturing.delete(window) }
  })
}
module.exports = { registerTabScreenPreview }
