import { useEffect, useRef, useState } from "react"
import { Loader2, X } from "lucide-react"
import { Button } from "../../shared/ui/button.tsx"
import { MarkdownViewer } from "../../shared/components/markdown-viewer.tsx"
import { InsightFeedback } from "./insight-feedback.tsx"
import { InsightReviewList } from "./insight-review-list.tsx"
import { WrongInsightReview } from "./wrong-insight-review.tsx"
import { useInsightBook } from "./use-insight-book.ts"
import { getInsightRecord, type InsightRun, type MaintainerSettings, type RawInsight } from "./api.ts"

type Props = { onClose: () => void; onOpenSource: (path: string, page?: number) => void; materialRoot?: string }
const tabs = { book: "Main Book", insights: "Insight · 검토", wrong: "Wrong Insight · 복습", history: "변경 이력 · 유지보수" }
const phases: Record<string, string> = { queued: "대기 중", source_retrieval: "원본 자료 확인", gate: "주장 검증", gate_complete: "검증 피드백 준비됨", book_retrieval: "관련 교재 검색", edit: "교재 통합", verify: "Book 결과 검증", embedding: "변경 부분 검색 색인 준비", commit: "교재 저장", maintain: "구조 재편성", maintenance_scope: "목차 점검", question: "복습 문제 준비", grade: "이해도 확인", committed: "교재 반영됨", already_covered: "기존 교재에 포함됨", needs_correction: "교정 필요", pending: "검토 대기", question_ready: "복습 문제 준비됨", graded: "이해도 확인 완료" }

