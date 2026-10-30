import { ClipboardList, Edit3, EyeOff, FileText, Loader2, Plus, Star, Trash2 } from "lucide-react"

import type { MaterialBulkDeleteTarget, MaterialsController, MaterialTrashContextTarget } from "../hooks/use-materials-controller.ts"
import { isPathOcrExcluded } from "../hooks/use-materials-controller.ts"
import { t } from "../../../lib/i18n.ts"
import { MaterialDeleteDialog } from "./material-delete-dialog.tsx"
import { MaterialBulkDeleteDialog } from "./material-bulk-delete-dialog.tsx"
import { MaterialTrashRestoreDialog } from "./material-trash-restore-dialog.tsx"
import { type MaterialContextTarget, type MaterialFolderContextTarget } from "../../../lib/material-navigation.ts"

type MaterialsOverlaysProps = {
  busy: (key: string) => boolean
  controller: MaterialsController
  ocrExcludedPaths?: readonly string[] | null
  ocrWorkBusy: boolean
  onCreateFolder: (parentPath?: string) => void
  onDeleteBulk: (target: MaterialBulkDeleteTarget) => void
  onDeleteFile: (target: MaterialContextTarget) => void
  onDeleteFolder: (target: MaterialFolderContextTarget) => void
  onDeleteTrashItem: (target: MaterialTrashContextTarget) => void
  onRequestRestoreTrashItem: (target: MaterialTrashContextTarget) => void
  onConfirmRestoreTrashItem: (folderPath: string, name: string) => void
  pendingTrashRestore: MaterialTrashContextTarget | null
  onCancelRestoreTrashItem: () => void
  onGenerateFilePractice: (target: MaterialContextTarget) => void
  onGenerateFolderPractice: (target: MaterialFolderContextTarget) => void
  onRunFolderOcr: (target: MaterialFolderContextTarget) => void
  onRenameFile: (target: MaterialContextTarget) => void
  onToggleOcrExclusion: (path: string) => void
  onConfirmDeleteBulk: () => void
  onConfirmDeleteFile: () => void
  onConfirmDeleteFolder: () => void
}

function parentPathFromPath(path: string) {
  const separator = path.includes("\\") ? "\\" : "/"
  const index = path.lastIndexOf(separator)
  return index > 0 ? path.slice(0, index) : ""
}

