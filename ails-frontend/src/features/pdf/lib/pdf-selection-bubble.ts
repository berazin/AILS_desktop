import type { PdfAnnotationPoint } from "./pdf-annotation-geometry.ts"

type PageBounds = Pick<DOMRect, "left" | "top" | "width" | "height">
type ToolbarBounds = Pick<DOMRect, "left" | "right" | "top" | "bottom">

export function selectionBubbleOutsideToolbar(
  point: PdfAnnotationPoint,
  page: PageBounds,
  toolbar: ToolbarBounds | null,
  toolbarBelow: boolean,
  bubbleSize = 28,
): PdfAnnotationPoint {
  if (!toolbar) return point
  const x = page.left + point.x * page.width
  const y = page.top + point.y * page.height
  const clearance = bubbleSize / 2 + 4
  if (x <= toolbar.left - clearance || x >= toolbar.right + clearance
    || y <= toolbar.top - clearance || y >= toolbar.bottom + clearance) return point
  const outsideY = toolbarBelow ? toolbar.top - clearance : toolbar.bottom + clearance
  return { ...point, y: (outsideY - page.top) / Math.max(1, page.height) }
}
