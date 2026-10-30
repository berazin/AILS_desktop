export type AnswerEvidence = {
  id: string
  path: string
  title: string
  revision: string
  page_index: number | null
  status: string
  excerpt?: string
}

export function mergeEvidence(...groups: AnswerEvidence[][]): AnswerEvidence[] {
  const unique = new Map<string, AnswerEvidence>()
  for (const item of groups.flat()) {
    if (item && typeof item.id === "string" && typeof item.path === "string"
      && typeof item.revision === "string" && (item.page_index === null
        || (Number.isInteger(item.page_index) && item.page_index >= 0))) unique.set(item.id, item)
  }
  return [...unique.values()].slice(0, 100)
}