export function MaterialsOverlays({
  busy,
  controller,
  ocrExcludedPaths,
  ocrWorkBusy,
  onCreateFolder,
  onDeleteBulk,
  onDeleteFile,
  onDeleteFolder,
  onDeleteTrashItem,
  onRequestRestoreTrashItem,
  onConfirmRestoreTrashItem,
  pendingTrashRestore,
  onCancelRestoreTrashItem,
  onGenerateFilePractice,
  onGenerateFolderPractice,
  onRunFolderOcr,
  onRenameFile,
  onToggleOcrExclusion,
  onConfirmDeleteBulk,
  onConfirmDeleteFile,
  onConfirmDeleteFolder,
}: MaterialsOverlaysProps) {
  const { favoriteMaterialPaths } = controller.data
  const {
    materialBaseContextMenu,
    materialBulkContextMenu,
    materialContextMenu,
    materialFolderContextMenu,
    materialTrashContextMenu,
    setMaterialBaseContextMenu,
    setMaterialContextMenu,
    setMaterialFolderContextMenu,
  } = controller.menus
  const {
    pendingBulkDelete,
    pendingFileDelete,
    pendingFolderDelete,
    setPendingBulkDelete,
    setPendingFileDelete,
    setPendingFolderDelete,
  } = controller.pendingDelete
  const { setEditingFolderName, setEditingFolderPath } = controller.editing
  const { getMaterialDeleteCount } = controller.selection
  const { toggleMaterialFavorite } = controller.tree

  return (
    <>
      {materialContextMenu && (
        <div
          className="fixed z-50 w-52 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-xl"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          style={{ left: materialContextMenu.x, top: materialContextMenu.y }}
        >
          {materialContextMenu.target.kind === "md" && (
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
              onClick={() => onGenerateFilePractice(materialContextMenu.target)}
              type="button"
            >
              <ClipboardList size={14} />
              {t("연습문제 만들기")}
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            onClick={() => toggleMaterialFavorite(materialContextMenu.target.path)}
            type="button"
          >
            <Star size={14} className={favoriteMaterialPaths.has(materialContextMenu.target.path) ? "fill-amber-400 text-amber-400" : ""} />
            {favoriteMaterialPaths.has(materialContextMenu.target.path) ? t("즐겨찾기 해제") : t("즐겨찾기")}
          </button>
          {(() => {
            const { excluded, inherited } = isPathOcrExcluded(materialContextMenu.target.path, ocrExcludedPaths)
            if (inherited) {
              return (
                <div
                  className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted-foreground)] opacity-70"
                  title={t("상위 폴더 설정으로 OCR 제외됨")}
                >
                  <EyeOff size={14} />
                  <span>{t("상위 폴더 설정으로 OCR 제외됨")}</span>
                </div>
              )
            }
            return (
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
                onClick={() => {
                  const path = materialContextMenu.target.path
                  setMaterialContextMenu(null)
                  onToggleOcrExclusion(path)
                }}
                type="button"
              >
                <EyeOff size={14} className={excluded ? "text-amber-500" : ""} />
                <span>{excluded ? t("OCR 제외 해제") : t("OCR 제외")}</span>
              </button>
            )
          })()}
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            onClick={() => onRenameFile(materialContextMenu.target)}
            type="button"
          >
            <Edit3 size={14} />
            {t("이름 변경")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-500/10"
            onClick={() => onDeleteFile(materialContextMenu.target)}
            type="button"
          >
            <Trash2 size={14} />
            {t("삭제")}
          </button>
        </div>
      )}
      {materialFolderContextMenu && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-xl"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          style={{ left: materialFolderContextMenu.x, top: materialFolderContextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            onClick={() => {
              const parentPath = parentPathFromPath(materialFolderContextMenu.target.path)
              setMaterialFolderContextMenu(null)
              onCreateFolder(parentPath)
            }}
            type="button"
          >
            <Plus size={14} />
            {t("새 폴더 생성")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            onClick={() => toggleMaterialFavorite(materialFolderContextMenu.target.path)}
            type="button"
          >
            <Star size={14} className={favoriteMaterialPaths.has(materialFolderContextMenu.target.path) ? "fill-amber-400 text-amber-400" : ""} />
            {favoriteMaterialPaths.has(materialFolderContextMenu.target.path) ? t("즐겨찾기 해제") : t("즐겨찾기")}
          </button>
          {(() => {
            const { excluded, inherited } = isPathOcrExcluded(materialFolderContextMenu.target.path, ocrExcludedPaths)
            if (inherited) {
              return (
                <div
                  className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted-foreground)] opacity-70"
                  title={t("상위 폴더 설정으로 OCR 제외됨")}
                >
                  <EyeOff size={14} />
                  <span>{t("상위 폴더 설정으로 OCR 제외됨")}</span>
                </div>
              )
            }
            return (
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
                onClick={() => {
                  const path = materialFolderContextMenu.target.path
                  setMaterialFolderContextMenu(null)
                  onToggleOcrExclusion(path)
                }}
                type="button"
              >
                <EyeOff size={14} className={excluded ? "text-amber-500" : ""} />
                <span>{excluded ? t("OCR 제외 해제") : t("OCR 제외")}</span>
              </button>
            )
          })()}
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            onClick={() => {
              setEditingFolderPath(materialFolderContextMenu.target.path)
              setEditingFolderName(materialFolderContextMenu.target.name)
              setMaterialFolderContextMenu(null)
            }}
            type="button"
          >
            <Edit3 size={14} />
            {t("이름 변경")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
            disabled={ocrWorkBusy}
            onClick={() => onRunFolderOcr(materialFolderContextMenu.target)}
            type="button"
          >
            <FileText size={14} />
            {t("전체 OCR")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
            disabled={materialFolderContextMenu.target.reportCount <= 0 || busy(`material-practice-${materialFolderContextMenu.target.path}`)}
            onClick={() => onGenerateFolderPractice(materialFolderContextMenu.target)}
            type="button"
          >
            {busy(`material-practice-${materialFolderContextMenu.target.path}`) ? <Loader2 className="animate-spin" size={14} /> : <ClipboardList size={14} />}
            {t("연습문제 만들기")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-500/10"
            onClick={() => onDeleteFolder(materialFolderContextMenu.target)}
            type="button"
          >
            <Trash2 size={14} />
            {t("폴더 삭제")}
          </button>
        </div>
      )}
      {materialBulkContextMenu && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-xl"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          style={{ left: materialBulkContextMenu.x, top: materialBulkContextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-500/10"
            onClick={() => onDeleteBulk(materialBulkContextMenu.target)}
            type="button"
          >
            <Trash2 size={14} />
            {t("선택 항목 삭제 (")}{getMaterialDeleteCount(materialBulkContextMenu.target)}{t("개)")}
          </button>
        </div>
      )}
      {materialTrashContextMenu && (
        <div
          className="fixed z-50 w-48 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-xl"
          data-ails-trash-context-menu="true"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          style={{ left: materialTrashContextMenu.x, top: materialTrashContextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            onClick={() => onRequestRestoreTrashItem(materialTrashContextMenu.target)}
            type="button"
          >
            {t("복원")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-500/10"
            onClick={() => onDeleteTrashItem(materialTrashContextMenu.target)}
            type="button"
          >
            <Trash2 size={14} />
            {t("삭제")}
          </button>
        </div>
      )}
      {pendingTrashRestore && controller.data.lectureMaterials && (
        <MaterialTrashRestoreDialog
          busy={busy(`trash-restore-${pendingTrashRestore.path}`)}
          key={pendingTrashRestore.path}
          materials={controller.data.lectureMaterials}
          onCancel={onCancelRestoreTrashItem}
          onConfirm={onConfirmRestoreTrashItem}
          target={pendingTrashRestore}
        />
      )}
      {materialBaseContextMenu && (
        <div
          className="fixed z-50 w-48 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 text-sm shadow-xl"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          style={{ left: materialBaseContextMenu.x, top: materialBaseContextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
            onClick={() => {
              setMaterialBaseContextMenu(null)
              onCreateFolder()
            }}
            type="button"
          >
            <Plus size={14} />
            {t("새 폴더 생성")}
          </button>
        </div>
      )}
      {pendingFileDelete && (
        <MaterialDeleteDialog
          busy={busy(`material-delete-${pendingFileDelete.path}`)}
          description={t("실제 파일을 삭제합니다.")}
          onCancel={() => setPendingFileDelete(null)}
          onConfirm={onConfirmDeleteFile}
          summary={pendingFileDelete.fileName}
          title={t("파일 삭제")}
          titleId="file-delete-title"
        />
      )}
      {pendingFolderDelete && (
        <MaterialDeleteDialog
          busy={busy(`material-folder-delete-${pendingFolderDelete.path}`)}
          description={t("폴더와 폴더 안의 모든 파일을 삭제합니다.")}
          onCancel={() => setPendingFolderDelete(null)}
          onConfirm={onConfirmDeleteFolder}
          summary={pendingFolderDelete.name}
          title={t("폴더 삭제")}
          titleId="folder-delete-title"
        />
      )}
      {pendingBulkDelete && (
        <MaterialBulkDeleteDialog
          busy={busy("material-bulk-delete")}
          onCancel={() => setPendingBulkDelete(null)}
          onConfirm={onConfirmDeleteBulk}
          target={pendingBulkDelete}
        />
      )}
    </>
  )
}
