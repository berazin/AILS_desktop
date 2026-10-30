import { IDE_ENABLED } from "../../../edition.ts"
import { t } from "../../../lib/i18n.ts"
import React from "react"
import { AlertTriangle, Check, ClipboardList, Edit3, Eye, Play, RefreshCw, Sparkles, Square } from "lucide-react"
import { type PdfProblem, type PdfProblemAnswerType, type PdfProblemAutoReviewStatus } from "../../../lib/api"
import { PracticeStepButton, PracticeStudyToolbar } from "./practice-study-view.tsx"
import {
  formatProblemElapsed,
  formatProblemLastAttempt,
  PDF_PROBLEM_ANSWER_TYPE_LABELS,
  pdfProblemStatusLabel,
  problemElapsedSeconds,
} from "../../../lib/problem-study.ts"
import { type SandboxFile } from "../lib/code-sandbox-support.ts"

interface PracticeStudyHeaderProps {
  tutorControl?: React.ReactNode
  activeProblem: PdfProblem
  answerKeyControl?: React.ReactNode
  roundControls?: React.ReactNode
  isProblemActionPending: boolean
  openProblemEditor: (problem: PdfProblem, options?: { source?: "user" | "ai"; proposal?: { problem_text: string; number: number; page: number; page_end: number; answer_type: PdfProblemAnswerType; choices: string[]; reason: string; changed: boolean; }; provider?: string; model?: string; }) => void
  onReviewQueuedProblems: (() => void | Promise<void>) | undefined
  pendingReviewQueueCount: number
  isProblemAnswerSaving: boolean
  isAnalyzingProblems: boolean
  problemAutoReviewStatus: PdfProblemAutoReviewStatus | null
  onReviewCurrentPage: (() => void | Promise<void>) | undefined
  problemReviewQueue: import("../../../lib/api").PdfProblemReviewQueueItem[]
  setIsProblemReviewQueueOpen: React.Dispatch<React.SetStateAction<boolean>>
  problemTypeMenuRef: React.RefObject<HTMLDivElement | null>
  isProblemTypeMenuOpen: boolean
  setIsProblemTypeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  activeProblemBinaryPrompt: import("../../../lib/problem-study.ts").PdfProblemBinaryPrompt | null
  activeProblemAnswerType: PdfProblemAnswerType | null
  isProblemTypeUpdating: boolean
  changeActiveProblemAnswerType: (answerType: PdfProblemAnswerType) => Promise<void>
  toggleActiveProblemTimer: () => Promise<void>
  isProblemTimerUpdating: boolean
  problemClockNow: number
  isProblemHintVisible: boolean
  isProblemHintLoading: boolean
  activeProblemHint: import("../../../lib/api").PdfProblemHint | null
  toggleActiveProblemHint: () => Promise<void>
  previousPracticeProblem: PdfProblem | null
  selectPracticeProblem: (problem: PdfProblem) => void
  openActiveProblemAnswerEditor: () => void
  activeProblemAnswerInputType: PdfProblemAnswerType | null
  activeFile: SandboxFile | undefined
  gradeActiveProblem: () => Promise<void>
  isProblemGrading: boolean
  nextPracticeProblem: PdfProblem | null
}

