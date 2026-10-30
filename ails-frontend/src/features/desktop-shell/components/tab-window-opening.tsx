import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { X } from "lucide-react"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"

export function TabWindowOpening({ children }: { children: ReactNode }) {
  const [transferWindow] = useState(() => new URLSearchParams(location.search).get("tabTransferPending") === "1")
  const [pending, setPending] = useState(transferWindow)
  useEffect(() => {
    if (!transferWindow) return
    return getAppDesktopApi()?.on_tab_window_event?.(event => {
      if (event.type !== "transfer-ready") return
      setPending(false)
      const url = new URL(location.href)
      url.searchParams.delete("tabTransferPending")
      history.replaceState(history.state, "", url)
    })
  }, [transferWindow])
  if (!transferWindow) return children
  // Keep this wrapper after restoration so the real workspace never remounts.
  return <>
    <div className="h-full min-h-0" inert={pending}>{children}</div>
    {pending && <div data-tab-window-opening role="status" aria-live="polite"
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-[var(--background)] text-sm text-[var(--muted-foreground)]"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
      자료 여는 중…
      <button type="button" aria-label="창 닫기" title="창 닫기" onClick={() => { void getAppDesktopApi()?.close?.() }}
        className="absolute right-0 top-0 flex h-8 w-12 items-center justify-center text-[var(--foreground)] hover:bg-[var(--interactive-hover)]">
        <X size={14} />
      </button>
    </div>}
  </>
}
