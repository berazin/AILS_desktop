import type { pdfPracticeSplitLayout } from "../../../lib/pdf-view-layout.ts"

export type PracticeSplit = ReturnType<typeof pdfPracticeSplitLayout>
export type TutorLayoutMode = "wide" | "tabs" | "stacked" | "column"
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function practiceTutorColumnLayout(width: number, height: number) {
  const contentHeight = Math.max(0, height - 32)
  const editorHeight = Math.round(contentHeight * 0.55)
  return { mode: "column" as const, navWidth: 48,
    dock: { x: 0, y: 32 + editorHeight, width, height: contentHeight - editorHeight },
    split: { splitX: width,
      editor: { position: { x: 0, y: 32 }, size: { width, height: editorHeight } },
      pdf: { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } } } }
}

export function summaryTutorLayout(width: number, height: number, preferredWidth: number) {
  const stacked = width < 1100
  const contentHeight = Math.max(0, height - 32)
  const chatWidth = clamp(preferredWidth, 300, Math.max(300, width - 500))
  const editorHeight = stacked ? Math.min(Math.round(contentHeight * 0.56), Math.max(0, contentHeight - 260)) : contentHeight
  const editorWidth = stacked ? width : width - chatWidth
  const dock = { x: stacked ? 0 : editorWidth, y: stacked ? 32 + editorHeight : 32,
    width: stacked ? width : chatWidth, height: stacked ? contentHeight - editorHeight : contentHeight }
  return { mode: (stacked ? "stacked" : "wide") as TutorLayoutMode, navWidth: 48, dock,
    split: { splitX: editorWidth, editor: { position: { x: 0, y: 32 }, size: { width: editorWidth, height: editorHeight } },
      pdf: { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } } } }
}

export function practiceTutorLayout(base: PracticeSplit, width: number, height: number, sidebar: number, preferredWidth: number,
  navigationExpanded = false, preferredSolutionWidth: number | null = null, normalSidebarWidth = sidebar) {
  const navWidth = navigationExpanded ? sidebar : 48
  const solutionWidth = Math.max(340, preferredSolutionWidth ?? base.editor.size.width - normalSidebarWidth)
  const mode: TutorLayoutMode = width >= 1500 ? "wide" : width >= 1100 ? "tabs" : "stacked"
  const contentHeight = Math.max(0, height - 32)
  const editorWidth = mode === "stacked" ? width : clamp(solutionWidth + navWidth, 420, width - (mode === "wide" ? 660 : 340))
  const chatWidth = mode === "wide" ? clamp(preferredWidth, 300, Math.max(300, width - editorWidth - 360)) : width - editorWidth
  const editorHeight = mode === "stacked" ? Math.min(Math.round(contentHeight * 0.56), Math.max(0, contentHeight - 260)) : contentHeight
  const dock = mode === "wide" ? { x: width - chatWidth, y: 32, width: chatWidth, height: contentHeight }
    : mode === "tabs" ? { x: editorWidth, y: 32, width: width - editorWidth, height: contentHeight }
      : { x: 0, y: 32 + editorHeight, width, height: contentHeight - editorHeight }
  const tabsHeight = mode === "wide" ? 0 : 32
  return { mode, navWidth, dock, split: {
    splitX: editorWidth,
    editor: { position: { x: 0, y: 32 }, size: { width: editorWidth, height: editorHeight } },
    pdf: { position: { x: mode === "stacked" ? 0 : editorWidth, y: mode === "stacked" ? dock.y + tabsHeight : 32 + tabsHeight },
      size: { width: mode === "wide" ? width - editorWidth - chatWidth : dock.width, height: dock.height - tabsHeight } },
  } }
}
