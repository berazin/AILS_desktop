const safeProtocols = new Set(["http:", "https:", "mailto:", "tel:"])

export function markdownUrlTransform(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""

  if (/^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);/i.test(trimmed)) {
    return trimmed
  }

  if (/^(?:[./#?]|[A-Za-z]:[\\/])/.test(trimmed)) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    return safeProtocols.has(url.protocol) ? trimmed : ""
  } catch {
    return ""
  }
}
