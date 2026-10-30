import { useSyncExternalStore } from 'react'
import { getAppDesktopApi } from '../../lib/desktop-api.ts'
import { officeRequest, type OfficeFile } from '../../lib/api/office.ts'
import { encodeBytes, type OfficeEngine, type OfficeProposal } from './types.ts'

const sessions = new Map<string, OfficeSession>()
const listeners = new Set<() => void>()
let tick = 0, closeRegistered = false
function publish() { tick++; listeners.forEach(listener => listener()) }
export function useOfficeRevision() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => tick) }
export function getOfficeSession(id: string) { return sessions.get(id) }
export function officeTitle(id: string, title: string) { const session = sessions.get(id); return session ? `${session.path.split(/[\\/]/).pop()}${session.dirty ? ' •' : ''}` : title }
export function canCloseOffice(id: string) {
  const session = sessions.get(id)
  if (session?.engine?.synchronize && !session.closeVerified) {
    void session.verifyClose()
    return false
  }
  if (session) session.closeVerified = false
  if (!session?.dirty) return true
  window.dispatchEvent(new CustomEvent('ails:office-close-request', { detail: id }))
  return false
}
export class OfficeSession {
  readonly id: string
  dirty = false
  version = 0
  busy = false
  closeVerified = false
  private checkingClose = false
  error = ''
  engine?: OfficeEngine
  path: string
  revision: string
  warnings: string[]
  requiresCopy: boolean
  private timer?: ReturnType<typeof setTimeout>
  private writing: Promise<void> = Promise.resolve()
  constructor(id: string, file: OfficeFile) {
    this.id = id
    this.path = file.path; this.revision = file.revision; this.warnings = file.warnings
    this.requiresCopy = file.requires_copy
    sessions.set(id, this)
    if (!closeRegistered) {
      closeRegistered = true
      getAppDesktopApi()?.on_before_close?.(async () => {
        // A Ctrl+S immediately followed by quit must finish its queued save
        // before taking the dirty-session snapshot.
        await Promise.all([...sessions.values()].map(s => s.writing))
        await Promise.all([...sessions.values()].map(s => s.engine?.synchronize?.()))
        const dirty = [...sessions.values()].filter(s => s.dirty)
        await Promise.all(dirty.map(s => s.draft()))
        if (dirty.length) { window.dispatchEvent(new CustomEvent('ails:office-close-request', { detail: dirty[0].id })); throw new Error('편집 중인 문서를 저장하거나 변경 사항을 버린 뒤 종료하세요. 복구 사본은 보존했습니다.') }
      })
      window.addEventListener('beforeunload', event => { if ([...sessions.values()].some(s => s.dirty)) { event.preventDefault(); event.returnValue = '' } })
    }
  }
  changed = () => {
    this.closeVerified = false
    this.dirty = true; this.version++; publish(); clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.draft().catch(error => { this.error = String(error); publish() }) }, 1500)
  }
  async verifyClose() {
    if (this.checkingClose) return
    this.checkingClose = true
    try {
      await this.engine?.synchronize?.()
      this.closeVerified = !this.dirty
      window.dispatchEvent(new CustomEvent(this.dirty ? 'ails:office-close-request' : 'ails:office-close-ready', { detail: this.id }))
    } catch (error) { this.error = String(error); publish() } finally { this.checkingClose = false }
  }
  async draft() {
    const action = async () => {
      if (!this.engine || !this.dirty) return
      const data = encodeBytes(await this.engine.serialize())
      await officeRequest('draft', { path: this.path, data })
    }
    const next = this.writing.then(action, action); this.writing = next.catch(() => {}); return next
  }
  async discard() {
    clearTimeout(this.timer)
    await this.writing
    await officeRequest('discard-recovery', { path: this.path })
    this.dirty = false; this.closeVerified = true; publish()
  }
  async save(target = this.path) {
    if (!this.engine) throw new Error('문서가 아직 준비되지 않았습니다.')
    const action = async () => {
      this.busy = true; this.error = ''; publish()
      try {
        await this.engine!.synchronize?.()
        const version = this.version
        const data = encodeBytes(await this.engine!.serialize())
        const result = await officeRequest<{ path: string; revision: string }>('save', { path: this.path, target, revision: this.revision, data })
        this.path = result.path; this.revision = result.revision
        this.requiresCopy = false
        await this.engine!.synchronize?.()
        if (this.version === version) {
          await this.engine!.saved?.(this.path)
          if (this.version === version) { this.dirty = false; clearTimeout(this.timer) }
        }
        // A generated copy has already been inspected by the user; subsequent
        // saves still pass the backend's format/loss guard.
        window.dispatchEvent(new CustomEvent('ails:office-saved', { detail: { id: this.id, path: this.path } }))
      } catch (error) { this.error = String(error); throw error } finally { this.busy = false; publish() }
    }
    const next = this.writing.then(action, action); this.writing = next.catch(() => {}); return next
  }
  async proposal(after: string): Promise<OfficeProposal> {
    if (!this.engine) throw new Error('문서를 여는 중입니다.')
    const selection = await this.engine.selection()
    return { ...selection, before: selection.text, after, revision: this.version }
  }
  async apply(proposal: OfficeProposal) {
    if (!this.engine || proposal.revision !== this.version) throw new Error('제안 이후 문서가 변경되었습니다. 다시 제안하세요.')
    const selection = await this.engine.selection()
    if (selection.text !== proposal.before || selection.target !== proposal.target) throw new Error('선택 영역이 달라졌습니다. 원래 영역을 선택한 뒤 다시 제안하세요.')
    await this.engine.replaceSelection(proposal.after)
    this.changed()
  }
  dispose() { clearTimeout(this.timer); this.engine?.destroy(); if (sessions.get(this.id) === this) sessions.delete(this.id); publish() }
}
