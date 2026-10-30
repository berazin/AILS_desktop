export const PDF_SPREAD_ZOOM_ANCHOR_BIAS = 0.15

export function pdfSpreadZoomShiftX(
  slotWidth: number,
  zoom: number,
  side: "left" | "right",
): number {
  const safeZoom = Number.isFinite(zoom) ? Math.max(0.1, zoom) : 1
  const outward = Math.max(0, slotWidth) * PDF_SPREAD_ZOOM_ANCHOR_BIAS * (safeZoom - 1)
  if (!outward) return 0
  return side === "left" ? -outward : outward
}