import { WebSearchSources } from "./web-search-sources.tsx"
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { useCallback, useRef } from "react"
import {
  BarChart2,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  History,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  PenLine,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react"

import jackIconUrl from "../../../../../assets/jack.png?url"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import type { AILSConfig, ModelOptionsPayload } from "../../../lib/api"
import type { PracticeTutorContext } from "../../../lib/api/practice-tutor.ts"
import type { ChatController, ChatMessage } from "../hooks/use-chat-controller.ts"
import { useChatBottomFollow } from "../hooks/use-chat-bottom-follow.ts"
import type { VoiceInputState } from "../../voice/hooks/use-voice-controller.ts"
import type { DashboardRecentFile } from "../../../shared/workspace-types.ts"
import { ChatAnswerEvidence } from "./chat-answer-evidence.tsx"
import { ChatAnswerMarkdown } from "./chat-answer-markdown.tsx"
import { ChatAnswerActions } from "./chat-answer-actions.tsx"
import { useProcessbarScrollProximity } from "../../../shared/hooks/use-processbar-scroll-proximity.ts"
import "../../../shared/ui/processbar-scroll.css"
import { viewerDocumentIsPdf } from "../../../lib/viewer-document.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { Textarea } from "../../../shared/ui/textarea.tsx"
import { ChatGPTPlanIndicatorForConfig } from "./chatgpt-plan-indicator.tsx"
import { ChatComposerControls } from "./chat-composer-controls.tsx"

export type ChatbotWorkspaceMode = "inline" | "window" | "fullscreen" | "home" | "tutor"
type ChatbotRecentFile = DashboardRecentFile & { date?: string; size?: string }

interface ChatbotWorkspaceProps {
  embeddedHeader?: ReactNode
  composerContext?: ReactNode
  composerControls?: ReactNode
  actions: {
    closeWindow: () => void
    commitDraft: (value: string) => void
    handleAnswerDragEnd: (event: ReactDragEvent<HTMLElement>) => void
    handleAnswerDragStart: (event: ReactDragEvent<HTMLElement>, message: ChatMessage, mode?: "inline" | "window") => void
    handleAnswerPointerDown: (event: ReactPointerEvent<HTMLElement>, message: ChatMessage, mode: "inline" | "window") => void
    onAgentModelChange: (modelId: string) => Promise<void>
    onAsk: (questionText?: string, displayQuestionText?: string, options?: { forceCloud?: boolean; practiceContext?: PracticeTutorContext }) => Promise<void>
    onStop: () => void
    onClearPdfHistory: () => Promise<void>
    onOpenMaterialFile: (path: string) => Promise<void>
    onOpenPdfSessions: () => Promise<void>
    onStartVoice: () => Promise<void>
    openWindow: () => void
    startNewPdfSession: () => void
  }
  busy: (key: string) => boolean
  chat: ChatController
  document: {
    activeChatDocumentKey: string
    activeChatMessageKey: string
    activePdfChatSessionId: string
    chatMessages: ChatMessage[]
    chatViewerDocument: { kind: string; title: string; rendered_file_path?: string } | null
  }
  mode: ChatbotWorkspaceMode
  showComposer?: boolean
  models: {
    config: AILSConfig
    options: ModelOptionsPayload | null
  }
  voice: {
    onStart: () => Promise<void>
    state: VoiceInputState
    statusText: string
  }
  workspace: {
    onOpenDocument: (id: string) => void
    onSetSurface: (surface: "home" | "dashboard" | "document" | "settings") => void
    onShowMaterials: (open: boolean) => void
    recentFiles: ChatbotRecentFile[]
    setNotice: (message: string) => void
  }
}

export function ChatbotWorkspace({ actions, busy, chat, document, mode, models, voice, workspace, showComposer = true, embeddedHeader, composerContext, composerControls }: ChatbotWorkspaceProps) {
    const {
      input: { chatInputDraft, chatInputRef, chatReasoningEffort, setChatReasoningEffort },
      pdf: {
        pdfChatHistoryDeleteConfirm,
        pdfChatSessions,
        pdfChatSessionsOpen,
        setActivePdfChatSessionByDocument,
        setPdfChatHistoryDeleteConfirm,
        setPdfChatSessionsOpen,
      },
      window: {
        chatbotWindowScrollRef,
        chatbotWindowScrollTopByDocumentRef,
        setChatbotAnswerWindowOpen,
        setSelectedChatbotAnswer,
      },
    } = chat
    const scrollRef = useRef<HTMLDivElement | null>(null)
    useProcessbarScrollProximity(scrollRef)
    const bindScroll = useCallback((element: HTMLDivElement | null) => {
      scrollRef.current = element
      if (mode !== "inline") chatbotWindowScrollRef.current = element
    }, [mode, chatbotWindowScrollRef])
    const {
      closeWindow: closeChatbotWindow,
      commitDraft: commitPdfChatDraft,
      handleAnswerDragEnd: handleChatAnswerDragEnd,
      handleAnswerDragStart: handleChatAnswerDragStart,
      handleAnswerPointerDown: handleChatAnswerPointerDown,
      onAgentModelChange: handleChatbotAgentModelChange,
      onAsk: handleAskChatbot,
      onStop: stopAnswer,
      onClearPdfHistory: handleClearPdfChatHistory,
      onOpenMaterialFile: handleOpenMaterialFile,
      onOpenPdfSessions: openPdfChatSessions,
      openWindow: openChatbotWindow,
      startNewPdfSession: startNewPdfChatSession,
    } = actions
    const {
      activeChatDocumentKey,
      activeChatMessageKey,
      activePdfChatSessionId,
      chatMessages,
      chatViewerDocument,
    } = document
    useChatBottomFollow(scrollRef, activeChatMessageKey)
    // 변환된 PPT/PPTX 및 마크다운 문서도 PDF와 같은 학습 챗봇 경로를 쓴다.
    const viewerIsPdf = viewerDocumentIsPdf(chatViewerDocument)
    const isStudyViewer = viewerIsPdf || chatViewerDocument?.kind === "md"
    const quickChatSurface = mode !== "tutor" && (mode === "home" || !showComposer || isStudyViewer)
    const { config: draftConfig, options: modelOptions } = models
    const { onStart: handleStartVoice, state: voiceState, statusText: voiceStatusText } = voice
    const {
      onOpenDocument: setSelectedLectureDocId,
      onSetSurface: setWorkspaceSurface,
      onShowMaterials: setLectureAddExpanded,
      recentFiles,
      setNotice,
    } = workspace
    const isBusy = busy
    const activeSession = pdfChatSessions.find((session) => session.session_id === activePdfChatSessionId)
    const providerSettings = draftConfig.ai_provider_settings
    const providerOverride = providerSettings?.features.chatbot
    const usesChatGPT = (providerOverride && providerOverride !== "default" ? providerOverride : providerSettings?.default) === "chatgpt"
    const chatbotSelection = draftConfig.ai_model_selection?.features?.chatbot ?? draftConfig.ai_model_selection?.default
    return (
      <section
        data-ails-quick-chat-focus-surface={quickChatSurface ? "true" : undefined}
        data-ails-quick-chat-proxy={quickChatSurface ? "true" : undefined}
        tabIndex={quickChatSurface ? 0 : undefined}
        data-ails-home-agent-canvas={mode === "home" ? "true" : undefined}
        data-pdf-wheel-scroll-region={mode === "fullscreen" ? "true" : undefined}
        className={cn(
          "relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]",
          mode === "inline"
            ? "h-[680px] 2xl:sticky 2xl:top-6"
            : mode === "fullscreen" || mode === "home" || mode === "tutor"
              ? cn("h-full rounded-none border-0", mode === "home" && "w-full flex-1 bg-transparent pt-16")
              : "h-full rounded-2xl",
        )}
      >
        {embeddedHeader ?? (mode !== "home" && <div
          className={cn(
            "flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--background)]/95",
            mode === "window" ? "cursor-move select-none px-5 py-3" : "px-4 py-2.5"
          )}
          data-ails-drag-handle={mode === "window" ? "true" : undefined}
        >
          <div className="flex min-w-0 items-center gap-3">
            <img alt="" className="h-10 w-10 shrink-0 object-contain" src={jackIconUrl} />
            <div className="min-w-0">
              <h3 className={cn("truncate font-semibold", mode === "window" ? "text-base" : "text-sm")}>
                {t("학습 챗봇")}</h3>
              <p className="truncate text-xs text-[var(--muted-foreground)]">
                {isStudyViewer && activeSession
                  ? activeSession.title
                  : chatViewerDocument?.title ?? t("정리본을 선택하세요")}
              </p>
            </div>
          </div>
          {mode === "inline" ? (
            <Button variant="ghost" size="sm" onClick={openChatbotWindow}>
              <Maximize2 size={14} />
              {t("?덉갹")}</Button>
          ) : mode === "window" ? (
            <Button variant="ghost" size="icon" onClick={closeChatbotWindow}>
              <X size={18} />
            </Button>
          ) : (
            <div className="relative -top-1.5 flex items-center gap-1">
              {isStudyViewer && (
                <Button
                  aria-expanded={pdfChatSessionsOpen}
                  aria-label={t("질문 세션 목록")}
                  disabled={isBusy("chatbot-ask")}
                  onClick={() => void openPdfChatSessions()}
                  size="icon"
                  title={t("이전 대화 열기")}
                  variant="ghost"
                >
                  <History size={16} />
                </Button>
              )}
              {isStudyViewer && chatMessages.length > 0 && (
                pdfChatHistoryDeleteConfirm ? (
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-red-500">{t("이 대화 삭제?")}</span>
                    <Button onClick={() => setPdfChatHistoryDeleteConfirm(false)} size="sm" variant="ghost">{t("취소")}</Button>
                    <Button
                      disabled={isBusy("pdf-chat-history-clear")}
                      onClick={() => void handleClearPdfChatHistory()}
                      size="sm"
                      variant="danger"
                    >
                      {t("삭제")}</Button>
                  </div>
                ) : (
                  <Button
                    aria-label={t("현재 질문 세션 삭제")}
                    disabled={isBusy("chatbot-ask")}
                    onClick={() => setPdfChatHistoryDeleteConfirm(true)}
                    size="icon"
                    title={t("현재 대화 삭제")}
                    variant="ghost"
                  >
                    <Trash2 size={16} />
                  </Button>
                )
              )}
              <Button variant="ghost" size="icon" onClick={closeChatbotWindow}>
                <X size={18} />
              </Button>
            </div>
          )}
        </div>)}

        {isStudyViewer && pdfChatSessionsOpen && (
          <div className="absolute right-3 top-[3.6rem] z-30 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <span className="text-xs font-semibold">{t("질문 세션")}</span>
              <Button onClick={startNewPdfChatSession} size="sm" variant="ghost">
                <Plus size={14} /> {t("새 대화")}</Button>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {pdfChatSessions.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-[var(--muted-foreground)]">{t("저장된 대화가 없습니다.")}</div>
              ) : pdfChatSessions.map((session) => (
                <button
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--muted)]",
                    session.session_id === activePdfChatSessionId && "bg-[var(--muted)]",
                  )}
                  key={session.session_id}
                  onClick={() => {
                    setActivePdfChatSessionByDocument((current) => ({ ...current, [activeChatDocumentKey]: session.session_id }))
                    setPdfChatSessionsOpen(false)
                    setPdfChatHistoryDeleteConfirm(false)
                  }}
                  type="button"
                >
                  <MessageSquare className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{session.title}</span>
                    <span className="mt-0.5 block text-[10px] text-[var(--muted-foreground)]">
                      {t("질문 ")}{session.turn_count}{t("개 · ")}{new Date(session.updated_at).toLocaleDateString("ko-KR")}
                    </span>
                  </span>
                  {session.session_id === activePdfChatSessionId && <Check className="mt-0.5 shrink-0 text-[var(--brand)]" size={14} />}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className={cn(
            "ails-processbar-scroll min-h-0 flex-1 space-y-5 overflow-y-auto",
            mode === "window" ? "px-8 py-6" : mode === "home" ? "w-full max-w-none px-6 py-8" : "px-4 py-5",
          )}
          onScroll={(event) => {
            if (mode !== "inline") {
              chatbotWindowScrollTopByDocumentRef.current[activeChatMessageKey] = event.currentTarget.scrollTop
            }
          }}
          ref={bindScroll}
          data-ails-chat-scroll="true"
        >
          {chatMessages.length === 0 && mode !== "tutor" && (
            mode === "home" ? (
              <div className="relative flex min-h-full my-auto flex-col items-center justify-center py-4 text-center">
                <div className="w-full max-w-2xl mx-auto flex flex-col items-center">
                  <div className="mb-1.5 flex h-12 w-12 items-center justify-center">
                    <img alt="" className="h-11 w-11 object-contain" src={jackIconUrl} />
                  </div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">{t("AILS 학습 관리자")}</p>
                  <h1 className="text-2xl font-semibold tracking-[-0.035em] text-slate-900 dark:text-white sm:text-3xl">{t("무엇을 함께 해볼까요?")}</h1>
                  <p className="mt-4 whitespace-nowrap text-xs text-[var(--muted-foreground)]">
                    {t("자료를 찾고 학습 공간을 정리하거나, 다음 공부 계획을 함께 세울 수 있습니다.")}</p>

                  {/* 우측 상단 감성 문구 */}
                  <div className="pointer-events-none absolute right-6 top-3 hidden select-none text-right font-serif text-[11px] italic leading-snug tracking-wider text-slate-400/60 dark:text-white/20 xl:block">
                    오늘도,<br />
                    조금 더 성장하는<br />
                    당신을 위해.
                  </div>

                  {/* ── 중앙 카드형 컴포저 (Composer Card) ── */}
                  {showComposer && <div className="mt-3.5 w-full text-left" data-ails-home-composer={mode === "home"}>
                  <ChatGPTPlanIndicatorForConfig config={draftConfig} busy={isBusy("chatbot-ask")} onError={setNotice} />
                  <div className="rounded-2xl border border-slate-200/90 bg-white/95 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.05)] backdrop-blur-md focus-within:border-blue-500/80 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-white/[0.1] dark:bg-[#141724]/95 dark:shadow-black/30">
                    <Textarea
                      className="min-h-[44px] h-[44px] w-full resize-none border-0 bg-transparent px-1 py-0.5 text-xs sm:text-sm shadow-none focus-visible:ring-0 text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/40"
                      disabled={isBusy("chatbot-ask")}
                      name="chatbot-question"
                      value={chatInputDraft}
                      onChange={(event) => commitPdfChatDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault()
                          event.currentTarget.blur()
                          return
                        }
                        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        void handleAskChatbot(event.currentTarget.value)
                      }}
                      placeholder={t("학습 관련 질문이나 자료 정리를 요청해 보세요.")}
                      ref={chatInputRef}
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100/80 pt-1.5 dark:border-white/[0.06]">
                      <div className="flex items-center gap-1.5">
                        <button
                          aria-label={t("자료 추가")}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-white/60 dark:hover:bg-white/[0.1]"
                          onClick={() => {
                            setLectureAddExpanded(true)
                            setNotice(t("학습 자료 추가 입력창을 열었습니다."))
                          }}
                          title={t("자료 추가")}
                          type="button"
                        >
                          <Plus size={14} />
                        </button>

{!usesChatGPT && <ChatComposerControls modelFirst config={draftConfig} options={modelOptions}
                          reasoning={chatReasoningEffort} onReasoningChange={setChatReasoningEffort} onModelChange={handleChatbotAgentModelChange}
                          busy={isBusy("chatbot-ask")} savingModel={isBusy("chatbot-agent-model-save")} requireTools={chat.assist.aiAssistEnabled}
                          reasoningDisabled={chatbotSelection?.mode === "local" && chatbotSelection.provider === "llama.cpp"} />}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-slate-400 dark:text-white/40">
                          {voiceStatusText === "" ? t("Enter 전송 · Shift+Enter 줄바꿈") : voiceStatusText}
                        </span>
                        <button
                          aria-label={t("음성 입력")}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                            voiceState === "recording"
                              ? "bg-red-500 text-white animate-pulse"
                              : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.08] dark:text-white/50"
                          )}
                          onClick={() => void handleStartVoice()}
                          title={voiceState === "recording" ? t("음성 입력 중지") : t("음성 입력")}
                          type="button"
                        >
                          <Mic size={14} />
                        </button>
                        <Button
                          aria-label={isBusy("chatbot-ask") ? t("답변 생성 중지") : t("메시지 보내기")}
                          className="h-7 w-7 rounded-full bg-blue-600 p-0 text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
                          disabled={!isBusy("chatbot-ask") && !chatInputDraft.trim()}
                          onClick={() => isBusy("chatbot-ask") ? stopAnswer() : void handleAskChatbot(chatInputDraft)}
                          type="button"
                        >
                          {isBusy("chatbot-ask") ? <Square size={12} fill="currentColor" /> : <Send size={12} className="translate-x-0.5" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>}

                {/* ── 추천 액션 알약 (Action Chips) 2열 ── */}
                <div className="mt-2.5 flex w-full max-w-2xl flex-col items-center gap-1.5">
                  <div className="flex flex-wrap justify-center gap-1.5">
                    <button
                      className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs backdrop-blur-sm transition-all hover:border-blue-500 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                      onClick={() => {
                        if (recentFiles[0]) {
                          void handleOpenMaterialFile(recentFiles[0].path)
                        } else {
                          commitPdfChatDraft(t("최근 학습 이어가기"))
                          window.requestAnimationFrame(() => chatInputRef.current?.focus())
                        }
                      }}
                      type="button"
                    >
                      <Clock size={12} className="text-slate-400" />
                      {t("최근 학습 이어가기")}
                    </button>
                    <button
                      className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs backdrop-blur-sm transition-all hover:border-blue-500 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                      onClick={() => {
                        commitPdfChatDraft("PDF 학습 자료를 핵심 요점 위주로 깔끔하게 정리해줘")
                        window.requestAnimationFrame(() => chatInputRef.current?.focus())
                      }}
                      type="button"
                    >
                      <FileText size={12} className="text-slate-400" />
                      PDF 정리하기
                    </button>
                    <button
                      className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs backdrop-blur-sm transition-all hover:border-blue-500 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                      onClick={() => {
                        commitPdfChatDraft("현재 학습 자료의 취약점과 핵심 포인트를 특화 분석해줘")
                        window.requestAnimationFrame(() => chatInputRef.current?.focus())
                      }}
                      type="button"
                    >
                      <BarChart2 size={12} className="text-slate-400" />
                      특화 분석하기
                    </button>
                    <button
                      className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs backdrop-blur-sm transition-all hover:border-blue-500 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                      onClick={() => {
                        commitPdfChatDraft("교재 OCR 텍스트를 재추출하고 연습 문제를 검토해줘")
                        window.requestAnimationFrame(() => chatInputRef.current?.focus())
                      }}
                      type="button"
                    >
                      <RotateCcw size={12} className="text-slate-400" />
                      OCR 다시 실행
                    </button>
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    <button
                      className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs backdrop-blur-sm transition-all hover:border-blue-500 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                      onClick={() => {
                        commitPdfChatDraft("이해하기 어려운 핵심 이론과 개념을 예시와 함께 쉽게 설명해줘")
                        window.requestAnimationFrame(() => chatInputRef.current?.focus())
                      }}
                      type="button"
                    >
                      <GraduationCap size={12} className="text-slate-400" />
                      개념 설명 받기
                    </button>
                    <button
                      className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs backdrop-blur-sm transition-all hover:border-blue-500 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                      onClick={() => {
                        commitPdfChatDraft("이 단원에서 시험에 나올만한 예상 연습 문제를 만들어줘")
                        window.requestAnimationFrame(() => chatInputRef.current?.focus())
                      }}
                      type="button"
                    >
                      <PenLine size={12} className="text-slate-400" />
                      문제 만들어줘
                    </button>
                    <button
                      className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs backdrop-blur-sm transition-all hover:border-blue-500 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-blue-400 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                      onClick={() => {
                        commitPdfChatDraft("오늘 집중해서 공부할 추천 학습 분량과 일일 계획을 세워줘")
                        window.requestAnimationFrame(() => chatInputRef.current?.focus())
                      }}
                      type="button"
                    >
                      <Calendar size={12} className="text-slate-400" />
                      오늘 학습 계획 세우기
                    </button>
                  </div>
                </div>

                {/* ── 하단 정보 카드 2종 (최근 첨부 자료 / 최근 대화) ── */}
                <div className="mt-3.5 grid w-full grid-cols-1 gap-3 text-left md:grid-cols-2">
                  {/* 최근 첨부 자료 */}
                  <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 shadow-xs backdrop-blur-sm dark:border-white/[0.08] dark:bg-[#141724]/85">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-white">
                        <FileText className="text-slate-500" size={13} /> 최근 첨부 자료
                      </div>
                      <button
                        className="flex items-center gap-0.5 text-[10px] font-medium text-slate-400 hover:text-blue-600"
                        onClick={() => {
                          setSelectedLectureDocId("")
                          setWorkspaceSurface("document")
                        }}
                        type="button"
                      >
                        모두 보기 <ChevronRight size={11} />
                      </button>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {(recentFiles.length > 0 ? recentFiles.slice(0, 2) : [
                        { path: "sample-micro", title: "미시경제학 3주차 강의노트.pdf", kind: "PDF", size: "6.8 MB", date: "2025년 9월 16일" },
                        { path: "sample-ds", title: "자료구조 중간고사 정리.txt", kind: "TXT", size: "12 KB", date: "2025년 9월 14일" },
                      ]).map((item, idx) => (
                        <div
                          className="group flex cursor-pointer items-center justify-between rounded-lg p-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                          key={item.path || idx}
                          onClick={() => {
                            if (item.path && !item.path.startsWith("sample-")) {
                              void handleOpenMaterialFile(item.path)
                            } else {
                              commitPdfChatDraft(`${item.title} 내용을 바탕으로 핵심 요약을 해줘`)
                              window.requestAnimationFrame(() => chatInputRef.current?.focus())
                            }
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <div className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[9px] font-bold",
                              item.kind === "PDF" || item.title.endsWith(".pdf")
                                ? "bg-rose-50 text-rose-600 border border-rose-100 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/30"
                                : "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-white/[0.06] dark:text-white/70 dark:border-white/[0.08]"
                            )}>
                              {item.kind === "PDF" || item.title.endsWith(".pdf") ? "PDF" : "TXT"}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-semibold text-slate-800 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                                {item.title}
                              </div>
                              <div className="truncate text-[9px] text-slate-400 dark:text-white/40">
                                 {item.kind || "PDF"} · {item.size || "6.8 MB"}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[9px] tabular-nums text-slate-400 dark:text-white/40">
                               {item.date || (item.lastOpenedAt ? new Date(item.lastOpenedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "최근")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 최근 대화 */}
                  <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 shadow-xs backdrop-blur-sm dark:border-white/[0.08] dark:bg-[#141724]/85">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-white/[0.06]">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-white">
                        <MessageSquare className="text-slate-500" size={13} /> 최근 대화
                      </div>
                      <button
                        className="flex items-center gap-0.5 text-[10px] font-medium text-slate-400 hover:text-blue-600"
                        onClick={() => void openPdfChatSessions()}
                        type="button"
                      >
                        모두 보기 <ChevronRight size={11} />
                      </button>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {(pdfChatSessions.length > 0 ? pdfChatSessions.slice(0, 2).map((s) => ({
                        id: s.session_id,
                        title: s.title,
                        snippet: `질문 ${s.turn_count}개 · 저장된 대화`,
                        time: new Date(s.updated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
                      })) : [
                        { id: "c1", title: "선형대수학 핵심 개념 정리해줘", snippet: "고유값과 고유벡터 개념을 정리하고 주요 문제를...", time: "오후 3:24" },
                        { id: "c2", title: "이 PDF 내용을 요약해줘", snippet: "업로드된 미시경제학 자료를 챕터별로 정리해줘", time: "9월 15일" },
                      ]).map((item) => (
                        <div
                          className="group flex cursor-pointer items-center justify-between rounded-lg p-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                          key={item.id}
                          onClick={() => {
                            if (item.id !== "c1" && item.id !== "c2") {
                              setActivePdfChatSessionByDocument((current) => ({ ...current, [activeChatDocumentKey]: item.id }))
                            } else {
                              commitPdfChatDraft(item.title)
                              window.requestAnimationFrame(() => chatInputRef.current?.focus())
                            }
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-white/60">
                              <MessageSquare size={13} />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-semibold text-slate-800 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                                {item.title}
                              </div>
                              <div className="truncate text-[9px] text-slate-400 dark:text-white/40">
                                {item.snippet}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="text-[9px] tabular-nums text-slate-400 dark:text-white/40">
                              {item.time}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── 하단 푸터 ── */}
                <footer className="mt-3 text-center text-[9px] font-medium tracking-widest text-slate-400/80 dark:text-white/30 uppercase">
                  AILS · LEARN BETTER TOGETHER
                </footer>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-lg py-24 text-center text-sm leading-6 text-[var(--muted-foreground)]">
                {isStudyViewer
                  ? t("화면 아래 입력창에서 현재 페이지에 대해 질문하세요.")
                  : t("정리본을 보면서 바로 질문할 수 있습니다.")}
              </div>
            )
          )}
          {chatMessages.length > 0 && (
            <div className={cn("space-y-5", mode === "home" && "mx-auto w-full max-w-3xl")}>
              {chatMessages.map((message) => (
            <div
              className={cn(
                "group relative leading-6",
                mode === "window" ? "text-base" : "text-sm",
                message.role === "user"
                  ? cn("ml-auto max-w-[82%] rounded-2xl bg-[var(--muted)] px-4 py-2.5", mode === "window" && "max-w-[72%]")
                  : "select-text pr-1",
              )}
              key={message.id}
            >
              {message.role === "assistant" ? (
                <div
                  className={cn(
                    "max-w-none select-text break-words [&_.prose_p]:my-2 [&_.prose_pre]:my-2",
                    mode === "window" ? "text-base [&_.prose]:text-base" : "text-sm [&_.prose]:text-sm",
                    message.activity?.phase === "writing" && "ails-chatbot-streaming-text",
                  )}
                >
                  {message.activity && (
                    <div
                      aria-live="polite"
                      className="mb-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"
                      data-ails-chatbot-activity="true"
                      role="status"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--muted)]">
                        <Loader2 className="animate-spin" size={12} />
                      </span>
                      <span>{message.activity.label}</span>
                      <button
                        aria-label={t("답변 생성 중지")}
                        className="ml-1 rounded-md px-2 py-1 font-medium hover:bg-[var(--muted)]"
                        onClick={stopAnswer}
                        type="button"
                      >
                        {t("중지")}
                      </button>
                    </div>
                  )}
                  <ChatAnswerMarkdown content={message.content} timingId={message.generationFailed ? undefined : message.id} />
                  {!message.activity && <ChatAnswerEvidence evidence={message.evidence} />}
                  {message.webSearch && <WebSearchSources report={message.webSearch} />}
                  {message.generationStopped && (
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]" role="status">
                      {t("답변 생성을 중지했습니다.")}
                    </p>
                  )}
                  {mode === "tutor" && message.generationFailed && <button type="button" data-practice-tutor-retry className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-xs" disabled={isBusy("chatbot-ask")}
                    onClick={() => void handleAskChatbot(message.originalQuestion, undefined, { practiceContext: message.practiceContext })}>다시 시도</button>}
                  {message.answerSource && (
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                      <span>{
                        message.answerSource === "local"
                          ? t("로컬 답변")
                          : message.cloudMode === "supplement"
                            ? t("클라우드 보강")
                            : message.cloudMode === "fallback"
                              ? t("클라우드 대체")
                              : t("클라우드 답변")
                      }</span>
                      {message.answerSource === "local" && message.cloudRecommended && message.originalQuestion && (
                        <button
                          className="rounded border border-[var(--border)] px-2 py-0.5 font-semibold hover:bg-[var(--muted)]"
                          onClick={() => void handleAskChatbot(message.originalQuestion, undefined, { forceCloud: true, practiceContext: message.practiceContext })}
                          title={message.cloudReason || t("클라우드 AI로 답변을 보강합니다.")}
                          type="button"
                        >
                          {t("클라우드로 보강")}</button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="select-text whitespace-pre-wrap break-words">{message.content}</div>
              )}
              {message.role === "assistant" && mode !== "home" && (
                <ChatAnswerActions message={message} mode={mode === "window" ? "window" : "inline"}
                  onDragEnd={handleChatAnswerDragEnd} onDragStart={handleChatAnswerDragStart} onPointerDown={handleChatAnswerPointerDown}
                  onOpen={answer => { setSelectedChatbotAnswer(answer); setChatbotAnswerWindowOpen(true) }} />
              )}
            </div>
              ))}
            </div>
          )}
        </div>

        {showComposer && (mode === "tutor" || (!isStudyViewer && chatViewerDocument?.kind !== "pdf")) && <form
          className={cn(
            "border-t border-[var(--border)]",
            mode === "window" ? "p-5" : mode === "home" ? "mx-auto w-full max-w-3xl border-t-0 px-6 pb-7" : "p-3",
            mode === "home" && chatMessages.length === 0 && "hidden",
          )}
          data-ails-home-composer={mode === "home" ? "true" : undefined}
          onSubmit={(event) => {
            event.preventDefault()
            if (isBusy("chatbot-agent-model-save")) return
            const textarea = event.currentTarget.elements.namedItem("chatbot-question")
            const question = textarea instanceof HTMLTextAreaElement ? textarea.value : ""
            void handleAskChatbot(question)
          }}
        >
          {composerContext}
          {mode !== "tutor" && <ChatGPTPlanIndicatorForConfig config={draftConfig} busy={isBusy("chatbot-ask")} onError={setNotice} />}
          {composerControls}
          <div className={cn(mode === "home" && "rounded-[22px] border border-black/[0.09] bg-white/85 p-3 shadow-[0_12px_40px_rgba(28,25,23,0.08)] backdrop-blur-sm focus-within:border-black/[0.16] dark:border-white/[0.1] dark:bg-white/[0.06] dark:shadow-black/20")}>
            <Textarea
              className={cn("min-h-20 resize-none", mode === "home" && "min-h-[72px] border-0 bg-transparent px-2 py-1 shadow-none focus-visible:ring-0")}
              name="chatbot-question"
              value={chatInputDraft}
              onChange={(event) => commitPdfChatDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  event.currentTarget.blur()
                  return
                }
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                if (isBusy("chatbot-agent-model-save")) return
                void handleAskChatbot(event.currentTarget.value)
              }}
              placeholder={mode === "tutor" ? t("현재 문제에 대해 질문") : mode === "home" ? t("학습 공간 관리나 공부 계획을 요청하세요") : t("정리본에 대해 질문")}
              ref={chatInputRef}
            />
            <div className={cn("mt-2 flex items-center justify-between gap-2", mode === "home" && "px-1")}>
              <span className="text-xs text-[var(--muted-foreground)]">
                {mode === "home" && voiceStatusText === "" ? t("Enter 전송 · Shift+Enter 줄바꿈") : voiceStatusText}
              </span>
              <div className="flex min-w-0 items-center gap-1.5">
{mode === "home" && !usesChatGPT && <ChatComposerControls modelFirst config={draftConfig} options={modelOptions}
                  reasoning={chatReasoningEffort} onReasoningChange={setChatReasoningEffort} onModelChange={handleChatbotAgentModelChange}
                  busy={isBusy("chatbot-ask")} savingModel={isBusy("chatbot-agent-model-save")} requireTools={chat.assist.aiAssistEnabled}
                  reasoningDisabled={chatbotSelection?.mode === "local" && chatbotSelection.provider === "llama.cpp"} />}
                {isBusy("chatbot-ask") && <Button type="button" aria-label={t("답변 생성 중지")} onClick={stopAnswer}
                  className="ails-button-send shrink-0" size="icon"><Square size={15} fill="currentColor" /></Button>}
                <Button
                  aria-label={t("메시지 보내기")}
                  className={cn("ails-button-send shrink-0", mode === "home" && "h-9 w-9 rounded-full p-0")}
                  size={mode === "home" ? "icon" : "sm"}
                  type="submit"
                  disabled={isBusy("chatbot-agent-model-save")}
                >
                  <Send size={15} />
                  {mode !== "home" && t("보내기")}
                </Button>
              </div>
            </div>
          </div>
        </form>}
      </section>
    )
  }
