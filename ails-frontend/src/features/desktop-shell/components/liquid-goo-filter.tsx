import type { RefObject } from "react"
import { GOO_RIM_THRESHOLDS, gooThreshold } from "../vendor/liquid-taffy/core.ts"

export function LiquidGooFilter({ id, blurRef, rimRef, innerRef, color, borderless = false }: {
  id: string
  blurRef: RefObject<SVGFEGaussianBlurElement | null>
  rimRef: RefObject<SVGFEColorMatrixElement | null>
  innerRef: RefObject<SVGFEColorMatrixElement | null>
  color: string
  borderless?: boolean
}) {
  const [outer, inside] = GOO_RIM_THRESHOLDS[5]
  return <filter id={id} x="-30%" y="-100%" width="160%" height="300%" colorInterpolationFilters="sRGB">
    <feGaussianBlur ref={blurRef} in="SourceGraphic" stdDeviation={5} result="blurred" />
    <feColorMatrix ref={rimRef} in="blurred" values={gooThreshold(outer)} result="outer" />
    {borderless ? <>
      <feFlood floodColor={color} result="surface-color" />
      <feComposite in="surface-color" in2="outer" operator="in" />
    </> : <>
      <feColorMatrix ref={innerRef} in="blurred" values={gooThreshold(inside)} result="inner" />
      <feComposite in="outer" in2="inner" operator="out" result="rim" />
      <feFlood floodColor={color} result="rim-color" />
      <feComposite in="rim-color" in2="rim" operator="in" result="border" />
      <feMerge><feMergeNode in="inner" /><feMergeNode in="border" /></feMerge>
    </>}
  </filter>
}
