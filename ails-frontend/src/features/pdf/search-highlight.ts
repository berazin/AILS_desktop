// 검색 결과 페이지 하이라이트의 순수 좌표 계산. OCR 단어 박스(0..1 정규화) 위에서
// 검색어 토큰 시퀀스가 연속으로 걸리는 구간을 union 박스로 만든다.

import type { PdfOcrWord } from "../../lib/api"

export interface PdfHighlightBox {
  left: number
  top: number
  right: number
  bottom: number
}

export function normalizeHighlightToken(value: string): string {
  return String(value || "").toLocaleLowerCase().replace(/[^0-9a-z가-힣_]/g, "")
}

function wordBox(word: PdfOcrWord): PdfHighlightBox | null {
  const left = Math.min(Number(word.left), Number(word.right))
  const right = Math.max(Number(word.left), Number(word.right))
  const top = Math.min(Number(word.top), Number(word.bottom))
  const bottom = Math.max(Number(word.top), Number(word.bottom))
  if (!(right - left > 0) || !(bottom - top > 0)) return null
  return { left, right, top, bottom }
}

function unionBoxes(boxes: PdfHighlightBox[]): PdfHighlightBox {
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  }
}

export function searchHighlightBoxes(
  words: PdfOcrWord[],
  query: string,
  maxBoxes = 24,
): PdfHighlightBox[] {
  const tokens = String(query || "")
    .trim()
    .split(/\s+/)
    .map((token) => normalizeHighlightToken(token))
    .filter((token) => token.length > 0)
    .slice(0, 8)
  if (tokens.length === 0) return []
  const normalizedWords = words.map((word) => normalizeHighlightToken(word.text))
  const boxes: PdfHighlightBox[] = []
  let index = 0
  while (index < words.length && boxes.length < maxBoxes) {
    if (!normalizedWords[index].includes(tokens[0])) {
      index += 1
      continue
    }
    if (tokens.length === 1) {
      const box = wordBox(words[index])
      if (box) boxes.push(box)
      index += 1
      continue
    }
    const matchedIndexes: number[] = [index]
    let cursor = index + 1
    let matchedAll = true
    for (let tokenIndex = 1; tokenIndex < tokens.length; tokenIndex += 1) {
      const limit = Math.min(words.length, cursor + 6)
      let found = -1
      for (let probe = cursor; probe < limit; probe += 1) {
        if (normalizedWords[probe].includes(tokens[tokenIndex])) {
          found = probe
          break
        }
      }
      if (found === -1) {
        matchedAll = false
        break
      }
      matchedIndexes.push(found)
      cursor = found + 1
    }
    if (!matchedAll) {
      index += 1
      continue
    }
    const unionBoxesInput = matchedIndexes
      .map((wordIndex) => wordBox(words[wordIndex]))
      .filter((box): box is PdfHighlightBox => box !== null)
    if (unionBoxesInput.length > 0) {
      boxes.push(unionBoxes(unionBoxesInput))
      index = cursor
    } else {
      index += 1
    }
  }
  return boxes
}
