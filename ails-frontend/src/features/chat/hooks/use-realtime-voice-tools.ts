import type {
  ChatbotExpertResult,
  LectureMaterialsPayload,
  PdfProblem,
  PdfSearchResult,
  RealtimeVoiceContext,
  RealtimeVoiceToolCall,
  RetrievalState,
  SearchContextResponse,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { executeResearchTool, RESEARCH_TOOL_NAMES } from "../../../lib/api/research-tools.ts"
import { listWorkspaces } from "../../code-sandbox/workspaces/api.ts"
import { normalizedMaterialPath, voiceMaterialTargets } from "../../../lib/material-navigation.ts"
import { materialRequestQuery, materialSearchPage, matchingMaterialTargets } from "../lib/material-tool-search.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import {
  collectWorkspaceAgentControls,
  setWorkspaceAgentControlValue,
} from "../lib/workspace-agent-controls.ts"

type WorkspaceSnapshot = {
  activePdfPath: string
  chatbotOpen: boolean
  codingModeActive: boolean
  currentPage: number
  document: ViewerDocument | null
  editMode: boolean
  expertModelName: string
  fullscreenOpen: boolean
  helpOpen: boolean
  latestPage: number
  ocrActive: boolean
  pageCount: number
  problems: PdfProblem[]
  reportTitle: string
  selectedProblemId: string
  settingsOpen: boolean
  sidebarVisible: boolean
  surface: string
}

type ExpertFallbackRequest = {
  error: string
  selectedModel: string
  recommendedModel: string
}

