import { PracticeActionsMenu } from "./practice-actions-menu.tsx"
import type * as React from "react"
import { ChevronRight, ClipboardList, Edit3, ListChecks, RefreshCw, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import {
  pdfProblemAnswerTypeLabel,
  pdfProblemStatusLabel,
  type PdfProblemNavigatorChapter,
} from "../../../lib/problem-study.ts"
import type { PdfProblem, PdfProblemAutoReviewStatus } from "../../../lib/api"
import { PracticeNavigatorQuestionRow } from "./practice-study-view.tsx"

/* Practice problem navigator (chapter/section/problem list) extracted from
   code-sandbox.tsx as a controlled component: all state and handlers are
   passed in as props, no state logic lives here. */

interface PracticeProblemNavigatorProps {
  foldControl?: React.ReactNode
  retryControls?: React.ReactNode
  activeChapterProblems: PdfProblem[]
  activeProblem: PdfProblem | null
  batchDialogAnsweredCount: number
  batchDialogChangedCount: number
  batchDialogProblems: PdfProblem[]
  batchProblemHasAnswer: (problem: PdfProblem) => boolean
  expandedPracticeChapters: Set<string>
  isAnalyzingProblems: boolean
  isLoadingProblems?: boolean
  isPracticeSelectionMode: boolean
  isProblemActionPending: boolean
  navigatorChapters: PdfProblemNavigatorChapter[]
  onReviewAllProblems?: () => void | Promise<void>
  onReviewAllProblemsLocal?: () => void | Promise<void>
  openProblemBatchDialog: (problemIds: Iterable<string>) => void
  openProblemEditor: (problem: PdfProblem) => void
  practiceProblems: PdfProblem[]
  problemAnalysisError: string
  problemAutoReviewStatus?: PdfProblemAutoReviewStatus | null
  problemBatchDialogIds: string[] | null
  selectPracticeProblem: (problem: PdfProblem) => void
  selectedPracticeProblemIds: Set<string>
  setExpandedPracticeChapters: React.Dispatch<React.SetStateAction<Set<string>>>
  setIsPracticeSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  setProblemBatchDialogIds: React.Dispatch<React.SetStateAction<string[] | null>>
  setSelectedPracticeProblemIds: React.Dispatch<React.SetStateAction<Set<string>>>
  startProblemBatchGrading: (mode: "changed" | "all") => Promise<void>
  togglePracticeProblemSelection: (problemIds: string[], selected?: boolean) => void
}

export function PracticeProblemNavigator({
  foldControl,
  retryControls,
  activeChapterProblems,
  activeProblem,
  batchDialogAnsweredCount,
  batchDialogChangedCount,
  batchDialogProblems,
  batchProblemHasAnswer,
  expandedPracticeChapters,
  isAnalyzingProblems,
  isLoadingProblems = false,
  isPracticeSelectionMode,
  isProblemActionPending,
  navigatorChapters,
  onReviewAllProblems,
  onReviewAllProblemsLocal,
  openProblemBatchDialog,
  openProblemEditor,
  practiceProblems,
  problemAnalysisError,
  problemAutoReviewStatus,
  problemBatchDialogIds,
  selectPracticeProblem,
  selectedPracticeProblemIds,
  setExpandedPracticeChapters,
  setIsPracticeSelectionMode,
  setProblemBatchDialogIds,
  setSelectedPracticeProblemIds,
  startProblemBatchGrading,
  togglePracticeProblemSelection,
}: PracticeProblemNavigatorProps) {
  return (
<div
  className="min-h-0 flex-1 overflow-y-auto p-2 text-[var(--foreground)]"
  data-practice-problem-navigator="true"
>
  <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 px-1">
    <span className="min-w-0 truncate text-[11px] font-bold text-[var(--foreground)]">{t("문제 탐색")}</span>
    <span
      className="text-[9px] text-[var(--muted-foreground)] font-medium"
      title={practiceProblems.length > 0 ? t("디스크에 저장된 문제 분석 결과") : undefined}
    >
      {t("총 ")}{practiceProblems.length}{t("개")}</span>
    {foldControl}
    <div className="col-span-3 flex min-w-0 items-center gap-1">
      <button
        aria-pressed={isPracticeSelectionMode}
        className={`flex h-7 min-w-0 items-center justify-center gap-1 rounded border px-1.5 text-[9px] font-semibold transition-colors ${
          isPracticeSelectionMode
            ? "border-[var(--brand)]/50 bg-[var(--brand-soft)] text-[var(--foreground)]"
            : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]"
        }`}
        data-practice-selection-mode="true"
        disabled={isProblemActionPending}
        onClick={() => {
          setIsPracticeSelectionMode((current) => {
            if (current) {
              setSelectedPracticeProblemIds(new Set())
              setProblemBatchDialogIds(null)
            }
            return !current
          })
        }}
        title={t("여러 문제를 골라 채점하거나 다시 풉니다.")}
        type="button"
      >
        <ListChecks size={11} />
        <span className="truncate">{isPracticeSelectionMode ? t("선택 완료") : t("문제 선택")}</span>
      </button>
      <PracticeActionsMenu label="문제 목록 메뉴">
      <button
        aria-label={t("로컬 AI PDF 문제 검수")}
        className="flex h-7 min-w-0 items-center justify-center gap-1 rounded border border-emerald-400/20 bg-emerald-400/5 px-1.5 text-[9px] font-semibold text-emerald-100/75 hover:bg-emerald-400/10 hover:text-emerald-50 disabled:cursor-not-allowed disabled:opacity-35"
        data-problem-review-all-local="true"
        disabled={
          !onReviewAllProblemsLocal
          || isAnalyzingProblems
          || isProblemActionPending
          || ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus?.status ?? "")
        }
        onClick={() => void onReviewAllProblemsLocal?.()}
        title={t("Qwen3 8B가 좌표로 분리한 최대 두 페이지를 보고 맞춤법, 띄어쓰기와 문제 번호만 로컬에서 검수합니다.")}
        type="button"
      >
        <RefreshCw className={problemAutoReviewStatus?.review_engine === "local" && ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus.status) ? "animate-spin" : ""} size={10} />
        <span className="truncate">
          {problemAutoReviewStatus?.review_engine === "local"
            && ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus.status)
            ? t("로컬 {p0}/{p1}", { p0: problemAutoReviewStatus.page_processed, p1: problemAutoReviewStatus.page_total })
            : t("로컬 AI 검수")}
        </span>
      </button>
      <button
        aria-label={t("클라우드 AI PDF 문제 검수")}
        className="flex h-7 min-w-0 items-center justify-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 text-[9px] font-semibold text-white/55 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        data-problem-review-all="true"
        disabled={
          !onReviewAllProblems
          || isAnalyzingProblems
          || isProblemActionPending
          || ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus?.status ?? "")
        }
        onClick={() => void onReviewAllProblems?.()}
        title={t("감지된 문제를 클라우드 AI로 이미지 검수합니다. 시작 전에 대상 페이지 기준 예상 사용량과 비용을 확인합니다.")}
        type="button"
      >
        <RefreshCw className={isAnalyzingProblems || (problemAutoReviewStatus?.review_engine !== "local" && ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus?.status ?? "")) ? "animate-spin" : ""} size={10} />
        <span className="truncate">
          {isAnalyzingProblems
            ? t("문제 준비 중")
            : problemAutoReviewStatus?.review_engine !== "local" && ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus?.status ?? "")
              ? t("검수 {p0}/{p1}", { p0: problemAutoReviewStatus?.page_processed ?? 0, p1: problemAutoReviewStatus?.page_total ?? 0 })
              : t("클라우드 AI 검수")}
        </span>
      </button>
      </PracticeActionsMenu>
    </div>
  </div>
  {retryControls}
  {isPracticeSelectionMode && (
    <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] gap-1 border-y border-white/10 bg-white/[0.025] px-1 py-2">
    <select
      aria-label={t("문제 선택 범위")}
      className="h-7 min-w-0 rounded border border-white/10 bg-black/20 px-2 text-[9px] text-white/65 outline-none"
      disabled={isProblemActionPending}
      onChange={(event) => {
        const scope = event.target.value
        event.target.value = ""
        if (scope === "current" && activeProblem) {
          togglePracticeProblemSelection([activeProblem.id], true)
        } else if (scope === "chapter") {
          togglePracticeProblemSelection(activeChapterProblems.map((problem) => problem.id), true)
        } else if (scope === "chapter-answered") {
          togglePracticeProblemSelection(
            activeChapterProblems.filter(batchProblemHasAnswer).map((problem) => problem.id),
            true,
          )
        } else if (scope === "all-answered") {
          togglePracticeProblemSelection(
            practiceProblems.filter(batchProblemHasAnswer).map((problem) => problem.id),
            true,
          )
        } else if (scope === "clear") {
          setSelectedPracticeProblemIds(new Set())
        }
      }}
      value=""
    >
      <option value="">{t("범위 선택")}</option>
      <option value="current">{t("현재 문제")}</option>
      <option value="chapter-answered">{t("현재 장의 작성 문제")}</option>
      <option value="chapter">{t("현재 장 전체")}</option>
      <option value="all-answered">{t("작성한 문제 전체")}</option>
      <option value="clear">{t("선택 해제")}</option>
    </select>
    <button
      className="flex h-7 items-center gap-1 rounded bg-[var(--brand)] px-2 text-[9px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-35"
      disabled={selectedPracticeProblemIds.size === 0 || isProblemActionPending}
      onClick={() => openProblemBatchDialog(selectedPracticeProblemIds)}
      title={t("선택한 문제를 묶어서 채점합니다")}
      type="button"
    >
      <ClipboardList size={11} />
      {t("선택한 ")}{selectedPracticeProblemIds.size}{t("개 채점")}</button>
  </div>
  )}
  {problemBatchDialogIds && (
    <div className="mb-2 border-y border-white/10 bg-white/[0.035] px-2 py-2 text-[9px] text-white/65">
      <div className="font-bold text-white/85">{t("선택한 ")}{batchDialogProblems.length}{t("개 문제")}</div>
      <div className="mt-0.5 text-white/40">
        {t("작성 ")}{batchDialogAnsweredCount} {t("· 새 답안 또는 수정 ")}{batchDialogChangedCount} {t("· 미작성 ")}{batchDialogProblems.length - batchDialogAnsweredCount}
      </div>
      <div className="mt-2 flex gap-1">
        <button
          className="flex-1 rounded bg-[var(--brand)] px-2 py-1.5 font-bold text-white disabled:opacity-35"
          disabled={batchDialogChangedCount === 0}
          onClick={() => void startProblemBatchGrading("changed")}
          data-practice-batch-start="changed"
          type="button"
        >
          {t("새 답안·수정 답안만")}</button>
        <button
          className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1.5 font-bold text-white/70 hover:bg-white/10"
          onClick={() => void startProblemBatchGrading("all")}
          data-practice-batch-start="all"
          type="button"
        >
          {t("선택 전체 재채점")}</button>
        <button
          aria-label={t("묶음 채점 취소")}
          className="rounded border border-white/10 p-1.5 text-white/45 hover:bg-white/10"
          onClick={() => setProblemBatchDialogIds(null)}
          type="button"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  )}
  {problemAnalysisError && (
    <div className="mb-2 rounded border border-red-400/20 bg-red-400/5 px-2 py-1.5 text-[9px] leading-4 text-red-200/80" role="alert">
      {problemAnalysisError}
    </div>
  )}
  {navigatorChapters.map((chapter) => {
    const chapterProblemIds = chapter.sections.flatMap((section) => section.problems.map((problem) => problem.id))
    const chapterCompletedCount = chapter.sections
      .flatMap((section) => section.problems)
      .filter((problem) => problem.status === "completed").length
    const chapterExpanded = expandedPracticeChapters.has(chapter.chapter)
    const chapterSelected = chapterProblemIds.length > 0
      && chapterProblemIds.every((id) => selectedPracticeProblemIds.has(id))
    return (
      <div className="mb-1" key={chapter.chapter}>
        <div className="flex min-w-0 items-center gap-1">
          {isPracticeSelectionMode && (
            <input
              aria-label={t("{p0} 전체 선택", { p0: chapter.chapter })}
              checked={chapterSelected}
              className="h-4 w-4 shrink-0 accent-[var(--brand)]"
              disabled={isProblemActionPending}
              onChange={(event) => togglePracticeProblemSelection(chapterProblemIds, event.target.checked)}
              type="checkbox"
            />
          )}
          <button
            aria-expanded={chapterExpanded}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-2 text-left text-[11px] font-bold text-white/85 hover:bg-white/5"
            onClick={() => setExpandedPracticeChapters((current) => {
              const next = new Set(current)
              if (next.has(chapter.chapter)) next.delete(chapter.chapter)
              else next.add(chapter.chapter)
              return next
            })}
            title={chapter.chapter}
            type="button"
          >
            <ChevronRight className={`shrink-0 transition-transform ${chapterExpanded ? "rotate-90" : ""}`} size={11} />
            <span className="min-w-0 flex-1 truncate">{chapter.chapter}</span>
            <span className="shrink-0 text-[9px] font-normal text-white/40">
              {chapterCompletedCount}/{chapterProblemIds.length} {t("완료")}</span>
          </button>
        </div>
        {chapterExpanded && chapter.sections.map((section) => {
          const sectionProblemIds = section.problems.map((problem) => problem.id)
          const sectionSelected = sectionProblemIds.length > 0
            && sectionProblemIds.every((id) => selectedPracticeProblemIds.has(id))
          return (
            <div className="mb-1.5 ml-4" key={`${chapter.chapter}-${section.id}`}>
              <label className="mb-1 flex items-center gap-1.5 px-1 text-[9px] font-semibold text-white/40">
                {isPracticeSelectionMode && (
                  <input
                    aria-label={t("{p0} {p1} 전체 선택", { p0: chapter.chapter, p1: section.label })}
                    checked={sectionSelected}
                    className="h-3.5 w-3.5 accent-[var(--brand)]"
                    disabled={isProblemActionPending}
                    onChange={(event) => togglePracticeProblemSelection(sectionProblemIds, event.target.checked)}
                    type="checkbox"
                  />
                )}
                <span>{section.label}</span>
              </label>
              <div className="space-y-1">
                {section.problems.map((problem) => {
                  const selected = activeProblem?.id === problem.id
                  const checked = selectedPracticeProblemIds.has(problem.id)
                  return (
                    <div className="flex min-w-0 items-stretch gap-1" key={problem.id}>
                      {isPracticeSelectionMode && (
                        <input
                          aria-label={t("{p0} {p1}번 선택", { p0: section.label, p1: problem.number })}
                          checked={checked}
                          className="h-4 w-4 shrink-0 self-center accent-[var(--brand)]"
                          disabled={isProblemActionPending}
                          onChange={(event) => togglePracticeProblemSelection([problem.id], event.target.checked)}
                          type="checkbox"
                        />
                      )}
                      <PracticeNavigatorQuestionRow
                        active={selected}
                        answerType={pdfProblemAnswerTypeLabel(problem)}
                        disabled={isProblemActionPending}
                        label={`${problem.number}${t("번")}`}
                        meta={section.page === null ? `${problem.page}${t("쪽")}` : ""}
                        onSelect={() => selectPracticeProblem(problem)}
                        status={problem.status}
                        statusLabel={pdfProblemStatusLabel(problem.status)}
                        title={t("{p0} · {p1} {p2}번 · {p3}", { p0: problem.chapter, p1: section.label, p2: problem.number, p3: pdfProblemAnswerTypeLabel(problem) })}
                      />
                      <button
                        aria-label={t("{p0}번 문제 수정", { p0: problem.number })}
                        className="flex w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)] transition-colors disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={isProblemActionPending}
                        onClick={() => openProblemEditor(problem)}
                        title={t("{p0}번 문제 직접 수정", { p0: problem.number })}
                        type="button"
                      >
                        <Edit3 size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  })}
  {navigatorChapters.length === 0 && (
    <div className="rounded-lg border border-dashed border-[var(--border)] px-2 py-5 text-center text-[10px] leading-4 text-[var(--muted-foreground)]">
      {isLoadingProblems ? t("저장된 문제 불러오는 중") : isAnalyzingProblems ? t("문제 분석 중") : t("현재 PDF에서 인식된 문제가 없습니다.")}</div>
  )}
</div>
  )
}
