const { markStartupPhase } = require("./startup-diagnostics.cjs")
markStartupPhase("main-entry")
const { closeBackend } = require("./backend-lifetime.cjs")
const idePolicy = require("./ide-policy.cjs")
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, screen, shell } = require("electron")
const { spawn } = require("child_process")
const crypto = require("crypto")
const fs = require("fs")
const http = require("http")
const net = require("net")
const path = require("path")
const { documentPaths, createExternalDocuments } = require("./external-documents.cjs")
const { updatesEnabled } = require("./edition-policy.cjs")
const { isSameOriginUrl, normalizeExternalUrl } = require("./external-url.cjs")
const { calculateInitialWindowBounds } = require("./window-size.cjs")
const { WindowsSpeechBridge } = require("./windows-speech.cjs")
const { installLocalMediaAuthentication } = require("./local-media-auth.cjs")
const { registerFeedbackEnvironment } = require("./feedback-environment.cjs")
const { registerWorkspaceClipboard } = require("./workspace-clipboard.cjs")
const { createWorkspaceTabTransfer } = require("./workspace-tab-transfer.cjs")
const { createAuxiliaryWorkspaceWindow } = require("./workspace-window.cjs")
const { createTabDragDroplet } = require("./tab-drag-droplet.cjs")
const { registerTabScreenPreview } = require("./tab-screen-preview.cjs")
const { createWindowSaveGuard } = require("./window-save-guard.cjs")
require("./stdio-lifecycle.cjs").tolerateClosedLoggingPipes()
markStartupPhase("main-imports-ready")

const explicitUserDataDir = String(process.env.AILS_ELECTRON_USER_DATA_DIR || "").trim()
if (explicitUserDataDir) {
  const resolvedUserDataDir = path.resolve(explicitUserDataDir)
  fs.mkdirSync(resolvedUserDataDir, { recursive: true })
  app.setPath("userData", resolvedUserDataDir)
}

const APP_NAME = app.getName()
const DEFAULT_PORT = 8765
const MIN_WIDTH = 720
const MIN_HEIGHT = 480
const rendererCspPolicies = new Map()
const rendererCspSessions = new WeakSet()
// Per-run secret shared with the Python backend and the renderer so the
// local API rejects requests from web pages and unrelated processes.
const LOCAL_API_TOKEN = crypto.randomBytes(32).toString("hex")

let mainWindow = null
let tray = null
let backendProcess = null
let backendStartError = null
let quitting = false
let updateController = null
let appTargetUrl = ""
let currentBackendPort = DEFAULT_PORT
let frontendGateway = null
let backendReady = false
let workspaceStarting = null
const devServerReady = process.env.AILS_DEV_LAUNCHER === "1" && process.connected
  ? new Promise((resolve, reject) => {
      const onMessage = message => {
        if (message?.type === "ails-dev-server-ready") { cleanup(); resolve() }
        else if (message?.type === "ails-dev-server-error") { cleanup(); reject(new Error(message.message)) }
      }
      const onDisconnect = () => { cleanup(); reject(new Error("개발 서버 실행기가 종료되었습니다.")) }
      const cleanup = () => { process.off("message", onMessage); process.off("disconnect", onDisconnect) }
      process.on("message", onMessage)
      process.once("disconnect", onDisconnect)
    })
  : Promise.resolve()
// Keep an early launcher failure handled until the window attaches its handler.
void devServerReady.catch(() => {})
if (["1", "built"].includes(process.env.AILS_DEV_LAUNCHER) && process.connected) {
  process.on("message", message => { if (message?.type === "ails-dev-launcher-stop") app.quit() })
  process.once("disconnect", () => app.quit())
}
const externalGrantsPath = path.join(app.getPath("userData"), "external-documents.json")
const externalDocuments = createExternalDocuments({ ipcMain, grantsPath: externalGrantsPath,
  getWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : tabTransfers.getWorkspaceWindow(),
  getSenderWindow: event => BrowserWindow.fromWebContents(event.sender),
  isTrusted: (event, window) => !window.isDestroyed() && tabTransfers.isRegisteredWorkspaceWindow(window) && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && isSameOriginUrl(event.senderFrame.url, appTargetUrl),
})
const windowSaveGuard = createWindowSaveGuard({ app, ipcMain,
  isTrusted: (event, window) => event.senderFrame === window.webContents.mainFrame && isSameOriginUrl(event.senderFrame.url, appTargetUrl),
  onError: (window, error) => {
    quitting = false
    if (window && !window.isDestroyed()) { window.show(); window.focus() }
    dialog.showErrorBox(APP_NAME, `변경 내용을 저장하지 못해 종료를 취소했습니다. 다시 저장한 뒤 종료해 주세요.\n\n${error.message}`)
  },
})
const tabTransfers = createWorkspaceTabTransfer({ ipcMain, screen,
  createDroplet: () => createTabDragDroplet(BrowserWindow, appTargetUrl),
  createWindow: (point, onCreated) => createWorkspaceWindow({ point, tabWindow: true, onCreated }),
  isTrusted: (event, window) => event.senderFrame === window.webContents.mainFrame && isSameOriginUrl(event.senderFrame.url, appTargetUrl),
})
require("./startup-diagnostics.cjs").registerStartupDiagnostics({ ipcMain, BrowserWindow,
  isTrusted: (event, window) => tabTransfers.isRegisteredWorkspaceWindow(window)
    && event.senderFrame === window.webContents.mainFrame && isSameOriginUrl(event.senderFrame.url, appTargetUrl),
})
registerTabScreenPreview({ ipcMain, BrowserWindow, isTrusted: (event, window) => tabTransfers.isWorkspaceWindow(window)
  && event.senderFrame === window.webContents.mainFrame && isSameOriginUrl(event.senderFrame.url, appTargetUrl) })
