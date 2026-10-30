import { requestJson, requestInitialDocumentJson } from './core.ts'
import { PreparedRead } from './prepared-read.ts'

export type OfficeFile = { path: string; revision: string; data: string; warnings: string[]; requires_copy: boolean; has_recovery: boolean }
const officeReadPath = (path: string) => `/office/open?path=${encodeURIComponent(path)}`
const readOfficeFile = (path: string, signal?: AbortSignal) => requestJson<OfficeFile>(officeReadPath(path), { signal })
// Reading a document has no side effects. Its authenticated GET can wait at the
// gateway alongside the initial material metadata, without polling or replaying
// a POST. Mutations retain the normal readiness checks and POST routes.
const initialOfficeRead = new PreparedRead(readOfficeFile, (path, signal) =>
  requestInitialDocumentJson<OfficeFile>(officeReadPath(path), signal))
export const openOfficeFile = (path: string, signal?: AbortSignal) => initialOfficeRead.take(path, signal)
export function prepareInitialOfficeRead(path: string, onRead?: (file: OfficeFile) => void | Promise<void>) {
  initialOfficeRead.prepare(path, onRead)
  return () => initialOfficeRead.cancel()
}
export function officeRequest<T>(action: string, payload: object): Promise<T> {
  return requestJson<T>(`/office/${action}`, { method: 'POST', body: JSON.stringify(payload) })
}
