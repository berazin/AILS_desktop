export type PdfAnnotationPoint = {
  x: number
  y: number
  pressure?: number
}

export type PdfAnnotationRect = {
  x: number
  y: number
  width: number
  height: number
}

export type CorrectedPdfShape =
  | { kind: "line"; points: [PdfAnnotationPoint, PdfAnnotationPoint] }
  | { kind: "ellipse"; rect: PdfAnnotationRect }

const PLUS_MAXIMUM_FOLLOW_DISTANCE = 44

export function clampAnnotationPoint(point: PdfAnnotationPoint): PdfAnnotationPoint {
  return {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y)),
    pressure: point.pressure == null ? undefined : Math.max(0, Math.min(1, point.pressure)),
  }
}

export function annotationRectFromPoints(
  start: PdfAnnotationPoint,
  end: PdfAnnotationPoint,
): PdfAnnotationRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function annotationTextCharacterRects(text: string, rect: PdfAnnotationRect) {
  const characters = Array.from(text)
  if (characters.length === 0 || rect.width <= 0 || rect.height <= 0) return []
  const vertical = characters.length > 1 && rect.height > rect.width * 1.8
  return characters.map((_, index) => vertical
    ? {
        x: rect.x,
        y: rect.y + rect.height * index / characters.length,
        width: rect.width,
        height: rect.height / characters.length,
      }
    : {
        x: rect.x + rect.width * index / characters.length,
        y: rect.y,
        width: rect.width / characters.length,
        height: rect.height,
      })
}

export function annotationSelectionFlowRects(
  characters: readonly PdfAnnotationRect[],
  startPosition: number,
  endPosition: number,
) {
  const start = characters[startPosition]
  if (!start) return []
  const first = Math.min(startPosition, endPosition)
  const last = Math.max(startPosition, endPosition)
  const sameLine = characters
    .filter((rect) => {
      const overlap = Math.max(0, Math.min(start.y + start.height, rect.y + rect.height) - Math.max(start.y, rect.y))
      return overlap / Math.max(0.000001, Math.min(start.height, rect.height)) >= 0.45
    })
    .sort((left, right) => left.x - right.x)
  const startLineIndex = sameLine.indexOf(start)
  if (startLineIndex < 0) return characters.slice(first, last + 1)
  const maximumGap = Math.max(start.height * 0.45, start.width * 1.2)
  let left = startLineIndex
  let right = startLineIndex
  while (left > 0 && sameLine[left].x - (sameLine[left - 1].x + sameLine[left - 1].width) <= maximumGap) left -= 1
  while (right < sameLine.length - 1 && sameLine[right + 1].x - (sameLine[right].x + sameLine[right].width) <= maximumGap) right += 1
  const flowLeft = sameLine[left].x - maximumGap
  const flowRight = sameLine[right].x + sameLine[right].width + maximumGap
  return characters.slice(first, last + 1).filter((rect) => rect.x + rect.width >= flowLeft && rect.x <= flowRight)
}

export function annotationSpreadEdgePoints(
  previousPoint: PdfAnnotationPoint,
  previousBounds: { left: number; top: number; right: number; width: number; height: number },
  targetBounds: { left: number; top: number; right: number; width: number; height: number },
  clientPoint: { x: number; y: number },
) {
  const previousClient = {
    x: previousBounds.left + previousPoint.x * previousBounds.width,
    y: previousBounds.top + previousPoint.y * previousBounds.height,
  }
  const movingRight = targetBounds.left >= previousBounds.right
  const previousEdgeX = movingRight ? previousBounds.right : previousBounds.left
  const targetEdgeX = movingRight ? targetBounds.left : targetBounds.right
  const deltaX = clientPoint.x - previousClient.x
  const yAt = (x: number) => Math.abs(deltaX) < 0.001
    ? clientPoint.y
    : previousClient.y + (clientPoint.y - previousClient.y) * (x - previousClient.x) / deltaX
  return {
    previous: clampAnnotationPoint({
      x: movingRight ? 1 : 0,
      y: (yAt(previousEdgeX) - previousBounds.top) / Math.max(1, previousBounds.height),
    }),
    target: clampAnnotationPoint({
      x: movingRight ? 0 : 1,
      y: (yAt(targetEdgeX) - targetBounds.top) / Math.max(1, targetBounds.height),
    }),
  }
}

