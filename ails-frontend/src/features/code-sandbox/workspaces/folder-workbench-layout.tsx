import { lazy, Suspense, useRef, type ReactNode } from "react"
import { Columns2, FolderPlus, Link2, X } from "lucide-react"
import { viewerDocumentIsPdf, type ViewerDocument } from "../../../lib/viewer-document.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import type { FolderWorkbench } from "./use-folder-workbench.ts"
import { folderId, folderTabId, SPLIT_PICKER_ID, CODE_START_ID, isDocumentPane } from "./session.ts"
import { CodeStartScreen } from "./code-start-screen.tsx"
import { ReferenceDocumentPane } from "./reference-document-pane.tsx"
import { CachedTabViews } from "../../document/components/cached-tab-views.tsx"
import { WorkspaceInputDialog } from "./workspace-input-dialog.tsx"
import { SplitPanePicker } from "./split-pane-picker.tsx"
import { useDocumentCodeFit } from "./use-document-code-fit.ts"
import { OFFICE_KINDS } from '../../office/types.ts'

const FolderEditor = lazy(() => import("./folder-editor.tsx").then((module) => ({ default: module.FolderEditor })))

export type WorkbenchLayoutModel = {
  practiceReservedWidth?: number
  controller: FolderWorkbench
  documents: ViewerDocument[]
  documentId: string
  pdfPages: Record<string, number>
  onPdfPageChange: (document: ViewerDocument, page: number) => void
}

