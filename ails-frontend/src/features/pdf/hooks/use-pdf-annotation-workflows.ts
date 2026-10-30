import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { waitForInitialDocument } from '../../../lib/initial-document-readiness.ts'

import type { PdfAnnotationSettings } from "../components/pdf-annotation-layer.tsx"
import {
  deletePdfAnnotation,
  getPdfAnnotations,
  savePdfAnnotation,
  type PdfAnnotation,
} from "../../../lib/api"
import type { PdfController } from "./use-pdf-controller.ts"

const PDF_ANNOTATION_SETTINGS_KEY = "ails_pdf_annotation_settings_v1"

function useEventCallback<TArgs extends unknown[]>(callback: (...args: TArgs) => void) {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return useCallback((...args: TArgs) => callbackRef.current(...args), [])
}

export function usePdfAnnotationWorkflows(pdf: PdfController) {
  const {
    annotation: {
      activePdfAnnotationPathRef,
      pdfAnnotationPendingRef,
      pdfAnnotationRedo,
      pdfAnnotationsRef,
      pdfAnnotationUndo,
      setPdfAnnotationError,
      setPdfAnnotationPendingCount,
      setPdfAnnotationRedo,
      setPdfAnnotationSettings,
      setPdfAnnotations,
      setPdfAnnotationUndo,
    },
  } = pdf

  function updateSettings(patch: Partial<PdfAnnotationSettings>) {
    setPdfAnnotationSettings((current) => {
      const next = { ...current, ...patch }
      localStorage.setItem(PDF_ANNOTATION_SETTINGS_KEY, JSON.stringify(next))
      return next
    })
  }

  function persistChange(annotationId: string, annotation: PdfAnnotation | null) {
    const pdfPath = activePdfAnnotationPathRef.current
    if (!pdfPath) return
    pdfAnnotationPendingRef.current.set(annotationId, annotation)
    setPdfAnnotationPendingCount(pdfAnnotationPendingRef.current.size)
    const request = annotation
      ? savePdfAnnotation(pdfPath, annotation)
      : deletePdfAnnotation(pdfPath, annotationId)
    void request.then(() => {
      if (activePdfAnnotationPathRef.current !== pdfPath) return
      if (pdfAnnotationPendingRef.current.get(annotationId) === annotation) {
        pdfAnnotationPendingRef.current.delete(annotationId)
        setPdfAnnotationPendingCount(pdfAnnotationPendingRef.current.size)
      }
      if (pdfAnnotationPendingRef.current.size === 0) setPdfAnnotationError("")
    }).catch((error) => {
      if (activePdfAnnotationPathRef.current === pdfPath) {
        setPdfAnnotationError(error instanceof Error ? error.message : String(error))
      }
    })
  }

  function retrySaves() {
    setPdfAnnotationError("")
    for (const [annotationId, annotation] of pdfAnnotationPendingRef.current) {
      persistChange(annotationId, annotation)
    }
  }

  const applyAnnotation = useEventCallback((annotation: PdfAnnotation, recordHistory = true) => {
    if (!activePdfAnnotationPathRef.current) return
    const before = pdfAnnotationsRef.current.find((item) => item.annotation_id === annotation.annotation_id) ?? null
    const next = [
      ...pdfAnnotationsRef.current.filter((item) => item.annotation_id !== annotation.annotation_id),
      annotation,
    ]
    pdfAnnotationsRef.current = next
    setPdfAnnotations(next)
    if (recordHistory) {
      setPdfAnnotationUndo((history) => [...history.slice(-99), { before, after: annotation }])
      setPdfAnnotationRedo([])
    }
    persistChange(annotation.annotation_id, annotation)
  })

  const removeAnnotation = useEventCallback((annotationId: string, recordHistory = true) => {
    const before = pdfAnnotationsRef.current.find((item) => item.annotation_id === annotationId)
    if (!before) return
    const next = pdfAnnotationsRef.current.filter((item) => item.annotation_id !== annotationId)
    pdfAnnotationsRef.current = next
    setPdfAnnotations(next)
    if (recordHistory) {
      setPdfAnnotationUndo((history) => [...history.slice(-99), { before, after: null }])
      setPdfAnnotationRedo([])
    }
    persistChange(annotationId, null)
  })

  function undo() {
    const entry = pdfAnnotationUndo.at(-1)
    if (!entry) return
    setPdfAnnotationUndo((history) => history.slice(0, -1))
    setPdfAnnotationRedo((history) => [...history, entry])
    if (entry.before) applyAnnotation(entry.before, false)
    else if (entry.after) removeAnnotation(entry.after.annotation_id, false)
  }

  function redo() {
    const entry = pdfAnnotationRedo.at(-1)
    if (!entry) return
    setPdfAnnotationRedo((history) => history.slice(0, -1))
    setPdfAnnotationUndo((history) => [...history, entry])
    if (entry.after) applyAnnotation(entry.after, false)
    else if (entry.before) removeAnnotation(entry.before.annotation_id, false)
  }

  return {
    applyAnnotation,
    redo,
    removeAnnotation,
    retrySaves,
    undo,
    updateSettings,
  }
}

export function usePdfAnnotationDocumentWorkflow(pdf: PdfController, activePath: string) {
  const {
    annotation: {
      activePdfAnnotationPathRef,
      pdfAnnotationPendingRef,
      pdfAnnotationsRef,
      setPdfAnnotationError,
      setPdfAnnotationMode,
      setPdfAnnotationPendingCount,
      setPdfAnnotationRedo,
      setPdfAnnotations,
      setPdfAnnotationUndo,
    },
  } = pdf

  useEffect(() => {
    activePdfAnnotationPathRef.current = activePath
    pdfAnnotationsRef.current = []
    pdfAnnotationPendingRef.current.clear()
    setPdfAnnotations([])
    setPdfAnnotationPendingCount(0)
    setPdfAnnotationUndo([])
    setPdfAnnotationRedo([])
    setPdfAnnotationError("")
    setPdfAnnotationMode("default")
    if (!activePath) return undefined
    const controller = new AbortController()
    void waitForInitialDocument(controller.signal).then(() => getPdfAnnotations(activePath, controller.signal)).then((result) => {
      if (controller.signal.aborted || activePdfAnnotationPathRef.current !== activePath) return
      pdfAnnotationsRef.current = result.annotations
      setPdfAnnotations(result.annotations)
    }).catch((error) => {
      if (!controller.signal.aborted && activePdfAnnotationPathRef.current === activePath) {
        setPdfAnnotationError(error instanceof Error ? error.message : String(error))
      }
    })
    return () => controller.abort()
  }, [
    activePath,
    activePdfAnnotationPathRef,
    pdfAnnotationPendingRef,
    pdfAnnotationsRef,
    setPdfAnnotationError,
    setPdfAnnotationMode,
    setPdfAnnotationPendingCount,
    setPdfAnnotationRedo,
    setPdfAnnotations,
    setPdfAnnotationUndo,
  ])
}
