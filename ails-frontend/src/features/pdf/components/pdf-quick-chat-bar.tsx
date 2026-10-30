import { Loader2, Maximize2, Mic, Minimize2, Send, Square } from "lucide-react"
import { useRef, type ReactNode, type RefObject } from "react"

import type { VoiceInputState } from "../../voice/hooks/use-voice-controller.ts"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { useQuickChatEditContext } from "../hooks/use-quick-chat-edit-context.ts"
import { useQuickChatInputSize } from "../hooks/use-quick-chat-input-size.ts"
import { useProcessbarScrollProximity } from "../../../shared/hooks/use-processbar-scroll-proximity.ts"
import "../../../shared/ui/processbar-scroll.css"
import "./quick-chat-input.css"

type PdfQuickChatBarProps = {
  chat: {
    blocked?: boolean
    canToggleWindow?: () => boolean
    commitDraft: (value: string) => void
    draft: string
    isBusy: boolean
    isChangingModel?: boolean
    onAsk: (question?: string) => void | Promise<void>
    onStop?: () => void
    onDraftChange: (value: string) => void
    open: boolean
    setOpen: (open: boolean) => void
    toggleWindow: () => void
  }
  inputRef: RefObject<HTMLTextAreaElement | null>
  reasoningControl?: ReactNode
  usageIndicator?: ReactNode
  visible: boolean
  voice: {
    assistantText: string
    latencyText: string
    onStart: () => void | Promise<void>
    phase: string
    state: VoiceInputState
    statusText: string
  }
}

