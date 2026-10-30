const os = require("node:os")

const gpuSnapshots = new WeakMap()
const clean = (value, limit = 100) => String(value ?? "").replace(/[\r\n\t]/g, " ").slice(0, limit)
const size = value => ({ width: Math.round(value.width), height: Math.round(value.height) })

function architecture(value) {
  const name = String(value || "").toLowerCase()
  return ({ amd64: "x64", x86_64: "x64", x86: "x86", ia32: "x86", aarch64: "arm64", arm64: "arm64" })[name] || name || "unknown"
}

function gpuSnapshot(app) {
  if (!gpuSnapshots.has(app)) {
    gpuSnapshots.set(app, (async () => {
      let timer
      try {
        const info = await Promise.race([
          app.getGPUInfo("basic"),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("GPU timeout")), 1500) }),
        ])
        return {
          devices: (info.gpuDevice || []).slice(0, 2).map(device => ({
            name: clean(device.deviceString, 80), vendorId: device.vendorId, deviceId: device.deviceId, active: Boolean(device.active),
          })),
          driverVersion: clean(info.auxAttributes?.driverVersion, 60),
          renderer: clean(info.auxAttributes?.glRenderer, 120),
        }
      } catch {
        return null
      } finally { clearTimeout(timer) }
    })())
  }
  return gpuSnapshots.get(app)
}

async function collectFeedbackEnvironment({ app, screen, window, edition, osModule = os, processInfo = process }) {
  const gpu = await gpuSnapshot(app)
  if (window.isDestroyed()) throw new Error("Feedback window was closed")
  const displays = screen.getAllDisplays()
  const current = screen.getDisplayMatching(window.getBounds())
  const primary = screen.getPrimaryDisplay()
  const cpus = osModule.cpus()
  const features = app.getGPUFeatureStatus()
  const result = {
    app: { version: clean(app.getVersion(), 40), edition: clean(edition, 20), packaged: app.isPackaged, architecture: architecture(processInfo.arch) },
    os: {
      name: clean(osModule.version()), release: clean(osModule.release(), 40), platform: clean(processInfo.platform, 20),
      architecture: architecture(osModule.machine?.() || processInfo.env.PROCESSOR_ARCHITEW6432 || processInfo.env.PROCESSOR_ARCHITECTURE || osModule.arch()),
    },
    runtime: { electron: clean(processInfo.versions.electron, 30), chromium: clean(processInfo.versions.chrome, 30), node: clean(processInfo.versions.node, 30) },
    cpu: { model: clean(cpus[0]?.model), logicalCores: cpus.length },
    memory: { totalGiB: +(osModule.totalmem() / 1024 ** 3).toFixed(2), availableGiB: +(osModule.freemem() / 1024 ** 3).toFixed(2) },
    window: { boundsDip: size(window.getBounds()), contentDip: size(window.getContentBounds()), zoomFactor: window.webContents.getZoomFactor(), maximized: window.isMaximized(), fullscreen: window.isFullScreen() },
    displayCount: displays.length,
    displays: [current, ...displays.filter(display => display.id !== current.id)].slice(0, 6).map(display => ({
      current: display.id === current.id, primary: display.id === primary.id,
      logicalDip: size(display.bounds),
      pixels: { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) },
      scaleFactor: display.scaleFactor, refreshHz: display.displayFrequency, rotation: display.rotation,
    })),
    graphicsFeatures: Object.fromEntries(["gpu_compositing", "rasterization", "video_decode", "webgl"].map(key => [key, clean(features[key], 40)])),
  }
  result.gpu = gpu
  return result
}

function registerFeedbackEnvironment({ ipcMain, BrowserWindow, app, screen, getEdition }) {
  ipcMain.handle("ails-feedback:environment", event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed() || event.senderFrame !== event.sender.mainFrame) throw new Error("Feedback environment requires an AILS window")
    return collectFeedbackEnvironment({ app, screen, window, edition: getEdition() })
  })
}

module.exports = { architecture, collectFeedbackEnvironment, registerFeedbackEnvironment }
