import { ChevronRight } from "lucide-react"
import { useId, useMemo, type ReactNode } from "react"

import { t } from "../../../lib/i18n.ts"
import type { PdfOcrStatus } from "../../../lib/api"
import { buildPdfOutlineTree, type PdfOutlineNode } from "../../../lib/pdf-outline.ts"
import { cn } from "../../../lib/utils.ts"

export function PdfOutlineTree({
  outline,
  expandedSections,
  onToggleSection,
  onSelectPage,
}: {
  outline: PdfOcrStatus["outline"]
  expandedSections: ReadonlySet<string>
  onToggleSection: (id: string) => void
  onSelectPage: (page: number) => void
}) {
  const outlineTreeId = useId()
  const tree = useMemo(() => buildPdfOutlineTree(outline), [outline])

  function renderNodes(nodes: PdfOutlineNode[]): ReactNode {
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0
      const isExpanded = hasChildren && expandedSections.has(node.id)
      const childrenId = `${outlineTreeId}-${node.id}-children`
      return (
        <div key={node.id}>
          <div className="flex min-w-0 items-center gap-0.5 rounded hover:bg-white/10">
            {hasChildren ? (
              <button
                aria-controls={childrenId}
                aria-expanded={isExpanded}
                aria-label={t("{p0} 소단원 {p1}", { p0: node.title, p1: isExpanded ? "접기" : "펼치기" })}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                onClick={() => onToggleSection(node.id)}
                type="button"
              >
                <ChevronRight className={cn("transition-transform", isExpanded && "rotate-90")} size={12} />
              </button>
            ) : (
              <span className="h-6 w-6 shrink-0" />
            )}
            <button
              className={cn(
                "flex min-w-0 flex-1 items-center justify-between gap-2 rounded py-1 pr-2 text-left",
                hasChildren ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
              )}
              onClick={() => onSelectPage(node.page)}
              type="button"
            >
              <span className="min-w-0 truncate">{node.title}</span>
              <span className="shrink-0 font-normal text-[var(--muted-foreground)] opacity-70">· {node.page}</span>
            </button>
          </div>
          {isExpanded && (
            <div className="ml-3 border-l border-white/10 pl-2" id={childrenId}>
              {renderNodes(node.children)}
            </div>
          )}
        </div>
      )
    })
  }

  if (tree.length === 0) {
    return <div className="px-2 py-3 text-[var(--muted-foreground)]">{t("감지된 목차가 없습니다.")}</div>
  }
  return <div className="space-y-0.5">{renderNodes(tree)}</div>
}
