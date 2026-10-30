import { IDE_ENABLED, IDE_DISABLED_MESSAGE, hasUnavailableIdeSession } from '../../../lib/ide-policy.ts'
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { getMaterialFile, openDirectoryDialog, openFileDialog, AILSApiError } from "../../../lib/api"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { canCloseOffice } from '../../office/session.ts'
import { viewerDocumentIsPdf, viewerFromMaterial, type ViewerDocument } from "../../../lib/viewer-document.ts"
import type { FolderCodeTarget } from "./folder-editor.tsx"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { folderId, folderTabId, clampSplitRatio, readWorkbenchSession, WORKBENCH_SESSION_KEY, SPLIT_PICKER_ID, CODE_START_ID, isDocumentPane, type DocumentCodeFit } from "./session.ts"
import { browseWorkspaceProjects, listWorkspaces, openWorkspace, workspaceRequest, type CodeWorkspace, type WorkspaceFile } from "./api.ts"
import { createWorkspaceWithFirstFile, validateFirstFileName } from "./workspace-first-file.ts"
import { useWorkspaceInput } from "./use-workspace-input.ts"
import { retrySessionRead } from "./session-restore.ts"
import { loadWorkspaceDocument } from "./workspace-document.ts"
import { shouldOpenSourceFile, loadWorkspaceSourceFile } from "./workspace-source-file.ts"
import { workspaceWindowStorage } from "../../../lib/workspace-window-storage.ts"
import type { WorkspaceTabTransfer, TransferSplitGroup } from "../../../shared/workspace-tab-transfer.ts"
import { hasInitialExternalDocument, waitForInitialExternalDocument } from "../../desktop-shell/lib/external-document-startup.ts"

type Ports = {
  documents: ViewerDocument[]
  setDocuments: Dispatch<SetStateAction<ViewerDocument[]>>
  selectedId: string
  selectDocument: (id: string) => void
  closeDocument: (id: string, onActiveClosed?: () => void) => void
  surface: WorkspaceSurface
  setSurface: Dispatch<SetStateAction<WorkspaceSurface>>
  onOpenPdf: (path: string) => void | Promise<unknown>
  codePageId?: string
  replacePageTab?: (previousId: string, workspaceTabId: string) => void
  revealTabs?: (ids: readonly string[]) => void
  onEmptyWorkspace?: () => void
  onStartWithDocument?: (document: ViewerDocument) => number | null | void
}

