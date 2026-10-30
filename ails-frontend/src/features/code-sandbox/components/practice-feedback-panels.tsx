import { t } from "../../../lib/i18n.ts"
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ClipboardList, RefreshCw, Sparkles, X } from "lucide-react"
import type { PdfProblem, PdfProblemGradeResult, PdfProblemHint } from "../../../lib/api.ts"
import { formatProblemRetryDue } from "../lib/code-sandbox-support.ts"

type PracticeGradeDisplay = PdfProblemGradeResult | NonNullable<PdfProblem["last_grading"]>
type PracticeTheoryReference = NonNullable<PdfProblem["related_theory"]>[number]
type PracticeMistakeNote = NonNullable<PdfProblem["mistake_notes"]>[number]
export function PracticeFeedbackPanel({
  error,
  grade,
  theory,
  mistakeNote,
  onOpenPage,
  compact = false,
  previous = false,
}: {
  error?: string
  grade: PracticeGradeDisplay | null
  theory: PracticeTheoryReference[]
  mistakeNote: PracticeMistakeNote | null
  onOpenPage?: (page: number) => void
  compact?: boolean
  previous?: boolean
}) {
  const rankedTheory = [...theory].sort(
    (left, right) => Number(right.score || 0) - Number(left.score || 0),
  )
  const uniqueTheory = rankedTheory.filter((item, index, all) => (
    all.findIndex((candidate) => (
      candidate.page === item.page
      && String(candidate.concept || candidate.title).trim() === String(item.concept || item.title).trim()
    )) === index
  ))
  const primaryTheory = uniqueTheory.slice(0, compact ? 2 : 3)
  const hasDetails = Boolean(
    grade?.reasoning_summary
    || (grade?.suggestions?.length ?? 0) > 1
    || mistakeNote
    || uniqueTheory.length > primaryTheory.length,
  )

  if (!error && !grade) return null
  return (
    <div className="space-y-2" data-practice-feedback-panel="true">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] leading-5 text-red-700 dark:text-red-200" role="alert">
          <AlertTriangle className="mt-0.5 shrink-0" size={13} />
          <span>{error}</span>
        </div>
      )}
      {grade && (
        <section className={`rounded-md border px-3 ${compact ? "py-2" : "py-3"} ${
          previous
            ? "border-[var(--border)] bg-[var(--muted)]/40 text-[var(--foreground)]"
            : grade.verdict === "correct"
            ? "border-emerald-500/30 bg-emerald-500/[0.1] text-[var(--foreground)]"
            : "border-amber-500/30 bg-amber-500/[0.1] text-[var(--foreground)]"
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`flex items-center gap-1.5 text-xs font-bold ${
              previous
                ? "text-[var(--muted-foreground)]"
                : grade.verdict === "correct" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"
            }`}>
              {grade.verdict === "correct"
                ? <CheckCircle2 size={14} />
                : <AlertTriangle size={14} />}
              {previous && <span>{t("이전 채점 ·")}</span>}
              {grade.verdict === "unresolved" ? t("채점 보류") : grade.verdict === "correct" ? t("정답") : t("오답")}
            </div>
            {previous ? (
              <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted-foreground)]">
                {t("이전 답안 기준")}</span>
            ) : mistakeNote && formatProblemRetryDue(mistakeNote.retry_due_at) && (
              <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                {t("복습 예정 ")}{formatProblemRetryDue(mistakeNote.retry_due_at)}
              </span>
            )}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-5 text-[var(--foreground)] font-medium">
            {grade.feedback}
          </p>
          {grade.evidence && (
            <p className="mt-1 break-all text-[10px] text-[var(--muted-foreground)]" data-answer-key-evidence>
              {grade.evidence.rubric_origin === 'ai_without_answer_key'
                ? t("AI 채점 · 답지 미연결")
                : <>답지 근거: {grade.evidence.source.path.split(/[\\/]/).pop()} · 버전 {grade.evidence.source.version.slice(0, 12)}
                  {grade.evidence.rubric_origin === 'model_answer_only' ? ' · 모범답 비교 (공식 배점 없음)' : ' · 명시된 기준'}</>}
            </p>
          )}
          {grade.suggestions?.[0] && (
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">{grade.suggestions[0]}</p>
          )}

          {primaryTheory.length > 0 && (
            <div className="mt-3 border-t border-[var(--border)] pt-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                <BookOpen size={12} /> {t("읽어볼 이론")}</div>
              <div className={`grid gap-1.5 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                {primaryTheory.map((item) => (
                  <button
                    className="min-w-0 rounded-md border border-sky-300/30 bg-sky-50 dark:bg-sky-950/30 px-2 py-1.5 text-left hover:border-sky-400 hover:bg-sky-100/60 dark:hover:bg-sky-950/50 transition-colors"
                    key={`${item.page}-${item.title}-${item.concept || ""}`}
                    onClick={() => onOpenPage?.(item.page)}
                    title={item.snippet || item.concept || item.title}
                    type="button"
                  >
                    <span className="block text-[9px] font-bold text-sky-700 dark:text-sky-300">{item.page}{t("쪽")}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-semibold text-[var(--foreground)]">
                      {item.concept || item.title || t("관련 개념")}
                    </span>
                    {item.snippet && (
                      <span className="mt-0.5 block line-clamp-2 text-[9px] leading-4 text-[var(--muted-foreground)]">
                        {item.snippet}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasDetails && (
            <details className="group mt-2 border-t border-white/10 pt-2 text-[10px] text-white/55">
              <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-white/55 hover:text-white/80">
                <ChevronDown className="transition-transform group-open:rotate-180" size={11} />
                {t("상세 피드백과 오답 노트")}</summary>
              <div className="mt-2 space-y-2 leading-4">
                {grade.reasoning_summary && <p>{grade.reasoning_summary}</p>}
                {grade.suggestions && grade.suggestions.length > 1 && (
                  <ul className="space-y-1">
                    {grade.suggestions.slice(1).map((suggestion) => (
                      <li key={suggestion}>- {suggestion}</li>
                    ))}
                  </ul>
                )}
                {mistakeNote && (
                  <div>
                    <div><span className="font-semibold text-white/70">{t("실패 원인:")}</span> {mistakeNote.failure_reason}</div>
                    <div><span className="font-semibold text-white/70">{t("다시 볼 내용:")}</span> {mistakeNote.remediation}</div>
                  </div>
                )}
                {uniqueTheory.length > primaryTheory.length && (
                  <div className="flex flex-wrap gap-1">
                    {uniqueTheory.slice(primaryTheory.length).map((item) => (
                      <button
                        className="rounded border border-white/10 px-1.5 py-1 hover:bg-white/5"
                        key={`${item.page}-${item.title}-${item.concept || ""}`}
                        onClick={() => onOpenPage?.(item.page)}
                        type="button"
                      >
                        {item.page}{t("쪽 · ")}{item.concept || item.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
export function PracticePreviousFeedback({
  grade,
  theory,
  mistakeNote,
  onOpenPage,
}: {
  grade: PracticeGradeDisplay
  theory: PracticeTheoryReference[]
  mistakeNote: PracticeMistakeNote | null
  onOpenPage?: (page: number) => void
}) {
  return (
    <details
      className="group border-t border-white/10 pt-2"
      data-practice-previous-feedback="true"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-2 text-left hover:bg-white/[0.035]">
        <ClipboardList className="shrink-0 text-white/40" size={13} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-white/65">{t("이전 채점 피드백")}</span>
          <span className="block text-[9px] text-white/35">{t("현재 답안 수정됨 · 재채점 필요")}</span>
        </span>
        <span className={`shrink-0 text-[9px] font-semibold ${
          grade.verdict === "correct" ? "text-emerald-300/70" : "text-amber-200/70"
        }`}>
          {grade.verdict === "unresolved" ? t("채점 보류") : grade.verdict === "correct" ? t("정답") : t("오답")}
        </span>
        <ChevronDown className="shrink-0 text-white/35 transition-transform group-open:rotate-180" size={12} />
      </summary>
      <div className="mt-2">
        <PracticeFeedbackPanel
          grade={grade}
          mistakeNote={mistakeNote}
          onOpenPage={onOpenPage}
          previous
          theory={theory}
        />
      </div>
    </details>
  )
}
export function PracticeHintPanel({
  error,
  hint,
  loading,
  onClose,
}: {
  error: string
  hint: PdfProblemHint | null
  loading: boolean
  onClose: () => void
}) {
  return (
    <section
      className="rounded-lg border border-[var(--brand)]/35 bg-[var(--brand-soft)]/40 p-3 text-[var(--foreground)] shadow-xs"
      data-practice-hint-panel="true"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--brand)]">
          {loading ? <RefreshCw className="animate-spin" size={13} /> : <Sparkles size={13} />}
          <span>{loading ? t("힌트 생성 중") : t("AI 힌트")}</span>
        </div>
        <button
          aria-label={t("힌트 닫기")}
          className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          onClick={onClose}
          type="button"
        >
          <X size={12} />
        </button>
      </div>
      {loading && (
        <p className="mt-2 text-[11px] leading-5 text-[var(--muted-foreground)]">
          {t("정답을 직접 알려주지 않고 다음 풀이 단계에 도움이 되는 단서를 만들고 있습니다.")}</p>
      )}
      {!loading && error && (
        <p className="mt-2 text-[11px] font-semibold leading-5 text-red-700 dark:text-red-300" role="alert">{error}</p>
      )}
      {!loading && !error && hint?.text && (
        <>
          <p className="mt-2 whitespace-pre-wrap text-[12px] font-medium leading-6 text-[var(--foreground)]">{hint.text}</p>
          {(hint.provider || hint.model) && (
            <p className="mt-2 text-[9px] text-[var(--muted-foreground)]">
              {[hint.provider, hint.model].filter(Boolean).join(" · ")}
            </p>
          )}
        </>
      )}
    </section>
  )
}