export function InsightBookPanel({ onClose, onOpenSource }: Props) {
  const { snapshot, error, busy, refresh, submit, action, rawOffset, setRawOffset, revisionOffset, setRevisionOffset, reviewFilter, setReviewFilter } = useInsightBook()
  const [tab, setTab] = useState<keyof typeof tabs>("book")
  const [draft, setDraft] = useState("")
  const [correction, setCorrection] = useState<RawInsight | null>(null)
  const [recordError, setRecordError] = useState("")
  const [record, setRecord] = useState<{ raw: RawInsight; run: InsightRun } | null>(null)
  const [approvedRetry, setApprovedRetry] = useState<Record<string, boolean>>({})
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    if (correction) panel.current?.querySelector<HTMLTextAreaElement>("textarea[aria-label='Insight 입력']")?.focus()
  }, [correction])
  const active = snapshot?.runs.filter(run => ["queued", "running"].includes(run.state)) || []
  const failed = snapshot?.runs.filter(run => ["failed", "cancelled", "interrupted"].includes(run.state)) || []
  const correctionRun = correction && (snapshot?.runs.find(run => run.id === correction.run_id)
    || (record?.raw.id === correction.id ? record.run : undefined))
  const adoptingCorrection = Boolean(correctionRun?.gate && correctionRun.gate.verdict !== "VERIFIED"
    && correctionRun.gate.improved_insight.trim() && draft === correctionRun.gate.improved_insight)
  function correct(raw: RawInsight, value: string) {
    setCorrection(raw); setDraft(value); setTab("insights")
  }
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-transparent p-4" data-ails-window="true">
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Insight Book" tabIndex={-1}
      className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-2xl"
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); onClose() }
        if (event.key === "Tab") {
          const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, input, select, a[href], summary") || []).filter(item => item.getClientRects().length)
          const first = items[0], last = items.at(-1)
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <div><h2 className="text-xl font-semibold">Insight Book</h2><p className="text-sm text-[var(--muted-foreground)]">생각을 검증하고 나만의 교재로 발전시키세요</p></div>
        <Button variant="ghost" size="icon" aria-label="Insight Book 닫기" onClick={onClose}><X size={20} /></Button>
      </header>
      <nav className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border)] px-4 py-2" aria-label="Insight Book 보기">
        {Object.entries(tabs).map(([key, label]) => <Button key={key} variant={tab === key ? "default" : "ghost"} onClick={() => setTab(key as keyof typeof tabs)} aria-pressed={tab === key}>{label}</Button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {(error || recordError) && <div role="alert" className="mb-4 rounded-lg border border-red-400 p-3 text-red-500">{error || recordError}<Button variant="ghost" size="sm" onClick={() => { setRecordError(""); void refresh() }}>새로고침</Button></div>}
        {!snapshot && !error && <p role="status">계정과 Insight Book을 불러오는 중…</p>}
        {active.map(run => <div key={run.id} className="mb-3 flex items-center gap-3 rounded-lg bg-[var(--muted)] p-3" role="status">
          <Loader2 size={16} className="animate-spin" /><span className="flex-1">{phases[run.phase] || run.phase}{run.cancel_requested ? " · 취소 처리 중" : ""}</span>
          <Button size="sm" variant="outline" disabled={busy || run.cancel_requested} onClick={() => { void action({ action: "cancel", run_id: run.id }) }}>취소</Button>
        </div>)}
        {failed.map(run => <div key={run.id} className="mb-3 space-y-2 rounded-lg border border-amber-500/50 p-3">
          <p className="text-sm">{run.state === "cancelled" ? "취소됨" : "작업 미완료"}: {run.error}</p>
          {run.attempt < 3 && <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { void action({ action: "retry", run_id: run.id, allow_new_ai_attempt: Boolean(approvedRetry[run.id]) }).then(ok => { if (ok) setApprovedRetry(old => ({ ...old, [run.id]: false })) }) }}>저장된 응답으로 재개</Button>
            {run.error.includes("응답 여부") && <label className="text-xs"><input type="checkbox" checked={Boolean(approvedRetry[run.id])} onChange={e => setApprovedRetry(old => ({ ...old, [run.id]: e.target.checked }))} /> 이전 호출 비용이 발생했을 수 있음을 확인하고 새 AI 요청 승인</label>}
          </div>}
        </div>)}
        {snapshot && <>
          {(tab === "book" || tab === "insights") && <details className="mb-6" open={tab === "book" || Boolean(correction)}>
            <summary className="mb-2 cursor-pointer text-sm font-medium">{correction ? "개선 Insight 확인·수정" : "새 Insight 기록"}</summary>
            <form className="space-y-3 rounded-xl border border-[var(--border)] p-4" onSubmit={event => {
            event.preventDefault()
            void submit(draft, correction?.id).then(ok => { if (ok) { setDraft(""); setCorrection(null); setReviewFilter("pending"); setTab("insights") } })
          }}>
            <label className="font-semibold" htmlFor="insight-draft">{correction ? "개선 Insight 확인·수정" : "공부하며 떠오른 Insight"}</label>
            {correction && <p className="text-sm">원본은 보존됩니다. {adoptingCorrection ? "정정본을 채택하면 주장 검증을 생략하고 교재 반영으로 진행합니다." : "수정한 내용을 새 Insight로 검증합니다."}</p>}
            <textarea id="insight-draft" aria-label="Insight 입력" className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-3" rows={3} maxLength={10000} placeholder="이 개념은 이런 조건에서 연결되는 것 같다…" value={draft} onChange={event => setDraft(event.target.value)} required />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy || !draft.trim()}>{correction ? adoptingCorrection ? "정정본 채택·교재 반영" : "수정본 검증" : "기록하고 검증"}</Button>
              {correction && <Button type="button" variant="ghost" onClick={() => { setCorrection(null); setDraft("") }}>수정 취소</Button>}
            </div>
            {!adoptingCorrection && <p className="text-xs text-[var(--muted-foreground)]">설정의 Insight Book 모델 지식으로 검증합니다.</p>}
          </form></details>}
          {tab === "book" && (snapshot.sections.length ? <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            <nav aria-label="교재 목차" className="space-y-2 text-sm">{snapshot.sections.map(section => <a className="block rounded-lg p-2 hover:bg-[var(--muted)]" key={section.id} href={`#insight-${section.id}`}>{section.chapter}<br /><strong>{section.title}</strong></a>)}</nav>
            <div className="min-w-0 space-y-8">{snapshot.sections.map(section => <section key={section.id} id={`insight-${section.id}`} className="scroll-mt-4">
              <p className="text-sm text-[var(--muted-foreground)]">{section.chapter}</p><h3 className="mb-3 text-xl font-semibold">{section.title}</h3>
              <MarkdownViewer content={section.content} />
              <details className="mt-3 text-sm"><summary className="cursor-pointer">이 절의 근거 Insight ({section.provenance.length})</summary>
                {section.provenance.map(source => { const raw = snapshot.raw_insights.find(item => item.id === source.raw_id)
                  return <button type="button" className="block py-1 text-left underline" key={source.raw_id} onClick={() => {
                    void getInsightRecord(source.raw_id).then(result => { setRecord(result); setTab("insights") }).catch(cause => setRecordError(String(cause)))
                  }}>{raw?.text || `Insight ${source.raw_id}`}{source.claim_ids.length > 0 ? ` · ${source.claim_ids.join(", ")}` : ""}</button> })}
              </details>
            </section>)}</div>
          </div> : <p className="py-8 text-center text-[var(--muted-foreground)]">검증된 Insight가 생기면 이곳에 나만의 교재가 만들어집니다.</p>)}
          {tab === "insights" && <div className="space-y-4">
            {record && <div className="rounded-lg border-2 border-[var(--brand)] p-2"><Button variant="ghost" onClick={() => setRecord(null)}>선택한 근거 닫기</Button><InsightFeedback raw={record.raw} gate={record.run.gate} outcome={record.run.outcome} runState={record.run.state} acceptedCorrection={record.run.accepted_correction} onCorrect={correct} onOpenSource={onOpenSource} /></div>}
            <InsightReviewList snapshot={snapshot} filter={reviewFilter} onFilter={setReviewFilter} offset={rawOffset} onOffset={setRawOffset} onCorrect={correct} onOpenSource={onOpenSource} /></div>}
          {tab === "wrong" && <div className="space-y-4"><p className="text-sm text-[var(--muted-foreground)]">서로 다른 날짜와 3가지 이상의 문제 형식에서 이해를 확인합니다. 해결된 오개념과 복습 이력도 보존합니다.</p>
            {snapshot.wrong_insights.map(wrong => <WrongInsightReview key={wrong.id} wrong={wrong} reviews={snapshot.reviews} busy={busy || active.some(run => run.payload.wrong_id === wrong.id)} now={snapshot.now} onAction={action} />)}
            {!snapshot.wrong_insights.length && <p>등록된 오개념이 없습니다. 불확실한 Insight는 검토 대기에서 확인하세요.</p>}</div>}
          {tab === "history" && <div className="space-y-5">
            <MaintainerControls key={JSON.stringify(snapshot.settings)} settings={snapshot.settings} busy={busy || active.length > 0} onAction={action} />
            {snapshot.revisions.map(revision => <details key={revision.id} className="rounded-xl border border-[var(--border)] p-4"><summary className="cursor-pointer font-semibold">revision {revision.revision} · {revision.kind === "maintain" ? "목차·구조 재편" : "Insight 통합"} · {new Date(revision.created_at * 1000).toLocaleString()}</summary>
              <p className="my-3">{revision.reason}</p>
              {revision.changes.map(change => <div className="my-3 space-y-2" key={change.id}><p>{change.action === "delete" ? "절 통합·제거" : "절 작성·수정"}: {change.reason}</p>
                <div className="grid gap-3 md:grid-cols-2"><div><strong>변경 전</strong><MarkdownViewer content={revision.before.find(row => row.id === change.id)?.content || "새 절"} /></div><div><strong>변경 후</strong><MarkdownViewer content={revision.after.find(row => row.id === change.id)?.content || "다른 절로 통합"} /></div></div>
              </div>)}
            </details>)}
            <div className="flex items-center gap-3"><Button variant="outline" disabled={revisionOffset === 0} onClick={() => setRevisionOffset(Math.max(0, revisionOffset - 50))}>최신 변경</Button><span>변경 이력 {snapshot.revision_count}개</span><Button variant="outline" disabled={revisionOffset + 50 >= snapshot.revision_count} onClick={() => setRevisionOffset(revisionOffset + 50)}>이전 변경</Button></div>
          </div>}
        </>}
      </div>
    </div>
  </div>
}

