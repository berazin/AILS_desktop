import { FolderTree } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { ProcessBarWorkButton } from "./process-bar-work-button.tsx"

export type DocumentLearningToolsProps = {
  assist: { busy: boolean; enabled: boolean; modelLabel: string; toggle: () => void | Promise<void> }
  materialsOpen: boolean
  toggleMaterials: () => void
  openWorkQueue: () => void
  workCount?: number
}

export function DocumentLearningTools({ materialsOpen, toggleMaterials, openWorkQueue, workCount = 0 }: DocumentLearningToolsProps) {
  const toolClass = "flex items-center gap-1 rounded px-2 py-0.5 text-xs font-normal text-[var(--muted-foreground)] transition-colors hover:bg-[var(--brand)] hover:text-white"
  return <div className="flex shrink-0 items-center gap-1" data-ails-document-learning-tools="true">
    <button type="button" className={toolClass} onClick={toggleMaterials} aria-label={t("폴더 트리")} title={t("폴더 트리")} aria-expanded={materialsOpen} aria-controls="ails-learning-materials-panel"><FolderTree size={14} /></button>
    <ProcessBarWorkButton count={workCount} onOpen={openWorkQueue} />
  </div>
}
