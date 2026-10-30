// PillTabs' shared x/width surface and interrupted travel, adapted for AILS.
// Upstream MIT notice: ../vendor/liquid-taffy/NOTICE.md.
import { sampleHouseSpring, squirclePath } from "../vendor/liquid-taffy/core.ts"

export const TAB_SELECTION_DURATION = 300
export const TAB_SELECTION_FLARE = 8

export type TabSelectionGeometry = {
  x: number
  width: number
  height: number
  detached: number
  stretch: number
}

const ease = (time: number) => time < 0.5 ? 4 * time ** 3 : 1 - (-2 * time + 2) ** 3 / 2
const mix = (from: number, to: number, progress: number) => from + (to - from) * progress

// Tab rearrangement shares the selection surface's travel clock and easing.
export const tabTravelProgress = (elapsed: number) => ease(Math.max(0, Math.min(1, elapsed / TAB_SELECTION_DURATION)))

export function sampleTabSelection(from: TabSelectionGeometry, to: TabSelectionGeometry, elapsed: number) {
  const time = Math.max(0, Math.min(1, elapsed / TAB_SELECTION_DURATION))
  // Reattach a settings silhouette before travel and detach it only after
  // landing. The baseline stays connected throughout horizontal movement.
  const movementStart = from.detached > 0 ? 0.2 : 0
  const movementEnd = to.detached > 0 ? 0.8 : 1
  const stretchTime = Math.max(0, Math.min(1, (time - movementStart) / (movementEnd - movementStart)))
  const travel = ease(stretchTime)
  const peakStretch = Math.min(6, to.width * 0.04)
  const stretch = stretchTime < 0.25
    ? mix(from.stretch, peakStretch, ease(stretchTime / 0.25))
    : peakStretch * (1 - sampleHouseSpring((stretchTime - 0.25) / 0.75))
  const detached = time < movementStart
    ? mix(from.detached, 0, ease(time / movementStart))
    : to.detached > 0 ? to.detached * ease(Math.max(0, (time - movementEnd) / (1 - movementEnd))) : 0
  return {
    // Carry deformation separately so repeated interruptions cannot add
    // another stretch to an already stretched width.
    x: mix(from.x + from.stretch / 2, to.x, travel) - stretch / 2,
    width: mix(from.width - from.stretch, to.width, travel) + stretch,
    height: mix(from.height, to.height, travel),
    detached,
    stretch,
  }
}

// Three cubic segments per quadrant, matching squirclePath's command topology.
// One filled path owns the rounded top AND both lower flares: no overlapping
// alpha fills, seams, vertical scaling, or separately fading corners.
function arc(cx: number, cy: number, radius: number, start: number, end: number) {
  return Array.from({ length: 3 }, (_, index) => {
    const a = start + (end - start) * index / 3
    const b = start + (end - start) * (index + 1) / 3
    const k = 4 / 3 * Math.tan((b - a) / 4)
    return `C ${cx + radius * (Math.cos(a) - k * Math.sin(a))} ${cy + radius * (Math.sin(a) + k * Math.cos(a))} ${cx + radius * (Math.cos(b) + k * Math.sin(b))} ${cy + radius * (Math.sin(b) - k * Math.cos(b))} ${cx + radius * Math.cos(b)} ${cy + radius * Math.sin(b)}`
  }).join(" ")
}

export function tabSelectionPath(width: number, height: number, detached: number, bottomBleed = 0) {
  const left = TAB_SELECTION_FLARE
  const right = left + width
  const radius = Math.min(12, width / 2, height / 2)
  const flare = TAB_SELECTION_FLARE
  // Paint past the clipped baseline so its antialiasing cannot mix the dark
  // title bar into the last physical pixel. Detached settings keep their size.
  const connectedHeight = height + bottomBleed
  const connected = [
    `M ${left + radius} 0 L ${right - radius} 0`,
    arc(right - radius, radius, radius, -Math.PI / 2, 0),
    `L ${right} ${connectedHeight - flare}`,
    arc(right + flare, connectedHeight - flare, flare, Math.PI, Math.PI / 2),
    `L ${left - flare} ${connectedHeight}`,
    arc(left - flare, connectedHeight - flare, flare, Math.PI / 2, 0),
    `L ${left} ${radius}`,
    arc(left + radius, radius, radius, Math.PI, Math.PI * 1.5),
    "Z",
  ].join(" ")
  if (detached <= 0) return connected
  const separate = squirclePath(left + 0.5, 0.5, Math.max(1, width - 1), Math.max(1, height - 5), 11)
  if (detached >= 1) return separate
  const number = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi
  const target = [...separate.matchAll(number)].map(match => Number(match[0]))
  let index = 0
  return connected.replace(number, value => String(mix(Number(value), target[index++], detached)))
}
