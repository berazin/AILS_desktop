import { useEffect, useMemo, useState } from 'react'
import { Link2, LoaderCircle } from 'lucide-react'
import type { PdfAnswerKeyBatchItem, PdfAnswerKeyCandidate, PdfAnswerKeyPreview } from '../../../lib/api.ts'

interface Props {
  preview: PdfAnswerKeyPreview
  activeProblemId: string
  busy: boolean
  saving: boolean
  onSave: (items: PdfAnswerKeyBatchItem[], verified: boolean) => void
  onShowProblemPage?: (page: number) => void
  onShowAnswerPage?: (page: number) => void
  onOpenAnswerFile?: () => void
}
export function AnswerKeyBatchReview({ preview, activeProblemId, busy, saving, onSave, onShowProblemPage, onShowAnswerPage, onOpenAnswerFile }: Props) {
  const [detailId, setDetailId] = useState(activeProblemId)
  const [mapping, setMapping] = useState<Record<string, string>>(() => Object.fromEntries(preview.rows.map(row => [row.problem_id, row.batch?.candidate_id || (row.candidate_ids.length === 1 ? row.candidate_ids[0] : '')])))
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preview.rows.filter(row => (row.batch?.ready ?? row.candidate_ids.length === 1) && preview.links[row.problem_id]?.status !== 'confirmed').map(row => row.problem_id)))
  const [overrides, setOverrides] = useState<Record<string, Partial<PdfAnswerKeyBatchItem>>>({})
  const [verified, setVerified] = useState(false)
  const [attentionOnly, setAttentionOnly] = useState(false)
  const candidates = useMemo(() => new Map(preview.candidates.map(item => [item.id, item])), [preview])
  const scoped = preview.rows
  const repeated = preview.candidates.reduce((count, item) => count + Math.max(0, (item.occurrences?.length || 1) - 1), 0)
  const region = preview.source.region
  const duplicates = new Set<string>()
  const used = new Set<string>()
  for (const id of selected) { const candidate = mapping[id]; if (used.has(candidate)) duplicates.add(candidate); used.add(candidate) }
  const readyCount = scoped.filter(row => row.batch?.ready ?? row.candidate_ids.length === 1).length
  const shown = scoped.filter(row => !attentionOnly || !row.batch?.ready)
  const detail = preview.rows.find(row => row.problem_id === detailId) || shown[0]
  const candidate = detail ? candidates.get(mapping[detail.problem_id]) : undefined
  const policy = detail ? overrides[detail.problem_id] || {} : {}
  const selectedRows = preview.rows.filter(row => selected.has(row.problem_id) && mapping[row.problem_id])
  const items = selectedRows.map(row => ({ ...overrides[row.problem_id], problem_id: row.problem_id, problem_version: row.problem_version, candidate_id: mapping[row.problem_id] }))
  useEffect(() => { if (preview.rows.some(row => row.problem_id === activeProblemId)) setDetailId(activeProblemId) }, [activeProblemId, preview])
  function toggle(id: string, checked: boolean) {
    setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })
    setVerified(false)
  }
  function changePolicy(change: Partial<PdfAnswerKeyBatchItem>) {
    if (!detail) return
    setOverrides(current => ({ ...current, [detail.problem_id]: { ...current[detail.problem_id], ...change } }))
    setVerified(false)
  }
  return <div className="answer-key-batch" data-answer-key-batch>
    <div className="answer-key-batch-content">
    <div className="answer-key-batch-heading"><div><h3>정답 대응 목록</h3><p>문항 번호·소문항으로 전체 문제를 연결합니다. 원본 PDF를 보면서 확인하세요.</p>
      {region && <p data-answer-key-detected-range>{region.page_start === region.page_end ? region.page_start + '쪽' : region.page_start + '–' + region.page_end + '쪽'}{preview.source.auto_detected ? ' · 자동으로 찾은 답지' : ' · 선택한 답지'}</p>}
      {repeated > 0 && <p data-answer-key-duplicates>번호와 정답이 같은 중복 {repeated}개를 합쳤습니다.</p>}</div>
    </div>
    <div className="answer-key-batch-counts"><strong>{scoped.length}개 문제</strong><span>대응 {readyCount}개</span><button type="button" aria-pressed={attentionOnly} disabled={busy} onClick={() => setAttentionOnly(value => !value)}>확인 필요 {scoped.length - readyCount}개{attentionOnly ? ' · 전체 보기' : ''}</button></div>
    <div className="answer-key-batch-list" tabIndex={0} aria-label="문제와 정답 대응 목록">
      <table><thead><tr><th><input aria-label="표시된 정답 전체 선택" type="checkbox" disabled={busy} checked={shown.some(row => Boolean(mapping[row.problem_id])) && shown.filter(row => mapping[row.problem_id]).every(row => selected.has(row.problem_id))} onChange={event => {
        const checked = event.target.checked
        setSelected(current => { const next = new Set(current); for (const row of shown) { if (checked && mapping[row.problem_id]) next.add(row.problem_id); else next.delete(row.problem_id) } return next }); setVerified(false)
      }} /></th><th>문제</th><th>연결할 정답</th><th>상태</th></tr></thead>
      <tbody>{shown.map(row => {
        const linked = preview.links[row.problem_id]?.status === 'confirmed'
        const duplicate = duplicates.has(mapping[row.problem_id])
        const options = detailId === row.problem_id ? preview.candidates : [...new Set([...row.candidate_ids, mapping[row.problem_id]])].map(id => candidates.get(id)).filter((item): item is PdfAnswerKeyCandidate => Boolean(item))
        return <tr key={row.problem_id} className={detail?.problem_id === row.problem_id ? 'is-active' : ''}>
          <td><input type="checkbox" aria-label={row.problem.number + '번 문제 연결 선택'} checked={selected.has(row.problem_id)} disabled={busy || !mapping[row.problem_id]} onChange={event => toggle(row.problem_id, event.target.checked)} /></td>
          <td><button type="button" className="answer-key-batch-problem" data-answer-key-row={row.problem_id} disabled={busy} onClick={() => setDetailId(row.problem_id)}><strong>{row.problem.number}번</strong><small>{row.problem.page}쪽</small></button></td>
          <td><select aria-label={row.problem.number + '번 정답 선택'} value={mapping[row.problem_id] || ''} disabled={busy} onFocus={() => setDetailId(row.problem_id)} onChange={event => {
            const id = event.target.value; setMapping(current => ({ ...current, [row.problem_id]: id })); setOverrides(current => { const next = { ...current }; delete next[row.problem_id]; return next }); toggle(row.problem_id, Boolean(id))
          }}><option value="">정답 선택 필요</option>{options.map(item => <option key={item.id} value={item.id}>{item.number}번{item.subquestion ? ' (' + item.subquestion + ')' : ''} · {item.answer.slice(0, 70)} · {item.location.page}쪽{item.occurrences ? ' · 동일 답 ' + item.occurrences.length + '곳' : ''}</option>)}</select></td>
          <td><span className={'answer-key-match-status' + (duplicate || !row.batch?.ready ? ' needs-review' : '')}>{duplicate ? '정답 중복' : linked ? '기존 연결' : row.batch?.ready ? '대응됨' : '확인 필요'}</span>{!row.batch?.ready && <small>{row.batch?.reason || (row.candidate_ids.length ? '내용 확인 필요' : '정답 없음')}</small>}</td>
        </tr>
      })}</tbody></table>
      {!shown.length && <p className="answer-key-help">이 범위에 확인할 문제가 없습니다.</p>}
    </div>
    {detail && <details className="answer-key-batch-detail" open key={detail.problem_id}>
      <summary>{detail.problem.number}번 문제와 정답 대조 <span>원문 보기 · 개별 수정</span></summary>
      <div className="answer-key-evidence-grid">
        <section className="answer-key-evidence-card"><header><span>문제 · {detail.problem.page}쪽</span>{onShowProblemPage && <button type="button" data-answer-key-show-problem className="answer-key-text-button" onClick={() => onShowProblemPage(detail.problem.page)}>PDF에서 보기</button>}</header><pre>{detail.problem.problem_text}</pre></section>
        <section className="answer-key-evidence-card"><header><span>답지{candidate ? ' · ' + candidate.location.page + '쪽' : ''}</span>{candidate && onShowAnswerPage ? <button type="button" data-answer-key-show-answer className="answer-key-text-button" onClick={() => onShowAnswerPage(candidate.location.page)}>PDF에서 보기</button> : onOpenAnswerFile && <button type="button" className="answer-key-text-button" onClick={onOpenAnswerFile}>원본 파일 열기</button>}</header><pre>{candidate?.original_text || '목록에서 정답을 선택하세요.'}</pre></section>
      </div>
      {candidate?.occurrences && <div className="answer-key-occurrences"><span>같은 정답이 확인된 위치</span>{candidate.occurrences.map((item, index) => onShowAnswerPage ? <button key={item.id} type="button" className="answer-key-text-button" onClick={() => onShowAnswerPage(item.location.page)}>{item.location.page}쪽 · {index + 1}</button> : <span key={item.id}>{item.location.page}쪽</span>)}</div>}
      {candidate && <details className="answer-key-details"><summary>이 문항의 답·채점 조건 수정</summary><div className="answer-key-detail-fields">
        <label className="answer-key-field"><span>채점에 사용할 답</span><textarea aria-label="확정 답" value={policy.answer ?? candidate.answer} disabled={busy} onChange={event => changePolicy({ answer: event.target.value })} /></label>
        <label className="answer-key-field"><span>채점 방식</span><select aria-label="답 비교 유형" value={policy.kind ?? candidate.kind} disabled={busy} onChange={event => changePolicy({ kind: event.target.value as PdfAnswerKeyCandidate['kind'] })}><option value="choice">객관식 번호 비교</option><option value="ox">O/X · T/F 비교</option><option value="short">단답 비교 · 표현 차이는 AI</option><option value="numeric">수치·단위 비교</option><option value="essay">서술형 AI 평가</option></select></label>
        <label className="answer-key-field"><span>답지에 적힌 평가 기준</span><textarea aria-label="명시된 평가 기준" value={policy.criteria ?? candidate.criteria} disabled={busy} onChange={event => changePolicy({ criteria: event.target.value })} /></label>
        {(policy.kind ?? candidate.kind) === 'short' && <label className="answer-key-field"><span>추가로 인정할 정답 · 한 줄에 하나씩</span><textarea aria-label="허용 동치 답" value={(policy.accepted_answers || []).join('\n')} disabled={busy} onChange={event => changePolicy({ accepted_answers: event.target.value.split('\n').filter(value => value.trim()) })} /></label>}
        {(policy.kind ?? candidate.kind) === 'numeric' && <label className="answer-key-field"><span>답지에 명시된 허용 오차</span><input aria-label="절대 허용 오차" value={policy.absolute_tolerance ?? '0'} disabled={busy} onChange={event => changePolicy({ absolute_tolerance: event.target.value })} /></label>}
      </div></details>}
    </details>}
    {duplicates.size > 0 && <p className="answer-key-notice" role="alert">같은 정답이 여러 문제에 선택되어 있습니다. 중복을 해소한 뒤 연결해 주세요.</p>}
    </div>
    <label className="answer-key-verification"><input type="checkbox" aria-label="선택한 문제와 답지 확인" checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)} /><span>선택한 문제들의 번호·소문항·내용과 원본 정답이 일치하는지 확인했습니다.</span></label>
    <div className="answer-key-batch-save"><span><strong>{items.length}개 문제</strong>를 한 번에 연결합니다.</span><button type="button" className="answer-key-button answer-key-primary" data-answer-key-batch-confirm disabled={busy || !verified || !items.length || duplicates.size > 0} onClick={() => onSave(items, verified)}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Link2 size={16} />}{saving ? '연결 중' : '선택한 ' + items.length + '개 연결'}</button></div>
  </div>
}
