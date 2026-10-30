import type { QuestionRect } from "./quick-chat-edit-context-types.ts"

/** Measure UTF-16 positions using the textarea's actual wrapping and font. */
export function questionTextBounds(input: HTMLTextAreaElement, text: string, start: number, end: number) {
  const bounds = input.getBoundingClientRect(), style = getComputedStyle(input)
  const mirror = document.createElement("div")
  const properties = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
    "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "boxSizing", "wordBreak", "overflowWrap"] as const
  for (const property of properties) mirror.style[property] = style[property]
  Object.assign(mirror.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap",
    left: `${bounds.left}px`, top: `${bounds.top - input.scrollTop}px`, width: `${bounds.width * input.clientWidth / input.offsetWidth}px` })
  const content = document.createTextNode(text + "\u200b")
  mirror.append(content)
  document.body.append(mirror)
  try {
    const range = document.createRange()
    const at = Math.max(0, Math.min(start, text.length))
    range.setStart(content, at); range.setEnd(content, at + 1)
    const first = range.getBoundingClientRect()
    const caret = new DOMRect(first.left, first.top, 1, first.height || parseFloat(style.lineHeight) || 24)
    const characters: DOMRect[] = []
    for (let index = at; index < Math.min(end, text.length); index++) {
      range.setStart(content, index); range.setEnd(content, index + 1)
      characters.push(range.getBoundingClientRect())
    }
    const parent = input.parentElement!.getBoundingClientRect()
    const scaleX = parent.width / input.parentElement!.offsetWidth || 1
    const scaleY = parent.height / input.parentElement!.offsetHeight || 1
    const local = (rect: DOMRect): QuestionRect => ({ left: (rect.left - parent.left) / scaleX,
      top: (rect.top - parent.top) / scaleY, width: rect.width / scaleX, height: rect.height / scaleY })
    return { caret, characters, local }
  } finally { mirror.remove() }
}
