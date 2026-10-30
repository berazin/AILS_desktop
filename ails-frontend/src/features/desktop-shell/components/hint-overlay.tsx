import type { HintModeController } from "../hooks/use-hint-mode.ts"

type HintOverlayProps = {
  hintMode: HintModeController
}

export function HintOverlay({ hintMode: { active, hints, input } }: HintOverlayProps) {
  if (!active) return null

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, pointerEvents: "none" }}>
      {hints.map((hint) => {
        const isCandidate = hint.keySequence.startsWith(input)
        if (!isCandidate) return null

        const typedPart = hint.keySequence.slice(0, input.length)
        const remainingPart = hint.keySequence.slice(input.length)

        return (
          <span
            key={hint.id}
            className="ails-hint-badge"
            style={{
              position: "absolute",
              top: hint.rect.top,
              left: hint.rect.left,
            }}
          >
            {typedPart && <span style={{ opacity: 0.35 }}>{typedPart.toUpperCase()}</span>}
            <span style={{ color: "#000000", fontWeight: 800 }}>{remainingPart.toUpperCase()}</span>
          </span>
        )
      })}
    </div>
  )
}
