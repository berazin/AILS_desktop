import { IDE_ENABLED, IDE_DISABLED_MESSAGE } from "../../../lib/ide-policy.ts"
import { t } from "../../../lib/i18n.ts"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { startBackgroundProblemBatch, useProblemBatchGrading } from "./use-problem-batch-grading.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import {
  generatePdfProblemHint,
  gradePdfProblem,
  recordPdfProblemHint,
  getPdfProblemMultimodalReviewQueue,
  resolvePdfProblemMultimodalReviewQueueItem,
  savePdfProblemAnswer,
  startPdfProblemTimer,
  stopPdfProblemTimer,
  updatePdfProblem,
  updatePdfProblemAnswerType,
  type PdfProblem,
  type PdfProblemAnswerType,
  type PdfProblemGradeResult,
  type PdfProblemHint,
  type PdfProblemReviewQueueItem,
  type PdfProblemReviewSelectionSource,
} from "../../../lib/api"
import { type ProblemEditDialogState } from "../components/problem-edit-dialog.tsx"
import { usePdfPracticeRetry } from "./use-pdf-practice-retry.ts"
import { type ReviewQueueEditorState } from "../components/problem-review-queue-dialog.tsx"
import { normalizeProjectPath } from "../lib/code-project-browser.ts"
import { separatePracticeQuestionContent } from "../lib/practice-question-display.ts"
import {
  pdfProblemAnswerInputType,
  pdfProblemAnswerType,
  pdfProblemBinaryAnswerComplete,
  pdfProblemBinaryAnswerSelections,
  pdfProblemBinaryPrompt,
  pdfProblemNeedsGrading,
  updatePdfProblemBinaryAnswer,
} from "../../../lib/problem-study.ts"
import {
  codeProjectLoadScope,
  consoleErrorMessage,
  createProblemGradingAttemptId,
  isProblemMetadataFile,
  problemAnswerSignature,
  projectPathForPdfProblem,
  reviewQueueCandidateContent,
  sandboxSourceSignature,
  type ConsoleStatus,
  type SandboxFile,
} from "../lib/code-sandbox-support.ts"

interface CodePracticeActionsContext {
  onRetrySessionStart: (mode: import("../../../lib/api").PracticeRetryMode, ids: string[]) => void
  pdfPath: string
  problemStorageBaseDir: string
  problemReviewQueueRefreshKey: string
  activeProblem: PdfProblem | null
  activeProblemAnswerInputType: PdfProblemAnswerType | null
  activeProblemScope: string
  practiceProblems: PdfProblem[]
  navigatorChapters: import("../../../lib/problem-study.ts").PdfProblemNavigatorChapter[]
  activeFileRef: React.RefObject<SandboxFile | undefined>
  activeFile: SandboxFile | undefined
  activeProblemDataScope: string
  practiceWindow: boolean
  setSidebarMode: React.Dispatch<React.SetStateAction<"problems" | "code">>
  activeProblemDataScopeRef: React.RefObject<string>
  onProblemChange: ((problem: PdfProblem) => void) | undefined
  activeProblemScopeRef: React.RefObject<string>
  setPracticeProblemId: React.Dispatch<React.SetStateAction<string>>
  onSelectProblem: ((problem: PdfProblem) => void) | undefined
  onOpenPdfPage: ((page: number) => void) | undefined
  onOpenPdfTheoryPage: ((page: number, problem?: PdfProblem) => void) | undefined
  activeProblemAnswerType: PdfProblemAnswerType | null
  activeProblemBinaryPrompt: import("../../../lib/problem-study.ts").PdfProblemBinaryPrompt | null
  files: SandboxFile[]
  lastProblemRunRef: React.RefObject<{ signature: string; action: "run" | "build" | "test"; success: boolean | null; returncode: number | null; stdout: string; stderr: string; status: ConsoleStatus; } | null>
  hasConsistentProblemContext: boolean
  projectName: string
  loadedProjectScopeRef: React.RefObject<string>
}

/** Owns problem answer, timer, review-queue, grading and hint transitions.
 * Project loading and editor/console lifetimes remain with their existing hooks. */
