import { t } from "../../../lib/i18n.ts"
import type { NotebookExecutionOutput } from "../../../lib/api"

export type NotebookViewerCell = {
  index: number
  type: string
  source: string
  markdown: string
  outputs: NotebookExecutionOutput[]
  executionCount: number | null
}

export type NotebookCellEdit = {
  documentId: string
  cellIndex: number
}

export type NotebookCellType = "code" | "markdown"

// Jupyter kernels embed ANSI escape sequences (colors, cursor control) in error
// tracebacks and stream output; the viewer renders plain text, so drop them.
// The escape character is built at runtime to keep the regex control-char free.
const NOTEBOOK_ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g")

export function stripNotebookAnsiEscapes(text: string) {
  if (!text) return text
  return text.replace(NOTEBOOK_ANSI_ESCAPE_PATTERN, "")
}

function cellSourceToText(source: unknown) {
  if (Array.isArray(source)) return source.map((part) => String(part)).join("")
  return String(source ?? "")
}

function textToNotebookSource(value: string) {
  if (!value) return []
  const lines = value.split("\n")
  return lines.map((line, index) => (index < lines.length - 1 ? `${line}\n` : line)).filter((line) => line.length > 0)
}

function isExternalImageSource(src: string) {
  return /^(?:https?:|data:|blob:|\/api\/files)/i.test(src)
}

function isAbsoluteLocalPath(src: string) {
  return /^[A-Za-z]:[\\/]/.test(src) || src.startsWith("\\\\") || src.startsWith("/")
}

function dirname(filePath: string) {
  const index = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"))
  return index >= 0 ? filePath.slice(0, index) : ""
}

function normalizeLocalPath(filePath: string) {
  const separator = filePath.includes("\\") ? "\\" : "/"
  const prefixMatch = /^[A-Za-z]:[\\/]/.exec(filePath)
  const prefix = prefixMatch ? prefixMatch[0] : filePath.startsWith("/") ? "/" : ""
  const rest = prefix ? filePath.slice(prefix.length) : filePath
  const parts: string[] = []

  for (const part of rest.split(/[\\/]+/)) {
    if (!part || part === ".") continue
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return `${prefix}${parts.join(separator)}`
}

export function rewriteNotebookMarkdownImageSources(markdown: string, notebookPath?: string) {
  if (!markdown || !notebookPath) return markdown
  const baseDir = dirname(notebookPath)
  if (!baseDir) return markdown

  return markdown.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (match, prefix: string, rawSrc: string, suffix: string) => {
    const trimmedSrc = rawSrc.trim()
    const src = trimmedSrc.startsWith("<") && trimmedSrc.endsWith(">") ? trimmedSrc.slice(1, -1) : trimmedSrc
    if (!src || isExternalImageSource(src)) return match

    const resolvedPath = normalizeLocalPath(isAbsoluteLocalPath(src) ? src : `${baseDir}\\${src}`)
    return `${prefix}/api/files?path=${encodeURIComponent(resolvedPath)}${suffix}`
  })
}

const NOTEBOOK_HTML_IMG_PATTERN = /<img\b[^>]*>/gi
const NOTEBOOK_HTML_IMG_SRC_PATTERN = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const NOTEBOOK_HTML_INTEREST_PATTERN = /<(?:img|figure|center|figcaption)\b/i

function notebookTagAttribute(tag: string, name: string) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim()
}

// Jupyter markdown cells commonly carry raw HTML (<figure><center><img ...>).
// The viewer renders raw HTML (rehype-raw + sanitize) just like JupyterLab, so
// the image tag is kept as HTML and only its src is rewritten to the local
// /api/files endpoint. Centering, styles, and size attributes survive. Fenced
// code blocks are left untouched.
export function convertNotebookRawHtmlImages(markdown: string, notebookPath?: string) {
  if (!markdown || !NOTEBOOK_HTML_INTEREST_PATTERN.test(markdown)) return markdown
  const baseDir = notebookPath ? dirname(notebookPath) : ""
  const segments = markdown.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/)
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      return segment
        .replace(NOTEBOOK_HTML_IMG_PATTERN, (tag) => {
          const src = notebookTagAttribute(tag, "src")
          if (!src || !baseDir || isExternalImageSource(src)) return tag

          const resolvedPath = normalizeLocalPath(isAbsoluteLocalPath(src) ? src : `${baseDir}\\${src}`)
          const srcMatch = NOTEBOOK_HTML_IMG_SRC_PATTERN.exec(tag)
          if (!srcMatch) return tag
          const replacedSrc = ` src="/api/files?path=${encodeURIComponent(resolvedPath)}"`
          return `${tag.slice(0, srcMatch.index)}${tag.slice(srcMatch.index).replace(srcMatch[0], replacedSrc)}`
        })
        .replace(/^[ \t]+(!\[[^\]]*\]\([^)]*\))/gm, "$1")
    })
    .join("")
}

