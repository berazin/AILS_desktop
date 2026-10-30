import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Loader2, Save, Undo2, Redo2, Search } from 'lucide-react'
import type { ViewerDocument } from '../../lib/viewer-document.ts'
import { openOfficeFile, officeRequest } from '../../lib/api/office.ts'
import { getAppDesktopApi } from '../../lib/desktop-api.ts'
import { OfficeSession, useOfficeRevision } from './session.ts'
import { decodeBytes, type OfficeProposal } from './types.ts'
import { TextInputDialog as WorkspaceInputDialog, type TextInputRequest as WorkspaceInput } from '../../shared/ui/text-input-dialog.tsx'
import './office.css'
import { markDocumentStartupPhase, observeDocumentPresentation } from '../../lib/document-presentation-diagnostics.ts'
import { loadOfficeEngine } from './engine-loader.ts'
import { takeOfficeInput } from './prepared-office-input.ts'

export function OfficeWorkspace({ document: file, onAsk }: { document: ViewerDocument; onAsk: (text: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const session = useRef<OfficeSession | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (ready) return observeDocumentPresentation(file.kind, () => {
      const engine = session.current?.engine
      return engine?.presentationElement ? engine.presentationElement() : container.current
    })
  }, [ready, file.kind, file.id])
  const [error, setError] = useState('')
  const [input, setInput] = useState<WorkspaceInput | null>(null)
  const [closing, setClosing] = useState(false)
  const [recovery, setRecovery] = useState(0)
  const [mountAttempt, setMountAttempt] = useState(0)
  const [backups, setBackups] = useState<{ revision: string; modified: number }[] | null>(null)
  const [proposal, setProposal] = useState<OfficeProposal | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  useOfficeRevision()
  const initial = useRef({ file, dark: resolvedTheme === 'dark' })
  useEffect(() => {
    let disposed = false
    const abort = new AbortController()
    setReady(false)
    const host = container.current!
    const { file, dark } = initial.current
    async function mount() {
      markDocumentStartupPhase('office-open-start')
      const [opened, mount] = await Promise.all([
        openOfficeFile(file.file_path, abort.signal).then(value => { markDocumentStartupPhase('office-read-ready'); return value }),
        loadOfficeEngine(file.kind).then(value => { markDocumentStartupPhase('office-code-ready'); return value }),
      ])
      if (disposed) return
      const current = new OfficeSession(file.id, opened); session.current = current
      const prepared = takeOfficeInput(opened)
      let bytes = prepared.bytes
      if (recovery) { const saved = await officeRequest<{ data: string }>('recovery', { path: opened.path }); bytes = decodeBytes(saved.data) }
      const engine = await mount(host, bytes, opened.path, current.changed, { dark, xlsx: recovery ? undefined : prepared.xlsx })
      markDocumentStartupPhase('office-mount-ready')
      if (disposed) { engine.destroy(); current.dispose(); return }
      current.engine = engine
      if (recovery) current.changed()
      setReady(true)
      if (opened.has_recovery && !recovery) setError('이전에 저장하지 않은 복구 사본이 있습니다. 복구 버튼으로 열 수 있습니다.')
    }
    void mount().catch(error => { if (!disposed) setError(String(error)) })
    return () => { disposed = true; abort.abort(); session.current?.dispose(); host.replaceChildren() }
  }, [recovery, mountAttempt])
  useEffect(() => {
    const close = (event: Event) => { if ((event as CustomEvent).detail === file.id) setClosing(true) }
    const propose = (event: Event) => { const detail = (event as CustomEvent<{ id: string; text: string }>).detail; if (detail.id === file.id) setDraft(detail.text) }
    window.addEventListener('ails:office-close-request', close); window.addEventListener('ails:office-propose', propose)
    return () => { window.removeEventListener('ails:office-close-request', close); window.removeEventListener('ails:office-propose', propose) }
  }, [file.id])
  const current = session.current
  const run = (action: () => void | Promise<void>) => { setError(''); void Promise.resolve().then(action).catch(error => setError(String(error))) }
  const recover = () => {
    if (current) initial.current = { ...initial.current, file: { ...initial.current.file, file_path: current.path } }
    setError(''); setReady(false); setRecovery(value => value + 1)
  }
  const save = async (copy = false) => {
    if (!current) return
    let target = current.path
    if (copy || current.requiresCopy) {
      const chooseCopy = getAppDesktopApi()?.save_office_copy
      const selected = chooseCopy ? (await chooseCopy(current.path)).path
        : await new Promise<string | null>(resolve => setInput({ title: '다른 이름으로 저장', initialValue: current.path.replace(/(\.[^.]+)$/, ' - 편집본$1'), description: '원본을 보존합니다. 작업공간 안의 새 파일 경로를 입력하세요.', resolve: value => { setInput(null); resolve(value) } }))
      if (!selected) return
      target = selected
    }
    await current.save(target)
    if (closing) window.dispatchEvent(new CustomEvent('ails:office-close-ready', { detail: file.id }))
  }
  useEffect(() => {
    const host = container.current
    const listener = (event: Event) => run(() => save(Boolean((event as CustomEvent).detail?.copy)))
    host?.addEventListener('ails:office-save', listener)
    return () => host?.removeEventListener('ails:office-save', listener)
  })
  return <div className="office-workspace" data-ails-office-editor={file.kind} onKeyDownCapture={event => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); run(() => save(event.shiftKey)) }
  }}>
    <div className="office-toolbar">
      <span className="truncate font-medium">{current?.path.split(/[\\/]/).pop() ?? file.title}{current?.dirty ? ' •' : ''}</span>
      <button disabled={!ready || current?.busy} onClick={() => run(() => save())}><Save size={15} />저장</button>
      <button disabled={!ready || current?.busy} onClick={() => run(() => save(true))}>다른 이름으로</button>
      <button disabled={!ready || current?.busy} onClick={() => run(async () => { const result = await officeRequest<{ backups: { revision: string; modified: number }[] }>('backups', { path: current!.path }); setBackups(result.backups) })}>백업 복구</button>
      <button aria-label="실행 취소" disabled={!ready} onClick={() => run(() => current?.engine?.command('undo'))}><Undo2 size={15} /></button>
      <button aria-label="다시 실행" disabled={!ready} onClick={() => run(() => current?.engine?.command('redo'))}><Redo2 size={15} /></button>
      <button aria-label="문서 검색" disabled={!ready} onClick={() => run(() => current?.engine?.command('find'))}><Search size={15} /></button>
      <button disabled={!ready} onClick={() => run(async () => { const selection = await current!.engine!.selection(); if (!selection.text) throw new Error('질문할 영역을 선택하세요.'); onAsk(selection.text) })}>선택 영역 질문</button>
      <button disabled={!ready} onClick={() => run(async () => { const text = await current!.engine!.text(); if (text.length > 100000) throw new Error('문서가 큽니다. 질문할 영역을 선택하세요.'); onAsk(text) })}>문서 전체 질문</button>
      <button disabled={!ready} onClick={() => setDraft('')}>수정안 검토</button>
      <span role="status" className="text-xs">{current?.busy ? '저장 중…' : current?.dirty ? '저장하지 않은 변경' : ready ? '저장됨' : '편집기 준비 중…'}</span>
    </div>
    {!!current?.warnings.length && <div className="office-notice">{current.warnings.join(' ')}</div>}
    {(error || current?.error) && <div role="alert" className="office-notice">{error || current?.error}
      {!ready && <button onClick={() => { setError(''); setMountAttempt(value => value + 1) }}>다시 시도</button>}
      {error.includes('복구 사본이 있습니다') && <button onClick={recover}>복구</button>}
    </div>}
    {backups && <div className="office-notice"><span>백업을 편집기로 복구합니다. 현재 변경을 보존하려면 먼저 저장하세요.</span>
      {!backups.length && <span>저장된 백업이 없습니다.</span>}
      {backups.map(backup => <button key={backup.revision} disabled={current?.dirty} onClick={() => run(async () => { await officeRequest('restore-backup', { path: current!.path, backup_revision: backup.revision }); setBackups(null); recover() })}>{new Date(backup.modified * 1000).toLocaleString()} · {backup.revision.slice(0, 8)}</button>)}
      <button onClick={() => setBackups(null)}>닫기</button>
    </div>}
    {closing && <div className="office-notice">변경 내용을 저장한 뒤 닫으세요.
      <button onClick={() => run(() => save())}>저장 후 닫기</button>
      <button onClick={() => run(async () => { await current!.discard(); window.dispatchEvent(new CustomEvent('ails:office-close-ready', { detail: file.id })) })}>변경 버리고 닫기</button>
      <button onClick={() => setClosing(false)}>취소</button>
    </div>}
    {!ready && !error && <div role="status" className="office-notice"><Loader2 className="animate-spin" size={18} />문서를 여는 중…</div>}
    {draft !== null && <div className="office-review">
      <label>선택 영역에 적용할 수정안<textarea value={draft} onChange={e => setDraft(e.target.value)} /></label>
      <button onClick={() => run(async () => { setProposal(await current!.proposal(draft)); setDraft(null) })}>변경 전후 비교</button><button onClick={() => setDraft(null)}>취소</button>
    </div>}
    {proposal && <div className="office-review"><div className="grid grid-cols-2 gap-3"><pre>{proposal.before}</pre><pre>{proposal.after}</pre></div>
      <button onClick={() => run(async () => { await current!.apply(proposal); setProposal(null) })}>승인하고 적용</button><button onClick={() => setProposal(null)}>취소</button>
    </div>}
    <div className="office-engine" ref={container} />
    <WorkspaceInputDialog input={input} />
  </div>
}
