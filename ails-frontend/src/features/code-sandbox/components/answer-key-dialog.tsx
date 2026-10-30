import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, ChevronDown, FileText, FolderOpen, Link2, LoaderCircle, X } from 'lucide-react'
import type { PdfAnswerKeyPreview, PdfAnswerKeyBatchItem, PdfProblem } from '../../../lib/api.ts'
import { useEventCallback } from '../../../shared/hooks/use-event-callback.ts'
import { useAnswerKeyWindow } from '../hooks/use-answer-key-window.ts'
import { AnswerKeyBatchReview } from './answer-key-batch-review.tsx'
import './answer-key-dialog.css'

export interface AnswerKeySourceFields {
  path: string
  edition: string
  firstPage: string
  lastPage: string
  firstLine: string
  lastLine: string
  box: string
  manualRange: boolean
}
interface Props {
  problem: PdfProblem
  pdfPath: string
  source: AnswerKeySourceFields
  preview: PdfAnswerKeyPreview | null
  busy: boolean
  saving: boolean
  linked: boolean
  error: string
  onSourceChange: (fields: Partial<AnswerKeySourceFields>) => void
  onPick: () => void
  onInspect: () => void
  onUnlink: () => void
  onSaveBatch: (items: PdfAnswerKeyBatchItem[], verified: boolean) => void
  onOpenPdfPage?: (page: number) => void
  onOpenSourceFile: () => void
  onClose: () => void
}
const fileName = (path: string) => path.split(/[\\/]/).pop() || path
const isSameFile = (left: string, right: string) => left.replaceAll('\\', '/').toLowerCase() === right.replaceAll('\\', '/').toLowerCase()

