import type { readXlsx } from './xlsx-adapter.ts'

export const OFFICE_KINDS = new Set(['docx', 'xlsx', 'csv', 'hwp', 'hwpx', 'html', 'htm'])
export type OfficeSelection = { text: string; target?: string }
export type OfficeProposal = { before: string; after: string; target?: string; revision: number }
export interface OfficeEngine {
  serialize(): Promise<Uint8Array>
  text(): Promise<string>
  selection(): Promise<OfficeSelection>
  replaceSelection(text: string): Promise<void>
  command(name: 'undo' | 'redo' | 'find'): void | Promise<void>
  synchronize?(): Promise<void>
  saved?(path: string): Promise<void>
  presentationElement?(): Element | null
  destroy(): void
}
export type OfficeMount = (container: HTMLElement, bytes: Uint8Array, name: string,
  changed: () => void, options: { dark: boolean; studioUrl?: string; xlsx?: ReturnType<typeof readXlsx> }) => Promise<OfficeEngine>

export function encodeBytes(bytes: Uint8Array) {
  let value = ''
  for (let i = 0; i < bytes.length; i += 16384) value += String.fromCharCode(...bytes.subarray(i, i + 16384))
  return btoa(value)
}
export function decodeBytes(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)) }
