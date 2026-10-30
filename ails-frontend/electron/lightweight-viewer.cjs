const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Readable } = require('node:stream')
const { spawn } = require('node:child_process')
const { isSameOriginUrl } = require('./external-url.cjs')

const VIEWER_URL = 'ails-viewer://app/index.html'
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
const assets = {
  '/brand/logo.png': ['../../assets/AILS_white.png', 'image/png'],
  '/brand/processbar.jpg': ['../src/assets/sidebar-mist.jpg', 'image/jpeg'],
  '/index.html': ['lightweight-viewer/index.html', 'text/html'],
  '/viewer.css': ['lightweight-viewer/viewer.css', 'text/css'],
  '/chrome.css': ['lightweight-viewer/chrome.css', 'text/css'],
  '/icons.js': ['lightweight-viewer/icons.js', 'text/javascript'],
  '/viewer.js': ['lightweight-viewer/viewer.js', 'text/javascript'],
  '/formats.js': ['lightweight-viewer/formats.js', 'text/javascript'],
  '/pdf.js': ['lightweight-viewer/pdf.js', 'text/javascript'],
  '/vendor/pdf.mjs': ['../node_modules/pdfjs-dist/build/pdf.min.mjs', 'text/javascript'],
  '/vendor/pdf.worker.mjs': ['../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'text/javascript'],
  '/vendor/marked.js': ['../node_modules/marked/lib/marked.esm.js', 'text/javascript'],
  '/vendor/purify.js': ['../node_modules/dompurify/dist/purify.es.mjs', 'text/javascript'],
  '/vendor/mammoth.js': ['../node_modules/mammoth/mammoth.browser.js', 'text/javascript'],
  '/vendor/exceljs.js': ['../node_modules/exceljs/dist/exceljs.min.js', 'text/javascript'],
  '/vendor/papaparse.js': ['../node_modules/papaparse/papaparse.min.js', 'text/javascript'],
}

// Only files explicitly supplied by the OS can acquire a capability URL. No
// renderer-supplied filesystem path is ever passed to the protocol handler.
function createLightweightViewer({ app, protocol, ipcMain, getWebContents, prepare, upgrade, pythonPath, backendExecutablePath }) {
  const files = new Map(), tokens = new Map(), children = new Set()
  const pending = []
  let ready = false, delivery = null
  function stop(child) {
    if (!child.pid || child.exitCode !== null) return
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => {})
    } else child.kill()
  }
  const trusted = event => {
    const wc = getWebContents()
    return wc && !wc.isDestroyed() && event.sender === wc
      && event.senderFrame === wc.mainFrame && isSameOriginUrl(event.senderFrame.url, VIEWER_URL)
  }
  function flush() {
    const wc = getWebContents()
    if (!ready || !wc || wc.isDestroyed() || delivery || !pending.length) return
    delivery = pending[0]; wc.send('ails-documents:open', delivery)
  }
  function enqueue(paths) {
    for (const file of paths) if (!pending.some(item => item.path.toLowerCase() === file.toLowerCase())) pending.push({ id: randomUUID(), path: file })
    flush()
  }
  ipcMain.handle('ails-viewer:documents-ready', event => {
    if (!trusted(event)) return false
    ready = true; delivery = null; flush(); return true
  })
  ipcMain.handle('ails-viewer:documents-ack', (event, id) => {
    if (!trusted(event) || delivery?.id !== id) return false
    pending.shift(); delivery = null; flush(); return true
  })
  function grant(paths) {
    for (const file of paths) {
      const key = file.toLowerCase()
      if (files.has(key)) continue
      const item = { token: randomUUID(), path: file, name: path.basename(file), kind: path.extname(file).slice(1).toLowerCase() }
      files.set(key, item); tokens.set(item.token, item)
    }
  }
  function serve(request, filename, mime) {
    const stat = fs.statSync(filename)
    let start = 0, end = stat.size - 1, status = 200
    const headers = { 'Content-Type': mime, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' }
    const range = request.headers.get('range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 })
      start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]))
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
      if (start > end || !Number.isSafeInteger(start)) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1))
    const body = request.method === 'HEAD' || stat.size === 0 ? null : Readable.toWeb(fs.createReadStream(filename, { start, end }))
    return new Response(body, { status, headers })
  }
  function install() {
    protocol.handle('ails-viewer', request => {
      try {
        const url = new URL(request.url)
        if (url.host !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 })
        const asset = assets[url.pathname]
        if (asset) {
          const filename = app.isPackaged && url.pathname.startsWith('/brand/')
            ? path.join(process.resourcesPath, 'viewer-brand', path.basename(asset[0])) : path.join(__dirname, asset[0])
          return serve(request, filename, `${asset[1]}; charset=utf-8`)
        }
        const token = /^\/file\/([a-f0-9-]+)$/.exec(url.pathname)?.[1]
        const file = tokens.get(token)
        if (file) return serve(request, file.path, file.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream')
        // PDF font/CMap/WASM resources are confined to the installed package.
        const resource = /^\/pdf-assets\/(cmaps|standard_fonts|wasm)\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname)
        if (resource) return serve(request, path.join(__dirname, '../node_modules/pdfjs-dist', resource[1], resource[2]), 'application/octet-stream')
        return new Response(null, { status: 404 })
      } catch { return new Response(null, { status: 404 }) }
    })
  }
  ipcMain.handle('ails-viewer:document', (event, filename) => {
    if (!trusted(event)) throw new Error('Untrusted viewer')
    const item = files.get(String(filename).toLowerCase())
    if (!item) throw new Error('파일 접근 권한이 없습니다.')
    return { ...item, size: fs.statSync(item.path).size, url: `ails-viewer://app/file/${item.token}` }
  })
  ipcMain.handle('ails-viewer:convert', async (event, token) => {
    if (!trusted(event) || !tokens.has(token)) throw new Error('파일 접근 권한이 없습니다.')
    const item = tokens.get(token)
    if (!['ppt', 'pptx', 'hwp', 'hwpx', 'epub', 'mobi', 'azw', 'azw3', 'fb2', 'rtf'].includes(item.kind)) throw new Error('지원하지 않는 변환입니다.')
    return new Promise((resolve, reject) => {
      const root = path.resolve(__dirname, '../..')
      const args = app.isPackaged ? ['--lightweight-viewer', item.path] : [path.join(root, 'ails-backend/documents/lightweight_viewer.py'), item.path]
      const child = spawn(app.isPackaged ? backendExecutablePath() : pythonPath(), args, {
        cwd: app.isPackaged ? process.resourcesPath : path.join(root, 'ails-backend'),
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
      children.add(child)
      const chunks = [], errors = []; let size = 0
      const timer = setTimeout(() => stop(child), 30000)
      child.stdout.on('data', data => { size += data.length; if (size > 32 * 1024 * 1024) stop(child); else chunks.push(data) })
      child.stderr.on('data', data => { if (errors.length < 10) errors.push(data) })
      child.once('error', reject)
      child.once('close', code => {
        clearTimeout(timer); children.delete(child)
        if (code !== 0) return reject(new Error(Buffer.concat(errors).toString('utf8').slice(-2000) || '문서를 변환하지 못했습니다.'))
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
      })
    })
  })
  ipcMain.handle('ails-viewer:prepare', async event => {
    if (!trusted(event)) throw new Error('Untrusted viewer')
    await prepare()
    return true
  })
  ipcMain.handle('ails-viewer:workspace', async (event, payload) => {
    if (!trusted(event)) throw new Error('Untrusted viewer')
    const items = Array.isArray(payload?.documents) ? payload.documents.slice(0, 100) : []
    const paths = [], intents = {}
    for (const entry of items) {
      const item = tokens.get(entry.token)
      if (!item) throw new Error('파일 접근 권한이 없습니다.')
      paths.push(item.path)
      const features = ['edit', 'chat', 'ocr', 'home', 'new-tab', 'materials', 'work-queue', 'insight', 'practice', 'bookmarks', 'history', 'code', 'feedback', 'search']
      intents[item.path] = { page: Math.max(1, Math.min(1000000, Number(entry.page) || 1)),
        zoom: Number.isFinite(entry.zoom) ? Math.max(.3, Math.min(3, entry.zoom)) : 1,
        feature: features.includes(entry.feature) ? entry.feature : undefined }
    }
    const active = paths.at(-1)
    if (active) intents[active].tabs = paths.slice(0, -1).map(path => ({ path, page: intents[path].page }))
    return upgrade(active ? [active] : [], intents)
  })
  return { grant, enqueue, install, dispose: () => { for (const child of children) stop(child) } }
}
module.exports = { createLightweightViewer, VIEWER_URL }
