import { useEffect, useRef, useState } from 'react'
import { confirmPdfAnswerKey, confirmPdfAnswerKeys, managePdfAnswerKey, openFileDialog, openLocalPath, previewPdfAnswerKey, type PdfAnswerKeyPreview, type PdfAnswerKeyBatchItem, type PdfProblem } from '../../../lib/api.ts'

import { AnswerKeyDialog, type AnswerKeySourceFields } from './answer-key-dialog.tsx'

interface Props {
  problem: PdfProblem
  pdfPath: string
  baseDir: string
  onProblemChange?: (problem: PdfProblem) => void
  onOpenPdfPage?: (page: number) => void
}
export function AnswerKeyControl({ problem, pdfPath, baseDir, onProblemChange, onOpenPdfPage }: Props) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState(pdfPath)
  const [edition, setEdition] = useState('')
  const [first, setFirst] = useState('1')
  const [last, setLast] = useState('1')
  const [firstLine, setFirstLine] = useState('1')
  const [lastLine, setLastLine] = useState('200000')
  const [box, setBox] = useState('')
  const [manualRange, setManualRange] = useState(false)
  const [preview, setPreview] = useState<PdfAnswerKeyPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abort.current?.abort() } }, [])
  async function inspect() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    const controller = new AbortController()
    abort.current = controller
    try {
      const values = box.trim() ? box.split(',').map(Number) : null
      if (values && (values.length !== 4 || values.some(value => !Number.isFinite(value)))) throw new Error('영역은 left,top,right,bottom 네 좌표를 입력해 주세요.')
      const result = await previewPdfAnswerKey({ pdf_path: pdfPath, base_dir: baseDir, source_path: source, edition, hide_answers: true,
        ...(/\.pdf$/i.test(source) && !manualRange ? { auto_detect: true } : {
          region: { page_start: Number(first), page_end: Number(last), line_start: Number(firstLine), line_end: Number(lastLine),
            ...(values ? { bbox: { left: values[0], top: values[1], right: values[2], bottom: values[3] } } : {}) } }) }, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setPreview(result)
      if (result.discovery?.region) { setFirst(String(result.discovery.region.page_start)); setLast(String(result.discovery.region.page_end)) }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      lock.current = false
      if (abort.current === controller) abort.current = null
      if (mounted.current) setBusy(false)
    }
  }
  async function unlink() {
    if (lock.current) return
    lock.current = true; setBusy(true); setSaving(true); setError('')
    try {
      const result = await confirmPdfAnswerKey({ pdf_path: pdfPath, base_dir: baseDir, problem_id: problem.id, unlink: true })
      if (mounted.current) { onProblemChange?.(result.problem); setOpen(false) }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { lock.current = false; if (mounted.current) { setBusy(false); setSaving(false) } }
  }
  async function saveBatch(items: PdfAnswerKeyBatchItem[], verified: boolean) {
    if (lock.current || !preview || !verified || !items.length) return
    lock.current = true; setBusy(true); setSaving(true); setError('')
    try {
      const result = await confirmPdfAnswerKeys({ pdf_path: pdfPath, base_dir: baseDir, preview_id: preview.preview_id, items,
        verified, edition_verified: verified, verification_note: '답지 대응 목록에서 선택한 ' + items.length + '개 문제의 번호·소문항·본문과 원본 정답을 대조하여 일괄 확인했습니다.' })
      if (!mounted.current) return
      result.problems.forEach(item => onProblemChange?.(item)); setOpen(false)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { lock.current = false; if (mounted.current) { setBusy(false); setSaving(false) } }
  }
  async function openManager() {
    if (lock.current || open) return
    setPreview(null)
    setManualRange(false)
    setOpen(true); setError(''); lock.current = true; setBusy(true)
    try {
      const result = await managePdfAnswerKey({ pdf_path: pdfPath, base_dir: baseDir, problem_id: problem.id })
      if (!mounted.current) return
      const source = result.link?.source || result.source
      if (source) {
        setSource(source.path); setEdition(source.edition); setFirst(String(source.region.page_start)); setLast(String(source.region.page_end))
        setFirstLine(String(source.region.line_start)); setLastLine(String(source.region.line_end))
        setBox(source.region.bbox ? [source.region.bbox.left, source.region.bbox.top, source.region.bbox.right, source.region.bbox.bottom].join(',') : '')
      }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { lock.current = false; if (mounted.current) setBusy(false) }
  }
  function cancel() { abort.current?.abort(); setOpen(false) }
  async function openSourceFile() {
    if (!/\.(pdf|txt|md|csv|tsv)$/i.test(source)) return
    try { await openLocalPath(source) }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  async function pick() {
    try {
      const result = await openFileDialog({ kind: 'all', title: '자료 저장 폴더 안의 답지 선택', initial_dir: baseDir })
      const path = result.paths?.[0]
      if (path && mounted.current) changeSource({ path })
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  function changeSource(fields: Partial<AnswerKeySourceFields>) {
    if (fields.path !== undefined) {
      setSource(fields.path)
      if (fields.path !== source) {
        setFirst('1'); setLast('1'); setFirstLine('1'); setLastLine('200000'); setBox(''); setManualRange(false)
      }
    }
    if (fields.edition !== undefined) setEdition(fields.edition)
    if (fields.firstPage !== undefined) setFirst(fields.firstPage)
    if (fields.lastPage !== undefined) setLast(fields.lastPage)
    if (fields.firstLine !== undefined) setFirstLine(fields.firstLine)
    if (fields.lastLine !== undefined) setLastLine(fields.lastLine)
    if (fields.box !== undefined) setBox(fields.box)
    if (fields.manualRange !== undefined) setManualRange(fields.manualRange)
    setPreview(null); setError('')
  }
  return <>
    <button type="button" className="code-sandbox-button shrink-0 whitespace-nowrap px-2" aria-haspopup="dialog" aria-expanded={open} title={problem.answer_key?.reason || (problem.answer_key?.connection_method === 'automatic' ? 'PDF 안의 답지를 자동으로 연결했습니다. 연결 내용을 확인하거나 관리합니다.' : '답지를 연결하거나 기존 연결을 관리합니다.')} onClick={() => void openManager()} data-answer-key-open>
      답지 {problem.answer_key?.status === 'confirmed' ? '연결됨' : problem.answer_key?.status === 'stale' ? '재확인' : '미연결'}
    </button>
    {open && <AnswerKeyDialog problem={problem} pdfPath={pdfPath}
      source={{ path: source, edition, firstPage: first, lastPage: last, firstLine, lastLine, box, manualRange }}
      preview={preview} busy={busy} saving={saving}
      linked={Boolean(problem.answer_key?.status === 'confirmed' || problem.answer_key?.status === 'stale')}
      error={error} onSourceChange={changeSource}
      onSaveBatch={(items, verified) => void saveBatch(items, verified)} onOpenPdfPage={onOpenPdfPage}
      onOpenSourceFile={() => void openSourceFile()}
      onPick={() => void pick()} onInspect={() => void inspect()} onUnlink={() => void unlink()} onClose={cancel} />}
  </>
}
