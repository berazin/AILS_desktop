import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react"

import type {
  AILSConfig,
  AILSReport,
  LectureMaterialsPayload,
  ModelOptionsPayload,
  PdfOcrStatus,
  PdfProblem,
  PdfSearchResult,
  PdfStudyChatSession,
  WorkPreflight,
} from "../../lib/api"
import {
  chatSessionMessageKey,
  extractChatConceptSummary,
} from "../../lib/chatbot-display.ts"
import { t } from "../../lib/i18n.ts"
import { chatDocumentKey, viewerDocumentIsPdf, type ViewerDocument } from "../../lib/viewer-document.ts"
import type { WorkspaceSessionState } from "../../lib/workspace-session-state.ts"
import { useChatAnswerWorkflows } from "../../features/chat/hooks/use-chat-answer-workflows.ts"
import type { ChatController } from "../../features/chat/hooks/use-chat-controller.ts"
import type { ChatVoiceWorkspace } from "../../features/chat/types/chat-workspace.ts"
import { useChatRequestWorkflows } from "../../features/chat/hooks/use-chat-request-workflows.ts"
import { useChatSessionWorkflows } from "../../features/chat/hooks/use-chat-session-workflows.ts"
import { useChatWindowWorkflows } from "../../features/chat/hooks/use-chat-window-workflows.ts"
import { useRealtimeVoiceTools } from "../../features/chat/hooks/use-realtime-voice-tools.ts"
import type { WorkspaceSurface } from "../../shared/workspace-types.ts"
import type { VoiceController } from "../../features/voice/hooks/use-voice-controller.ts"
import { useVoiceSessionWorkflows } from "../../features/voice/hooks/use-voice-session-workflows.ts"

type RunInteraction = Parameters<typeof useChatRequestWorkflows>[0]["shell"]["runInteraction"]

type UseChatVoiceWorkspaceOptions = {
  practiceContext?: import("../../lib/api/practice-tutor.ts").PracticeTutorContext | null
  onPracticeTutorFocus?: () => void
  chat: ChatController
  codeSandboxKeyboardCaptured: boolean
  config: {
    draft: AILSConfig
    modelOptions: ModelOptionsPayload | null
    normalize: (config: AILSConfig, providerOptions?: readonly string[]) => AILSConfig
    providerOptions?: readonly string[]
    setDraft: Dispatch<SetStateAction<AILSConfig>>
    setModelOptions: Dispatch<SetStateAction<ModelOptionsPayload | null>>
    statusVoiceProvider?: string
  }
  document: {
    openDocuments: ViewerDocument[]
    activePdfPath: string
    applyMarkdownContent: (content: string, previousContent: string) => Promise<void>
    currentPage: number
    currentViewerDraft: string
    getLatestPage: () => number
    getPdfPageText: (page: number) => Promise<string>
    goToPage: (page: number) => void
    ocrStatus?: PdfOcrStatus | null
    ocrStatusMatchesActivePath: boolean
    openMaterial: (path: string) => Promise<unknown>
    pageCount: number
    refreshMaterials: () => Promise<unknown>
    report: AILSReport | null
    requestOcr: () => Promise<unknown>
    searchPdf: (query: string) => Promise<PdfSearchResult[]>
    selectProblem: (problem: PdfProblem) => void
    selectedProblemId: string
    viewer: ViewerDocument | null
    visiblePages: number[]
  }
  interaction: {
    confirmCloudPreflight: () => Promise<WorkPreflight | null | false>
    onApiError: (message: string) => void
    requestExpertFallback: (request: { error: string; selectedModel: string; recommendedModel: string }) => Promise<"cancel" | "recommended" | "retry">
    runInteraction: RunInteraction
    setNotice: Dispatch<SetStateAction<string>>
  }
  materials: {
    lectureMaterials: LectureMaterialsPayload | null
  }
  pdf: {
    hasOcrWork: boolean
    problems: PdfProblem[]
  }
  sessionRef: MutableRefObject<WorkspaceSessionState | null>
  shell: {
    chatbotVisibleOnHome: boolean
    closePractice: () => void
    closeSettings: () => void
    codingModeActive: boolean
    editMode: boolean
    fullscreenOpen: boolean
    helpOpen: boolean
    openSettings: () => void
    resetQuestionHistory: () => void
    setHelpOpen: Dispatch<SetStateAction<boolean>>
    setMaterialsPanelOpen: Dispatch<SetStateAction<boolean>>
    setSurface: Dispatch<SetStateAction<WorkspaceSurface>>
    settingsOpen: boolean
    materialsPanelOpen: boolean
    surface: WorkspaceSurface
  }
  textEntryActiveRef: RefObject<boolean>
  voice: VoiceController
}

