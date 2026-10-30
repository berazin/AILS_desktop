import { useEffect, useState } from "react"

type Sizes = { sidebar: number; console: number; review: number }
const defaults: Sizes = { sidebar: 190, console: 240, review: 300 }
const bounds = { sidebar: [140, 480], console: [150, 650], review: [150, 650] }

export function useFolderPanelSizes(id: string) {
  const [sizes, setSizes] = useState<Sizes>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`ails-folder-panels:${id}`) || "{}")
      return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key,
        Number.isFinite(saved[key]) ? Math.max(bounds[key as keyof Sizes][0], Math.min(bounds[key as keyof Sizes][1], saved[key])) : fallback])) as Sizes
    } catch { return defaults }
  })
  useEffect(() => {
    try { localStorage.setItem(`ails-folder-panels:${id}`, JSON.stringify(sizes)) } catch { /* Layout remains usable without persistence. */ }
  }, [id, sizes])
  function set(key: keyof Sizes, value: number) {
    const [min, max] = bounds[key]
    setSizes((current) => ({ ...current, [key]: Math.max(min, Math.min(max, value)) }))
  }
  return { sizes, set }
}
