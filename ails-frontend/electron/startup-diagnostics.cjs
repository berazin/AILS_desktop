const fs = require('node:fs')
const path = require('node:path')
const { EXTENSIONS } = require('./external-documents.cjs')
const phases = {}

function markStartupPhase(name, timestamp = Date.now()) {
  if (process.env.AILS_STARTUP_DIAGNOSTICS && phases[name] === undefined) phases[name] = timestamp
}

/** Opt-in local timings, with no document names or user content in the record. */
function registerStartupDiagnostics({ ipcMain, BrowserWindow, isTrusted }) {
  const output = process.env.AILS_STARTUP_DIAGNOSTICS
  if (!output || !path.isAbsolute(output)) return
  let recorded = false
  ipcMain.handle('ails-startup:document-presented', async (event, kind) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !window.isVisible() || !isTrusted(event, window)
        || typeof kind !== 'string' || !EXTENSIONS.has(kind)) return false
    if (recorded) return true
    recorded = true
    const result = { pid: process.pid, kind, presentedAt: Date.now(), phases: { ...phases } }
    try {
      // Read timings only after recording presentation. Strip queries so local
      // file names and authentication values never enter the diagnostic record.
      result.renderer = await window.webContents.executeJavaScript(`({
        timeOrigin: performance.timeOrigin,
        marks: performance.getEntriesByType('mark').filter(e => e.name.startsWith('ails:')).map(e => ({ name: e.name, start: e.startTime })),
        navigation: performance.getEntriesByType('navigation').map(e => ({ start: e.startTime, responseEnd: e.responseEnd, domInteractive: e.domInteractive, loadEnd: e.loadEventEnd })),
        resources: performance.getEntriesByType('resource').slice(0, 512).map(e => ({ path: new URL(e.name).pathname, start: e.startTime, requestStart: e.requestStart, responseStart: e.responseStart, end: e.responseEnd, duration: e.duration }))
      })`)
    } catch { /* A closing window may no longer provide renderer timings. */ }
    try {
      fs.mkdirSync(path.dirname(output), { recursive: true })
      fs.writeFileSync(`${output}.tmp`, JSON.stringify(result), 'utf8')
      fs.renameSync(`${output}.tmp`, output)
    } catch (error) { console.warn('[AILS startup diagnostics]', error.message) }
    return true
  })
}

module.exports = { registerStartupDiagnostics, markStartupPhase }
