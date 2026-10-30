import { getPdfOcrPage, searchPdfText } from "../../../lib/api"
import type { PdfController } from "./use-pdf-controller.ts"
import { usePdfLiveSearch } from "./use-pdf-live-search.ts"

type UsePdfSearchWorkflowsOptions = {
  pdf: PdfController
  activePath: string
  setNotice: (message: string) => void
}

export function usePdfSearchWorkflows({
  pdf,
  activePath,
  setNotice,
}: UsePdfSearchWorkflowsOptions) {
  const {
    view: {
      pdfSearchQuery,
      setExpandedPdfOutlineSections,
      setPdfSearchResults,
      setPdfSearchLoading,
    },
  } = pdf

  const handlePdfSearch = usePdfLiveSearch({ activePath, query: pdfSearchQuery, open: pdf.view.pdfTextToolsOpen,
    available: Boolean(activePath), setResults: setPdfSearchResults, setLoading: setPdfSearchLoading, setNotice })

  async function searchPdfDocument(query: string) {
    if (!activePath) return []
    const { results } = await searchPdfText(activePath, query)
    return results
  }

  async function getPdfPageText(page: number) {
    if (!activePath) return ""
    const { text } = await getPdfOcrPage(activePath, page)
    return text
  }

  function togglePdfOutlineSection(id: string) {
    setExpandedPdfOutlineSections((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return {
    getPdfPageText,
    handlePdfSearch,
    searchPdfDocument,
    togglePdfOutlineSection,
  }
}
