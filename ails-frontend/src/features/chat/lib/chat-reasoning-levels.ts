import { t } from "../../../lib/i18n.ts"

export const CHAT_REASONING_LEVELS = [
  ["default", "기본"], ["none", "없음"], ["minimal", "최소"], ["low", "낮음"],
  ["medium", "보통"], ["high", "높음"], ["xhigh", "매우 높음"], ["max", "최대"],
] as const

export function chatReasoningLevel(value: string, choices: readonly (readonly [string, string])[] = CHAT_REASONING_LEVELS) {
  const index = Math.max(0, choices.findIndex(([key]) => key === value))
  return { index, label: t(choices[index]?.[1] ?? "기본") }
}
