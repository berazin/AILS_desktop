import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { t } from "../../../lib/i18n.ts"
import { installTabHoverPreview, type TabHoverPreviewInput, type TabHoverPreviewState } from "../lib/tab-hover-preview.ts"
import { TabHoverPreviewContent } from "./tab-hover-preview-content.tsx"
import "./process-bar-tab-hover-preview.css"

export function ProcessBarTabHoverPreview({ containerRef, activeId, tabs, groups }: TabHoverPreviewInput & {
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const [preview, setPreview] = useState<TabHoverPreviewState | null>(null)
  const state = useRef({ activeId, tabs, groups })
  const controller = useRef<ReturnType<typeof installTabHoverPreview> | null>(null)
  useLayoutEffect(() => {
    state.current = { activeId, tabs, groups }
    controller.current?.sync()
  }, [activeId, tabs, groups])
  useEffect(() => {
    const container = containerRef.current, api = getAppDesktopApi()
    if (!container || !api?.capture_tab_screen) return
    const installed = installTabHoverPreview(container, () => state.current, api.capture_tab_screen, setPreview)
    controller.current = installed
    return () => { installed.dispose(); controller.current = null }
  }, [containerRef])
  return preview ? createPortal(<div className="ails-tab-hover-preview" data-tab-hover-preview={preview.id} role="tooltip"
    aria-label={`${preview.title} ${t("화면 미리보기")}`}
    style={{ transform: `translate3d(${preview.left}px, ${preview.top}px, 0)`, width: preview.width }}>
    <TabHoverPreviewContent preview={preview} />
  </div>, document.body) : null
}