export function annotationPlusPointNearestToPointer(
  rects: readonly PdfAnnotationRect[],
  pointer: PdfAnnotationPoint,
  viewportWidth: number,
  viewportHeight: number,
  clampResult = true,
): PdfAnnotationPoint {
  const screenWidth = Math.max(1, viewportWidth)
  const screenHeight = Math.max(1, viewportHeight)
  let closest: { point: PdfAnnotationPoint; rect: PdfAnnotationRect; distance: number; pointerInside: boolean } | null = null
  for (const rect of rects) {
    const left = rect.x
    const right = rect.x + rect.width
    const top = rect.y
    const bottom = rect.y + rect.height
    let x = Math.max(left, Math.min(right, pointer.x))
    let y = Math.max(top, Math.min(bottom, pointer.y))
    const pointerInside = pointer.x >= left && pointer.x <= right && pointer.y >= top && pointer.y <= bottom
    if (pointerInside) {
      const edges = [
        { distance: (pointer.x - left) * screenWidth, x: left, y: pointer.y },
        { distance: (right - pointer.x) * screenWidth, x: right, y: pointer.y },
        { distance: (pointer.y - top) * screenHeight, x: pointer.x, y: top },
        { distance: (bottom - pointer.y) * screenHeight, x: pointer.x, y: bottom },
      ]
      const edge = edges.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best)
      x = edge.x
      y = edge.y
    }
    const distance = Math.hypot((pointer.x - x) * screenWidth, (pointer.y - y) * screenHeight)
    if (!closest || distance < closest.distance) closest = { point: { x, y }, rect, distance, pointerInside }
  }
  const finish = (point: PdfAnnotationPoint) => clampResult ? clampAnnotationPoint(point) : point
  if (!closest) return finish(pointer)
  if (closest.pointerInside) return finish(pointer)

  const center = { x: closest.rect.x + closest.rect.width / 2, y: closest.rect.y + closest.rect.height / 2 }
  const pointerDistance = Math.hypot(
    (pointer.x - closest.point.x) * screenWidth,
    (pointer.y - closest.point.y) * screenHeight,
  )
  let dx = (pointer.x - closest.point.x) * screenWidth
  let dy = (pointer.y - closest.point.y) * screenHeight
  if (Math.hypot(dx, dy) < 0.001) {
    dx = (closest.point.x - center.x) * screenWidth
    dy = (closest.point.y - center.y) * screenHeight
  }
  const length = Math.max(0.001, Math.hypot(dx, dy))
  const followDistance = Math.max(14, Math.min(PLUS_MAXIMUM_FOLLOW_DISTANCE, pointerDistance))
  return finish({
    x: closest.point.x + dx / length * followDistance / screenWidth,
    y: closest.point.y + dy / length * followDistance / screenHeight,
  })
}

export function annotationPointerWithinPlusRange(
  rects: readonly PdfAnnotationRect[],
  pointer: PdfAnnotationPoint,
  viewportWidth: number,
  viewportHeight: number,
) {
  const screenWidth = Math.max(1, viewportWidth)
  const screenHeight = Math.max(1, viewportHeight)
  return rects.some((rect) => {
    const x = Math.max(rect.x, Math.min(rect.x + rect.width, pointer.x))
    const y = Math.max(rect.y, Math.min(rect.y + rect.height, pointer.y))
    return Math.hypot((pointer.x - x) * screenWidth, (pointer.y - y) * screenHeight) <= PLUS_MAXIMUM_FOLLOW_DISTANCE
  })
}

