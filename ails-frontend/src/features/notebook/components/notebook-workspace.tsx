import type { NotebookController } from "../hooks/use-notebook-controller.ts"
import { NotebookViewer } from "./notebook-viewer.tsx"
import { NotebookEnvironmentPanel } from "./notebook-environment-panel.tsx"

export function NotebookWorkspace({
  controller,
  onOpenLocalMarkdown,
}: {
  controller: NotebookController
  onOpenLocalMarkdown: (href: string) => void
}) {
  const { activeCellIndex, actions, cells, document, editing, isSaveBusy, runBusyCells, runProgress, saveError, executionNotice } = controller
  if (!document || document.kind !== "ipynb") return null

  return (
    <>
    <NotebookEnvironmentPanel key={document.id} path={document.file_path} running={runBusyCells.size > 0 || controller.isRestarting} onRestart={actions.restartKernel} />
    {executionNotice && <p role="status" className="mb-2 text-sm text-amber-700 dark:text-amber-300">{executionNotice}</p>}
    <NotebookViewer
      activeCellIndex={activeCellIndex}
      cells={cells}
      documentId={document.id}
      editing={editing}
      isSaveBusy={isSaveBusy}
      isRestarting={controller.isRestarting}
      onActiveCellChange={actions.setActiveCellIndex}
      onCancelEdit={actions.leaveCellEdit}
      onCancelRunCell={actions.cancelCellRun}
      onChangeCellType={(cellIndex, newType) => void actions.changeCellType(cellIndex, newType)}
      onDeleteCell={actions.deleteCell}
      onEditCell={actions.enterCellEdit}
      onInsertCell={actions.insertCell}
      onMoveCell={actions.moveCell}
      onOpenLocalMarkdown={onOpenLocalMarkdown}
      onPasteCell={(targetIndex, cellData) => void actions.pasteCell(targetIndex, cellData)}
      onReadCell={actions.readCell}
      onRestartAndRunAll={() => void actions.restartAndRunAll()}
      onRestartKernel={() => void actions.restartKernel()}
      onRunAllCells={() => void actions.runAllCells()}
      onRunCell={(cell) => actions.executeCell(cell)}
      onSaveCell={(draft, index) => void actions.saveCellEdit(draft, index)}
      onSaveNotebook={() => void actions.saveDocument()}
      runBusyCells={runBusyCells}
      runProgress={runProgress}
      batchProgress={controller.batchProgress}
      saveError={saveError}
    />
    </>
  )
}
