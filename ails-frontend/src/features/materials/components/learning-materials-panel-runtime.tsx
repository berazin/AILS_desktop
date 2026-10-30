import { useEffect, useRef, type ComponentProps, type RefObject } from "react"
import { Plus, RefreshCw, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { MaterialsWorkflows } from "../hooks/use-materials-workflows.ts"
import { MaterialsBrowser } from "./materials-browser.tsx"

type LearningMaterialsPanelProps = {
  open: boolean
  onClose: () => void
  browser: Omit<ComponentProps<typeof MaterialsBrowser>, "folders" | "searchText" | "renderKeySuffix" | "onAutoScrollDuringDrag" | "onCommitFolderRename" | "onDropOnFolder">
  workflows: MaterialsWorkflows
  scrollRef: RefObject<HTMLDivElement | null>
}

export function LearningMaterialsPanel({ open, onClose, browser, workflows, scrollRef }: LearningMaterialsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("keydown", closeOnEscape)
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [open, onClose])
  if (!open) return null
  const { controller } = browser
  return <div className="absolute inset-0 z-40" data-ails-learning-materials-overlay="true">
    <div className="absolute inset-0 bg-black/10" onClick={onClose} />
    <section id="ails-learning-materials-panel" role="dialog" aria-label={t("폴더 트리")} className="absolute inset-y-0 left-0 flex w-[min(360px,100%)] flex-col bg-[var(--panel)] text-[var(--foreground)] shadow-xl">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <span className="flex-1 text-sm font-semibold">{t("폴더 트리")}</span>
        <button type="button" className="rounded p-1.5 hover:bg-[var(--muted)]" title={t("목록 갱신")} aria-label={t("목록 갱신")} disabled={browser.isBusy("refresh-materials")} onClick={() => void controller.actions.refreshLectureMaterials().catch((error: unknown) => browser.onNotice(String(error)))}><RefreshCw size={14} /></button>
        <button type="button" className="rounded p-1.5 hover:bg-[var(--muted)]" title={t("새 폴더")} aria-label={t("새 폴더")} onClick={() => void workflows.createFolder()}><Plus size={14} /></button>
        <button ref={closeRef} type="button" className="rounded p-1.5 hover:bg-[var(--muted)]" aria-label={t("폴더 트리 닫기")} onClick={onClose}><X size={15} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2" ref={scrollRef} onContextMenu={controller.menus.openMaterialBaseContextMenu} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void workflows.dropOnBase(event)}>
        <MaterialsBrowser {...browser} folders={controller.data.visibleLearningMaterialFolders} searchText={controller.search.text} renderKeySuffix="learning-panel" onAutoScrollDuringDrag={workflows.autoScrollTreeDuringDrag} onCommitFolderRename={(path) => void workflows.commitFolderRename(path)} onDropOnFolder={(event, folder) => void workflows.dropOnFolder(event, folder)} />
        {controller.data.visibleLearningMaterialFolders.length === 0 && <p className="p-3 text-xs text-[var(--muted-foreground)]">{t("등록된 자료가 없습니다.")}</p>}
      </div>
    </section>
  </div>
}
