/* Portions Copyright (c) 2026 arknow91. MIT.
 * Adapted from https://github.com/arknow91/liquid-taffy
 * Revision: 4bcf4005f857c371bf53d60b2cee14abcecedf6a
 * Sources: src/components/liquid/{goo,springs,squircle}.ts
 * Full notice ships in public/licenses/liquid-taffy/LICENSE.txt.
 * AILS samples the original spring points with requestAnimationFrame.
 */

export const GOO_RIM_THRESHOLDS: Record<number, readonly [number, number]> = {
  1: [-14.5146, -24.6721],
  4: [-12.25, -14.25],
  5: [-12.7296, -15.063],
  7: [-11.6925, -13.245],
}

export function gooThreshold(offset: number, contrast = 30) {
  return `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${contrast} ${offset}`
}

export function applyGooBlur(elements: {
  blur: SVGFEGaussianBlurElement | null
  rim: SVGFEColorMatrixElement | null
  inner: SVGFEColorMatrixElement | null
}, sigma: number) {
  const [outer, inside] = GOO_RIM_THRESHOLDS[sigma]
  elements.blur?.setAttribute("stdDeviation", String(sigma))
  elements.rim?.setAttribute("values", gooThreshold(outer))
  elements.inner?.setAttribute("values", gooThreshold(inside))
}

export const HOUSE_SPRING_POINTS: readonly [number, number][] = [
  [0.028, 0.0289], [0.056, 0.1062], [0.083, 0.2182], [0.111, 0.3519],
  [0.139, 0.4957], [0.167, 0.6396], [0.194, 0.7755], [0.222, 0.8974],
  [0.25, 1.0013], [0.278, 1.0849], [0.306, 1.1474], [0.333, 1.1896],
  [0.361, 1.213], [0.389, 1.22], [0.417, 1.2134], [0.444, 1.1961],
  [0.472, 1.1714], [0.5, 1.1419], [0.528, 1.1102], [0.556, 1.0786],
  [0.583, 1.0487], [0.611, 1.022], [0.639, 0.9992], [0.667, 0.981],
  [0.694, 0.9673], [0.722, 0.9581], [0.75, 0.9531], [0.778, 0.9516],
  [0.806, 0.9531], [0.833, 0.957], [0.861, 0.9624], [0.889, 0.969],
  [0.917, 0.9759], [0.944, 0.9829], [0.972, 0.9894], [1, 1],
]

export function sampleHouseSpring(time: number) {
  const t = Math.max(0, Math.min(1, time))
  let previous: readonly [number, number] = [0, 0]
  for (const next of HOUSE_SPRING_POINTS) {
    if (t <= next[0]) return previous[1] + (next[1] - previous[1]) * (t - previous[0]) / (next[0] - previous[0])
    previous = next
  }
  return 1
}

export function squirclePath(x: number, y: number, w: number, h: number, r: number) {
  const s = Math.min(r * 1.528665, w / 2, h / 2)
  const u = (k: number) => s * (k / 1.528665)
  const c = [1.528665, 1.08849, 0.86840, 0.63149, 0.37283, 0.16906, 0.07491].map(u)
  const [c0, c1, c2, c3, c4, c5, c6] = c
  return [
    `M ${x + c0} ${y}`, `L ${x + w - c0} ${y}`,
    `C ${x + w - c1} ${y} ${x + w - c2} ${y} ${x + w - c3} ${y + c6}`,
    `C ${x + w - c4} ${y + c5} ${x + w - c5} ${y + c4} ${x + w - c6} ${y + c3}`,
    `C ${x + w} ${y + c2} ${x + w} ${y + c1} ${x + w} ${y + c0}`,
    `L ${x + w} ${y + h - c0}`,
    `C ${x + w} ${y + h - c1} ${x + w} ${y + h - c2} ${x + w - c6} ${y + h - c3}`,
    `C ${x + w - c5} ${y + h - c4} ${x + w - c4} ${y + h - c5} ${x + w - c3} ${y + h - c6}`,
    `C ${x + w - c2} ${y + h} ${x + w - c1} ${y + h} ${x + w - c0} ${y + h}`,
    `L ${x + c0} ${y + h}`,
    `C ${x + c1} ${y + h} ${x + c2} ${y + h} ${x + c3} ${y + h - c6}`,
    `C ${x + c4} ${y + h - c5} ${x + c5} ${y + h - c4} ${x + c6} ${y + h - c3}`,
    `C ${x} ${y + h - c2} ${x} ${y + h - c1} ${x} ${y + h - c0}`,
    `L ${x} ${y + c0}`,
    `C ${x} ${y + c1} ${x} ${y + c2} ${x + c6} ${y + c3}`,
    `C ${x + c5} ${y + c4} ${x + c4} ${y + c5} ${x + c3} ${y + c6}`,
    `C ${x + c2} ${y} ${x + c1} ${y} ${x + c0} ${y}`, "Z",
  ].join(" ")
}