registerWorkspaceClipboard({ ipcMain, clipboard, BrowserWindow, isTrusted: (event, window) => tabTransfers.isRegisteredWorkspaceWindow(window)
  && event.senderFrame === window.webContents.mainFrame && isSameOriginUrl(event.senderFrame.url, appTargetUrl) })
const windowsSpeech = new WindowsSpeechBridge({
  app,
  send: (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ails-voice:windows-event", event)
  },
})

function rendererContentSecurityPolicy(isDevelopment, backendOrigin) {
  const imageSources = ["'self'", "data:", "blob:", "https:"]
  if (isDevelopment) imageSources.push(backendOrigin)
  const directives = [
    "default-src 'self'",
    `script-src 'self'${isDevelopment ? " 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src ${imageSources.join(" ")}`,
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob: http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
  const connectSources = ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"]
  if (isDevelopment) {
    connectSources.push("http://127.0.0.1:*", "http://localhost:*", "ws://127.0.0.1:*", "ws://localhost:*")
  }
  directives.push(`connect-src ${connectSources.join(" ")}`)
  return directives.join("; ")
}

function installRendererContentSecurityPolicy(webContents, targetUrl, backendPort) {
  let origin
  try {
    const parsedUrl = new URL(targetUrl)
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return
    origin = parsedUrl.origin
  } catch {
    return
  }

  rendererCspPolicies.set(origin, rendererContentSecurityPolicy(!app.isPackaged, `http://127.0.0.1:${backendPort}`))
  const requestSession = webContents.session
  if (rendererCspSessions.has(requestSession)) return

  requestSession.webRequest.onHeadersReceived({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    let policy
    try {
      policy = rendererCspPolicies.get(new URL(details.url).origin)
    } catch {
      // Leave responses from malformed or non-app URLs unchanged.
    }
    if (!policy) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    const responseHeaders = { ...details.responseHeaders }
    const cspHeaderName = Object.keys(responseHeaders).find((name) => name.toLowerCase() === "content-security-policy")
    responseHeaders[cspHeaderName || "Content-Security-Policy"] = [
      ...(cspHeaderName ? responseHeaders[cspHeaderName] : []),
      policy,
    ]
    callback({ responseHeaders })
  })
  rendererCspSessions.add(requestSession)
}

async function installReactDevTools() {
  if (app.isPackaged) return
  try {
    const { installExtension, REACT_DEVELOPER_TOOLS } = require("@tomjs/electron-devtools-installer")
    const extension = await installExtension(REACT_DEVELOPER_TOOLS)
    console.info(`[AILS DevTools] React Developer Tools loaded (${extension.version})`)
  } catch (error) {
    console.warn("[AILS DevTools] React Developer Tools could not be loaded:", error?.message || error)
  }
}

function rootDir() {
  return path.resolve(__dirname, "..", "..")
}

function frontendDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "frontend")
  }
  if (process.env.AILS_FRONTEND_OUT_DIR) return path.resolve(process.env.AILS_FRONTEND_OUT_DIR)
  const staged = path.join(rootDir(), "build", `frontend_${normalizeEdition(process.env.AILS_EDITION)}`)
  if (fs.existsSync(staged)) return staged
  return path.join(rootDir(), "ails-frontend", "dist")
}

function iconPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "AILS.ico"),
        path.join(process.resourcesPath, "app.asar.unpacked", "AILS.ico"),
      ]
    : [path.join(rootDir(), "assets", "AILS.ico")]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function taskbarIconPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "AILS-taskbar.ico"),
        path.join(process.resourcesPath, "AILS-taskbar.png"),
      ]
    : [
        path.join(rootDir(), "assets", "AILS-taskbar.ico"),
        path.join(rootDir(), "assets", "AILS-taskbar.png"),
      ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? iconPath()
}

