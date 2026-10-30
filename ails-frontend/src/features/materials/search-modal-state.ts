// 검색 모달의 순수 로직. React/import 부수효과 없이 node 테스트에서 바로 검증한다.

export type SearchMode = "keyword" | "semantic"

export type SemanticStatus = "idle" | "preparing" | "ready" | "degraded" | "unavailable"

export interface SearchModalResult {
  path: string
  title: string
  page: number
  snippet: string
  section?: string
  score?: number
  match_source?: "title" | "body"
  match_text?: string
  mode: SearchMode
}

export interface SearchModalSections {
  keyword: SearchModalResult[]
  semantic: SearchModalResult[]
}

export const MIN_SEARCH_CHARS = 2

export function canSearch(query: string, mode: SearchMode): boolean {
  const value = query.trim()
  return value.length >= MIN_SEARCH_CHARS && (mode !== "keyword" || value.replace(/\*/g, "").trim().length > 0)
}

export const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  keyword: "키워드 검색",
  semantic: "의미 검색",
}

// 화면 표시와 키보드 선택 모두 현재 검색 모드의 결과만 사용한다.
export function orderedSections(
  mode: SearchMode,
  sections: SearchModalSections,
): Array<{ mode: SearchMode; items: SearchModalResult[] }> {
  return [{ mode, items: sections[mode] }]
}

export function flattenResults(
  mode: SearchMode,
  sections: SearchModalSections,
): SearchModalResult[] {
  return orderedSections(mode, sections).flatMap((section) =>
    section.items.map((item) => ({ ...item, mode: section.mode })),
  )
}

export function clampActiveIndex(index: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(Math.max(index, 0), total - 1)
}

export { snippetSegments, type SnippetSegment } from "../../lib/search-snippet.ts"
