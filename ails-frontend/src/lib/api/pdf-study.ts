import { requestJson } from "./core.ts"
import type { PdfAnnotationPoint, PdfAnnotationRect } from "../../features/pdf/lib/pdf-annotation-geometry.ts"

export interface PdfStudyChatTurn {
  answer_evidence?: import("../../features/chat/lib/answer-evidence.ts").AnswerEvidence[]
  web_search?: import("./chatbot.ts").WebSearchReport
  practice_context?: import("./practice-tutor.ts").PracticeTutorContext
  turn_id: string
  session_id: string
  question: string
  answer: string
  concept_summary: string
  model: string
  provider: string
  created_at: string
}

export interface PdfStudyChatHistory {
  document_id: string
  session_id: string
  turns: PdfStudyChatTurn[]
}

export interface PdfStudyChatSession {
  session_id: string
  title: string
  turn_count: number
  created_at: string
  updated_at: string
}

export interface PdfStudyChatConcept {
  turn_id: string
  document_id: string
  document_title: string
  question: string
  concept_summary: string
  model: string
  provider: string
  created_at: string
}

export function getPdfStudyChatHistory(path: string, sessionId = "", signal?: AbortSignal) {
  return requestJson<PdfStudyChatHistory>(
    `/pdf/study/chat-history?${new URLSearchParams({ path, session_id: sessionId }).toString()}`,
    { signal },
  )
}

export function getPdfStudyChatSessions(path: string, signal?: AbortSignal) {
  return requestJson<{ document_id: string; sessions: PdfStudyChatSession[] }>(
    `/pdf/study/chat-sessions?${new URLSearchParams({ path }).toString()}`,
    { signal },
  )
}

export function getPdfStudyChatConcepts(path: string, signal?: AbortSignal) {
  return requestJson<{ document_id: string; concepts: PdfStudyChatConcept[] }>(
    `/pdf/study/chat-concepts?${new URLSearchParams({ path }).toString()}`,
    { signal },
  )
}

export function savePdfStudyChatTurn(
  payload: Omit<PdfStudyChatTurn, "created_at"> & { pdf_path: string; created_at?: string },
  signal?: AbortSignal,
) {
  return requestJson<{ turn: PdfStudyChatTurn; created: boolean }>("/pdf/study/chat-history", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  })
}

export function deletePdfStudyChatHistory(path: string, sessionId = "", signal?: AbortSignal) {
  return requestJson<{ document_id: string; deleted_count: number }>(
    `/pdf/study/chat-history?${new URLSearchParams({ path, session_id: sessionId }).toString()}`,
    { method: "DELETE", signal },
  )
}

export function deletePdfStudyChatTurn(turnId: string, signal?: AbortSignal) {
  return requestJson<{ turn_id: string; deleted: boolean }>("/pdf/study/chat-turn", {
    method: "DELETE",
    body: JSON.stringify({ turn_id: turnId }),
    signal,
  })
}

export type PdfAnnotationKind = "stroke" | "line" | "ellipse" | "connector" | "text" | "highlight" | "underline"

export interface PdfAnnotation {
  annotation_id: string
  page: number
  kind: PdfAnnotationKind
  seed?: number
  color: string
  stroke_width: number
  font_size: number
  text: string
  pinned?: boolean
  points: PdfAnnotationPoint[]
  rects: PdfAnnotationRect[]
  created_at?: string
  updated_at?: string
}

export function getPdfAnnotations(path: string, signal?: AbortSignal) {
  return requestJson<{ document_id: string; annotations: PdfAnnotation[] }>(
    `/pdf/study/annotations?${new URLSearchParams({ path }).toString()}`,
    { signal },
  )
}

export function savePdfAnnotation(
  pdfPath: string,
  annotation: PdfAnnotation,
  signal?: AbortSignal,
) {
  return requestJson<{ annotation: PdfAnnotation; created: boolean }>("/pdf/study/annotations", {
    method: "POST",
    body: JSON.stringify({ pdf_path: pdfPath, annotation }),
    signal,
  })
}

export function deletePdfAnnotation(path: string, annotationId: string, signal?: AbortSignal) {
  return requestJson<{ document_id: string; deleted_count: number }>(
    `/pdf/study/annotations?${new URLSearchParams({ path, annotation_id: annotationId }).toString()}`,
    { method: "DELETE", signal },
  )
}

export interface PdfStudySummary {
  total_active_seconds: number
  session_count: number
}

export interface PdfStudySession {
  session_id: string
  document_id: string
  started_at: string
  last_activity_at: string
  status: string
}

export interface PdfBookmark {
  bookmark_id: string
  page: number
  label: string
  created_at: string
  updated_at: string
}

export interface PdfDocumentMemo {
  annotation_id: string
  page: number
  text: string
  updated_at: string
}

export interface PdfStudyDocumentInfo {
  document_id: string
  study: PdfStudySummary
  bookmarks: PdfBookmark[]
  memos: PdfDocumentMemo[]
  note: string
  tags: string[]
}

export interface PdfDocumentMeta {
  path: string
  note: string
  tags: string[]
  updated_at: string
}

export function startPdfStudySession(pdfPath: string, signal?: AbortSignal) {
  return requestJson<{ session: PdfStudySession; study: PdfStudySummary }>("/pdf/study/session/start", {
    method: "POST",
    body: JSON.stringify({ pdf_path: pdfPath }),
    signal,
  })
}

export function sendPdfStudyActivity(
  sessionId: string,
  activeSeconds: number,
  page?: number,
  signal?: AbortSignal,
) {
  return requestJson<{ accepted: boolean; active_seconds: number; study: PdfStudySummary }>(
    "/pdf/study/session/activity",
    {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, active_seconds: activeSeconds, page }),
      signal,
    },
  )
}

export function getPdfStudyDocumentInfo(path: string, signal?: AbortSignal) {
  return requestJson<PdfStudyDocumentInfo>(
    `/pdf/study/document-info?${new URLSearchParams({ path }).toString()}`,
    { signal },
  )
}

export function togglePdfBookmark(pdfPath: string, page: number, label = "", signal?: AbortSignal) {
  return requestJson<{ created: boolean; page: number; bookmarks: PdfBookmark[] }>(
    "/pdf/study/bookmarks",
    {
      method: "POST",
      body: JSON.stringify({ pdf_path: pdfPath, page, label }),
      signal,
    },
  )
}

export function savePdfDocumentNote(pdfPath: string, note: string, signal?: AbortSignal) {
  return requestJson<{ note: string; tags: string[] }>("/pdf/study/document-note", {
    method: "POST",
    body: JSON.stringify({ pdf_path: pdfPath, note }),
    signal,
  })
}

export function savePdfDocumentTags(pdfPath: string, tags: string[], signal?: AbortSignal) {
  return requestJson<{ note: string; tags: string[] }>("/pdf/study/tags", {
    method: "POST",
    body: JSON.stringify({ pdf_path: pdfPath, tags }),
    signal,
  })
}

export function getPdfDocumentMetas(signal?: AbortSignal) {
  return requestJson<{ metas: PdfDocumentMeta[] }>("/pdf/study/document-metas", { signal })
}
