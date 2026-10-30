import { useLayoutEffect, useRef } from "react"
import { t } from "../../../lib/i18n.ts"
import { BookOpen, Check, Edit3, ExternalLink, EyeOff, FolderOpen, Info, MonitorUp, ScanText, Star, Trash2 } from "lucide-react"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"
import { workspacePinKey } from "../hooks/use-workspace-pins.ts"
import { applyContextItems, contextOcrItems, uniqueContextItems, type MaterialContextMenuState } from "../lib/material-context-targets.ts"

type Props = {
  materialMenu: MaterialContextMenuState
  setMaterialMenu: (menu: MaterialContextMenuState | null) => void
  favoriteItems: Set<string>
  pinnedPaths: string[]
  ocrExcludedPaths?: string[]
  isOpeningRecent?: (path: string) => boolean
  onOpenFolderPath: (path: string) => void
  onOpenRecent: (path: string) => void
  onToggleFavorite: (id: string) => void
  onTogglePin: (path: string) => void
  onToggleOcrExclusion?: (path: string) => void
  onSetOcrExclusions?: (paths: readonly string[], excluded: boolean) => void | Promise<void>
  onRunOcr: (path: string) => void
  onRenameItems: (items: MaterialItem[]) => void
  canRename: boolean
  onMoveToTrash: (items: MaterialItem[]) => void
  onHideFromRecent: (path: string) => void
  onShowDetails: (items: MaterialItem[]) => void
  onActionError: (message: string) => void
}

