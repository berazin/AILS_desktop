const fs = require('node:fs/promises')
const path = require('node:path')

// A failed cutover may relaunch the intact old app. Do not silently attempt the
// same installer again on every launch; a newer version or explicit retry can run.
async function findFailedUpdate(app, version, executablePath = process.execPath) {
  if (typeof app.getPath !== 'function') return null
  const root = path.join(app.getPath('userData'), 'update-sessions')
  let entries
  try { entries = await fs.readdir(root, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue
    const directory = path.join(root, entry.name)
    try {
      const request = JSON.parse(await fs.readFile(path.join(directory, 'request.json'), 'utf8'))
      const status = JSON.parse((await fs.readFile(path.join(directory, 'status.json'), 'utf8')).replace(/^\uFEFF/, ''))
      if (request.id !== entry.name || status.id !== entry.name || request.protocol !== 1 || status.protocol !== 1
          || request.expectedVersion !== version || status.state !== 'error'
          || typeof request.executablePath !== 'string'
          || request.executablePath.toLowerCase() !== executablePath.toLowerCase()) continue
      return { version, error: String(status.error || 'Update installation failed.') }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
  }
  return null
}

module.exports = { findFailedUpdate }
