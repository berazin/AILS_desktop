export type WindowResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

const CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE = 5
const CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE = 10
const CODE_SANDBOX_CONSOLE_RESIZE_HIT_ZONE = 5

export function codeSandboxResizeDirection(element: HTMLElement, clientX: number, clientY: number): WindowResizeDirection | "" {
  const rect = element.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return ""
  const nearCornerLeft = x <= CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  const nearCornerRight = x >= rect.width - CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  const nearCornerTop = y <= CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  const nearCornerBottom = y >= rect.height - CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  if (nearCornerTop && nearCornerLeft) return "nw"
  if (nearCornerTop && nearCornerRight) return "ne"
  if (nearCornerBottom && nearCornerLeft) return "sw"
  if (nearCornerBottom && nearCornerRight) return "se"
  if (y <= CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "n"
  if (y >= rect.height - CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "s"
  if (x <= CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "w"
  if (x >= rect.width - CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "e"
  return ""
}

export function codeSandboxResizeCursor(direction: WindowResizeDirection | ""): string | undefined {
  return direction ? `${direction}-resize` : undefined
}

export function isConsoleTopResizeHit(element: HTMLElement, clientY: number): boolean {
  const rect = element.getBoundingClientRect()
  const offsetY = clientY - rect.top
  return offsetY >= 0 && offsetY <= CODE_SANDBOX_CONSOLE_RESIZE_HIT_ZONE
}
