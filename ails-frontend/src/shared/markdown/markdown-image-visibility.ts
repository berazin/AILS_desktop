import { createContext } from "react"

export const MarkdownImageVisibility = createContext<ReadonlySet<string>>(new Set())
