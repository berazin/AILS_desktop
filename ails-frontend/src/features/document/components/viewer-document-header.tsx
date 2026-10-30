import { Copy, Edit3, Maximize2, MoreVertical, Wand2 } from "lucide-react"

import type { LectureMaterialsPayload } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { viewerDocumentIsPdf } from "../../../lib/viewer-document.ts"
import { cn } from "../../../lib/utils.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { OFFICE_KINDS } from '../../office/types.ts'

type ViewerDocumentHeaderProps = {
  document: ViewerDocument | null
  editing: {
    active: boolean
    toggle: () => void
  }
  materials: LectureMaterialsPayload | null
  menu: {
    copyPath: () => void
    fullscreen?: boolean
    open: boolean
    openFullscreen: () => void
    runLatexPostprocess: () => void
    setOpen: (open: boolean) => void
  }
}

export function ViewerDocumentHeader({ document, editing, menu }: ViewerDocumentHeaderProps) {
  if (OFFICE_KINDS.has(document?.kind ?? '')) return null
  if (document?.kind === "ipynb") {
    return (
      <div className="mb-1 flex items-center justify-between px-0.5">
        <h2 className="truncate text-lg font-semibold text-[var(--foreground)]">{document.title}</h2>
      </div>
    )
  }

  if (document?.kind === "md") {
    return (
      <div data-ails-document-header className={cn("sticky top-0 z-20 -mx-5 mb-2 flex items-center justify-end gap-3 px-5 py-2.5 lg:-mx-7 lg:px-7",
        menu.fullscreen ? "bg-[var(--background)]" : "bg-[var(--panel)]")}>
        <div className="relative flex shrink-0 items-center gap-1">
          <button
            aria-label={editing.active ? t("보기 모드로 전환") : t("편집 모드로 전환")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded transition-colors",
              editing.active
                ? "bg-[var(--brand)] text-white shadow-xs"
                : "text-[var(--muted-foreground)] hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]",
            )}
            onClick={() => editing.toggle()}
            title={editing.active ? t("보기 모드로 전환") : t("편집 모드로 전환 (✎)")}
            type="button"
          >
            <Edit3 size={15} />
          </button>

          <div className="relative">
            <button
              aria-label={t("마크다운 문서 더보기")}
              aria-expanded={menu.open}
              aria-haspopup="menu"
              className="flex h-7 w-7 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]"
              onClick={() => menu.setOpen(!menu.open)}
              title={t("더보기 (⋮)")}
              type="button"
            >
              <MoreVertical size={15} />
            </button>
            {menu.open && <div className="fixed inset-0 z-40" onClick={() => menu.setOpen(false)} />}
            {menu.open && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 animate-in rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 text-xs shadow-xl duration-100 fade-in zoom-in-95">
                <button
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[var(--foreground)] hover:bg-[var(--interactive-hover)]"
                  onClick={() => {
                    menu.setOpen(false)
                    menu.openFullscreen()
                  }}
                  type="button"
                >
                  <Maximize2 size={13} />
                  <span>{t(menu.fullscreen ? "전체화면 종료" : "전체화면")}</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[var(--foreground)] hover:bg-[var(--interactive-hover)]"
                  onClick={() => {
                    menu.setOpen(false)
                    menu.copyPath()
                  }}
                  type="button"
                >
                  <Copy size={13} />
                  <span>{t("경로 복사")}</span>
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[var(--foreground)] hover:bg-[var(--interactive-hover)]"
                  onClick={() => {
                    menu.setOpen(false)
                    menu.runLatexPostprocess()
                  }}
                  type="button"
                >
                  <Wand2 size={13} />
                  <span>{t("LaTeX 후처리")}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // PDF와 변환된 PPT/PPTX는 PDF 워크스페이스 헤더를 쓰므로 이 정리본 헤더는 숨긴다.
  if (viewerDocumentIsPdf(document)) return null

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold">{document?.title ?? t("정리본 뷰어")}</h2>
        <p className="truncate text-sm text-[var(--muted-foreground)]">
          {document?.file_path || t("리포트를 선택하면 본문을 표시합니다.")}
        </p>
      </div>
      <Button disabled={!document?.file_path} onClick={() => menu.openFullscreen()} size="sm" variant="outline">
        <Maximize2 size={15} />
        {t("전체화면")}
      </Button>
    </div>
  )
}
