export function tabHoverPreviewGeometry(anchor: { left: number; bottom: number }, viewport: { width: number; height: number }) {
  const aspect = 16 / 9
  // Keep the original frame shape and shrink only to fit the current window.
  const maxWidth = Math.max(1, Math.min(318, viewport.width - 18))
  const maxHeight = Math.max(1, Math.min(320, viewport.height - Math.max(8, anchor.bottom + 8) - 54))
  const imageWidth = Math.min(maxWidth, maxHeight * aspect)
  const width = imageWidth + 2, height = imageWidth / aspect + 46 // title 44px + borders
  return { width, aspect,
    left: Math.max(8, Math.min(anchor.left, viewport.width - width - 8)),
    top: Math.max(8, Math.min(anchor.bottom + 8, viewport.height - height - 8)) }
}
