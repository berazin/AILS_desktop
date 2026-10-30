const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { isSameOriginUrl, normalizeExternalUrl } = require('./external-url.cjs')
const { VIEWER_URL } = require('./lightweight-viewer.cjs')

// One native window: its primary webContents warms the real workspace while a
// temporary child view keeps the document interactive. Never navigate the reader.
function createViewerWorkspaceHost({ WebContentsView, ipcMain, shell, getWindow, isTrustedWorkspace, onCommit }) {
  let view, warming, mounted, handoff, resize
  const reader = () => view && !view.webContents.isDestroyed() ? view.webContents : null
  const trustedReader = event => event.sender === reader()
    && event.senderFrame === event.sender.mainFrame && isSameOriginUrl(event.senderFrame.url, VIEWER_URL)
  const deferred = message => {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    const timer = setTimeout(() => reject(new Error(message)), 60000)
    timer.unref()
    void promise.finally(() => clearTimeout(timer)).catch(() => {})
    return { promise, resolve, reject }
  }
  function dispose() {
    mounted?.reject(new Error('창이 닫혔습니다.')); mounted = null
    handoff?.reject(new Error('창이 닫혔습니다.')); handoff?.activation?.reject(new Error('창이 닫혔습니다.')); handoff = null
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      if (resize) window.removeListener('resize', resize)
      if (view) window.contentView.removeChildView(view)
    }
    reader()?.close({ waitForBeforeUnload: false })
    view = null; warming = null
  }
  function mount(window) {
    view = new WebContentsView({ webPreferences: {
      preload: path.join(__dirname, 'lightweight-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false,
    } })
    view.setBackgroundColor('#f7f9fc')
    window.contentView.addChildView(view)
    resize = () => {
      if (!view || window.isDestroyed()) return
      const [width, height] = window.getContentSize()
      view.setBounds({ x: 0, y: 0, width, height })
    }
    resize(); window.on('resize', resize); window.once('closed', dispose)
    // Enabling hidden painting before the native view has been shown can leave
    // its compositor without a surface on Electron versions affected by #52844.
    // First show normally, then keep both views responsive during preparation.
    window.once('show', () => setImmediate(() => {
      if (!window.isDestroyed()) window.webContents.setBackgroundThrottling(false)
      reader()?.setBackgroundThrottling(false)
    }))
    window.webContents.on('render-process-gone', () => {
      if (!reader()) return
      const error = new Error('AILS 화면 준비가 중단되었습니다. 다시 시도해 주세요.')
      warming = null; mounted?.reject(error); handoff?.reject(error); handoff?.activation?.reject(error)
    })
    const wc = view.webContents
    const openLink = url => { try { void shell.openExternal(normalizeExternalUrl(url)) } catch {} }
    wc.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' } })
    wc.on('will-navigate', (event, url) => { if (!isSameOriginUrl(url, VIEWER_URL)) { event.preventDefault(); openLink(url) } })
    wc.on('console-message', details => console.error(`[AILS viewer] ${details.message}`))
    return wc
  }
  function prepare(loadWorkspace) {
    if (!reader()) return Promise.resolve()
    if (!warming) {
      const pending = deferred('AILS 화면 준비 시간이 초과되었습니다. 다시 시도해 주세요.')
      mounted = pending
      warming = Promise.all([loadWorkspace(), pending.promise]).then(() => {
        if (getWindow()?.isFocused()) reader()?.focus()
      }).catch(error => {
        pending.reject(error); warming = null
        throw error
      })
    }
    return warming
  }
  ipcMain.handle('ails-viewer:workspace-mounted', event => {
    if (!isTrustedWorkspace(event)) return false
    mounted?.resolve(); return true
  })
  ipcMain.handle('ails-viewer:workspace-presented', (event, result) => {
    if (!isTrustedWorkspace(event) || !handoff || result?.id !== handoff.id) return false
    if (result.phase === 'activation') {
      if (result.error) handoff.activation?.reject(new Error(String(result.error)))
      else handoff.activation?.resolve()
    }
    else if (result.error) handoff.reject(new Error(String(result.error)))
    else { handoff.presented = true; handoff.needsInput = result.needsInput === true; handoff.resolve({ id: handoff.id }) }
    return true
  })
  ipcMain.handle('ails-viewer:commit', async (event, id) => {
    if (!trustedReader(event) || !handoff?.presented || handoff.id !== id) return false
    const pending = handoff
    if (pending.intent.feature) {
      if (!pending.needsInput) pending.activation = deferred('기능 화면을 준비하지 못했습니다. 다시 시도해 주세요.')
      getWindow().webContents.send('ails-viewer:activate', { id, ...pending.intent })
      // Password/conversion prompts need to become visible before the document
      // can render. Leave its feature queued until the user completes the prompt.
      if (pending.activation) await pending.activation.promise
    }
    if (handoff !== pending) return false
    const window = getWindow(), oldView = view
    if (!window || window.isDestroyed()) return false
    window.contentView.removeChildView(oldView)
    if (resize) window.removeListener('resize', resize)
    view = null; handoff = null
    onCommit()
    if (window.isFocused()) window.webContents.focus()
    // Let the invoking reader receive its reply before retiring its renderer.
    const timer = setTimeout(() => { if (!oldView.webContents.isDestroyed()) oldView.webContents.close({ waitForBeforeUnload: false }) }, 50)
    timer.unref()
    return true
  })
  ipcMain.handle('ails-viewer:close', event => {
    if (!trustedReader(event)) return false
    getWindow()?.close(); return true
  })
  return {
    mount, reader, prepare, dispose,
    request(send, intent = {}) {
      handoff?.reject(new Error('새 문서 상태로 전환합니다.'))
      const pending = { ...deferred('문서 화면 준비 시간이 초과되었습니다. 다시 시도해 주세요.'), id: randomUUID(), presented: false, intent }
      handoff = pending
      send(pending.id)
      return pending.promise
    },
  }
}
module.exports = { createViewerWorkspaceHost }
