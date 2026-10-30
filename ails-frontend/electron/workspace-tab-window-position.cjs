// Cursor and native window bounds are DIP. Renderer origins and grab points
// are CSS pixels; apply renderer zoom once, then account for the frame inset.
function releasedTabWindowBounds({ point, size, origin, anchor, zoom = 1, inset = { x: 0, y: 0 } }) {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return { width: size.width, height: size.height,
    x: Math.round(point.x - (origin.x + anchor.x) * scale - inset.x),
    y: Math.round(point.y - (origin.y + anchor.y) * scale - inset.y) }
}
module.exports = { releasedTabWindowBounds }