export function AnswerKeyDialog({ problem, pdfPath, source, preview, busy, saving, linked, error,
  onSourceChange, onPick, onInspect, onUnlink, onSaveBatch, onOpenPdfPage, onOpenSourceFile, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const floating = useAnswerKeyWindow()
  const [unlinking, setUnlinking] = useState(false)
  const close = useEventCallback(() => { if (!saving) onClose() })
  const currentPdf = isSameFile(source.path, pdfPath)
  const pdfSource = /\.pdf$/i.test(source.path)
  const review = preview?.status === 'ready' && preview.candidates.length > 0
  const customSource = Boolean(source.edition || source.box || source.firstLine !== '1' || source.lastLine !== '200000')

  useEffect(() => {
    const panel = dialog.current
    const previous = document.activeElement
    const frame = requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>('button')?.focus())
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.target instanceof Node) || !dialog.current?.contains(event.target)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', handleKey, true); if (previous instanceof HTMLElement && previous.isConnected && panel?.contains(document.activeElement)) previous.focus() }
  }, [close])

  return createPortal(<div className="answer-key-overlay" data-answer-key-overlay>
    <div ref={dialog} role="dialog" aria-modal="false" aria-labelledby="answer-key-title" aria-describedby="answer-key-description" style={floating.style}
      className={'answer-key-dialog' + (review ? ' answer-key-dialog-review' : '')} data-answer-key-dialog>
      <header className="answer-key-header" data-answer-key-drag {...floating.drag}>
        <div className="answer-key-heading"><span className="answer-key-icon"><Link2 size={20} /></span><div>
          <h2 id="answer-key-title">답지 연결</h2>
          <p id="answer-key-description">{fileName(pdfPath)} · 창을 옮겨 원본과 대조하세요.</p>
        </div></div>
        <button type="button" className="answer-key-close" aria-label="답지 연결 닫기" disabled={saving} onClick={close}><X size={20} /></button>
      </header>
      <nav className="answer-key-steps" aria-label="답지 연결 단계">
        <span className={review ? 'is-complete' : 'is-active'}><i>{review ? <Check size={12} /> : '1'}</i>{review ? <button type="button" disabled={busy} className="answer-key-text-button" onClick={() => onSourceChange({})}>답지 선택 변경</button> : '답지 선택'}</span>
        <span className="answer-key-step-line" />
        <span className={review ? 'is-active' : ''}><i>2</i>전체 문제 연결</span>
      </nav>
      <div className="answer-key-body">
        {!review ? <>
          <div className="answer-key-section-heading"><h3>답지는 어디에 있나요?</h3><p>현재 문서에 있는 답지 또는 별도 파일을 선택하세요.</p></div>
          <div className="answer-key-source-options">
            <button type="button" className={'answer-key-source-option' + (currentPdf ? ' is-selected' : '')} aria-pressed={currentPdf} data-answer-key-current
              disabled={busy} onClick={() => onSourceChange({ path: pdfPath, manualRange: false, firstLine: '1', lastLine: '200000', box: '' })}>
              <FileText size={22} /><span><strong>현재 PDF에서 찾기</strong><small>텍스트에서 답지 구간을 자동으로 찾습니다.</small></span><i>{currentPdf && <Check size={13} />}</i>
            </button>
            <button type="button" className={'answer-key-source-option' + (!currentPdf ? ' is-selected' : '')} aria-pressed={!currentPdf} data-answer-key-pick disabled={busy} onClick={onPick}>
              <FolderOpen size={22} /><span><strong>별도 답지 파일</strong><small>PDF 또는 텍스트 답지를 선택합니다.</small></span><i>{!currentPdf && <Check size={13} />}</i>
            </button>
          </div>
          <div className="answer-key-selected-file"><FileText size={18} /><div><span>{currentPdf ? '현재 문서' : '선택한 답지'}</span><strong title={source.path}>{fileName(source.path)}</strong></div>
            {(currentPdf ? Boolean(onOpenPdfPage) : /\.(pdf|txt|md|csv|tsv)$/i.test(source.path)) && <button type="button" className="answer-key-text-button" data-answer-key-open-source disabled={busy} onClick={() => currentPdf ? onOpenPdfPage?.(Number(source.firstPage) || 1) : onOpenSourceFile()}>원본 보기</button>}
            {!currentPdf && <button className="answer-key-text-button" type="button" disabled={busy} onClick={onPick}>파일 변경</button>}
          </div>
          {pdfSource ? <div className="answer-key-page-range"><div><h3>{source.manualRange ? '답지가 있는 페이지' : '답지 페이지 자동 찾기'}</h3><p>{source.manualRange ? 'PDF의 페이지 순서로 지정하세요. 한 번에 최대 30쪽을 읽습니다.' : '시작·끝 페이지와 같은 페이지의 답지 영역을 텍스트에서 찾습니다.'}</p></div>
            {source.manualRange && <div className="answer-key-range-inputs"><label><span>시작 페이지</span><input aria-label="답지 시작 쪽" type="number" min={1} value={source.firstPage} disabled={busy} onChange={event => onSourceChange({ firstPage: event.target.value })} /></label>
              <span className="answer-key-range-separator">—</span><label><span>끝 페이지</span><input aria-label="답지 끝 쪽" type="number" min={source.firstPage || 1} value={source.lastPage} disabled={busy} onChange={event => onSourceChange({ lastPage: event.target.value })} /></label></div>}
            <button type="button" className="answer-key-text-button" data-answer-key-range-toggle disabled={busy} onClick={() => onSourceChange({ manualRange: !source.manualRange })}>{source.manualRange ? '자동으로 찾기' : '페이지 직접 지정'}</button>
          </div> : <p className="answer-key-help">텍스트 답지는 파일 전체에서 정답을 찾습니다. 필요한 경우 세부 설정에서 줄 범위를 좁힐 수 있습니다.</p>}
          <details className="answer-key-details" data-answer-key-source-details>
            <summary><ChevronDown size={14} />세부 설정 <span>{customSource ? '설정 적용됨' : '선택 사항'}</span></summary>
            <div className="answer-key-detail-fields">
              <label className="answer-key-field"><span>파일 경로 직접 입력</span><input aria-label="답지 파일 경로" value={source.path} disabled={busy} onChange={event => onSourceChange({ path: event.target.value })} /></label>
              <label className="answer-key-field"><span>교재 버전 메모 <small>선택</small></span><input aria-label="교재 버전 메모" placeholder="예: 2026년 개정판" value={source.edition} disabled={busy} onChange={event => onSourceChange({ edition: event.target.value })} /><small>교재의 개정판·발행 연도를 구분하는 메모입니다. 비워 두어도 연결할 수 있습니다.</small></label>
              {(!pdfSource || source.manualRange) && <><div className="answer-key-field-pair"><label className="answer-key-field"><span>시작 줄</span><input aria-label="답지 시작 줄" type="number" min={1} value={source.firstLine} disabled={busy} onChange={event => onSourceChange({ firstLine: event.target.value })} /></label>
                <label className="answer-key-field"><span>끝 줄</span><input aria-label="답지 끝 줄" type="number" min={source.firstLine || 1} placeholder="마지막 줄까지" value={source.lastLine === '200000' ? '' : source.lastLine} disabled={busy} onChange={event => onSourceChange({ lastLine: event.target.value || '200000' })} /></label></div>
              {pdfSource && <label className="answer-key-field"><span>페이지 일부만 읽기 <small>선택</small></span><input aria-label="답지 영역 좌표" placeholder="왼쪽, 위, 오른쪽, 아래 · 예: 0, 0.6, 1, 1" value={source.box} disabled={busy} onChange={event => onSourceChange({ box: event.target.value })} /><small>각 위치를 0~1로 입력합니다. 비워 두면 페이지 전체를 읽습니다.</small></label>}</>}
            </div>
          </details>
          <p className="answer-key-support">PDF · TXT · MD · CSV · TSV 지원<span>이미지 답지는 먼저 OCR로 변환해 주세요.</span></p>
          {preview && <p className="answer-key-notice" role="status">{preview.reason || '선택한 범위에서 정답을 찾지 못했습니다. 페이지나 파일을 다시 확인해 주세요.'}</p>}
        </> : <AnswerKeyBatchReview key={preview!.preview_id} preview={preview!} activeProblemId={problem.id} busy={busy} saving={saving}
          onSave={onSaveBatch} onShowProblemPage={onOpenPdfPage} onShowAnswerPage={currentPdf ? onOpenPdfPage : undefined} onOpenAnswerFile={!currentPdf ? onOpenSourceFile : undefined} />}
        {error && <p className="answer-key-error" role="alert">{error}</p>}
        {unlinking && <div className="answer-key-unlink-confirm" role="alert"><div><strong>현재 {problem.number}번 문제의 연결을 해제할까요?</strong><p>이 문항의 기존 채점 결과도 무효화됩니다.</p></div><button type="button" disabled={busy} onClick={() => setUnlinking(false)}>유지</button><button type="button" disabled={busy} data-answer-key-unlink-confirm onClick={onUnlink}>해제</button></div>}
      </div>
      <footer className="answer-key-footer">
        <div>{linked ? <button type="button" className="answer-key-unlink" data-answer-key-unlink disabled={busy} onClick={() => setUnlinking(true)}>현재 {problem.number}번 연결 해제</button> : <span className="answer-key-footer-note">배경의 PDF를 그대로 조작할 수 있습니다.</span>}</div>
        <div className="answer-key-footer-actions"><button type="button" className="answer-key-button" disabled={saving} onClick={close}>{busy && !saving ? '추출 취소' : '취소'}</button>
          {!review && <button type="button" className="answer-key-button answer-key-primary" data-answer-key-preview disabled={busy || !source.path.trim()} onClick={onInspect}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}{busy ? '답지 읽는 중' : '정답 대응 찾기'}</button>}
        </div>
      </footer>
      <div role="separator" tabIndex={0} aria-label="답지 연결창 크기 조절" className="answer-key-resize" data-answer-key-resize {...floating.resize} />
    </div>
  </div>, document.body)
}
