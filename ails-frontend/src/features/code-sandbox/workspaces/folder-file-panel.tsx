import { useEffect, useId, useRef, useState } from "react"
import { PinOff } from "lucide-react"
import { FolderFileSidebar, type FolderFileSidebarProps } from "./folder-file-sidebar.tsx"
import { PanelDivider } from "../../../shared/components/panel-divider.tsx"

export function FolderFilePanel({ width, onResize, ...props }: Omit<FolderFileSidebarProps, "pinned" | "onTogglePin"> & {
  width: number; onResize: (value: number) => void
}) {
  const storageKey = `ails-folder-sidebar-pinned:${props.workspace.id}`
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "false" } catch { return true }
  })
  const [preview, setPreview] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hovered = useRef(false)
  const resizing = useRef(false)
  const panelId = useId()
  const open = pinned || preview

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(pinned)) } catch { /* Keep the pin usable when storage is unavailable. */ }
  }, [storageKey, pinned])
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  function reveal() { cancelClose(); setPreview(true) }
  function scheduleClose() {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      const focused = document.activeElement
      const keyboardFocus = focused && rootRef.current?.contains(focused) && focused.matches(":focus-visible")
      if (!hovered.current && !resizing.current && !keyboardFocus) setPreview(false)
    }, 300)
  }
  function togglePin() {
    cancelClose()
    setPinned(!pinned)
    setPreview(false)
  }

  return <div ref={rootRef} data-ails-file-panel data-pinned={pinned} data-expanded={open}
    className="relative shrink-0" style={{ width: pinned ? width + 4 : 24, maxWidth: pinned ? "45%" : undefined }}
    onPointerEnter={(event) => { if (event.pointerType !== "touch") { hovered.current = true; reveal() } }}
    onPointerLeave={() => { hovered.current = false; scheduleClose() }}
    onFocusCapture={(event) => { if (event.target.matches(":focus-visible")) reveal() }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose() }}
    onGotPointerCapture={() => { resizing.current = true; cancelClose() }}
    onLostPointerCapture={() => { resizing.current = false; scheduleClose() }}
    onDragEnter={() => { hovered.current = true; reveal() }}
    onDragOver={() => { hovered.current = true; cancelClose() }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { hovered.current = false; scheduleClose() } }}
    onDragEnd={() => { hovered.current = rootRef.current?.matches(":hover") ?? false; scheduleClose() }}>
    {!pinned && <div className="flex h-full flex-col items-center border-r border-[var(--border)] bg-[var(--background)]">
      <button className="flex h-8 w-full items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--brand)]"
        aria-label="파일 탐색기 펼치고 고정" aria-controls={panelId} aria-expanded={open}
        title="마우스를 가까이 대면 펼쳐집니다. 클릭하면 고정합니다." onClick={togglePin}><PinOff size={14} /></button>
    </div>}
    <div id={panelId} inert={!open} aria-hidden={!open}
      className={pinned ? "flex h-full w-full" : "absolute inset-y-0 left-0 z-40 flex border-r border-[var(--border)] bg-[var(--panel)] shadow-xl transition-[opacity,transform] duration-150 motion-reduce:transition-none"}
      style={pinned ? undefined : { width: width + 4, maxWidth: "calc(100vw - 48px)", visibility: open ? "visible" : "hidden", opacity: open ? 1 : 0, transform: open ? "translateX(0)" : "translateX(-8px)" }}>
      <FolderFileSidebar {...props} pinned={pinned} onTogglePin={togglePin} />
      <PanelDivider label="파일 탐색기 크기" vertical value={width} onChange={onResize} />
    </div>
  </div>
}