export function PdfQuickChatBar({ chat, inputRef, visible, voice, reasoningControl, usageIndicator }: PdfQuickChatBarProps) {
  const showInput = chat.open || voice.state !== "idle"
  const sizing = useQuickChatInputSize(inputRef, visible, chat.draft, showInput)
  const scrollRef = useRef<HTMLDivElement>(null)
  useProcessbarScrollProximity(scrollRef, visible)
  const { composition, close } = useQuickChatEditContext(inputRef, {
    enabled: visible && !chat.blocked && voice.state === "idle",
    open: chat.open, draft: chat.draft, change: chat.onDraftChange, setOpen: chat.setOpen,
    resize: sizing.resize,
  })
  if (!visible) return null

  return (
    <form
      className={cn(
        "fixed bottom-5 left-1/2 z-[96] w-[min(680px,calc(100vw-48px))] -translate-x-1/2",
        showInput ? "pointer-events-auto" : "pointer-events-none",
      )}
      data-ails-pdf-quick-chat="true"
      data-ails-quick-chat-visible={showInput ? "true" : "false"}
      inert={!showInput}
      onSubmit={(event) => {
        event.preventDefault()
        if (chat.isChangingModel) return
        const textarea = event.currentTarget.elements.namedItem("pdf-chatbot-question")
        void chat.onAsk(textarea instanceof HTMLTextAreaElement ? textarea.value : "")
      }}
    >
      {voice.state !== "idle" && voice.assistantText && (
        <div
          aria-live="polite"
          className="absolute bottom-[calc(100%+10px)] left-1/2 w-[min(620px,calc(100vw-64px))] -translate-x-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)]/95 px-4 py-3 text-sm text-[var(--foreground)] shadow-xl backdrop-blur-xl"
          data-ails-voice-assistant="true"
        >
          <div className="line-clamp-3 leading-5">{voice.assistantText}</div>
          <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-[var(--muted-foreground)]">
            <span>{voice.phase === "Speaking" ? t("AI가 말하는 중 · 말하면 즉시 중단됩니다") : t("AI 응답 생성 중")}</span>
            {voice.latencyText && <span className="shrink-0">{voice.latencyText}</span>}
          </div>
        </div>
      )}
      <div
        className={cn(
          "relative flex flex-wrap transform-gpu items-end gap-2 rounded-[28px] border p-2 pl-5 shadow-2xl [backface-visibility:hidden] will-change-transform backdrop-blur-2xl",
          voice.state !== "idle"
            ? "border-sky-400/70 bg-sky-500/15 shadow-sky-500/20 supports-[backdrop-filter]:bg-sky-500/12"
            : "border-white/15 bg-[var(--panel)]/72 supports-[backdrop-filter]:bg-[var(--panel)]/66",
          showInput
            ? "translate-y-0 scale-100"
            : "translate-y-[calc(100%_+_2rem)] scale-[0.92]",
        )}
        style={{
          transition: showInput
            ? "translate 200ms cubic-bezier(0.22, 1, 0.36, 1), scale 200ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "translate 280ms cubic-bezier(0.4, 0, 0.2, 1), scale 280ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {showInput && usageIndicator && <div className="w-full min-w-0 px-1 pt-1 empty:hidden">{usageIndicator}</div>}
        <div className="relative min-w-0 flex-1 py-2" ref={scrollRef}>
        <textarea
          aria-label={voice.state === "recording" ? t("보이스 모드 음성 입력") : t("현재 학습자료에 질문")}
          className={cn(
            "ails-processbar-scroll block min-h-6 w-full min-w-0 resize-none bg-transparent p-0 pr-10 text-sm leading-6 outline-none",
            voice.state !== "idle"
              ? "text-sky-950 placeholder:text-sky-700/70 dark:text-sky-100 dark:placeholder:text-sky-200/70"
              : "text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]",
          )}
          defaultValue={chat.draft}
          disabled={chat.blocked}
          name="pdf-chatbot-question"
          data-ails-question-entry={showInput ? "true" : undefined}
          onBlur={(event) => chat.commitDraft(event.currentTarget.value)}
          onChange={(event) => {
            const value = event.currentTarget.value
            chat.onDraftChange(value)
            chat.setOpen(Boolean(value.trim()))
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (event.key === "Escape") {
              event.preventDefault(); event.stopPropagation()
              chat.commitDraft(event.currentTarget.value)
              close()
              return
            }
            if (event.key !== "Enter" || event.shiftKey) return
            event.preventDefault()
            if (chat.isChangingModel) return
            if (event.currentTarget.value.trim()) void chat.onAsk(event.currentTarget.value)
            else if (chat.canToggleWindow?.() !== false) chat.toggleWindow()
          }}
          placeholder={voice.state === "recording" ? voice.statusText || t("말씀해 주세요") : t("학습자료에 대해 질문하세요")}
          readOnly={voice.state === "recording"}
          ref={inputRef}
          required
          rows={1}
          style={{ scrollbarGutter: "stable" }}
          tabIndex={showInput ? 0 : -1}
        />
        {sizing.overflow && <button type="button" aria-label={sizing.expanded ? t("입력창 접기") : t("입력창 펼치기")}
          aria-expanded={sizing.expanded} data-ails-question-expand="true"
          className="absolute right-3 top-2 flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
          onMouseDown={event => event.preventDefault()} onClick={sizing.toggleExpanded}>
          {sizing.expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>}
        {composition && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" data-ails-question-composition="true">
          {composition.underlines.map((rect, index) => <span key={index} className="absolute border-b border-current" style={rect} />)}
          <span className="absolute w-px bg-current" data-ails-question-composition-caret="true" style={composition.caret} />
        </div>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
        {reasoningControl && <div className="mr-1 min-w-0" data-ails-question-reasoning="true">{reasoningControl}</div>}
        <button
          aria-label={voice.state === "recording" ? t("마이크 중지") : t("마이크 시작")}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-40",
            voice.state !== "idle"
              ? "bg-sky-400 text-slate-950"
              : "bg-[var(--foreground)] text-[var(--background)]",
          )}
          disabled={voice.state === "starting" || voice.state === "stopping"}
          onClick={() => void voice.onStart()}
          type="button"
          tabIndex={showInput ? 0 : -1}
        >
          {voice.state === "starting" || voice.state === "stopping"
            ? <Loader2 className="animate-spin" size={17} />
            : voice.state === "recording"
              ? <Square size={15} />
              : <Mic size={17} />}
        </button>
        {chat.isBusy && chat.onStop && <button type="button" aria-label={t("답변 생성 중지")} onClick={chat.onStop}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)]" tabIndex={showInput ? 0 : -1}>
          <Square size={15} fill="currentColor" />
        </button>}
        <button
          aria-label={t("질문 보내기")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] transition-opacity disabled:opacity-40"
          disabled={voice.state === "recording" || chat.isChangingModel}
          type="submit"
          tabIndex={showInput ? 0 : -1}
        >
          <Send size={17} />
        </button>
        </div>
      </div>
    </form>
  )
}