export function FolderWorkbenchLayout({ model, surface, children, workspaceBrowser, renderOffice, fullscreenDocumentId }: {
  model: WorkbenchLayoutModel; surface: WorkspaceSurface; children: ReactNode; workspaceBrowser?: ReactNode; renderOffice?: (document: ViewerDocument) => ReactNode; fullscreenDocumentId?: string
}) {
  const { controller: workbench, documents, documentId } = model
  const container = useRef<HTMLDivElement | null>(null)
  const documentPane = useRef<HTMLDivElement | null>(null)
  const enabled = surface === "code" || surface === "document"
  const split = enabled ? workbench.activeSplit : null
  const splitDocument = documents.find((doc) => workbench.split?.includes(doc.id))
  const splitStartWorkbench = { ...workbench, linkSource: splitDocument?.file_path ?? "" }
  const visible: readonly string[] = enabled ? split ?? [surface === "code" ? workbench.activeId : documentId] : []
  const currentDocument = documents.find((doc) => doc.id === documentId)
  useDocumentCodeFit({
    containerRef: container, documentPaneRef: documentPane, documentId,
    page: model.pdfPages[documentId] ?? model.pdfPages[currentDocument?.file_path.replace(/\\/g, "/") ?? ""] ?? 1,
    split, fit: workbench.documentFit, apply: workbench.applyDocumentFit,
  })
  const referenceId = split?.find((id) => id !== documentId && isDocumentPane(id))
  const referenceDocument = documents.find((doc) => doc.id === referenceId)
  const slot = (id: string) => ({ display: visible.includes(id) ? undefined : "none", gridColumn: split && split[1] === id ? 3 : 1, gridRow: 1 })
  const selectSingle = (id: string) => workbench.showSingle(id)
  const linked = currentDocument ? workbench.workspaces.filter((item) => item.pdfs.some((pdf) => pdf.path.replace(/\\/g, "/") === currentDocument.file_path.replace(/\\/g, "/"))) : []

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-ails-folder-workbench="true" style={{ marginLeft: model.practiceReservedWidth || undefined }}>
    {enabled && (surface === "code" || Boolean(folderId(workbench.activeId)) || workbench.activeId === CODE_START_ID) && <div data-ails-code-workbench-toolbar className="flex min-h-8 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-2 text-xs">
      <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--muted)]" onClick={() => surface === "document" && currentDocument ? workbench.startWithDocument(currentDocument) : workbench.start()}><FolderPlus size={13} />새 코드 작업</button>
      {surface === "document" && currentDocument && <>
        <select aria-label="이 문서와 코드 작업 연결" value="" className="max-w-40 bg-transparent text-xs" disabled={workbench.busy} onChange={(event) => { if (event.target.value) void workbench.openDocumentAlongside(event.target.value, currentDocument.file_path) }}>
          <option value="">작업 연결…</option>{workbench.workspaces.filter((item) => item.available && !linked.some((link) => link.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {linked.map((item) => <button key={item.id} title={item.path} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-[var(--muted)]" onClick={() => void workbench.openLinked(item)}><Link2 size={12} />{item.name}</button>)}
      </>}
      {workbench.folderOcrActive && viewerDocumentIsPdf(currentDocument) && <button className={`rounded px-2 py-1 ${workbench.ocrInsertEnabled ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "hover:bg-[var(--muted)]"}`}
        aria-pressed={workbench.ocrInsertEnabled} onClick={() => workbench.setOcrInsertEnabled(!workbench.ocrInsertEnabled)}>PDF 텍스트 가져오기</button>}
      <div className="ml-auto flex items-center gap-2">
        {split ? <>
          <button className="flex items-center gap-1" onClick={workbench.swapPanes}><Columns2 size={13} />좌우 바꾸기</button>
          <button className="flex items-center gap-1" onClick={() => selectSingle(workbench.activeId)}><X size={13} />분할 닫기</button>
        </> : <select aria-label="나란히 열 탭" value="" className="max-w-44 bg-transparent text-xs" onChange={(event) => workbench.splitWith(event.target.value)}>
          <option value="">탭과 나란히 보기…</option>{workbench.tabs.filter((tab) => tab.id !== workbench.activeId).map((tab) => <option key={tab.id} value={tab.id}>{tab.title}</option>)}
        </select>}
      </div>
    </div>}
    {workbench.error && <div className="flex items-center gap-2 bg-red-500/10 px-3 py-2 text-xs text-red-600" role="alert"><span className="min-w-0 flex-1">{workbench.error}</span><button aria-label="작업 오류 닫기" onClick={() => workbench.setError("")}><X size={13} /></button></div>}
    <div ref={container} className="grid min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: split ? `minmax(0, ${workbench.ratio}fr) 6px minmax(0, ${1 - workbench.ratio}fr)` : "minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)" }}>
      <div ref={documentPane} className="flex min-h-0 min-w-0 overflow-hidden" onPointerDownCapture={() => workbench.focus(documentId)} style={enabled ? { ...slot(documentId), ...(OFFICE_KINDS.has(currentDocument?.kind ?? '') ? { display: 'none' } : {}) } : { gridColumn: 1, gridRow: 1 }}>
        {children}
      </div>
      {renderOffice && documents.filter(doc => OFFICE_KINDS.has(doc.kind) && !doc.loading).map(doc => <div key={`office:${doc.id}`}
        className={`min-h-0 min-w-0 overflow-hidden${doc.id === fullscreenDocumentId ? ' fixed inset-x-0 bottom-0 top-8 z-[80] bg-[var(--panel)]' : ''}`}
        data-ails-office-document={doc.id} data-ails-fullscreen-viewer={doc.id === fullscreenDocumentId ? 'true' : undefined}
        onPointerDownCapture={() => workbench.focus(doc.id)} style={slot(doc.id)}>{renderOffice(doc)}</div>)}
      {surface === "code" && !workbench.activeFolder && !split && <div className="min-h-0 min-w-0" style={{ gridColumn: 1, gridRow: 1 }}><CodeStartScreen workbench={workbench} /></div>}
      {workbench.split?.includes(CODE_START_ID) && <div className="min-h-0 min-w-0" onPointerDownCapture={() => workbench.focus(CODE_START_ID)} style={slot(CODE_START_ID)}><CodeStartScreen workbench={splitStartWorkbench} documentSelected={workbench.split.some(isDocumentPane)} /></div>}
      {workbench.opened.map((id) => {
        const workspace = workbench.workspaces.find((item) => item.id === id)
        if (!workspace) return null
        return <div key={id} className="min-h-0 min-w-0 overflow-hidden" onPointerDownCapture={() => workbench.focus(folderTabId(id))} style={slot(folderTabId(id))}>
          {!workspace.available ? <div className="p-6 text-sm"><p>작업 폴더를 찾을 수 없습니다.</p><p className="my-2 break-all text-xs">{workspace.path}</p><button className="rounded border px-3 py-2" onClick={() => void workbench.openFolder(false, workspace)}>이동한 폴더 찾기</button></div>
            : <Suspense fallback={<div className="p-5 text-sm">코드 편집기 여는 중…</div>}><FolderEditor registerTarget={workbench.registerTarget} workspace={workspace} initialFile={workbench.initialFiles[id]} visible={visible.includes(folderTabId(id))}
              onNewWorkspace={() => void workbench.openFolder(true)} onRelocate={() => void workbench.relocate(workspace)}
              onSwitchWorkspace={(offset) => { const index = workbench.opened.indexOf(id); const next = workbench.opened[(index + offset + workbench.opened.length) % workbench.opened.length]; if (next) workbench.select(folderTabId(next)) }}
              onOpenProject={() => void workbench.openFolder(false, undefined, { linkDocument: false })} /></Suspense>}
        </div>
      })}
      {workbench.split?.includes(SPLIT_PICKER_ID) && <div className="min-h-0 min-w-0 overflow-hidden" style={slot(SPLIT_PICKER_ID)}><SplitPanePicker workbench={workbench} workspaceBrowser={workspaceBrowser} /></div>}
      <CachedTabViews activeId={referenceDocument?.id ?? ""} openIds={documents.map((doc) => doc.id)} maxViews={2}>
        {referenceDocument && !OFFICE_KINDS.has(referenceDocument.kind) && <div className="min-h-0 min-w-0 overflow-hidden" onPointerDownCapture={() => workbench.focus(referenceDocument.id)} style={slot(referenceDocument.id)}><ReferenceDocumentPane document={referenceDocument}
          page={model.pdfPages[referenceDocument.file_path.replace(/\\/g, "/")] ?? 1} onPageChange={(page) => model.onPdfPageChange(referenceDocument, page)} onFocus={() => workbench.select(referenceDocument.id)} /></div>}
      </CachedTabViews>
      {split && <div role="separator" aria-label="작업 화면 분할 크기" aria-orientation="vertical" aria-valuenow={Math.round(workbench.ratio * 100)} aria-valuemin={0} aria-valuemax={100}
        tabIndex={0} className="group/split-divider relative z-10 cursor-col-resize touch-none bg-transparent outline-none" style={{ gridColumn: 2, gridRow: 1 }}
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); workbench.setRatio(workbench.ratio + (event.key === "ArrowLeft" ? -0.02 : 0.02)) } }}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
        onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = container.current?.getBoundingClientRect(); if (bounds) workbench.setRatio((event.clientX - bounds.left) / bounds.width) }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}>
        <span data-ails-split-divider-line aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black" />
      </div>}
    </div>
    <WorkspaceInputDialog input={workbench.input} />
  </div>
}
