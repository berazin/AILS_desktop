export type TextSearchOptions = { wholeWord: boolean; regex: boolean }
export type TextSearchMatch = { start: number; end: number }

export function textSearchPattern(query: string, options: TextSearchOptions): { pattern: RegExp | null; error: string } {
  if (!query.trim()) return { pattern: null, error: "" }
  try {
    return { pattern: new RegExp(options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), error: "" }
  } catch {
    return { pattern: null, error: "정규식이 올바르지 않습니다." }
  }
}

export function textSearchMatches(text: string, pattern: RegExp | null, wholeWord: boolean): TextSearchMatch[] {
  if (!pattern) return []
  const matches: TextSearchMatch[] = []
  for (const match of text.matchAll(pattern)) {
    if (!match[0].length) continue
    const start = match.index, end = start + match[0].length
    // JavaScript's ASCII-only \b misses Korean and other Unicode word boundaries.
    if (wholeWord && (/[\p{L}\p{M}\p{N}\p{Pc}]$/u.test(text.slice(Math.max(0, start - 2), start))
      || /^[\p{L}\p{M}\p{N}\p{Pc}]/u.test(text.slice(end, end + 2)))) continue
    matches.push({ start, end })
  }
  return matches
}
