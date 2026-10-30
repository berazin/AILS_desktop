export function safeWebSource(value: string): boolean {
  try {
    if (/[\s\\]/.test(value) || value.length > 2048) return false
    const url = new URL(value)
    const octets = url.hostname.split(".").map(Number)
    if (octets.length === 4 && octets.every(Number.isFinite)) {
      const [a, b] = octets
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return false
    }
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      && url.hostname.includes(".") && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname)
      && !/\.(local|localhost|internal)$/.test(url.hostname)
  } catch { return false }
}
