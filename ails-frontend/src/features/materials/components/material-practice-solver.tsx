import { PracticeWindowHeader } from "../../code-sandbox/components/practice-window-header.tsx"
import { useEffect, useRef, useState } from "react"
import { Clock3, Loader2, RotateCcw, Sparkles } from "lucide-react"

import {
  generateMaterialPracticeHint,
  gradeMaterialPracticeAnswer,
  loadMaterialPracticeSet,
  loadMaterialPracticeHistory,
  selectMaterialPracticeQuestion,
  retryMaterialPracticeQuestion,
  saveMaterialPracticeAnswer,
  updateMaterialPracticeTimer,
  type MaterialPracticeMutation,
  type MaterialPracticeQuestion,
  type MaterialPracticeSet,
} from "../../../lib/api.ts"
import { t } from "../../../lib/i18n.ts"
import { PracticeHintPanel } from "../../code-sandbox/components/practice-feedback-panels.tsx"
import { PracticeFeedbackPanel } from "../../code-sandbox/components/practice-feedback-panels.tsx"
import { PracticeMultipleChoice } from "../../code-sandbox/components/practice-multiple-choice.tsx"
import { PracticeNavigatorQuestionRow, PracticeStepButton, PracticeStudyToolbar } from "../../code-sandbox/components/practice-study-view.tsx"
import { useCodeSandboxWindowChrome } from "../../code-sandbox/hooks/use-code-sandbox-window-chrome.ts"
import { usePracticeNavigation } from "../../code-sandbox/hooks/use-practice-navigation.ts"
import { usePracticeNavigationFold } from "../../code-sandbox/hooks/use-practice-navigation-fold.ts"
import { PracticeNavigationFoldButton, PracticeNavigationRail } from "../../code-sandbox/components/practice-navigation-fold.tsx"
import { codeSandboxResizeCursor } from "../../code-sandbox/code-sandbox-window-geometry.ts"
import { PracticeRoundHistory } from "../../code-sandbox/components/practice-round-history.tsx"
import { useMaterialPracticeDrafts } from "../hooks/use-material-practice-drafts.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { usePracticeRetrySession } from "../../code-sandbox/hooks/use-practice-retry-session.ts"
import { PracticeRetryControls } from "../../code-sandbox/components/practice-retry-controls.tsx"
import { useMaterialPracticeBatchRetry } from "../hooks/use-material-practice-batch-retry.ts"
import { useMaterialPracticeTutor } from "../../practice-tutor/hooks/use-material-practice-tutor.ts"
import { PracticeTutorEntry } from "../../practice-tutor/components/practice-tutor-entry.tsx"
import { PracticeQuestionCopyButton } from "../../code-sandbox/components/practice-question-copy-button.tsx"
import { PracticeGradingContext } from "../../practice-grading/components/practice-grading-context.tsx"

type Props = { path: string; onClose: () => void; active?: boolean }