export function PracticeStudyHeader({
  tutorControl,
  activeProblem,
  answerKeyControl,
  roundControls,
  isProblemActionPending,
  openProblemEditor,
  onReviewQueuedProblems,
  pendingReviewQueueCount,
  isProblemAnswerSaving,
  isAnalyzingProblems,
  problemAutoReviewStatus,
  onReviewCurrentPage,
  problemReviewQueue,
  setIsProblemReviewQueueOpen,
  problemTypeMenuRef,
  isProblemTypeMenuOpen,
  setIsProblemTypeMenuOpen,
  activeProblemBinaryPrompt,
  activeProblemAnswerType,
  isProblemTypeUpdating,
  changeActiveProblemAnswerType,
  toggleActiveProblemTimer,
  isProblemTimerUpdating,
  problemClockNow,
  isProblemHintVisible,
  isProblemHintLoading,
  activeProblemHint,
  toggleActiveProblemHint,
  previousPracticeProblem,
  selectPracticeProblem,
  openActiveProblemAnswerEditor,
  activeProblemAnswerInputType,
  activeFile,
  gradeActiveProblem,
  isProblemGrading,
  nextPracticeProblem,
}: PracticeStudyHeaderProps) {
  return (
    <PracticeStudyToolbar
      heading={`${activeProblem.chapter} · ${activeProblem.kind === "lab" ? t("실습") : t("연습")} ${activeProblem.number}${t("번")}`}
      status={pdfProblemStatusLabel(activeProblem.status)}
      statusTone={activeProblem.status}
      meta={`${activeProblem.solve_round_number ?? 1}${t("회차")} · ${activeProblem.page}${t("쪽 · 오답 ")}${activeProblem.wrong_count}${t("회")}`}
      metaTitle={t("마지막 풀이 {p0} · 오답 {p1}회", { p0: formatProblemLastAttempt(activeProblem.last_attempt_at), p1: activeProblem.wrong_count })}
      onSecondaryClose={() => setIsProblemTypeMenuOpen(false)}
      secondaryActions={<><button
            aria-label={t("{p0}번 문제 직접 수정", { p0: activeProblem.number })}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[9px] font-bold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isProblemActionPending}
            onClick={() => openProblemEditor(activeProblem)}
            title={t("문제 본문과 기본 정보를 직접 수정합니다.")}
            type="button"
          >
            <Edit3 size={10} />
            <span>{t("수정")}</span>
          </button>
          {onReviewQueuedProblems && pendingReviewQueueCount > 0 && (
            <button
              aria-label={t("검토 문제 검수")}
              className="code-sandbox-button w-[112px] text-cyan-700 dark:text-cyan-200"
              data-review-queue-problems="true"
              disabled={
                isProblemActionPending
                || isProblemAnswerSaving
                || isAnalyzingProblems
                || ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus?.status ?? "")
              }
              onClick={() => void onReviewQueuedProblems()}
              title={t("전체 문제 검수 후 사용자 검토 대기열에 남은 문제들만 페이지 batch로 다시 검수합니다.")}
              type="button"
            >
              {problemAutoReviewStatus?.run_scope === "review_queue"
                && ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus.status)
                ? <RefreshCw className="animate-spin" size={11} />
                : <Eye size={11} />}
              <span>
                {problemAutoReviewStatus?.run_scope === "review_queue"
                  && ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus.status)
                  ? t("검토 {p0}/{p1}", { p0: problemAutoReviewStatus.page_processed, p1: problemAutoReviewStatus.page_total })
                  : t("검토 문제 검수 {p0}", { p0: pendingReviewQueueCount })}
              </span>
            </button>
          )}
          {onReviewCurrentPage && activeProblem && (
            <button
              aria-label={t("현재 페이지 이미지 검수")}
              className="code-sandbox-button w-[132px] text-violet-700 dark:text-violet-200"
              data-problem-review-current-page="true"
              disabled={
                isProblemActionPending
                || isProblemAnswerSaving
                || isAnalyzingProblems
                || ["queued", "running", "cancel_pending"].includes(problemAutoReviewStatus?.status ?? "")
              }
              onClick={() => void onReviewCurrentPage()}
              title={t("개발판에서 현재 PDF 페이지만 이미지로 AI 검수합니다.")}
              type="button"
            >
              <Eye size={11} />
              <span>{t("현재 페이지 검수")}</span>
            </button>
          )}
          {problemReviewQueue.length > 0 && (
            <button
              aria-label={t("저신뢰 문제 사용자 검토 대기열")}
              className="code-sandbox-button w-[108px] text-amber-700 dark:text-amber-200"
              data-problem-review-queue="true"
              onClick={() => setIsProblemReviewQueueOpen(true)}
              title={t("저신뢰 문제를 검토하고, 저장된 사용자 해결 결과도 다시 편집합니다.")}
              type="button"
            >
              <AlertTriangle size={11} />
              <span>{t("검토 ")}{pendingReviewQueueCount}/{problemReviewQueue.length}</span>
            </button>
          )}
          <div className="relative" ref={problemTypeMenuRef}>
            <button
              aria-expanded={isProblemTypeMenuOpen}
              aria-label={t("문제 유형 변경")}
              className="code-sandbox-button w-[156px] text-[var(--foreground)]"
              data-problem-type-editor="true"
              disabled={isProblemActionPending || isProblemAnswerSaving}
              onClick={() => setIsProblemTypeMenuOpen((current) => !current)}
              title={activeProblem.answer_type_prediction?.reason || t("문제 유형을 직접 교정합니다.")}
              type="button"
            >
              <Edit3 size={11} />
              <span>{t("문제 유형: ")}{activeProblemBinaryPrompt ? "O/X" : t(PDF_PROBLEM_ANSWER_TYPE_LABELS[activeProblemAnswerType ?? "unknown"])}</span>
            </button>
            {isProblemTypeMenuOpen && (
              <div className="absolute right-0 top-full z-[90] mt-1 w-44 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-2xl text-[var(--foreground)]">
                {(Object.keys(PDF_PROBLEM_ANSWER_TYPE_LABELS) as PdfProblemAnswerType[]).filter(type => IDE_ENABLED || type !== "code").map((answerType) => {
                  const selected = answerType === activeProblemAnswerType
                  return (
                    <button
                      aria-pressed={selected}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[10px] transition-colors ${
                        selected ? "bg-[var(--brand)] text-white font-bold" : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                      }`}
                      disabled={isProblemTypeUpdating}
                      key={answerType}
                      onClick={() => void changeActiveProblemAnswerType(answerType)}
                      type="button"
                    >
                      <span>{t(PDF_PROBLEM_ANSWER_TYPE_LABELS[answerType])}</span>
                      {selected && <Check size={11} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
    </>}
    >
        {answerKeyControl}
        {roundControls}
        <button
          className={`code-sandbox-button w-[92px] ${activeProblem.timer_started_at ? "code-sandbox-button-danger" : ""}`}
          disabled={isProblemActionPending}
          aria-label={activeProblem.timer_started_at ? t("타이머 중지") : t("타이머 시작")}
          onClick={() => void toggleActiveProblemTimer()}
          type="button"
        >
          {isProblemTimerUpdating
            ? <RefreshCw className="animate-spin" size={12} />
            : activeProblem.timer_started_at
              ? <Square size={12} />
              : <Play size={12} />}
          <span>{activeProblem.timer_started_at ? t("타이머 중지") : t("타이머 시작")}</span>
        </button>
        <span className="w-12 text-center font-mono font-bold text-sky-700 dark:text-sky-300">
          {formatProblemElapsed(problemElapsedSeconds(activeProblem, problemClockNow))}
        </span>
        <button
          aria-label={t("힌트")}
          aria-expanded={isProblemHintVisible}
          className={`code-sandbox-button w-[92px] ${isProblemHintVisible ? "text-[var(--brand)]" : ""}`}
          data-voice-command="show-hint"
          disabled={isProblemHintLoading || (!activeProblemHint && isProblemActionPending)}
          onClick={() => void toggleActiveProblemHint()}
          title={activeProblemHint?.text ? t("생성된 힌트를 보거나 숨깁니다.") : t("채점 AI로 풀이 힌트를 생성합니다.")}
          type="button"
        >
          {isProblemHintLoading
            ? <RefreshCw className="animate-spin" size={11} />
            : <Sparkles size={11} />}
          <span>
            {isProblemHintLoading
              ? t("힌트 생성 중")
              : activeProblemHint?.text
                ? isProblemHintVisible ? t("힌트 숨기기") : t("힌트 보기")
                : t("힌트 받기")}
          </span>
        </button>
        {tutorControl}
        <PracticeStepButton direction="previous" disabled={!previousPracticeProblem || isProblemActionPending} onClick={() => previousPracticeProblem && selectPracticeProblem(previousPracticeProblem)} />
        <button
          className="code-sandbox-button w-[88px]"
          disabled={isProblemActionPending}
          aria-label={t("답안 작성")}
          onClick={openActiveProblemAnswerEditor}
          title={t("현재 문제의 답안 작성 영역을 엽니다.")}
          type="button"
        >
          <ClipboardList size={11} />
          <span>{t("답안 작성")}</span>
        </button>
        <button
          className="code-sandbox-button code-sandbox-button-accent w-[116px]"
          data-current-problem-grading-button="true"
          aria-label={t("현재 문제 채점")}
          disabled={
            isProblemActionPending
            || (activeProblemAnswerInputType === "code"
              ? !activeFile
              : activeProblemAnswerInputType === "unknown")
          }
          onClick={() => void gradeActiveProblem()}
          type="button"
          title={
            !activeProblem.answer_key || activeProblem.answer_key.status === "unlinked"
              ? t("답지가 연결되지 않아 문제와 제출 답안을 AI가 평가합니다.")
              : activeProblemAnswerInputType === "code"
              ? t("확정 답지와 명시된 기준으로 코드 문제를 평가합니다.")
              : t("확정 답지로 채점합니다. 근거가 없거나 불확실하면 보류합니다.")
          }
        >
          {isProblemGrading ? <RefreshCw className="animate-spin" size={12} /> : <Sparkles size={12} />}
          <span>{isProblemGrading ? t("채점 중") : !activeProblem.answer_key || activeProblem.answer_key.status === "unlinked" ? t("AI 채점") : t("채점")}</span>
        </button>
        <PracticeStepButton direction="next" disabled={!nextPracticeProblem || isProblemActionPending} onClick={() => nextPracticeProblem && selectPracticeProblem(nextPracticeProblem)} />
    </PracticeStudyToolbar>
  )
}
