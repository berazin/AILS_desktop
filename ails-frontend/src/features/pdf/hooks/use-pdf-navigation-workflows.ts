import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"

import { getPdfPageState, syncPdfPageState } from "../../../lib/api"
import {
  PDF_PAGE_STORAGE_KEY,
  readSavedPdfPages,
  savePdfPageForPath,
} from "../lib/pdf-page-state.ts"
import {
  pdfPageNavigationDelta,
  pdfSpreadNavigationTarget,
  type PdfPageLayout,
  type PdfSpreadSide,
} from "../../../lib/pdf-view-layout.ts"

type UsePdfNavigationWorkflowsOptions = {
  document: {
    id: string
    isPdfViewer: boolean
    pageCount: number
    pathKey: string
  } | null
  input: {
    draft: string
    setEditing: Dispatch<SetStateAction<boolean>>
  }
  navigation: {
    codingModeActive: boolean
    layout: PdfPageLayout
    spreadSide: PdfSpreadSide
  }
  pageState: {
    latestPageRef: MutableRefObject<number>
    setPages: Dispatch<SetStateAction<Record<string, number>>>
    viewerHoverRef: MutableRefObject<boolean>
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function useEventCallback<TArgs extends unknown[]>(callback: (...args: TArgs) => void) {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return useCallback((...args: TArgs) => callbackRef.current(...args), [])
}

type UsePdfPageStateSyncWorkflowOptions = {
  mdSavePath: string
  loadedForPathRef: MutableRefObject<string>
  normalizePath: (path: string) => string
  setPages: Dispatch<SetStateAction<Record<string, number>>>
}

export function usePdfPageStateSyncWorkflow({
  mdSavePath,
  loadedForPathRef,
  normalizePath,
  setPages,
}: UsePdfPageStateSyncWorkflowOptions) {
  useEffect(() => {
    const normalizedSavePath = mdSavePath.trim()
    if (!normalizedSavePath || loadedForPathRef.current === normalizedSavePath) return
    loadedForPathRef.current = normalizedSavePath
    let cancelled = false
    void getPdfPageState()
      .then((state) => {
        if (cancelled) return
        const serverPages: Record<string, number> = {}
        for (const [key, value] of Object.entries(state.pages ?? {})) {
          const page = Number(value)
          if (key && Number.isFinite(page) && page >= 1) {
            serverPages[normalizePath(key)] = Math.floor(page)
          }
        }
        const merged = { ...readSavedPdfPages(), ...serverPages }
        if (Object.keys(merged).length === 0) return
        localStorage.setItem(PDF_PAGE_STORAGE_KEY, JSON.stringify(merged))
        setPages((current) => ({ ...current, ...merged }))
        void syncPdfPageState({ pages: merged })
          .then((synced) => {
            if (cancelled) return
            const cleanedPages: Record<string, number> = {}
            for (const [key, value] of Object.entries(synced.pages ?? {})) {
              const page = Number(value)
              if (key && Number.isFinite(page) && page >= 1) {
                cleanedPages[normalizePath(key)] = Math.floor(page)
              }
            }
            localStorage.setItem(PDF_PAGE_STORAGE_KEY, JSON.stringify(cleanedPages))
            setPages((current) => {
              const next = { ...current }
              for (const key of Object.keys(merged)) {
                delete next[key]
              }
              return { ...next, ...cleanedPages }
            })
          })
          .catch((error) => {
            console.warn("[PDF page state] sync failed", error)
          })
      })
      .catch((error) => {
        console.warn("[PDF page state] load failed", error)
      })
    return () => {
      cancelled = true
    }
  }, [loadedForPathRef, mdSavePath, normalizePath, setPages])
}

export function usePdfNavigationWorkflows({
  document,
  input,
  navigation,
  pageState,
}: UsePdfNavigationWorkflowsOptions) {
  const { latestPageRef, setPages, viewerHoverRef } = pageState

  function goByDelta(delta: number) {
    if (!document?.isPdfViewer || !Number.isFinite(delta) || delta === 0) return
    const pageDelta = pdfPageNavigationDelta(
      delta,
      navigation.layout,
      navigation.codingModeActive,
      document.isPdfViewer,
    )
    const currentPage = clamp(latestPageRef.current, 1, document.pageCount)
    const nextPage = navigation.layout === "spread" && !navigation.codingModeActive
      ? pdfSpreadNavigationTarget(currentPage, document.pageCount, navigation.spreadSide, delta)
      : clamp(currentPage + pageDelta, 1, document.pageCount)
    if (nextPage === currentPage) return
    latestPageRef.current = nextPage
    startTransition(() => {
      setPages((current) => ({
        ...current,
        [document.id]: nextPage,
        ...(document.pathKey ? { [document.pathKey]: nextPage } : {}),
      }))
    })
    if (document.pathKey) savePdfPageForPath(document.pathKey, nextPage)
  }

  const goByDirection = useEventCallback((direction: -1 | 1) => {
    goByDelta(direction)
  })

  const goToPage = useEventCallback((page: number) => {
    if (!document?.isPdfViewer) return
    const nextPage = clamp(page, 1, document.pageCount)
    if (nextPage === latestPageRef.current) return
    latestPageRef.current = nextPage
    startTransition(() => {
      setPages((current) => ({
        ...current,
        [document.id]: nextPage,
        ...(document.pathKey ? { [document.pathKey]: nextPage } : {}),
      }))
    })
    if (document.pathKey) savePdfPageForPath(document.pathKey, nextPage)
  })

  function submitPage() {
    const page = parseInt(input.draft, 10)
    if (!Number.isNaN(page) && document && page >= 1 && page <= document.pageCount) {
      goToPage(page)
    }
    input.setEditing(false)
  }

  return {
    goByDelta,
    goByDirection,
    goToPage,
    onViewerMouseEnter: () => {
      viewerHoverRef.current = true
    },
    onViewerMouseLeave: () => {
      viewerHoverRef.current = false
    },
    submitPage,
  }
}