function backendExecutablePath() {
  const packagedCandidates = [
    path.join(process.resourcesPath, "backend", "AILSBackend", "AILSBackend.exe"),
    path.join(process.resourcesPath, "backend", "AILSBackend.exe"),
  ]
  return packagedCandidates.find((candidate) => fs.existsSync(candidate)) ?? packagedCandidates[0]
}

function normalizeEdition(value) {
  return require("./edition-policy.cjs").normalizeEdition(value)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function applicationEdition() {
  if (app.isPackaged) {
    const directory = frontendDir()
    const markerPath = path.join(directory, ".ails-edition")
    const manifestPath = path.join(directory, "edition-manifest.json")
    const checksumPath = path.join(directory, "edition-manifest.sha256")
    const marker = fs.readFileSync(markerPath, "utf8").trim().toLowerCase()
    if (marker !== "developer") {
      throw new Error(`Invalid packaged edition marker: ${markerPath}`)
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    if (manifest?.schema_version !== 1 || manifest?.id !== marker) {
      throw new Error(`Packaged edition manifest does not match ${marker}: ${manifestPath}`)
    }
    const digest = crypto.createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex")
    const checksum = fs.readFileSync(checksumPath, "ascii").trim()
    if (checksum !== `${digest}  edition-manifest.json`) {
      throw new Error(`Packaged edition checksum is invalid: ${checksumPath}`)
    }
    return marker
  }
  const explicitEdition = String(process.env.AILS_EDITION || "").trim()
  if (explicitEdition) return normalizeEdition(explicitEdition)
  try {
    return normalizeEdition(fs.readFileSync(path.join(frontendDir(), ".ails-edition"), "utf8"))
  } catch {
    return normalizeEdition(process.env.AILS_EDITION)
  }
}

function pythonPath() {
  return require("./backend-command.cjs").pythonPath(rootDir())
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "127.0.0.1")
  })
}

async function findPort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 30; port += 1) {
    if (await isPortFree(port)) return port
  }
  return preferredPort
}

function waitForServer(port, timeoutMs = 300000) {
  return require("./backend-readiness.cjs").waitForBackend({ port, token: LOCAL_API_TOKEN, timeoutMs,
    getFailure: () => backendStartError || (backendProcess?.exitCode !== null && backendProcess?.exitCode !== undefined
      ? new Error(`Backend exited before readiness (code ${backendProcess.exitCode}).`) : null),
  })
}

