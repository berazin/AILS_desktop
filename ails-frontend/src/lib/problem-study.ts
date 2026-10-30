import { t } from "./i18n.ts"
import type {
  PdfProblem,
  PdfProblemAnswerType,
  PdfProblemKind,
  PdfProblemStatus,
} from "./api"

const LAST_PRACTICE_PROBLEMS_KEY = "ails-last-practice-problems"

function practiceDocumentKey(pdfPath: string) {
  return String(pdfPath || "").replace(/\\/g, "/").trim().toLocaleLowerCase()
}

export function readLastPracticeProblem(
  storage: Pick<Storage, "getItem">,
  pdfPath: string,
) {
  const key = practiceDocumentKey(pdfPath)
  if (!key) return ""
  try {
    const parsed = JSON.parse(storage.getItem(LAST_PRACTICE_PROBLEMS_KEY) || "{}")
    return typeof parsed?.[key]?.problemId === "string" ? parsed[key].problemId : ""
  } catch {
    return ""
  }
}

export function writeLastPracticeProblem(
  storage: Pick<Storage, "getItem" | "setItem">,
  pdfPath: string,
  problemId: string,
) {
  const key = practiceDocumentKey(pdfPath)
  const normalizedProblemId = String(problemId || "").trim()
  if (!key || !normalizedProblemId) return
  let current: Record<string, { problemId: string; updatedAt: number }> = {}
  try {
    const parsed = JSON.parse(storage.getItem(LAST_PRACTICE_PROBLEMS_KEY) || "{}")
    if (parsed && typeof parsed === "object") current = parsed
  } catch {
    current = {}
  }
  current[key] = { problemId: normalizedProblemId, updatedAt: Date.now() }
  const entries = Object.entries(current)
    .sort(([, left], [, right]) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
    .slice(0, 50)
  storage.setItem(LAST_PRACTICE_PROBLEMS_KEY, JSON.stringify(Object.fromEntries(entries)))
}

export function pdfProblemHasAnswer(problem: PdfProblem) {
  const answerType = pdfProblemAnswerInputType(problem)
  if (answerType === "code") {
    return Boolean(problem.folder_path && (problem.last_grading || problem.status !== "not_started"))
  }
  if (answerType === "multiple_choice") {
    return Number.isInteger(problem.draft_answer?.selected_choice)
  }
  if (answerType === "short_answer" || answerType === "ox") {
    const binaryPrompt = pdfProblemBinaryPrompt(problem.problem_text, answerType === "ox")
    return binaryPrompt
      ? pdfProblemBinaryAnswerComplete(binaryPrompt, problem.draft_answer?.answer_text)
      : Boolean(problem.draft_answer?.answer_text?.trim())
  }
  return false
}

export function pdfProblemNeedsGrading(problem: PdfProblem) {
  if (!problem.last_grading) return pdfProblemHasAnswer(problem)
  if (pdfProblemAnswerType(problem) === "code") return true
  if (problem.current_answer_hash && problem.last_grading.submission_hash) {
    return problem.current_answer_hash !== problem.last_grading.submission_hash
  }
  const answerUpdatedAt = Date.parse(problem.draft_answer?.updated_at || "")
  const gradedAt = Date.parse(problem.last_grading.submitted_at || "")
  return Number.isFinite(answerUpdatedAt) && (!Number.isFinite(gradedAt) || answerUpdatedAt > gradedAt)
}

export const PDF_PROBLEM_STATUS_LABELS: Record<PdfProblemStatus, string> = {
  not_started: "미시작",
  in_progress: "진행 중",
  completed: "✓ 완료",
  retry: "★ 다시 풀기",
}

export function pdfProblemStatusLabel(status: PdfProblemStatus) {
  const label = PDF_PROBLEM_STATUS_LABELS[status] ?? PDF_PROBLEM_STATUS_LABELS.not_started
  return t(label)
}

export function pdfProblemMarkerPosition({
  labelBox,
  layerWidth,
  layerHeight,
  markerWidth,
  markerHeight,
  inset = 4,
  gap = 4,
}: {
  labelBox: NonNullable<PdfProblem["label_bbox"]>
  layerWidth: number
  layerHeight: number
  markerWidth: number
  markerHeight: number
  inset?: number
  gap?: number
}) {
  const width = Math.max(0, Number(layerWidth) || 0)
  const height = Math.max(0, Number(layerHeight) || 0)
  const safeMarkerWidth = Math.max(0, Number(markerWidth) || 0)
  const safeMarkerHeight = Math.max(0, Number(markerHeight) || 0)
  const labelLeft = Number(labelBox.left) * width
  const labelTop = Number(labelBox.top) * height
  const labelBottom = Number(labelBox.bottom) * height
  if (
    width <= 0
    || height <= 0
    || !Number.isFinite(labelLeft)
    || !Number.isFinite(labelTop)
    || !Number.isFinite(labelBottom)
  ) return null

  const safeInset = Math.max(0, Number(inset) || 0)
  const safeGap = Math.max(0, Number(gap) || 0)
  const leftRailHasRoom = labelLeft >= safeInset + safeMarkerWidth + safeGap
  const desiredLeft = leftRailHasRoom
    ? safeInset
    : width - safeInset - safeMarkerWidth
  const desiredTop = ((labelTop + labelBottom) / 2) - (safeMarkerHeight / 2)

  return {
    left: Math.max(safeInset, Math.min(desiredLeft, Math.max(safeInset, width - safeMarkerWidth - safeInset))),
    top: Math.max(safeInset, Math.min(desiredTop, Math.max(safeInset, height - safeMarkerHeight - safeInset))),
    side: leftRailHasRoom ? "left" as const : "right" as const,
  }
}

export const PDF_PROBLEM_ANSWER_TYPE_LABELS: Record<PdfProblemAnswerType, string> = {
  multiple_choice: "객관식",
  short_answer: "주관식",
  ox: "O/X",
  code: "직접 코딩",
  unknown: "유형 미확정",
}

export function pdfProblemAnswerType(problem: PdfProblem): PdfProblemAnswerType {
  if (problem.answer_type) return problem.answer_type
  return problem.is_code_problem ? "code" : "unknown"
}

export function pdfProblemAnswerInputType(problem: PdfProblem): PdfProblemAnswerType {
  const answerType = pdfProblemAnswerType(problem)
  return (answerType === "unknown" || answerType === "short_answer") && pdfProblemBinaryPrompt(problem.problem_text)
    ? "ox"
    : answerType
}

export function pdfProblemAnswerTypeLabel(problem: PdfProblem) {
  return t(PDF_PROBLEM_ANSWER_TYPE_LABELS[pdfProblemAnswerInputType(problem)])
}

export interface PdfProblemBinaryPrompt {
  kind: "ox" | "tf"
  labels: [string, string]
  items: Array<{ number: string; text: string }>
}

export function pdfProblemBinaryPrompt(value: string | null | undefined, force = false): PdfProblemBinaryPrompt | null {
  const text = String(value || "").replace(/\r\n?/g, "\n")
  const prompt = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g, "")
  const separator = "(?:[,/·ㆍ]|와|또는|or)"
  const kind = new RegExp(`(?:\\bT(?:RUE)?\\b)\\s*${separator}\\s*(?:\\bF(?:ALSE)?\\b)`, "i").test(prompt)
    ? "tf"
    : force || new RegExp(`(?:[○◯⭕Ｏ]|\\bO\\b)\\s*${separator}\\s*(?:[×✕✖❌Ｘ]|\\bX\\b)`, "i").test(prompt)
      ? "ox"
      : null
  if (!kind) return null

  const matches = [...text.matchAll(/\((\d{1,2})\)\s*/g)]
  const items = matches.map((match, index) => ({
    number: match[1],
    text: text
      .slice(Number(match.index) + match[0].length, matches[index + 1]?.index ?? text.length)
      .replace(/\(\s*\)\s*$/g, "")
      .trim(),
  })).filter((item) => item.text)
  return { kind, labels: kind === "tf" ? ["T", "F"] : ["O", "X"], items }
}

