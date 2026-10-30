import { t } from "../../../lib/i18n.ts"
import { observeDocumentPresentation } from '../../../lib/document-presentation-diagnostics.ts'
import { memo, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Copy,
  Eye,
  Loader2,
  Pencil,
  Play,
  Save,
  Square,
  Trash2,
} from "lucide-react"

import type { NotebookCellEdit, NotebookCellType, NotebookViewerCell } from "./notebook-utils.tsx"
import { cn } from "../../../lib/utils.ts"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { notebookMarkdownPlugins } from "./remark-notebook-line-breaks.ts"
import { NotebookCodeCell } from "./notebook-code-cell.tsx"
import { NotebookToolbar } from "./notebook-toolbar.tsx"
import { NotebookOutput } from "./notebook-output.tsx"
import { NotebookRunStatus } from "./notebook-run-status.tsx"
import type { NotebookController } from "../hooks/use-notebook-controller.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { Textarea } from "../../../shared/ui/textarea.tsx"

const NotebookCellEditor = memo(function NotebookCellEditor({
  busy,
  initialValue,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean
  initialValue: string
  onCancel: () => void
  onChange: (draft: string) => void
  onSave: (draft: string) => void
}) {
  const [draft, setDraft] = useState(initialValue)

  return (
    <div
      className="space-y-2"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Textarea
        aria-label={t("Markdown 셀 편집")}
        className="min-h-56 resize-y font-mono text-sm leading-6"
        value={draft}
        onChange={(event) => {
          const value = event.target.value
          setDraft(value)
          onChange(value)
        }}
        spellCheck={false}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <Eye size={15} />
          Render
        </Button>
        <Button size="sm" disabled={busy} onClick={() => onSave(draft)}>
          {busy ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
          Save
        </Button>
      </div>
    </div>
  )
})

function CellToolbarButton({
  danger,
  disabled,
  label,
  onClick,
  children,
}: {
  danger?: boolean
  disabled?: boolean
  label: string
  onClick: (event: MouseEvent) => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      className={cn(
        "rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-40",
        danger && "hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

export const NotebookViewer = memo(function NotebookViewer({
  activeCellIndex,
  cells,
  documentId,
  editing,
  isSaveBusy,
  onActiveCellChange,
  onCancelEdit,
  onCancelRunCell,
  onDeleteCell,
  onEditCell,
  onInsertCell,
  onMoveCell,
  onOpenLocalMarkdown,
  onRunCell,
  onSaveCell,
  runBusyCells,
  runProgress = {},
  isRestarting = false,
  batchProgress,
  saveError,
  onSaveNotebook,
  onChangeCellType,
  onPasteCell,
  onReadCell,
  onRunAllCells,
  onRestartKernel,
  onRestartAndRunAll,
}: {
  activeCellIndex: number
  documentId: string
  cells: NotebookViewerCell[]
  editing: NotebookCellEdit | null
  isSaveBusy: boolean
  onActiveCellChange: (cellIndex: number) => void
  onCancelEdit: () => void
  onCancelRunCell: (cell: NotebookViewerCell) => void
  onDeleteCell: (cellIndex: number) => void
  onEditCell: (cell: NotebookViewerCell) => void
  onInsertCell: (cellIndex: number, cellType: NotebookCellType, position: "above" | "below") => void
  onMoveCell: (cellIndex: number, offset: number) => void
  onOpenLocalMarkdown: (href: string) => void
  onRunCell: (cell: NotebookViewerCell) => void | Promise<unknown>
  onSaveCell: (draft: string, index?: number) => void
  runBusyCells: ReadonlySet<number>
  isRestarting?: boolean
  runProgress?: Record<number, string>
  batchProgress?: NotebookController["batchProgress"]
  saveError?: string
  onSaveNotebook?: () => void
  onChangeCellType?: (cellIndex: number, newType: NotebookCellType) => void
  onPasteCell?: (targetIndex: number, cellData: { type: string; source: string }) => void
  onReadCell?: (index: number) => { type: string; source: string }
  onRunAllCells?: () => void
  onRestartKernel?: () => void
  onRestartAndRunAll?: () => void
}) {
  const [clipboardCell, setClipboardCell] = useState<{ type: string; source: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => observeDocumentPresentation('ipynb', () =>
    rootRef.current?.querySelector('[data-notebook-cell] textarea, [data-notebook-cell] .ails-markdown-viewer')?.closest('[data-notebook-cell]')),
  [documentId])
  const [focusRequest, setFocusRequest] = useState<{ index: number } | null>(null)
  const activeCell = cells[activeCellIndex] ?? cells[0]
  const hasRunBusy = isRestarting || runBusyCells.size > 0 || batchProgress?.phase === "running"

  function focusCell(index: number) {
    onActiveCellChange(index)
    setFocusRequest({ index })
  }
  function insertAndFocus(index: number, type: NotebookCellType, position: "above" | "below") {
    if (hasRunBusy) return
    onInsertCell(index, type, position)
    focusCell(position === "above" ? index : index + 1)
  }
  useLayoutEffect(() => {
    if (!focusRequest) return
    const section = rootRef.current?.querySelector<HTMLElement>(`[data-notebook-cell="${focusRequest.index}"]`)
    if (!section) return
    section.scrollIntoView({ block: "nearest" })
    ;(section.querySelector<HTMLTextAreaElement>("textarea") ?? section).focus({ preventScroll: true })
  }, [focusRequest])

  if (cells.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--muted)] p-6 text-sm text-[var(--muted-foreground)]">
        {t("표시할 노트북 셀이 없습니다.")}</div>
    )
  }

  return (
    <div className="space-y-3" ref={rootRef} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); onSaveNotebook?.() }
    }} onClickCapture={event => {
      const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
      if (!anchor) return
      const name = decodeURIComponent(anchor.hash.slice(1))
      const target = [...(rootRef.current?.querySelectorAll<HTMLElement>("[id], a[name]") ?? [])].find(item => [item.id, item.getAttribute("name")].some(value => value === name || value === `user-content-${name}`))
      if (target) { event.preventDefault(); event.stopPropagation(); target.closest<HTMLElement>("[data-notebook-cell]")?.scrollIntoView({ block: "start" }) }
    }}>
      {/* Jupyter 상단 메뉴바 & 툴바 */}
      <div data-notebook-toolbar className="sticky top-0 z-30 rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-sm">
      <NotebookToolbar
        activeCellType={activeCell?.type === "markdown" ? "markdown" : "code"}
        canPaste={Boolean(clipboardCell)}
        hasRunBusy={hasRunBusy}
        isRestarting={isRestarting}
        isSaveBusy={isSaveBusy}
        onChangeCellType={(newType) => onChangeCellType?.(activeCellIndex, newType)}
        onCopy={() => {
          if (activeCell) {
            setClipboardCell(onReadCell?.(activeCell.index) ?? { type: activeCell.type, source: activeCell.source })
          }
        }}
        onCut={() => {
          if (activeCell) {
            setClipboardCell(onReadCell?.(activeCell.index) ?? { type: activeCell.type, source: activeCell.source })
            onDeleteCell(activeCellIndex)
          }
        }}
        onDeleteCell={() => onDeleteCell(activeCellIndex)}
        onInsertAbove={() => insertAndFocus(activeCellIndex, "code", "above")}
        onInsertBelow={() => insertAndFocus(activeCellIndex, "code", "below")}
        onInterrupt={() => {
          const runningCell = cells.find((cell) => runBusyCells.has(cell.index)) ?? cells[0]
          if (runningCell) onCancelRunCell(runningCell)
        }}
        onPaste={() => {
          if (clipboardCell && onPasteCell) {
            onPasteCell(activeCellIndex, clipboardCell)
          }
        }}
        onRestart={onRestartKernel ?? (() => {})}
        onRestartAndRunAll={onRestartAndRunAll ?? (() => {})}
        onRun={() => {
          if (activeCell) onRunCell(activeCell)
        }}
        onRunAll={onRunAllCells ?? (() => {})}
        onSave={onSaveNotebook ?? (() => {})}
      />
      {batchProgress && <NotebookRunStatus progress={batchProgress} onLocate={index => rootRef.current?.querySelector(`[data-notebook-cell="${index}"]`)?.scrollIntoView({ block: "start" })} />}
      </div>

      {saveError && <div data-notebook-save-error role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">{saveError}</div>}
      <div className="space-y-1">
      {cells.map((cell) => {
        const isEditing = editing?.documentId === documentId && editing.cellIndex === cell.index
        const isRunBusy = runBusyCells.has(cell.index)
        const isActive = activeCellIndex === cell.index
        const isFirst = cell.index === 0
        const isLast = cell.index === cells.length - 1
        return (
          <section
            data-notebook-cell={cell.index}
            tabIndex={-1}
            className={cn(
              "group relative flex scroll-mt-32 select-text gap-1 rounded-lg py-0.5 outline-none transition-colors",
              isEditing && "bg-[var(--brand-soft)]",
            )}
            key={`${documentId}:${cell.index}`}
            onClick={() => onActiveCellChange(cell.index)}
            onMouseDown={() => onActiveCellChange(cell.index)}
          >
            <div className="flex w-20 shrink-0 justify-end gap-1.5 pt-2">
              <div
                className={cn(
                  "w-[3px] rounded-full transition-colors",
                  isActive ? "bg-[var(--brand)]" : "bg-transparent group-hover:bg-[var(--border)]",
                )}
              />
              <span
                className={cn(
                  "min-w-14 pt-0.5 text-right font-mono text-xs leading-5 text-[var(--muted-foreground)]",
                  cell.type !== "code" && "opacity-0",
                )}
              >
                {isRunBusy ? "In [*]:" : cell.executionCount ? `In [${cell.executionCount}]:` : "In [ ]:"}
              </span>
            </div>
            <div
              className={cn(
                "relative min-w-0 flex-1 rounded-lg border border-transparent px-4 py-2 transition-colors",
                !isEditing && "group-hover:border-[var(--border)]",
                isActive && !isEditing && "border-[var(--border)] bg-[var(--background)]",
              )}
              onDoubleClick={() => onEditCell(cell)}
            >
              {!isEditing && (
                <div
                  className="absolute -top-3 right-3 z-10 hidden items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-1 py-0.5 shadow-sm group-hover:flex"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  {cell.type === "code" &&
                    (isRunBusy ? (
                      <CellToolbarButton label={t("실행 취소")} onClick={(event) => {
                        event.stopPropagation()
                        onCancelRunCell(cell)
                      }}>
                        <Square size={14} />
                      </CellToolbarButton>
                    ) : (
                      <CellToolbarButton label={t("셀 실행 (Run)")} onClick={(event) => {
                        event.stopPropagation()
                        onRunCell(cell)
                      }}>
                        <Play size={14} />
                      </CellToolbarButton>
                    ))}
                  <CellToolbarButton label={t("셀 편집")} onClick={(event) => {
                    event.stopPropagation()
                    onEditCell(cell)
                  }}>
                    <Pencil size={14} />
                  </CellToolbarButton>
                  <CellToolbarButton
                    label={t("아래에 셀 복제")}
                    disabled={hasRunBusy}
                    onClick={(event) => {
                      event.stopPropagation()
                      onPasteCell?.(cell.index, onReadCell?.(cell.index) ?? { type: cell.type, source: cell.source })
                      focusCell(cell.index + 1)
                    }}
                  >
                    <Copy size={14} />
                  </CellToolbarButton>
                  <CellToolbarButton
                    label={t("위에 셀 추가")}
                    disabled={hasRunBusy}
                    onClick={(event) => {
                      event.stopPropagation()
                      insertAndFocus(cell.index, "code", "above")
                    }}
                  >
                    <ArrowUpToLine size={14} />
                  </CellToolbarButton>
                  <CellToolbarButton
                    label={t("아래에 셀 추가")}
                    disabled={hasRunBusy}
                    onClick={(event) => {
                      event.stopPropagation()
                      insertAndFocus(cell.index, "code", "below")
                    }}
                  >
                    <ArrowDownToLine size={14} />
                  </CellToolbarButton>
                  <CellToolbarButton
                    label={t("셀 위로 이동")}
                    disabled={hasRunBusy || isFirst}
                    onClick={(event) => {
                      event.stopPropagation()
                      onMoveCell(cell.index, -1)
                    }}
                  >
                    <ArrowUp size={14} className={cn(isFirst && "opacity-40")} />
                  </CellToolbarButton>
                  <CellToolbarButton
                    label={t("셀 아래로 이동")}
                    disabled={hasRunBusy || isLast}
                    onClick={(event) => {
                      event.stopPropagation()
                      onMoveCell(cell.index, 1)
                    }}
                  >
                    <ArrowDown size={14} className={cn(isLast && "opacity-40")} />
                  </CellToolbarButton>
                  <CellToolbarButton
                    danger
                    label={t("셀 삭제")}
                    disabled={hasRunBusy}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteCell(cell.index)
                    }}
                  >
                    <Trash2 size={14} />
                  </CellToolbarButton>
                </div>
              )}
              {cell.type === "code" ? (
                <>
                  <NotebookCodeCell
                    initialValue={cell.source}
                    isActive={isActive}
                    isRunBusy={isRunBusy}
                    onActiveChange={() => onActiveCellChange(cell.index)}
                    onAdvance={() => {
                      if (cell.index < cells.length - 1) {
                        focusCell(cell.index + 1)
                      } else {
                        insertAndFocus(cell.index, "code", "below")
                      }
                    }}
                    onChange={(nextSource) => {
                      onSaveCell(nextSource, cell.index)
                    }}
                    onInsertBelow={() => { onInsertCell(cell.index, "code", "below"); focusCell(cell.index + 1) }}
                    onRun={() => onRunCell(cell)}
                  />
                  {isRunBusy && (
                    <div role="status" className="mt-2 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <Loader2 className="animate-spin" size={14} />
                      {runProgress[cell.index] || t("실행 요청을 준비하고 있습니다.")}
                    </div>
                  )}
                  {cell.outputs.length > 0 && (
                    <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
                      {cell.outputs.map((output, outputIndex) => <NotebookOutput key={`${cell.index}:output:${outputIndex}`} output={output} />)}
                    </div>
                  )}
                </>
              ) : isEditing ? (
                <NotebookCellEditor
                  busy={isSaveBusy}
                  initialValue={cell.source}
                  onCancel={onCancelEdit}
                  onChange={(draft) => onSaveCell(draft, cell.index)}
                  onSave={onSaveCell}
                />
              ) : (
                <MarkdownViewer
                  content={cell.markdown}
                  remarkPlugins={notebookMarkdownPlugins}
                  enableLooseLatexRepair
                  enableRawHtml
                  onOpenLocalMarkdown={onOpenLocalMarkdown}
                />
              )}
            </div>
          </section>
        )
      })}
      </div>
    </div>
  )
})
