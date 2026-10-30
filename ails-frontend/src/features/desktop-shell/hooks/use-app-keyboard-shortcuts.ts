import { useEffect, useRef, type RefObject } from "react"

import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import type { ChatController } from "../../chat/hooks/use-chat-controller.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { HintModeController } from "./use-hint-mode.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
/* @ails-feature:insight_book:start */
import { handleInsightInputShortcut } from "../lib/insight-input-shortcuts.ts"
/* @ails-feature:insight_book:end */
import { handleHomeQuickChatShortcut } from "../lib/home-quick-chat-shortcuts.ts"
import { questionReaderTarget, questionTextEntry } from "../../pdf/lib/quick-chat-edit-context-types.ts"

type ShortcutAction = () => void | Promise<void>

type UseAppKeyboardShortcutsOptions = {
  chat: {
    ask: (questionText?: string) => void | Promise<void>
    commitDraft: (value: string) => void
    controller: ChatController
    toggleWindow: () => void
  }
  codeSandbox: {
    keyboardCaptured: boolean
    open: () => void
  }
  hintMode: HintModeController
  materials: {
    openFile: ShortcutAction
    documents: Pick<ViewerDocument, "id">[]
    scrollRef: RefObject<HTMLDivElement | null>
    selectedDocumentId: string
    selectDocument: (id: string) => void
  }
  navigation: {
    back: ShortcutAction
    canGoBack: boolean
    canGoForward: boolean
    forward: ShortcutAction
  }
  pdf: {
    bookmarkCurrent: ShortcutAction
    openSearch: ShortcutAction
    quickChatBlockedByWindow: boolean
    studyViewerActive: boolean
    redoAnnotation: ShortcutAction
    undoAnnotation: ShortcutAction
    zoomIn: ShortcutAction
    zoomOut: ShortcutAction
    zoomReset: ShortcutAction
  }
  refresh: {
    current: ShortcutAction
    forced: ShortcutAction
  }
  tabs: {
    closeActive: ShortcutAction
    openNew: ShortcutAction
    reopenLastClosed: ShortcutAction
    items: Pick<ViewerDocument, "id">[]
    activeId: string
    selectTab: (id: string) => void
  }
  searchModal: {
    handleKeyDown: (event: globalThis.KeyboardEvent) => boolean
    open: boolean
    toggle: ShortcutAction
  }
  viewer: {
    document: ViewerDocument | null
    editingTextareaRef: RefObject<HTMLTextAreaElement | null>
    editMode: boolean
    enterEditMode: ShortcutAction
    fullscreen: boolean
    fullscreenScrollRef: RefObject<HTMLElement | null>
    leaveEditMode: (save: boolean) => void | Promise<void>
    primaryScrollRef: RefObject<HTMLElement | null>
    openSearch?: ShortcutAction
    redoDirectly: ShortcutAction
    redoDraft: ShortcutAction
    removeTopVisibleImage: ShortcutAction
    undoDirectly: ShortcutAction
    undoDraft: ShortcutAction
  }
  workspaceSurface: WorkspaceSurface
  homeWorkspaceActive?: boolean
}

