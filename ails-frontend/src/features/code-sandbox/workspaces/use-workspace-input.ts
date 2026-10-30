import { useEffect, useRef, useState } from "react"
import type { TextInputRequest } from "../../../shared/ui/text-input-dialog.tsx"

type InputOptions = Omit<TextInputRequest, "resolve">
export type WorkspaceInput = TextInputRequest

export function useWorkspaceInput() {
  const [input, setInput] = useState<WorkspaceInput | null>(null)
  const pending = useRef<((value: string | null) => void) | null>(null)
  useEffect(() => () => { pending.current?.(null) }, [])

  function request(options: InputOptions) {
    return new Promise<string | null>((resolve) => {
      pending.current?.(null)
      pending.current = resolve
      setInput({ ...options, resolve: (value) => {
        pending.current = null
        setInput(null)
        resolve(value)
      } })
    })
  }
  return { input, request }
}
