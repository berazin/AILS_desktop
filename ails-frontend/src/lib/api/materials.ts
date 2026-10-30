import { requireDocument } from "../ide-policy.ts"
import { requestInitialDocumentJson, requestJson } from "./core.ts"
import { PreparedRead } from "./prepared-read.ts"
import type { LectureMaterialsPayload, MaterialKind } from "./core.ts"

export type MaterialTransferRequest = { mode: "copy" | "cut"; paths: string[]; target_folder_path: string }
export type MaterialTransferResult = {
  results: { status: "copied" | "moved" | "unchanged" | "error"; old_path: string; new_path?: string; error?: string
    image_link_updates?: MaterialImageLinkUpdate[]; warning?: string }[]
  materials: LectureMaterialsPayload
}

export function transferMaterialEntries(payload: MaterialTransferRequest) {
  return requestJson<MaterialTransferResult>("/material-entry/transfer", { method: "POST", body: JSON.stringify(payload) })
}

export type DocumentSourceLocation =
  | { kind: "pdf"; page: number; x: number; y: number; width: number; height: number }
  | {
      kind: "reflow"
      section_index: number
      section_ref?: string | null
      element: string
      offset: number
      length: number
      native_offset: number
      native_unit: string
    }

export type DocumentBlock =
  | { type: "heading"; level: number; text: string; location: DocumentSourceLocation }
  | { type: "paragraph"; text: string; location: DocumentSourceLocation }
  | { type: "image"; alt: string; source_ref?: string | null; location: DocumentSourceLocation }
  | { type: "table"; rows: string[][]; text: string; location: DocumentSourceLocation }

export interface DocumentTocEntry {
  title: string
  location: DocumentSourceLocation
  children: DocumentTocEntry[]
}

export interface AilsDocumentModel {
  schema_version: 1
  metadata: { title: string; creators: string[]; format: string; source_path: string }
  toc: DocumentTocEntry[]
  sections: Array<{
    id: string
    title?: string | null
    source_ref?: string | null
    location: DocumentSourceLocation
    blocks: DocumentBlock[]
  }>
}

export function getLectureMaterials(options?: { directory?: string; includeProblemProgress?: boolean; signal?: AbortSignal }) {
  const params = new URLSearchParams()
  if (options?.directory !== undefined) params.set("directory", options.directory)
  if (options?.includeProblemProgress) params.set("problem_progress", "1")
  const query = params.size ? `?${params}` : ""
  return requestJson<LectureMaterialsPayload>(`/lecture-materials${query}`, { signal: options?.signal })
}

export interface MaterialFilePayload {
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
  rendered_file_path?: string
  requires_libreoffice?: boolean
  libreoffice_install_supported?: boolean
  render_error?: string
  text_extraction_status?: PdfTextExtractionStatus
  text_extraction_cached?: boolean
  text_extraction_error?: string
  document_model?: AilsDocumentModel
}

export type PdfTextExtractionStatus = "pending" | "extracting" | "ready" | "error"

export interface PdfTextExtractionPayload {
  status: PdfTextExtractionStatus
  cached: boolean
  content?: string
  page_count?: number
  page_texts?: string[]
  error?: string
}

const initialMaterialRead = new PreparedRead((path: string, signal?: AbortSignal) => {
  requireDocument(path)
  return requestJson<{ file: MaterialFilePayload }>(`/material-file?path=${encodeURIComponent(path)}`, { signal })
}, (path, signal) => {
  requireDocument(path)
  return requestInitialDocumentJson<{ file: MaterialFilePayload }>(`/material-file?path=${encodeURIComponent(path)}`, signal)
})

export function getMaterialFile(path: string, signal?: AbortSignal) {
  return initialMaterialRead.take(path, signal)
}

export function prepareInitialMaterialRead(path: string) {
  initialMaterialRead.prepare(path)
  return () => initialMaterialRead.cancel()
}

