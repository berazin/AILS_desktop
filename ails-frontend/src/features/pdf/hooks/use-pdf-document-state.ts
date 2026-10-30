import { useRef, useState } from 'react'

// This hook owns document state; other PDF domains interact through its returned contract.
export function usePdfDocumentState(readSavedPages: () => Record<string, number>) {
  const [pendingPdfPasswordPath, setPendingPdfPasswordPath] = useState("")
  const [pdfPasswordDraft, setPdfPasswordDraft] = useState("")
  const [pdfPasswordError, setPdfPasswordError] = useState("")
  const [pendingLibreOfficeFilePath, setPendingLibreOfficeFilePath] = useState("")
  const [libreOfficeInstallError, setLibreOfficeInstallError] = useState("")
  const [pdfPageByDocument, setPdfPageByDocument] = useState<Record<string, number>>(readSavedPages)
  const pdfPageStateLoadedForPathRef = useRef("")
  const viewerScrollRef = useRef<HTMLElement | null>(null)
  const fullscreenViewerScrollRef = useRef<HTMLElement | null>(null)
  const lastPdfWheelApplyTimeRef = useRef(0)
  const pendingPdfWheelDeltaRef = useRef(0)
  const pendingPdfWheelTimerRef = useRef<number | null>(null)
  const pdfViewerContainerRef = useRef<HTMLDivElement | null>(null)
  const fullscreenPdfViewerContainerRef = useRef<HTMLDivElement | null>(null)
  const pdfViewerHoverRef = useRef(false)
  const latestPdfPageRef = useRef(1)
  const lastPdfAltDownAtRef = useRef(0)
  const pdfAltCheckpointRef = useRef<{ documentId: string; pathKey: string; page: number } | null>(null)
  const [pdfAltCheckpointPage, setPdfAltCheckpointPage] = useState<number | null>(null)
  const [isPortraitPdf, setIsPortraitPdf] = useState(false)
  const [pdfPortraitByPath, setPdfPortraitByPath] = useState<Record<string, boolean>>({})
  const [isEditingPage, setIsEditingPage] = useState(false)
  const [pageInputDraft, setPageInputDraft] = useState("")
  const pageInputRef = useRef<HTMLInputElement | null>(null)

  return {
    fullscreenPdfViewerContainerRef, isEditingPage, isPortraitPdf, lastPdfAltDownAtRef,
    lastPdfWheelApplyTimeRef, latestPdfPageRef, libreOfficeInstallError, pageInputDraft, pageInputRef,
    pdfAltCheckpointPage, pdfAltCheckpointRef, pdfPageByDocument,
    pdfPageStateLoadedForPathRef, pdfPasswordDraft, pdfPasswordError, pdfPortraitByPath,
    pdfViewerContainerRef, pdfViewerHoverRef, pendingLibreOfficeFilePath, pendingPdfPasswordPath,
    pendingPdfWheelDeltaRef, pendingPdfWheelTimerRef, setIsEditingPage, setIsPortraitPdf,
    setLibreOfficeInstallError, setPageInputDraft, setPdfAltCheckpointPage, setPdfPageByDocument,
    setPdfPasswordDraft, setPdfPasswordError, setPdfPortraitByPath, setPendingLibreOfficeFilePath,
    setPendingPdfPasswordPath, viewerScrollRef, fullscreenViewerScrollRef,
  }
}
