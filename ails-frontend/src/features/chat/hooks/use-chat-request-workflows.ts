import { PERSONAL_MODE } from "../../../edition.ts"
import { mergeEvidence, type AnswerEvidence } from "../lib/answer-evidence.ts"
import { mergeWebSearchReports } from "../lib/web-search-report.ts"
import { useEffect, useRef } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

import { waitForInitialDocument } from '../../../lib/initial-document-readiness.ts'
import {
  askChatbotStream,
  ensurePracticeTutorSupport,
  getManagedChatbotCatalog,
  validateManagedChatbotModel,
  getAiAssistStatus,
  getPdfOcrPage,
  getPdfOcrStatus,
  mergeChatbotUsageTotals,
  saveConfig,
  savePdfStudyChatTurn,
  stopAiAssist,
  warmupAiAssist,
  type ChatbotResponse,
  type ChatbotModelOption,
  type ChatbotUsage,
  type AILSConfig,
  type ModelSettings,
  type PdfOcrStatus,
  type PdfStudyChatSession,
  type RealtimeVoiceToolCall,
  type RealtimeVoiceToolRound,
} from "../../../lib/api"
import {
  chatbotAnswerForDisplay,
  chatbotAnswerTitle,
  chatbotModelName,
  chatbotQuestionForDisplay,
  chatbotToolLabel,
  chatSessionMessageKey,
  extractChatConceptSummary,
} from "../../../lib/chatbot-display.ts"
import { t } from "../../../lib/i18n.ts"
import { RESEARCH_TOOL_NAMES } from "../../../lib/api/research-tools.ts"
import { viewerDocumentIsPdf } from "../../../lib/viewer-document.ts"
import { practiceTutorLabel, type PracticeTutorContext } from "../../../lib/api/practice-tutor.ts"
import type { ChatController, ChatMessage } from "./use-chat-controller.ts"
import { prepareChatInputs } from "../lib/chat-preflight.ts"
import { startChatLatency, markChatLatency, linkChatLatency } from "../lib/chat-latency.ts"
import { waitForChatTask } from "../lib/chat-request-cancellation.ts"
import { useChatTextVerbosity } from "./use-chat-text-verbosity.ts"
import { managedChatbotSelection, selectedCatalogModel } from "../lib/chat-model-catalog.ts"
import type { AiProviderSettings } from "../../../lib/api/chatgpt.ts"

type ChatDocument = {
  id: string
  file_path?: string
  kind: string
  rendered_file_path?: string
}

type ChatRequestDocumentPort = {
  activeDocumentKey: string
  activePdfPath: string
  activePdfSessionId: string
  currentPage: number
  getLatestPage: () => number
  ocrStatus?: PdfOcrStatus | null
  ocrStatusMatchesActivePath: boolean
  viewer: ChatDocument | null
}

type ChatRequestAgentPort = {
  executeTool: (call: RealtimeVoiceToolCall, question: string) => Promise<{ content: string }>
  onMetaChange: (meta: { model: string; provider: string }) => void
}

type ChatRequestShellPort = {
  onNotice: (message: string) => void
  runInteraction: (
    key: string,
    label: string,
    action: () => Promise<string | void>,
    onError?: (error: unknown) => void,
    options?: { replace?: boolean },
  ) => Promise<void>
  workspaceSurface: string
}

type ChatRequestVoicePort = {
  state: string
  stop: () => Promise<void>
}

