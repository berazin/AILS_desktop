export type PracticeWindowBounds = { x: number; y: number; width: number; height: number }
type Viewport = { width: number; height: number }

export function clampPracticeWindowBounds(value: PracticeWindowBounds, viewport: Viewport): PracticeWindowBounds {
  const width = Math.max(Math.min(360, viewport.width - 16), Math.min(value.width, viewport.width - 16))
  const height = Math.max(Math.min(320, viewport.height - 16), Math.min(value.height, viewport.height - 16))
  return { width, height, x: Math.max(8, Math.min(value.x, viewport.width - width - 8)), y: Math.max(8, Math.min(value.y, viewport.height - height - 8)) }
}

export function readPracticeWindowBounds(storage: Pick<Storage, "getItem">, key: string, fallback: PracticeWindowBounds, viewport: Viewport) {
  try {
    const value = JSON.parse(storage.getItem(key) || "null")
    if (value && [value.x, value.y, value.width, value.height].every(item => typeof item === "number" && Number.isFinite(item))
      && value.width > 0 && value.height > 0) return clampPracticeWindowBounds(value, viewport)
  } catch { /* Missing or unreadable preferences use the default window. */ }
  return clampPracticeWindowBounds(fallback, viewport)
}

export function writePracticeWindowBounds(storage: Pick<Storage, "setItem">, key: string, bounds: PracticeWindowBounds) {
  try { storage.setItem(key, JSON.stringify(bounds)) } catch { /* A preference failure must not block editing. */ }
}