export function useCodePracticeActions(context: CodePracticeActionsContext) {
  const {
    onRetrySessionStart,
    pdfPath,
    problemStorageBaseDir,
    problemReviewQueueRefreshKey,
    activeProblem,
    activeProblemAnswerInputType,
    activeProblemScope,
    practiceProblems,
    navigatorChapters,
    activeFileRef,
    activeFile,
    activeProblemDataScope,
    practiceWindow,
    setSidebarMode,
    activeProblemDataScopeRef,
    onProblemChange,
    activeProblemScopeRef,
    setPracticeProblemId,
    onSelectProblem,
    onOpenPdfPage,
    onOpenPdfTheoryPage,
    activeProblemAnswerType,
    activeProblemBinaryPrompt,
    files,
    lastProblemRunRef,
    hasConsistentProblemContext,
    projectName,
    loadedProjectScopeRef,
  } = context

  const publishProblem = useEventCallback((problem: PdfProblem) => {
    if (activeProblem?.id === problem.id && (activeProblem.solve_round_number ?? 1) > (problem.solve_round_number ?? 1)) return
    onProblemChange?.(problem)
  })

  const problemTimerActionSeqRef = useRef(0)

  const problemGradeActionSeqRef = useRef(0)

  const problemHintActionSeqRef = useRef(0)

  const problemTypeActionSeqRef = useRef(0)

  const problemEditActionSeqRef = useRef(0)

  const [problemClockNow, setProblemClockNow] = useState(Date.now)

  const [isProblemTimerUpdating, setIsProblemTimerUpdating] = useState(false)

  const [isProblemGrading, setIsProblemGrading] = useState(false)

  const [problemGradeResult, setProblemGradeResult] = useState<PdfProblemGradeResult | null>(null)

  const [problemActionError, setProblemActionError] = useState("")

  const [problemHintResult, setProblemHintResult] = useState<{
    scope: string
    hint: PdfProblemHint
  } | null>(null)

  const [problemHintError, setProblemHintError] = useState("")

  const [isProblemHintLoading, setIsProblemHintLoading] = useState(false)

  const [isProblemHintVisible, setIsProblemHintVisible] = useState(false)

  const [problemAnswerText, setProblemAnswerText] = useState("")

  const [problemSelectedChoice, setProblemSelectedChoice] = useState<number | null>(null)

  const [isProblemAnswerSaving, setIsProblemAnswerSaving] = useState(false)

  const [problemAnswerSavedSignature, setProblemAnswerSavedSignature] = useState(
    () => problemAnswerSignature("", null),
  )

  const [isProblemTypeUpdating, setIsProblemTypeUpdating] = useState(false)

  const [isProblemTypeMenuOpen, setIsProblemTypeMenuOpen] = useState(false)

  const [problemReviewQueue, setProblemReviewQueue] = useState<PdfProblemReviewQueueItem[]>([])

  const [isProblemReviewQueueOpen, setIsProblemReviewQueueOpen] = useState(false)

  const [reviewQueueEditor, setReviewQueueEditor] = useState<ReviewQueueEditorState | null>(null)

  const [isReviewQueueSaving, setIsReviewQueueSaving] = useState(false)

  useEffect(() => {
    setProblemReviewQueue([])
    setReviewQueueEditor(null)
    setIsProblemReviewQueueOpen(false)
    if (!pdfPath || !problemStorageBaseDir) {
      return
    }
    const controller = new AbortController()
    void getPdfProblemMultimodalReviewQueue(pdfPath, problemStorageBaseDir, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setProblemReviewQueue(result.items)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setProblemActionError(consoleErrorMessage(error, t("문제 검토 대기열을 불러오지 못했습니다.")))
        }
      })
    return () => controller.abort()
  }, [pdfPath, problemStorageBaseDir, problemReviewQueueRefreshKey])

  const [isProblemEditing, setIsProblemEditing] = useState(false)

  const [problemEditDialog, setProblemEditDialog] = useState<ProblemEditDialogState | null>(null)

  const problemTypeMenuRef = useRef<HTMLDivElement | null>(null)

  const problemAnswerEditorRef = useRef<HTMLElement | null>(null)

  const [expandedPracticeChapters, setExpandedPracticeChapters] = useState<Set<string>>(() => new Set())

  const [isPracticeSelectionMode, setIsPracticeSelectionMode] = useState(false)

  const [selectedPracticeProblemIds, setSelectedPracticeProblemIds] = useState<Set<string>>(() => new Set())

  const [problemBatchDialogIds, setProblemBatchDialogIds] = useState<string[] | null>(null)

  const backgroundBatches = useProblemBatchGrading()
  const deliveredBatchResultsRef = useRef(new Set<string>())


  const problemAnswerAutosaveTimerRef = useRef<number | null>(null)

  const problemAnswerSaveQueueRef = useRef<Promise<void>>(Promise.resolve())

  const problemAnswerSaveSeqRef = useRef(0)

  const problemActionLockSeqRef = useRef(0)

  const problemActionLockRef = useRef<{
    kind: "timer" | "type" | "grade" | "review" | "edit"
    scope: string
    token: number
  } | null>(null)

  const { retryActiveProblem, retryProblems, isProblemRetrying } = usePdfPracticeRetry({
    problem: activeProblem, pdfPath, baseDir: problemStorageBaseDir,
    scope: activeProblemScope, scopeRef: activeProblemScopeRef, actionLock: problemActionLockRef,
    flushAnswer: flushActiveProblemAnswerSave,
    answerDirty: activeProblemAnswerInputType !== "code" && problemAnswerSignature(problemAnswerText, problemSelectedChoice) !== problemAnswerSavedSignature,
    files, projectName, loadedProjectScopeRef, onChange: onProblemChange, onError: setProblemActionError,
    problems: practiceProblems, selectedIds: selectedPracticeProblemIds,
    dataScope: activeProblemDataScope, dataScopeRef: activeProblemDataScopeRef,
    onBatchChange: (mode, updated, ids) => {
      onRetrySessionStart(mode, ids)
      setIsPracticeSelectionMode(false)
      setSelectedPracticeProblemIds(new Set())
      setProblemBatchDialogIds(null)
      setProblemGradeResult(null)
      setIsProblemHintVisible(false)
      setProblemHintResult(null)
      const first = updated.find(problem => problem.id === ids[0])
      if (first) {
        setPracticeProblemId(first.id)
        setSidebarMode("problems")
        onSelectProblem?.(first)
        onOpenPdfPage?.(first.page)
      }
    },
  })

  const isProblemActionPending = isProblemRetrying ||
    isProblemTimerUpdating
    || isProblemGrading
    || isProblemTypeUpdating
    || isProblemEditing

  const pendingReviewQueueCount = problemReviewQueue.filter(
    (item) => item.status === "needs_user_review",
  ).length

  const currentProblemAnswerSignature = problemAnswerSignature(problemAnswerText, problemSelectedChoice)

  const activeProblemBinarySelections = pdfProblemBinaryAnswerSelections(problemAnswerText)

  const problemAnswerIsDirty = Boolean(
    activeProblem
    && activeProblemAnswerInputType !== "code"
    && activeProblemAnswerInputType !== "unknown"
    && currentProblemAnswerSignature !== problemAnswerSavedSignature
  )

  const displayedProblemGrade = problemGradeResult ?? activeProblem?.last_grading ?? null

  const activeProblemNeedsFreshGrade = Boolean(
    activeProblem
    && activeProblemAnswerInputType !== "code"
    && batchProblemNeedsGrading(activeProblem),
  )

  const currentProblemFeedbackGrade = problemGradeResult
    ?? (activeProblemNeedsFreshGrade ? null : activeProblem?.last_grading ?? null)

  const previousProblemFeedbackGrade = !problemGradeResult && activeProblemNeedsFreshGrade
    ? activeProblem?.last_grading ?? null
    : null

  const activeProblemHint = problemHintResult?.scope === activeProblemScope
    ? problemHintResult.hint
    : activeProblem?.ai_hint ?? null

  const displayedTheory = problemGradeResult?.related_theory?.length
    ? problemGradeResult.related_theory
    : activeProblem?.related_theory ?? activeProblem?.last_grading?.related_theory ?? []

  const latestMistakeNote = activeProblem?.mistake_notes?.length
    ? activeProblem.mistake_notes[activeProblem.mistake_notes.length - 1]
    : null

  const activeChapterProblems = useMemo(
    () => activeProblem
      ? navigatorChapters.flatMap(chapter => chapter.sections.flatMap(section => section.problems)).filter((problem) => problem.chapter === activeProblem.chapter)
      : [],
    [activeProblem, navigatorChapters],
  )

  const practiceProblemSequence = useMemo(
    () => navigatorChapters.flatMap((chapter) => chapter.sections.flatMap((section) => section.problems)),
    [navigatorChapters],
  )

  const activeProblemSequenceIndex = activeProblem
    ? practiceProblemSequence.findIndex((problem) => problem.id === activeProblem.id)
    : -1

  const previousPracticeProblem = activeProblemSequenceIndex > 0
    ? practiceProblemSequence[activeProblemSequenceIndex - 1]
    : null

  const nextPracticeProblem = activeProblemSequenceIndex >= 0
    && activeProblemSequenceIndex < practiceProblemSequence.length - 1
    ? practiceProblemSequence[activeProblemSequenceIndex + 1]
    : null

  const batchDialogProblems = useMemo(
    () => (problemBatchDialogIds ?? [])
      .map((id) => practiceProblems.find((problem) => problem.id === id))
      .filter((problem): problem is PdfProblem => Boolean(problem)),
    [practiceProblems, problemBatchDialogIds],
  )

  const batchDialogChangedCount = batchDialogProblems.filter((problem) => batchProblemNeedsGrading(problem)).length

  const batchDialogAnsweredCount = batchDialogProblems.filter((problem) => batchProblemHasAnswer(problem)).length

  useEffect(() => {
    const pathKey = (path: string) => normalizeProjectPath(path).toLowerCase()
    for (const batch of backgroundBatches) {
      if (pathKey(batch.pdfPath) !== pathKey(pdfPath) || pathKey(batch.baseDir) !== pathKey(problemStorageBaseDir)) continue
      for (const item of batch.results) {
        const result = item.result
        if (!result || item.error || result.application_status === "stale") continue
        const current = practiceProblems.find(problem => problem.id === item.problem_id)
        const key = `${batch.id}:${item.problem_id}`
        if (!current || deliveredBatchResultsRef.current.has(key)) continue
        deliveredBatchResultsRef.current.add(key)
        if (Number(current.grading_revision ?? 0) > Number(result.problem.grading_revision ?? 0)) continue
        if (Date.parse(current.updated_at ?? "") > Date.parse(result.problem.updated_at ?? "")) continue
        publishProblem(result.problem)
      }
    }
  }, [backgroundBatches, pdfPath, problemStorageBaseDir, practiceProblems, publishProblem])

  const loadActiveProblemDraft = useEventCallback(() => {
    const answerText = activeProblem?.draft_answer?.answer_text ?? ""
    const selectedChoice = Number.isInteger(activeProblem?.draft_answer?.selected_choice)
      ? Number(activeProblem?.draft_answer?.selected_choice)
      : null
    setProblemAnswerText(answerText)
    setProblemSelectedChoice(selectedChoice)
    setProblemAnswerSavedSignature(problemAnswerSignature(answerText, selectedChoice))
  })

  const scheduleActiveProblemAnswerAutosave = useEventCallback(() => {
    clearProblemAnswerAutosaveTimer()
    if (!problemAnswerIsDirty || !activeProblem || !pdfPath) return
    problemAnswerAutosaveTimerRef.current = window.setTimeout(() => {
      problemAnswerAutosaveTimerRef.current = null
      void queueActiveProblemAnswerSave({
        problem: activeProblem,
        answerText: problemAnswerText,
        selectedChoice: problemSelectedChoice,
        quiet: true,
      })
    }, 800)
  })

  useEffect(() => {
    activeFileRef.current = activeFile
  }, [activeFile, activeFileRef])

  useEffect(() => {
    clearProblemAnswerAutosaveTimer()
    problemAnswerSaveSeqRef.current += 1
    setExpandedPracticeChapters(new Set())
    setIsPracticeSelectionMode(false)
    setSelectedPracticeProblemIds(new Set())
    setProblemBatchDialogIds(null)
    setIsProblemTypeMenuOpen(false)
  }, [activeProblemDataScope])

  useEffect(() => {
    setSidebarMode(practiceWindow && pdfPath ? "problems" : "code")
  }, [pdfPath, practiceWindow, setSidebarMode])

  useEffect(() => {
    clearProblemAnswerAutosaveTimer()
    loadActiveProblemDraft()
    setIsProblemTypeMenuOpen(false)
  }, [activeProblem?.id, activeProblem?.solve_round_id, loadActiveProblemDraft])

  useEffect(() => {
    scheduleActiveProblemAnswerAutosave()
    return clearProblemAnswerAutosaveTimer
  }, [
    activeProblem?.id,
    activeProblemAnswerInputType,
    currentProblemAnswerSignature,
    pdfPath,
    problemAnswerIsDirty,
    problemStorageBaseDir,
    scheduleActiveProblemAnswerAutosave,
  ])

  useEffect(() => {
    problemActionLockRef.current = null
    problemTimerActionSeqRef.current += 1
    problemGradeActionSeqRef.current += 1
    problemHintActionSeqRef.current += 1
    problemTypeActionSeqRef.current += 1
    problemEditActionSeqRef.current += 1
    setIsProblemTimerUpdating(false)
    setIsProblemGrading(false)
    setIsProblemAnswerSaving(false)
    setIsProblemHintLoading(false)
    setIsProblemHintVisible(false)
    setIsProblemTypeUpdating(false)
    setIsProblemEditing(false)
    setIsProblemTypeMenuOpen(false)
    setProblemGradeResult(null)
    setProblemActionError("")
    setProblemHintResult(null)
    setProblemHintError("")
  }, [activeProblemScope, activeFileRef])

  function beginProblemAction(kind: "timer" | "type" | "grade" | "review" | "edit") {
    if (problemActionLockRef.current) return null
    const action = {
      kind,
      scope: activeProblemScope,
      token: ++problemActionLockSeqRef.current,
    }
    problemActionLockRef.current = action
    return action
  }

  function releaseProblemAction(action: { token: number }) {
    if (problemActionLockRef.current?.token === action.token) {
      problemActionLockRef.current = null
    }
  }

  async function toggleActiveProblemTimer() {
    if (!activeProblem || !pdfPath) return
    const action = beginProblemAction("timer")
    if (!action) return
    const problem = activeProblem
    const requestDataScope = activeProblemDataScope
    const requestScope = activeProblemScope
    const requestSeq = ++problemTimerActionSeqRef.current
    setIsProblemTimerUpdating(true)
    setProblemActionError("")
    try {
      const payload = {
        pdf_path: pdfPath,
        base_dir: problemStorageBaseDir,
        problem_id: problem.id,
        solve_round_id: problem.solve_round_id,
      }
      const result = problem.timer_started_at
        ? await stopPdfProblemTimer(payload)
        : await startPdfProblemTimer(payload)
      if (activeProblemDataScopeRef.current === requestDataScope) publishProblem(result.problem)
      if (activeProblemScopeRef.current !== requestScope || problemTimerActionSeqRef.current !== requestSeq) return
      setProblemClockNow(Date.now())
    } catch (error) {
      if (activeProblemScopeRef.current !== requestScope || problemTimerActionSeqRef.current !== requestSeq) return
      setProblemActionError(consoleErrorMessage(error, t("타이머 상태를 변경하지 못했습니다.")))
    } finally {
      if (activeProblemScopeRef.current === requestScope && problemTimerActionSeqRef.current === requestSeq) {
        setIsProblemTimerUpdating(false)
      }
      releaseProblemAction(action)
    }
  }

  async function selectPracticeProblem(problem: PdfProblem) {
    if (problemActionLockRef.current) return
    if (problemAnswerIsDirty && !await flushActiveProblemAnswerSave()) return
    setPracticeProblemId(problem.id)
    setSidebarMode("problems")
    onSelectProblem?.(problem)
    onOpenPdfPage?.(problem.page)
  }

  function openPracticeTheoryPage(page: number) {
    if (onOpenPdfTheoryPage) {
      onOpenPdfTheoryPage(page, activeProblem ?? undefined)
      return
    }
    onOpenPdfPage?.(page)
  }

  function openActiveProblemAnswerEditor() {
    if (isProblemActionPending || problemActionLockRef.current) return
    if (activeProblemAnswerType === "code") {
      if (!IDE_ENABLED) { setProblemActionError(IDE_DISABLED_MESSAGE); return }
      setSidebarMode("code")
      return
    }
    setSidebarMode("problems")
    window.requestAnimationFrame(() => {
      const editor = problemAnswerEditorRef.current
      editor?.scrollIntoView({ behavior: "smooth", block: "start" })
      editor?.querySelector<HTMLElement>("textarea, button:not(:disabled)")?.focus({ preventScroll: true })
    })
  }

  function openProblemEditor(
    problem: PdfProblem,
    options?: {
      source?: "user" | "ai"
      proposal?: {
        problem_text: string
        number: number
        page: number
        page_end: number
        answer_type: PdfProblemAnswerType
        choices: string[]
        reason: string
        changed: boolean
      }
      provider?: string
      model?: string
    },
  ) {
    if (isProblemActionPending || problemActionLockRef.current) return
    const proposal = options?.proposal
    const answerType = proposal?.answer_type ?? pdfProblemAnswerType(problem)
    const choices = proposal?.choices ?? problem.choices ?? []
    const originalText = proposal?.problem_text ?? problem.problem_text ?? ""
    const content = answerType === "multiple_choice"
      ? separatePracticeQuestionContent(originalText, choices, problem.code_positions ?? undefined)
      : { problemText: originalText, codePositions: undefined }
    setProblemActionError("")
    setProblemEditDialog({
      problemId: problem.id,
      source: options?.source ?? "user",
      problemText: content.problemText,
      number: String(proposal?.number ?? problem.number),
      page: String(proposal?.page ?? problem.page),
      pageEnd: String(proposal?.page_end ?? problem.page_end ?? problem.page),
      answerType,
      choicesText: choices.join("\n"),
      codePositions: content.codePositions,
      originalContent: answerType === "multiple_choice" ? {
        problemText: originalText,
        editorText: content.problemText,
        choices: [...choices],
        codePositions: problem.code_positions ?? undefined,
      } : undefined,
      reason: proposal?.reason ?? "",
      provider: options?.provider ?? "",
      model: options?.model ?? "",
      aiChanged: proposal ? proposal.changed : null,
    })
  }

  function selectReviewQueueCandidate(
    item: PdfProblemReviewQueueItem,
    selectedSource: PdfProblemReviewSelectionSource,
  ) {
    const content = (
      item.status === "resolved"
      && item.selected_source === selectedSource
      && item.final_content
    ) ? item.final_content : reviewQueueCandidateContent(item, selectedSource)
    setProblemActionError("")
    setReviewQueueEditor({
      item,
      selectedSource,
      problemText: content.problem_text,
      choices: [...content.choices],
      codeBlocks: [...content.code],
      codePositions: [...(content.code_positions ?? content.code.map(() => content.problem_text.length))],
      answerType: content.answer_type,
    })
  }

  async function saveReviewQueueResolution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reviewQueueEditor || !pdfPath || isReviewQueueSaving) return
    const problemText = reviewQueueEditor.problemText.trim()
    if (!problemText) {
      setProblemActionError(t("문제 본문을 입력해 주세요."))
      return
    }
    setIsReviewQueueSaving(true)
    setProblemActionError("")
    try {
      const result = await resolvePdfProblemMultimodalReviewQueueItem({
        pdf_path: pdfPath,
        base_dir: problemStorageBaseDir,
        problem_id: reviewQueueEditor.item.problem_id,
        selected_source: reviewQueueEditor.selectedSource,
        final_content: {
          problem_text: problemText,
          choices: reviewQueueEditor.choices.map((choice) => choice.trim()).filter(Boolean),
          // Always send array. [] means user deliberately saved no code box.
          code: [...reviewQueueEditor.codeBlocks],
          code_positions: [...reviewQueueEditor.codePositions],
          answer_type: reviewQueueEditor.answerType,
        },
      })
      publishProblem(result.problem)
      setProblemReviewQueue((items) => items.map((item) => (
        item.problem_id === result.item.problem_id ? result.item : item
      )))
      setReviewQueueEditor({
        item: result.item,
        selectedSource: result.item.selected_source ?? reviewQueueEditor.selectedSource,
        problemText: result.item.final_content?.problem_text ?? result.problem.problem_text ?? "",
        choices: [...(result.item.final_content?.choices ?? result.problem.choices ?? [])],
        codeBlocks: [...(result.item.final_content?.code ?? result.problem.code ?? [])],
        codePositions: [...(result.item.final_content?.code_positions ?? result.problem.code_positions ?? [])],
        answerType: result.item.final_content?.answer_type ?? pdfProblemAnswerType(result.problem),
      })
    } catch (error) {
      setProblemActionError(consoleErrorMessage(error, t("검토 결과를 저장하지 못했습니다.")))
    } finally {
      setIsReviewQueueSaving(false)
    }
  }

  async function saveProblemEdits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!problemEditDialog || !pdfPath) return
    const action = beginProblemAction("edit")
    if (!action) return
    const dialog = problemEditDialog
    const requestDataScope = activeProblemDataScope
    const requestSeq = ++problemEditActionSeqRef.current
    const number = Number(dialog.number)
    const page = Number(dialog.page)
    const pageEnd = Number(dialog.pageEnd)
    if (
      !dialog.problemText.trim()
      || !Number.isInteger(number)
      || number < 1
      || !Number.isInteger(page)
      || page < 1
      || !Number.isInteger(pageEnd)
      || pageEnd < page
    ) {
      setProblemActionError(t("문제 본문, 번호와 페이지 범위를 확인해 주세요."))
      releaseProblemAction(action)
      return
    }
    setIsProblemEditing(true)
    setProblemActionError("")
    try {
      await flushActiveProblemAnswerSave()
      const original = dialog.originalContent
      const choices = dialog.answerType === "multiple_choice"
        ? original && dialog.choicesText === original.choices.join("\n")
          ? [...original.choices]
          : dialog.choicesText.split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean)
        : []
      // Opening the separated editor and saving without changes must not rewrite
      // old grading evidence merely to normalize how the same content is stored.
      const unchangedContent = original && dialog.answerType === "multiple_choice"
        && dialog.problemText.trim() === original.editorText.trim()
        && choices.length === original.choices.length
        && choices.every((choice, index) => choice === original.choices[index])
      const result = await updatePdfProblem({
        pdf_path: pdfPath,
        base_dir: problemStorageBaseDir,
        problem_id: dialog.problemId,
        problem_text: unchangedContent ? original.problemText : dialog.problemText.trim(),
        number,
        page,
        page_end: pageEnd,
        answer_type: dialog.answerType,
        choices,
        code_positions: unchangedContent ? original.codePositions : dialog.codePositions,
        edit_source: dialog.source,
      })
      if (
        activeProblemDataScopeRef.current === requestDataScope
        && problemEditActionSeqRef.current === requestSeq
      ) {
        publishProblem(result.problem)
      }
      if (problemEditActionSeqRef.current !== requestSeq) return
      setProblemEditDialog(null)
      if (activeProblem?.id === result.problem.id) {
        onOpenPdfPage?.(result.problem.page)
      }
    } catch (error) {
      if (problemEditActionSeqRef.current !== requestSeq) return
      setProblemActionError(consoleErrorMessage(error, t("문제 수정 내용을 저장하지 못했습니다.")))
    } finally {
      if (problemEditActionSeqRef.current === requestSeq) {
        setIsProblemEditing(false)
      }
      releaseProblemAction(action)
    }
  }

  async function changeActiveProblemAnswerType(answerType: PdfProblemAnswerType) {
    if (!activeProblem || !pdfPath) return
    const action = beginProblemAction("type")
    if (!action) return
    const problem = activeProblem
    const requestDataScope = activeProblemDataScope
    const requestScope = activeProblemScope
    const requestSeq = ++problemTypeActionSeqRef.current
    setIsProblemTypeUpdating(true)
    setIsProblemTypeMenuOpen(false)
    setProblemActionError("")
    try {
      await flushActiveProblemAnswerSave()
      const result = await updatePdfProblemAnswerType({
        pdf_path: pdfPath,
        base_dir: problemStorageBaseDir,
        problem_id: problem.id,
        solve_round_id: problem.solve_round_id,
        answer_type: answerType,
      })
      if (
        activeProblemDataScopeRef.current === requestDataScope
        && problemTypeActionSeqRef.current === requestSeq
      ) publishProblem(result.problem)
      if (activeProblemScopeRef.current !== requestScope || problemTypeActionSeqRef.current !== requestSeq) return
      setSidebarMode("problems")
      if (answerType !== "multiple_choice") setProblemSelectedChoice(null)
      if (answerType === "code") setProblemAnswerText("")
    } catch (error) {
      if (activeProblemScopeRef.current !== requestScope || problemTypeActionSeqRef.current !== requestSeq) return
      setProblemActionError(consoleErrorMessage(error, t("문제 유형을 변경하지 못했습니다.")))
    } finally {
      if (activeProblemScopeRef.current === requestScope && problemTypeActionSeqRef.current === requestSeq) {
        setIsProblemTypeUpdating(false)
      }
      releaseProblemAction(action)
    }
  }

  function clearProblemAnswerAutosaveTimer() {
    if (problemAnswerAutosaveTimerRef.current === null) return
    window.clearTimeout(problemAnswerAutosaveTimerRef.current)
    problemAnswerAutosaveTimerRef.current = null
  }

  function queueActiveProblemAnswerSave({
    problem,
    answerText,
    selectedChoice,
    quiet = false,
  }: {
    problem: PdfProblem
    answerText: string
    selectedChoice: number | null
    quiet?: boolean
  }) {
    const answerType = pdfProblemAnswerType(problem)
    if (!pdfPath || answerType === "code" || answerType === "unknown") {
      return Promise.resolve<PdfProblem | null>(null)
    }
    const requestDataScope = activeProblemDataScope
    const requestScope = activeProblemScope
    const requestSeq = ++problemAnswerSaveSeqRef.current
    const signature = problemAnswerSignature(answerText, selectedChoice)
    setIsProblemAnswerSaving(true)
    if (!quiet) setProblemActionError("")

    const request = problemAnswerSaveQueueRef.current.then(async () => {
      try {
        const result = await savePdfProblemAnswer({
          pdf_path: pdfPath,
          base_dir: problemStorageBaseDir,
          problem_id: problem.id,
        solve_round_id: problem.solve_round_id,
          answer_text: answerText,
          selected_choice: selectedChoice,
        })
        if (activeProblemDataScopeRef.current === requestDataScope) publishProblem(result.problem)
        if (activeProblemScopeRef.current === requestScope) {
          setProblemAnswerSavedSignature(signature)
        }
        return result.problem
      } catch (error) {
        if (
          activeProblemScopeRef.current === requestScope
          && problemAnswerSaveSeqRef.current === requestSeq
        ) {
          setProblemActionError(consoleErrorMessage(error, t("답안을 자동 저장하지 못했습니다.")))
        }
        return null
      } finally {
        if (problemAnswerSaveSeqRef.current === requestSeq) {
          setIsProblemAnswerSaving(false)
        }
      }
    })
    problemAnswerSaveQueueRef.current = request.then(() => undefined, () => undefined)
    return request
  }

  function flushActiveProblemAnswerSave() {
    clearProblemAnswerAutosaveTimer()
    if (!activeProblem || !problemAnswerIsDirty) return problemAnswerSaveQueueRef.current.then(() => activeProblem)
    return queueActiveProblemAnswerSave({
      problem: activeProblem,
      answerText: problemAnswerText,
      selectedChoice: problemSelectedChoice,
      quiet: true,
    })
  }

  function selectActiveProblemBinaryAnswer(itemNumber: string, selection: string) {
    if (!activeProblemBinaryPrompt) return
    setProblemAnswerText((current) => updatePdfProblemBinaryAnswer(
      activeProblemBinaryPrompt,
      current,
      itemNumber,
      selection,
    ))
    setProblemGradeResult(null)
    setProblemActionError("")
  }

  function togglePracticeProblemSelection(problemIds: string[], selected?: boolean) {
    setSelectedPracticeProblemIds((current) => {
      const next = new Set(current)
      const shouldSelect = selected ?? problemIds.some((id) => !next.has(id))
      for (const id of problemIds) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function activeDraftForProblem(problem: PdfProblem) {
    if (problem.id !== activeProblem?.id) return problem.draft_answer ?? {}
    return {
      answer_text: problemAnswerText,
      selected_choice: problemSelectedChoice,
    }
  }

  function batchProblemHasAnswer(problem: PdfProblem) {
    const answerType = pdfProblemAnswerInputType(problem)
    const draft = activeDraftForProblem(problem)
    if (answerType === "multiple_choice") return Number.isInteger(draft.selected_choice)
    if (answerType === "short_answer" || answerType === "ox") {
      const binaryPrompt = pdfProblemBinaryPrompt(problem.problem_text, answerType === "ox")
      return binaryPrompt
        ? pdfProblemBinaryAnswerComplete(binaryPrompt, draft.answer_text)
        : Boolean(String(draft.answer_text || "").trim())
    }
    if (answerType === "code") {
      if (problem.id === activeProblem?.id) {
        return files.some((file) => !isProblemMetadataFile(file.name) && Boolean(file.code.trim()))
      }
      return Boolean(problem.folder_path)
    }
    return false
  }

  function batchProblemNeedsGrading(problem: PdfProblem) {
    if (pdfProblemAnswerInputType(problem) === "code") {
      return batchProblemHasAnswer(problem)
    }
    if (problem.id !== activeProblem?.id) {
      return pdfProblemNeedsGrading(problem)
    }
    const persisted = problem.draft_answer ?? {}
    if (
      String(persisted.answer_text || "") !== problemAnswerText
      || (persisted.selected_choice ?? null) !== problemSelectedChoice
    ) return true
    return pdfProblemNeedsGrading(problem)
  }

  function openProblemBatchDialog(problemIds: Iterable<string>) {
    const available = new Set(practiceProblems.map((problem) => problem.id))
    const ids = [...new Set(problemIds)].filter((id) => available.has(id))
    if (!ids.length) {
      setProblemActionError(t("채점할 문제를 선택해 주세요."))
      return
    }
    setProblemActionError("")
    setProblemBatchDialogIds(ids)
  }

  async function startProblemBatchGrading(mode: "changed" | "all") {
    const requested = (problemBatchDialogIds ?? [])
      .map(id => practiceProblems.find(problem => problem.id === id))
      .filter((problem): problem is PdfProblem => Boolean(problem))
    const targets = mode === "changed" ? requested.filter(batchProblemNeedsGrading) : requested
    setProblemBatchDialogIds(null)
    setIsPracticeSelectionMode(false)
    if (!targets.length) {
      setProblemActionError(t("새 답안이나 수정된 답안이 없습니다."))
      return
    }
    const items = targets.filter(problem => pdfProblemAnswerInputType(problem) !== "unknown" && batchProblemHasAnswer(problem)).map(problem => {
      const answerType = pdfProblemAnswerInputType(problem)
      const draft = activeDraftForProblem(problem)
      const isActiveCodeProblem = answerType === "code" && problem.id === activeProblem?.id
      const lastRun = lastProblemRunRef.current
      return {
        problem_id: problem.id,
        solve_round_id: problem.solve_round_id,
        attempt_id: createProblemGradingAttemptId(),
        answer_type: answerType,
        answer_text: answerType === "short_answer" || answerType === "ox" ? String(draft.answer_text || "") : undefined,
        selected_choice: answerType === "multiple_choice" ? Number(draft.selected_choice) : undefined,
        project_name: answerType === "code" ? projectPathForPdfProblem(problem, problemStorageBaseDir) : undefined,
        active_file_name: isActiveCodeProblem ? activeFile?.name : undefined,
        language: isActiveCodeProblem ? activeFile?.language : undefined,
        files: isActiveCodeProblem ? files.filter(file => !isProblemMetadataFile(file.name)).map(file => ({ name: file.name, code: file.code })) : undefined,
        run_result: isActiveCodeProblem && lastRun && lastRun.signature === sandboxSourceSignature(files)
          ? { success: lastRun.success, returncode: lastRun.returncode, stdout: lastRun.stdout, stderr: lastRun.stderr, action: lastRun.action } : undefined,
      }
    })
    try {
      startBackgroundProblemBatch({ pdfPath, baseDir: problemStorageBaseDir, total: targets.length, items })
      setProblemActionError("")
      setSelectedPracticeProblemIds(new Set())
    } catch (error) {
      setProblemActionError(consoleErrorMessage(error, t("묶음 채점을 시작하지 못했습니다.")))
    }
  }

  async function gradeActiveProblem() {
    if (!activeProblem || !pdfPath) return
    clearProblemAnswerAutosaveTimer()
    const problem = activeProblem
    const answerType = activeProblemAnswerInputType ?? "unknown"
    if (answerType === "unknown") {
      setProblemActionError(t("답안 유형을 먼저 선택해 주세요."))
      return
    }
    if (answerType === "code" && !activeFile) {
      setProblemActionError(t("채점할 코드 파일을 먼저 열어 주세요."))
      return
    }
    if (answerType === "code") {
      const expectedProject = projectPathForPdfProblem(problem, problemStorageBaseDir)
      const expectedScope = codeProjectLoadScope(problemStorageBaseDir, expectedProject)
      if (
        !hasConsistentProblemContext
        || !expectedProject
        || normalizeProjectPath(expectedProject) !== normalizeProjectPath(projectName)
        || loadedProjectScopeRef.current !== expectedScope
      ) {
        setProblemActionError(t("이 문제의 코드 폴더를 여는 중입니다. 잠시 후 다시 시도해 주세요."))
        return
      }
    }
    if (answerType === "multiple_choice" && problemSelectedChoice === null) {
      setProblemActionError(t("선택지를 하나 골라 주세요."))
      return
    }
    if ((answerType === "short_answer" || answerType === "ox") && !problemAnswerText.trim()) {
      setProblemActionError(t("주관식 답안을 입력해 주세요."))
      return
    }
    if (
      activeProblemBinaryPrompt
      && !pdfProblemBinaryAnswerComplete(activeProblemBinaryPrompt, problemAnswerText)
    ) {
      setProblemActionError(t("모든 O/X 또는 T/F 항목에 답해 주세요."))
      return
    }
    const submittedAnswerText = problemAnswerText
    const submittedSelectedChoice = problemSelectedChoice
    const action = beginProblemAction("grade")
    if (!action) return
    const requestDataScope = activeProblemDataScope
    const requestScope = activeProblemScope
    const requestSeq = ++problemGradeActionSeqRef.current
    const gradingAttemptId = createProblemGradingAttemptId()
    setIsProblemGrading(true)
    setProblemGradeResult(null)
    setProblemActionError("")
    try {
      if (answerType !== "code") {
        const saved = await queueActiveProblemAnswerSave({
          problem,
          answerText: submittedAnswerText,
          selectedChoice: submittedSelectedChoice,
          quiet: true,
        })
        if (!saved) throw new Error(t("답안을 저장하지 못했습니다."))
        if (activeProblemScopeRef.current !== requestScope || problemGradeActionSeqRef.current !== requestSeq) return
      }
      const lastRun = lastProblemRunRef.current
      const currentSignature = sandboxSourceSignature(files)
      const result = await gradePdfProblem({
        pdf_path: pdfPath,
        base_dir: problemStorageBaseDir,
        problem_id: problem.id,
        solve_round_id: problem.solve_round_id,
        attempt_id: gradingAttemptId,
        answer_type: answerType,
        answer_text: answerType === "short_answer" || answerType === "ox" ? submittedAnswerText : undefined,
        selected_choice: answerType === "multiple_choice" ? submittedSelectedChoice : undefined,
        project_name: answerType === "code" ? projectName : undefined,
        active_file_name: answerType === "code" ? activeFile?.name : undefined,
        language: answerType === "code" ? activeFile?.language : undefined,
        files: answerType === "code"
          ? files
            .filter((file) => !isProblemMetadataFile(file.name))
            .map((file) => ({ name: file.name, code: file.code }))
          : undefined,
        run_result: answerType === "code" && lastRun && lastRun.signature === currentSignature
          ? {
              success: lastRun.success,
              returncode: lastRun.returncode,
              stdout: lastRun.stdout,
              stderr: lastRun.stderr,
              action: lastRun.action,
            }
          : undefined,
      })
      if (activeProblemDataScopeRef.current === requestDataScope) publishProblem(result.problem)
      if (activeProblemScopeRef.current !== requestScope || problemGradeActionSeqRef.current !== requestSeq) return
      if (result.application_status === "stale") {
        setProblemActionError(t("더 최근 AI 채점 결과가 이미 반영되었습니다."))
        return
      }
      setProblemGradeResult(result)
    } catch (error) {
      if (activeProblemScopeRef.current !== requestScope || problemGradeActionSeqRef.current !== requestSeq) return
      setProblemActionError(consoleErrorMessage(error, t("AI 채점에 실패했습니다.")))
    } finally {
      if (activeProblemScopeRef.current === requestScope && problemGradeActionSeqRef.current === requestSeq) {
        setIsProblemGrading(false)
      }
      releaseProblemAction(action)
    }
  }

  function recordActiveProblemHint() {
    if (!activeProblem || !pdfPath || activeProblem.ai_hint_used) return
    const problem = activeProblem
    const requestDataScope = activeProblemDataScope
    const requestScope = activeProblemScope
    void recordPdfProblemHint({
      pdf_path: pdfPath,
      base_dir: problemStorageBaseDir,
      problem_id: problem.id,
        solve_round_id: problem.solve_round_id,
    }).then((result) => {
      if (activeProblemDataScopeRef.current === requestDataScope) publishProblem(result.problem)
      if (activeProblemScopeRef.current !== requestScope) return
    }).catch((error) => {
      console.warn("Failed to record AI hint usage", error)
    })
  }

  async function toggleActiveProblemHint() {
    if (!activeProblem || !pdfPath || isProblemHintLoading) return
    if (activeProblemHint?.text) {
      if (!isProblemHintVisible) recordActiveProblemHint()
      setProblemHintError("")
      setIsProblemHintVisible((current) => !current)
      return
    }

    const problem = activeProblem
    const requestDataScope = activeProblemDataScope
    const requestScope = activeProblemScope
    const requestSeq = ++problemHintActionSeqRef.current
    setProblemHintError("")
    setIsProblemHintVisible(true)
    setIsProblemHintLoading(true)
    try {
      if (activeProblemAnswerInputType !== "code") {
        await flushActiveProblemAnswerSave()
      }
      if (activeProblemScopeRef.current !== requestScope || problemHintActionSeqRef.current !== requestSeq) return
      const result = await generatePdfProblemHint({
        pdf_path: pdfPath,
        base_dir: problemStorageBaseDir,
        problem_id: problem.id,
        solve_round_id: problem.solve_round_id,
        answer_text: activeProblemAnswerInputType === "short_answer" || activeProblemAnswerInputType === "ox" ? problemAnswerText : "",
        selected_choice: activeProblemAnswerInputType === "multiple_choice" ? problemSelectedChoice : null,
      })
      if (activeProblemDataScopeRef.current === requestDataScope) publishProblem(result.problem)
      if (activeProblemScopeRef.current !== requestScope || problemHintActionSeqRef.current !== requestSeq) return
      setProblemHintResult({
        scope: requestScope,
        hint: result.problem.ai_hint ?? {
          text: result.hint,
          provider: result.provider,
          model: result.model,
        },
      })
    } catch (error) {
      if (activeProblemScopeRef.current !== requestScope || problemHintActionSeqRef.current !== requestSeq) return
      setProblemHintError(consoleErrorMessage(error, t("AI 힌트를 생성하지 못했습니다.")))
    } finally {
      if (activeProblemScopeRef.current === requestScope && problemHintActionSeqRef.current === requestSeq) {
        setIsProblemHintLoading(false)
      }
    }
  }

  return {
    retryProblems,
    retryActiveProblem,
    isProblemRetrying,
    isProblemActionPending,
    problemActionLockRef,
    setSelectedPracticeProblemIds,
    setProblemClockNow,
    isProblemTypeMenuOpen,
    problemTypeMenuRef,
    setIsProblemTypeMenuOpen,
    recordActiveProblemHint,
    flushActiveProblemAnswerSave,
    openProblemEditor,
    pendingReviewQueueCount,
    isProblemAnswerSaving,
    problemReviewQueue,
    setIsProblemReviewQueueOpen,
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
    gradeActiveProblem,
    isProblemGrading,
    nextPracticeProblem,
    problemHintError,
    setIsProblemHintVisible,
    problemActionError,
    displayedProblemGrade,
    latestMistakeNote,
    openPracticeTheoryPage,
    displayedTheory,
    activeChapterProblems,
    batchDialogAnsweredCount,
    batchDialogChangedCount,
    batchDialogProblems,
    batchProblemHasAnswer,
    expandedPracticeChapters,
    isPracticeSelectionMode,
    openProblemBatchDialog,
    problemBatchDialogIds,
    selectedPracticeProblemIds,
    setExpandedPracticeChapters,
    setIsPracticeSelectionMode,
    setProblemBatchDialogIds,
    startProblemBatchGrading,
    togglePracticeProblemSelection,
    problemAnswerIsDirty,
    problemAnswerEditorRef,
    activeProblemBinarySelections,
    problemAnswerText,
    selectActiveProblemBinaryAnswer,
    setProblemSelectedChoice,
    setProblemGradeResult,
    setProblemActionError,
    problemSelectedChoice,
    setProblemAnswerText,
    currentProblemFeedbackGrade,
    previousProblemFeedbackGrade,
    isProblemReviewQueueOpen,
    isReviewQueueSaving,
    reviewQueueEditor,
    saveReviewQueueResolution,
    selectReviewQueueCandidate,
    setReviewQueueEditor,
    problemEditDialog,
    isProblemEditing,
    saveProblemEdits,
    setProblemEditDialog,
  }
}
