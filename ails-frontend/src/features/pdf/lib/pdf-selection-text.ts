import type { PdfOcrWord } from "../../../lib/api"
import { annotationSelectionFlowRects, annotationTextCharacterRects, type PdfAnnotationRect } from "./pdf-annotation-geometry.ts"

export type PdfSelectableCharacter = PdfAnnotationRect & { text: string; word: number }

export function pdfSelectableCharacters(words: readonly PdfOcrWord[]): PdfSelectableCharacter[] {
  return words.filter(word => word.right > word.left && word.bottom > word.top)
    .sort((left, right) => left.index - right.index)
    .flatMap((word, wordIndex) => {
      const text = Array.from(word.text)
      return annotationTextCharacterRects(word.text, {
        x: word.left, y: word.top, width: word.right - word.left, height: word.bottom - word.top,
      }).map((rect, index) => ({ ...rect, text: text[index], word: wordIndex }))
    })
}

export function pdfSelectionText(characters: readonly PdfSelectableCharacter[], start: number, end: number) {
  // Use exactly the same reading-flow filter as the painted selection.
  const selected = new Set(annotationSelectionFlowRects(characters, start, end))
  let previous: PdfSelectableCharacter | undefined
  let text = ""
  for (const character of characters) {
    if (!selected.has(character)) continue
    if (previous && previous.word !== character.word && !/\s$/u.test(text) && !/^\s/u.test(character.text)) {
      const overlap = Math.min(previous.y + previous.height, character.y + character.height) - Math.max(previous.y, character.y)
      const sameLine = overlap >= Math.min(previous.height, character.height) * 0.45
      const gap = character.x - previous.x - previous.width
      text += !sameLine ? "\n" : gap > Math.min(previous.width, character.width) * 0.2 ? " " : ""
    }
    text += character.text
    previous = character
  }
  return text
}