function isRetryQuestion(question: MaterialPracticeQuestion) {
  return (question.solve_round_number ?? 1) > 1 || question.attempts.length > 0
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function MaterialPracticeSolver({ path, onClose, active = true }: Props) {
  const [set, setSet] = useState<MaterialPracticeSet | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})
  const [hintOpen, setHintOpen] = useState(false)
  const [hintLoading, setHintLoading] = useState(false)
  const [hintError, setHintError] = useState("")
  const [hintResult, setHintResult] = useState<{ questionId: string; text: string; provider: string; model: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [clockBase, setClockBase] = useState<Record<string, number>>({})
  const pendingAttemptIds = useRef<Record<string, string>>({})
  const rootRef = useRef<HTMLDivElement | null>(null)
  const answerRef = useRef<HTMLDivElement | null>(null)
  const chrome = useCodeSandboxWindowChrome({ debugOutputVisible: false, storagePrefix: "ails_material_practice" })

  useEffect(() => {
    const controller = new AbortController()
    setSet(null)
    setError("")
    setDraftAnswers({})
    pendingAttemptIds.current = {}
    void loadMaterialPracticeSet(path, controller.signal).then(({ set: loaded }) => {
      if (controller.signal.aborted) return
      setSet(loaded)
      setSelectedId(loaded.questions.find(item => item.id === loaded.last_question_id)?.id ?? loaded.questions[0]?.id ?? "")
      const loadedAt = Date.now()
      setNow(loadedAt)
      setClockBase(Object.fromEntries(loaded.questions.map((item) => [item.id, loadedAt])))
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(errorText(reason))
    })
    return () => controller.abort()
  }, [path])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])



  const retrySession = usePracticeRetrySession(`md:${path}`, set?.questions ?? [])
  const visibleQuestions = retrySession.items
  const completedCount = visibleQuestions.filter(item => item.current_result).length
  const question = visibleQuestions.find((item) => item.id === selectedId) ?? visibleQuestions[0] ?? null
  const questionIndex = visibleQuestions.findIndex((item) => item.id === question?.id)
  const previousQuestion = questionIndex > 0 ? visibleQuestions[questionIndex - 1] : null
  const nextQuestion = questionIndex >= 0 ? visibleQuestions[questionIndex + 1] : null
  const mutation = (item: MaterialPracticeQuestion): MaterialPracticeMutation => ({
    path,
    set_id: set?.set_id ?? "",
    question_id: item.id,
    question_version: item.question_version,
    question_revision: item.question_revision,
  })
  const replaceQuestion = (updated: MaterialPracticeQuestion) => {
    if (updated.current_result) {
      for (const key of Object.keys(pendingAttemptIds.current)) {
        if (key.startsWith(`${updated.id}:${updated.question_revision}:`)) delete pendingAttemptIds.current[key]
      }
    }
    setClockBase((current) => ({ ...current, [updated.id]: Date.now() }))
    setSet((current) => current ? {
      ...current,
      completed_count: current.questions.filter((item) => (item.id === updated.id ? updated : item).current_result).length,
      questions: current.questions.map((item) => item.id === updated.id ? updated : item),
    } : current)
  }
  const drafts = useMaterialPracticeDrafts((question, savedPath) => { if (savedPath === path) replaceQuestion(question) }, setError)
  const flushDrafts = drafts.flush
  const batchRetry = useMaterialPracticeBatchRetry({ path, set, mutation, flush: drafts.flush, onError: setError,
    onUpdated: (mode, updated, ids) => {
      setSet(updated)
      setSelectedId(ids[0] ?? "")
      setClockBase(Object.fromEntries(updated.questions.map(item => [item.id, Date.now()])))
      setDraftAnswers(current => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id))))
      for (const key of Object.keys(pendingAttemptIds.current)) if (ids.some(id => key.startsWith(`${id}:`))) delete pendingAttemptIds.current[key]
      setHintOpen(false)
      setHintResult(null)
      setHintError("")
      retrySession.begin(mode, ids)
    },
  })
  const actionPending = busy || batchRetry.busy
  const closeSolver = useEventCallback(async () => {
    if (actionPending || !await drafts.flush()) return
    onClose()
  })
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-practice-grading-context-dialog]")) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        void closeSolver()
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [active, closeSolver])
  useEffect(() => {
    if (!active) void flushDrafts()
  }, [active, flushDrafts])

  const run = async (action: () => Promise<{ question: MaterialPracticeQuestion }>) => {
    setBusy(true)
    setError("")
    try {
      const result = await action()
      replaceQuestion(result.question)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const select = (item: MaterialPracticeQuestion) => {
    if (actionPending) return
    void run(async () => {
      if (!await drafts.flush()) throw new Error(t("답안을 저장하지 못했습니다."))
      const result = await selectMaterialPracticeQuestion(mutation(item))
      setSelectedId(item.id)
      setHintOpen(false)
      setHintError("")
      setHintResult(null)
      return result
    })
  }
  const elapsed = question ? question.elapsed_seconds + (question.timer_running ? Math.max(0, Math.floor((now - (clockBase[question.id] ?? now)) / 1000)) : 0) : 0
  const correctOption = question?.current_result?.answer_option_id ?? question?.answer_option_id
  const explanation = question?.current_result?.explanation ?? question?.explanation
  const subjective = question?.answer_type === "short_answer"
  const draftAnswer = question ? draftAnswers[question.id] ?? question.answer_text ?? "" : ""
  const navigationFold = usePracticeNavigationFold()
  const tutor = useMaterialPracticeTutor(question, path, draftAnswer, chrome.sidebarWidth, navigationFold.manualCollapsed ? 48 : chrome.sidebarWidth, active)
  const tutorLayout = active && tutor?.open && tutor.context?.source_kind === "summary" ? tutor.layout : null
  const collapsedNavigation = navigationFold.collapsed
  const status = question?.current_result ? "completed" : question && isRetryQuestion(question) ? "retry" : question?.selected_option_id || draftAnswer ? "in_progress" : "new"
  const grade = (item: MaterialPracticeQuestion) => {
    const answer = item.answer_type === "short_answer" ? draftAnswers[item.id] ?? item.answer_text : item.selected_option_id
    const key = `${item.id}:${item.question_revision}:${answer}`
    const attemptId = pendingAttemptIds.current[key] ?? crypto.randomUUID()
    pendingAttemptIds.current[key] = attemptId
    return run(async () => {
      if (!await drafts.flush()) throw new Error(t("답안을 저장하지 못했습니다."))
      return gradeMaterialPracticeAnswer({ ...mutation(item), attempt_id: attemptId,
      ...(item.answer_type === "short_answer" ? { answer_text: answer } : { selected_option_id: answer }),
      })
    })
  }

  usePracticeNavigation({
    enabled: active && Boolean(set?.valid),
    activeKey: question ? `${path}:${question.id}` : null,
    blocked: actionPending,
    isCode: false,
    rootRef,
    answerRef,
    onPrevious: previousQuestion ? () => select(previousQuestion) : undefined,
    onNext: nextQuestion ? () => select(nextQuestion) : undefined,
  })

  return (
    <div
      ref={rootRef}
      aria-hidden={!active}
      inert={!active}
      aria-label={t("연습문제 풀기")}
      className={`ails-practice-window ails-code-layout-border fixed z-[140] isolate flex flex-col overflow-hidden rounded-2xl border bg-[var(--practice-shell)] text-[var(--foreground)] shadow-none transition-[background-color] duration-300 ${chrome.resizeHoverDirection ? "ails-code-window-border-resize" : ""}`}
      data-ails-code-sandbox="true"
      data-ails-practice-mode="true"
      data-material-practice-solver="true"
      onClickCapture={chrome.handleWindowClickCapture}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) event.currentTarget.focus()
      }}
      onMouseDownCapture={tutorLayout ? undefined : chrome.handleWindowBorderMouseDown}
      onMouseLeave={() => {
        if (!chrome.isResizing) chrome.setResizeHoverDirection("")
      }}
      onMouseMoveCapture={tutorLayout ? undefined : chrome.handleWindowBorderMouseMove}
      role="dialog"
      style={{
        display: active ? undefined : "none",
        left: chrome.position.x,
        top: chrome.position.y,
        width: chrome.size.width,
        height: chrome.size.height,
        cursor: codeSandboxResizeCursor(chrome.resizeHoverDirection),
        ...(tutorLayout ? { left: tutorLayout.split.editor.position.x, top: tutorLayout.split.editor.position.y,
          width: tutorLayout.split.editor.size.width, height: tutorLayout.split.editor.size.height } : {}),
      }}
      tabIndex={-1}
    >
      <style>{`.ails-code-layout-border, .ails-code-layout-border-subtle { border-color: var(--practice-border) !important; }
        .ails-code-window-border-resize, .ails-code-window-border-resize * { cursor: inherit !important; }`}</style>
        <PracticeWindowHeader title={path.split(/[\\/]/).pop()} meta={set ? `${completedCount}/${visibleQuestions.length}` : undefined} onDrag={tutorLayout ? undefined : chrome.handleDragDown} onClose={() => void closeSolver()}>
          <PracticeGradingContext key={path} kind="material" path={path} rootRef={rootRef} active={active && Boolean(set?.valid)} disabled={actionPending} />
        </PracticeWindowHeader>
        {error && <p className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600" role="alert">{error}</p>}
        {!set ? !error && <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin" /></div> : !set.valid ? (
          <div className="p-6 text-sm" role="alert">
            <strong>{t("연습문제 MD 형식을 확인해 주세요.")}</strong>
            <ul className="mt-2 list-disc pl-5">{set.errors.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
        ) : (
          <>
          {question && <PracticeStudyToolbar heading={`${t("연습")} ${question.ordinal}${t("번")}`} status={status === "completed" ? t("완료") : status === "retry" ? t("재도전") : status === "in_progress" ? t("풀이 중") : t("새 문제")} statusTone={status} meta={`${question.solve_round_number ?? 1}${t("회차")} · ${completedCount}/${visibleQuestions.length} ${t("완료")}`}>
            <button aria-label={question.timer_running ? t("타이머 중지") : t("타이머 시작")} className="code-sandbox-button" disabled={actionPending || Boolean(question.current_result)} onClick={() => void run(() => updateMaterialPracticeTimer({ ...mutation(question), action: question.timer_running ? "pause" : "start" }))} type="button"><Clock3 size={12} /><span>{question.timer_running ? t("타이머 중지") : t("타이머 시작")}</span></button>
            <span className="shrink-0 font-mono text-[var(--muted-foreground)]">{elapsed}{t("초")}</span>
            <button aria-label={t("AI 힌트")} className="code-sandbox-button" disabled={hintLoading || actionPending} onClick={() => { setHintOpen(true); if (question.ai_hint?.text || hintResult?.questionId === question.id) return; setHintLoading(true); setHintError(""); void generateMaterialPracticeHint(mutation(question)).then((result) => { if (result.question) replaceQuestion(result.question); setHintResult({ questionId: question.id, text: result.hint, provider: result.provider, model: result.model }) }).catch((reason) => setHintError(errorText(reason))).finally(() => setHintLoading(false)) }} type="button"><Sparkles size={12} /><span>{t("AI 힌트")}</span></button>
            <PracticeStepButton direction="previous" disabled={!previousQuestion || actionPending} onClick={() => previousQuestion && select(previousQuestion)} />
            {question.current_result ? <button aria-label={t("다시 풀기")} className="code-sandbox-button" disabled={actionPending} onClick={() => void run(async () => { if (!await drafts.flush()) throw new Error(t("답안을 저장하지 못했습니다.")); const result = await retryMaterialPracticeQuestion(mutation(question)); setDraftAnswers(current => ({ ...current, [question.id]: "" })); setHintOpen(false); setHintResult(null); setHintError(""); return result })} type="button"><RotateCcw size={12} /><span>{t("다시 풀기")}</span></button> : <button aria-label={t("현재 문제 채점")} data-current-problem-grading-button="true" className="code-sandbox-button code-sandbox-button-accent" disabled={actionPending || !(subjective ? draftAnswer.trim() : question.selected_option_id)} onClick={() => void grade(question)} type="button">{busy ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />}<span>{busy ? t("처리 중") : t("채점")}</span></button>}
            <PracticeTutorEntry />
            <PracticeStepButton direction="next" disabled={!nextQuestion || actionPending} onClick={() => nextQuestion && select(nextQuestion)} />
          </PracticeStudyToolbar>}
          <div className="flex min-h-0 flex-1">
            <nav aria-label={t("문제 탐색")} data-practice-navigation-panel data-practice-navigation-collapsed={collapsedNavigation ? "true" : undefined} className="ails-code-sidebar-panel relative shrink-0 overflow-y-auto border-r border-[var(--practice-border)] bg-[var(--practice-sidebar)] p-2" style={{ width: collapsedNavigation ? 48 : chrome.sidebarWidth }}>
              {collapsedNavigation && <PracticeNavigationRail number={question?.ordinal} onToggle={navigationFold.toggle} />}
              <div className="mb-2 flex items-center gap-1 px-1 text-[11px] font-bold"><span className="min-w-0 flex-1 truncate">{t("문제 탐색")}</span><span className="shrink-0 text-[9px] font-medium text-[var(--muted-foreground)]">{t("총 ")}{visibleQuestions.length}{t("개")}</span><PracticeNavigationFoldButton collapsed={false} onToggle={navigationFold.toggle} /></div>
              <button type="button" className="code-sandbox-button w-full" aria-pressed={batchRetry.selecting} disabled={actionPending} data-material-selection-mode="true" onClick={batchRetry.toggleSelecting}>{batchRetry.selecting ? t("선택 완료") : t("문제 선택")}</button>
              <PracticeRetryControls total={set.questions.length} wrong={set.questions.filter(item => (item.last_solve_correct ?? item.current_result?.correct) === false).length} selected={batchRetry.selected.size} disabled={actionPending || hintLoading}
                mode={retrySession.mode} visibleCount={visibleQuestions.length} onStart={mode => void batchRetry.retry(mode)} onExit={retrySession.clear} />
              {visibleQuestions.map((item) => <div className="mb-1 flex items-center gap-1" key={item.id}>
                {batchRetry.selecting && <input type="checkbox" aria-label={t("{p0}번 문제 선택", { p0: item.ordinal })} checked={batchRetry.selected.has(item.id)} disabled={actionPending} onChange={() => batchRetry.toggle(item.id)} />}
                <PracticeNavigatorQuestionRow active={item.id === question?.id} answerType={item.answer_type === "short_answer" ? t("주관식") : t("객관식")} label={`${item.ordinal}${t("번")}`} meta="" onSelect={() => select(item)} status={item.current_result ? "completed" : isRetryQuestion(item) ? "retry" : item.selected_option_id || item.answer_text ? "in_progress" : "new"} statusLabel={item.current_result ? item.current_result.correct ? t("정답") : t("오답") : isRetryQuestion(item) ? t("재도전") : t("대기")} /></div>)}
              <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent" onMouseDown={chrome.handleSidebarResizeDown} role="separator" />
            </nav>
            {question && <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--practice-panel)] p-4 sm:p-6" key={question.id}>
              <div className="mx-auto max-w-4xl">
              <section className="mb-5 rounded-md border border-[var(--border)] bg-[var(--practice-editor)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold"><span>{t("연습")} {question.ordinal}{t("번")}</span><div className="flex min-w-0 items-center gap-2"><span className="truncate text-[10px] font-normal text-[var(--muted-foreground)]">{question.source_file}</span><PracticeQuestionCopyButton number={question.ordinal} blocks={[{ kind: "text", text: question.question }]} choices={subjective ? [] : question.options.map(option => option.text)} /></div></div>
                <h2 className="whitespace-pre-wrap text-[13px] leading-6">{question.question}</h2>
              </section>
              <div ref={answerRef}>
              {subjective ? <div className="space-y-2">
                <label className="block text-xs font-semibold" htmlFor={`practice-answer-${question.id}`}>{t("주관식 답안")}</label>
                <textarea id={`practice-answer-${question.id}`} className="min-h-40 w-full rounded border border-[var(--border)] bg-[var(--practice-editor)] p-3 text-sm" value={draftAnswer} maxLength={20000} disabled={actionPending || Boolean(question.current_result)} onBlur={() => void drafts.flush()} onChange={(event) => { const answer = event.target.value; setDraftAnswers((current) => ({ ...current, [question.id]: answer })); drafts.stage({ ...mutation(question), answer_text: answer }) }} />
                <button className="code-sandbox-button" disabled={actionPending || Boolean(question.current_result)} onClick={() => void drafts.flush()} type="button">{t("답안 저장")}</button>
                <p className="text-xs text-[var(--muted-foreground)]" role="status">{drafts.saving ? t("저장 중") : t("자동 저장")} · {t("모범 답안과 일치하면 바로 채점하고, 표현이 다르면 AI로 평가합니다.")}</p>
              </div> : <PracticeMultipleChoice
                choices={question.options.map((option) => option.text)}
                disabled={actionPending || Boolean(question.current_result)}
                onSelect={(index) => void run(() => saveMaterialPracticeAnswer({ ...mutation(question), selected_option_id: question.options[index].id }))}
                selectedIndex={question.options.findIndex((option) => option.id === question.selected_option_id)}
              />}
              </div>
              {question.current_result && <div className="mt-5"><PracticeFeedbackPanel grade={{ correct: question.current_result.correct, verdict: question.current_result.correct ? "correct" : "incorrect", feedback: subjective ? `${question.current_result.feedback ?? ""}\n${t("모범 답안")}: ${question.reference_answer ?? ""}\n${explanation ?? ""}` : `${t("정답")}: ${question.options.find((option) => option.id === correctOption)?.text ?? correctOption}\n${explanation ?? ""}` }} mistakeNote={null} theory={[]} /></div>}
              {question.current_result && <div className="mt-3"><PracticeTutorEntry question /></div>}
              <div className="mt-4 flex justify-end"><PracticeRoundHistory key={`${path}:${question.id}:${question.question_revision}:${question.current_result?.id ?? ""}`} count={question.solve_history_count ?? question.attempts.length} load={() => loadMaterialPracticeHistory(mutation(question))} /></div>
              {hintOpen && <div className="mt-4"><PracticeHintPanel error={hintError} hint={question.ai_hint ?? (hintResult?.questionId === question.id ? hintResult : null)} loading={hintLoading} onClose={() => setHintOpen(false)} /></div>}
              </div>
            </main>}
          </div>
          </>
        )}
    </div>
  )
}
