import { createContext } from "react"
import type { AnswerEvidence } from "./answer-evidence.ts"

export type EvidenceNavigation = {
  highlight?: { path: string; page: number; boxes: number[][]; expires: number; revision: string }
  open: (source: AnswerEvidence) => Promise<void>
  back: () => Promise<void>
  canReturn: boolean
  busy: boolean
  cancel?: () => void
  status: string
}
export const EvidenceNavigationContext = createContext<EvidenceNavigation | null>(null)
