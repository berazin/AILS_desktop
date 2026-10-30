import type * as React from "react"
import { AlertTriangle, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { PDF_PROBLEM_ANSWER_TYPE_LABELS } from "../../../lib/problem-study.ts"
import {
  multimodalReviewChoices,
  multimodalReviewCode,
  multimodalReviewProposal,
} from "../lib/code-sandbox-support.ts"
import type {
  PdfProblemAnswerType,
  PdfProblemReviewQueueItem,
  PdfProblemReviewSelectionSource,
} from "../../../lib/api"

/* Low-confidence problem review queue dialog extracted from code-sandbox.tsx
   as a controlled component: the queue data and editor state live in the
   parent, this component only renders them and reports changes back. */

export interface ReviewQueueEditorState {
  item: PdfProblemReviewQueueItem
  selectedSource: PdfProblemReviewSelectionSource
  problemText: string
  choices: string[]
  codeBlocks: string[]
  codePositions: number[]
  answerType: PdfProblemAnswerType
}

interface ProblemReviewQueueDialogProps {
  isReviewQueueSaving: boolean
  problemActionError: string
  problemReviewQueue: PdfProblemReviewQueueItem[]
  reviewQueueEditor: ReviewQueueEditorState | null
  saveReviewQueueResolution: (event: React.FormEvent<HTMLFormElement>) => Promise<void>
  selectReviewQueueCandidate: (
    item: PdfProblemReviewQueueItem,
    source: PdfProblemReviewSelectionSource,
  ) => void
  setIsProblemReviewQueueOpen: React.Dispatch<React.SetStateAction<boolean>>
  setReviewQueueEditor: React.Dispatch<React.SetStateAction<ReviewQueueEditorState | null>>
}

export function ProblemReviewQueueDialog({
  isReviewQueueSaving,
  problemActionError,
  problemReviewQueue,
  reviewQueueEditor,
  saveReviewQueueResolution,
  selectReviewQueueCandidate,
  setIsProblemReviewQueueOpen,
  setReviewQueueEditor,
}: ProblemReviewQueueDialogProps) {
  return (
<div className="absolute inset-0 z-[142] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm" data-problem-review-queue-dialog="true">
  <section className="flex max-h-full w-full max-w-[1080px] flex-col overflow-hidden rounded-xl border border-amber-300/25 bg-[var(--panel)] text-[var(--foreground)] shadow-2xl">
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-100"><AlertTriangle size={15} /> {t("저신뢰 문제 사용자 검토 기록")}</div>
        <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">{t("미해결 AI 제안은 자동 반영하지 않습니다. 저장은 문제풀이 오버라이드만 바꾸며 PaddleOCR 검색 텍스트·좌표·인덱스는 유지합니다.")}</p>
      </div>
      <button className="rounded p-1 text-[var(--muted-foreground)] hover:bg-black/10 dark:hover:bg-white/10 hover:text-[var(--foreground)]" onClick={() => setIsProblemReviewQueueOpen(false)} type="button"><X size={15} /></button>
    </div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[11px]">
      {problemReviewQueue.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-emerald-700 dark:text-emerald-100">{t("현재 사용자 검토 대기 문제가 없습니다.")}</div>
      ) : problemReviewQueue.map((item) => (
        <article key={item.problem_id} className="rounded-xl border border-[var(--border)] bg-amber-500/[0.04] p-3" data-problem-review-queue-item={item.problem_id}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="font-bold text-amber-800 dark:text-amber-100">{t("페이지 ")}{item.page} {t("· 문제 ")}{item.number}</div>
            <div className="text-[10px] text-amber-700 dark:text-amber-200/70">{t("자동 반영 기준 ")}{Math.round(item.confidence_threshold * 100)}%</div>
          </div>
          <p className="mb-3 rounded bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-100/80">{item.reason}</p>
          <div className="grid gap-3 md:grid-cols-3" data-problem-review-candidates="paddleocr-luna-gemini">
            <button
              className={`rounded-lg border p-3 text-left ${reviewQueueEditor?.item.problem_id === item.problem_id && reviewQueueEditor.selectedSource === "paddleocr" ? "border-emerald-500/60 bg-emerald-500/10" : "border-[var(--border)] bg-black/5 dark:bg-black/20"}`}
              data-problem-review-candidate="paddleocr"
              onClick={() => selectReviewQueueCandidate(item, "paddleocr")}
              type="button"
            >
              <div className="mb-1 font-bold text-emerald-700 dark:text-emerald-100/75">{t("PaddleOCR 원본 · 안전 기준")}</div>
              <pre className="whitespace-pre-wrap font-sans leading-5 text-[var(--foreground)]">{item.original.problem_text || t("(본문 없음)")}</pre>
              {(item.original.choices ?? []).length > 0 && (
                <ol className="mt-2 list-inside list-decimal space-y-1 text-[var(--muted-foreground)]">
                  {(item.original.choices ?? []).map((choice, index) => <li key={index}>{choice}</li>)}
                </ol>
              )}
              {(item.original.code ?? []).map((block, index) => (
                <pre key={index} className="mt-2 overflow-x-auto whitespace-pre rounded border border-[var(--border)] bg-slate-100 dark:bg-black/40 p-2 font-mono text-violet-800 dark:text-violet-100/75">{block}</pre>
              ))}
            </button>
            {(["luna", "gemini"] as const).map((source) => {
              const review = source === "luna" ? item.primary_review : item.fallback_review
              const proposal = multimodalReviewProposal(review)
              const confidence = Number(proposal.confidence || 0)
              return (
                <button
                  key={source}
                  className={`rounded-lg border p-3 text-left ${reviewQueueEditor?.item.problem_id === item.problem_id && reviewQueueEditor.selectedSource === source ? "border-cyan-500/60 bg-cyan-500/10" : "border-[var(--border)] bg-black/5 dark:bg-white/[0.03]"}`}
                  data-problem-review-candidate={source}
                  onClick={() => selectReviewQueueCandidate(item, source)}
                  type="button"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-bold text-cyan-700 dark:text-cyan-100/80">{review.model || (source === "luna" ? t("2차 모델") : t("최종 모델"))}</span>
                    <span className="font-mono text-amber-700 dark:text-amber-100">{Math.round(confidence * 100)}%</span>
                  </div>
                  {review.validation_error && <p className="mb-2 rounded bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-200">{t("구조 검증: ")}{review.validation_error}</p>}
                  <pre className="whitespace-pre-wrap font-sans leading-5 text-[var(--foreground)]">{String(proposal.problem_text || t("(검증된 본문 없음 — 원시 응답은 감사 기록에 보존됨)"))}</pre>
                  {multimodalReviewChoices(review).length > 0 && (
                    <ol className="mt-2 list-inside list-decimal space-y-1 text-[var(--muted-foreground)]">
                      {multimodalReviewChoices(review).map((choice, index) => <li key={index}>{choice}</li>)}
                    </ol>
                  )}
                  {multimodalReviewCode(review).map((block, index) => (
                    <pre key={index} className="mt-2 overflow-x-auto whitespace-pre rounded border border-[var(--border)] bg-slate-100 dark:bg-black/40 p-2 font-mono text-violet-800 dark:text-violet-100/85">{block}</pre>
                  ))}
                  <p className="mt-2 text-[var(--muted-foreground)]">{String(proposal.reason || review.validation_error || t("모델 이유 없음"))}</p>
                </button>
              )
            })}
          </div>
          {item.status === "resolved" && (
            <p className="mt-3 rounded bg-emerald-500/10 px-2 py-1.5 text-emerald-700 dark:text-emerald-100/80">
              {t("저장됨 · ")}{item.selected_source ?? t("선택 출처 없음")} {t("· 다시 선택하고 편집해 재저장할 수 있습니다.")}</p>
          )}
          {reviewQueueEditor?.item.problem_id === item.problem_id && (
            <form className="mt-3 space-y-3 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.04] p-3" data-problem-review-resolution-editor="true" onSubmit={(event) => void saveReviewQueueResolution(event)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-cyan-700 dark:text-cyan-100">{t("선택: ")}{reviewQueueEditor.selectedSource}</strong>
                <select
                  className="rounded border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] px-2 py-1 text-[10px]"
                  onChange={(event) => setReviewQueueEditor((current) => current ? { ...current, answerType: event.target.value as PdfProblemAnswerType } : current)}
                  value={reviewQueueEditor.answerType}
                >
                  {(Object.keys(PDF_PROBLEM_ANSWER_TYPE_LABELS) as PdfProblemAnswerType[]).map((answerType) => <option key={answerType} value={answerType}>{t(PDF_PROBLEM_ANSWER_TYPE_LABELS[answerType])}</option>)}
                </select>
              </div>
              <label className="block space-y-1"><span className="font-bold text-[var(--foreground)]">{t("문제 본문 · 선택지/코드 제외")}</span><textarea className="min-h-28 w-full rounded border border-[var(--border)] bg-white dark:bg-black/25 text-[var(--foreground)] p-2 font-sans leading-5" onChange={(event) => setReviewQueueEditor((current) => current ? { ...current, problemText: event.target.value } : current)} required value={reviewQueueEditor.problemText} /></label>
              <div className="space-y-2" data-problem-review-choice-items="true">
                <div className="flex items-center justify-between"><span className="font-bold text-[var(--foreground)]">{t("선택지 · 항목/순서/줄바꿈 유지")}</span><button className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 text-[var(--foreground)] px-2 py-1 text-[9px]" onClick={() => setReviewQueueEditor((current) => current ? { ...current, choices: [...current.choices, ""] } : current)} type="button">{t("선택지 추가")}</button></div>
                {reviewQueueEditor.choices.map((choice, index) => (
                  <div className="flex gap-2" key={index}>
                    <textarea className="min-h-16 flex-1 whitespace-pre-wrap rounded border border-[var(--border)] bg-white dark:bg-black/25 text-[var(--foreground)] p-2" onChange={(event) => setReviewQueueEditor((current) => current ? { ...current, choices: current.choices.map((value, choiceIndex) => choiceIndex === index ? event.target.value : value) } : current)} value={choice} />
                    <button className="self-start rounded border border-red-500/30 px-2 py-1 text-red-600 dark:text-red-300" onClick={() => setReviewQueueEditor((current) => current ? { ...current, choices: current.choices.filter((_value, choiceIndex) => choiceIndex !== index) } : current)} type="button">{t("삭제")}</button>
                  </div>
                ))}
              </div>
              <div className="space-y-2" data-problem-review-code-blocks="true">
                <div className="flex items-center justify-between"><span className="font-bold text-[var(--foreground)]">{t("코드 박스 · 각 배열 항목 서식/본문 삽입 위치 유지")}</span><button className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 text-[var(--foreground)] px-2 py-1 text-[9px]" onClick={() => setReviewQueueEditor((current) => current ? { ...current, codeBlocks: [...current.codeBlocks, ""], codePositions: [...current.codePositions, current.problemText.length] } : current)} type="button">{t("코드 박스 추가")}</button></div>
                {reviewQueueEditor.codeBlocks.map((block, index) => (
                  <div className="flex gap-2" key={index}>
                    <textarea className="min-h-24 flex-1 whitespace-pre rounded border border-[var(--border)] bg-white dark:bg-black/30 text-[var(--foreground)] p-2 font-mono" onChange={(event) => setReviewQueueEditor((current) => current ? { ...current, codeBlocks: current.codeBlocks.map((value, blockIndex) => blockIndex === index ? event.target.value : value) } : current)} spellCheck={false} value={block} />
                    <label className="w-20 space-y-1 text-[9px] text-[var(--muted-foreground)]"><span>{t("삽입 위치")}</span><input className="w-full rounded border border-[var(--border)] bg-white dark:bg-black/30 text-[var(--foreground)] px-1 py-1 font-mono" max={reviewQueueEditor.problemText.length} min={0} onChange={(event) => setReviewQueueEditor((current) => current ? { ...current, codePositions: current.codePositions.map((value, positionIndex) => positionIndex === index ? Number(event.target.value) : value) } : current)} type="number" value={reviewQueueEditor.codePositions[index] ?? reviewQueueEditor.problemText.length} /></label>
                    <button className="self-start rounded border border-red-500/30 px-2 py-1 text-red-600 dark:text-red-300" onClick={() => setReviewQueueEditor((current) => current ? { ...current, codeBlocks: current.codeBlocks.filter((_value, blockIndex) => blockIndex !== index), codePositions: current.codePositions.filter((_value, positionIndex) => positionIndex !== index) } : current)} type="button">{t("삭제")}</button>
                  </div>
                ))}
                {reviewQueueEditor.codeBlocks.length === 0 && <p className="text-[var(--muted-foreground)]">{t("코드 없음: 빈 배열로 명시 저장됩니다.")}</p>}
              </div>
              {problemActionError && <p className="rounded bg-red-500/10 px-2 py-1.5 text-red-700 dark:text-red-200">{problemActionError}</p>}
              <div className="flex justify-end"><button className="rounded bg-cyan-600 px-3 py-1.5 font-bold text-white disabled:opacity-40" disabled={isReviewQueueSaving || !reviewQueueEditor.problemText.trim()} type="submit">{isReviewQueueSaving ? t("저장 중") : t("문제풀이 오버라이드 저장")}</button></div>
              <p className="text-[9px] text-[var(--muted-foreground)]">{t("PDF 검색 텍스트·좌표·인덱스는 변경되지 않습니다. 저장 후에도 이 항목에서 다시 편집할 수 있습니다.")}</p>
            </form>
          )}
        </article>
      ))}
    </div>
    <div className="flex justify-end border-t border-[var(--border)] px-4 py-3">
      <button className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 px-3 py-1.5 text-[10px] font-bold text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10" onClick={() => setIsProblemReviewQueueOpen(false)} type="button">{t("닫기")}</button>
    </div>
  </section>
</div>
  )
}
