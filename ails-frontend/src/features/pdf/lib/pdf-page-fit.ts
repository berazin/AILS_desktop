export function pdfPageFitScale(pageWidth: number, pageHeight: number, slotWidth: number, slotHeight: number, zoom: number) {
  return Math.max(0.01, Math.min(slotWidth / pageWidth, slotHeight / pageHeight)) * zoom
}
