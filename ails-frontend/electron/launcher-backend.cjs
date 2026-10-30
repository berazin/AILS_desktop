const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { randomUUID } = require('node:crypto')

/** Main-process handle for the backend owned by the development launcher.
 * Uses only the inherited Node IPC channel; it exposes no renderer IPC route. */
function createLauncherBackend({ args, env, parent = process }) {
  const child = new EventEmitter(), id = randomUUID()
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  child.exitCode = null; child.signalCode = null
  let stopping = false, ended = false, resolveClosed
  const closed = new Promise(resolve => { resolveClosed = resolve })
  const finish = (code, signal = null) => {
    if (ended) return
    ended = true; child.exitCode = code ?? 1; child.signalCode = signal
    parent.off('message', onMessage); parent.off('disconnect', onDisconnect)
    child.stdout.end(); child.stderr.end()
    child.emit('exit', child.exitCode, signal)
    resolveClosed()
  }
  const onDisconnect = () => {
    if (!stopping) child.emit('error', new Error('The development launcher disconnected.'))
    finish(1)
  }
  const send = message => {
    if (!parent.connected) { onDisconnect(); return }
    parent.send({ type: 'ails-dev-backend', id, ...message }, error => { if (error && !ended) onDisconnect() })
  }
  const onMessage = message => {
    if (ended || message?.type !== 'ails-dev-backend-event' || message.id !== id) return
    if (message.event === 'spawn') child.pid = message.pid
    else if (message.event === 'stdout' || message.event === 'stderr') child[message.event].write(message.data)
    else if (message.event === 'error') child.emit('error', new Error(message.message))
    else if (message.event === 'exit') finish(message.code, message.signal)
  }
  parent.on('message', onMessage); parent.once('disconnect', onDisconnect)
  child.closeBackend = () => {
    if (!stopping && !ended) { stopping = true; send({ action: 'stop' }) }
    return closed
  }
  // Give the caller time to attach output/error handlers before IPC can reply.
  queueMicrotask(() => {
    if (ended || stopping) return
    send({ action: 'start', args, environment: Object.fromEntries(
      ['AILS_LOCAL_API_TOKEN', 'AILS_UI_ORIGIN', 'AILS_EXTERNAL_DOCUMENTS'].map(key => [key, env[key] || ''])) })
  })
  return child
}

module.exports = { createLauncherBackend }
