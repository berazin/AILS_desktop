const net = require('node:net')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { currentFrontendBuild } = require('./frontend-build.cjs')
const { createBackendHost } = require('./backend-host.cjs')

async function findPort(start) {
  for (let port = start; port <= 65535; port++) {
    const available = await new Promise((resolve, reject) => {
      const server = net.createServer()
      server.once('error', error => error.code === 'EADDRINUSE' || error.code === 'EACCES' ? resolve(false) : reject(error))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (available) return port
  }
  throw new Error('No available local port')
}

async function waitForVite(child, port, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child.ailsSpawnError) throw child.ailsSpawnError
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Vite exited before readiness')
    if (child.ailsListening === false) {
      await new Promise(resolve => setTimeout(resolve, 50))
      continue
    }
    const ready = await new Promise(resolve => {
      const request = http.get(`http://127.0.0.1:${port}/`, response => {
        response.resume()
        resolve(response.statusCode === 200)
      })
      request.setTimeout(1000, () => request.destroy())
      request.once('error', () => resolve(false))
    })
    if (ready && child.exitCode === null && child.signalCode === null) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Vite did not become ready within 30 seconds')
}

async function launchDesktop({ root, frontend, electronExecutable, backendHost }) {
  const builtFrontend = currentFrontendBuild(root)
  const [frontendPort, apiPort] = await Promise.all([findPort(5173), findPort(8765)])
  const env = { ...process.env, AILS_EDITION: 'developer', AILS_PORT: String(apiPort), VITE_AILS_API_BASE: `http://127.0.0.1:${apiPort}/api`, AILS_ELECTRON_DEV_URL: `http://127.0.0.1:${frontendPort}` }
  if (builtFrontend) {
    env.AILS_FRONTEND_OUT_DIR = builtFrontend
    delete env.AILS_ELECTRON_DEV_URL
    delete env.VITE_AILS_API_BASE
    console.log('[AILS] Starting with the current built frontend.')
  }
  let vite, readiness
  const startVite = () => {
    if (readiness) return readiness
    vite = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--mode', 'developer', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: frontend, env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
    vite.ailsListening = false
    let output = ''
    vite.stdout.on('data', chunk => {
      process.stdout.write(chunk)
      output = (output + String(chunk)).slice(-8192)
      if (output.replace(/\x1b\[[0-9;]*m/g, '').includes(`http://127.0.0.1:${frontendPort}/`)) vite.ailsListening = true
    })
    vite.once('error', error => { vite.ailsSpawnError = error })
    readiness = waitForVite(vite, frontendPort).then(() => {
      if (electron.connected) electron.send({ type: 'ails-dev-server-ready' }, () => {})
    }).catch(error => {
      if (electron.connected) electron.send({ type: 'ails-dev-server-error', message: error.message }, () => {})
    })
    return readiness
  }
  let electron
  let exited
  const stopElectron = () => { if (electron?.connected) electron.send({ type: 'ails-dev-launcher-stop' }, () => {}) }
  process.once('SIGINT', stopElectron)
  process.once('SIGTERM', stopElectron)
  try {
    // Prepare the real workspace in parallel with Electron, including external
    // file launches. A second invocation leaves this work to the existing app.
    delete env.ELECTRON_RUN_AS_NODE
    env.AILS_DEV_LAUNCHER = builtFrontend ? 'built' : '1'
    env.AILS_DEV_BACKEND = '1'
    electron = spawn(electronExecutable, ['.', ...process.argv.slice(2)], { cwd: frontend, env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: false })
    backendHost.attach(electron)
    exited = new Promise((resolve, reject) => {
      electron.once('error', reject)
      electron.once('exit', code => resolve(code ?? 1))
    })
    electron.on('message', message => { if (message?.type === 'ails-dev-server-start') void startVite() })
    process.exitCode = await exited
  } finally {
    process.off('SIGINT', stopElectron)
    process.off('SIGTERM', stopElectron)
    vite?.kill()
    if (electron?.exitCode === null && !electron.killed) {
      stopElectron()
      let timeout
      await Promise.race([exited.catch(() => {}), new Promise(resolve => { timeout = setTimeout(resolve, 3000) })])
      clearTimeout(timeout)
      if (electron.exitCode === null && electron.pid) {
        // An unresponsive Electron must not leave its Python child behind.
        if (process.platform === 'win32') await new Promise(resolve => {
          const killer = spawn('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          killer.once('error', resolve); killer.once('exit', resolve)
        })
        else electron.kill()
      }
    }
  }
}

async function launch() {
  const root = path.resolve(__dirname, '../..'), frontend = path.join(root, 'ails-frontend')
  const electronExecutable = path.join(frontend, 'node_modules/electron/dist/electron.exe')
  const backendHost = createBackendHost({ root, env: process.env, electronExecutable })
  try { await launchDesktop({ root, frontend, electronExecutable, backendHost }) }
  finally { await backendHost.close() }
}

module.exports = { findPort, waitForVite }
if (require.main === module) launch().catch(error => { console.error(error.message); process.exitCode = 1 })
