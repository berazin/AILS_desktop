import { useRef, useState } from 'react'

// This hook owns translation state; other PDF domains interact through its returned contract.
export function usePdfTranslationState() {
  const [pdfTranslationConfirmPath, setPdfTranslationConfirmPath] = useState("")
  const [pdfTranslationProgress, setPdfTranslationProgress] = useState<{
    completed: number
    total: number
    stage: string
    label: string
  } | null>(null)
  const [pdfTranslationError, setPdfTranslationError] = useState("")
  const pdfTranslationAbortRef = useRef<AbortController | null>(null)

  return {
    pdfTranslationAbortRef, pdfTranslationConfirmPath, pdfTranslationError, pdfTranslationProgress,
    setPdfTranslationConfirmPath, setPdfTranslationError, setPdfTranslationProgress,
  }
}
