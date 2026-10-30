import { Button } from "../../shared/ui/button.tsx"
import type { Gate, InsightRun, RawInsight } from "./api.ts"
import { gateFeedback, sameText } from "./review-presentation.ts"

export function InsightFeedback({ raw, gate, outcome, runState, acceptedCorrection, onCorrect, onOpenSource }: {
  raw: RawInsight; gate?: Gate; outcome?: string; runState?: string
  acceptedCorrection?: InsightRun["accepted_correction"]
  onCorrect: (raw: RawInsight, text: string) => void; onOpenSource: (path: string, page?: number) => void
}) {
  const feedback = gate ? gateFeedback(gate, raw.text) : []
  const published = outcome === "committed" || outcome === "already_covered"
  const hasCorrection = gate && gate.verdict !== "VERIFIED" && Boolean(gate.improved_insight.trim())
  const content = <div className="space-y-4">
    {!gate && <div className="space-y-2"><h3 className="line-clamp-2 whitespace-pre-wrap font-medium">{raw.text}</h3>
      <p className="text-sm text-[var(--muted-foreground)]">{acceptedCorrection ? "정정본 채택" : runState === "failed" || runState === "cancelled" || runState === "interrupted" ? "검증 미완료" : "검증 대기"}</p>
    </div>}
    {gate?.claims.map((claim, index) => <section key={claim.id} className="space-y-3" data-insight-claim={claim.verdict}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 whitespace-pre-wrap font-medium">{gate.claims.length > 1 && <span className="mr-2 text-xs text-[var(--muted-foreground)]">{index + 1}.</span>}{claim.summary || claim.text}</h3>
        {claim.verdict === "VERIFIED" && <span className="shrink-0 rounded bg-[var(--muted)] px-2 py-1 text-xs">검증됨</span>}
      </div>
      {feedback[index].map(item => <div key={item.label} className="border-l-2 border-[var(--brand)] pl-3">
        <h4 className="text-sm font-semibold">{item.label}</h4><p className="whitespace-pre-wrap text-sm">{item.text}</p>
      </div>)}
      <details className="text-sm text-[var(--muted-foreground)]">
        <summary className="cursor-pointer">검증 근거{gate.claims.length > 1 ? ` · 주장 ${index + 1}` : ""}</summary>
        <div className="mt-2 space-y-2">
          <p>{claim.basis === "source" ? "자료 근거로 검토" : "모델 지식으로 검토 · 원본 자료 근거 없음"}</p>
          <p className="whitespace-pre-wrap">{claim.text}</p>
          {claim.explanation && !feedback[index].some(item => sameText(item.text, claim.explanation)) && <p className="whitespace-pre-wrap">{claim.explanation}</p>}
          {claim.evidence_ids.map(id => { const source = gate.evidence.find(item => item.id === id); return source && <details key={id}>
            <summary className="cursor-pointer">{source.path.split(/[/\\]/).pop()} · p.{source.page}{source.section ? ` · ${source.section}` : ""}</summary>
            <p className="my-2 whitespace-pre-wrap">{source.text}</p><Button size="sm" variant="outline" onClick={() => onOpenSource(source.path, source.path.toLowerCase().endsWith(".pdf") ? source.page : undefined)}>자료 열기</Button>
          </details> })}
        </div>
      </details>
    </section>)}
    <details className="text-sm text-[var(--muted-foreground)]">
      <summary className="cursor-pointer">원본 Insight{gate?.improved_insight && gate.verdict !== "VERIFIED" ? " · 전체 수정안" : ""}</summary>
      <div className="mt-2 space-y-2">
        <p className="whitespace-pre-wrap">{raw.text}</p>
        <p className="text-xs">{new Date(raw.created_at * 1000).toLocaleString()}{raw.parent_id ? " · 이전 Insight를 수정한 기록" : ""}</p>
        {raw.sources.length > 0 && <p className="text-xs">선택한 자료: {raw.sources.map(path => path.split(/[/\\]/).pop()).join(" · ")}</p>}
        {gate?.improved_insight && gate.verdict !== "VERIFIED" && <div><strong>전체 수정안</strong><p className="whitespace-pre-wrap">{gate.improved_insight}</p></div>}
      </div>
    </details>
    <div className="flex flex-wrap items-center justify-between gap-2">
      {(gate?.verdict === "VERIFIED" || acceptedCorrection) && <p className="text-xs text-[var(--muted-foreground)]">{outcome === "committed" ? "Main Book에 반영했습니다." : outcome === "already_covered" ? "기존 Main Book에 포함된 내용입니다." : runState === "failed" || runState === "cancelled" || runState === "interrupted" ? `${acceptedCorrection ? "정정본 채택" : "주장 검증 완료"} · Main Book 반영 미완료` : `${acceptedCorrection ? "정정본 채택" : "주장 검증 완료"} · Main Book 반영 대기`}</p>}
      <Button size="sm" variant="outline" disabled={runState === "queued" || runState === "running"} onClick={() => onCorrect(raw, gate && gate.verdict !== "VERIFIED" ? gate.improved_insight || raw.text : raw.text)}>
        {acceptedCorrection || published || gate?.verdict === "VERIFIED" ? "내용 보완·재검증" : hasCorrection ? "정정본 확인·채택" : "원문 보완·재검증"}
      </Button>
    </div>
  </div>
  return <article className="rounded-xl border border-[var(--border)] p-4" data-insight-id={raw.id}>
    {raw.review_status === "revised" ? <details>
      <summary className="cursor-pointer space-y-2"><span className="text-xs text-[var(--muted-foreground)]">수정본 검토 완료 · 이전 기록</span><span className="line-clamp-2 whitespace-pre-wrap text-sm">{raw.text}</span></summary>
      <div className="mt-4">{content}</div>
    </details> : content}
  </article>
}
