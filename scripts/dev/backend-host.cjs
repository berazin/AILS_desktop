const path = require('node:path')
const { spawn } = require('node:child_process')
const { pythonPath } = require('../../ails-frontend/electron/backend-command.cjs')
const { closeBackend } = require('../../ails-frontend/electron/backend-lifetime.cjs')

/** The development launcher owns the child from preload through final exit.
 * Importing Python overlaps Electron startup; no server/state starts until the
 * single-instance Electron owner supplies its authenticated startup settings. */
function createBackendHost({ root, env, electronExecutable, spawnProcess = spawn }) {
  let desktop, current, closing, closed = false, operation = Promise.resolve()
  const children = new Set()
  const send = (id, event, data = {}) => {
    if (id && desktop?.connected) desktop.send({ type: 'ails-dev-backend-event', id, event, ...data }, () => {})
  }
  function preload() {
    const child = spawnProcess(pythonPath(root, env), [path.join(root, 'ails-backend/api_server.py'), '--desktop-bootstrap'], {
      cwd: root, env: { ...env, AILS_EDITION: 'developer', AILS_ELECTRON: '1', AILS_ELECTRON_NODE_EXE: electronExecutable,
        AILS_PARENT_PIPE: '1', PYTHONIOENCODING: 'utf-8' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const entry = { child, id: null, output: [], size: 0, failure: null, ended: false, code: null, signal: null }
    children.add(entry)
    for (const name of ['stdout', 'stderr']) child[name]?.setEncoding('utf8').on('data', chunk => {
      const data = chunk.toString()
      if (entry.id) send(entry.id, name, { data })
      else {
        entry.output.push({ name, data }); entry.size += data.length
        while (entry.size > 65536 && entry.output.length) entry.size -= entry.output.shift().data.length
      }
    })
    const failed = error => { entry.failure = error.message; send(entry.id, 'error', { message: error.message }) }
    child.once('error', failed)
    child.stdin?.on('error', failed)
    child.once('exit', (code, signal) => {
      entry.ended = true; entry.code = code; entry.signal = signal
      send(entry.id, 'exit', { code, signal })
      children.delete(entry)
    })
    return entry
  }
  async function handle(message) {
    if (closed || message?.type !== 'ails-dev-backend' || typeof message.id !== 'string') return
    if (message.action === 'start') {
      // Retries cannot overlap a previous server's shutdown.
      if (current.id) { await closeBackend(current.child); if (closed) return; current = preload() }
      current.id = message.id
      const entry = current
      send(entry.id, 'spawn', { pid: entry.child.pid })
      for (const output of entry.output) send(entry.id, output.name, { data: output.data })
      entry.output = []; entry.size = 0
      if (entry.failure) send(entry.id, 'error', { message: entry.failure })
      if (entry.ended) send(entry.id, 'exit', { code: entry.code, signal: entry.signal })
      else if (entry.child.pid && !entry.child.stdin.destroyed) {
        entry.child.stdin.write(JSON.stringify({ args: message.args, environment: message.environment }) + '\n')
      }
    } else if (message.action === 'stop') {
      const entry = [...children].find(value => value.id === message.id) ?? (current.id === null ? current : null)
      if (entry && entry.id === null) entry.id = message.id
      if (entry) await closeBackend(entry.child)
      send(message.id, 'exit', { code: entry?.child.exitCode ?? 0, signal: entry?.child.signalCode ?? null })
    }
  }
  const onMessage = message => {
    operation = operation.then(() => handle(message)).catch(error => send(message?.id, 'error', { message: error.message }))
  }
  current = preload()
  return {
    attach(child) { desktop = child; desktop.on('message', onMessage) },
    close() {
      if (closing) return closing
      closed = true
      desktop?.off('message', onMessage)
      closing = (async () => {
        await operation
        await Promise.all([...children].map(entry => closeBackend(entry.child)))
        children.clear()
      })()
      return closing
    },
  }
}

module.exports = { createBackendHost }
