import { IDE_ENABLED } from "../../../edition.ts"
import { t } from "../../../lib/i18n.ts"
import React from "react"
import { RefreshCw } from "lucide-react"
import { type PdfProblem, type PdfProblemAnswerType } from "../../../lib/api"
import { PracticeFeedbackPanel, PracticeHintPanel, PracticePreviousFeedback } from "./practice-feedback-panels.tsx"
import { PracticeMultipleChoice } from "./practice-multiple-choice.tsx"
import { PracticeQuestionCopyButton } from "./practice-question-copy-button.tsx"
import { PDF_PROBLEM_ANSWER_TYPE_LABELS, pdfProblemAnswerTypeLabel, pdfProblemKindLabel, pdfProblemBinarySelection } from "../../../lib/problem-study.ts"

interface PracticeAnswerPanelProps {
  tutorAction?: React.ReactNode
  activeProblem: PdfProblem
  activeProblemBinaryPrompt: import("../../../lib/problem-study.ts").PdfProblemBinaryPrompt | null
  isProblemAnswerSaving: boolean
  problemAnswerIsDirty: boolean
  activeProblemDisplayBlocks: import("../../../lib/problem-study.ts").PdfProblemDisplayBlock[]
  isProblemHintVisible: boolean
  problemHintError: string
  activeProblemHint: import("../../../lib/api").PdfProblemHint | null
  isProblemHintLoading: boolean
  setIsProblemHintVisible: React.Dispatch<React.SetStateAction<boolean>>
  problemAnswerEditorRef: React.RefObject<HTMLElement | null>
  activeProblemBinarySelections: Record<string, string>
  problemAnswerText: string
  isProblemActionPending: boolean
  selectActiveProblemBinaryAnswer: (itemNumber: string, selection: string) => void
  activeProblemAnswerType: PdfProblemAnswerType | null
  changeActiveProblemAnswerType: (answerType: PdfProblemAnswerType) => Promise<void>
  flushActiveProblemAnswerSave: () => Promise<PdfProblem | null>
  setProblemSelectedChoice: React.Dispatch<React.SetStateAction<number | null>>
  setProblemGradeResult: React.Dispatch<React.SetStateAction<import("../../../lib/api").PdfProblemGradeResult | null>>
  setProblemActionError: React.Dispatch<React.SetStateAction<string>>
  problemSelectedChoice: number | null
  setProblemAnswerText: React.Dispatch<React.SetStateAction<string>>
  problemActionError: string
  currentProblemFeedbackGrade: import("../../../lib/api").PdfProblemGradingSummary | null
  latestMistakeNote: import("../../../lib/api").PdfMistakeNote | null
  openPracticeTheoryPage: (page: number) => void
  displayedTheory: import("../../../lib/api").PdfTheoryReference[]
  previousProblemFeedbackGrade: import("../../../lib/api").PdfProblemGradingSummary | null
}

