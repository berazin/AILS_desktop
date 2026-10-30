const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { acceptsGzip } = require('./http-content-encoding.cjs')

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' }

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** Serve only the build tree; proxy authenticated API streams without buffering. */
async function createFrontendGateway({ frontendDir, port = 0, token, uiOrigin = '', maxPending = 256, readTimeoutMs = 300000, getInitialDocumentExtension = () => '' }) {
  if (!token) throw new Error('Local API token is required')
  const configuredOrigin = uiOrigin ? new URL(uiOrigin).origin : ''
  // Only startup metadata is read synchronously, before a window exists. On
  // Windows the first queued filesystem requests can add startup latency
  // while Python is still waiting for this gateway to start.
  // Document and asset responses below remain asynchronous streams.
  let root
  try { root = fs.realpathSync(frontendDir) }
  catch (error) { if (uiOrigin) root = null; else throw error }
  const immutableAssets = new Set()
  const compressedAssets = new Set()
  const entryPreloads = new Map()
  if (root) {
    try {
      const assets = JSON.parse(fs.readFileSync(path.join(root, '.ails-immutable-assets.json'), 'utf8'))
      if (Array.isArray(assets)) for (const asset of assets) {
        if (typeof asset === 'string' && /^assets\/.+-[\w-]{8}\.[^/]+$/.test(asset) && !asset.includes('..')) immutableAssets.add(asset)
      }
    } catch { /* Older builds keep their original revalidation behavior. */ }
    try {
      const assets = JSON.parse(fs.readFileSync(path.join(root, '.ails-compressed-assets.json'), 'utf8'))
      if (Array.isArray(assets)) for (const asset of assets) {
        if (typeof asset === 'string' && /^assets\/[\w.-]+-[\w-]{8}\.(?:js|mjs|css)$/.test(asset)
          && immutableAssets.has(asset)) compressedAssets.add(asset)
      }
    } catch { /* Builds without compressed code still serve the original files. */ }
    try {
      const entries = JSON.parse(fs.readFileSync(path.join(root, '.ails-entry-preloads.json'), 'utf8'))
      for (const [kind, asset] of Object.entries(entries)) {
        if (typeof asset === 'string' && /^assets\/[\w.-]+-[\w-]{8}\.js$/.test(asset) && immutableAssets.has(asset)) entryPreloads.set(kind, asset)
      }
    } catch { /* Preloading is optional for older or incomplete builds. */ }
  }
  let backendPort = 0, state = 'starting', failure = '', origin = ''
  const pending = new Set()
  const tokenBytes = Buffer.from(token)
  const reply = (response, status, data) => {
    if (response.destroyed || response.writableEnded) return
    if (response.headersSent) { response.destroy(); return }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(data))
  }
  const unavailable = response => reply(response, 503, { code: state === 'failed' ? 'AILS_BACKEND_FAILED' : 'AILS_BACKEND_STARTING', error: state === 'failed' ? '로컬 백엔드를 시작하지 못했습니다. 다시 시도해 주세요.' : '로컬 백엔드를 준비 중입니다. 잠시 후 다시 시도해 주세요.' })
  function proxy(request, response) {
    if (request.aborted || response.destroyed) return
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, path: request.url, method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${backendPort}`, connection: 'close' } }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers)
      incoming.pipe(response)
      incoming.once('error', () => response.destroy())
    })
    upstream.once('error', () => reply(response, 502, { code: 'AILS_BACKEND_UNAVAILABLE', error: '로컬 백엔드 연결이 끊겼습니다. 다시 시도해 주세요.' }))
    response.once('close', () => upstream.destroy())
    request.once('aborted', () => upstream.destroy())
    request.pipe(upstream)
  }
  function defer(request, response) {
    if (pending.size >= maxPending) return unavailable(response)
    const entry = { request, response, timer: null }
    const remove = () => { pending.delete(entry); clearTimeout(entry.timer) }
    entry.timer = setTimeout(() => { remove(); unavailable(response) }, readTimeoutMs)
    entry.timer.unref()
    response.once('close', remove)
    pending.add(entry)
  }
  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) return reply(response, 403, { error: 'Invalid host' })
      const allowedOrigin = configuredOrigin || origin
      const requestOrigin = request.headers.origin
      if (requestOrigin && requestOrigin !== allowedOrigin) return reply(response, 403, { error: 'Invalid origin' })
      if (requestOrigin === allowedOrigin) {
        response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
        response.setHeader('Vary', 'Origin')
      }
      const url = new URL(request.url, origin)
      if (url.origin !== origin) return reply(response, 403, { error: 'Invalid target' })
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
          if (requestOrigin !== allowedOrigin) return reply(response, 403, { error: 'Invalid origin' })
          response.writeHead(204, { 'Access-Control-Allow-Headers': 'Content-Type, X-AILS-Token', 'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS' }); response.end(); return
        }
        const supplied = Buffer.from(String(request.headers['x-ails-token'] || ''))
        if (supplied.length !== tokenBytes.length || !crypto.timingSafeEqual(supplied, tokenBytes)) return reply(response, 403, { error: 'Unauthorized' })
        if (url.pathname === '/api/desktop-startup' && request.method === 'GET') return reply(response, 200, { state, error: failure })
        if (state === 'ready') return proxy(request, response)
        if (state === 'starting' && ['GET', 'HEAD'].includes(request.method)) return defer(request, response)
        return unavailable(response)
      }
      if (!['GET', 'HEAD'].includes(request.method)) return reply(response, 405, { error: 'Method not allowed' })
      if (!root) return reply(response, 404, { error: 'Not found' })
      const decoded = decodeURIComponent(url.pathname)
      if (decoded.includes('\0') || decoded.includes('\\')) return reply(response, 404, { error: 'Not found' })
      let candidate = path.resolve(root, `.${decoded}`)
      if (!inside(root, candidate)) return reply(response, 404, { error: 'Not found' })
      if (decoded === '/' || !path.extname(decoded)) candidate = path.join(root, 'index.html')
      const real = await fs.promises.realpath(candidate)
      if (!inside(root, real) || !(await fs.promises.stat(real)).isFile()) return reply(response, 404, { error: 'Not found' })
      const cacheControl = immutableAssets.has(path.relative(root, real).replaceAll('\\', '/'))
        ? 'public, max-age=31536000, immutable' : 'no-cache'
      let served = real
      if (compressedAssets.has(path.relative(root, real).replaceAll('\\', '/'))) {
        const vary = response.getHeader('Vary')
        response.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding')
        if (acceptsGzip(request.headers['accept-encoding'])) {
          try {
            const compressed = await fs.promises.realpath(`${real}.gz`)
            if (inside(root, compressed)) {
              const info = await fs.promises.stat(compressed)
              if (info.isFile()) {
                served = compressed
                response.setHeader('Content-Encoding', 'gzip')
                response.setHeader('Content-Length', info.size)
              }
            }
          } catch { /* An incomplete build can fall back to its original asset. */ }
        }
      }
      // Fetch/compile only the selected viewer while Chromium reads the entry
      // document. Its normal import still owns evaluation and editor creation.
      // Auxiliary windows do not inherit the main window's pending document.
      if (real === path.join(root, 'index.html') && !url.searchParams.has('windowMode')) {
        const preload = entryPreloads.get(getInitialDocumentExtension())
        if (preload) response.setHeader('Link', `</${preload}>; rel=modulepreload; crossorigin`)
      }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cacheControl })
      if (request.method === 'HEAD') { response.end(); return }
      const stream = fs.createReadStream(served)
      stream.once('error', () => response.destroy())
      response.once('close', () => stream.destroy())
      stream.pipe(response)
    } catch { reply(response, 404, { error: 'Not found' }) }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin, port: server.address().port,
    setBackend(nextPort, nextState, error = '') {
      backendPort = nextPort; state = nextState; failure = error
      if (state !== 'starting') for (const entry of [...pending]) {
        pending.delete(entry); clearTimeout(entry.timer)
        if (state === 'ready') proxy(entry.request, entry.response)
        else unavailable(entry.response)
      }
    },
    close() {
      for (const entry of pending) { clearTimeout(entry.timer); entry.response.destroy() }
      pending.clear(); server.close(); server.closeAllConnections()
    },
  }
}
module.exports = { createFrontendGateway }
