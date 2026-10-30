import { useState } from "react"
import { Button } from "../../shared/ui/button.tsx"
import type { InsightReview, WrongInsight } from "./api.ts"
import { claimFeedback } from "./review-presentation.ts"

const forms: Record<string, string> = { explain: "개념 설명", correct: "문장 교정", why: "이유 설명", counterexample: "반례 찾기", apply: "새 상황에 적용", compare: "개념 비교" }

export function WrongInsightReview({ wrong, reviews, busy, now, onAction }: {
  wrong: WrongInsight; reviews: InsightReview[]; busy: boolean; now: number
  onAction: (body: Record<string, unknown>) => Promise<boolean>
}) {
  const [answer, setAnswer] = useState("")
  const history = reviews.filter(row => row.wrong_id === wrong.id).sort((a, b) => b.created_at - a.created_at)
  const pending = history.find(row => !row.graded_at)
  const due = wrong.next_review <= now
  return <article className="space-y-3 rounded-xl border border-[var(--border)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{wrong.claim.text}</strong>
      <span className="text-sm">{wrong.status === "mastered" ? "해결됨" : "학습 중"} · 이해 확인 {wrong.mastery.successes}회 / {wrong.mastery.forms.length}가지 형식</span></div>
    <p className="text-sm text-[var(--muted-foreground)]">오개념 유형: {wrong.claim.misconception || "개념 관계"}</p>
    {pending ? <form className="space-y-3" onSubmit={event => {
      event.preventDefault()
      void onAction({ action: "grade", wrong_id: wrong.id, review_id: pending.id, answer }).then(ok => { if (ok) setAnswer("") })
    }}>
      <p className="text-sm font-semibold">{forms[pending.form]} · 복습 문제</p>
      <p className="whitespace-pre-wrap">{pending.question}</p>
      <textarea aria-label="복습 답안" className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-3" rows={4} value={answer} onChange={e => setAnswer(e.target.value)} maxLength={10000} required />
      <Button disabled={busy || !answer.trim()}>답안 제출·이해 확인</Button>
    </form> : <>
      {claimFeedback(wrong.claim, wrong.claim.text).map(item => <div key={item.label}><strong className="text-sm">{item.label}</strong><p>{item.text}</p></div>)}
      <p className="text-sm">다음 복습: {new Date(wrong.next_review * 1000).toLocaleString()}</p>
      <Button disabled={busy || !due} onClick={() => { void onAction({ action: "question", wrong_id: wrong.id }) }}>다른 방식으로 복습하기</Button>
    </>}
    <details><summary className="cursor-pointer text-sm">복습 이력 ({history.filter(row => row.graded_at).length})</summary>
      {history.filter(row => row.graded_at).map(row => <div key={row.id} className="my-3 space-y-1 border-t border-[var(--border)] pt-2 text-sm">
        <p>{forms[row.form]} · {new Date(row.graded_at! * 1000).toLocaleString()} · {row.grading?.understood ? "이해 확인" : "추가 학습 필요"}</p>
        <p>{row.question}</p><p>내 답안: {row.answer}</p><p>{row.grading?.feedback}</p><p>참고 답안: {row.expected}</p>
      </div>)}
    </details>
  </article>
}