export function annotationPointsToPath(points: readonly PdfAnnotationPoint[]) {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    const next = points[index + 1]
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`
  }
  const last = points[points.length - 1]
  path += ` L ${last.x} ${last.y}`
  return path
}

export function annotationConnectorPointsToPath(points: readonly PdfAnnotationPoint[]) {
  if (points.length < 3) return annotationPointsToPath(points)
  const joinIndex = points.findIndex((point, index) => index >= 2 && Math.hypot(
    point.x - points[index - 1].x,
    point.y - points[index - 1].y,
  ) <= 0.0000001)
  if (joinIndex >= 2) {
    const extensionPath = annotationPointsToPath(points.slice(0, joinIndex))
    const strokePoints = points.slice(joinIndex)
    const strokePath = annotationPointsToPath(strokePoints)
    const anchor = strokePoints[0]
    return `${extensionPath}${strokePath.slice(`M ${anchor.x} ${anchor.y}`.length)}`
  }
  const start = points[0]
  const anchor = points[1]
  const strokePath = annotationPointsToPath(points.slice(1))
  const strokeMove = `M ${anchor.x} ${anchor.y}`
  return `M ${start.x} ${start.y} L ${anchor.x} ${anchor.y}${strokePath.slice(strokeMove.length)}`
}

function annotationSeedUnit(seed: number, salt: number) {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return (value >>> 0) / 0xffffffff
}

function annotationSeedOffset(seed: number, salt: number, amount: number) {
  return (annotationSeedUnit(seed, salt) * 2 - 1) * amount
}

export function annotationHandwrittenEllipsePath(
  rect: PdfAnnotationRect,
  seed: number,
  paddingX = 0,
  paddingY = 0,
) {
  const horizontalAsymmetry = annotationSeedOffset(seed, 1, Math.max(0.0004, paddingX * 0.12))
  const verticalAsymmetry = annotationSeedOffset(seed, 2, Math.max(0.00025, paddingY * 0.1))
  const centerX = rect.x + rect.width / 2 + horizontalAsymmetry / 2
  const centerY = rect.y + rect.height / 2 + verticalAsymmetry / 2
  const radiusX = rect.width / 2 + paddingX
  const radiusY = rect.height / 2 + paddingY
  const phase = annotationSeedUnit(seed, 3) * Math.PI * 2
  const points = Array.from({ length: 23 }, (_, index) => {
    const angle = -0.08 + index / 22 * (Math.PI * 2 + 0.2)
    const lowFrequency = 1
      + Math.sin(angle + phase) * 0.008
      + Math.sin(angle * 2 - phase * 0.7) * 0.004
    return clampAnnotationPoint({
      x: centerX + Math.cos(angle) * radiusX * lowFrequency,
      y: centerY + Math.sin(angle) * radiusY * (2 - lowFrequency),
    })
  })
  return annotationPointsToPath(points)
}

export function annotationHandwrittenUnderlinePath(rect: PdfAnnotationRect, seed: number) {
  const overshoot = Math.max(0.0015, Math.min(0.006, rect.height * 0.18))
  const startX = Math.max(0, rect.x - overshoot * (0.7 + annotationSeedUnit(seed, 4) * 0.5))
  const endX = Math.min(1, rect.x + rect.width + overshoot * (0.8 + annotationSeedUnit(seed, 5) * 0.6))
  const baseline = Math.min(1, rect.y + rect.height + Math.max(0.0005, rect.height * 0.06))
  const amplitude = Math.max(0.00025, Math.min(0.0011, rect.height * 0.045))
  return annotationPointsToPath(Array.from({ length: 6 }, (_, index) => ({
    x: startX + (endX - startX) * index / 5,
    y: baseline + annotationSeedOffset(seed, 10 + index, amplitude),
  })))
}

export function annotationHandwrittenHighlightPath(rect: PdfAnnotationRect, seed: number) {
  const overshoot = Math.max(0.001, Math.min(0.004, rect.height * 0.12))
  const left = Math.max(0, rect.x - overshoot * (0.5 + annotationSeedUnit(seed, 20)))
  const right = Math.min(1, rect.x + rect.width + overshoot * (0.5 + annotationSeedUnit(seed, 21)))
  const top = rect.y + rect.height * 0.1
  const bottom = rect.y + rect.height * 0.92
  const wobble = Math.max(0.0002, Math.min(0.0008, rect.height * 0.035))
  return [
    `M ${left} ${top + annotationSeedOffset(seed, 22, wobble)}`,
    `Q ${(left + right) / 2} ${top + annotationSeedOffset(seed, 23, wobble)} ${right} ${top + annotationSeedOffset(seed, 24, wobble)}`,
    `L ${right} ${bottom + annotationSeedOffset(seed, 25, wobble)}`,
    `Q ${(left + right) / 2} ${bottom + annotationSeedOffset(seed, 26, wobble)} ${left} ${bottom + annotationSeedOffset(seed, 27, wobble)}`,
    "Z",
  ].join(" ")
}

export function annotationHandwrittenLinePath(points: readonly PdfAnnotationPoint[], seed: number) {
  if (points.length !== 2) return annotationPointsToPath(points)
  const [start, end] = points
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length <= 0.000001) return annotationPointsToPath(points)
  const bend = Math.min(0.0025, length * 0.018) * (annotationSeedUnit(seed, 30) < 0.5 ? -1 : 1)
  const controlX = (start.x + end.x) / 2 - dy / length * bend
  const controlY = (start.y + end.y) / 2 + dx / length * bend
  return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`
}

