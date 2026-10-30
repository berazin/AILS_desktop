export type PdfPageGeometry = { width: number; height: number; dpr: number }

export function observePdfPageGeometry(element: HTMLElement, onChange: (geometry: PdfPageGeometry) => void) {
  let current: PdfPageGeometry | null = null
  let resolution: MediaQueryList | null = null

  const update = () => {
    const bounds = element.getBoundingClientRect()
    const next = { width: Math.round(bounds.width), height: Math.round(bounds.height), dpr: window.devicePixelRatio || 1 }
    if (current?.width === next.width && current.height === next.height && current.dpr === next.dpr) return
    current = next
    onChange(next)
  }

  const observeResolution = () => {
    resolution?.removeEventListener('change', handleResolutionChange)
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    resolution.addEventListener('change', handleResolutionChange)
  }

  function handleResolutionChange() {
    // Re-arm at the new DPR so repeated moves between monitors are detected.
    observeResolution()
    update()
  }

  update()
  const resize = new ResizeObserver(update)
  resize.observe(element)
  observeResolution()
  return () => {
    resize.disconnect()
    resolution?.removeEventListener('change', handleResolutionChange)
  }
}
