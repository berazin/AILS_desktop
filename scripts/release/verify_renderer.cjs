// Launch the actual packaged app with isolated user data and inspect its renderer.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function main() {
  const output = path.resolve(process.argv[2])
  const work = path.resolve(__dirname, '../../build', `renderer-qa-${Date.now()}`)
  fs.mkdirSync(work, { recursive: true })
  const debugPort = await freePort()
  const backendPort = await freePort()
  const log = fs.openSync(path.join(work, 'electron.log'), 'w')
  const env = { ...process.env, AILS_ELECTRON_USER_DATA_DIR: path.join(work, 'user-data'),
    AILS_RUNTIME_DATA_DIR: path.join(work, 'runtime'), AILS_PORT: String(backendPort),
    APPDATA: path.join(work, 'app-data'), LOCALAPPDATA: path.join(work, 'local-app-data') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.AILS_ELECTRON_DEV_URL
  delete env.AILS_FRONTEND_OUT_DIR
  const app = spawn(path.join(output, 'win-unpacked/AILS.exe'),
    [`--remote-debugging-port=${debugPort}`], { env, windowsHide: true, stdio: ['ignore', log, log] })
  let ws
  let seq = 0
  const pending = new Map()
  try {
    let target
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      assert.equal(app.exitCode, null, 'Packaged Electron exited before readiness')
      try {
        const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
        target = pages.find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:'))
        if (target) break
      } catch {}
      await delay(1000)
    }
    assert.ok(target, 'Packaged renderer did not open')
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    ws.onmessage = event => {
      const data = JSON.parse(event.data)
      if (pending.has(data.id)) {
        const { resolve, reject, timer } = pending.get(data.id)
        pending.delete(data.id)
        clearTimeout(timer)
        data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result)
      }
    }
    function command(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
        pending.set(id, { resolve, reject, timer })
        ws.send(JSON.stringify({ id, method, params }))
      })
    }
    let result
    while (Date.now() < deadline) {
      const response = await command('Runtime.evaluate', {
        expression: `(async () => {
          const api = window.ailsDesktop?.api;
          if (!api || !document.querySelector('#root')?.textContent?.trim()) return null;
          const health = await fetch('/api/health', { headers: { 'X-AILS-Token': api.localApiToken } }).then(r => r.json());
          return { title: document.title, bodyLength: document.body.innerText.length,
            workspaceLoading: document.body.innerText.includes('자료 목록을 준비 중입니다'), bridge: true, health,
            environment: await api.get_feedback_environment() };
        })()`, awaitPromise: true, returnByValue: true,
      })
      result = response.result?.value
      if (result?.health?.ok && result.bodyLength > 30 && !result.workspaceLoading) break
      await delay(1000)
    }
    assert.ok(result?.health?.ok && result.bridge && result.bodyLength > 30, 'Renderer/bridge/backend smoke failed')
    assert.equal(result.workspaceLoading, false, 'Workspace remained in its startup loading state')
    const expectedVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../ails-frontend/package.json'), 'utf8')).version
    assert.equal(result.environment.app.version, expectedVersion)
    assert.equal(result.environment.app.packaged, true)
    const screenshot = await command('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(work, 'renderer.png'), Buffer.from(screenshot.data, 'base64'))
    fs.writeFileSync(path.join(output, 'renderer-verification.json'), JSON.stringify({ ...result, screenshot: path.join(work, 'renderer.png') }, null, 2))
    console.log(JSON.stringify(result, null, 2))
    await command('Runtime.evaluate', { expression: 'window.ailsDesktop.api.quit()' }).catch(() => {})
    await Promise.race([new Promise(resolve => app.once('exit', resolve)), delay(10000)])
  } finally {
    ws?.close()
    if (app.exitCode === null) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true })
    fs.closeSync(log)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