export function annotationHandwrittenArrowHeadPath(seed: number) {
  const upper = 0.45 + annotationSeedOffset(seed, 31, 0.18)
  const lower = 5.55 + annotationSeedOffset(seed, 32, 0.18)
  const tipY = 3 + annotationSeedOffset(seed, 33, 0.1)
  return `M 0.55 ${upper} Q 2.7 ${1.55 + annotationSeedOffset(seed, 34, 0.12)} 5.35 ${tipY} Q 2.65 ${4.45 + annotationSeedOffset(seed, 35, 0.12)} 0.65 ${lower}`
}

export function compactAnnotationPoints(
  points: readonly PdfAnnotationPoint[],
  minimumDistance = 0.0015,
  clampResult = true,
) {
  const normalize = clampResult ? clampAnnotationPoint : (point: PdfAnnotationPoint) => ({ ...point })
  if (points.length <= 2) return points.map(normalize)
  const compacted = [normalize(points[0])]
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = normalize(points[index])
    const previous = compacted[compacted.length - 1]
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistance) compacted.push(point)
  }
  const last = normalize(points[points.length - 1])
  const previous = compacted[compacted.length - 1]
  if (last.x !== previous.x || last.y !== previous.y) compacted.push(last)
  return compacted
}

type AnnotationEllipse = {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
}

function annotationEllipse(rect: PdfAnnotationRect, paddingX: number, paddingY: number): AnnotationEllipse {
  return {
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2,
    radiusX: rect.width / 2 + paddingX,
    radiusY: rect.height / 2 + paddingY,
  }
}

function annotationRayEllipseIntersection(
  origin: PdfAnnotationPoint,
  direction: PdfAnnotationPoint,
  ellipse: AnnotationEllipse,
) {
  const originX = origin.x - ellipse.centerX
  const originY = origin.y - ellipse.centerY
  const a = direction.x ** 2 / ellipse.radiusX ** 2 + direction.y ** 2 / ellipse.radiusY ** 2
  const b = 2 * (originX * direction.x / ellipse.radiusX ** 2 + originY * direction.y / ellipse.radiusY ** 2)
  const c = originX ** 2 / ellipse.radiusX ** 2 + originY ** 2 / ellipse.radiusY ** 2 - 1
  const discriminant = b ** 2 - 4 * a * c
  if (a <= 0 || discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const distances = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((distance) => distance >= 0)
  const distance = distances.length > 0 ? Math.min(...distances) : null
  if (distance == null) return null
  return {
    distance,
    point: clampAnnotationPoint({
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
    }),
  }
}

function annotationNearestEllipseBoundary(point: PdfAnnotationPoint, ellipse: AnnotationEllipse) {
  const x = (point.x - ellipse.centerX) / ellipse.radiusX
  const y = (point.y - ellipse.centerY) / ellipse.radiusY
  const length = Math.hypot(x, y)
  if (length <= 0.000001) return { x: ellipse.centerX + ellipse.radiusX, y: ellipse.centerY }
  return clampAnnotationPoint({
    x: ellipse.centerX + ellipse.radiusX * x / length,
    y: ellipse.centerY + ellipse.radiusY * y / length,
  })
}

function annotationPointInsideEllipse(point: PdfAnnotationPoint, ellipse: AnnotationEllipse) {
  return ((point.x - ellipse.centerX) / ellipse.radiusX) ** 2
    + ((point.y - ellipse.centerY) / ellipse.radiusY) ** 2 <= 1
}

function annotationPointAtScreenDistance(
  points: readonly PdfAnnotationPoint[],
  targetDistance: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  let traversed = 0
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const segmentLength = Math.hypot(
      (end.x - start.x) * viewportWidth,
      (end.y - start.y) * viewportHeight,
    )
    if (traversed + segmentLength >= targetDistance && segmentLength > 0) {
      const ratio = (targetDistance - traversed) / segmentLength
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      }
    }
    traversed += segmentLength
  }
  return points.at(-1)!
}