export function pdfProblemBinaryAnswerSelections(value: string | null | undefined) {
  return Object.fromEntries(
    [...String(value || "").matchAll(/^\((\d{1,2})\)\s*(true|false|[OXTF○◯⭕Ｏ×✕✖❌Ｘ])\s*$/gim)]
      .map((match) => [match[1], match[2].toUpperCase()]),
  ) as Record<string, string>
}

export function pdfProblemBinarySelection(prompt: PdfProblemBinaryPrompt, value: string | null | undefined) {
  const answer = String(value || "").trim().toLowerCase()
  if (["true", "t", "o", "○", "◯", "⭕", "ｏ"].includes(answer)) return prompt.labels[0]
  if (["false", "f", "x", "×", "✕", "✖", "❌", "ｘ"].includes(answer)) return prompt.labels[1]
  return ""
}

export function pdfProblemBinaryAnswerComplete(
  prompt: PdfProblemBinaryPrompt,
  value: string | null | undefined,
) {
  if (!prompt.items.length) return Boolean(pdfProblemBinarySelection(prompt, value))
  const selections = pdfProblemBinaryAnswerSelections(value)
  return prompt.items.every((item) => Boolean(pdfProblemBinarySelection(prompt, selections[item.number])))
}

export function updatePdfProblemBinaryAnswer(
  prompt: PdfProblemBinaryPrompt,
  current: string,
  itemNumber: string,
  selection: string,
) {
  if (!prompt.items.length) return selection
  const selections = pdfProblemBinaryAnswerSelections(current)
  selections[itemNumber] = selection
  return prompt.items
    .filter((item) => selections[item.number])
    .map((item) => `(${item.number}) ${selections[item.number]}`)
    .join("\n")
}

