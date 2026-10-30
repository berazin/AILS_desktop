import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import { flushSync } from "react-dom"
import { createQuickChatEditContext } from "../lib/quick-chat-edit-context.ts"
import type { QuestionCompositionLayout } from "../lib/quick-chat-edit-context-types.ts"

export function useQuickChatEditContext(inputRef: RefObject<HTMLTextAreaElement | null>, options: {
  enabled: boolean; open: boolean; draft: string; change: (value: string) => void; setOpen: (open: boolean) => void; resize?: () => void
}) {
  const latest = useRef(options)
  const controller = useRef<ReturnType<typeof createQuickChatEditContext> | null>(null)
  const [composition, setComposition] = useState<QuestionCompositionLayout>(null)
  useLayoutEffect(() => { latest.current = options })
  useLayoutEffect(() => {
    controller.current = createQuickChatEditContext(() => ({ ...latest.current, input: inputRef.current,
      show: () => { if (!latest.current.open) flushSync(() => latest.current.setOpen(true)) },
      hide: () => latest.current.setOpen(false), layout: setComposition,
    }))
    return () => { controller.current?.dispose(); controller.current = null }
  }, [inputRef])
  useLayoutEffect(() => { controller.current?.refresh() })
  return { composition, close: () => controller.current?.close() }
}