function annotationInitialStrokeKinematics(
  points: readonly PdfAnnotationPoint[],
  viewportWidth: number,
  viewportHeight: number,
) {
  const totalLength = points.slice(1).reduce((total, point, index) => total + Math.hypot(
    (point.x - points[index].x) * viewportWidth,
    (point.y - points[index].y) * viewportHeight,
  ), 0)
  if (totalLength < 6) return null
  const start = points[0]
  const center = annotationPointAtScreenDistance(points, 3, viewportWidth, viewportHeight)
  const end = annotationPointAtScreenDistance(points, 6, viewportWidth, viewportHeight)
  const vector = (from: PdfAnnotationPoint, to: PdfAnnotationPoint) => {
    const x = (to.x - from.x) * viewportWidth
    const y = (to.y - from.y) * viewportHeight
    const length = Math.hypot(x, y)
    return length > 0.000001 ? { x: x / length, y: y / length } : null
  }
  const before = vector(start, center)
  const after = vector(center, end)
  const tangent = vector(start, end)
  if (!before || !after || !tangent) return null
  const turn = Math.atan2(before.x * after.y - before.y * after.x, before.x * after.x + before.y * after.y)
  return { curvature: turn / 3, tangent }
}

function annotationPointOnBackwardCurve(
  origin: PdfAnnotationPoint,
  stroke: NonNullable<ReturnType<typeof annotationInitialStrokeKinematics>>,
  distance: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const signedDistance = -distance
  const { curvature, tangent } = stroke
  let x: number
  let y: number
  if (Math.abs(curvature) < 0.00001) {
    x = tangent.x * signedDistance
    y = tangent.y * signedDistance
  } else {
    const sine = Math.sin(curvature * signedDistance)
    const cosine = Math.cos(curvature * signedDistance)
    const normal = { x: -tangent.y, y: tangent.x }
    x = tangent.x * sine / curvature + normal.x * (1 - cosine) / curvature
    y = tangent.y * sine / curvature + normal.y * (1 - cosine) / curvature
  }
  return {
    x: origin.x + x / viewportWidth,
    y: origin.y + y / viewportHeight,
  }
}

function annotationCurvedEllipseExtension(
  origin: PdfAnnotationPoint,
  stroke: NonNullable<ReturnType<typeof annotationInitialStrokeKinematics>>,
  ellipses: readonly AnnotationEllipse[],
  viewportWidth: number,
  viewportHeight: number,
) {
  if (Math.abs(stroke.curvature) < 0.00001) return null
  const maximumDistance = Math.min(
    Math.hypot(viewportWidth, viewportHeight) * 1.5,
    Math.PI / (2 * Math.abs(stroke.curvature)),
  )
  const backwardPoints: PdfAnnotationPoint[] = [origin]
  let previousDistance = 0
  for (let distance = 2; distance <= maximumDistance; distance += 2) {
    const point = annotationPointOnBackwardCurve(origin, stroke, distance, viewportWidth, viewportHeight)
    if (ellipses.some((ellipse) => annotationPointInsideEllipse(point, ellipse))) {
      let outsideDistance = previousDistance
      let insideDistance = distance
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const middleDistance = (outsideDistance + insideDistance) / 2
        const middlePoint = annotationPointOnBackwardCurve(origin, stroke, middleDistance, viewportWidth, viewportHeight)
        if (ellipses.some((ellipse) => annotationPointInsideEllipse(middlePoint, ellipse))) insideDistance = middleDistance
        else outsideDistance = middleDistance
      }
      backwardPoints.push(clampAnnotationPoint(annotationPointOnBackwardCurve(
        origin,
        stroke,
        insideDistance,
        viewportWidth,
        viewportHeight,
      )))
      return backwardPoints.reverse()
    }
    backwardPoints.push(point)
    previousDistance = distance
  }
  return null
}

