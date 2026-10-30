import { PROCESSBAR_REORDER_EVENT } from "./process-bar-tab-reorder.ts"
import type { TabTransferPreviewItem } from "../../../shared/workspace-tab-transfer.ts"

type Slot = { element: HTMLElement; id: string; x: number; width: number }

export function installTabInsertionPreview(container: HTMLElement) {
  let ghost: HTMLDivElement | null = null
  let slots: Slot[] = []
  let index = -1
  let dragId = ""
  let bounds: DOMRect | undefined
  let ghostWidth = 0
  const units = () => Array.from(container.children).filter((node): node is HTMLElement => node instanceof HTMLElement
    && node.hasAttribute("data-ails-processbar-tab") && !node.hasAttribute("data-tab-transfer-source"))
  const idOf = (element: HTMLElement) => element.dataset.tabId ?? element.querySelector<HTMLElement>("[data-tab-id]")?.dataset.tabId ?? ""
  const syncSelection = () => {
    const selected = container.querySelector<HTMLElement>('[data-tab-id][aria-selected="true"]')
    const tab = selected?.closest<HTMLElement>("[data-split-tab-group]") ?? selected
    const rect = tab?.offsetWidth ? tab.getBoundingClientRect() : null
    const parent = container.getBoundingClientRect()
    container.dispatchEvent(new CustomEvent(PROCESSBAR_REORDER_EVENT, {
      detail: rect && tab ? { id: idOf(tab), x: rect.left - parent.left + container.scrollLeft - container.clientLeft,
        width: rect.width, height: rect.height, detached: tab.dataset.tabDetached === "true" ? 1 : 0, stretch: 0 } : null,
    }))
  }
  const createGhost = (items: TabTransferPreviewItem[]) => {
    const element = document.createElement("div")
    element.dataset.tabAppendPreview = ""
    element.className = "ails-tab-insertion-preview"
    element.setAttribute("role", "status")
    element.setAttribute("aria-label", `탭 삽입 미리보기: ${items.map(item => item.title).join(", ")}`)
    for (const item of items) {
      const tab = document.createElement("span")
      tab.className = "ails-tab-insertion-preview-item"
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("width", "12"); icon.setAttribute("height", "12")
      icon.setAttribute("fill", "none"); icon.setAttribute("stroke", "currentColor"); icon.setAttribute("stroke-width", "2")
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
      path.setAttribute("d", item.kind === "home" ? "M3 10L12 3L21 10V21H3ZM9 21V14H15V21"
        : ["code", "code-workspace", "ipynb"].includes(item.kind) ? "M8 5L2 12L8 19M16 5L22 12L16 19M14 3L10 21"
        : "M5 3H15L19 7V21H5ZM14 3V8H19M8 12H16M8 16H16")
      icon.append(path)
      const title = document.createElement("span")
      title.textContent = item.title; title.className = "ails-tab-insertion-preview-title"
      tab.append(icon, title); element.append(tab)
    }
    return element
  }
  const locate = (clientX: number) => {
    if (!bounds) return 0
    let x = clientX - bounds.left + container.scrollLeft
    if (ghost && index >= 0) {
      const left = index < slots.length ? slots[index].x : (slots.at(-1)?.x ?? 8) + (slots.at(-1)?.width ?? 0) + 4
      if (x >= left && x <= left + ghostWidth + 4) return index
      if (x > left + ghostWidth + 4) x -= ghostWidth + 4
    }
    const next = slots.findIndex(slot => x < slot.x + slot.width / 2)
    return next < 0 ? slots.length : next
  }
  const clear = () => {
    if (!ghost) return
    ghost.remove(); ghost = null; index = -1; dragId = ""
    container.removeAttribute("data-tab-insertion-preview")
    slots = []
    syncSelection()
  }
  const update = (id: string, items: TabTransferPreviewItem[], point: { x: number; y: number }) => {
    if (dragId !== id) { clear(); dragId = id; index = -1 }
    const measuredBounds = container.getBoundingClientRect()
    bounds = measuredBounds
    if (!ghost) {
      slots = units().map(element => {
        const rect = element.getBoundingClientRect()
        return { element, id: idOf(element), x: rect.left - measuredBounds.left + container.scrollLeft, width: rect.width }
      })
      ghost = createGhost(items)
      container.setAttribute("data-tab-insertion-preview", "")
    }
    const next = locate(point.x)
    if (next !== index || !ghost.isConnected) {
      index = next
      container.insertBefore(ghost, slots[index]?.element ?? container.querySelector('[data-ails-processbar-hover-button="new-tab"]'))
      ghostWidth = ghost.getBoundingClientRect().width
      // Reserve the gap and align the active surface in the same frame.
      // The incoming tab and its peers never start a preview animation.
      syncSelection()
    }
    if (point.x > bounds.right - 28) container.scrollLeft += 10
    else if (point.x < bounds.left + 28) container.scrollLeft -= 10
    return slots[index]?.id ?? null
  }
  return { update, beforeId: (x: number) => slots[locate(x)]?.id ?? null, clear, dispose: clear }
}
