// The workbench owns the PDF when an IDE split is visible. Reserve a separate
// solver column instead of letting both layouts reposition the same PDF.
export function practiceIdeLayout(viewport: { width: number; height: number }) {
  const width = Math.min(520, Math.max(420, viewport.width / 3))
  return { x: 0, y: 32, width, height: Math.max(0, viewport.height - 32) }
}
