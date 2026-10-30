import { useRef, useState } from "react"

import { t } from "../../../lib/i18n.ts"

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  const name = typeof error === "object" && error
    ? String((error as { name?: unknown }).name ?? "")
    : ""
  return name === "AbortError"
}

export function useInteractionRunner({ setNotice }: { setNotice: (notice: string) => void }) {
  const [busyActions, setBusyActions] = useState<Record<string, string>>({})
  const [generationNotices, setGenerationNotices] = useState<string[]>([])
  const owners = useRef(new Map<string, symbol>())

  async function runInteraction(
    key: string,
    label: string,
    action: () => Promise<string | void>,
    onError?: (error: unknown) => void,
    options?: { replace?: boolean },
  ) {
    if (owners.current.has(key) && !options?.replace) {
      setNotice(t("{p0} 처리 중입니다.", { p0: label }))
      return
    }
    const owner = Symbol(key)
    owners.current.set(key, owner)

    const failureNoticeKeys = [
      "url-submit",
      "youtube-submit",
      "eclass-submit",
      "lms-scan-submit",
      "audio-submit",
      "markdown-import",
      "organize-reports",
      "latex-postprocess",
      "retry-all",
    ]
    const shouldShowFailureNotice = failureNoticeKeys.includes(key)
      || (key.startsWith("retry-") && !key.startsWith("retry-delete-"))

    setBusyActions((current) => ({ ...current, [key]: label }))
    setNotice(t("{p0} 중...", { p0: label }))
    try {
      const message = await action()
      if (owners.current.get(key) === owner) setNotice(message ?? t("{p0} 완료", { p0: label }))
    } catch (error) {
      if (owners.current.get(key) !== owner) return
      if (isAbortError(error)) return
      onError?.(error)
      const errorMessage = t("{p0} 실패: {p1}", { p0: label, p1: getErrorMessage(error) })
      if (shouldShowFailureNotice) {
        setGenerationNotices((current) => [errorMessage, ...current].slice(0, 10))
      } else {
        setNotice(errorMessage)
      }
    } finally {
      if (owners.current.get(key) === owner) {
        owners.current.delete(key)
        setBusyActions((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    }
  }

  return {
    busyActions,
    generationNotices,
    isBusy: (key: string) => Boolean(busyActions[key]),
    runInteraction,
    setGenerationNotices,
  }
}

export type InteractionRunner = ReturnType<typeof useInteractionRunner>