export function getPdfPageVersion(path: string, signal?: AbortSignal) {
  return requestJson<{ version: string }>(`/material-file/pdf-page-version?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
    signal,
  })
}

export function getMaterialFileTextStatus(path: string, signal?: AbortSignal) {
  return requestJson<PdfTextExtractionPayload>(`/material-file/text-status?path=${encodeURIComponent(path)}`, { signal })
}

export function getPdfPageState() {
  return requestJson<{ pages: Record<string, number> }>("/pdf-page-state")
}

export function savePdfPageState(payload: { path: string; page: number }) {
  return requestJson<{ saved: boolean; path?: string; page?: number; pages?: Record<string, number> }>("/pdf-page-state", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function syncPdfPageState(payload: { pages: Record<string, number> }) {
  return requestJson<{ saved: boolean; pages?: Record<string, number> }>("/pdf-page-state", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function unlockMaterialPdf(payload: { path: string; password: string }) {
  return requestJson<{ unlocked: boolean; file: MaterialFilePayload }>("/material-file/unlock-pdf", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function getLibreOfficeStatus() {
  return requestJson<{ installed: boolean; path: string; install_supported: boolean; package_id: string }>("/libreoffice/status")
}

export function getPresentationConvertStatus(path: string, signal?: AbortSignal) {
  return requestJson<{ active: boolean; state: string; elapsed_seconds: number; error: string; cache_ready: boolean }>(
    `/presentation/convert-status?path=${encodeURIComponent(path)}`,
    { signal },
  )
}

export function installLibreOffice() {
  return requestJson<{ installed: boolean; path: string; already_installed?: boolean; output?: string }>("/libreoffice/install", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function saveMaterialFile(payload: { path: string; content: string }) {
  return requestJson<{ file: MaterialFilePayload }>("/material-file/save", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function renameMaterialFile(payload: { path: string; new_name: string }) {
  return requestJson<{ file: MaterialFilePayload; old_path: string; new_path: string }>("/material-file/rename", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export type MaterialSiblingTarget = {
  path: string
  fileName: string
  title: string
  kind: MaterialKind
}

export type MaterialFileSiblingsResponse = {
  previous: MaterialSiblingTarget | null
  next: MaterialSiblingTarget | null
  files: MaterialSiblingTarget[]
}

export function getMaterialFileSiblings(filePath: string) {
  return requestJson<MaterialFileSiblingsResponse>(`/material-file/siblings?path=${encodeURIComponent(filePath)}`)
}

export function deleteMaterialFile(payload: { path: string }) {
  return requestJson<{ deleted: boolean; path: string; trash_path?: string; materials: LectureMaterialsPayload }>("/material-file/delete", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createMaterialFolder(payload: { parent_path?: string; name?: string; unique?: boolean }) {
  return requestJson<{ folder: { name: string; path: string }; materials: LectureMaterialsPayload }>("/material-folder/create", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function createMaterialFile(payload: { parent_path?: string; kind: "md" | "txt"; name?: string; unique?: boolean }) {
  return requestJson<{ file: { name: string; path: string; kind: "md" | "txt" }; materials: LectureMaterialsPayload }>("/material-file/create", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function renameMaterialFolder(payload: { path: string; new_name: string }) {
  return requestJson<{
    folder: { name: string; path: string }
    old_path: string
    new_path: string
    materials: LectureMaterialsPayload
  }>("/material-folder/rename", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function deleteMaterialFolder(payload: { path: string }) {
  return requestJson<{ deleted: boolean; path: string; trash_path?: string; materials: LectureMaterialsPayload }>("/material-folder/delete", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function deleteMaterialTrashItem(payload: { path: string }) {
  return requestJson<{ deleted: boolean; path: string; materials: LectureMaterialsPayload }>("/material-trash/delete", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function restoreMaterialTrashItem(payload: {
  path: string
  target_folder_path?: string
  new_name?: string
}) {
  return requestJson<{
    restored: boolean
    old_path: string
    new_path: string
    materials: LectureMaterialsPayload
  }>("/material-trash/restore", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function emptyMaterialTrash() {
  return requestJson<{ deleted: boolean; deleted_count: number; materials: LectureMaterialsPayload }>("/material-trash/empty", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export type MaterialImageLinkUpdate = {
  file_path: string
  replacements: Array<{ before: string; after: string }>
}

type MaterialMoveResult = {
  moved: boolean
  old_path: string
  new_path: string
  moved_image_dirs?: number
  image_link_updates?: MaterialImageLinkUpdate[]
  materials: LectureMaterialsPayload
}

export function moveMaterialFile(payload: { source_path: string; target_folder_path: string }) {
  return requestJson<MaterialMoveResult>("/material-file/move", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function moveMaterialEntry(payload: { source_path: string; target_folder_path: string }) {
  return requestJson<MaterialMoveResult>("/material-entry/move", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function generateMaterialPractice(payload: {
  folder_path: string
  week_numbers?: number[]
  week_counts?: Record<number, number>
  file_counts?: Record<string, number>
  count?: number
  output_name?: string
  reference_pdf_paths?: string[]
  context_sources?: { chat: boolean; bookmarks: boolean; memory: boolean }
  home_chat?: Array<{ id: string; role: "user" | "assistant"; content: string }>
  generation_id?: string
}, signal?: AbortSignal) {
  return requestJson<{
    file: MaterialFilePayload
    output_path: string
    count: number
    excluded_count?: number
    excluded_reasons?: string[]
    context_usage?: Record<string, Record<string, { status: string; used_count: number; skipped_reasons?: string[] }>>
    materials: LectureMaterialsPayload
  }>("/material-practice/generate", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  })
}

export function cancelMaterialPracticeGeneration(generationId: string) {
  return requestJson<{ cancelled: boolean }>("/material-practice/cancel", {
    method: "POST", body: JSON.stringify({ generation_id: generationId }),
  })
}
