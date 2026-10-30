import { ClipboardList, Loader2, X } from "lucide-react"

import type { DebugTraceWorkflow } from "../hooks/use-debug-trace-workflow.ts"
import { stringifyDebugValue } from "../lib/debug-trace.ts"
import { t } from "../../../lib/i18n.ts"
import { FloatingChatbotWindow } from "../../document/components/document-windows.tsx"
import { Badge } from "../../../shared/ui/badge.tsx"
import { Button } from "../../../shared/ui/button.tsx"

type DebugTraceWindowProps = {
  isBusy: (key: string) => boolean
  viewportSize: { width: number; height: number }
  workflow: DebugTraceWorkflow
}

export function DebugTraceWindow({ isBusy, viewportSize, workflow }: DebugTraceWindowProps) {
  if (!workflow.open) return null

  return (
    <FloatingChatbotWindow
      className="z-[70]"
      hidden={false}
      position={{
        x: Math.max(20, viewportSize.width - Math.min(600, Math.max(320, viewportSize.width - 40)) - 20),
        y: Math.max(20, viewportSize.height - Math.min(520, Math.max(320, viewportSize.height - 40)) - 20),
      }}
      size={{
        width: Math.min(600, Math.max(320, viewportSize.width - 40)),
        height: Math.min(520, Math.max(320, viewportSize.height - 40)),
      }}
      storageKey="ails-debug-trace"
      transformOrigin="bottom right"
      windowKind="debug-trace"
    >
      <section className="flex h-full min-h-0 flex-col overflow-hidden text-[var(--foreground)]">
        <div
          className="flex cursor-move select-none items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3"
          data-ails-drag-handle="true"
        >
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{t("디버그 추적")}</h3>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {t("로컬·클라우드 AI에 전달된 프롬프트와 출력을 확인합니다.")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy("copy-debug")}
              onClick={() => void workflow.copy(workflow.filteredText, workflow.filteredEvents.length)}
            >
              {isBusy("copy-debug")
                ? <Loader2 className="animate-spin" size={14} />
                : <ClipboardList size={14} />}
              {t("복사")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => workflow.setOpen(false)}
              title={t("디버그 추적 창 닫기")}
            >
              <X size={16} />
            </Button>
          </div>
        </div>
        <div className="flex gap-2 border-b border-[var(--border)] px-4 py-2">
          {([ ["all", t("전체")], ["local", t("로컬")], ["cloud", t("클라우드")] ] as const)
            .map(([value, label]) => (
              <Button
                key={value}
                aria-pressed={workflow.filter === value}
                onClick={() => workflow.setFilter(value)}
                size="sm"
                variant={workflow.filter === value ? "default" : "outline"}
              >
                {label}
              </Button>
            ))}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--muted)] p-4 text-xs text-[var(--muted-foreground)]">
          {workflow.filteredEvents.length === 0 ? (
            <p>{t("선택한 범위의 디버그 추적 데이터가 없습니다.")}</p>
          ) : workflow.filteredEvents.map((event, index) => (
            <article
              className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3"
              key={`${event.time}-${event.label}-${index}`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge className={event.source === "cloud" ? "bg-[var(--brand)] text-[var(--brand-foreground)]" : undefined}>
                  {event.source === "local" ? t("로컬") : event.source === "cloud" ? t("클라우드") : t("시스템")}
                </Badge>
                <Badge>
                  {event.direction === "input" ? t("입력") : event.direction === "output" ? t("출력") : t("이벤트")}
                </Badge>
                <span className="font-semibold text-[var(--foreground)]">{event.label}</span>
                {event.model && <span>{event.model}</span>}
                {event.time && <time className="ml-auto">{event.time}</time>}
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono leading-5">
                {stringifyDebugValue(event.content)}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </FloatingChatbotWindow>
  )
}