const PDF_PROBLEM_SOURCE_LINE_PATTERN = /^(?:#include\b|import\s+|package\s+|(?:public|private|protected|static|final)\s+|class\s+|interface\s+|enum\s+|def\s+|(?:int|void|char|float|double|boolean|string)\s+\w+|System\.|std::|console\.|\{|\}|\/\/|\/\*|\*)/i
const PDF_PROBLEM_CHOICE_LINE_PATTERN = /^(?:[①-⑳]|[가-하A-Ea-e]\s*[.)\]:])\s*/
const PDF_PROBLEM_NUMBER_LINE_PATTERN = /^(?:문제\s*)?\d{1,3}\s*(?:번|[.)])\s*/i
const PDF_PROBLEM_KOREAN_WORD_BOUNDARY_PATTERN = new RegExp(
  "([가-힣])(?=(" + [
      "아무것도", "키보드", "프로그램", "문자열", "무작위", "랜덤하게",
      "저장하는", "생성하여", "생성하고", "입력받아", "출력하라", "저장하라",
      "삽입하라", "작성하라", "수정하라", "반복문", "조건문", "그리고",
      "그러나", "따라서", "배열", "정수", "실수", "숫자", "평균", "범위",
      "랜덤", "코드", "소스", "결과", "화면", "사용자", "입력", "출력",
      "저장", "생성", "삽입", "삭제", "반복", "조건", "위치", "나머지",
      "동일", "모두", "각각", "이곳", "난이도", "메소드", "클래스",
      "객체", "변수", "만들", "고르", "구하", "든",
      "몇",
    ].join("|") + "))",
  "g",
)
const PDF_PROBLEM_NUMBER_SUFFIX_PATTERN = /(\d)\s+(?=(?:개|번째|번|장|페이지|차원|행|열|점|원|도|초|분|시간|배|에서|부터|까지|보다|이상|이하|미만|초과|의|을|를|이|가|은|는|와|과|로|으로))/g
const PDF_PROBLEM_OUTPUT_LABEL_PATTERN = /^(?:실행\s*결과|출력\s*결과|랜덤한?\s*정수|평균|합계|정수\s*몇\s*개)/
const PDF_PROBLEM_OUTPUT_SYMBOL_PATTERN = /^[*#@%]+$/

function normalizePdfProblemDisplayLine(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(\d{1,3})\s*[.)]\s*/, "$1. ")
    .replace(/([가-힣])(?=\d)/g, "$1 ")
    .replace(/(\d)(?=[가-힣])/g, "$1 ")
    .replace(PDF_PROBLEM_NUMBER_SUFFIX_PATTERN, "$1")
    .replace(/([A-Za-z])(?=[가-힣])/g, "$1 ")
    .replace(/([가-힣])(?=[A-Za-z])/g, "$1 ")
    .replace(/([가-힣])(?=\()/g, "$1 ")
    .replace(/(\))(?=[가-힣])/g, "$1 ")
    .replace(PDF_PROBLEM_KOREAN_WORD_BOUNDARY_PATTERN, "$1 ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?=[A-Za-z가-힣])/g, "$1 ")
    .replace(/([.!?])(?=[A-Za-z가-힣\d])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim()
}

export function formatPdfProblemText(value: string | null | undefined) {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())

  const result: Array<{ kind: "prose" | "question" | "choice" | "source" | "blank"; text: string }> = []
  for (const rawLine of lines) {
    if (!rawLine) {
      if (result.length > 0 && result[result.length - 1].kind !== "blank") {
        result.push({ kind: "blank", text: "" })
      }
      continue
    }
    const sourceLine = PDF_PROBLEM_SOURCE_LINE_PATTERN.test(rawLine)
    const line = sourceLine ? rawLine.trim() : normalizePdfProblemDisplayLine(rawLine)
    const kind = sourceLine
      ? "source"
      : PDF_PROBLEM_CHOICE_LINE_PATTERN.test(line)
        ? "choice"
        : PDF_PROBLEM_NUMBER_LINE_PATTERN.test(line)
          ? "question"
          : "prose"
    result.push({ kind, text: line })
  }

  while (result[0]?.kind === "blank") result.shift()
  while (result[result.length - 1]?.kind === "blank") result.pop()
  return result.map((item) => item.text).join("\n")
}

