import { useCallback, useMemo, useRef, useState } from "react"
import type { PracticeTutorContext } from "../../../lib/api/practice-tutor.ts"
import { practiceTutorLayout, practiceTutorColumnLayout, summaryTutorLayout, type PracticeSplit } from "../lib/practice-tutor-layout.ts"

export function usePracticeTutorWorkspace(viewport: { width: number; height: number }, pdfColumnWidth?: number) {
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const [context, setContext] = useState<PracticeTutorContext | null>(null)
  const [includeContext, setIncludeContext] = useState(true)
  const [navigationExpanded, setNavigationExpanded] = useState(false)
  const [solutionWidth, setSolutionWidth] = useState<number | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(160)
  const [normalSidebarWidth, setNormalSidebarWidth] = useState(160)
  const [tab, setTab] = useState<"pdf" | "chat">("chat")
  const [draftRequest, setDraftRequest] = useState<{ id: string; text: string } | null>(null)
  const [chatWidth, setChatWidth] = useState(() => {
    try { const saved = Number(localStorage.getItem("ails_practice_tutor_width")); return Number.isFinite(saved) && saved > 0 ? Math.max(300, Math.min(700, saved)) : 370 } catch { return 370 }
  })
  const [base, setBase] = useState<PracticeSplit | null>(null)
  const layout = useMemo(() => context?.source_kind === "summary" ? summaryTutorLayout(viewport.width, viewport.height, chatWidth)
    : pdfColumnWidth ? practiceTutorColumnLayout(pdfColumnWidth, viewport.height)
    : base ? practiceTutorLayout(base, viewport.width, viewport.height, sidebarWidth, chatWidth, navigationExpanded, solutionWidth, normalSidebarWidth) : null,
    [context?.source_kind, base, viewport.width, viewport.height, sidebarWidth, chatWidth, navigationExpanded, solutionWidth, normalSidebarWidth, pdfColumnWidth])
  const owners = useRef(new Map<string, { context: PracticeTutorContext; sidebar: number; normalSidebar: number }>())
  const publish = useCallback((owner: string, next: PracticeTutorContext | null, sidebar = 160, normalSidebar = sidebar) => {
    if (next) owners.current.set(owner, { context: next, sidebar, normalSidebar })
    else owners.current.delete(owner)
    const selected = [...owners.current.values()].at(-1)
    setContext(current => JSON.stringify(current) === JSON.stringify(selected?.context ?? null) ? current : selected?.context ?? null)
    if (selected) { setSidebarWidth(selected.sidebar); setNormalSidebarWidth(selected.normalSidebar) }
  }, [])
  const toggle = useCallback(() => {
    setOpen(current => !current)
    setEverOpened(true)
    setTab("chat")
    setNavigationExpanded(false)
    setSolutionWidth(null)
  }, [])
  const show = useCallback(() => { setOpen(true); setEverOpened(true); setTab("chat"); setNavigationExpanded(false) }, [])
  const resize = useCallback((value: number) => {
    const safe = Math.max(300, Math.min(700, value))
    setChatWidth(safe)
    try { localStorage.setItem("ails_practice_tutor_width", String(safe)) } catch { /* The panel still resizes without storage. */ }
  }, [])
  const requestContext = useMemo(() => context ? (includeContext ? { ...context, include_context: true }
    : { ...context, include_context: false, question: "", choices: [], code: [], user_answer: "", selected_choice: "", selected_text: undefined, result: undefined }) : null,
  [context, includeContext])
  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(context?.source_kind === "summary"
      ? '[data-material-practice-solver] [data-practice-tutor-entry]' : '[data-ails-practice-mode="true"] [data-practice-tutor-entry]')?.focus({ preventScroll: true }))
  }, [context?.source_kind])
  return { open: open && Boolean(context), everOpened, context, includeContext, setIncludeContext, navigationExpanded, setNavigationExpanded, draftRequest,
    prepare: (text: string) => { show(); setDraftRequest({ id: crypto.randomUUID(), text }) },
    sidebarWidth, normalSidebarWidth, setSidebarWidth, tab, setTab, chatWidth, resize, solutionWidth,
    resizeSolution: (value: number) => setSolutionWidth(Math.max(340, value - (navigationExpanded ? sidebarWidth : 48))),
    base, setBase, layout, publish, toggle, show,
    close, requestContext, snapshot: () => requestContext ? structuredClone(requestContext) : null }
}
export type PracticeTutorWorkspace = ReturnType<typeof usePracticeTutorWorkspace>