function MaintainerControls({ settings, busy, onAction }: { settings: MaintainerSettings; busy: boolean; onAction: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [value, setValue] = useState(settings)
  const fields = [{ key: "maintainer_every" as const, label: "구조 점검 주기 (변경 횟수)", min: 2, max: 100 }, { key: "section_max_chars" as const, label: "긴 절 점검 기준 (글자)", min: 1000, max: 18000 }, { key: "maintenance_scope" as const, label: "한 번에 점검할 최대 절", min: 2, max: 12 }]
  return <form className="space-y-3 rounded-xl border border-[var(--border)] p-4" onSubmit={event => { event.preventDefault(); void onAction({ action: "settings", settings: value }) }}>
    <h3 className="font-semibold">Book Maintainer</h3>
    <label className="flex items-center gap-2"><input type="checkbox" checked={value.maintainer_enabled} onChange={e => setValue(old => ({ ...old, maintainer_enabled: e.target.checked }))} /> 필요할 때 목차·절 구조 자동 점검</label>
    <div className="flex flex-wrap gap-3">{fields.map(field => <label className="text-sm" key={field.key}>{field.label}<input className="ml-2 w-24 rounded border border-[var(--border)] bg-[var(--background)] p-1" type="number" min={field.min} max={field.max} value={value[field.key]} onChange={e => setValue(old => ({ ...old, [field.key]: Number(e.target.value) }))} required /></label>)}</div>
    <div className="flex gap-2"><Button disabled={busy}>설정 저장</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { void onAction({ action: "maintain" }) }}>지금 구조 점검</Button></div>
  </form>
}
