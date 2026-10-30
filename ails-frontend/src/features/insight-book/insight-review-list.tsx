import { Button } from "../../shared/ui/button.tsx"
import type { InsightSnapshot, RawInsight, ReviewFilter } from "./api.ts"
import { InsightFeedback } from "./insight-feedback.tsx"
import { reviewComplete } from "./review-presentation.ts"

export function InsightReviewList({ snapshot, filter, onFilter, offset, onOffset, onCorrect, onOpenSource }: {
  snapshot: InsightSnapshot; filter: ReviewFilter; onFilter: (filter: ReviewFilter) => void
  offset: number; onOffset: (offset: number) => void
  onCorrect: (raw: RawInsight, text: string) => void; onOpenSource: (path: string, page?: number) => void
}) {
  const loading = snapshot.review_filter !== undefined && snapshot.review_filter !== filter
  const runs = new Map(snapshot.runs.map(run => [run.id, run]))
  const records = snapshot.raw_insights.filter(raw => reviewComplete(raw, runs.get(raw.run_id)) === (filter === "completed"))
  const counts = snapshot.review_counts
  const total = snapshot.review_count ?? snapshot.raw_count
  return <div className="space-y-4">
    <div className="flex gap-2" aria-label="Insight 검토 상태">
      {(["pending", "completed"] as const).map(value => <Button key={value} variant={filter === value ? "default" : "outline"} aria-pressed={filter === value} onClick={() => onFilter(value)}>
        {value === "pending" ? "검토 대기" : "검토 완료"}{counts ? ` (${counts[value]})` : ""}
      </Button>)}
    </div>
    <p className="text-sm text-[var(--muted-foreground)]">{filter === "pending" ? "교정·추가 확인이 필요하거나 아직 처리 중인 생각입니다." : "Main Book 반영이 끝난 생각과 수정본의 이전 기록입니다."}</p>
    {loading ? <p role="status">검토 기록을 불러오는 중…</p> : <>
      {records.map(raw => { const run = runs.get(raw.run_id); return <InsightFeedback key={raw.id} raw={raw} gate={run?.gate} outcome={run?.outcome} runState={run?.state} acceptedCorrection={run?.accepted_correction} onCorrect={onCorrect} onOpenSource={onOpenSource} /> })}
      {!records.length && <p>{filter === "pending" ? "검토 대기 중인 Insight가 없습니다." : "검토 완료된 Insight가 없습니다."}</p>}
      {total > 100 && <div className="flex items-center gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - 100))}>최신 기록</Button><span>{Math.min(offset + 1, total)}–{Math.min(offset + 100, total)} / {total}</span><Button variant="outline" disabled={offset + 100 >= total} onClick={() => onOffset(offset + 100)}>이전 기록</Button></div>}
    </>}
  </div>
}