type UseChatRequestWorkflowsOptions = {
  practiceContext?: PracticeTutorContext | null
  onPracticeTutorFocus?: () => void
  agent: ChatRequestAgentPort
  chat: ChatController
  config: {
    cloudFallbackPolicy: "automatic" | "manual"
    models?: ChatbotModelOption[]
    modelSettings?: ModelSettings
    providerSettings?: AiProviderSettings
    onSavedConfig: (config: AILSConfig) => void
    selectedModelId: string
    selectedModelLocal: boolean
  }
  document: ChatRequestDocumentPort
  shell: ChatRequestShellPort
  voice: ChatRequestVoicePort
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useChatRequestWorkflows({
  practiceContext: currentTutorContext,
  onPracticeTutorFocus,
  agent,
  chat,
  config,
  document,
  shell,
  voice,
}: UseChatRequestWorkflowsOptions) {
  const { verbosity: chatTextVerbosity } = useChatTextVerbosity()
  const activeRequest = useRef<AbortController | null>(null)
  const isCurrentDocument = useEventCallback((key: string) => document.activeDocumentKey === key)
  const isCurrentSession = useEventCallback((key: string, sessionId: string) =>
    document.activeDocumentKey === key && document.activePdfSessionId === sessionId)
  useEffect(() => () => activeRequest.current?.abort(), [])

  function stopAnswer() {
    activeRequest.current?.abort()
  }

  const {
    agentModel: { setChatbotAgentModelOpen },
    assist: {
      aiAssistBusy,
      aiAssistEnabled,
      retrievalStateByDocument,
      setAiAssistBusy,
      setAiAssistEnabled,
      setRetrievalStateByDocument,
    },
    input: {
      chatReasoningEffort,
      chatInputDraftRef,
      chatInputRef,
      pdfQuickChatInputRef,
      setChatInputDraft,
    },
    messages: {
      chatMessagesByDocument,
      replaceMessage,
      setMessagesForKey,
      updateMessage,
    },
    pdf: {
      pdfChatContextRef,
      setActivePdfChatSessionByDocument,
      setPdfChatSessions,
      setPdfQuickChatOpen,
    },
    selection: { chatSelectedTextContextRef },
    window: {
      chatbotWindowOpen,
      setChatbotWindowOpen,
      setChatbotWindowScrollMode,
      shouldFocusChatbotInputRef,
    },
  } = chat

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    void waitForInitialDocument(controller.signal).then(() => getAiAssistStatus())
      .then((status) => {
        if (!cancelled) setAiAssistEnabled(status.resident)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [setAiAssistEnabled])

  async function toggleAiAssist() {
    if (aiAssistBusy) return
    if (aiAssistEnabled) {
      setPdfQuickChatOpen(false)
      setAiAssistBusy(true)
      try {
        if (voice.state !== "idle") await voice.stop()
        const response = await stopAiAssist()
        setAiAssistEnabled(response.resident === true)
        shell.onNotice(t("AI Assist를 껐습니다. 로컬 AI 메모리를 해제했습니다."))
      } catch (error) {
        const status = await getAiAssistStatus().catch(() => null)
        if (status) setAiAssistEnabled(status.resident)
        shell.onNotice(t("AI Assist 종료 확인 실패: {p0}", { p0: getErrorMessage(error) }))
      } finally {
        setAiAssistBusy(false)
      }
      return
    }
    setAiAssistBusy(true)
    try {
      const response = await warmupAiAssist(config.selectedModelLocal ? { model_id: config.selectedModelId } : {})
      setAiAssistEnabled(response.resident)
      shell.onNotice(response.resident ? t("AI Assist가 로컬 AI를 메모리에 올렸습니다.") : t("로컬 AI가 상주 상태가 아닙니다."))
    } catch (error) {
      setAiAssistEnabled(false)
      shell.onNotice(t("로컬 AI를 준비하지 못했습니다: {p0}", { p0: getErrorMessage(error) }))
    } finally {
      setAiAssistBusy(false)
    }
  }

  async function changeAgentModel(modelId: string, options: { requireTools?: boolean } = {}) {
    setChatbotAgentModelOpen(false)
    await shell.runInteraction("chatbot-agent-model-save", t("에이전트 AI 변경"), async () => {
      const currentSettings = config.modelSettings ?? { default: { mode: "managed_default" as const }, features: {} }
      const features = { ...currentSettings.features }
      const chatgptId = modelId.startsWith("chatgpt:") ? modelId.slice("chatgpt:".length) : null
      const providerSettings = config.providerSettings ?? (chatgptId ? { default: "ails" as const, features: {}, chatgpt_model: "" } : undefined)
      if (modelId !== "managed_default" && !chatgptId) await validateManagedChatbotModel(modelId, options.requireTools ?? aiAssistEnabled)
      if (modelId === "managed_default") delete features.chatbot
      else if (chatgptId) features.chatbot = { mode: "managed", modelId: `openai/${chatgptId}` }
      else features.chatbot = { mode: "managed", modelId }
      const { config: savedConfig } = await saveConfig({
        ai_model_selection: { ...currentSettings, features },
          ...(providerSettings ? {
          ai_provider_settings: { ...providerSettings, ...(chatgptId ? { chatgpt_model: chatgptId } : {}),
              features: { ...providerSettings.features, chatbot: modelId === "managed_default" ? "default" as const : chatgptId ? "chatgpt" as const : "ails" as const } },
        } : {}),
      })
      config.onSavedConfig(savedConfig)
      if (aiAssistEnabled) {
        setAiAssistBusy(true)
        try {
          if (voice.state !== "idle") await voice.stop()
          const response = await stopAiAssist()
          setAiAssistEnabled(response.resident === true)
        } finally {
          setAiAssistBusy(false)
        }
      }
      return t("{p0} 모델을 선택했습니다.", { p0: chatbotModelName(modelId, config.models) })
    })
  }

  async function consumePdfContext(signal: AbortSignal, includedPages: number[]) {
    const captured = pdfChatContextRef.current
    pdfChatContextRef.current = null
    if (!captured || captured.documentKey !== document.activeDocumentKey || captured.path !== document.activePdfPath) return ""
    try {
      const status = document.ocrStatusMatchesActivePath && document.ocrStatus
        ? document.ocrStatus
        : await getPdfOcrStatus(captured.path, signal)
      if (!status.has_text || status.index_source !== "paddleocr") return ""
      const pages = await Promise.all(captured.pages.map((page) => getPdfOcrPage(captured.path, page, signal)))
      if (pages.some((page) => !page.text.trim())) return ""
      let text = ""
      const limit = aiAssistEnabled ? 3800 : Number.POSITIVE_INFINITY
      for (let index = 0; index < pages.length && text.length < limit; index++) {
        const separator = text ? "\n\n---\n\n" : ""
        const excerpt = pages[index].text.trim().slice(0, Math.max(0, limit - text.length - separator.length))
        if (!excerpt) break
        text += separator + excerpt
        includedPages.push(captured.pages[index])
      }
      return text
    } catch {
      return ""
    }
  }

  async function askChatbot(
    questionText?: string,
    displayQuestionText?: string,
    options: { forceCloud?: boolean; practiceContext?: PracticeTutorContext } = {},
  ) {
    const submittedAt = performance.now()
    const reasoningEffort = chatReasoningEffort
    const textVerbosity = chatTextVerbosity
    const practiceContext = options.practiceContext ?? currentTutorContext
    const tutorContext = practiceContext ? structuredClone(practiceContext) : undefined
    const promptQuestion = (questionText ?? pdfQuickChatInputRef.current?.value ?? chatInputRef.current?.value ?? "").trim()
    const visibleQuestion = (tutorContext ? `[문제 ${practiceTutorLabel(tutorContext)}]\n` : "") + chatbotQuestionForDisplay(promptQuestion, displayQuestionText)
    if (!promptQuestion || !visibleQuestion) {
      shell.onNotice(t("챗봇 질문을 입력하세요."))
      return
    }
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const pdfQuestion = viewerDocumentIsPdf(document.viewer) && Boolean(document.activePdfPath)
    const selectedTextContext = chatSelectedTextContextRef.current
    if (tutorContext?.include_context && selectedTextContext?.documentKey === document.activeDocumentKey) tutorContext.selected_text = selectedTextContext.text
    chatSelectedTextContextRef.current = null
    const selectedPdfPages: number[] = []
    const selectionTask = tutorContext ? Promise.resolve("") : pdfQuestion
      ? consumePdfContext(controller.signal, selectedPdfPages)
      : Promise.resolve(selectedTextContext?.documentKey === document.activeDocumentKey ? selectedTextContext.text : "")
    const pageAtSubmission = document.getLatestPage() ?? document.currentPage
    const documentId = document.activePdfPath && pdfQuestion
      ? document.activePdfPath
      : document.viewer?.file_path || document.viewer?.id || ""
    // 저장 키는 디스크의 실제 파일 경로만 쓴다. 백엔드 저장 흐름이 파일 존재를 요구하므로 세션 문서의 viewer.id로 대체하지 않는다.
    const studyDocumentPath = tutorContext?.source_path || document.activePdfPath || document.viewer?.file_path || ""
    const isStudyQuestion = Boolean(tutorContext) || pdfQuestion || (shell.workspaceSurface === "document" && Boolean(document.viewer))
    const turnId = crypto.randomUUID()
    const requestDocumentKey = tutorContext?.source_path || document.activeDocumentKey
    const selectedSessionId = tutorContext ? chat.pdf.activePdfChatSessionByDocument[requestDocumentKey] : document.activePdfSessionId
    const sessionId = isStudyQuestion ? selectedSessionId || crypto.randomUUID() : ""
    const messageKey = chatSessionMessageKey(requestDocumentKey, sessionId)
    if (isStudyQuestion && !selectedSessionId) {
      setActivePdfChatSessionByDocument((current) => ({ ...current, [requestDocumentKey]: sessionId }))
    }
    const userMessage: ChatMessage = { id: `${turnId}-user`, role: "user", content: visibleQuestion, practiceContext: tutorContext }
    const history = (chat.messages.chatMessagesByDocumentRef?.current ?? chatMessagesByDocument)[messageKey] ?? []
    if (!tutorContext && (shell.workspaceSurface === "document" || shell.workspaceSurface === "dashboard") && !chatbotWindowOpen) {
      setChatbotWindowOpen(true)
      setChatbotWindowScrollMode("bottom")
    }
    if (shell.workspaceSurface !== "document") setChatbotWindowScrollMode("bottom")
    setMessagesForKey(messageKey, (current) => [...current, userMessage])
    chatInputDraftRef.current = ""
    setChatInputDraft("")
    setPdfQuickChatOpen(false)
    if (chatInputRef.current) chatInputRef.current.value = ""
    if (pdfQuickChatInputRef.current) pdfQuickChatInputRef.current.value = ""
    const assistantMessageId = `${turnId}-assistant`
    startChatLatency(assistantMessageId, submittedAt)
    const latency = (stage: Parameters<typeof markChatLatency>[1]) => markChatLatency(assistantMessageId, stage)
    await shell.runInteraction("chatbot-ask", t("챗봇 응답 생성"), async () => {
      setMessagesForKey(messageKey, (current) => [
        ...current,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          activity: { phase: "thinking", label: t("요청을 분석하고 있습니다") },
          title: chatbotAnswerTitle(visibleQuestion),
          originalQuestion: promptQuestion,
          practiceContext: tutorContext,
        },
      ])

      let pendingTokenText = ""
      let streamedAnswer = ""
      let flushScheduled = false
      let hasStreamedText = false
      const roundUsages: ChatbotUsage[] = []
      const flushPendingTokens = () => {
        flushScheduled = false
        if (!pendingTokenText) return
        streamedAnswer += pendingTokenText
        pendingTokenText = ""
        replaceMessage(assistantMessageId, chatbotAnswerForDisplay(streamedAnswer), messageKey)
        latency("first_ui_update")
      }
      const scheduleTokenFlush = () => {
        if (flushScheduled) return
        flushScheduled = true
        window.requestAnimationFrame(flushPendingTokens)
      }
      const markStopped = () => {
        flushPendingTokens()
        updateMessage(assistantMessageId, { activity: undefined, generationStopped: true }, messageKey)
      }
      controller.signal.addEventListener("abort", markStopped, { once: true })

      try {
        latency("preflight_start")
        const managedId = PERSONAL_MODE ? null : managedChatbotSelection(config.modelSettings, config.providerSettings)
        const needsCatalog = managedId !== null && !config.selectedModelLocal && Boolean(config.modelSettings)
        const [selectionContext, catalog] = await prepareChatInputs(selectionTask,
          () => needsCatalog ? getManagedChatbotCatalog() : Promise.resolve(null), controller.signal)
        const assistSelectionContext = pdfQuestion
          ? [t("현재 페이지: {p0}", { p0: pageAtSubmission }), selectionContext].filter(Boolean).join("\n") : selectionContext
        const activeContext = aiAssistEnabled ? "" : selectionContext
        if (tutorContext) await waitForChatTask(ensurePracticeTutorSupport(), controller.signal)
        controller.signal.throwIfAborted()
        const toolRounds: RealtimeVoiceToolRound[] = []
        let allowManagedTools = true
        if (catalog && managedId !== null) {
          controller.signal.throwIfAborted()
          const selected = selectedCatalogModel(catalog, managedId)
          if (!selected?.available) throw new Error(t("선택한 모델을 사용할 수 없습니다. 대체 모델을 직접 선택해 주세요."))
          if (reasoningEffort !== "default" && !selected.reasoning.values.includes(reasoningEffort)) throw new Error(t("선택한 모델에서 지원하는 추론 수준을 선택해 주세요."))
          allowManagedTools = selected.tools === true
          if (!tutorContext && aiAssistEnabled && !allowManagedTools) throw new Error(t("에이전트 작업에는 도구 호출을 지원하는 모델이 필요합니다."))
        }
        latency("preflight_ready")
        const failedCalls = new Map<string, string>()
        let response: ChatbotResponse | undefined
        let continueWithCloud = Boolean(options.forceCloud)
        let answerEvidence: AnswerEvidence[] = []
        let responseCloudMode: ChatMessage["cloudMode"] = options.forceCloud ? "supplement" : undefined
        // Reserve the last model response to summarize results without more actions.
        for (let round = 0; round <= 5; round += 1) {
          controller.signal.throwIfAborted()
          const calls: RealtimeVoiceToolCall[] = []
          updateMessage(assistantMessageId, {
            activity: {
              phase: round === 0 ? "thinking" : "results",
              label: round === 0 ? t("요청을 분석하고 있습니다") : t("도구 결과를 반영하고 있습니다"),
            },
          }, messageKey)
          const roundResponse = await waitForChatTask(askChatbotStream({
            reasoning_effort: reasoningEffort === "default" || (config.selectedModelLocal && !continueWithCloud) ? undefined : reasoningEffort,
            text_verbosity: config.selectedModelLocal && !continueWithCloud ? undefined : textVerbosity,
            question: promptQuestion,
            practice_context: tutorContext,
            context: activeContext,
            context_is_selection: !aiAssistEnabled && Boolean(selectionContext),
              context_pages: selectionContext ? selectedPdfPages : undefined,
            history: (aiAssistEnabled ? history.slice(-6) : history).map((message) => ({ role: message.role, content: message.content, practice_context: message.practiceContext })),
            assist_mode: aiAssistEnabled,
            force_cloud: continueWithCloud,
            cloud_fallback_policy: config.cloudFallbackPolicy,
            document_id: documentId || undefined,
            selection_context: assistSelectionContext || undefined,
            retrieval_state: documentId ? retrievalStateByDocument[documentId] : undefined,
            enable_tools: !tutorContext && round < 5 && allowManagedTools,
            tool_rounds: toolRounds,
            turn_id: turnId,
          }, {
            onTiming: latency,
            onReset: () => {
              if (controller.signal.aborted) return
              pendingTokenText = ""
              streamedAnswer = ""
              hasStreamedText = false
              calls.length = 0
              replaceMessage(assistantMessageId, "", messageKey)
              updateMessage(assistantMessageId, {
                activity: { phase: "thinking", label: t("클라우드 답변을 준비하고 있습니다") },
              }, messageKey)
            },
            onToken: (token) => {
              if (controller.signal.aborted) return
              if (!hasStreamedText) {
                hasStreamedText = true
                updateMessage(assistantMessageId, {
                  activity: { phase: "writing", label: t("답변을 작성하고 있습니다") },
                }, messageKey)
              }
              pendingTokenText += token
              scheduleTokenFlush()
            },
            onToolCall: (call) => {
              if (controller.signal.aborted) return
              calls.push(call)
              updateMessage(assistantMessageId, {
                activity: { phase: "tool", label: t("도구 실행 중 · {p0}", { p0: chatbotToolLabel(call.name) }) },
              }, messageKey)
            },
            onDone: (event) => {
              if (controller.signal.aborted) return
              flushPendingTokens()
              linkChatLatency(assistantMessageId, event.context_metrics?.request_id)
              if (event.usage) roundUsages.push(event.usage)
              answerEvidence = mergeEvidence(event.context_metrics?.evidence ?? [])
              updateMessage(assistantMessageId, { evidence: answerEvidence }, messageKey)
              if (event.cloud_mode) responseCloudMode = event.cloud_mode
              replaceMessage(assistantMessageId, chatbotAnswerForDisplay(event.answer), messageKey)
              updateMessage(assistantMessageId, {
                webSearch: mergeWebSearchReports(roundUsages),
                answerSource: event.answer_source,
                cloudMode: event.answer_source === "cloud" ? responseCloudMode : undefined,
                cloudRecommended: event.cloud_recommended,
                cloudReason: event.cloud_reason,
              }, messageKey)
            },
          }, controller.signal), controller.signal)
          controller.signal.throwIfAborted()
          if (roundResponse.answer_source === "local") setAiAssistEnabled(true)
          agent.onMetaChange({ model: roundResponse.model, provider: roundResponse.provider })
          if (roundResponse.cloud_mode) responseCloudMode = roundResponse.cloud_mode
          flushPendingTokens()
          if (!calls.length) {
            response = roundResponse
            break
          }
          if (roundResponse.answer_source === "cloud") continueWithCloud = true
          if (tutorContext) throw new Error(t("AI 튜터는 현재 문제 문맥 외의 자료 도구를 실행하지 않습니다. 질문을 다시 시도해 주세요."))
          if (round === 5 || calls.length > 8) {
            throw new Error(t("도구 실행 한도에 도달했습니다. 요청을 나누어 다시 시도해 주세요."))
          }
          const results = []
          for (const call of calls) {
            controller.signal.throwIfAborted()
            updateMessage(assistantMessageId, {
              activity: { phase: "tool", label: t("도구 실행 중 · {p0}", { p0: chatbotToolLabel(call.name) }) },
            }, messageKey)
            const callKey = JSON.stringify([call.name, Object.keys(call.arguments).sort().map((key) => [key, call.arguments[key]])])
            try {
              const previousError = failedCalls.get(callKey)
              if (previousError) throw new Error(previousError)
              const result = await waitForChatTask(agent.executeTool(call, visibleQuestion), controller.signal)
              results.push({
                tool_call_id: call.id,
                content: call.name === "search_context" || call.name === "list_materials" || RESEARCH_TOOL_NAMES.has(call.name)
                  ? result.content : JSON.stringify({ ok: true, result: result.content }),
              })
            } catch (error) {
              controller.signal.throwIfAborted()
              const message = getErrorMessage(error)
              failedCalls.set(callKey, message)
              results.push({ tool_call_id: call.id, content: JSON.stringify({ ok: false, error: message, retry_same_arguments: false }) })
            }
          }
          toolRounds.push({ calls, results })
          updateMessage(assistantMessageId, {
            activity: { phase: "results", label: t("도구 결과를 반영하고 있습니다") },
          }, messageKey)
          pendingTokenText = ""
          streamedAnswer = ""
          hasStreamedText = false
          replaceMessage(assistantMessageId, chatbotAnswerForDisplay(""), messageKey)
        }
        if (!response) throw new Error(t("챗봇 응답을 받지 못했습니다."))
        replaceMessage(assistantMessageId, chatbotAnswerForDisplay(response.answer), messageKey)
        updateMessage(assistantMessageId, {
          activity: undefined,
          answerSource: response.answer_source,
          cloudMode: response.answer_source === "cloud" ? (response.cloud_mode || responseCloudMode) : undefined,
          cloudRecommended: response.cloud_recommended,
          cloudReason: response.cloud_reason,
        }, messageKey)
        if (documentId && response.retrieval_state && (!isStudyQuestion || isCurrentSession(requestDocumentKey, sessionId))) {
          setRetrievalStateByDocument((current) => ({ ...current, [documentId]: response.retrieval_state! }))
        }
        let historySaveError = ""
        if (isStudyQuestion && studyDocumentPath) {
          try {
            latency("save_start")
            const { turn, created } = await savePdfStudyChatTurn({
              pdf_path: studyDocumentPath,
              turn_id: turnId,
              session_id: sessionId,
              question: visibleQuestion,
              practice_context: tutorContext,
              answer: response.answer,
              answer_evidence: answerEvidence,
              web_search: mergeWebSearchReports(roundUsages.length ? roundUsages : response.usage ? [response.usage] : []),
              concept_summary: extractChatConceptSummary(response.answer),
              model: response.model,
              provider: response.provider,
            })
            latency("save_end")
            // A completed answer belongs to its original session even if the
            // user closes the PDF or starts another request while it is saving.
            if (created && isCurrentDocument(requestDocumentKey)) {
              setPdfChatSessions((current) => {
                const existing = current.find((session) => session.session_id === sessionId)
                const updated: PdfStudyChatSession = {
                  session_id: sessionId,
                  title: existing?.title ?? visibleQuestion,
                  turn_count: (existing?.turn_count ?? 0) + 1,
                  created_at: existing?.created_at ?? turn.created_at,
                  updated_at: turn.created_at,
                }
                return [updated, ...current.filter((session) => session.session_id !== sessionId)]
              })
            }
          } catch (error) {
            historySaveError = getErrorMessage(error)
            console.error("PDF 학습 대화 저장 실패:", error)
          }
        }
        if (historySaveError) return t("답변은 생성했지만 대화 기록을 자동 저장하지 못했습니다: {p0}", { p0: historySaveError })
        const usageTotal = mergeChatbotUsageTotals(roundUsages.length ? roundUsages : [response.usage])
        const hit = (usageTotal?.prompt_cache_hit_tokens ?? usageTotal?.cached_input_tokens) ?? 0
        const miss = usageTotal?.prompt_cache_miss_tokens ?? 0
        return hit || miss
          ? t("챗봇 응답을 받았습니다. cache hit={p0}, miss={p1}", { p0: hit, p1: miss })
          : t("챗봇 응답을 받았습니다.")
      } catch (error) {
        latency(controller.signal.aborted ? "cancelled" : "failed")
        if (!controller.signal.aborted) throw error
        markStopped()
        return t("답변 생성을 중지했습니다.")
      } finally {
        controller.signal.removeEventListener("abort", markStopped)
      }
    }, (error) => {
      updateMessage(assistantMessageId, { activity: undefined, generationFailed: true }, messageKey)
      replaceMessage(
        assistantMessageId,
        t("답변을 생성하지 못했습니다.\n\n{p0}", { p0: getErrorMessage(error) }),
        messageKey,
      )
    }, { replace: true }).finally(() => {
      latency("finished")
      if (activeRequest.current === controller) activeRequest.current = null
    })
  }

  async function askSectionExplanation(sectionText: string, title: string) {
    const prompt = [
      t("다음 정리본 파트를 추가로 설명해줘: {p0}", { p0: title }),
      "",
      t("설명할 파트:"),
      "```markdown",
      sectionText.trim(),
      "```",
      "",
      t("?붽뎄?ы빆:"),
      t("- 강의 맥락 안에서 쉽게 다시 설명해줘."),
      t("- 핵심 개념, 중요도, 헷갈리기 쉬운 지점을 포함해줘."),
      t("- 필요하면 짧은 예시를 들어줘."),
    ].join("\n")
    await askChatbot(prompt, t("“{p0}” 부분을 추가로 설명해줘.", { p0: title }))
  }

  function prepareHighlightedText(highlightedText: string) {
    const text = highlightedText.trim()
    if (!text) return
    chatSelectedTextContextRef.current = { documentKey: document.activeDocumentKey, text }
    chatInputDraftRef.current = ""
    setChatInputDraft("")
    setChatbotWindowScrollMode("restore")
    if (!currentTutorContext) setChatbotWindowOpen(true)
    else onPracticeTutorFocus?.()
    shouldFocusChatbotInputRef.current = true

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const textarea = chatInputRef.current
        if (!textarea) return
        textarea.focus({ preventScroll: true })
      })
    })
    shell.onNotice(t("선택한 본문을 문맥으로 준비했습니다. 질문만 입력하세요."))
  }

  return {
    askChatbot,
    askSectionExplanation,
    changeAgentModel,
    prepareHighlightedText,
    stopAnswer,
    toggleAiAssist,
  }
}
