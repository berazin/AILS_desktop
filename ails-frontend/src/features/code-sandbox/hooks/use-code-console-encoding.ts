import { useSyncExternalStore } from "react"
import { changeConsoleEncoding, readConsoleEncoding, subscribeConsoleEncoding } from "../lib/console-encoding.ts"

export function useCodeConsoleEncoding() {
  const consoleEncoding = useSyncExternalStore(subscribeConsoleEncoding, readConsoleEncoding, () => "auto" as const)
  return { consoleEncoding, changeConsoleEncoding }
}