export interface PdfProblemDisplayBlock {
  kind: "text" | "output" | "code"
  text: string
}

function pdfProblemNumericOutputCells(line: string) {
  const cells = line.trim().split(/\s+/)
  if (
    cells.length < 2
    || !cells.every((cell) => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cell))
  ) {
    return null
  }
  return cells
}

function isPdfProblemOutputLine(line: string) {
  const trimmed = line.trim()
  return Boolean(
    trimmed
    && (
      pdfProblemNumericOutputCells(trimmed)
      || PDF_PROBLEM_OUTPUT_SYMBOL_PATTERN.test(trimmed)
      || PDF_PROBLEM_OUTPUT_LABEL_PATTERN.test(trimmed)
    )
  )
}

function alignPdfProblemOutputLines(lines: string[]) {
  const rows = lines.map((line) => pdfProblemNumericOutputCells(line))
  const widths: number[] = []
  for (const cells of rows) {
    if (!cells) continue
    cells.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length)
    })
  }
  return lines
    .map((line, rowIndex) => {
      const cells = rows[rowIndex]
      if (!cells) return line.trim()
      return cells
        .map((cell, index) => cell.padStart(widths[index] ?? cell.length))
        .join("   ")
        .trimEnd()
    })
    .join("\n")
}

export function pdfProblemDisplayBlocks(
  value: string | null | undefined,
  codeBlocks: string[] | null | undefined = [],
  codePositions: number[] | null | undefined = [],
): PdfProblemDisplayBlock[] {
  const blocks: PdfProblemDisplayBlock[] = []
  const appendText = (text: string) => {
    const formatted = formatPdfProblemText(text)
    if (!formatted) return
    for (const line of formatted.split("\n")) {
      const kind = isPdfProblemOutputLine(line) ? "output" as const : "text" as const
      const previous = blocks[blocks.length - 1]
      if (previous?.kind === kind) {
        previous.text += `\n${line}`
      } else {
        blocks.push({ kind, text: line })
      }
    }
  }
  const rawText = String(value ?? "")
  const code = (codeBlocks ?? [])
    .map((block, index) => ({
      index,
      text: block,
      position: Math.max(0, Math.min(
        rawText.length,
        Number.isFinite(Number(codePositions?.[index]))
          ? Number(codePositions?.[index])
          : rawText.length,
      )),
    }))
    .filter((block) => typeof block.text === "string" && block.text.trim())
    .sort((left, right) => left.position - right.position || left.index - right.index)
  let cursor = 0
  for (const block of code) {
    appendText(rawText.slice(cursor, block.position))
    blocks.push({ kind: "code", text: block.text })
    cursor = block.position
  }
  appendText(rawText.slice(cursor))
  return blocks.map((block) => (
    block.kind === "output"
      ? { ...block, text: alignPdfProblemOutputLines(block.text.split("\n")) }
      : block
  ))
}

