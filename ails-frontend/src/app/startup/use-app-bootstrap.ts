import { useEffect, useRef, useState } from "react"
import { PreparationQueue } from "./preparation-queue.ts"
import { getAppDesktopApi } from "../../lib/desktop-api.ts"
import { waitForInitialDocument } from "../../lib/initial-document-readiness.ts"

import {
  getEdition,
  getOptions,
  type AILSOptions,
} from "../../lib/api"
import {
  AILS_EDITION,
  EDITION_FEATURES,
  EDITION_MANIFEST_SHA256,
} from "../../edition.ts"

type UseAppBootstrapParams = {
  loadModelOptions: () => Promise<unknown>
  refreshApp: () => void | Promise<unknown>
  refreshMaterials: () => void | Promise<unknown>
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isBenignCancellation(reason: unknown) {
  const name = typeof reason === "object" && reason ? String((reason as { name?: unknown }).name ?? "") : ""
  const message = reason instanceof Error ? reason.message : String(reason ?? "")
  const text = `${name} ${message}`.toLowerCase()
  return name === "AbortError" || text.includes("aborterror") || text.includes("canceled") || text.includes("cancelled")
}

export function useAppBootstrap({
  loadModelOptions,
  refreshApp,
  refreshMaterials,
}: UseAppBootstrapParams) {
  const [options, setOptions] = useState<AILSOptions | null>(null)
  const [editionIntegrityError, setEditionIntegrityError] = useState("")
  const initialActionsRef = useRef({ loadModelOptions, refreshApp, refreshMaterials })

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("[Runtime Error]", event.message, event.error)
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isBenignCancellation(event.reason)) {
        event.preventDefault()
        return
      }
      console.error("[Promise Rejection]", event.reason)
      event.preventDefault()
    }
    window.addEventListener("error", handleError)
    window.addEventListener("unhandledrejection", handleRejection)
    return () => {
      window.removeEventListener("error", handleError)
      window.removeEventListener("unhandledrejection", handleRejection)
    }
  }, [])

  useEffect(() => {
    const { loadModelOptions, refreshApp, refreshMaterials } = initialActionsRef.current
    let cancelled = false
    const openingExternalDocument = getAppDesktopApi()?.has_initial_documents?.() === true
    const preparation = new PreparationQueue((name, error) => console.warn(`[AILS preparation: ${name}]`, error))
    // External file reads take priority over workspace-wide scans. The same
    // preparation queue starts them automatically after the first paint.
    if (openingExternalDocument) {
      preparation.add("initial document", signal => waitForInitialDocument(signal))
      preparation.add("workspace status", () => refreshApp())
      preparation.add("material catalog", () => refreshMaterials())
    }
    // StrictMode replays mount effects. Start once after that replay.
    queueMicrotask(() => {
      if (cancelled || openingExternalDocument) return
      void refreshApp()
      void refreshMaterials()
    })
    preparation.add("options", async signal => {
      const value = await getOptions()
      if (!signal.aborted) setOptions(value)
    })
    preparation.add("model metadata", () => loadModelOptions())
    // Prepare frequently used screens without starting a model or a paid task.
    preparation.add("home dashboard", () => import("../../features/desktop-shell/components/learning-dashboard-surface-runtime.tsx"))
    preparation.add("chat screen", () => import("../../features/chat/components/chat-workspace-view-runtime.tsx"))
    preparation.add("material search", () => import("../../features/materials/components/material-search-modal-runtime.tsx"))
    let timer: number | undefined
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => { void preparation.start() }, 1000)
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      preparation.cancel()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getEdition()
      .then((backendEdition) => {
        if (cancelled) return
        const expectedFeatures = JSON.stringify(Object.entries(EDITION_FEATURES).sort(([a], [b]) => a.localeCompare(b)))
        const actualFeatures = JSON.stringify(Object.entries(backendEdition.features).sort(([a], [b]) => a.localeCompare(b)))
        if (
          backendEdition.id !== AILS_EDITION
          || backendEdition.manifest_sha256 !== EDITION_MANIFEST_SHA256
          || actualFeatures !== expectedFeatures
        ) {
          setEditionIntegrityError(
            `Edition integrity check failed (frontend=${AILS_EDITION}, backend=${backendEdition.id}). Reinstall the matching package.`,
          )
        }
      })
      .catch((error) => {
        if (!cancelled) setEditionIntegrityError(`Edition integrity check failed: ${getErrorMessage(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { editionIntegrityError, options }
}
