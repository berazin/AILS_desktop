import {
  type AilsDocumentModel,
  type MaterialFilePayload,
  type MaterialKind,
} from "./api"

export type ViewerDocument = {
  id: string
  title: string
  kind: MaterialKind
  content: string
  raw_content?: string
  file_path: string
  file_url?: string
  page_count?: number
  page_texts?: string[]
  read_only?: boolean
  loading?: boolean
  deferred?: boolean
  rendered_file_path?: string
  requires_libreoffice?: boolean
  libreoffice_install_supported?: boolean
  render_error?: string
  text_extraction_status?: "pending" | "extracting" | "ready" | "error"
  text_extraction_cached?: boolean
  text_extraction_error?: string
  document_model?: AilsDocumentModel
  source: "session" | "material"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizedMaterialPath(path: string) {
  return path.replace(/\\/g, "/")
}

export function isPdfPasswordError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("PDF_PASSWORD_REQUIRED") || message.includes("PDF_PASSWORD_INVALID")
}

// 변환된 PDF(rendered_file_path)를 보는 PPT/PPTX도 완전한 PDF 뷰어 경로를 타게 한다.
export function viewerDocumentIsPdf(
  document: { kind?: string; rendered_file_path?: string } | null | undefined,
) {
  return Boolean(document && (document.kind === "pdf" || document.rendered_file_path))
}

// Layout only: loading placeholders remain read-only txt until metadata arrives.
export function viewerDocumentUsesMarkdownLayout(document: ViewerDocument | null | undefined) {
  return Boolean(document && (document.kind === "md" || (document.loading && /\.md$/i.test(document.file_path))))
}

export function titleFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/")
  const fileName = normalized.split("/").pop() ?? ""
  return fileName.replace(/\.[^.]+$/, "")
}

export function inferPdfPageCount(document: ViewerDocument | null | undefined) {
  if (!document || (document.kind !== "pdf" && !document.rendered_file_path)) return 1
  const explicitCount = Number(document.page_count ?? 0)
  if (Number.isFinite(explicitCount) && explicitCount > 0) return Math.floor(explicitCount)
  const pageTextCount = document.page_texts?.length ?? 0
  if (pageTextCount > 0) return pageTextCount
  const headings = document.content.match(/^##\s+Page\s+\d+/gim)
  return Math.max(1, headings?.length ?? 1)
}

export function pdfPageStorageKey(document: ViewerDocument | null | undefined) {
  const path = document?.file_path || document?.rendered_file_path || ""
  return path ? normalizedMaterialPath(path) : ""
}

export function savedPdfPageForDocument(document: ViewerDocument, savedPages: Record<string, number>) {
  if (document.kind !== "pdf" && !document.rendered_file_path) return null
  const pathKey = pdfPageStorageKey(document)
  if (!pathKey) return null
  const page = savedPages[pathKey]
  if (!Number.isFinite(page) || page < 1) return null
  return clamp(Math.floor(page), 1, inferPdfPageCount(document))
}

export function viewerFromMaterial(file: MaterialFilePayload): ViewerDocument {
  return {
    id: file.id,
    title: file.title,
    kind: file.kind,
    content: file.content,
    raw_content: file.raw_content,
    file_path: file.file_path,
    file_url: file.file_url,
    page_count: file.page_count,
    page_texts: file.page_texts,
    read_only: file.read_only,
    rendered_file_path: file.rendered_file_path,
    requires_libreoffice: file.requires_libreoffice,
    libreoffice_install_supported: file.libreoffice_install_supported,
    render_error: file.render_error,
    text_extraction_status: file.text_extraction_status,
    text_extraction_cached: file.text_extraction_cached,
    text_extraction_error: file.text_extraction_error,
    document_model: file.document_model,
    source: "material",
  }
}

export function chatDocumentKey(document: ViewerDocument | null | undefined) {
  if (!document) return "global"
  return document.file_path || `${document.source}:${document.id}`
}
