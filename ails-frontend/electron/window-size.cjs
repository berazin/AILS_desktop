const INITIAL_WINDOW_RATIO = 0.92
const MIN_INITIAL_WIDTH = 1100
const MIN_INITIAL_HEIGHT = 700
const DEFAULT_WORK_AREA = { width: 1920, height: 1080 }
const PROCESS_BAR_HEIGHT = 32
const SLIDE_WIDTH_UNITS = 16
const SLIDE_HEIGHT_UNITS = 9

function normalizedDimension(value, fallback) {
  const dimension = Number(value)
  return Number.isFinite(dimension) && dimension > 0 ? Math.floor(dimension) : fallback
}

function normalizedCoordinate(value) {
  const coordinate = Number(value)
  return Number.isFinite(coordinate) ? Math.floor(coordinate) : 0
}

function boundedDimension(workArea, minimum) {
  const scaled = Math.round(workArea * INITIAL_WINDOW_RATIO)
  return Math.min(workArea, Math.max(minimum, scaled))
}

function calculateInitialWindowSize(workAreaSize = DEFAULT_WORK_AREA) {
  const workAreaWidth = normalizedDimension(workAreaSize?.width, DEFAULT_WORK_AREA.width)
  const workAreaHeight = normalizedDimension(workAreaSize?.height, DEFAULT_WORK_AREA.height)
  const availableWidth = boundedDimension(workAreaWidth, MIN_INITIAL_WIDTH)
  const availableHeight = boundedDimension(workAreaHeight, MIN_INITIAL_HEIGHT)
  // The frameless app reserves 32px for the process bar; fit the remaining area to a 16:9 slide.
  const slideUnits = Math.max(1, Math.floor(Math.min(
    availableWidth / SLIDE_WIDTH_UNITS,
    (availableHeight - PROCESS_BAR_HEIGHT) / SLIDE_HEIGHT_UNITS,
  )))
  return {
    width: Math.min(availableWidth, slideUnits * SLIDE_WIDTH_UNITS),
    height: Math.min(availableHeight, slideUnits * SLIDE_HEIGHT_UNITS + PROCESS_BAR_HEIGHT),
  }
}

function calculateInitialWindowBounds(workArea = DEFAULT_WORK_AREA) {
  const workAreaWidth = normalizedDimension(workArea?.width, DEFAULT_WORK_AREA.width)
  const workAreaHeight = normalizedDimension(workArea?.height, DEFAULT_WORK_AREA.height)
  const size = calculateInitialWindowSize({ width: workAreaWidth, height: workAreaHeight })
  const workAreaX = normalizedCoordinate(workArea?.x)
  const workAreaY = normalizedCoordinate(workArea?.y)
  return {
    x: workAreaX + Math.round((workAreaWidth - size.width) / 2),
    y: workAreaY + Math.round((workAreaHeight - size.height) / 2),
    ...size,
  }
}

module.exports = {
  calculateInitialWindowBounds,
  calculateInitialWindowSize,
}
