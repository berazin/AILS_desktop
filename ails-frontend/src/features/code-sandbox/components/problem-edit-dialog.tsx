import { useEffect, useId, useRef } from "react"
import type * as React from "react"
import { createPortal } from "react-dom"
import { Edit3, RefreshCw, Save, Sparkles, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { PDF_PROBLEM_ANSWER_TYPE_LABELS } from "../../../lib/problem-study.ts"
import type { PdfProblemAnswerType } from "../../../lib/api"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { usePracticeFloatingWindow } from "../hooks/use-practice-floating-window.ts"
import "./problem-edit-dialog.css"

/* Problem content edit dialog (direct edit or AI review result) extracted
   from code-sandbox.tsx as a controlled component: dialog state and the
   save handler live in the parent. */

export interface ProblemEditDialogState {
  problemId: string
  source: "user" | "ai"
  problemText: string
  number: string
  page: string
  pageEnd: string
  answerType: PdfProblemAnswerType
  choicesText: string
  codePositions?: number[]
  originalContent?: {
    problemText: string
    editorText: string
    choices: string[]
    codePositions?: number[]
  }
  reason: string
  provider: string
  model: string
  aiChanged: boolean | null
}

interface ProblemEditDialogProps {
  isProblemEditing: boolean
  problemActionError: string
  problemEditDialog: ProblemEditDialogState
  saveProblemEdits: (event: React.FormEvent<HTMLFormElement>) => Promise<void>
  setProblemEditDialog: React.Dispatch<React.SetStateAction<ProblemEditDialogState | null>>
}

export function ProblemEditDialog({
  isProblemEditing,
  problemActionError,
  problemEditDialog,
  saveProblemEdits,
  setProblemEditDialog,
}: ProblemEditDialogProps) {
  const dialog = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const floating = usePracticeFloatingWindow({ width: 720, height: 780, storageKey: "ails_problem_edit_window_bounds" })
  const close = useEventCallback(() => { if (!isProblemEditing) setProblemEditDialog(null) })
  useEffect(() => {
    const panel = dialog.current
    const previous = document.activeElement
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.key !== "Escape"
        || !(event.target instanceof Node) || !panel?.contains(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener("keydown", handleKey, true)
    return () => {
      window.removeEventListener("keydown", handleKey, true)
      if (previous instanceof HTMLElement && previous.isConnected && panel?.contains(document.activeElement)) previous.focus()
    }
  }, [close])
  return createPortal(
<div className="problem-edit-overlay" data-problem-edit-overlay>
  <form
    ref={dialog}
    role="dialog"
    aria-modal="false"
    aria-labelledby={titleId}
    data-problem-edit-dialog
    style={floating.style}
    className="problem-edit-dialog flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-2xl"
    onClick={(event) => event.stopPropagation()}
    onSubmit={(event) => void saveProblemEdits(event)}
  >
    <div className="problem-edit-drag flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3" data-problem-edit-drag {...floating.drag}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {problemEditDialog.source === "ai"
            ? <Sparkles className="text-violet-600 dark:text-violet-300" size={15} />
            : <Edit3 className="text-[var(--brand)]" size={15} />}
          <h3 id={titleId} className="text-sm font-bold text-[var(--foreground)]">
            {problemEditDialog.source === "ai" ? t("AI 문제 검수 결과") : t("문제 직접 수정")}
          </h3>
          {problemEditDialog.aiChanged !== null && (
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
              problemEditDialog.aiChanged
                ? "bg-violet-500/15 text-violet-700 dark:text-violet-200"
                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
            }`}>
              {problemEditDialog.aiChanged ? t("수정안 있음") : t("수정 불필요")}
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">
          {t("문제 ID와 풀이 기록은 유지됩니다. 내용을 확인한 뒤 적용해 주세요.")}</p>
      </div>
      <button
        aria-label={t("문제 수정 창 닫기")}
        className="rounded p-1 text-[var(--muted-foreground)] hover:bg-black/10 dark:hover:bg-white/10 hover:text-[var(--foreground)] disabled:opacity-35"
        disabled={isProblemEditing}
        onClick={close}
        type="button"
      >
        <X size={15} />
      </button>
    </div>

    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {problemEditDialog.source === "ai" && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5">
          <div className="text-[10px] font-bold text-violet-800 dark:text-violet-200">{t("검수 의견")}</div>
          <p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-violet-900 dark:text-violet-100/85">
            {problemEditDialog.reason}
          </p>
          {(problemEditDialog.provider || problemEditDialog.model) && (
            <p className="mt-1 text-[9px] text-violet-700/60 dark:text-violet-200/40">
              {[problemEditDialog.provider, problemEditDialog.model].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      )}

      <div className="problem-edit-grid grid grid-cols-2 gap-3">
        <label className="space-y-1 text-[10px] font-bold text-[var(--foreground)]">
          <span>{t("문제 번호")}</span>
          <input
            className="h-8 w-full rounded border border-[var(--border)] bg-white dark:bg-white/5 px-2 text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
            min={1}
            onChange={(event) => setProblemEditDialog((current) => current
              ? { ...current, number: event.target.value }
              : current)}
            required
            type="number"
            value={problemEditDialog.number}
          />
        </label>
        <label className="space-y-1 text-[10px] font-bold text-[var(--foreground)]">
          <span>{t("시작 페이지")}</span>
          <input
            className="h-8 w-full rounded border border-[var(--border)] bg-white dark:bg-white/5 px-2 text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
            min={1}
            onChange={(event) => setProblemEditDialog((current) => current
              ? { ...current, page: event.target.value }
              : current)}
            required
            type="number"
            value={problemEditDialog.page}
          />
        </label>
        <label className="space-y-1 text-[10px] font-bold text-[var(--foreground)]">
          <span>{t("끝 페이지")}</span>
          <input
            className="h-8 w-full rounded border border-[var(--border)] bg-white dark:bg-white/5 px-2 text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
            min={problemEditDialog.page || 1}
            onChange={(event) => setProblemEditDialog((current) => current
              ? { ...current, pageEnd: event.target.value }
              : current)}
            required
            type="number"
            value={problemEditDialog.pageEnd}
          />
        </label>
        <label className="space-y-1 text-[10px] font-bold text-[var(--foreground)]">
          <span>{t("문제 유형")}</span>
          <select
            className="h-8 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[10px] text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
            onChange={(event) => setProblemEditDialog((current) => current
              ? { ...current, answerType: event.target.value as PdfProblemAnswerType }
              : current)}
            value={problemEditDialog.answerType}
          >
            {(Object.keys(PDF_PROBLEM_ANSWER_TYPE_LABELS) as PdfProblemAnswerType[]).map((answerType) => (
              <option key={answerType} value={answerType}>
                {PDF_PROBLEM_ANSWER_TYPE_LABELS[answerType]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1 text-[10px] font-bold text-[var(--foreground)]">
        <span>{t("문제 본문")}</span>
        <textarea
          autoFocus
          className="min-h-[260px] w-full resize-y rounded-lg border border-[var(--border)] bg-white dark:bg-white/[0.04] px-3 py-2 font-mono text-[11px] leading-5 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/50 focus:border-[var(--brand)]"
          onChange={(event) => setProblemEditDialog((current) => current
            ? { ...current, problemText: event.target.value }
            : current)}
          placeholder={t("OCR로 추출된 문제 본문")}
          required
          spellCheck={false}
          value={problemEditDialog.problemText}
        />
      </label>

      {problemEditDialog.answerType === "multiple_choice" && (
        <label className="block space-y-1 text-[10px] font-bold text-[var(--foreground)]">
          <span>{t("선택지 ")}<span className="font-normal text-[var(--muted-foreground)]">{t("한 줄에 하나씩 입력")}</span></span>
          <textarea
            className="min-h-[110px] w-full resize-y rounded-lg border border-[var(--border)] bg-white dark:bg-white/[0.04] px-3 py-2 text-[11px] leading-5 text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
            onChange={(event) => setProblemEditDialog((current) => current
              ? { ...current, choicesText: event.target.value }
              : current)}
            placeholder={t("첫 번째 선택지\n두 번째 선택지")}
            spellCheck={false}
            value={problemEditDialog.choicesText}
          />
        </label>
      )}

      {problemActionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-700 dark:text-red-200">
          {problemActionError}
        </div>
      )}
    </div>

    <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] py-3 pl-4 pr-8">
      <button
        className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 px-3 py-1.5 text-[10px] font-bold text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-40"
        disabled={isProblemEditing}
        onClick={close}
        type="button"
      >
        {t("취소")}</button>
      <button
        className="flex min-w-24 items-center justify-center gap-1.5 rounded bg-[var(--brand)] px-3 py-1.5 text-[10px] font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={isProblemEditing || !problemEditDialog.problemText.trim()}
        type="submit"
      >
        {isProblemEditing
          ? <RefreshCw className="animate-spin" size={11} />
          : <Save size={11} />}
        <span>{isProblemEditing ? t("저장 중") : t("수정 적용")}</span>
      </button>
    </div>
    <button type="button" aria-label={t("문제 수정창 크기 조절")} className="problem-edit-resize" data-problem-edit-resize {...floating.resize} />
  </form>
</div>
  , document.body)
}
