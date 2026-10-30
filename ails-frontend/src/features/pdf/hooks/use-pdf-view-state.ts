import { useCallback, useRef, useState } from 'react'
import type { PdfSearchResult } from '../../../lib/api'
import { normalizePdfViewZoom, type PdfColorMode, type PdfPageLayout, type PdfSpreadSide } from '../../../lib/pdf-view-layout.ts'

// This hook owns view state; other PDF domains interact through its returned contract.
export function usePdfViewState() {
  const [pdfOcrTextVisible, setPdfOcrTextVisible] = useState(
    () => localStorage.getItem("ails_pdf_ocr_text_visible") === "true",
  )
  const [pdfPageLayout, setPdfPageLayout] = useState<PdfPageLayout>(
    () => localStorage.getItem("ails_pdf_page_layout") === "spread" ? "spread" : "single",
  )
  const [presentationPageLayout, setPresentationPageLayout] = useState<PdfPageLayout>(
    () => localStorage.getItem("ails_presentation_page_layout") === "spread" ? "spread" : "single",
  )
  const [pdfSpreadSide, setPdfSpreadSide] = useState<PdfSpreadSide>(
    () => localStorage.getItem("ails_pdf_spread_side") === "odd-left" ? "odd-left" : "even-left",
  )
  const [pdfColorMode, setPdfColorMode] = useState<PdfColorMode>(
    () => localStorage.getItem("ails_pdf_color_mode") === "original" ? "original" : "theme",
  )
  const [pdfThemeContrast, setPdfThemeContrast] = useState(() => {
    const value = Number(localStorage.getItem("ails_pdf_theme_contrast"))
    return Number.isFinite(value) && value >= 0.75 && value <= 2 ? value : 1
  })
  const [pdfThemeBrightness, setPdfThemeBrightness] = useState(() => {
    const value = Number(localStorage.getItem("ails_pdf_theme_brightness"))
    return Number.isFinite(value) && value >= 0.6 && value <= 1 ? value : 0.8
  })
  const [pdfThemeSharpness, setPdfThemeSharpness] = useState(() => {
    const value = Number(localStorage.getItem("ails_pdf_theme_sharpness"))
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
  })
  const [pdfThemeTextBrightness, setPdfThemeTextBrightness] = useState(() => {
    const value = Number(localStorage.getItem("ails_pdf_theme_text_brightness"))
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
  })
  const [pdfViewZoom, setPdfViewZoom] = useState(
    () => normalizePdfViewZoom(localStorage.getItem("ails_pdf_view_zoom")),
  )
  const pdfViewZoomRef = useRef(pdfViewZoom)
  const pdfViewZoomCommitTimerRef = useRef<number | null>(null)
  const [pdfTextToolsOpen, setPdfTextToolsOpenState] = useState(false)
  const pdfTextToolsOpenRef = useRef(false)
  const [pdfSearchQuery, setPdfSearchQueryState] = useState("")
  const pdfSearchQueryRef = useRef("")
  const [pdfSearchResults, setPdfSearchResults] = useState<PdfSearchResult[]>([])
  const [pdfSearchLoading, setPdfSearchLoading] = useState(false)
  const setPdfSearchQuery = useCallback((next: string | ((current: string) => string)) => {
    const query = typeof next === "function" ? next(pdfSearchQueryRef.current) : next
    if (query === pdfSearchQueryRef.current) return
    pdfSearchQueryRef.current = query
    setPdfSearchQueryState(query)
    setPdfSearchResults(current => current.length ? [] : current)
    setPdfSearchLoading(Boolean(query.trim()))
  }, [])
  const setPdfTextToolsOpen = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    const open = typeof next === "function" ? next(pdfTextToolsOpenRef.current) : next
    pdfTextToolsOpenRef.current = open
    setPdfTextToolsOpenState(open)
    if (!open) {
      pdfSearchQueryRef.current = ""
      setPdfSearchQueryState("")
      setPdfSearchResults([])
      setPdfSearchLoading(false)
    }
  }, [])
  const [pdfSearchHighlight, setPdfSearchHighlight] = useState<{ path: string; query: string }>({ path: "", query: "" })
  const [expandedPdfOutlineSections, setExpandedPdfOutlineSections] = useState<Set<string>>(() => new Set())

  return {
    expandedPdfOutlineSections, pdfColorMode, pdfOcrTextVisible, pdfPageLayout, pdfSearchHighlight,
    pdfSearchQuery, pdfSearchResults, pdfSearchLoading, pdfSpreadSide, pdfTextToolsOpen, pdfThemeBrightness, pdfThemeContrast,
    pdfThemeSharpness, pdfThemeTextBrightness, pdfViewZoom, pdfViewZoomCommitTimerRef,
    pdfViewZoomRef, presentationPageLayout, setExpandedPdfOutlineSections, setPdfColorMode,
    setPdfOcrTextVisible, setPdfPageLayout, setPdfSearchHighlight, setPdfSearchQuery, setPdfSearchResults, setPdfSearchLoading,
    setPdfSpreadSide, setPdfTextToolsOpen, setPdfThemeBrightness, setPdfThemeContrast,
    setPdfThemeSharpness, setPdfThemeTextBrightness, setPdfViewZoom, setPresentationPageLayout,
  }
}
