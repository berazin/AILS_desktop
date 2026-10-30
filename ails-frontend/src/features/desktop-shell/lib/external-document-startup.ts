import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { waitForInitialDocument } from "../../../lib/initial-document-readiness.ts"

// Shared across StrictMode effect replays. The OS-selected document gets the
// first backend reads; restoring old tabs must not steal its selection.
let initialPending: boolean | undefined
let finish: (() => void) | undefined
let completed = false
const opened = new Promise<void>(resolve => { finish = resolve })

export function hasInitialExternalDocument() {
  return initialPending ??= getAppDesktopApi()?.has_initial_documents?.() === true
}

export function waitForInitialExternalDocumentRequest() {
  if (!hasInitialExternalDocument()) return Promise.resolve()
  return completed ? Promise.resolve() : opened
}

export function waitForInitialExternalDocument() {
  if (!hasInitialExternalDocument()) return Promise.resolve()
  return waitForInitialExternalDocumentRequest().then(() => waitForInitialDocument())
}

export function finishInitialExternalDocument() {
  completed = true
  finish?.()
}
