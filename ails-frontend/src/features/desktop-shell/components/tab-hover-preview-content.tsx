import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Image } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { TabHoverPreviewState } from "../lib/tab-hover-preview.ts"

type Content = Pick<TabHoverPreviewState, "id" | "title" | "image" | "aspect">
type Layer = { key: number; content: Content; entering: boolean }

export function TabHoverPreviewContent({ preview }: { preview: TabHoverPreviewState }) {
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, content: preview, entering: false }])
  const sequence = useRef(0)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const change = () => setReducedMotion(media.matches)
    change(); media.addEventListener("change", change)
    return () => media.removeEventListener("change", change)
  }, [])
  useLayoutEffect(() => {
    setLayers(previous => {
      const current = previous[previous.length - 1]
      if (reducedMotion) return [{ ...current, content: preview, entering: false }]
      if (current.content.id === preview.id) {
        if (current.content.title === preview.title && current.content.image === preview.image && current.content.aspect === preview.aspect) return previous
        return [...previous.slice(0, -1), { ...current, content: preview }]
      }
      // Retain painted layers during quick reversals, instead of snapping to
      // a fully opaque outgoing image. Bound the temporary compositor work.
      return [...previous.slice(-4), { key: ++sequence.current, content: preview, entering: true }]
    })
  }, [preview, reducedMotion])
  const settled = (key: number) => setLayers(previous => {
    const current = previous[previous.length - 1]
    return current.key === key ? [{ ...current, entering: false }] : previous
  })
  return layers.map((layer, index) => <div key={layer.key}
    className={`ails-tab-hover-preview-layer${layer.entering ? " ails-tab-hover-preview-enter" : ""}`}
    data-tab-preview-current={index === layers.length - 1 ? "true" : "false"}
    aria-hidden={index !== layers.length - 1}
    onAnimationEnd={event => { if (event.target === event.currentTarget) settled(layer.key) }}>
    <div className="ails-tab-hover-preview-image" style={{ aspectRatio: layer.content.aspect }}>
      {layer.content.image ? <img src={layer.content.image.dataUrl} alt={`${layer.content.title} ${t("화면 미리보기")}`} draggable={false} />
        : <div className="ails-tab-hover-preview-empty"><Image size={24} aria-hidden="true" /><span>{t("아직 표시한 화면이 없습니다")}</span></div>}
    </div>
    <div className="ails-tab-hover-preview-title">{layer.content.title}</div>
  </div>)
}
