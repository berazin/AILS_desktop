import type { DragEvent, PointerEvent } from "react"
import { ExternalLink, GripVertical } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { ChatMessage } from "../hooks/use-chat-controller.ts"

export function ChatAnswerActions({ message, mode, onDragEnd, onDragStart, onPointerDown, onOpen }: {
  message: ChatMessage
  mode: "inline" | "window"
  onDragEnd: (event: DragEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>, message: ChatMessage, mode: "inline" | "window") => void
  onPointerDown: (event: PointerEvent<HTMLElement>, message: ChatMessage, mode: "inline" | "window") => void
  onOpen: (message: ChatMessage) => void
}) {
  return <div data-ails-chat-answer-actions="true"
    className="ml-auto mt-1 flex w-fit items-center gap-0.5 rounded-lg bg-[var(--background)]/90 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
    <div aria-label={t("답변 링크 드래그")} title={t("답변 링크 드래그")} draggable
      className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      onDragEnd={onDragEnd} onDragStart={event => onDragStart(event, message, mode)}
      onPointerDownCapture={event => onPointerDown(event, message, mode)}>
      <GripVertical size={16} />
    </div>
    <button aria-label={t("새 창으로 열기")} title={t("새 창으로 열기")} type="button"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      onClick={() => onOpen(message)}><ExternalLink size={13} /></button>
  </div>
}