export function MaterialContextMenu({ materialMenu, setMaterialMenu, favoriteItems, pinnedPaths,
  ocrExcludedPaths, isOpeningRecent, onOpenFolderPath, onOpenRecent, onToggleFavorite, onTogglePin,
  onToggleOcrExclusion, onSetOcrExclusions, onRunOcr, onRenameItems, canRename, onMoveToTrash,
  onHideFromRecent, onShowDetails, onActionError }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const items = uniqueContextItems(materialMenu.items ?? [materialMenu.item])
  const files = items.filter(item => item.kind !== "folder"), ocrFiles = contextOcrItems(files)
  const batch = items.length > 1, singleFolder = items.length === 1 && !files.length
  const isFavorite = items.every(item => favoriteItems.has(item.id))
  const isPinned = files.length > 0 && files.every(item => pinnedPaths.some(path => workspacePinKey(path) === workspacePinKey(item.path)))
  const excluded = new Set((ocrExcludedPaths ?? []).map(workspacePinKey))
  const isOcrExcluded = files.length > 0 && files.every(item => excluded.has(workspacePinKey(item.path)))
  const desktop = getAppDesktopApi()
  const menuItemClass = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-white/80 dark:hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const iconClass = "shrink-0 text-slate-400 dark:text-white/50"
  const close = () => setMaterialMenu(null)
  const apply = (targets: MaterialItem[], action: (item: MaterialItem) => unknown | Promise<unknown>) => {
    close()
    void applyContextItems(targets, action, onActionError)
  }
  const fileCount = batch && files.length !== items.length ? <span className="ml-auto text-[10px] text-slate-400">{files.length}개</span> : null

  useLayoutEffect(() => {
    const node = panel.current
    if (!node) return
    const position = () => {
      const bounds = node.getBoundingClientRect()
      node.style.top = `${Math.max(8, Math.min(materialMenu.y, window.innerHeight - bounds.height - 8))}px`
      node.style.left = `${Math.max(8, Math.min(materialMenu.x, window.innerWidth - bounds.width - 8))}px`
    }
    position()
    window.addEventListener("resize", position)
    return () => window.removeEventListener("resize", position)
  }, [materialMenu.x, materialMenu.y, items.length, files.length])

  return <>
    <div className="fixed inset-0 z-[130]" onContextMenu={event => { event.preventDefault(); close() }} onMouseDown={close} />
    <div ref={panel} className="fixed z-[131] max-h-[calc(100dvh-16px)] w-60 overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#1c202f] text-xs font-normal"
      style={{ left: materialMenu.x, top: materialMenu.y }} data-ails-material-menu role="menu" aria-label={t("파일 옵션")}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() } }}>
      {batch && <div className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-white/50" data-ails-material-menu-count>{t("선택된 {p0}개 항목", { p0: items.length })}</div>}
      <button className={menuItemClass} type="button" onClick={() => apply(items, item => {
        if (item.kind === "folder") {
          if (singleFolder) onOpenFolderPath(item.path)
          else if (desktop?.open_path) return desktop.open_path(item.path)
          else throw new Error(t("폴더를 열 수 없습니다."))
        } else if (!isOpeningRecent?.(item.path)) onOpenRecent(item.path)
      })}>
        <BookOpen className={iconClass} size={13} /><span>{singleFolder ? t("폴더 열기") : t("열기")}</span>
      </button>
      {files.length > 0 && <>
        <button className={menuItemClass} type="button" onClick={() => apply(files, item => {
          if (desktop?.open_split_window) return desktop.open_split_window(item.path)
          if (!window.open(`/?openMaterial=${encodeURIComponent(item.path)}`, "_blank")) throw new Error(t("새 창을 열 수 없습니다."))
        })}><ExternalLink className={iconClass} size={13} /><span>{t("새 창(분할 창)으로 열기")}</span>{fileCount}</button>
        <button className={menuItemClass} type="button" disabled={!desktop?.open_path} onClick={() => apply(files, item => desktop?.open_path?.(item.path))}>
          <MonitorUp className={iconClass} size={13} /><span>{t("외부 뷰어로 열기")}</span>{fileCount}
        </button>
      </>}
      <div className="my-1 border-t border-slate-100 dark:border-white/[0.08]" />
      <button className={menuItemClass} type="button" onClick={() => apply(items.filter(item => favoriteItems.has(item.id) === isFavorite), item => onToggleFavorite(item.id))}>
        <Star className={`shrink-0 ${isFavorite ? "fill-amber-400 text-amber-400" : iconClass}`} size={13} /><span>{isFavorite ? t("즐겨찾기 해제") : t("즐겨찾기")}</span>
      </button>
      {files.length > 0 && <>
        <button className={menuItemClass} aria-pressed={isPinned} type="button" onClick={() => apply(files.filter(item => pinnedPaths.some(path => workspacePinKey(path) === workspacePinKey(item.path)) === isPinned), item => onTogglePin(item.path))}>
          <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-[var(--border)]">{isPinned && <Check size={11} className="text-[var(--brand)]" />}</span><span>{t("상단 고정")}</span>{fileCount}
        </button>
      </>}
      <button className={menuItemClass} type="button" disabled={!ocrFiles.length} title={t("선택된 PDF 파일을 OCR 대기열에 추가합니다.")}
        onClick={() => apply(ocrFiles, item => onRunOcr(item.path))}>
        <ScanText className={iconClass} size={13} /><span>{t("OCR 작업")}</span><span className="ml-auto text-[10px] text-slate-400">{ocrFiles.length}개 PDF</span>
      </button>
      {files.length > 0 && <>
        <button className={menuItemClass} type="button" disabled={!onSetOcrExclusions && (batch || !onToggleOcrExclusion)} onClick={() => {
          close()
          if (onSetOcrExclusions) void Promise.resolve().then(() => onSetOcrExclusions(files.map(item => item.path), !isOcrExcluded)).catch(error => onActionError(error instanceof Error ? error.message : String(error)))
          else onToggleOcrExclusion?.(files[0].path)
        }}><EyeOff className={`shrink-0 ${isOcrExcluded ? "text-amber-500" : iconClass}`} size={13} /><span>{isOcrExcluded ? t("OCR 제외 해제") : t("OCR 제외")}</span>{fileCount}</button>
      </>}
      <button className={menuItemClass} type="button" disabled={!canRename} onClick={() => { close(); onRenameItems(items) }}>
        <Edit3 className={iconClass} size={13} /><span>{t("이름 변경")}</span>
      </button>
      <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-500/10 transition-colors" type="button" onClick={() => {
        close()
        try { onMoveToTrash(items) } catch (error) { onActionError(error instanceof Error ? error.message : String(error)) }
      }}><Trash2 className="shrink-0" size={13} /><span>{t("삭제")}</span></button>
      <div className="my-1 border-t border-slate-100 dark:border-white/[0.08]" />
      {files.length > 0 && <button className={menuItemClass} type="button" onClick={() => apply(files, item => onHideFromRecent(item.path))}>
        <EyeOff className={iconClass} size={13} /><span>{t("목록에서 숨기기")}</span>{fileCount}
      </button>}
      <button className={menuItemClass} type="button" disabled={!desktop?.show_item_in_folder} onClick={() => apply(items, item => desktop?.show_item_in_folder?.(item.path))}>
        <FolderOpen className={iconClass} size={13} /><span>{t("파일 위치 열기 (파일 탐색기에서 보기)")}</span>
      </button>
      <button className={menuItemClass} type="button" onClick={() => { close(); onShowDetails(items) }}>
        <Info className={iconClass} size={13} /><span>{t("상세 정보 보기")}</span>
      </button>
    </div>
  </>
}