export function useChatVoiceWorkspace({
  practiceContext,
  onPracticeTutorFocus,
  chat,
  codeSandboxKeyboardCaptured,
  config,
  document,
  interaction,
  materials,
  pdf,
  sessionRef,
  shell,
  textEntryActiveRef,
  voice,
}: UseChatVoiceWorkspaceOptions): ChatVoiceWorkspace {
  const {
    api: { askChatbotExpert, savePdfStudyChatTurn, searchContext },
    agentModel: { chatbotAgentModelOpen, chatbotAgentModelPickerRef, setChatbotAgentModelOpen },
    assist: {
      aiAssistEnabled,
      retrievalStateByDocument,
      setAiAssistEnabled,
      setRetrievalStateByDocument,
    },
    input: { chatInputDraftRef, pdfQuickChatInputRef, setChatInputDraft },
    messages: { setMessagesForKey },
    pdf: {
      pdfChatContextRef,
      setActivePdfChatSessionByDocument,
      setPdfChatSessions,
      setPdfQuickChatOpen,
    },
    window: { chatbotWindowOpen },
  } = chat
  const {
    refs: { agentMetaRef },
    state: { voiceState },
  } = voice
  const normalViewer = shell.surface === "document" ? document.viewer : null
  const chatViewerDocument = practiceContext && normalViewer?.file_path !== practiceContext.source_path
    ? { id: practiceContext.source_path, file_path: practiceContext.source_path,
      kind: practiceContext.source_kind === "pdf" ? "pdf" : "md", title: practiceContext.source_path.split(/[\\/]/).pop() ?? "문제풀이" } as ViewerDocument
    : normalViewer
  const isStudyViewer = Boolean(chatViewerDocument)
  const activeChatDocumentKey = chatDocumentKey(chatViewerDocument)
  const activeStudyPath = practiceContext?.source_path || (chatViewerDocument ? document.activePdfPath || chatViewerDocument.file_path || "" : "")
  const chatSessions = useChatSessionWorkflows({
    chat,
    document: {
      isPdf: isStudyViewer,
      key: activeChatDocumentKey,
      pdfPath: activeStudyPath,
      openDocuments: document.openDocuments,
    },
    onNotice: interaction.setNotice,
    runInteraction: interaction.runInteraction,
  })
  const activePdfChatSessionId = chatSessions.activePdfSessionId

  function capturePdfChatContext() {
    const viewer = document.viewer
    if (shell.surface !== "document" || !viewer || !document.activePdfPath || !viewerDocumentIsPdf(viewer)) return
    pdfChatContextRef.current = {
      documentKey: viewer.id,
      path: document.activePdfPath,
      pages: [...document.visiblePages],
    }
  }

  function handleDraftChange(value: string) {
    if (!chatInputDraftRef.current && value) capturePdfChatContext()
    if (!value) pdfChatContextRef.current = null
    chatInputDraftRef.current = value
    if (sessionRef.current?.chatbot) sessionRef.current.chatbot.draft = value
  }

  function commitDraft(value: string) {
    handleDraftChange(value)
    setChatInputDraft(value)
  }

  async function persistAgentTurnToChatbot(title: string, content: string, utterance: string) {
    const trimmedContent = content.trim()
    if (!trimmedContent) throw new Error(t("챗봇에 저장할 내용이 비어 있습니다."))
    const trimmedTitle = title.trim() || t("학습 내용 저장")
    const savedQuestion = utterance.trim() || trimmedTitle
    const turnId = crypto.randomUUID()
    const studyQuestion = Boolean(activeStudyPath)
    const sessionId = studyQuestion ? activePdfChatSessionId || crypto.randomUUID() : ""
    if (studyQuestion && !activePdfChatSessionId) {
      setActivePdfChatSessionByDocument((current) => ({ ...current, [activeChatDocumentKey]: sessionId }))
    }
    setMessagesForKey(chatSessionMessageKey(activeChatDocumentKey, sessionId), (current) => [
      ...current,
      { id: `${turnId}-user`, role: "user", content: savedQuestion },
      { id: `${turnId}-assistant`, role: "assistant", content: trimmedContent, title: trimmedTitle },
    ])
    if (!studyQuestion) {
      interaction.setNotice(t("\"{p0}\" 제목으로 챗봇에 저장했습니다.", { p0: trimmedTitle }))
      return
    }
    const meta = agentMetaRef.current
    try {
      const { turn, created } = await savePdfStudyChatTurn({
        pdf_path: activeStudyPath,
        turn_id: turnId,
        session_id: sessionId,
        question: savedQuestion,
        answer: trimmedContent,
        concept_summary: extractChatConceptSummary(trimmedContent),
        model: meta.model || "ails-agent",
        provider: meta.provider || "AILS Cloud",
      })
      if (created) {
        setPdfChatSessions((current) => {
          const existing = current.find((session) => session.session_id === sessionId)
          const updated: PdfStudyChatSession = {
            session_id: sessionId,
            title: existing?.title ?? trimmedTitle,
            turn_count: (existing?.turn_count ?? 0) + 1,
            created_at: existing?.created_at ?? turn.created_at,
            updated_at: turn.created_at,
          }
          return [updated, ...current.filter((session) => session.session_id !== sessionId)]
        })
      }
      interaction.setNotice(t("\"{p0}\" 제목으로 챗봇에 저장했습니다.", { p0: trimmedTitle }))
    } catch (error) {
      interaction.setNotice(t("챗봇 대화에는 저장했지만 기록 영속화에 실패했습니다."))
      voiceSession.reportError(error)
    }
  }

  const realtimeTools = useRealtimeVoiceTools({
    workspace: {
      getSnapshot: () => ({
        activePdfPath: document.activePdfPath,
        chatbotOpen: chatbotWindowOpen,
        codingModeActive: shell.codingModeActive,
        currentPage: document.currentPage,
        document: document.viewer,
        editMode: shell.editMode,
        expertModelName: "auto",
        fullscreenOpen: shell.fullscreenOpen,
        helpOpen: shell.helpOpen,
        latestPage: document.getLatestPage(),
        ocrActive: pdf.hasOcrWork,
        pageCount: document.pageCount,
        problems: pdf.problems,
        reportTitle: String(document.report?.title || ""),
        selectedProblemId: document.selectedProblemId,
        settingsOpen: shell.settingsOpen,
        sidebarVisible: shell.materialsPanelOpen,
        surface: shell.surface,
      }),
      closeSettings: shell.closeSettings,
      openSettings: shell.openSettings,
      setHelpOpen: shell.setHelpOpen,
      setSidebarVisibility: (visibility) => {
        shell.setMaterialsPanelOpen((current) => visibility === "toggle" ? !current : visibility === "show")
      },
      setSurface: shell.setSurface,
      openChatbot: () => chatWindow.open(),
      closeChatbot: () => chatWindow.close(),
    },
    document: {
      closePractice: shell.closePractice,
      getPdfPageText: document.getPdfPageText,
      goToPage: document.goToPage,
      openMaterial: document.openMaterial,
      requestOcr: document.requestOcr,
      searchPdfDocument: document.searchPdf,
      selectProblem: document.selectProblem,
    },
    materials: { getMaterials: () => materials.lectureMaterials },
    chat: {
      askExpert: askChatbotExpert,
      getRetrievalState: (documentId) => retrievalStateByDocument[documentId],
      requestExpertFallback: interaction.requestExpertFallback,
      saveTurn: persistAgentTurnToChatbot,
      searchContext,
      setAutoExpertModel: (modelId) => {
        config.setModelOptions((current) => current ? {
          ...current,
          chatbot_expert_auto_model_id: modelId,
        } : current)
      },
      setRetrievalState: (documentId, state) => {
        setRetrievalStateByDocument((current) => {
          if (state) return { ...current, [documentId]: state }
          const next = { ...current }
          delete next[documentId]
          return next
        })
      },
    },
    interaction: { setNotice: interaction.setNotice },
  })
  const voiceSession = useVoiceSessionWorkflows({
    aiAssistEnabled,
    buildContext: realtimeTools.buildContext,
    confirmCloudPreflight: interaction.confirmCloudPreflight,
    executeTool: realtimeTools.executeTool,
    getProvider: () => aiAssistEnabled
      ? "local"
      : String(config.statusVoiceProvider ?? config.draft.voice_agent_provider ?? "local"),
    onAiAssistEnabledChange: setAiAssistEnabled,
    onApiError: interaction.onApiError,
    onDraftChange: commitDraft,
    onDraftCommitted: (value) => {
      if (shell.surface === "dashboard" || viewerDocumentIsPdf(document.viewer) || document.viewer?.kind === "md") setPdfQuickChatOpen(Boolean(value.trim()))
    },
    onNotice: interaction.setNotice,
    onTranscript: (value) => {
      if (pdfQuickChatInputRef.current) pdfQuickChatInputRef.current.value = value
    },
    voice,
  })
  const chatbotSelection = config.draft.ai_model_selection?.features?.chatbot ?? config.draft.ai_model_selection?.default
  const selectedModelId = chatbotSelection?.mode === "managed" ? chatbotSelection.modelId : "managed_default"
  const selectedModel = config.modelOptions?.chatbot_agent_models?.find((model) => model.id === selectedModelId)
  const requests = useChatRequestWorkflows({
    practiceContext,
    onPracticeTutorFocus,
    agent: {
      executeTool: realtimeTools.executeTool,
      onMetaChange: (meta) => {
        agentMetaRef.current = meta
      },
    },
    chat,
    config: {
      cloudFallbackPolicy: String(config.draft.ai_assist_cloud_fallback_policy ?? "manual") === "automatic"
        ? "automatic"
        : "manual",
      models: config.modelOptions?.chatbot_agent_models,
      modelSettings: config.draft.ai_model_selection,
      providerSettings: config.draft.ai_provider_settings,
      onSavedConfig: (savedConfig) => {
        config.setDraft(config.normalize(savedConfig, config.providerOptions))
      },
      selectedModelId,
      selectedModelLocal: Boolean(selectedModel?.local),
    },
    document: {
      activeDocumentKey: activeChatDocumentKey,
      activePdfPath: activeStudyPath,
      activePdfSessionId: activePdfChatSessionId,
      currentPage: document.currentPage,
      getLatestPage: document.getLatestPage,
      ocrStatus: document.ocrStatus,
      ocrStatusMatchesActivePath: document.ocrStatusMatchesActivePath,
      viewer: chatViewerDocument,
    },
    shell: {
      onNotice: interaction.setNotice,
      runInteraction: interaction.runInteraction,
      workspaceSurface: shell.surface,
    },
    voice: {
      state: voiceState,
      stop: voiceSession.stop,
    },
  })
  const answers = useChatAnswerWorkflows({
    chat,
    document: {
      applyMarkdownContent: document.applyMarkdownContent,
      currentContent: document.viewer?.raw_content ?? document.viewer?.content ?? "",
      isMarkdown: document.viewer?.kind === "md",
      previousContent: document.currentViewerDraft || document.viewer?.raw_content || document.viewer?.content || "",
      targetFilePath: document.viewer?.file_path || document.report?.file_path,
    },
    refreshMaterials: document.refreshMaterials,
    runInteraction: interaction.runInteraction,
  })
  const chatbotVisible = chatbotWindowOpen || shell.chatbotVisibleOnHome
  const chatWindow = useChatWindowWorkflows({
    activeMessageKey: chatSessions.activeMessageKey,
    chat,
    chatbotVisible,
    codeSandboxKeyboardCaptured,
    latestAssistantMessageId: chatSessions.latestAssistantMessageId,
    messages: chatSessions.messages,
    onDropAnswer: answers.saveAnswer,
    setNotice: interaction.setNotice,
    textEntryActiveRef,
    viewerDocument: document.viewer,
  })

  useEffect(() => {
    if (!chatbotAgentModelOpen) return undefined
    const closePicker = (event: PointerEvent) => {
      if (!chatbotAgentModelPickerRef.current?.contains(event.target as Node)) setChatbotAgentModelOpen(false)
    }
    globalThis.document.addEventListener("pointerdown", closePicker, true)
    return () => globalThis.document.removeEventListener("pointerdown", closePicker, true)
  }, [chatbotAgentModelOpen, chatbotAgentModelPickerRef, setChatbotAgentModelOpen])

  const resetQuestionHistory = shell.resetQuestionHistory
  useEffect(() => {
    resetQuestionHistory()
  }, [activeChatDocumentKey, document.activePdfPath, isStudyViewer, resetQuestionHistory])

  return {
    activeChatDocumentKey,
    reasoningAvailable: !selectedModel?.local,
    answers,
    chat,
    chatViewerDocument,
    draft: {
      commit: commitDraft,
      onChange: handleDraftChange,
    },
    requests,
    sessions: chatSessions,
    voice,
    voiceSession,
    window: chatWindow,
  }
}
