const fs = require("node:fs")
const path = require("node:path")
const { randomUUID } = require("node:crypto")

const EXTENSIONS = new Set(["md", "txt", "pdf", "ipynb", "ppt", "pptx", "docx", "xlsx", "csv", "hwp", "hwpx", "html", "htm", "epub", "mobi", "azw", "azw3", "fb2", "rtf"])

function documentPaths(argv, cwd, packaged = true) {
  const paths = new Map()
  for (const value of argv.slice(packaged ? 1 : 2)) {
    if (typeof value !== "string" || !value || value.startsWith("-") || value.includes("\0")) continue
    if (!EXTENSIONS.has(path.extname(value).slice(1).toLowerCase())) continue
    try {
      const file = fs.realpathSync(path.resolve(cwd, value))
      if (fs.statSync(file).isFile() && EXTENSIONS.has(path.extname(file).slice(1).toLowerCase())) paths.set(file.toLowerCase(), file)
    } catch { /* Missing files and non-file launch arguments are not documents. */ }
  }
  return [...paths.values()]
}

// Persist only OS-selected files, never their parent directory. The backend
// reads this allowlist so opening a document does not broaden workspace access.
function createExternalDocuments({ grantsPath, getWindow, getSenderWindow = getWindow, isTrusted, ipcMain }) {
  const pending = []
  const initialExtension = () => path.extname(pending[0]?.path || '').slice(1).toLowerCase()
  const ready = new WeakSet()
  const watching = new WeakSet()
  let delivery = null
  function flush() {
    const window = getWindow()
    if (!window || window.isDestroyed() || !ready.has(window) || delivery || !pending.length) return
    delivery = { window, item: pending[0] }
    window.webContents.send("ails-documents:open", delivery.item)
  }
  function grant(paths) {
    if (!paths.length) return
    let grants = []
    try { grants = JSON.parse(fs.readFileSync(grantsPath, "utf8")) } catch { /* First launch. */ }
    if (!Array.isArray(grants)) grants = []
    const merged = new Map(grants.filter(value => typeof value === "string").map(value => [value.toLowerCase(), value]))
    for (const file of paths) merged.set(file.toLowerCase(), file)
    fs.mkdirSync(path.dirname(grantsPath), { recursive: true })
    const temporary = `${grantsPath}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify([...merged.values()]), "utf8")
      fs.renameSync(temporary, grantsPath)
    } finally { fs.rmSync(temporary, { force: true }) }
  }
  function enqueue(paths, intents = {}) {
    grant(paths)
    for (const file of paths) {
      const existing = pending.find(item => item.path.toLowerCase() === file.toLowerCase())
      if (existing && intents[file]) existing.intent = intents[file]
      else if (!existing) pending.push({ id: randomUUID(), path: file, intent: intents[file] })
    }
    flush()
  }
  ipcMain.on("ails-documents:pending", event => {
    const window = getSenderWindow(event)
    event.returnValue = Boolean(window && window === getWindow() && isTrusted(event, window) && pending.length)
  })
  ipcMain.on("ails-documents:initial-extension", event => {
    const window = getSenderWindow(event)
    event.returnValue = window && window === getWindow() && isTrusted(event, window) && pending.length
      ? initialExtension() : ""
  })
  ipcMain.on("ails-documents:initial-path", event => {
    const window = getSenderWindow(event)
    event.returnValue = window && window === getWindow() && isTrusted(event, window) && pending.length
      ? pending[0].path : ""
  })
  ipcMain.handle("ails-documents:ready", event => {
    const window = getSenderWindow(event)
    if (!window || !isTrusted(event, window)) return false
    ready.add(window)
    if (!watching.has(window)) {
      watching.add(window)
      const reset = () => {
        ready.delete(window)
        if (delivery?.window === window) delivery = null
        queueMicrotask(flush)
      }
      window.webContents.on("did-start-loading", reset)
      window.on("closed", reset)
    }
    flush()
    return true
  })
  ipcMain.handle("ails-documents:ack", (event, id) => {
    if (!delivery || !isTrusted(event, delivery.window) || delivery.item.id !== id) return false
    pending.shift()
    delivery = null
    flush()
    return true
  })
  return { grant, enqueue, flush, initialExtension, pause: () => { const window = getWindow(); if (window) ready.delete(window); delivery = null } }
}

module.exports = { EXTENSIONS, documentPaths, createExternalDocuments }
