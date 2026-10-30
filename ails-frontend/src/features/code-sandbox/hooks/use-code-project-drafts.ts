import { IDE_ENABLED } from "../../../edition.ts"
import { useCallback, useLayoutEffect, useRef } from "react"

import type { SandboxFile } from "../lib/code-sandbox-support.ts"

function writeProjectDrafts(draftsKey: string, nextFiles: SandboxFile[]) {
  if (!IDE_ENABLED) return
  try {
    const drafts: Record<string, string> = {}
    let hasDrafts = false
    for (const file of nextFiles) {
      if (file.code !== file.savedCode) {
        drafts[file.name] = file.code
        hasDrafts = true
      }
    }
    if (hasDrafts) {
      localStorage.setItem(draftsKey, JSON.stringify(drafts))
    } else {
      localStorage.removeItem(draftsKey)
    }
  } catch (error) {
    console.warn("Failed to persist project drafts", error)
  }
}

export function useCodeProjectDrafts(baseDir: string, projectName: string) {
  const draftPersistTimerRef = useRef<number | null>(null)
  const pendingDraftWriteRef = useRef<{ key: string; files: SandboxFile[] } | null>(null)

  const flushPendingProjectDrafts = useCallback(() => {
    if (draftPersistTimerRef.current !== null) {
      window.clearTimeout(draftPersistTimerRef.current)
      draftPersistTimerRef.current = null
    }
    const pending = pendingDraftWriteRef.current
    pendingDraftWriteRef.current = null
    if (pending) writeProjectDrafts(pending.key, pending.files)
  }, [])

  const persistProjectDrafts = useCallback((nextFiles: SandboxFile[]) => {
    const key = `ails_draft_${baseDir}_${projectName.trim()}`
    if (pendingDraftWriteRef.current && pendingDraftWriteRef.current.key !== key) {
      flushPendingProjectDrafts()
    }
    pendingDraftWriteRef.current = {
      key,
      files: nextFiles,
    }
    if (draftPersistTimerRef.current !== null) {
      window.clearTimeout(draftPersistTimerRef.current)
    }
    draftPersistTimerRef.current = window.setTimeout(flushPendingProjectDrafts, 350)
  }, [baseDir, flushPendingProjectDrafts, projectName])

  useLayoutEffect(() => () => flushPendingProjectDrafts(), [baseDir, projectName, flushPendingProjectDrafts])

  return { flushPendingProjectDrafts, persistProjectDrafts }
}