export function useFolderWorkbench(ports: Ports) {
  const workspaceInput = useWorkspaceInput()
  const [initial] = useState(readWorkbenchSession)
  const [prioritizeExternal] = useState(hasInitialExternalDocument)
  const [workspaces, setWorkspaces] = useState<CodeWorkspace[]>([])
  const [opened, setOpened] = useState(initial.folders)
  const [activeFolder, setActiveFolder] = useState(folderId(initial.active))
  const [focusedTab, setFocusedTab] = useState(initial.active)
  const [singleCodeStart, setSingleCodeStart] = useState(initial.singleCodeStart ?? false)
  const [split, setSplitState] = useState<[string, string] | null>(initial.split)
  const [parkedSplits, setParkedSplits] = useState<TransferSplitGroup[]>(() => (initial.groups ?? []).filter(group => group.pair.join(":") !== initial.split?.join(":")))
  const [documentFit, setDocumentFit] = useState<DocumentCodeFit | null>(initial.documentFit ?? null)
  const splitRef = useRef(split)
  const splitRevision = useRef(0)
  const setSplit = useCallback((pair: [string, string] | null) => {
    splitRef.current = pair
    splitRevision.current += 1
    setSplitState(pair)
    if (pair) setParkedSplits(current => current.filter(group => !group.pair.some(id => pair.includes(id))))
    setDocumentFit((current) => current && pair?.includes(current.id) ? current : null)
  }, [])
  const [splitPickerView, setSplitPickerView] = useState<"tabs" | "files">("tabs")
  const [openingSplitFile, setOpeningSplitFile] = useState(false)
  const splitFileRequest = useRef(false)
  const [ratio, setRatio] = useState(initial.ratio)
  const applyDocumentFit = useCallback((value: number, aspect: number) => {
    setRatio((current) => Math.abs(current - value) < 0.00001 ? current : value)
    setDocumentFit((current) => current && (current.aspect === null || Math.abs(current.aspect - aspect) > 0.00000001) ? { ...current, aspect } : current)
  }, [])
  const [ready, setReady] = useState(false)
  const [canPersist, setCanPersist] = useState(false)
  const restoringSession = useRef(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [startingTabId, setStartingTabId] = useState("")
  const [startLinkSource, setLinkSource] = useState("")
  const [initialFiles, setInitialFiles] = useState<Record<string, WorkspaceFile>>({})
  const [linkNewWorkspace, setLinkNewWorkspace] = useState(true)
  const [ocrInsertEnabled, setOcrInsertEnabled] = useState(false)
  const codeTargets = useRef(new Map<string, FolderCodeTarget>())
  const registerTarget = useCallback((id: string, target: FolderCodeTarget | null) => {
    if (target) codeTargets.current.set(id, target)
    else codeTargets.current.delete(id)
  }, [])
  const codeActiveId = !activeFolder && (focusedTab === CODE_START_ID || focusedTab === SPLIT_PICKER_ID) ? focusedTab : folderTabId(activeFolder)
  const splitActive = Boolean(split?.includes(ports.surface === "document" ? ports.selectedId : ports.surface === "code" ? codeActiveId : ""))
  const activeSplit = splitActive ? split : null
  const splitDocument = ports.documents.find((doc) => activeSplit?.includes(CODE_START_ID) && activeSplit.includes(doc.id))
  const linkSource = activeSplit?.includes(CODE_START_ID) ? (splitDocument?.file_path ?? "") : startLinkSource
  const folderOcrActive = Boolean(activeSplit?.includes(ports.selectedId) && activeSplit.some((id) => folderId(id)))
  const documentCodeActive = Boolean(activeSplit?.includes(ports.selectedId) && activeSplit.some((id) => folderId(id) || id === CODE_START_ID))
  function captureOcrTarget() {
    const id = split?.map(folderId).find(Boolean)
    const target = id ? codeTargets.current.get(id) : null
    const path = target?.file()
    if (!target || !path || !id) return null
    return (text: string) => {
      const current = codeTargets.current.get(id)
      return Boolean(current && current.file() === path && current.insert(text))
    }
  }
  const latest = useRef(ports)
  useEffect(() => { latest.current = ports })
  const activeId = activeSplit?.includes(focusedTab) ? focusedTab
    : ports.surface === "code" ? codeActiveId : ports.surface === "document" ? ports.selectedId : ""
  const navigationId = ports.surface === "code" && !activeFolder && !activeSplit
    ? ports.codePageId || startingTabId || "code:start" : activeId || ports.surface
  const navigationRef = useRef(navigationId)
  useEffect(() => { navigationRef.current = navigationId }, [navigationId])

  const refresh = useCallback(async () => {
    if (!IDE_ENABLED) return []
    const result = await listWorkspaces()
    setWorkspaces(result.workspaces)
    return result.workspaces
  }, [])

  const explorerRefreshPendingRef = useRef(false)
  useEffect(() => {
    const refreshAfterExplorer = () => {
      if (!explorerRefreshPendingRef.current) return
      explorerRefreshPendingRef.current = false
      void refresh().catch((reason) => setError(String(reason)))
    }
    window.addEventListener("focus", refreshAfterExplorer)
    return () => window.removeEventListener("focus", refreshAfterExplorer)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    restoringSession.current = true
    setReady(false)
    setCanPersist(false)
    setError(initial.excludedIde || hasUnavailableIdeSession(workspaceWindowStorage()) ? IDE_DISABLED_MESSAGE : "")
    async function restore() {
      try {
        await waitForInitialExternalDocument()
        if (cancelled) return
        // A failed folder-list request must not prevent document restoration.
        const foldersRequest = (IDE_ENABLED ? retrySessionRead(() => listWorkspaces(controller.signal), controller.signal) : Promise.resolve({ workspaces: [] as CodeWorkspace[] }))
          .then((folders) => {
            if (!cancelled) setWorkspaces(folders.workspaces)
            return folders
          })
          .catch((reason) => {
            if (!cancelled) setError(`코드 작업공간 목록을 복원하지 못했습니다: ${reason instanceof Error ? reason.message : String(reason)}`)
            return null
          })
        const restored: ViewerDocument[] = []
        let documentsRestored = true
        for (const document of initial.documents) {
          if (cancelled) return
          try {
            const { file } = await retrySessionRead(() => getMaterialFile(document.path, controller.signal), controller.signal)
            restored.push({ ...viewerFromMaterial(file), id: document.id })
          } catch {
            documentsRestored = false
            if (!cancelled) setError(`문서를 복원하지 못했습니다: ${document.path}`)
          }
        }
        if (cancelled) return
        latest.current.setDocuments((current) => [...current, ...restored.filter((document) => !current.some((item) => item.id === document.id))])
        if (!prioritizeExternal && restored.some((document) => document.id === initial.active)) latest.current.selectDocument(initial.active)
        const folders = await foldersRequest
        if (cancelled) return
        const valid = new Set([SPLIT_PICKER_ID, CODE_START_ID, ...(folders?.workspaces ?? []).map((folder) => folderTabId(folder.id)), ...restored.map((doc) => doc.id), ...latest.current.documents.map((doc) => doc.id)])
        setParkedSplits(current => current.filter(group => group.pair.every(id => valid.has(id))))
        if (folders) setOpened(initial.folders.filter((id) => valid.has(folderTabId(id))))
        if (initial.split && initial.split.every((id) => valid.has(id))) {
          setSplit(initial.split)
          const primary = initial.split.find(isDocumentPane)
          if (initial.split.includes(CODE_START_ID)) {
            const document = restored.find((doc) => doc.id === primary) ?? latest.current.documents.find((doc) => doc.id === primary)
            setLinkSource(document?.file_path ?? "")
          }
          if (prioritizeExternal) {
            // Keep the OS-selected document active while retaining old splits.
          } else if (initial.split.includes(initial.active)) {
            if (primary) latest.current.selectDocument(isDocumentPane(initial.active) ? initial.active : primary)
            else latest.current.setSurface("code")
          } else if (folderId(initial.active) && valid.has(initial.active)) latest.current.setSurface("code")
          else if (initial.active && valid.has(initial.active)) latest.current.selectDocument(initial.active)
        } else {
          setSplit(null)
          if (!prioritizeExternal) {
            if ((folderId(initial.active) || initial.active === CODE_START_ID) && valid.has(initial.active)) latest.current.setSurface("code")
            else if (initial.active && valid.has(initial.active)) latest.current.selectDocument(initial.active)
          }
        }
        // Keep the saved session intact when only part of it could be read.
        setCanPersist(Boolean(folders) && documentsRestored)
      } catch (reason) { if (!cancelled) setError(String(reason)) }
      finally {
        if (!cancelled) { restoringSession.current = false; setReady(true) }
      }
    }
    void restore()
    return () => { cancelled = true; controller.abort(); splitRevision.current += 1 }
  }, [initial, prioritizeExternal, setSplit])

  useEffect(() => {
    if (!canPersist || restoringSession.current) return
    try {
      workspaceWindowStorage().setItem(WORKBENCH_SESSION_KEY, JSON.stringify({
        folders: opened, documents: ports.documents.filter((document) => !document.loading).map((document) => ({ path: document.file_path, id: document.id })),
        active: ports.surface === "code" || ports.surface === "document" ? activeId : "", split, ratio, documentFit: documentFit ?? undefined, singleCodeStart,
        groups: [...(split ? [{ pair: split, ratio, fit: documentFit, linkSource }] : []), ...parkedSplits],
      }))
    } catch { setError("작업 세션을 저장할 공간이 부족합니다.") }
  }, [canPersist, opened, ports.documents, ports.surface, activeId, split, ratio, documentFit, parkedSplits, linkSource, singleCodeStart])

  function select(id: string) {
    let selectionSplit = split
    const parked = parkedSplits.find(group => group.pair.includes(id))
    if (parked) {
      if (split) setParkedSplits(current => [...current.filter(group => group !== parked), { pair: split, ratio, fit: documentFit, linkSource }])
      setSplit(parked.pair)
      setRatio(parked.ratio)
      setDocumentFit(parked.fit ?? null)
      setLinkSource(parked.linkSource ?? "")
      selectionSplit = parked.pair
    }
    ports.revealTabs?.(selectionSplit?.includes(id) ? selectionSplit : [id])
    setFocusedTab(id)
    if (id === CODE_START_ID || id === SPLIT_PICKER_ID) {
      if (id === SPLIT_PICKER_ID && !selectionSplit?.includes(id)) return
      setActiveFolder("")
      const document = selectionSplit?.includes(id) ? selectionSplit.find(isDocumentPane) : undefined
      if (id === CODE_START_ID) {
        const source = ports.documents.find((doc) => doc.id === document)
        setLinkSource(source?.file_path ?? "")
      }
      if (document) ports.selectDocument(document)
      else {
        setActiveFolder(folderId(selectionSplit?.find((tab) => folderId(tab)) ?? ""))
        ports.setSurface("code")
      }
      return
    }
    const workspaceId = folderId(id)
    if (workspaceId) {
      setActiveFolder(workspaceId)
      if (!selectionSplit?.includes(id)) ports.setSurface("code")
      else {
        const document = selectionSplit.find(isDocumentPane)
        if (document) ports.selectDocument(document)
        else ports.setSurface("code")
      }
    } else {
      ports.selectDocument(id)
    }
  }
  function replaceDocument(previousId: string, document: ViewerDocument) {
    if (!previousId || previousId === document.id) return
    const replacePair = (pair: [string, string]) => pair.map(id => id === previousId ? document.id : id) as [string, string]
    const replaceFit = (fit?: DocumentCodeFit | null) => fit?.id === previousId
      ? document.loading ? { ...fit, id: document.id }
        : viewerDocumentIsPdf(document) ? { ...fit, id: document.id, aspect: null } : null : fit
    const current = splitRef.current
    if (current?.includes(previousId)) {
      if (!current.includes(document.id)) {
        // Move the fit first: setSplit discards fits outside its new pair.
        setDocumentFit(fit => replaceFit(fit) ?? null)
        setSplit(replacePair(current))
      }
      setFocusedTab(focused => focused === previousId ? document.id : focused)
    }
    setParkedSplits(groups => {
      const replaced = groups.find(group => group.pair.includes(previousId))
      if (!replaced || replaced.pair.includes(document.id)) return groups
      return groups.filter(group => group === replaced || !group.pair.includes(document.id))
        .map(group => group === replaced ? { ...group, pair: replacePair(group.pair), fit: replaceFit(group.fit) ?? undefined } : group)
    })
  }
  function splitWith(id: string) {
    if (!activeId || !id || activeId === "workspace:" || id === SPLIT_PICKER_ID) return
    const pair: [string, string] = [activeId, activeId === id ? SPLIT_PICKER_ID : id]
    setSplitPickerView("tabs")
    setError("")
    setRatio(0.5)
    setDocumentFit(null)
    setFocusedTab(activeId)
    setSplit(pair)
    const doc = pair.find(isDocumentPane)
    if (doc) ports.selectDocument(doc)
    else { setActiveFolder(folderId(activeId)); ports.setSurface("code") }
  }
  function chooseSplitTab(id: string) {
    const pending = splitRef.current
    if (!pending?.includes(SPLIT_PICKER_ID) || id === SPLIT_PICKER_ID || pending.includes(id)) return
    const pair = pending.map((tab) => tab === SPLIT_PICKER_ID ? id : tab) as [string, string]
    setSplit(pair)
    setFocusedTab(id)
    const doc = pair.find(isDocumentPane)
    if (doc) latest.current.selectDocument(doc)
    else { setActiveFolder(folderId(id)); latest.current.setSurface("code") }
  }
  async function openSplitFile(path: string) {
    if (!splitRef.current?.includes(SPLIT_PICKER_ID) || splitFileRequest.current) return null
    const revision = splitRevision.current
    const origin = navigationId
    splitFileRequest.current = true
    setOpeningSplitFile(true)
    setError("")
    const isCurrent = () => splitRevision.current === revision && navigationRef.current === origin
      && (latest.current.surface === "code" || latest.current.surface === "document")
    try {
      if (await shouldOpenSourceFile(path)) {
        const { workspace, file } = await loadWorkspaceSourceFile(path)
        if (!isCurrent()) return null
        if (splitRef.current?.includes(folderTabId(workspace.id))) {
          setError("현재 화면과 다른 작업 폴더를 선택해 주세요.")
          return null
        }
        setInitialFiles(current => ({ ...current, [workspace.id]: file }))
        activate(workspace, SPLIT_PICKER_ID)
        return null
      }
      const { file } = await getMaterialFile(path)
      if (!isCurrent()) return null
      const document = viewerFromMaterial(file)
      if (splitRef.current?.includes(document.id)) {
        setError("현재 화면과 다른 파일을 선택해 주세요.")
        return null
      }
      latest.current.setDocuments((current) => current.some((item) => item.id === document.id) ? current : [...current, document])
      chooseSplitTab(document.id)
      return document
    } catch (reason) { if (isCurrent()) setError(String(reason)); return null }
    finally { splitFileRequest.current = false; setOpeningSplitFile(false) }
  }
  function showSingle(id: string) {
    if (id === SPLIT_PICKER_ID) id = splitRef.current?.find((tab) => tab !== SPLIT_PICKER_ID) || ""
    setFocusedTab(id)
    setSplit(null)
    if (folderId(id) || id === CODE_START_ID) { setActiveFolder(folderId(id)); ports.setSurface("code") }
    else ports.selectDocument(id)
  }
  function unsplit(id: string) {
    const current = splitRef.current
    const pair = current?.includes(id) ? current : parkedSplits.find(group => group.pair.includes(id))?.pair
    if (!pair) return
    const retained = pair.find(tab => tab !== id && tab !== SPLIT_PICKER_ID) ?? pair.find(tab => tab !== SPLIT_PICKER_ID)
    if (!retained) return
    // Keep both real tabs open, including the document's temporary code start.
    if (pair.includes(CODE_START_ID)) setSingleCodeStart(true)
    ports.revealTabs?.(pair.filter(tab => tab !== SPLIT_PICKER_ID))
    setParkedSplits(groups => [...groups.filter(group => !group.pair.includes(id)),
      ...(current && current !== pair ? [{ pair: current, ratio, fit: documentFit, linkSource }] : [])])
    showSingle(retained)
  }
  function selectAfterClosingFolder(workspaceId: string, onActiveClosed?: () => void) {
    setActiveFolder("")
    if (onActiveClosed) { onActiveClosed(); return }
    const nextFolder = opened.filter((item) => item !== workspaceId).at(-1)
    const nextDocument = ports.documents.at(-1)
    if (nextFolder) select(folderTabId(nextFolder))
    else if (nextDocument) ports.selectDocument(nextDocument.id)
    else { ports.setSurface("code"); ports.onEmptyWorkspace?.() }
  }
  function close(id: string, onActiveClosed?: () => void) {
    if (!canCloseOffice(id)) { ports.selectDocument(id); return }
    if (id === CODE_START_ID) setSingleCodeStart(false)
    setParkedSplits(current => current.filter(group => !group.pair.includes(id)))
    if (split?.includes(id) && !splitActive) {
      setSplit(null)
      if (id === CODE_START_ID) setLinkSource("")
      if (focusedTab === id) setFocusedTab("")
      const workspaceId = folderId(id)
      if (workspaceId) {
        setOpened((current) => current.filter((item) => item !== workspaceId))
        if (activeFolder === workspaceId) setActiveFolder("")
      } else if (isDocumentPane(id)) ports.closeDocument(id, onActiveClosed)
      return
    }
    if (id === SPLIT_PICKER_ID) { showSingle(id); return }
    if (id === CODE_START_ID) {
      if (!split?.includes(id) && activeId !== id) return
      const other = split?.find((tab) => tab !== id)
      setLinkSource("")
      if (ports.surface !== "code" && ports.surface !== "document") {
        setSplit(null)
        if (focusedTab === CODE_START_ID) setFocusedTab("")
        return
      }
      if (other && other !== SPLIT_PICKER_ID) showSingle(other)
      else { setSplit(null); setFocusedTab(""); onActiveClosed?.(); if (!onActiveClosed) ports.onEmptyWorkspace?.() }
      return
    }
    if (split?.includes(id) && split.includes(SPLIT_PICKER_ID)) {
      setSplit(null)
      setFocusedTab("")
      if (folderId(id)) {
        setOpened((current) => current.filter((item) => item !== folderId(id)))
        selectAfterClosingFolder(folderId(id), onActiveClosed)
      } else ports.closeDocument(id, onActiveClosed)
      return
    }
    if (split?.includes(id)) {
      const other = split.find((tab) => tab !== id)!
      setFocusedTab(other)
      setSplit(null)
      if (folderId(other) || other === CODE_START_ID) { setActiveFolder(folderId(other)); ports.setSurface("code") }
      else if (other !== SPLIT_PICKER_ID) ports.selectDocument(other)
    }
    const workspaceId = folderId(id)
    if (workspaceId) {
      setOpened((current) => current.filter((item) => item !== workspaceId))
      if (activeFolder === workspaceId && !split?.includes(id)) {
        setActiveFolder("")
        if (activeId === id) selectAfterClosingFolder(workspaceId, onActiveClosed)
      }
    } else if (split?.includes(id) && !split.includes(SPLIT_PICKER_ID)) ports.setDocuments((current) => current.filter((doc) => doc.id !== id))
    else ports.closeDocument(id, onActiveClosed)
  }
  function start(pdfPath = "") {
    if (!IDE_ENABLED) { setError(IDE_DISABLED_MESSAGE); return }
    setStartingTabId(folderId(activeId) ? activeId : "")
    setFocusedTab("")
    setLinkSource(pdfPath)
    setLinkNewWorkspace(true)
    setActiveFolder("")
    ports.setSurface("code")
  }
  function startWithDocument(document: ViewerDocument | null = ports.documents.find((doc) => doc.id === ports.selectedId) ?? null) {
    if (!IDE_ENABLED) { setError(IDE_DISABLED_MESSAGE); return }
    if (!document) { start(); return }
    const measuredAspect = ports.onStartWithDocument?.(document)
    const aspect = typeof measuredAspect === "number" && Number.isFinite(measuredAspect) && measuredAspect > 0 ? measuredAspect : null
    ports.setDocuments((current) => current.some((doc) => doc.id === document.id) ? current : [...current, document])
    setStartingTabId("")
    setLinkSource(document.file_path)
    setLinkNewWorkspace(true)
    setActiveFolder("")
    setFocusedTab(CODE_START_ID)
    setDocumentFit(viewerDocumentIsPdf(document) ? { id: document.id, aspect } : null)
    if (!viewerDocumentIsPdf(document)) setRatio(0.5)
    setError("")
    setSplit([document.id, CODE_START_ID])
    ports.selectDocument(document.id)
  }
  function activate(workspace: CodeWorkspace, replacingId = "") {
    if (!IDE_ENABLED) { setError(IDE_DISABLED_MESSAGE); return }
    if (replacingId === CODE_START_ID) setSingleCodeStart(false)
    const pair = splitRef.current?.includes(replacingId)
      ? splitRef.current.map((id) => id === replacingId ? folderTabId(workspace.id) : id) as [string, string]
      : splitRef.current?.includes(folderTabId(workspace.id)) ? splitRef.current : null
    ports.revealTabs?.(pair ?? [folderTabId(workspace.id)])
    setStartingTabId("")
    setFocusedTab(folderTabId(workspace.id))
    setCanPersist(true)
    setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)])
    setOpened((current) => current.includes(workspace.id) ? current : [...current, workspace.id])
    setActiveFolder(workspace.id)
    if (pair) setSplit(pair)
    const document = pair?.find(isDocumentPane)
    if (document) ports.selectDocument(document)
    else ports.setSurface("code")
  }
  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError("")
    try { await action() } catch (reason) { setError(String(reason)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function openSourceFile(path: string) {
    if (!IDE_ENABLED) { setError(IDE_DISABLED_MESSAGE); return }
    try {
      setError("")
      const { workspace, file } = await loadWorkspaceSourceFile(path)
      setInitialFiles(current => ({ ...current, [workspace.id]: file }))
      activate(workspace)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      ports.setSurface("code")
    }
  }
  async function openFolder(create: boolean, recent?: CodeWorkspace, options?: { linkDocument?: boolean }) {
    if (!IDE_ENABLED) { setError(IDE_DISABLED_MESSAGE); return }
    const origin = activeSplit?.includes(CODE_START_ID) ? CODE_START_ID : navigationId
    const revision = splitRevision.current
    const replacingId = activeSplit?.includes(CODE_START_ID) && !folderId(activeId) ? CODE_START_ID
      : create && (ports.surface === "code" || folderId(activeId))
        ? (folderId(activeId) || activeId === CODE_START_ID ? activeId : ports.codePageId || startingTabId) : ""
    await perform(async () => {
      let result: { workspace: CodeWorkspace }
      if (create) {
        const name = await workspaceInput.request({ title: "새 프로젝트의 첫 파일 이름", initialValue: "main.", description: "확장자를 포함한 파일 이름을 입력하세요. 예: main.py, main.cpp, app.ts", validate: validateFirstFileName })
        if (!name || navigationRef.current !== origin || splitRevision.current !== revision) return
        const created = await createWorkspaceWithFirstFile(name)
        result = created
        setInitialFiles(current => ({ ...current, [created.workspace.id]: created.firstFile }))
      }
      else {
        const initialDir = recent ? undefined : (await browseWorkspaceProjects()).root
        const path = recent?.available ? recent.path : (await openDirectoryDialog({
          title: recent ? "이동한 작업 폴더 찾기" : "프로젝트 열기", initial_dir: initialDir,
        })).path
        if (!path) return
        try { result = await openWorkspace(path, false, false, recent?.id) }
        catch (reason) {
          if (!(reason instanceof AILSApiError) || reason.code !== "duplicate_workspace"
            || !confirm("이 폴더는 기존 작업의 복사본입니다. 문서 연결을 분리해 새 작업으로 등록할까요?")) throw reason
          result = await openWorkspace(path, false, true)
        }
      }
      if (linkSource && (options?.linkDocument ?? linkNewWorkspace)) {
        await workspaceRequest("link", { id: result.workspace.id, path: linkSource })
        result.workspace = (await refresh()).find((item) => item.id === result.workspace.id)!
      }
      if (navigationRef.current !== origin || splitRevision.current !== revision) {
        setWorkspaces((current) => [result.workspace, ...current.filter((item) => item.id !== result.workspace.id)])
        return
      }
      if (replacingId) {
        latest.current.replacePageTab?.(replacingId, folderTabId(result.workspace.id))
        const previousFolder = folderId(replacingId)
        if (previousFolder) setOpened((current) => current.filter((id) => id !== previousFolder))
      }
      activate(result.workspace, replacingId)
      setLinkSource("")
    })
  }
  async function pickPdf() {
    await perform(async () => {
      const result = await openFileDialog({ kind: "pdf", title: "문서 열기" })
      if (result.path) await ports.onOpenPdf(result.path)
    })
  }
  async function unlinkDocument(workspaceId: string, documentId: string) {
    await perform(async () => { await workspaceRequest("unlink", { id: workspaceId, pdf_id: documentId }); await refresh() })
  }
  async function relocate(workspace: CodeWorkspace) {
    if (!IDE_ENABLED) { setError(IDE_DISABLED_MESSAGE); return }
    await perform(async () => {
      const desktop = getAppDesktopApi()
      if (!desktop?.show_item_in_folder) throw new Error("파일 탐색기 열기는 AILS 데스크톱 앱에서 사용할 수 있습니다.")
      if (!await desktop.show_item_in_folder(workspace.path)) throw new Error("Windows 파일 탐색기를 열지 못했습니다.")
      explorerRefreshPendingRef.current = true
    })
  }
  async function openLinked(workspace: CodeWorkspace) {
    await perform(async () => {
      const documentId = ports.selectedId
      const result = await openWorkspace(workspace.path, false, false, workspace.id)
      activate(result.workspace)
      if (documentId) { setSplit([folderTabId(workspace.id), documentId]); ports.selectDocument(documentId) }
    })
  }
  async function openDocumentAlongside(workspaceId: string, path?: string) {
    const origin = navigationId
    const revision = splitRevision.current
    await perform(async () => {
      const target = path || (await openFileDialog({ kind: "document", title: "문서 열기" })).path
      if (!target) return
      const document = await loadWorkspaceDocument(workspaces.find((item) => item.id === workspaceId), target, latest.current.documents)
      await workspaceRequest("link", { id: workspaceId, path: target })
      await refresh()
      if (navigationRef.current !== origin || splitRevision.current !== revision) return
      latest.current.setDocuments((current) => current.some((item) => item.id === document.id) ? current : [...current, document])
      const pair = splitRef.current
      if (!pair?.includes(folderTabId(workspaceId)) || !pair.includes(document.id)) {
        const aspect = latest.current.onStartWithDocument?.(document)
        setDocumentFit(viewerDocumentIsPdf(document) ? { id: document.id, aspect: typeof aspect === "number" ? aspect : null } : null)
        setRatio(0.5)
        setSplit([folderTabId(workspaceId), document.id])
      }
      latest.current.selectDocument(document.id)
      setFocusedTab(folderTabId(workspaceId))
      setActiveFolder(workspaceId)
    })
  }

  const allSplitIds = [...(split ?? []), ...parkedSplits.flatMap(group => group.pair)]
  const tabs = [...ports.documents.map((doc) => ({ id: doc.id, title: doc.title, kind: doc.kind })),
    ...opened.flatMap((id) => { const folder = workspaces.find((item) => item.id === id); return folder ? [{ id: folderTabId(id), title: folder.name, kind: "code-workspace" }] : [] }),
    ...(singleCodeStart || allSplitIds.includes(CODE_START_ID) || (ports.surface === "code" && activeId === CODE_START_ID) ? [{ id: CODE_START_ID, title: "코드", kind: "code" }] : []),
    ...(allSplitIds.includes(SPLIT_PICKER_ID) ? [{ id: SPLIT_PICKER_ID, title: "새 분할 화면", kind: "split-picker" }] : [])]
  const splitGroupsState: TransferSplitGroup[] = [...(split ? [{ pair: split, ratio, fit: documentFit, linkSource }] : []), ...parkedSplits]
  function acceptTransferredTabs(snapshot: Pick<WorkspaceTabTransfer, "folders" | "split" | "groups" | "ratio" | "fit" | "linkSource">, active: string) {
    if (!IDE_ENABLED && (snapshot.folders.length || !isDocumentPane(active) || snapshot.groups?.some(group => group.pair.some(id => !isDocumentPane(id))))) { setError(IDE_DISABLED_MESSAGE); return }
    if (!snapshot.split && active === CODE_START_ID) setSingleCodeStart(true)
    setWorkspaces(current => [...snapshot.folders, ...current.filter(item => !snapshot.folders.some(folder => folder.id === item.id))])
    setOpened(current => [...new Set([...current, ...snapshot.folders.map(folder => folder.id)])])
    setCanPersist(true)
    if (snapshot.split) {
      const incomingGroups = snapshot.groups ?? [{ pair: snapshot.split, ratio: snapshot.ratio, fit: snapshot.fit, linkSource: snapshot.linkSource }]
      const incomingIds = incomingGroups.flatMap(group => group.pair)
      setParkedSplits([...splitGroupsState.filter(group => !group.pair.some(id => incomingIds.includes(id))),
        ...incomingGroups.filter(group => group.pair.join(":") !== snapshot.split!.join(":"))])
      setSplit(snapshot.split)
      setRatio(snapshot.ratio)
      setDocumentFit(snapshot.fit ?? null)
      setLinkSource(snapshot.linkSource ?? "")
    }
    setFocusedTab(active)
    setActiveFolder(folderId(active) || folderId(snapshot.split?.find(id => folderId(id)) ?? ""))
    const documentId = snapshot.split?.find(isDocumentPane)
    if (documentId) ports.selectDocument(isDocumentPane(active) ? active : documentId)
    else if (folderId(active) || active === CODE_START_ID || active === SPLIT_PICKER_ID) ports.setSurface("code")
  }
  function removeTransferredTabs(ids: string[]) {
    setParkedSplits(current => current.filter(group => !group.pair.some(id => ids.includes(id))))
    setOpened(current => current.filter(id => !ids.includes(folderTabId(id))))
    if (split?.some(id => ids.includes(id))) setSplit(null)
    if (ids.includes(folderTabId(activeFolder))) setActiveFolder("")
    if (ids.includes(focusedTab)) setFocusedTab("")
    if (ids.includes(CODE_START_ID)) { setLinkSource(""); setSingleCodeStart(false) }
  }
  return { input: workspaceInput.input, initialFiles, ocrInsertEnabled, setOcrInsertEnabled, registerTarget, folderOcrActive, documentCodeActive, captureOcrTarget, workspaces, opened, tabs, activeId, activeFolder, split, activeSplit, ratio, documentFit, applyDocumentFit, ready, busy, error, linkSource, linkNewWorkspace, setLinkNewWorkspace,
    externalDocumentsReady: ready || prioritizeExternal,
    acceptTransferredTabs, removeTransferredTabs, splitGroupsState, splitGroups: splitGroupsState.map(group => group.pair),
    focus: setFocusedTab,
    setError, setLinkSource, start, startWithDocument, select, close, replaceDocument, splitWith, unsplit, setSplit, showSingle, openLinked, openDocumentAlongside,
    splitPickerView, setSplitPickerView, openingSplitFile, chooseSplitTab, openSplitFile,
    swapPanes: () => { if (split) { setSplit([split[1], split[0]]); setRatio(1 - ratio) } },
    setRatio: (value: number) => { setDocumentFit(null); setRatio(clampSplitRatio(value)) },
    openFolder, openSourceFile, pickPdf, unlinkDocument, relocate, refresh,
    onOpenPdf: ports.onOpenPdf,
  }
}
export type FolderWorkbench = ReturnType<typeof useFolderWorkbench>
