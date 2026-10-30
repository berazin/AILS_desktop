import { requestJson } from "./core.ts"

export interface MaterialSearchResult {
  path: string
  title: string
  page: number
  snippet: string
  section?: string
  score?: number
  match_source?: 'title' | 'body'
  match_text?: string
}

export interface MaterialSearchResponse {
  query: string
  mode: 'keyword' | 'semantic'
  status: 'ready' | 'partial' | 'loading' | 'unavailable'
  results: MaterialSearchResult[]
  reason?: string
  embedding_backend?: string
  degraded?: boolean
}

export interface MaterialSearchPrepareResponse {
  status: 'ready' | 'loading' | 'idle'
  backend?: string
  degraded?: boolean
}

export function searchMaterials(
  payload: { query: string; mode: 'keyword' | 'semantic'; limit?: number },
  signal?: AbortSignal,
) {
  return requestJson<MaterialSearchResponse>('/search/materials', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function prepareMaterialSearch(signal?: AbortSignal) {
  return requestJson<MaterialSearchPrepareResponse>('/search/prepare', {
    method: 'POST',
    body: JSON.stringify({}),
    signal,
  })
}
