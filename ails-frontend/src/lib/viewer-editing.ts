function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function extractViewerFilename(path: string) {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // Keep the original path when it is not URI encoded.
  }

  const pathParamMatch = /[?&]path=([^&]+)/.exec(decoded)
  if (pathParamMatch) {
    decoded = pathParamMatch[1]
  } else {
    const questionMarkIndex = decoded.indexOf("?")
    if (questionMarkIndex !== -1) decoded = decoded.slice(0, questionMarkIndex)
  }

  const parts = decoded.split(/[/\\]/)
  return parts[parts.length - 1] || ""
}

function normalizeSearchText(value: string) {
  return value
    .replace(/[`*_~#[\]()>|:!.,;'"?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function findLineIndexFromRenderedText(content: string, renderedText: string, insertAfter: boolean) {
  const normalizedRendered = normalizeSearchText(renderedText)
  if (!normalizedRendered) return null

  const lines = content.split(/\r?\n/)
  const candidates = [
    normalizedRendered,
    ...normalizedRendered.split(" ").filter((part) => part.length >= 4).slice(0, 8),
  ]

  for (const candidate of candidates) {
    for (let index = 0; index < lines.length; index += 1) {
      const normalizedLine = normalizeSearchText(lines[index])
      if (!normalizedLine) continue
      if (normalizedLine.includes(candidate) || candidate.includes(normalizedLine)) {
        return insertAfter ? index + 1 : index
      }
    }
  }

  return null
}

function getDropTextFromCaret(clientX: number, clientY: number) {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caretPosition = documentWithCaret.caretPositionFromPoint?.(clientX, clientY)
  if (caretPosition?.offsetNode?.textContent) return caretPosition.offsetNode.textContent
  const caretRange = documentWithCaret.caretRangeFromPoint?.(clientX, clientY)
  return caretRange?.startContainer?.textContent ?? ""
}

function getDropBlockElement(clientX: number, clientY: number, target: HTMLElement) {
  const element = document.elementFromPoint(clientX, clientY)
  if (!(element instanceof HTMLElement) || !target.contains(element)) return null
  return element.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, pre") as HTMLElement | null
}

export function estimateDropLineIndex(content: string, clientX: number, clientY: number, target: HTMLElement | null) {
  const lines = content.split(/\r?\n/)
  if (!target) return lines.length

  const blockElement = getDropBlockElement(clientX, clientY, target)
  const blockRect = blockElement?.getBoundingClientRect()
  const insertAfter = blockRect ? clientY > blockRect.top + blockRect.height / 2 : false
  const caretText = getDropTextFromCaret(clientX, clientY)
  const caretIndex = findLineIndexFromRenderedText(content, caretText, insertAfter)
  if (caretIndex !== null) return clamp(caretIndex, 0, lines.length)

  const blockText = blockElement?.textContent ?? ""
  const blockIndex = findLineIndexFromRenderedText(content, blockText, insertAfter)
  if (blockIndex !== null) return clamp(blockIndex, 0, lines.length)

  const rect = target.getBoundingClientRect()
  if (rect.height <= 0) return lines.length
  const ratio = clamp((clientY - rect.top) / rect.height, 0, 1)
  return Math.round(lines.length * ratio)
}

export function estimateDropTop(clientY: number, target: HTMLElement | null) {
  if (!target) return 0
  const rect = target.getBoundingClientRect()
  return clamp(clientY - rect.top, 0, rect.height)
}

export function containedImageClientRect(image: HTMLImageElement | HTMLDivElement) {
  const rect = image.getBoundingClientRect()
  if (!('naturalWidth' in image) || !('naturalHeight' in image)) return rect
  if (!image.naturalWidth || !image.naturalHeight || !rect.width || !rect.height) return rect
  const imageAspect = image.naturalWidth / image.naturalHeight
  const elementAspect = rect.width / rect.height
  if (elementAspect > imageAspect) {
    const width = rect.height * imageAspect
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top,
      right: rect.left + (rect.width + width) / 2,
      bottom: rect.bottom,
      width,
      height: rect.height,
    }
  }
  const height = rect.width / imageAspect
  return {
    left: rect.left,
    top: rect.top + (rect.height - height) / 2,
    right: rect.right,
    bottom: rect.top + (rect.height + height) / 2,
    width: rect.width,
    height,
  }
}
