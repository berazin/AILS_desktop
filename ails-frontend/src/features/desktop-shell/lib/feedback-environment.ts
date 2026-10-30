type Size = { width: number; height: number }

export interface NativeFeedbackEnvironment {
  app: { version: string; edition: string; packaged: boolean; architecture: string }
  os: { name: string; release: string; platform: string; architecture: string }
  runtime: { electron: string; chromium: string; node: string }
  cpu: { model: string; logicalCores: number }
  memory: { totalGiB: number; availableGiB: number }
  window: { boundsDip: Size; contentDip: Size; zoomFactor: number; maximized: boolean; fullscreen: boolean }
  displayCount: number
  displays: Array<{ current: boolean; primary: boolean; logicalDip: Size; pixels: Size; scaleFactor: number; refreshHz: number; rotation: number }>
  graphicsFeatures: Record<string, string>
  gpu: { devices: Array<{ name: string; vendorId: number; deviceId: number; active: boolean }>; driverVersion: string; renderer: string } | null
}

export interface FeedbackEnvironment {
  capturedAt: string
  native: NativeFeedbackEnvironment | null
  viewport: Size
  devicePixelRatio: number
  language: string
  timezone: string
  theme: "dark" | "light"
  online: boolean
}

export interface FeedbackBridge {
  get_feedback_environment?: () => Promise<NativeFeedbackEnvironment>
}

export async function collectFeedbackEnvironment(bridge?: FeedbackBridge): Promise<FeedbackEnvironment> {
  let native: NativeFeedbackEnvironment | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (bridge?.get_feedback_environment) native = await Promise.race([
      bridge.get_feedback_environment(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2200) }),
    ])
  } catch {
    // Browser-only and older desktop runtimes cannot supply native diagnostics.
  } finally { clearTimeout(timer) }
  return {
    capturedAt: new Date().toISOString(), native,
    viewport: { width: window.innerWidth, height: window.innerHeight }, devicePixelRatio: window.devicePixelRatio,
    language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light", online: navigator.onLine,
  }
}

const dimensions = (value: Size) => `${value.width} x ${value.height}`

export function formatFeedbackEnvironment(environment: FeedbackEnvironment) {
  const { native } = environment
  const lines = [
    `- Captured: ${environment.capturedAt}`,
    `- Viewport (CSS px): ${dimensions(environment.viewport)}; device pixel ratio: ${environment.devicePixelRatio}`,
    `- UI: ${environment.theme}; language ${environment.language}; timezone ${environment.timezone}; browser online: ${environment.online}`,
  ]
  if (native) {
    lines.push(
      `- AILS: ${native.app.version}; ${native.app.edition}; ${native.app.packaged ? "installed" : "development"}; app architecture: ${native.app.architecture}`,
      `- OS: ${native.os.name} (${native.os.architecture}); build ${native.os.release}`,
      `- Runtime: Electron ${native.runtime.electron}; Chromium ${native.runtime.chromium}; Node ${native.runtime.node}`,
      `- CPU: ${native.cpu.model}; ${native.cpu.logicalCores} logical cores`,
      `- RAM (GiB): ${native.memory.totalGiB} total; ${native.memory.availableGiB} available`,
      `- Window outer (DIP): ${dimensions(native.window.boundsDip)}; content (DIP): ${dimensions(native.window.contentDip)}`,
      `- Window state: ${native.window.fullscreen ? "fullscreen" : native.window.maximized ? "maximized" : "normal"}; renderer zoom: ${Math.round(native.window.zoomFactor * 100)}%`,
      `- Displays connected: ${native.displayCount}`,
    )
    native.displays.forEach((display, index) => lines.push(
      `- Display ${index + 1}${display.current ? " (app monitor)" : ""}${display.primary ? " (primary)" : ""}: ${dimensions(display.pixels)} px; ${dimensions(display.logicalDip)} DIP; scaling ${Math.round(display.scaleFactor * 100)}%; ${display.refreshHz} Hz; rotation ${display.rotation}°`,
    ))
    if (native.gpu) {
      native.gpu.devices.forEach((device, index) => lines.push(`- GPU ${index + 1}: ${device.name || `vendor ${device.vendorId}, device ${device.deviceId}`}${device.active ? " (active)" : ""}`))
      lines.push(`- GPU driver: ${native.gpu.driverVersion || "unavailable"}; renderer: ${native.gpu.renderer || "unavailable"}`)
    } else lines.push("- GPU details: unavailable")
    lines.push(`- Graphics: ${Object.entries(native.graphicsFeatures).map(([key, value]) => `${key}=${value || "unavailable"}`).join("; ")}`)
  } else lines.push("- Native OS, display and hardware diagnostics: unavailable")
  const text = lines.join("\n")
  // The existing authenticated feedback endpoint allows 6000 characters in total.
  return text.length > 1800 ? `${text.slice(0, 1760)}\n- Additional environment details omitted.` : text
}

export function feedbackBody(description: string, environment: FeedbackEnvironment | null) {
  return ["## Feedback", description.trim(), ...(environment ? ["", "## Environment", formatFeedbackEnvironment(environment)] : [])].join("\n").trim()
}