export function notebookCellsFromRaw(rawContent?: string, notebookPath?: string): NotebookViewerCell[] {
  if (!rawContent) return []
  try {
    const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
    return (notebook.cells ?? []).map((cell, index) => {
      const type = String(cell.cell_type ?? "")
      const source = cellSourceToText(cell.source)
      const outputs = Array.isArray(cell.outputs) ? (cell.outputs as NotebookExecutionOutput[]) : []
      const executionCount = typeof cell.execution_count === "number" ? cell.execution_count : null
      return {
        index,
        type,
        source,
        markdown:
          type === "code"
            ? `\`\`\`python\n${source.trimEnd()}\n\`\`\``
            : rewriteNotebookMarkdownImageSources(convertNotebookRawHtmlImages(source, notebookPath), notebookPath),
        outputs,
        executionCount,
      }
    })
  } catch {
    return []
  }
}

function emptyNotebookCell(cellType: NotebookCellType) {
  if (cellType === "code") {
    return { cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: [] }
  }
  return { cell_type: "markdown", metadata: {}, source: [] }
}

export function insertNotebookCell(
  rawContent: string,
  index: number,
  cellType: NotebookCellType,
  position: "above" | "below",
) {
  const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
  if (!Array.isArray(notebook.cells) || index < 0 || index >= notebook.cells.length) {
    throw new Error(t("삽입할 기준 셀을 찾을 수 없습니다."))
  }
  const insertAt = position === "above" ? index : index + 1
  notebook.cells.splice(Math.max(0, Math.min(insertAt, notebook.cells.length)), 0, emptyNotebookCell(cellType))
  return JSON.stringify(notebook, null, 2)
}

export function deleteNotebookCell(rawContent: string, index: number) {
  const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
  if (!Array.isArray(notebook.cells) || !notebook.cells[index]) {
    throw new Error(t("삭제할 노트북 셀을 찾을 수 없습니다."))
  }
  if (notebook.cells.length <= 1) {
    throw new Error(t("마지막 셀은 삭제할 수 없습니다."))
  }
  notebook.cells.splice(index, 1)
  return JSON.stringify(notebook, null, 2)
}

export function moveNotebookCell(rawContent: string, index: number, offset: number) {
  const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
  if (!Array.isArray(notebook.cells) || !notebook.cells[index]) {
    throw new Error(t("이동할 노트북 셀을 찾을 수 없습니다."))
  }
  const target = Math.max(0, Math.min(index + (offset < 0 ? -1 : 1), notebook.cells.length - 1))
  if (target === index) return JSON.stringify(notebook, null, 2)
  const [moved] = notebook.cells.splice(index, 1)
  notebook.cells.splice(target, 0, moved)
  return JSON.stringify(notebook, null, 2)
}

export function updateNotebookCellSource(rawContent: string, cellIndex: number, nextSource: string) {
  const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
  if (!Array.isArray(notebook.cells) || !notebook.cells[cellIndex]) {
    throw new Error(t("편집할 노트북 셀을 찾을 수 없습니다."))
  }
  notebook.cells[cellIndex] = {
    ...notebook.cells[cellIndex],
    source: textToNotebookSource(nextSource),
  }
  return JSON.stringify(notebook, null, 2)
}

export function updateNotebookCellExecution(
  rawContent: string,
  cellIndex: number,
  outputs: NotebookExecutionOutput[],
  executionCount?: number | null,
) {
  const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
  if (!Array.isArray(notebook.cells) || !notebook.cells[cellIndex]) {
    throw new Error(t("실행할 노트북 셀을 찾을 수 없습니다."))
  }
  notebook.cells[cellIndex] = {
    ...notebook.cells[cellIndex],
    outputs,
    execution_count: executionCount ?? null,
  }
  return JSON.stringify(notebook)
}

export function changeNotebookCellType(rawContent: string, cellIndex: number, newType: NotebookCellType) {
  const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
  if (!Array.isArray(notebook.cells) || !notebook.cells[cellIndex]) {
    throw new Error(t("변경할 노트북 셀을 찾을 수 없습니다."))
  }
  const current = notebook.cells[cellIndex]
  if (newType === "code") {
    notebook.cells[cellIndex] = {
      cell_type: "code",
      execution_count: null,
      metadata: current.metadata ?? {},
      outputs: [],
      source: current.source ?? [],
    }
  } else {
    notebook.cells[cellIndex] = {
      cell_type: "markdown",
      metadata: current.metadata ?? {},
      source: current.source ?? [],
    }
  }
  return JSON.stringify(notebook, null, 2)
}

export function pasteNotebookCell(
  rawContent: string,
  targetIndex: number,
  cellData: { type: string; source: string },
) {
  const notebook = JSON.parse(rawContent) as { cells?: Array<Record<string, unknown>> }
  if (!Array.isArray(notebook.cells)) {
    throw new Error(t("붙여넣을 노트북을 찾을 수 없습니다."))
  }
  const newCell =
    cellData.type === "markdown"
      ? { cell_type: "markdown", metadata: {}, source: textToNotebookSource(cellData.source) }
      : { cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: textToNotebookSource(cellData.source) }

  const insertIndex = Math.max(0, Math.min(targetIndex + 1, notebook.cells.length))
  notebook.cells.splice(insertIndex, 0, newCell)
  return JSON.stringify(notebook, null, 2)
}