export function PracticeAnswerPanel({
  tutorAction,
  activeProblem,
  activeProblemBinaryPrompt,
  isProblemAnswerSaving,
  problemAnswerIsDirty,
  activeProblemDisplayBlocks,
  isProblemHintVisible,
  problemHintError,
  activeProblemHint,
  isProblemHintLoading,
  setIsProblemHintVisible,
  problemAnswerEditorRef,
  activeProblemBinarySelections,
  problemAnswerText,
  isProblemActionPending,
  selectActiveProblemBinaryAnswer,
  activeProblemAnswerType,
  changeActiveProblemAnswerType,
  flushActiveProblemAnswerSave,
  setProblemSelectedChoice,
  setProblemGradeResult,
  setProblemActionError,
  problemSelectedChoice,
  setProblemAnswerText,
  problemActionError,
  currentProblemFeedbackGrade,
  latestMistakeNote,
  openPracticeTheoryPage,
  displayedTheory,
  previousProblemFeedbackGrade,
}: PracticeAnswerPanelProps) {
  return (
    <div className="h-full overflow-y-auto bg-[var(--practice-panel)] p-4 text-[var(--foreground)]" data-practice-answer-panel="true">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col">
        <div className="flex-1 pb-5">
          <section className="mb-5 rounded-md border border-white/10 bg-white/[0.035] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-white/90">
                {activeProblem.chapter} · {pdfProblemKindLabel(activeProblem.kind)} {activeProblem.number}{t("번")}</div>
              <div className="flex items-center gap-2 text-[10px] text-white/40">
                <span>{activeProblem.page}{t("쪽 · ")}{pdfProblemAnswerTypeLabel(activeProblem)}</span>
                <span aria-hidden="true">·</span>
                <span data-problem-autosave-status="true">
                  {isProblemAnswerSaving
                    ? <span className="inline-flex items-center gap-1"><RefreshCw className="animate-spin" size={10} /> {t("저장 중")}</span>
                    : problemAnswerIsDirty
                      ? t("자동 저장 대기")
                      : t("자동 저장됨")}
                </span>
                <PracticeQuestionCopyButton number={activeProblem.number} blocks={activeProblemDisplayBlocks} choices={activeProblem.choices} />
              </div>
            </div>
            <div data-practice-question-body className="max-h-72 overflow-y-auto text-[13px] leading-6 text-white/85">
              {activeProblemDisplayBlocks.length > 0
                ? activeProblemDisplayBlocks.map((block, index) => (
                  block.kind !== "text"
                    ? (
                      <pre
                        key={`${block.kind}-${index}`}
                        data-pdf-problem-code-box={block.kind === "code" ? "true" : undefined}
                        data-pdf-problem-output-screen={block.kind === "output" ? "true" : undefined}
                        className={`my-2 max-w-full overflow-x-auto rounded border bg-black/30 px-3 py-2 font-mono text-[12px] leading-5 text-white/90 ${block.kind === "code" ? "border-violet-300/25" : "border-white/15"}`}
                      >
                        {block.text}
                      </pre>
                    )
                    : (
                      <div key={`${block.kind}-${index}`} className="whitespace-pre-wrap">
                        {block.text}
                      </div>
                    )
                ))
                : t("문제 본문은 PDF에서 확인하세요.")}
            </div>
          </section>

          {isProblemHintVisible && (
            <div className="mb-5">
              <PracticeHintPanel
                error={problemHintError}
                hint={activeProblemHint}
                loading={isProblemHintLoading}
                onClose={() => setIsProblemHintVisible(false)}
              />
            </div>
          )}

          {activeProblemBinaryPrompt && (
            <section
              className="rounded-md border border-white/10 bg-white/[0.025] p-4"
              data-practice-binary-answer={activeProblemBinaryPrompt.kind}
              ref={problemAnswerEditorRef}
            >
              <div className="mb-3 text-[11px] font-bold text-white/65">
                {activeProblemBinaryPrompt.labels.join("/")} {t("답안 선택")}</div>
              <div className="space-y-2">
                {(activeProblemBinaryPrompt.items.length
                  ? activeProblemBinaryPrompt.items
                  : [{ number: "", text: "" }]
                ).map((item) => {
                  const currentSelection = pdfProblemBinarySelection(activeProblemBinaryPrompt, item.number
                    ? activeProblemBinarySelections[item.number]
                    : problemAnswerText)
                  return (
                    <div
                      className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2"
                      key={item.number || "single"}
                    >
                      {item.number && (
                        <span className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-5 text-white/75">
                          ({item.number}) {item.text}
                        </span>
                      )}
                      <div className="ml-auto flex shrink-0 gap-2">
                        {activeProblemBinaryPrompt.labels.map((label) => {
                          const selected = currentSelection === label
                          return (
                            <button
                              aria-label={`${item.number ? t("{p0}번 ", { p0: item.number }) : ""}${label}`}
                              aria-pressed={selected}
                              className={`h-9 min-w-12 rounded-md border px-4 text-sm font-bold transition-colors ${
                                selected
                                  ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                  : "border-white/15 bg-white/5 text-white/65 hover:bg-white/10"
                              }`}
                              disabled={isProblemActionPending}
                              key={label}
                              onClick={() => selectActiveProblemBinaryAnswer(item.number, label)}
                              type="button"
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {activeProblemAnswerType === "unknown" && !activeProblemBinaryPrompt && (
            <section
              className="rounded-md border border-[var(--brand)]/25 bg-[var(--brand-soft)]/15 p-4"
              ref={problemAnswerEditorRef}
            >
              <div className="text-xs font-bold text-[var(--brand)]">{t("답안 유형을 확인해 주세요")}</div>
              <div className="mt-1 text-[10px] leading-4 text-white/45">
                {t("자동 분류가 확실하지 않습니다. 선택한 유형은 이 문제에만 저장됩니다.")}</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {(["multiple_choice", "short_answer", "ox", "code"] as PdfProblemAnswerType[]).filter(type => IDE_ENABLED || type !== "code").map((answerType) => (
                  <button
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-3 text-left hover:border-[var(--brand)]/50 hover:bg-[var(--brand-soft)]/25"
                    disabled={isProblemActionPending || isProblemAnswerSaving}
                    key={answerType}
                    onClick={() => void changeActiveProblemAnswerType(answerType)}
                    type="button"
                  >
                    <span className="block text-[11px] font-bold text-white/85">{t(PDF_PROBLEM_ANSWER_TYPE_LABELS[answerType])}</span>
                    <span className="mt-1 block text-[9px] leading-4 text-white/35">
                      {answerType === "multiple_choice"
                        ? t("보기 중 하나를 선택합니다.")
                        : answerType === "short_answer"
                          ? t("문장이나 계산 결과를 직접 입력합니다.")
                          : answerType === "ox" ? "O/X · T/F"
                          : t("코드 파일에서 답을 작성하고 실행합니다.")}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {activeProblemAnswerType === "multiple_choice" && !activeProblemBinaryPrompt && (
            <section ref={problemAnswerEditorRef}>
              <PracticeMultipleChoice
                choices={activeProblem.choices?.length
                  ? activeProblem.choices
                  : [t("1번 보기"), t("2번 보기"), t("3번 보기"), t("4번 보기"), t("5번 보기")]}
                disabled={isProblemActionPending}
                onBlur={() => void flushActiveProblemAnswerSave()}
                onSelect={(index) => {
                  setProblemSelectedChoice(index)
                  setProblemGradeResult(null)
                  setProblemActionError("")
                }}
                selectedIndex={problemSelectedChoice}
              />
              {!activeProblem.choices?.length && (
                <div className="mt-2 text-[10px] text-amber-200/65">
                  {t("선택지 텍스트가 인식되지 않았습니다. PDF의 보기를 확인해 주세요.")}</div>
              )}
            </section>
          )}

          {activeProblemAnswerType === "short_answer" && !activeProblemBinaryPrompt && (
            <section ref={problemAnswerEditorRef}>
              <label className="mb-2 block text-[11px] font-bold text-white/65" htmlFor={`problem-answer-${activeProblem.id}`}>
                {t("답안")}</label>
              <textarea
                className="min-h-[clamp(220px,30vh,360px)] w-full resize-y rounded-md border border-white/10 bg-black/25 p-4 text-[13px] leading-6 text-white outline-none placeholder:text-white/25 focus:border-[var(--brand)]/60"
                disabled={isProblemActionPending}
                id={`problem-answer-${activeProblem.id}`}
                onBlur={() => void flushActiveProblemAnswerSave()}
                onChange={(event) => {
                  setProblemAnswerText(event.target.value)
                  setProblemGradeResult(null)
                  setProblemActionError("")
                }}
                placeholder={t("답안을 입력하세요.")}
                spellCheck
                value={problemAnswerText}
              />
            </section>
          )}

          <div className="mt-4">
            <PracticeFeedbackPanel
              error={problemActionError}
              grade={currentProblemFeedbackGrade}
              mistakeNote={latestMistakeNote}
              onOpenPage={openPracticeTheoryPage}
              theory={displayedTheory}
            />
            {previousProblemFeedbackGrade && (
              <PracticePreviousFeedback
                grade={previousProblemFeedbackGrade}
                mistakeNote={latestMistakeNote}
                onOpenPage={openPracticeTheoryPage}
                theory={displayedTheory}
              />
            )}
            {currentProblemFeedbackGrade && <div className="mt-3">{tutorAction}</div>}
          </div>
        </div>

      </div>
    </div>
  )
}