export interface PdfProblemNavigatorSection {
  id: string
  kind: PdfProblemKind
  label: string
  page: number | null
  problems: PdfProblem[]
}

export interface PdfProblemNavigatorChapter {
  chapter: string
  sections: PdfProblemNavigatorSection[]
}

export function pdfProblemKindLabel(kind: PdfProblemKind, compact = false) {
  if (kind === "quiz") return t("퀴즈")
  if (kind === "lab") return compact ? t("실습") : t("실습 문제")
  return compact ? t("연습") : t("연습 문제")
}

function naturalProblemTextCompare(left: string, right: string) {
  return left.localeCompare(right, "ko-KR", { numeric: true, sensitivity: "base" })
}

export function groupPdfProblemsForNavigator(problems: PdfProblem[]): PdfProblemNavigatorChapter[] {
  const chapters = new Map<string, Map<string, PdfProblemNavigatorSection>>()
  for (const problem of problems) {
    const chapter = String(problem.chapter || t("챕터 미확정")).trim() || t("챕터 미확정")
    const sections = chapters.get(chapter) ?? new Map<string, PdfProblemNavigatorSection>()
    const page = problem.kind === "quiz" ? Math.max(1, Math.trunc(Number(problem.page) || 1)) : null
    const sectionId = page === null ? problem.kind : `${problem.kind}-page-${page}`
    const section = sections.get(sectionId) ?? {
      id: sectionId,
      kind: problem.kind,
      label: page === null
        ? pdfProblemKindLabel(problem.kind)
        : t("{p0} · {p1}쪽", { p0: pdfProblemKindLabel(problem.kind), p1: page }),
      page,
      problems: [],
    }
    section.problems.push(problem)
    sections.set(sectionId, section)
    chapters.set(chapter, sections)
  }

  return [...chapters.entries()]
    .sort(([left], [right]) => naturalProblemTextCompare(left, right))
    .map(([chapter, sectionMap]) => ({
      chapter,
      sections: [...sectionMap.values()]
        .sort((left, right) => {
          const kindOrder = { quiz: 0, practice: 1, lab: 2 }
          return kindOrder[left.kind] - kindOrder[right.kind]
            || Number(left.page || 0) - Number(right.page || 0)
        })
        .map((section) => ({
          ...section,
          problems: [...section.problems].sort(
            (left, right) => left.page - right.page || left.number - right.number,
          ),
        })),
    }))
}

export function normalizeProblemPath(value: string | null | undefined) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLocaleLowerCase()
}

export function problemForProject(
  problems: PdfProblem[],
  baseDir: string,
  projectName: string,
) {
  const normalizedProject = normalizeProblemPath(projectName)
  if (!normalizedProject) return null
  const normalizedBaseDir = normalizeProblemPath(baseDir)
  const normalizedFullPath = normalizeProblemPath(`${normalizedBaseDir}/${normalizedProject}`)

  return problems.find((problem) => {
    const folderPath = normalizeProblemPath(problem.folder_path)
    if (!folderPath) return false
    return normalizedProject === folderPath
      || normalizedFullPath === folderPath
      || (normalizedBaseDir !== "" && normalizedFullPath === `${normalizedBaseDir}/${folderPath}`)
  }) ?? null
}

export function pdfProblemsOnPage(problems: PdfProblem[], page: number) {
  return problems.filter((problem) => page === problem.page)
}

export function pdfProblemsSpanningPage(problems: PdfProblem[], page: number) {
  return problems.filter((problem) => {
    const start = Math.max(1, Math.floor(Number(problem.page) || 1))
    const end = Math.max(start, Math.floor(Number(problem.page_end) || start))
    return start <= page && page <= end
  })
}

export function problemElapsedSeconds(problem: PdfProblem, now = Date.now()) {
  const saved = Math.max(0, Math.floor(Number(problem.elapsed_seconds) || 0))
  if (!problem.timer_started_at) return saved
  const startedAt = Date.parse(problem.timer_started_at)
  if (!Number.isFinite(startedAt)) return saved
  return saved + Math.max(0, Math.floor((now - startedAt) / 1000))
}

export function formatProblemElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainder = safe % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

export function formatProblemLastAttempt(value: string | null | undefined) {
  if (!value) return t("기록 없음")
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return t("기록 없음")
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}
