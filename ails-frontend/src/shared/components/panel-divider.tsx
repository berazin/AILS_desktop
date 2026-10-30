import { useState, type PointerEvent } from "react"

export function PanelDivider({ label, vertical = false, reverse = false, value, onChange }: {
  label: string; vertical?: boolean; reverse?: boolean; value: number; onChange: (value: number) => void
}) {
  const [drag, setDrag] = useState<{ position: number; value: number } | null>(null)
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    onChange(drag.value + (vertical ? event.clientX - drag.position : drag.position - event.clientY) * (reverse ? -1 : 1))
  }
  return <div role="separator" aria-label={label} aria-orientation={vertical ? "vertical" : "horizontal"} aria-valuenow={value} tabIndex={0}
    className={`z-10 shrink-0 touch-none bg-[var(--border)] hover:bg-[var(--brand)] focus:bg-[var(--brand)] ${vertical ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ position: vertical ? event.clientX : event.clientY, value }) }}
    onPointerMove={move} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); setDrag(null) }} onPointerCancel={() => setDrag(null)}
    onKeyDown={(event) => {
      const increase = vertical ? "ArrowRight" : "ArrowUp", decrease = vertical ? "ArrowLeft" : "ArrowDown"
      if (event.key === increase || event.key === decrease) { event.preventDefault(); onChange(value + (event.key === increase ? 10 : -10) * (reverse ? -1 : 1)) }
    }} />
}
