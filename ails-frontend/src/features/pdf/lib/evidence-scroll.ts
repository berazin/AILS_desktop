export type EvidenceScroll = { top: number; left: number }[]

export function captureEvidenceScroll(root: HTMLElement | null): EvidenceScroll {
  return root ? [...root.querySelectorAll<HTMLElement>("[data-pdf-scroll-viewport]")].map(element => ({ top: element.scrollTop, left: element.scrollLeft })) : []
}

export function restoreEvidenceScroll(root: HTMLElement, positions: EvidenceScroll = []) {
  root.querySelectorAll<HTMLElement>("[data-pdf-scroll-viewport]").forEach((element, index) => {
    element.scrollTop = positions[index]?.top ?? 0
    element.scrollLeft = positions[index]?.left ?? 0
  })
}