function startBackend(port) {
  backendStartError = null
  const args = [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--frontend",
    frontendDir(),
  ]

  const env = {
    ...process.env,
    AILS_EDITION: applicationEdition(),
    AILS_ELECTRON: "1",
    AILS_ELECTRON_NODE_EXE: process.execPath,
    AILS_LOCAL_API_TOKEN: LOCAL_API_TOKEN,
    AILS_EXTERNAL_DOCUMENTS: externalGrantsPath,
    PYTHONIOENCODING: "utf-8",
    AILS_PARENT_PIPE: "1",
    ...(process.windowsStore || applicationEdition() === "commercial"
      ? { AILS_RUNTIME_DATA_DIR: app.getPath("userData") }
      : {}),
  }
  const devUrl = String(process.env.AILS_ELECTRON_DEV_URL || frontendGateway?.origin || "").trim()
  if (devUrl) {
    try {
      env.AILS_UI_ORIGIN = new URL(devUrl).origin
    } catch {
      // Ignore malformed dev URLs; the backend falls back to loopback origins.
    }
  }

  if (!app.isPackaged && process.connected && process.env.AILS_DEV_BACKEND === "1") {
    backendProcess = require("./launcher-backend.cjs").createLauncherBackend({ args, env })
  } else if (app.isPackaged && fs.existsSync(backendExecutablePath())) {
    backendProcess = spawn(backendExecutablePath(), args, {
      cwd: path.dirname(backendExecutablePath()),
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
  } else {
    backendProcess = spawn(
      pythonPath(),
      [path.join(rootDir(), "ails-backend", "api_server.py"), ...args],
      {
        cwd: rootDir(),
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
  }

  const startedBackend = backendProcess
  let startupOutput = ""
  backendProcess.once("error", error => {
    if (backendProcess === startedBackend) backendStartError = error
  })
  backendProcess.stdout?.on("data", (chunk) => {
    startupOutput = (startupOutput + String(chunk)).slice(-1024)
    if (process.env.AILS_STARTUP_DIAGNOSTICS) for (const match of startupOutput.matchAll(/\[AILS startup\] (python-entry|python-imports-ready|state-ready|http-bound)=(\d+)\r?\n/g)) {
      markStartupPhase(match[1], Number(match[2]))
    }
    if (startupOutput.includes(`AILS API server listening on http://127.0.0.1:${port}`)) markStartupPhase("backend-listening")
    process.stdout.write(`[AILS backend] ${chunk}`)
  })
  backendProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[AILS backend] ${chunk}`)
  })
  backendProcess.on("exit", (code, signal) => {
    const wasReady = backendReady
    if (backendProcess === startedBackend) {
      backendReady = false
      if (wasReady) workspaceStarting = null
      frontendGateway?.setBackend(port, "failed", "로컬 백엔드가 종료되었습니다.")
    }
    if (backendProcess === startedBackend && wasReady && !quitting && mainWindow && code !== 0) {
      dialog.showErrorBox(APP_NAME, `백엔드가 종료되었습니다. code=${code ?? ""} signal=${signal ?? ""}`)
    }
  })
}

let backendClosing = null
function stopBackend() {
  if (backendClosing) return backendClosing
  const child = backendProcess
  backendProcess = null
  backendClosing = closeBackend(child).finally(() => { backendClosing = null })
  return backendClosing
}

function showWorkspaceWindow() {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : tabTransfers.getWorkspaceWindow()
  if (!window) { createWindow(currentBackendPort); return }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function createTray() {
  if (tray) return
  const image = nativeImage.createFromPath(iconPath())
  tray = new Tray(image)
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "열기",
        click: showWorkspaceWindow,
      },
      {
        label: "\uC5C5\uB370\uC774\uD2B8 \uD655\uC778",
        enabled: app.isPackaged && updatesEnabled(applicationEdition()),
        visible: updatesEnabled(applicationEdition()),
        click: () => {
          void updateController?.checkForUpdates({ interactive: true })
        },
      },
      { type: "separator" },
      {
        label: "종료",
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on("double-click", showWorkspaceWindow)
}

function createWindow(port) {
  const initialBounds = calculateInitialWindowBounds(screen.getPrimaryDisplay().workArea)
  const targetUrl = process.env.AILS_ELECTRON_DEV_URL || `http://127.0.0.1:${port}/?_t=${Date.now()}`
  appTargetUrl = targetUrl
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: APP_NAME,
    frame: false,
    thickFrame: true,
    resizable: true,
    show: false,
    backgroundColor: "#f7f9fc",
    icon: taskbarIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })
  installRendererContentSecurityPolicy(mainWindow.webContents, targetUrl, port)
  installLocalMediaAuthentication(mainWindow.webContents, targetUrl, port, LOCAL_API_TOKEN)
  tabTransfers.register(mainWindow)
  const window = mainWindow
  window.on("closed", () => { if (mainWindow === window) mainWindow = null })

  window.on("maximize", () => {
    if (!window.isDestroyed()) {
      window.webContents.send("ails-window:maximize-change", true)
    }
  })

  window.on("unmaximize", () => {
    if (!window.isDestroyed()) {
      window.webContents.send("ails-window:maximize-change", false)
    }
  })

  // Windows can report invisible briefly after show(). Both readiness events
  // may arrive in that interval; resizing/showing again restarts presentation.
  // The fallback must also respect a user hiding the window after first reveal.
  let revealRequested = false
  const revealWindow = () => {
    if (window.isDestroyed() || revealRequested) return
    revealRequested = true
    if (!window.isVisible()) {
      if (!window.isFullScreen() && !window.isMaximized()) {
        window.setBounds(initialBounds)
      }
      window.show()
      window.focus()
      markStartupPhase("window-shown")
    }
  }

  mainWindow.once("ready-to-show", revealWindow)
  mainWindow.webContents.once("did-finish-load", () => { markStartupPhase("renderer-loaded"); revealWindow() })
  setTimeout(revealWindow, 2500)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (String(url || "").startsWith("blob:")) return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { spellcheck: false } } }
    try {
      void shell.openExternal(normalizeExternalUrl(url))
    } catch (error) {
      console.warn("[AILS external link]", error?.message || error)
    }
    return { action: "deny" }
  })

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isSameOriginUrl(url, appTargetUrl)) return
    event.preventDefault()
    try {
      void shell.openExternal(normalizeExternalUrl(url))
    } catch (error) {
      console.warn("[AILS external link]", error?.message || error)
    }
  })

  if (!app.isPackaged) {
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`[AILS renderer] load failed (${errorCode}) ${errorDescription}: ${validatedURL}`)
    })
    mainWindow.webContents.on("console-message", (details) => {
      console.error(`[AILS renderer] ${details.message} (${details.sourceId || "unknown"}:${details.lineNumber || 0})`)
    })
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[AILS renderer] process exited: ${details.reason} (${details.exitCode})`)
    })
  }

  // Closing a document window must really close it. The save guard flushes
  // edits first; window-all-closed shuts down the backend after the last window.
  windowSaveGuard.register(window)

  void devServerReady.then(() => {
    if (!window.isDestroyed()) return window.loadURL(targetUrl)
  }).catch(error => {
    console.error("[AILS renderer]", error)
    if (!quitting) { dialog.showErrorBox(APP_NAME, `화면을 준비하지 못했습니다.\n${error.message}`); app.quit() }
  })
  createTray()
}

function currentWindow(event) {
  return (event?.sender ? BrowserWindow.fromWebContents(event.sender) : null) || BrowserWindow.getFocusedWindow() || mainWindow
}

function unavailableUpdateStatus() {
  return {
    supported: false,
    currentVersion: app.getVersion(),
    state: "unavailable",
    updateVersion: "",
    progressPercent: 0,
    error: "",
  }
}

registerFeedbackEnvironment({ ipcMain, BrowserWindow, app, screen, getEdition: applicationEdition })

ipcMain.handle("ails-window:minimize", (event) => {
  currentWindow(event)?.minimize()
})

ipcMain.handle("ails-window:maximize", (event) => {
  const window = currentWindow(event)
  if (!window) return false
  if (window.isMaximized()) {
    window.unmaximize()
    return false
  }
  window.maximize()
  return true
})

ipcMain.handle("ails-window:is-maximized", (event) => {
  const window = currentWindow(event)
  return window?.isMaximized() ?? false
})

const fullscreenPreviousStates = new WeakMap()

ipcMain.handle("ails-window:set-fullscreen", (event, fullscreen) => {
  const window = currentWindow(event)
  if (!window) return false
  if (fullscreen === true) {
    if (!window.isFullScreen()) fullscreenPreviousStates.set(window, window.isMaximized())
    window.setFullScreen(true)
    return true
  }
  if (window.isFullScreen()) {
    window.setFullScreen(false)
    if (fullscreenPreviousStates.get(window)) window.maximize()
  }
  fullscreenPreviousStates.delete(window)
  return false
})

ipcMain.handle("ails-window:close", (event) => {
  currentWindow(event)?.close()
})

ipcMain.handle("ails-window:quit", () => {
  quitting = true
  app.quit()
})

ipcMain.handle("ails-window:resize", (event, width, height, fixedPoint = "nw") => {
  const window = currentWindow(event)
  if (!window) return null
  const bounds = window.getBounds()
  const nextWidth = Math.max(MIN_WIDTH, Math.round(Number(width) || bounds.width))
  const nextHeight = Math.max(MIN_HEIGHT, Math.round(Number(height) || bounds.height))
  const nextBounds = { ...bounds, width: nextWidth, height: nextHeight }
  if (String(fixedPoint).includes("e")) {
    nextBounds.x = bounds.x + bounds.width - nextWidth
  }
  if (String(fixedPoint).includes("s")) {
    nextBounds.y = bounds.y + bounds.height - nextHeight
  }
  window.setBounds(nextBounds)
  return { width: nextWidth, height: nextHeight }
})

ipcMain.handle("ails-update:status", async () => {
  return updateController?.getStatus ? updateController.getStatus() : unavailableUpdateStatus()
})

ipcMain.handle("ails-update:check", async () => {
  if (!updateController) return unavailableUpdateStatus()
  await updateController.checkForUpdates({ interactive: true })
  return updateController.getStatus()
})

ipcMain.handle("ails-compliance:open-url", async (_event, value) => {
  const url = normalizeExternalUrl(value)
  await shell.openExternal(url)
  return { opened: true, url }
})

function edgeExecutablePath() {
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files"
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
  const localAppData = process.env["LOCALAPPDATA"] || ""
  const candidates = [
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
  ]
  if (localAppData) candidates.push(path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"))
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate)
    } catch {
      return false
    }
  }) ?? ""
}

// AILS 계정 로그인 창은 Windows 기본 브라우저와 무관하게 Microsoft Edge로 연다.
// 자동화 전용 브라우저(BrowserOS 등)는 Cloudflare workers.dev의 봇 시그니처
// 차단으로 로그인 페이지가 표시되지 않을 수 있다.
ipcMain.handle("ails-auth:open-login-url", async (_event, value) => {
  const url = normalizeExternalUrl(value)
  const edge = edgeExecutablePath()
  if (edge) {
    await new Promise((resolve, reject) => {
      const child = spawn(edge, ["--new-window", url], { detached: true, stdio: "ignore" })
      child.once("error", reject)
      child.once("spawn", () => {
        child.unref()
        resolve()
      })
    })
    return { opened: true, url, browser: "edge" }
  }
  await shell.openExternal(url)
  return { opened: true, url, browser: "default" }
})

ipcMain.handle("ails-voice:windows-status", () => windowsSpeech.status())
ipcMain.handle("ails-voice:windows-start", (_event, language) => windowsSpeech.start(String(language || "ko-KR")))
ipcMain.handle("ails-voice:windows-stop", () => windowsSpeech.stop())

ipcMain.handle("ails-file:show-in-folder", async (_event, targetPath) => {
  if (!targetPath) return false
  try {
    const resolved = path.resolve(String(targetPath))
    shell.showItemInFolder(resolved)
    return true
  } catch (error) {
    console.error("[AILS show-in-folder]", error)
    return false
  }
})

ipcMain.handle("ails-file:open-external", async (_event, targetPath) => {
  idePolicy.requireDocument(applicationEdition(), targetPath)
  if (!targetPath) return false
  try {
    const resolved = path.resolve(String(targetPath))
    const errorMsg = await shell.openPath(resolved)
    if (errorMsg) {
      console.warn("[AILS open-external warning]", errorMsg)
      return false
    }
    return true
  } catch (error) {
    console.error("[AILS open-external error]", error)
    return false
  }
})

function createWorkspaceWindow(options = {}) {
  return createAuxiliaryWorkspaceWindow({ BrowserWindow, screen, shell,
    baseUrl: appTargetUrl || process.env.AILS_ELECTRON_DEV_URL || "http://127.0.0.1:8765",
    preload: path.join(__dirname, "preload.cjs"), icon: taskbarIconPath(), port: currentBackendPort, token: LOCAL_API_TOKEN,
    installCsp: installRendererContentSecurityPolicy, installMedia: installLocalMediaAuthentication,
    register: (window, auxiliary) => { tabTransfers.register(window, auxiliary); windowSaveGuard.register(window) },
    normalizeExternalUrl, isSameOriginUrl, ...options })
}
ipcMain.handle("ails-window:open-split-window", async (_event, targetPath) => {
  if (targetPath) idePolicy.requireDocument(applicationEdition(), targetPath)
  try { const window = await createWorkspaceWindow({ targetPath: String(targetPath || "") }); window.show(); window.focus(); return true }
  catch (error) { console.error("[AILS open-split-window error]", error); return false }
})

ipcMain.on("ails-config:get-local-api-token", (event) => {
  event.returnValue = LOCAL_API_TOKEN
})

ipcMain.on("ails-config:get-backend-port", (event) => {
  event.returnValue = currentBackendPort
})

ipcMain.handle("ails-dialog:open-python", async () => {
  idePolicy.requireIde(applicationEdition())
  const options = {
    title: "Python 실행 파일 선택",
    properties: ["openFile"],
    filters: [
      { name: "Python 실행 파일", extensions: ["exe"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  }
  if (mainWindow && !mainWindow.isDestroyed()) options.window = mainWindow
  const result = await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths.length) return ""
  return result.filePaths[0]
})

// 백엔드 tkinter 다이얼로그를 대체하는 네이티브 파일/폴더 선택. 필터 구성은
// 제거된 백엔드 get_dialog_filetypes와 동일한 확장자 집합을 유지한다.
const DIALOG_FILE_FILTERS = {
  audio: [
    { name: "오디오 파일", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma", "mp4", "mkv", "webm"] },
    { name: "모든 파일", extensions: ["*"] },
  ],
  video: [
    { name: "비디오 파일", extensions: ["mp4", "mov", "mkv", "webm"] },
    { name: "모든 파일", extensions: ["*"] },
  ],
  document: [
    { name: "문서 파일", extensions: ["pdf", "md", "txt", "ppt", "pptx", "ipynb", "epub", "mobi", "azw", "azw3", "fb2", "rtf", "docx", "xlsx", "csv", "hwp", "hwpx", "html", "htm"] },
    { name: "PDF 파일", extensions: ["pdf"] },
    { name: "EPUB 파일", extensions: ["epub"] },
    { name: "모든 파일", extensions: ["*"] },
  ],
  epub: [
    { name: "EPUB 파일", extensions: ["epub"] },
    { name: "모든 파일", extensions: ["*"] },
  ],
  markdown: [
    { name: "Markdown 파일", extensions: ["md", "markdown"] },
    { name: "모든 파일", extensions: ["*"] },
  ],
  python: [
    { name: "Python 실행 파일", extensions: ["exe"] },
    { name: "모든 파일", extensions: ["*"] },
  ],
}

function dialogFiltersForKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase()
  if (normalized === "pdf") return DIALOG_FILE_FILTERS.document
  return DIALOG_FILE_FILTERS[normalized] || [{ name: "모든 파일", extensions: ["*"] }]
}

function dialogDefaultPath(initialDir) {
  const candidate = String(initialDir || "").trim()
  return candidate && fs.existsSync(candidate) ? candidate : undefined
}

ipcMain.handle("ails-dialog:open-file", async (_event, payload) => {
  if (payload?.kind === "python") idePolicy.requireIde(applicationEdition())
  const options = {
    title: String(payload?.title || "파일 선택"),
    properties: payload?.multiple === true ? ["openFile", "multiSelections"] : ["openFile"],
    filters: dialogFiltersForKind(payload?.kind).map(filter => ({ ...filter, extensions: idePolicy.ideEnabled(applicationEdition()) ? filter.extensions : filter.extensions.filter(ext => ext !== "ipynb") })),
  }
  const defaultPath = dialogDefaultPath(payload?.initial_dir)
  if (defaultPath) options.defaultPath = defaultPath
  if (mainWindow && !mainWindow.isDestroyed()) options.window = mainWindow
  const result = await dialog.showOpenDialog(options)
  const paths = result.canceled ? [] : result.filePaths
  for (const selected of paths) idePolicy.requireDocument(applicationEdition(), selected)
  return { paths, path: paths[0] || "" }
})

ipcMain.handle("ails-dialog:open-directory", async (_event, payload) => {
  const options = {
    title: String(payload?.title || "폴더 선택"),
    properties: ["openDirectory"],
  }
  const defaultPath = dialogDefaultPath(payload?.initial_dir)
  if (defaultPath) options.defaultPath = defaultPath
  if (mainWindow && !mainWindow.isDestroyed()) options.window = mainWindow
  const result = await dialog.showOpenDialog(options)
  const paths = result.canceled ? [] : result.filePaths
  return { paths, path: paths[0] || "" }
})

ipcMain.handle("ails-dialog:save-office-copy", async (event, sourcePath) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || !tabTransfers.isRegisteredWorkspaceWindow(window)
    || event.senderFrame !== window.webContents.mainFrame || !isSameOriginUrl(event.senderFrame.url, appTargetUrl)) throw new Error("Untrusted workspace")
  const source = fs.realpathSync(String(sourcePath)), extension = path.extname(source).toLowerCase()
  if (![".docx", ".xlsx", ".csv", ".hwp", ".hwpx", ".html", ".htm"].includes(extension)) throw new Error("지원하지 않는 문서 형식입니다.")
  const result = await dialog.showSaveDialog(window, {
    title: "다른 이름으로 저장", defaultPath: path.join(path.dirname(source), `${path.basename(source, path.extname(source))} - 편집본${extension}`),
    filters: [{ name: `${extension.slice(1).toUpperCase()} 문서`, extensions: [extension.slice(1)] }],
  })
  if (result.canceled || !result.filePath) return { path: "" }
  const selected = path.resolve(result.filePath)
  if (path.extname(selected).toLowerCase() !== extension) throw new Error("같은 파일 형식으로 저장하세요.")
  const target = fs.existsSync(selected) ? fs.realpathSync(selected) : path.join(fs.realpathSync(path.dirname(selected)), path.basename(selected))
  // Grant the explicitly selected destination, including a not-yet-created
  // copy. Never grant its directory or derive permission from a source grant.
  externalDocuments.grant([target])
  return { path: target }
})

const gotLock = app.requestSingleInstanceLock()
markStartupPhase("main-ipc-ready")
if (!gotLock) {
  console.error("[AILS main] 이미 다른 AILS 프로세스가 실행 중이어서 단일 인스턴스 락(SingleInstanceLock)을 획득하지 못해 종료합니다.")
  app.quit()
} else {
  // Begin serving the renderer while Electron is still becoming ready. Only
  // the lock owner requests Vite, so opening a second file starts no new server.
  if (process.connected && process.env.AILS_DEV_LAUNCHER === "1") process.send({ type: "ails-dev-server-start" })
  const openExternalDocuments = (argv, cwd, packaged) => {
    try {
      const paths = documentPaths(argv, cwd, packaged)
      // Cold and already-running launches use the same editable AILS workspace.
      // Queue OS-selected documents before mounting React so restoration waits
      // for these files, without a separate reader or a later UI handoff.
      externalDocuments.enqueue(paths)
    }
    catch (error) { dialog.showErrorBox(APP_NAME, `파일 열기를 준비하지 못했습니다.\n${error.message}`) }
    if (app.isReady() && appTargetUrl) showWorkspaceWindow()
  }
  openExternalDocuments(process.argv, process.cwd(), app.isPackaged)
  app.on("second-instance", (_event, argv, cwd) => openExternalDocuments(argv, cwd, app.isPackaged))
  app.on("open-file", (event, file) => {
    event.preventDefault()
    openExternalDocuments([process.execPath, file], process.cwd(), true)
  })

  async function startWorkspace(background = false) {
    if (process.connected && process.env.AILS_DEV_LAUNCHER === "1") process.send({ type: "ails-dev-server-start" })
    // The real workspace already reports service preparation and retry errors.
    // Avoid starting a second renderer process for a transient splash window.
    while (!quitting) {
    try {
      const preferredPort = Number(process.env.AILS_PORT || DEFAULT_PORT)
      const fallbackPort = Number.isFinite(preferredPort) ? preferredPort : DEFAULT_PORT
      if (!frontendGateway) {
        markStartupPhase("gateway-start")
        const { createFrontendGateway } = require("./frontend-gateway.cjs")
        const gatewayPort = await findPort(fallbackPort)
        markStartupPhase("gateway-port-ready")
        frontendGateway = await createFrontendGateway({ frontendDir: frontendDir(), port: gatewayPort,
          token: LOCAL_API_TOKEN, uiOrigin: process.env.AILS_ELECTRON_DEV_URL || "",
          getInitialDocumentExtension: externalDocuments.initialExtension })
      }
      currentBackendPort = frontendGateway.port
      markStartupPhase("gateway-ready")
      const port = await findPort(currentBackendPort + 1)
      backendReady = false
      frontendGateway.setBackend(port, "starting")
      markStartupPhase("backend-start")
      startBackend(port)
      // Python and the static server do not need a ready Chromium session.
      // Start them while Electron initializes, then create its native window.
      await app.whenReady()
      markStartupPhase("electron-ready")
      if (quitting) return
      if (!background && mainWindow && !mainWindow.isDestroyed()) {
        // Initial bootstrap requests may have received a failure. A retry starts
        // a new renderer bootstrap rather than retaining an edition/error latch.
        await devServerReady
        appTargetUrl = process.env.AILS_ELECTRON_DEV_URL || `http://127.0.0.1:${currentBackendPort}/`
        installRendererContentSecurityPolicy(mainWindow.webContents, appTargetUrl, currentBackendPort)
        installLocalMediaAuthentication(mainWindow.webContents, appTargetUrl, currentBackendPort, LOCAL_API_TOKEN)
        void mainWindow.loadURL(appTargetUrl)
        createTray()
      } else if (!background) {
        createWindow(currentBackendPort)
      }
      // Even an async installer synchronously imports its dependency graph.
      // Keep optional developer tooling off the backend/first-frame path.
      if (!background) mainWindow.once("show", () => {
        const timer = setTimeout(() => { if (!quitting) void installReactDevTools() }, 3000)
        timer.unref()
      })
      // UI module evaluation and shell interactions now overlap Python startup.
      await Promise.all([waitForServer(port), devServerReady])
      if (quitting) return
      backendReady = true
      markStartupPhase("backend-ready")
      frontendGateway.setBackend(port, "ready")
      // MSIX/AppX packages are updated by Windows package deployment, not by
      // electron-updater's NSIS installer flow.
      if (
        app.isPackaged
        && applicationEdition() !== "personal"
        && !process.windowsStore
        && updatesEnabled(applicationEdition())
      ) {
        const { createPrivateUpdater } = require("./private-updater.cjs")
        updateController = createPrivateUpdater({
          app,
          dialog,
          getMainWindow: () => mainWindow,
          prepareToQuit: () => {
            quitting = true
          },
          channel: applicationEdition() === "developer" ? null : applicationEdition(),
          onStatusChange: (status) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("ails-update:status-changed", status)
            }
          },
        })
        updateController.start()
      }
      return
    } catch (error) {
      await stopBackend()
      frontendGateway?.setBackend(0, "failed", "로컬 백엔드를 시작하지 못했습니다.")
      if (quitting) return
      // A failed warmup must never interrupt reading or close the viewer.
      // The next explicit tool request can retry the shared preparation task.
      if (background) throw error
      await app.whenReady()
      if (quitting) return
      const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
      const failureDialog = {
        type: "error", title: APP_NAME, message: "AILS를 시작하지 못했습니다.",
        detail: error instanceof Error ? error.message : String(error),
        buttons: ["다시 시도", "닫기"], defaultId: 0, cancelId: 1,
      }
      const result = await (parentWindow ? dialog.showMessageBox(parentWindow, failureDialog) : dialog.showMessageBox(failureDialog))
      if (result.response === 0) continue
      quitting = true
      app.quit()
    }
    }
  }
  function ensureWorkspace(background = false) {
    if (!workspaceStarting) workspaceStarting = startWorkspace(background).catch(error => { workspaceStarting = null; throw error })
    return workspaceStarting
  }
  void ensureWorkspace()

  app.on("before-quit", () => {
    quitting = true
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  let resourcesClosed = false
  app.on("will-quit", (event) => {
    if (resourcesClosed) return
    event.preventDefault()
    frontendGateway?.close()
    windowsSpeech.dispose()
    updateController?.dispose()
    updateController = null
    void stopBackend().finally(() => {
      resourcesClosed = true
      app.quit()
    })
    tray?.destroy()
    tray = null
  })
}