export function useAppKeyboardShortcuts({
  chat,
  codeSandbox,
  hintMode,
  materials,
  navigation,
  pdf,
  refresh,
  tabs,
  searchModal,
  viewer,
  workspaceSurface,
  homeWorkspaceActive = workspaceSurface === "dashboard",
}: UseAppKeyboardShortcutsOptions) {
  const {
    ask,
    commitDraft,
    controller: chatController,
    toggleWindow,
  } = chat
  const {
    keyboardCaptured: codeSandboxKeyboardCaptured,
    open: openCodeSandbox,
  } = codeSandbox
  const {
    active: hintModeActive,
    activate: activateHintMode,
    handleKeyDown: handleHintKeyDown,
  } = hintMode
  const {
    openFile: openMaterialFile,
    documents: materialDocuments,
    scrollRef: materialScrollRef,
    selectedDocumentId,
    selectDocument,
  } = materials
  const {
    back: navigateBack,
    canGoBack,
    canGoForward,
    forward: navigateForward,
  } = navigation
  const {
    bookmarkCurrent: bookmarkCurrentPdf,
    openSearch: openPdfSearch,
    quickChatBlockedByWindow,
    redoAnnotation,
    studyViewerActive,
    undoAnnotation,
    zoomIn: zoomInPdf,
    zoomOut: zoomOutPdf,
    zoomReset: zoomResetPdf,
  } = pdf
  const {
    current: refreshCurrentView,
    forced: refreshForced,
  } = refresh
  const {
    closeActive: closeActiveTab,
    openNew: openNewTab,
    reopenLastClosed: reopenLastClosedTab,
    items: workspaceTabs,
    activeId: activeTabId,
    selectTab,
  } = tabs
  const {
    handleKeyDown: handleSearchModalKeyDown,
    open: searchModalOpen,
    toggle: toggleSearchModal,
  } = searchModal
  const {
    document: viewerDocument,
    editingTextareaRef,
    editMode: viewerEditMode,
    enterEditMode,
    fullscreen: viewerFullscreen,
    fullscreenScrollRef,
    leaveEditMode,
    primaryScrollRef,
    redoDirectly,
    redoDraft,
    removeTopVisibleImage,
    undoDirectly,
    undoDraft,
  } = viewer
  const askChatbot = useEventCallback(ask)
  const commitChatDraft = useEventCallback(commitDraft)
  const toggleChatWindow = useEventCallback(toggleWindow)
  const openSandbox = useEventCallback(openCodeSandbox)
  const handleHintKey = useEventCallback(handleHintKeyDown)
  const activateHints = useEventCallback(activateHintMode)
  const selectMaterialDocument = useEventCallback(selectDocument)
  const openMaterialPicker = useEventCallback(openMaterialFile)
  const goNavigationBack = useEventCallback(navigateBack)
  const goNavigationForward = useEventCallback(navigateForward)
  const closeActiveDocumentTab = useEventCallback(closeActiveTab)
  const openNewDocumentTab = useEventCallback(openNewTab)
  const reopenClosedDocumentTab = useEventCallback(reopenLastClosedTab)
  const selectDocumentTab = useEventCallback(selectTab)
  const refreshCurrentSurface = useEventCallback(refreshCurrentView)
  const forceRefreshSurface = useEventCallback(refreshForced)
  const openPdfSearchPanel = useEventCallback(openPdfSearch)
  const openDocumentSearch = useEventCallback(() => viewer.openSearch?.())
  const bookmarkCurrentPdfPage = useEventCallback(bookmarkCurrentPdf)
  const zoomInPdfView = useEventCallback(zoomInPdf)
  const zoomOutPdfView = useEventCallback(zoomOutPdf)
  const zoomResetPdfView = useEventCallback(zoomResetPdf)
  const redoPdfAnnotation = useEventCallback(redoAnnotation)
  const undoPdfAnnotation = useEventCallback(undoAnnotation)
  const enterViewerEditMode = useEventCallback(enterEditMode)
  const leaveViewerEditMode = useEventCallback(leaveEditMode)
  const redoViewerDirectly = useEventCallback(redoDirectly)
  const redoViewerDraft = useEventCallback(redoDraft)
  const removeViewerTopImage = useEventCallback(removeTopVisibleImage)
  const undoViewerDirectly = useEventCallback(undoDirectly)
  const undoViewerDraft = useEventCallback(undoDraft)
  const forwardSearchModalKey = useEventCallback(handleSearchModalKeyDown)
  const toggleMaterialSearchModal = useEventCallback(toggleSearchModal)
  const lastXKeyPressTimeRef = useRef(0)
  const scrollTimerRef = useRef<number | null>(null)
  const scrollKeyRef = useRef<string | null>(null)
  const materialScrollTimerRef = useRef<number | null>(null)
  const materialScrollKeyRef = useRef<string | null>(null)

  const {
    input: { chatInputDraftRef, chatInputRef, pdfQuickChatInputRef },
    pdf: { pdfQuickChatOpen, setPdfQuickChatOpen },
    window: {
      chatbotWindowOpen,
      setChatbotWindowOpen,
      setChatbotWindowScrollMode,
      shouldFocusChatbotInputRef,
    },
  } = chatController

  useEffect(() => {
    function performScroll(key: string) {
      const container = viewerFullscreen
        ? fullscreenScrollRef.current
        : primaryScrollRef.current
      if (!container) return

      const activeElement = document.activeElement
      const isInputActive = activeElement && (
        activeElement.tagName === "INPUT"
        || activeElement.tagName === "TEXTAREA"
        || activeElement.getAttribute("contenteditable") === "true"
      )
      if (isInputActive || hintModeActive) return

      if (key === "j") container.scrollTop += 12
      else if (key === "k") container.scrollTop -= 12
    }

    function performLectureMaterialsScroll(key: string) {
      const container = materialScrollRef.current
      if (!container) return

      const activeElement = document.activeElement
      const isInputActive = activeElement && (
        activeElement.tagName === "INPUT"
        || activeElement.tagName === "TEXTAREA"
        || activeElement.getAttribute("contenteditable") === "true"
      )
      if (isInputActive || hintModeActive) return

      if (key === "n") container.scrollTop += 12
      else if (key === "m") container.scrollTop -= 12
    }

    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented) return
      const folderTarget = event.target instanceof HTMLElement && Boolean(event.target.closest("[data-ails-folder-editor], [data-ails-office-editor]"))
      const isTabCycleShortcut = (event.ctrlKey || event.metaKey) && event.key === "Tab"
        && !event.altKey && !event.isComposing && event.keyCode !== 229
      if (folderTarget && !isTabCycleShortcut) return
      if (event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault()
        event.stopPropagation()
        openSandbox()
        return
      }
      const sandboxTarget =
        event.target instanceof HTMLElement && Boolean(event.target.closest("[data-ails-code-sandbox='true']"))
      const sandboxActive =
        document.activeElement instanceof HTMLElement
        && Boolean(document.activeElement.closest("[data-ails-code-sandbox='true']"))
      const eventTarget = event.target
      const activeElement = document.activeElement
      const textEntryTarget =
        questionTextEntry(eventTarget) || questionTextEntry(activeElement)
        || (eventTarget instanceof HTMLElement
          && (eventTarget.isContentEditable
            || Boolean(eventTarget.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-editor, [data-ails-workspace-inline-rename], [data-ails-workspace-rename-session='true']"))))
        || (activeElement instanceof HTMLElement
          && (activeElement.isContentEditable
            || Boolean(activeElement.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-editor, [data-ails-workspace-inline-rename], [data-ails-workspace-rename-session='true']"))))
      const interactiveTarget =
        (eventTarget instanceof HTMLElement && Boolean(eventTarget.closest("button, a, [role='button'], [data-ails-workspace-item]")))
        || (activeElement instanceof HTMLElement && Boolean(activeElement.closest("button, a, [role='button'], [data-ails-workspace-item]")))
      const modalOpen = Array.from(document.querySelectorAll<HTMLElement>(
        "[aria-modal='true'], [data-ails-window='true'], [data-ails-chatbot-window='true'], [data-ails-code-sandbox='true']",
      )).some((element) => {
        const style = window.getComputedStyle(element)
        return style.display !== "none"
          && style.visibility !== "hidden"
          && style.opacity !== "0"
          && element.getClientRects().length > 0
      })
      const nonChatModalOpen = Array.from(document.querySelectorAll<HTMLElement>(
        "[aria-modal='true'], [data-ails-window='true'], [data-ails-code-sandbox='true']",
      )).some((element) => {
        const style = window.getComputedStyle(element)
        return style.display !== "none"
          && style.visibility !== "hidden"
          && style.opacity !== "0"
          && element.getClientRects().length > 0
      })

      // Practice is a sibling of the PDF, not a modal that disables PDF find.
      // Route find before the practice keyboard guard, but retain editor/dialog ownership.
      if (workspaceSurface === "document" && viewerDocument
        && (viewerDocument.kind === "pdf" || Boolean(viewerDocument.rendered_file_path)) && !viewerEditMode && !searchModalOpen
        && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f"
        && !event.altKey && !event.shiftKey && !event.isComposing && event.keyCode !== 229
        && !(eventTarget instanceof Element && eventTarget.closest(".monaco-editor"))
        && !(activeElement instanceof Element && activeElement.closest(".monaco-editor"))
        && !Array.from(document.querySelectorAll<HTMLElement>("[aria-modal='true'], [data-ails-window='true'], [data-ails-chatbot-window='true']"))
          .some(element => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))) {
        event.preventDefault()
        event.stopPropagation()
        openPdfSearchPanel()
        return
      }
      if (codeSandboxKeyboardCaptured || sandboxTarget || sandboxActive) return

      // 자료 검색 모달: Ctrl+K로 열고, 열려 있는 동안 모달이 키보드를 가져간다.
      const lowerKey = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && lowerKey === "k" && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        void toggleMaterialSearchModal()
        return
      }
      if (searchModalOpen) {
        // 처리한 키는 소비하고, 나머지(일반 입력 등)는 모달 입력으로 그대로 흘려보낸다.
        forwardSearchModalKey(event)
        return
      }
      if (eventTarget instanceof HTMLElement && eventTarget.closest("[data-ails-material-search-inline]")
        && !(event.ctrlKey || event.metaKey || event.altKey)) return

      if ((event.ctrlKey || event.metaKey) && lowerKey === "o" && !event.altKey && !event.shiftKey
        && !event.isComposing && !modalOpen) {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) void openMaterialPicker()
        return
      }

      /* @ails-feature:insight_book:start */
      if (workspaceSurface === "document" && viewerDocument && !viewerEditMode
        && !modalOpen && !hintModeActive && handleInsightInputShortcut(event)) return
      /* @ails-feature:insight_book:end */

      // 브라우저 공통 탭·내비게이션 조작. 입력 중에도 동작해야 하므로 텍스트 입력 가드보다 앞에 둔다.
      const cycleDocumentTab = (offset: -1 | 1) => {
        if (workspaceTabs.length === 0) return
        const currentIndex = workspaceTabs.findIndex((tab) => tab.id === activeTabId)
        const base = currentIndex === -1 ? (offset === 1 ? 0 : workspaceTabs.length - 1) : currentIndex + offset
        const next = workspaceTabs[(base + workspaceTabs.length) % workspaceTabs.length]
        if (next) selectDocumentTab(next.id)
      }
      const modifier = event.ctrlKey || event.metaKey
      const browserKey = event.key
      if (modifier && event.shiftKey && (browserKey === "t" || browserKey === "T")) {
        event.preventDefault()
        event.stopPropagation()
        void reopenClosedDocumentTab()
        return
      }
      if (modifier && !event.shiftKey && (browserKey === "t" || browserKey === "T")) {
        event.preventDefault()
        event.stopPropagation()
        openNewDocumentTab()
        return
      }
      if (modifier && !event.shiftKey && (browserKey === "w" || browserKey === "W")) {
        event.preventDefault()
        event.stopPropagation()
        closeActiveDocumentTab()
        return
      }
      if (modifier && browserKey === "Tab" && isTabCycleShortcut) {
        event.preventDefault()
        event.stopPropagation()
        cycleDocumentTab(event.shiftKey ? -1 : 1)
        return
      }
      if (event.altKey && !modifier && browserKey === "ArrowLeft") {
        event.preventDefault()
        event.stopPropagation()
        if (canGoBack) void goNavigationBack()
        return
      }
      if (event.altKey && !modifier && browserKey === "ArrowRight") {
        event.preventDefault()
        event.stopPropagation()
        if (canGoForward) void goNavigationForward()
        return
      }
      if (modifier && event.shiftKey && (browserKey === "r" || browserKey === "R")) {
        event.preventDefault()
        event.stopPropagation()
        void forceRefreshSurface()
        return
      }
      if (browserKey === "F5") {
        event.preventDefault()
        event.stopPropagation()
        void refreshCurrentSurface()
        return
      }
      if (modifier && !event.shiftKey && (browserKey === "r" || browserKey === "R")) {
        event.preventDefault()
        event.stopPropagation()
        void refreshCurrentSurface()
        return
      }
      if (modifier && browserKey === "0") {
        event.preventDefault()
        event.stopPropagation()
        zoomResetPdfView()
        return
      }
      if (modifier && !event.shiftKey && browserKey >= "1" && browserKey <= "9") {
        event.preventDefault()
        event.stopPropagation()
        const target = browserKey === "9"
          ? workspaceTabs[workspaceTabs.length - 1]
          : workspaceTabs[Number(browserKey) - 1]
        if (target) selectDocumentTab(target.id)
        return
      }
      if (modifier && (browserKey === "+" || browserKey === "=")) {
        event.preventDefault()
        event.stopPropagation()
        zoomInPdfView()
        return
      }
      if (modifier && (browserKey === "-" || browserKey === "_")) {
        event.preventDefault()
        event.stopPropagation()
        zoomOutPdfView()
        return
      }
      if (modifier && !event.shiftKey && (browserKey === "f" || browserKey === "F")) {
        // 설정 화면은 자체 Ctrl+F(내비 검색)를 쓰므로 여기서 소비하지 않는다.
        if (workspaceSurface === "settings" || modalOpen || event.isComposing || event.keyCode === 229) return
        // Source editors retain their own find widget.
        if (viewerEditMode || (eventTarget instanceof Element && eventTarget.closest(".monaco-editor"))) return
        event.preventDefault()
        event.stopPropagation()
        if (workspaceSurface === "document" && viewerDocument && !studyViewerActive) openDocumentSearch()
        else openPdfSearchPanel()
        return
      }
      if (eventTarget instanceof Element && eventTarget.closest("[data-ails-document-find]")) return
      if (modifier && !event.shiftKey && (browserKey === "d" || browserKey === "D")) {
        event.preventDefault()
        event.stopPropagation()
        bookmarkCurrentPdfPage()
        return
      }

      const workspaceListTarget =
        (eventTarget instanceof HTMLElement && Boolean(eventTarget.closest("[data-ails-home-workspace-scroll], [data-ails-workspace-files]")))
        || (activeElement instanceof HTMLElement && Boolean(activeElement.closest("[data-ails-home-workspace-scroll], [data-ails-workspace-files]")))
      // Printable input belongs to the reader's EditContext. Global shortcuts
      // remain available without focusing the collapsed question textarea.
      if ((questionReaderTarget(eventTarget) || questionReaderTarget(activeElement))
        && !event.ctrlKey && !event.metaKey && !event.altKey
        && (event.key === "Process" || event.keyCode === 229 || (event.key.length === 1 && !(event.shiftKey && event.code === "Space")))) return
      if (homeWorkspaceActive && handleHomeQuickChatShortcut(event, {
        inputRef: pdfQuickChatInputRef,
        blocked: quickChatBlockedByWindow || nonChatModalOpen,
        textEntryTarget, interactiveTarget,
        onDraftChange: commitChatDraft,
        setOpen: setPdfQuickChatOpen,
        openWindow: () => { if (!chatbotWindowOpen) toggleChatWindow() },
      })) return
      if (workspaceListTarget && (["Tab", "Enter", " ", "Escape"].includes(event.key)
        || (modifier && ["a", "c", "x", "v"].includes(lowerKey) && !event.altKey && !event.shiftKey))) return

      const chatbotEntrySurface = workspaceSurface === "home"
      const startsChatbotInput =
        event.key === "Process"
        || event.keyCode === 229
        || (event.key.length === 1
          && !(event.ctrlKey || event.altKey || event.metaKey)
          && !(event.shiftKey && event.code === "Space"))
      if (chatbotEntrySurface && !textEntryTarget && !nonChatModalOpen && startsChatbotInput) {
        if (event.key.length === 1) {
          event.preventDefault()
          event.stopPropagation()
        }
        const input = chatInputRef.current
        if (!input) {
          shouldFocusChatbotInputRef.current = true
          setChatbotWindowScrollMode("bottom")
          setChatbotWindowOpen(true)
        } else {
          input.focus({ preventScroll: true })
          input.setSelectionRange(input.value.length, input.value.length)
        }
        if (event.key.length === 1) {
          const value = input?.value ?? chatInputDraftRef.current
          commitChatDraft(`${value}${event.key}`)
          window.requestAnimationFrame(() => {
            const nextInput = chatInputRef.current
            nextInput?.focus({ preventScroll: true })
            if (nextInput) nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length)
          })
        }
        return
      }

      const studyOrMarkdownViewerActive =
        studyViewerActive
        || (workspaceSurface === "document" && Boolean(viewerDocument && viewerDocument.kind === "md"))

      if (
        studyOrMarkdownViewerActive
        && !viewerEditMode
        && !quickChatBlockedByWindow
        && !modalOpen
        && !textEntryTarget
        && !event.ctrlKey
        && !event.altKey
        && !event.metaKey
      ) {
        if (event.key === "Enter" && !event.repeat && !interactiveTarget
          && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault()
          event.stopPropagation()
          if (pdfQuickChatOpen) void askChatbot(chatInputDraftRef.current)
          else toggleChatWindow()
          return
        }
      }

      if (event.shiftKey && event.code === "Space" && !textEntryTarget) {
        event.preventDefault()
        event.stopPropagation()
        setChatbotWindowOpen((current) => !current)
        return
      }

      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const hasPdf = viewerDocument
          && (viewerDocument.kind === "pdf" || viewerDocument.rendered_file_path)
        if (hasPdf && materialDocuments.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          const currentIndex = materialDocuments.findIndex(
            (document) => document.id === selectedDocumentId,
          )
          if (currentIndex !== -1) {
            const nextIndex = event.key === "ArrowUp"
              ? (currentIndex - 1 + materialDocuments.length) % materialDocuments.length
              : (currentIndex + 1) % materialDocuments.length
            selectMaterialDocument(materialDocuments[nextIndex].id)
          } else {
            selectMaterialDocument(materialDocuments[0].id)
          }
          return
        }
      }

      if (hintModeActive) {
        handleHintKey(event)
        return
      }

      const key = event.key.toLowerCase()
      if (key === "tab" && !(event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)) {
        event.preventDefault()
        event.stopPropagation()

        if (viewerDocument) {
          const active = document.activeElement
          const isInputOrOtherTextarea =
            active
            && (active.tagName === "INPUT"
              || (active.tagName === "TEXTAREA" && active !== editingTextareaRef.current))

          if (!isInputOrOtherTextarea) {
            if (viewerEditMode) void leaveViewerEditMode(true)
            else void enterViewerEditMode()
          }
        }
        return
      }

      const activeElementForShortcut = document.activeElement
      const isInputActive = activeElementForShortcut && (
        activeElementForShortcut.tagName === "INPUT"
        || activeElementForShortcut.tagName === "TEXTAREA"
        || activeElementForShortcut.getAttribute("contenteditable") === "true"
      )
      if (isInputActive) return

      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        if (studyViewerActive && !viewerEditMode) void undoPdfAnnotation()
        else if (viewerEditMode) void undoViewerDraft()
        else void undoViewerDirectly()
        return
      }

      if ((event.ctrlKey || event.metaKey) && ((key === "z" && event.shiftKey) || key === "y")) {
        event.preventDefault()
        event.stopPropagation()
        if (studyViewerActive && !viewerEditMode) void redoPdfAnnotation()
        else if (viewerEditMode) void redoViewerDraft()
        else void redoViewerDirectly()
        return
      }

      if (key === "x") {
        const now = Date.now()
        if (now - lastXKeyPressTimeRef.current < 500) {
          lastXKeyPressTimeRef.current = 0
          event.preventDefault()
          event.stopPropagation()
          void removeViewerTopImage()
        } else {
          lastXKeyPressTimeRef.current = now
        }
      }

      if (key === "j" || key === "k") {
        event.preventDefault()
        if (scrollKeyRef.current === key) return
        if (scrollTimerRef.current !== null) {
          window.clearInterval(scrollTimerRef.current)
          scrollTimerRef.current = null
        }
        scrollKeyRef.current = key
        performScroll(key)
        scrollTimerRef.current = window.setInterval(() => {
          performScroll(key)
        }, 16)
        return
      }

      if (key === "n" || key === "m") {
        event.preventDefault()
        if (materialScrollKeyRef.current === key) return
        if (materialScrollTimerRef.current !== null) {
          window.clearInterval(materialScrollTimerRef.current)
          materialScrollTimerRef.current = null
        }
        materialScrollKeyRef.current = key
        performLectureMaterialsScroll(key)
        materialScrollTimerRef.current = window.setInterval(() => {
          performLectureMaterialsScroll(key)
        }, 16)
        return
      }

      const container = viewerFullscreen
        ? fullscreenScrollRef.current
        : primaryScrollRef.current
      if (container) {
        if (event.ctrlKey && event.key === "Home") {
          event.preventDefault()
          container.scrollTop = 0
          return
        }
        if (event.ctrlKey && event.key === "End") {
          event.preventDefault()
          container.scrollTop = container.scrollHeight
          return
        }
      }

      if (key === "f") {
        event.preventDefault()
        activateHints()
      }
    }

    function handleGlobalKeyUp(event: globalThis.KeyboardEvent) {
      const sandboxTarget =
        event.target instanceof HTMLElement && Boolean(event.target.closest("[data-ails-code-sandbox='true']"))
      const sandboxActive =
        document.activeElement instanceof HTMLElement
        && Boolean(document.activeElement.closest("[data-ails-code-sandbox='true']"))
      if (codeSandboxKeyboardCaptured || sandboxTarget || sandboxActive) return
      const key = event.key.toLowerCase()
      if ((key === "j" || key === "k") && scrollKeyRef.current === key) {
        if (scrollTimerRef.current !== null) {
          window.clearInterval(scrollTimerRef.current)
          scrollTimerRef.current = null
        }
        scrollKeyRef.current = null
      }
      if ((key === "n" || key === "m") && materialScrollKeyRef.current === key) {
        if (materialScrollTimerRef.current !== null) {
          window.clearInterval(materialScrollTimerRef.current)
          materialScrollTimerRef.current = null
        }
        materialScrollKeyRef.current = null
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown, true)
    window.addEventListener("keyup", handleGlobalKeyUp, true)
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true)
      window.removeEventListener("keyup", handleGlobalKeyUp, true)
      if (scrollTimerRef.current !== null) {
        window.clearInterval(scrollTimerRef.current)
        scrollTimerRef.current = null
      }
      scrollKeyRef.current = null
      if (materialScrollTimerRef.current !== null) {
        window.clearInterval(materialScrollTimerRef.current)
        materialScrollTimerRef.current = null
      }
      materialScrollKeyRef.current = null
    }
  }, [
    activeTabId,
    activateHints,
    askChatbot,
    chatInputDraftRef,
    chatInputRef,
    chatbotWindowOpen,
    closeActiveDocumentTab,
    codeSandboxKeyboardCaptured,
    commitChatDraft,
    editingTextareaRef,
    enterViewerEditMode,
    fullscreenScrollRef,
    goNavigationBack,
    goNavigationForward,
    forwardSearchModalKey,
    handleHintKey,
    hintModeActive,
    homeWorkspaceActive,
    leaveViewerEditMode,
    materialDocuments,
    materialScrollRef,
    openMaterialPicker,
    openNewDocumentTab,
    openPdfSearchPanel,
    openDocumentSearch,
    openSandbox,
    bookmarkCurrentPdfPage,
    canGoBack,
    canGoForward,
    pdfQuickChatInputRef,
    pdfQuickChatOpen,
    setPdfQuickChatOpen,
    primaryScrollRef,
    quickChatBlockedByWindow,
    redoPdfAnnotation,
    redoViewerDirectly,
    redoViewerDraft,
    refreshCurrentSurface,
    forceRefreshSurface,
    removeViewerTopImage,
    reopenClosedDocumentTab,
    selectDocumentTab,
    searchModalOpen,
    selectedDocumentId,
    selectMaterialDocument,
    setChatbotWindowOpen,
    setChatbotWindowScrollMode,
    shouldFocusChatbotInputRef,
    studyViewerActive,
    toggleChatWindow,
    toggleMaterialSearchModal,
    undoPdfAnnotation,
    undoViewerDirectly,
    undoViewerDraft,
    viewerDocument,
    viewerEditMode,
    viewerFullscreen,
    workspaceSurface,
    workspaceTabs,
    zoomInPdfView,
    zoomOutPdfView,
    zoomResetPdfView,
  ])
}