type UseRealtimeVoiceToolsOptions = {
  workspace: {
    getSnapshot: () => WorkspaceSnapshot
    closeSettings: () => void
    openSettings: () => void
    setHelpOpen: (open: boolean) => void
    setSidebarVisibility: (visibility: "show" | "hide" | "toggle") => void
    setSurface: (surface: "home" | "dashboard") => void
    openChatbot: () => void
    closeChatbot: () => void
  }
  document: {
    closePractice: () => void
    getPdfPageText: (page: number) => Promise<string>
    goToPage: (page: number) => void
    openMaterial: (path: string) => Promise<unknown>
    requestOcr: () => Promise<unknown>
    searchPdfDocument: (query: string) => Promise<PdfSearchResult[]>
    selectProblem: (problem: PdfProblem) => void
  }
  materials: {
    getMaterials: () => LectureMaterialsPayload | null
  }
  chat: {
    askExpert: (payload: {
      question: string
      context?: string
      model_name?: string
      confirmed?: boolean
    }) => Promise<ChatbotExpertResult>
    getRetrievalState: (documentId: string) => RetrievalState | undefined
    requestExpertFallback: (request: ExpertFallbackRequest) => Promise<"cancel" | "recommended" | "retry">
    saveTurn: (title: string, content: string, utterance: string) => Promise<void>
    searchContext: (payload: {
      action: "search" | "reuse"
      document_id: string
      query?: string
      textbook_terms?: string
      top_k?: number
      retrieval_state?: RetrievalState
    }) => Promise<SearchContextResponse>
    setAutoExpertModel: (modelId: string) => void
    setRetrievalState: (documentId: string, state?: RetrievalState) => void
  }
  interaction: {
    setNotice: (message: string) => void
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function useRealtimeVoiceTools({
  workspace,
  document: documentActions,
  materials,
  chat,
  interaction,
}: UseRealtimeVoiceToolsOptions) {
  function buildContext(pageOverride?: number): Promise<RealtimeVoiceContext> {
    const snapshot = workspace.getSnapshot()
    const page = clamp(pageOverride ?? snapshot.latestPage ?? snapshot.currentPage, 1, Math.max(1, snapshot.pageCount))
    const selectedText = String(window.getSelection?.()?.toString() || "").trim()
    return Promise.resolve({
      document_title: String(snapshot.document?.title || snapshot.reportTitle || ""),
      current_page: snapshot.activePdfPath ? page : 0,
      page_count: snapshot.activePdfPath ? snapshot.pageCount : 0,
      pdf_open: Boolean(snapshot.activePdfPath),
      practice_open: snapshot.codingModeActive,
      problem_count: snapshot.problems.length,
      ocr_active: snapshot.ocrActive,
      selected_text: selectedText.slice(0, 2000),
      workspace_surface: snapshot.surface,
      document_kind: String(snapshot.document?.kind || ""),
      sidebar_visible: snapshot.sidebarVisible,
      chatbot_open: snapshot.chatbotOpen,
      settings_open: snapshot.settingsOpen,
      help_open: snapshot.helpOpen,
      edit_mode: snapshot.editMode,
      fullscreen: snapshot.fullscreenOpen,
    })
  }

  async function executeTool(call: RealtimeVoiceToolCall, utterance = "") {
    if (RESEARCH_TOOL_NAMES.has(call.name)) {
      return { content: JSON.stringify(await executeResearchTool(call.name, call.arguments)) }
    }
    const snapshot = workspace.getSnapshot()
    const targets = voiceMaterialTargets(materials.getMaterials())
    if (call.name === "select_tool_categories") {
      const supported = new Set(["workspace", "navigation", "materials", "study", "retrieval", "answer", "research"])
      const categories = Array.isArray(call.arguments.categories)
        ? call.arguments.categories.map(String).filter((category) => supported.has(category))
        : []
      if (!categories.length) throw new Error(t("사용할 도구 범주를 하나 이상 선택해야 합니다."))
      return { content: t("{p0} 범주의 도구를 다음 요청에 제공합니다.", { p0: categories.join(", ") }) }
    }
    if (call.name === "inspect_workspace") {
      const { controls } = collectWorkspaceAgentControls()
      const visibleText = String(document.body.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000)
      return {
        content: JSON.stringify({
          surface: snapshot.surface,
          document: snapshot.document ? {
            title: snapshot.document.title,
            kind: snapshot.document.kind,
            page: snapshot.currentPage,
            page_count: snapshot.pageCount,
          } : null,
          sidebar_visible: snapshot.sidebarVisible,
          chatbot_open: snapshot.chatbotOpen,
          settings_open: snapshot.settingsOpen,
          help_open: snapshot.helpOpen,
          edit_mode: snapshot.editMode,
          fullscreen: snapshot.fullscreenOpen,
          visible_text: visibleText,
          controls: controls.slice(0, 50),
          controls_truncated: controls.length > 50,
        }),
      }
    }
    if (call.name === "list_workspace_controls") {
      const query = String(call.arguments.query || "").trim()
      const { controls } = collectWorkspaceAgentControls(query)
      return {
        content: JSON.stringify({
          query,
          controls: controls.slice(0, 120),
          total: controls.length,
          truncated: controls.length > 120,
        }),
      }
    }
    if (call.name === "activate_workspace_control") {
      const controlId = String(call.arguments.control_id || "").trim()
      const interactionName = String(call.arguments.interaction || "click")
      const { controls, byId } = collectWorkspaceAgentControls()
      const element = byId.get(controlId)
      const description = controls.find((control) => control.control_id === controlId)
      if (!element || !description) throw new Error(t("컨트롤을 찾지 못했습니다. 현재 컨트롤 목록을 다시 확인하세요."))
      if (description.disabled) throw new Error(t("현재 비활성화된 컨트롤입니다."))
      if (interactionName === "focus") {
        element.focus()
      } else if (interactionName === "double_click") {
        element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }))
      } else if (interactionName === "context_menu") {
        const rect = element.getBoundingClientRect()
        element.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + Math.min(rect.width / 2, 12),
          clientY: rect.top + Math.min(rect.height / 2, 12),
        }))
      } else if (interactionName === "click") {
        element.click()
      } else {
        throw new Error(t("지원하지 않는 컨트롤 동작입니다."))
      }
      await Promise.resolve()
      return { content: t("{p0} 컨트롤에 {p1} 동작을 실행했습니다.", { p0: description.label, p1: interactionName }) }
    }
    if (call.name === "set_workspace_control") {
      const controlId = String(call.arguments.control_id || "").trim()
      const value = String(call.arguments.value ?? "")
      const { controls, byId } = collectWorkspaceAgentControls()
      const element = byId.get(controlId)
      const description = controls.find((control) => control.control_id === controlId)
      if (!element || !description) throw new Error(t("컨트롤을 찾지 못했습니다. 현재 컨트롤 목록을 다시 확인하세요."))
      setWorkspaceAgentControlValue(element, value)
      await Promise.resolve()
      return { content: t("{p0} 컨트롤 값을 변경했습니다.", { p0: description.label }) }
    }
    if (call.name === "show_home" || call.name === "show_dashboard") {
      if (snapshot.settingsOpen) workspace.closeSettings()
      workspace.setHelpOpen(false)
      workspace.setSurface(call.name === "show_home" ? "home" : "dashboard")
      return { content: call.name === "show_home" ? t("홈 화면을 열었습니다.") : t("학습 대시보드를 열었습니다.") }
    }
    if (call.name === "open_settings") {
      workspace.openSettings()
      return { content: t("설정 화면을 열었습니다.") }
    }
    if (call.name === "open_help") {
      workspace.setHelpOpen(true)
      return { content: t("도움말을 열었습니다.") }
    }
    if (call.name === "open_chatbot" || call.name === "close_chatbot") {
      if (call.name === "open_chatbot") workspace.openChatbot()
      else workspace.closeChatbot()
      return { content: call.name === "open_chatbot" ? t("학습 챗봇을 열었습니다.") : t("학습 챗봇을 닫았습니다.") }
    }
    if (call.name === "set_sidebar_visibility") {
      const visibility = String(call.arguments.visibility || "toggle")
      if (visibility !== "show" && visibility !== "hide" && visibility !== "toggle") {
        throw new Error(t("사이드바 표시 방식이 올바르지 않습니다."))
      }
      workspace.setSidebarVisibility(visibility)
      return { content: visibility === "show" ? t("사이드바를 표시했습니다.") : visibility === "hide" ? t("사이드바를 숨겼습니다.") : t("사이드바 표시 상태를 전환했습니다.") }
    }
    if (call.name === "expert_answer") {
      const question = String(call.arguments.question || utterance).trim()
      const context = String(call.arguments.context || "").trim()
      if (!question) throw new Error(t("복잡한 추론에 전달할 질문이 비어 있습니다."))

      let result = await chat.askExpert({ question, context })
      while (!result.ok && result.fallback_required) {
        const selectedModel = String(result.selected_model || result.failed_model || "")
        const recommendedModel = String(result.recommended_model || "")
        const choice = await chat.requestExpertFallback({
          error: String(result.error || t("선택한 복잡한 추론 모델을 호출하지 못했습니다.")),
          selectedModel,
          recommendedModel,
        })
        if (choice === "cancel") throw new Error(t("복잡한 추론 요청을 취소했습니다."))
        result = await chat.askExpert({
          question,
          context,
          model_name: choice === "recommended" ? recommendedModel : selectedModel,
          confirmed: true,
        })
      }
      if (!result.ok || !result.answer) throw new Error(result.error || t("복잡한 추론 답변을 받지 못했습니다."))
      if (snapshot.expertModelName === "auto" && result.model) chat.setAutoExpertModel(result.model)
      return {
        content: result.answer,
        model: result.model,
        provider: result.provider,
        usage: result.usage,
      }
    }
    if (call.name === "navigate_page") {
      const page = Number(call.arguments.page)
      if (!snapshot.activePdfPath || !Number.isInteger(page) || page < 1 || page > snapshot.pageCount) {
        throw new Error(t("요청한 PDF 페이지가 현재 문서 범위를 벗어났습니다."))
      }
      documentActions.goToPage(page)
      interaction.setNotice(t("{p0}페이지로 이동했습니다.", { p0: page }))
      return { content: t("{p0}페이지로 이동했습니다.", { p0: page }), page }
    }
    if (call.name === "next_page" || call.name === "previous_page") {
      if (!snapshot.activePdfPath) throw new Error(t("PDF가 열려 있지 않습니다."))
      const page = clamp(snapshot.latestPage + (call.name === "next_page" ? 1 : -1), 1, snapshot.pageCount)
      documentActions.goToPage(page)
      interaction.setNotice(t("{p0}페이지로 이동했습니다.", { p0: page }))
      return { content: t("{p0}페이지로 이동했습니다.", { p0: page }), page }
    }
    if (call.name === "open_material") {
      const candidateId = String(call.arguments.candidate_id || "")
      const path = normalizedMaterialPath(String(call.arguments.path || "")).toLocaleLowerCase()
      const target = targets.find((item) => candidateId ? item.candidate_id === candidateId : path && normalizedMaterialPath(item.path).toLocaleLowerCase() === path)
      if (!target) throw new Error(t("선택한 학습자료를 현재 목록에서 찾지 못했습니다."))
      if (path && normalizedMaterialPath(target.path).toLocaleLowerCase() !== path) throw new Error(t("자료 경로와 후보 ID가 일치하지 않습니다."))
      const query = materialRequestQuery(String(call.arguments.query || ""))
      const requested = /\d+\s*주|\boss\b|오픈소스|open\s+source/i.test(utterance) ? materialRequestQuery(utterance) : ""
      if ([query, requested].some(text => text && !matchingMaterialTargets([target], text).length)) {
        throw new Error(t("선택한 자료가 요청한 과목·주차·차시와 일치하지 않습니다. list_materials로 요청한 자료를 검색하세요. 다른 자료는 열지 않았습니다."))
      }
      await documentActions.openMaterial(target.path)
      return { content: t("{p0} 학습자료를 열었습니다.", { p0: target.title }) }
    }
    if (call.name === "open_practice") {
      const problem = snapshot.problems.find((item) => item.id === snapshot.selectedProblemId) ?? snapshot.problems[0]
      if (!problem) throw new Error(t("현재 PDF에서 연습 문제를 찾지 못했습니다."))
      documentActions.selectProblem(problem)
      return { content: t("문제풀이를 열었습니다.") }
    }
    if (call.name === "close_practice") {
      if (!snapshot.codingModeActive) throw new Error(t("문제풀이가 열려 있지 않습니다."))
      documentActions.closePractice()
      return { content: t("문제풀이를 닫았습니다.") }
    }
    if (call.name === "show_hint") {
      const button = document.querySelector<HTMLButtonElement>('[data-voice-command="show-hint"]')
      if (!button || button.disabled) throw new Error(t("현재 문제에서 힌트를 열 수 없습니다."))
      button.click()
      return { content: t("현재 문제의 힌트를 열었습니다.") }
    }
    if (call.name === "next_problem" || call.name === "previous_problem") {
      if (!snapshot.problems.length) throw new Error(t("이동할 연습 문제가 없습니다."))
      const currentIndex = Math.max(0, snapshot.problems.findIndex((item) => item.id === snapshot.selectedProblemId))
      const nextIndex = clamp(currentIndex + (call.name === "next_problem" ? 1 : -1), 0, snapshot.problems.length - 1)
      if (nextIndex === currentIndex) throw new Error(call.name === "next_problem" ? t("마지막 문제입니다.") : t("첫 문제입니다."))
      documentActions.selectProblem(snapshot.problems[nextIndex])
      return { content: t("{p0}번 문제로 이동했습니다.", { p0: snapshot.problems[nextIndex].number }) }
    }
    if (call.name === "request_pdf_ocr") {
      if (!snapshot.activePdfPath) throw new Error(t("OCR을 실행할 PDF가 열려 있지 않습니다."))
      await documentActions.requestOcr()
      return { content: t("PDF OCR 확인 창을 열었습니다. 사용자의 확인을 기다립니다.") }
    }
    if (call.name === "search_context") {
      const documentId = String(snapshot.activePdfPath || snapshot.document?.file_path || snapshot.document?.id || call.arguments.document_id || "")
      if (!documentId) throw new Error(t("검색할 학습자료가 열려 있지 않습니다."))
      const action = call.arguments.action === "reuse" ? "reuse" : "search"
      const query = String(call.arguments.query || "").trim()
      const textbookTerms = String(call.arguments.textbook_terms || "").trim()
      if (action === "search" && !query) throw new Error(t("검색어가 비어 있습니다."))
      const result = await chat.searchContext({
        action,
        document_id: documentId,
        query: query || undefined,
        textbook_terms: textbookTerms || undefined,
        top_k: Number(call.arguments.top_k) || undefined,
        retrieval_state: chat.getRetrievalState(documentId),
      })
      chat.setRetrievalState(documentId, result.retrieval_state)
      return { content: JSON.stringify(result) }
    }
    if (call.name === "search_document") {
      if (!snapshot.activePdfPath) throw new Error(t("검색할 PDF가 열려 있지 않습니다."))
      const query = String(call.arguments.query || "").trim()
      if (!query) throw new Error(t("검색어가 비어 있습니다."))
      const results = await documentActions.searchPdfDocument(query)
      const top = results.slice(0, 5).map((item) => ({ page: item.page, snippet: item.snippet.slice(0, 200) }))
      if (!top.length) return { content: t("문서에서 \"{p0}\" 검색 결과가 없습니다.", { p0: query }) }
      interaction.setNotice(t("\"{p0}\" 검색 결과 {p1}건: {p2}", { p0: query, p1: top.length, p2: top.map((item) => `${item.page}쪽`).join(", ") }))
      return { content: JSON.stringify({ query, matches: top }, null, 0) }
    }
    if (call.name === "get_current_page_context") {
      if (!snapshot.activePdfPath) throw new Error(t("열려 있는 PDF가 없습니다."))
      const page = clamp(snapshot.latestPage ?? snapshot.currentPage, 1, Math.max(1, snapshot.pageCount))
      const text = await documentActions.getPdfPageText(page)
      return { content: JSON.stringify({ page, text: text.trim().slice(0, 4000) }, null, 0) }
    }
    if (call.name === "list_materials") {
      const page = materialSearchPage(targets, call.arguments)
      const code = await listWorkspaces().then((result) => ({
        workspaces: result.workspaces.filter((item) => item.available).slice(0, 20)
          .map(({ id, name }) => ({ workspace_id: id, title: name })),
        error: undefined as string | undefined,
      })).catch((error: unknown) => ({ workspaces: [], error: String(error) }))
      return { content: JSON.stringify({ ...page, code_workspaces: code.workspaces,
        ...(code.error ? { workspace_error: code.error } : {}),
      }) }
    }
    if (call.name === "save_to_chatbot") {
      const title = String(call.arguments.title || "").trim()
      const content = String(call.arguments.content || "").trim()
      if (!title || !content) throw new Error(t("저장할 제목과 내용이 필요합니다."))
      await chat.saveTurn(title, content, utterance)
      return { content: t("\"{p0}\" 제목으로 챗봇에 저장했습니다.", { p0: title }) }
    }
    throw new Error(t("지원하지 않는 보이스 도구입니다: {p0}", { p0: call.name }))
  }

  return { buildContext, executeTool }
}
