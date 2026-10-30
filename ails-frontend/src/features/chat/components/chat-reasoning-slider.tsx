import type { CSSProperties } from "react"
import { t } from "../../../lib/i18n.ts"
import { chatReasoningLevel, CHAT_REASONING_LEVELS as LEVELS } from "../lib/chat-reasoning-levels.ts"

export function ChatReasoningSlider({ value, onChange, disabled = false, choices = LEVELS }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; choices?: readonly (readonly [string, string])[]
}) {
  const { index, label } = chatReasoningLevel(value, choices)
  return <div className="relative px-1">
    <input aria-label={t("추론 수준 조절")} aria-valuetext={label} type="range" min={0} max={Math.max(0, choices.length - 1)} step={1}
      value={index} disabled={disabled || choices.length <= 1} className="ails-chat-reasoning-slider"
      style={{ "--reasoning-fill": `${choices.length > 1 ? index / (choices.length - 1) * 100 : 0}%` } as CSSProperties}
      onChange={event => onChange(choices[Number(event.target.value)][0])} />
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between">
      {choices.map(([key], position) => <span key={key} className="h-1 w-1 rounded-full"
        style={{ background: position <= index ? "#ffffff55" : "#a1a1aa88", opacity: position === index ? 0 : 1 }} />)}
    </div>
  </div>
}
