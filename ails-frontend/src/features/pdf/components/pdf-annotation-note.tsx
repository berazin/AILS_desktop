import { useRef, useState, type PointerEvent, type RefObject } from "react"
import { GripHorizontal, Pin, PinOff } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { useProcessbarScrollProximity } from "../../../shared/hooks/use-processbar-scroll-proximity.ts"
import "../../../shared/ui/processbar-scroll.css"

export type PdfAnnotationNoteValue = {
  annotationId: string
  color: string
  fontSize: number
  text: string
  x: number
  y: number
  pinned: boolean
}
type Position = { x: number; y: number }
type Props = {
  value: PdfAnnotationNoteValue
  pageRef: RefObject<HTMLDivElement | null>
  editing?: boolean
  erasing: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
  onChange?: (text: string) => void
  onCommit?: () => void
  onCancel?: () => void
  onEdit?: () => void
  onMove: (position: Position) => void
  onPin: (pinned: boolean) => void
  onRightErase: () => void
}

export function PdfAnnotationNote({ value, pageRef, editing, erasing, inputRef, onChange, onCommit, onCancel, onEdit, onMove, onPin, onRightErase }: Props) {
  const noteRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number; start: Position; client: Position; position: Position } | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  useProcessbarScrollProximity(noteRef)
  const point = position ?? value
  const pinLabel = value.pinned ? t("메모 고정 해제") : t("메모 고정")
  function clampPosition(next: Position) {
    const page = pageRef.current?.getBoundingClientRect()
    const note = noteRef.current?.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(page && note ? Math.max(0, 1 - note.width / page.width) : 1, next.x)),
      y: Math.max(0, Math.min(page && note ? Math.max(0, 1 - note.height / page.height) : 1, next.y)),
    }
  }
  function beginMove(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
    if (event.button !== 0 || value.pinned || erasing) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, start: { x: value.x, y: value.y }, client: { x: event.clientX, y: event.clientY }, position: { x: value.x, y: value.y } }
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
    const drag = dragRef.current
    const page = pageRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !page?.width || !page.height) return
    drag.position = clampPosition({ x: drag.start.x + (event.clientX - drag.client.x) / page.width, y: drag.start.y + (event.clientY - drag.client.y) / page.height })
    setPosition(drag.position)
  }
  function finishMove(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setPosition(null)
    if (!cancelled && (drag.position.x !== value.x || drag.position.y !== value.y)) onMove(drag.position)
  }
  return <div ref={noteRef} data-pdf-annotation-note data-pdf-note-pinned={value.pinned} data-pdf-annotation-id={editing ? undefined : value.annotationId} data-pdf-annotation-control="true"
    role="group" aria-label={t("PDF 메모")}
    className={`absolute flex flex-col overflow-hidden rounded-md border shadow-sm ${editing ? "z-20 border-2 bg-[var(--panel)]/95 shadow-xl" : "border-current/25 bg-[var(--panel)]/88 backdrop-blur-sm"}`}
    style={{ color: value.color, fontSize: value.fontSize, left: `${point.x * 100}%`, top: `${point.y * 100}%`, width: `min(220px, ${Math.max(8, (1 - point.x) * 100)}%)`, ...(editing ? { borderColor: value.color } : {}), pointerEvents: "auto" }}
    onPointerDown={(event) => { event.stopPropagation(); if (event.button === 2) onRightErase() }}
    onPointerMove={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
    onBlur={(event) => { if (editing && !event.currentTarget.contains(event.relatedTarget)) onCommit?.() }}>
    {editing ? <textarea ref={inputRef} aria-label={t("메모 내용")} rows={3}
      className="ails-processbar-scroll min-h-16 max-h-64 w-full resize-y overflow-auto bg-transparent px-2 py-1 leading-snug text-[var(--foreground)] outline-none"
      style={{ scrollbarGutter: "stable" }} placeholder={t("추가 설명을 입력하세요")} value={value.text}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onCancel?.() }
        else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onCommit?.() }
      }} />
      : <div role="button" tabIndex={0} data-pdf-note-content className="ails-processbar-scroll max-h-40 overflow-y-auto whitespace-pre-wrap break-words px-2 py-1 text-left leading-snug outline-none"
        style={{ scrollbarGutter: "stable" }} title={erasing ? t("눌러서 삭제") : t("두 번 눌러 수정")}
        onDoubleClick={(event) => { event.preventDefault(); onEdit?.() }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onEdit?.() } }}>{value.text}</div>}
    <div className="flex h-6 shrink-0 items-center justify-between px-1 text-[var(--muted-foreground)]">
      <button type="button" aria-label={t("메모 이동")} title={value.pinned ? t("메모 위치가 고정되어 있습니다") : t("드래그하여 메모 이동")}
        disabled={value.pinned || erasing} className="rounded p-1 hover:bg-[var(--interactive-hover)] enabled:cursor-move disabled:opacity-30"
        onPointerDown={beginMove} onPointerMove={move} onPointerUp={(event) => finishMove(event)} onPointerCancel={(event) => finishMove(event, true)}
        onLostPointerCapture={(event) => finishMove(event, true)}
        onKeyDown={(event) => {
          const offset = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] }[event.key]
          const page = pageRef.current?.getBoundingClientRect()
          if (!offset || !page?.width || !page.height || value.pinned || erasing) return
          event.preventDefault()
          onMove(clampPosition({ x: value.x + offset[0] / page.width, y: value.y + offset[1] / page.height }))
        }}><GripHorizontal size={14} /></button>
      <button type="button" aria-label={pinLabel} title={pinLabel} aria-pressed={value.pinned} disabled={erasing}
        className={`rounded p-1 hover:bg-[var(--interactive-hover)] disabled:opacity-30 ${value.pinned ? "text-[var(--brand)]" : "text-[var(--muted-foreground)]"}`}
        onPointerDown={(event) => { if (event.button === 0) event.preventDefault() }} onClick={() => onPin(!value.pinned)}>
        {value.pinned ? <Pin size={14} /> : <PinOff size={14} />}
      </button>
    </div>
  </div>
}
