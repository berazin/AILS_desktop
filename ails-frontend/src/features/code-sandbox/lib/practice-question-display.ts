import type { PdfProblem } from "../../../lib/api"
import { pdfProblemAnswerType, pdfProblemDisplayBlocks } from "../../../lib/problem-study.ts"

function escapePattern(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function choiceMarker(index: number) {
  const number = index + 1
  const circled = String.fromCharCode(0x2460 + index)
  const korean = "가나다라마바사아자차카타파하"[index]
  const letter = index < 26 ? String.fromCharCode(65 + index) : ""
  return `(?:${circled}|${number}[.)\\]:]|\\(${number}\\)${letter ? `|${letter}[.)\\]:]|${letter.toLowerCase()}[.)\\]:]` : ""}${korean ? `|${korean}[.)\\]:]` : ""})`
}

function answerChoiceRanges(text: string, choices: string[]) {
  const protectedRanges = [...text.matchAll(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }))
  const ranges: Array<{ start: number; end: number }> = []
  choices.forEach((choice, index) => {
    const marker = choiceMarker(index)
    // Some reviewed choices retain their visible labels. The lower choice UI
    // remains authoritative; remove only matching numbered text from the stem.
    const content = choice.trim().replace(new RegExp(`^${marker}\\s+`), "").trim()
    if (!content) return
    const body = content.split(/\s+/).map(escapePattern).join("\\s+")
    const pattern = new RegExp(`(^|[\\s])(${marker}\\s*${body})(?=$|\\s|[①-⑳])`, "g")
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[1].length
      const end = start + match[2].length
      // An exercise number at the beginning of the question is not an option.
      if (!text.slice(0, start).trim() && /^\d/.test(match[2])) continue
      if (!protectedRanges.some(range => start < range.end && end > range.start)) ranges.push({ start, end })
    }
  })
  return ranges.sort((left, right) => left.start - right.start)
}

function withoutAnswerChoices(text: string, choices: string[]) {
  // Display masking keeps structured code positions and the saved text intact.
  let result = text
  for (const range of answerChoiceRanges(text, choices).reverse()) {
    result = result.slice(0, range.start) + result.slice(range.start, range.end).replace(/[^\r\n]/g, " ") + result.slice(range.end)
  }
  return result
}

export function separatePracticeQuestionContent(text: string, choices: string[], codePositions?: number[]) {
  const ranges = answerChoiceRanges(text, choices)
  if (!ranges.length) return { problemText: text, codePositions }
  const masked = withoutAnswerChoices(text, choices)
  // Remove a whole choice-only line, including its line ending, while keeping
  // unrelated indentation and blank lines exactly as the user wrote them.
  for (const match of masked.matchAll(/[^\r\n]*(?:\r?\n|$)/g)) {
    if (match[0] && !match[0].trim() && text.slice(match.index, match.index + match[0].length).trim()) {
      ranges.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  const pieces: string[] = []
  let cursor = 0
  for (const range of merged) {
    pieces.push(text.slice(cursor, range.start))
    cursor = range.end
  }
  pieces.push(text.slice(cursor))
  const result = pieces.join("")
  const leadingSpace = result.length - result.trimStart().length
  const problemText = result.trim()
  return {
    problemText,
    codePositions: codePositions?.map(position => {
      const removed = merged.reduce((sum, range) => sum + Math.max(0, Math.min(position, range.end) - range.start), 0)
      return Math.max(0, Math.min(problemText.length, position - removed - leadingSpace))
    }),
  }
}

export function practiceQuestionDisplayBlocks(problem: PdfProblem | null) {
  if (!problem) return []
  const text = pdfProblemAnswerType(problem) === "multiple_choice"
    ? withoutAnswerChoices(problem.problem_text ?? "", problem.choices ?? [])
    : problem.problem_text
  return pdfProblemDisplayBlocks(text, problem.code, problem.code_positions)
}