export function annotationConnectorPointsFromGesture(
  rects: readonly PdfAnnotationRect[],
  points: readonly PdfAnnotationPoint[],
  paddingX: number,
  paddingY: number,
  pressedPoint: PdfAnnotationPoint,
  viewportWidth = 1,
  viewportHeight = 1,
  allowOverflow = false,
) {
  const normalize = allowOverflow ? (point: PdfAnnotationPoint) => ({ ...point }) : clampAnnotationPoint
  if (rects.length === 0 || points.length < 2) return points.map(normalize)
  const ellipses = rects.map((rect) => annotationEllipse(rect, paddingX, paddingY))
  let pressedIndex = -1
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (Math.hypot(points[index].x - pressedPoint.x, points[index].y - pressedPoint.y) <= 0.000001) {
      pressedIndex = index
      break
    }
  }
  const tail = points.slice(Math.max(0, pressedIndex))
  const lastInsideIndex = tail.findLastIndex((point) => ellipses.some((ellipse) => annotationPointInsideEllipse(point, ellipse)))
  if (lastInsideIndex === tail.length - 1) return []
  if (lastInsideIndex >= 0) {
    const outsidePoint = tail[lastInsideIndex + 1]
    const insidePoint = tail[lastInsideIndex]
    const exits = ellipses
      .map((ellipse) => annotationRayEllipseIntersection(outsidePoint, {
        x: insidePoint.x - outsidePoint.x,
        y: insidePoint.y - outsidePoint.y,
      }, ellipse))
      .filter((intersection): intersection is NonNullable<typeof intersection> => intersection != null && intersection.distance <= 1)
    const boundary = exits.length > 0
      ? exits.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best).point
      : outsidePoint
    return compactAnnotationPoints([boundary, ...tail.slice(lastInsideIndex + 1)], 0.0015, !allowOverflow)
  }
  const firstStrokeIndex = tail.findIndex((point, index) => index > 0 && Math.hypot(
    (point.x - pressedPoint.x) * viewportWidth,
    (point.y - pressedPoint.y) * viewportHeight,
  ) >= 6)
  if (firstStrokeIndex < 0) return tail.map(normalize)
  const drawnTail = tail.map(normalize)
  const initialStroke = annotationInitialStrokeKinematics(tail, viewportWidth, viewportHeight)
  if (!initialStroke) return drawnTail
  const curvedExtension = annotationCurvedEllipseExtension(
    pressedPoint,
    initialStroke,
    ellipses,
    viewportWidth,
    viewportHeight,
  )
  if (curvedExtension) {
    return [...curvedExtension, curvedExtension.at(-1)!, ...drawnTail.slice(1)]
  }
  const intersections = ellipses
    .map((ellipse) => annotationRayEllipseIntersection(pressedPoint, {
      x: -initialStroke.tangent.x / viewportWidth,
      y: -initialStroke.tangent.y / viewportHeight,
    }, ellipse))
    .filter((intersection): intersection is NonNullable<typeof intersection> => intersection != null)
  if (intersections.length > 0) {
    const nearest = intersections.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best)
    return compactAnnotationPoints([nearest.point, ...drawnTail], 0.0015, !allowOverflow)
  }
  const distance = (point: PdfAnnotationPoint) => Math.hypot(
    (point.x - pressedPoint.x) * viewportWidth,
    (point.y - pressedPoint.y) * viewportHeight,
  )
  const nearest = ellipses
    .map((ellipse) => annotationNearestEllipseBoundary(pressedPoint, ellipse))
    .reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best)
  return compactAnnotationPoints([nearest, ...drawnTail], 0.0015, !allowOverflow)
}

function lineDeviation(point: PdfAnnotationPoint, start: PdfAnnotationPoint, end: PdfAnnotationPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length <= 0.000001) return Number.POSITIVE_INFINITY
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length
}

function lineCandidate(points: readonly PdfAnnotationPoint[]): CorrectedPdfShape | null {
  if (points.length < 2) return null
  const start = points[0]
  const end = points[points.length - 1]
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < 0.035) return null
  const maximumDeviation = Math.max(...points.map((point) => lineDeviation(point, start, end)))
  if (maximumDeviation / length > 0.055) return null
  return { kind: "line", points: [clampAnnotationPoint(start), clampAnnotationPoint(end)] }
}

function ellipseCandidate(points: readonly PdfAnnotationPoint[]): CorrectedPdfShape | null {
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const width = maxX - minX
  const height = maxY - minY
  if (width < 0.035 || height < 0.035) return null
  const start = points[0]
  const end = points[points.length - 1]
  if (Math.hypot(end.x - start.x, end.y - start.y) > Math.max(width, height) * 0.3) return null

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const radiusX = width / 2
  const radiusY = height / 2
  let radialError = 0
  const angleBins = new Set<number>()
  for (const point of points) {
    const normalizedX = (point.x - centerX) / radiusX
    const normalizedY = (point.y - centerY) / radiusY
    radialError += Math.abs(Math.hypot(normalizedX, normalizedY) - 1)
    const angle = (Math.atan2(normalizedY, normalizedX) + Math.PI * 2) % (Math.PI * 2)
    angleBins.add(Math.min(7, Math.floor(angle / (Math.PI / 4))))
  }
  if (angleBins.size < 7 || radialError / points.length > 0.24) return null
  return { kind: "ellipse", rect: { x: minX, y: minY, width, height } }
}

export function correctHeldPdfShape(points: readonly PdfAnnotationPoint[]): CorrectedPdfShape | null {
  if (points.length < 4) return lineCandidate(points)
  return ellipseCandidate(points) ?? lineCandidate(points)
}
