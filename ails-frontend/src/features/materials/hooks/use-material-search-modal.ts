import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  prepareMaterialSearch,
  searchMaterials,
} from "../../../lib/api/material-search.ts"
import {
  canSearch,
  clampActiveIndex,
  flattenResults,
  type SearchMode,
  type SearchModalResult,
  type SemanticStatus,
} from "../search-modal-state.ts"

const KEYWORD_DEBOUNCE_MS = 120
const SEMANTIC_DEBOUNCE_MS = 350
const SEMANTIC_PREPARE_POLL_MS = 800
// 첫 모델 로드가 느린 환경을 고려한 준비 예산. 90회 × 0.8초 ≈ 72초.
const SEMANTIC_PREPARE_MAX_TRIES = 90
const KEYWORD_RESULT_LIMIT = 30
const SEMANTIC_RESULT_LIMIT = 20

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

export type OpenMaterialSearchResult = (result: SearchModalResult, context: { query: string }) => void

type UseMaterialSearchModalOptions = {
  onOpenResult: OpenMaterialSearchResult
  inlineEnabled?: boolean
  cacheResults?: boolean
}

export function useMaterialSearchModal({ onOpenResult, inlineEnabled = true, cacheResults = false }: UseMaterialSearchModalOptions) {
  const [open, setOpen] = useState(false)
  const [presentation, setPresentation] = useState<"modal" | "inline">("modal")
  const [query, setQueryState] = useState("")
  const [mode, setMode] = useState<SearchMode>("keyword")
  const [keywordResults, setKeywordResults] = useState<SearchModalResult[]>([])
  const [keywordNotice, setKeywordNotice] = useState("")
  const [semanticResults, setSemanticResults] = useState<SearchModalResult[]>([])
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus>("idle")
  const [semanticNotice, setSemanticNotice] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchNotice, setSearchNotice] = useState("")
  const isOpen = open && (presentation !== "inline" || inlineEnabled)

  const onOpenResultRef = useRef(onOpenResult)
  useEffect(() => {
    onOpenResultRef.current = onOpenResult
  })
  const searchGenerationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const completedSearchRef = useRef<string | null>(null)

  const sections = useMemo(() => ({ keyword: keywordResults, semantic: semanticResults }), [keywordResults, semanticResults])
  const flattened = useMemo(() => flattenResults(mode, sections), [mode, sections])
  const safeActiveIndex = clampActiveIndex(activeIndex, flattened.length)
  const stateRef = useRef({ flattened, activeIndex: safeActiveIndex, query })
  useEffect(() => {
    stateRef.current = { flattened, activeIndex: safeActiveIndex, query }
  })

  const abortInFlight = useCallback(() => {
    searchGenerationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    abortInFlight()
    setSearching(false)
    setSemanticStatus((current) => (current === "preparing" ? "idle" : current))
  }, [abortInFlight])

  const openModal = useCallback((target: "modal" | "inline" = "modal") => {
    setPresentation(target)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (presentation === "inline" && !inlineEnabled) close()
  }, [close, inlineEnabled, presentation])

  const toggle = useCallback(() => {
    if (isOpen) close()
    else openModal()
  }, [close, isOpen, openModal])

  const setQuery = useCallback((value: string) => {
    completedSearchRef.current = null
    abortInFlight()
    setKeywordResults([])
    setKeywordNotice("")
    setSemanticResults([])
    setSearchNotice("")
    setQueryState(value)
    setActiveIndex(0)
  }, [abortInFlight])

  const toggleMode = useCallback(() => {
    completedSearchRef.current = null
    abortInFlight()
    setKeywordResults([])
    setKeywordNotice("")
    setSemanticResults([])
    setSearchNotice("")
    setMode((current) => (current === "keyword" ? "semantic" : "keyword"))
    setActiveIndex(0)
  }, [abortInFlight])

  const moveActive = useCallback((delta: number) => {
    setActiveIndex((current) => clampActiveIndex(current + delta, stateRef.current.flattened.length))
  }, [])

  const setActiveIndexTo = useCallback((index: number) => {
    setActiveIndex(clampActiveIndex(index, stateRef.current.flattened.length))
  }, [])

  const openResult = useCallback((result: SearchModalResult) => {
    onOpenResultRef.current(result, { query: result.mode === "keyword"
      ? (result.match_text ?? stateRef.current.query) : stateRef.current.query })
    close()
  }, [close])

  const openActive = useCallback(() => {
    const item = stateRef.current.flattened[stateRef.current.activeIndex]
    if (item) openResult(item)
  }, [openResult])

  const runKeywordSearch = useCallback(async (value: string, generation: number, signal: AbortSignal) => {
    if (generation !== searchGenerationRef.current) return
    try {
      const response = await searchMaterials({ query: value, mode: "keyword", limit: KEYWORD_RESULT_LIMIT }, signal)
      if (generation !== searchGenerationRef.current) return
      setKeywordResults(response.results.map((item) => ({ ...item, mode: "keyword" as const })))
      setKeywordNotice(response.reason || "")
    } catch (error) {
      if (!isAbortError(error)) {
        if (generation === searchGenerationRef.current) {
          setKeywordResults([])
          setSearchNotice(error instanceof Error ? error.message : String(error))
        }
      }
    }
  }, [])

  const runSemanticSearch = useCallback(async (value: string, generation: number, signal: AbortSignal) => {
    setSemanticNotice("")
    // 인코더 준비와 검색을 한 예산 안에서 반복한다. 검색 응답이 loading이어도
    // 그 자리에서 끝내지 않고 준비 완료 후 같은 검색어로 자동 재검색한다.
    for (let attempt = 0; attempt < SEMANTIC_PREPARE_MAX_TRIES; attempt += 1) {
      if (generation !== searchGenerationRef.current) return
      let response
      try {
        const prepare = await prepareMaterialSearch(signal)
        if (generation !== searchGenerationRef.current) return
        if (prepare.status === "loading") {
          setSemanticStatus("preparing")
          await delay(SEMANTIC_PREPARE_POLL_MS)
          continue
        }
        response = await searchMaterials({ query: value, mode: "semantic", limit: SEMANTIC_RESULT_LIMIT }, signal)
      } catch (error) {
        if (!isAbortError(error) && generation === searchGenerationRef.current) {
          setSemanticStatus("unavailable")
          setSemanticNotice(error instanceof Error ? error.message : String(error))
        }
        return
      }
      if (generation !== searchGenerationRef.current) return
      if (response.status === "loading") {
        setSemanticStatus("preparing")
        await delay(SEMANTIC_PREPARE_POLL_MS)
        continue
      }
      if (response.status === "unavailable") {
        setSemanticStatus("unavailable")
        setSemanticNotice(response.reason || "의미 검색을 사용할 수 없습니다.")
        setSemanticResults([])
        return
      }
      setSemanticResults(response.results.map((item) => ({ ...item, mode: "semantic" as const })))
      setSemanticStatus(response.degraded ? "degraded" : "ready")
      return
    }
    if (generation === searchGenerationRef.current) {
      setSemanticStatus("unavailable")
      setSemanticNotice("의미 검색 준비가 늦어지고 있습니다. 검색어를 다시 입력하면 재시도합니다.")
    }
  }, [])

  useEffect(() => {
    abortInFlight()
    if (!isOpen) return undefined
    const value = query.trim()
    const cacheKey = `${mode}:${value}`
    if (cacheResults && completedSearchRef.current === cacheKey) return undefined
    setKeywordResults([])
    setSemanticResults([])
    setSemanticNotice("")
    setSearchNotice("")
    setKeywordNotice("")
    if (!canSearch(value, mode)) {
      setSemanticStatus("idle")
      setSearching(false)
      return undefined
    }
    setSemanticStatus(mode === "semantic" ? "preparing" : "idle")
    setSearching(true)
    const generation = searchGenerationRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const timer = window.setTimeout(() => {
      const request = mode === "keyword"
        ? runKeywordSearch(value, generation, controller.signal)
        : runSemanticSearch(value, generation, controller.signal)
      void request.finally(() => {
        if (generation === searchGenerationRef.current) {
          completedSearchRef.current = cacheKey
          setSearching(false)
        }
      })
    }, mode === "keyword" ? KEYWORD_DEBOUNCE_MS : SEMANTIC_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      abortInFlight()
    }
  }, [isOpen, query, mode, cacheResults, abortInFlight, runKeywordSearch, runSemanticSearch])

  // 전역 단축키 훅(capture 단계)에서 모달 키를 포워딩받아 처리한다. 처리한 키만 true.
  const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (event.isComposing || event.keyCode === 229) return false
    switch (event.key) {
      case "Escape":
        event.preventDefault()
        event.stopPropagation()
        close()
        return true
      case "Tab":
        event.preventDefault()
        event.stopPropagation()
        toggleMode()
        return true
      case "ArrowDown":
        event.preventDefault()
        event.stopPropagation()
        moveActive(1)
        return true
      case "ArrowUp":
        event.preventDefault()
        event.stopPropagation()
        moveActive(-1)
        return true
      case "Enter":
        event.preventDefault()
        event.stopPropagation()
        openActive()
        return true
      default:
        return false
    }
  }, [close, moveActive, openActive, toggleMode])

  return useMemo(() => ({
    isOpen,
    presentation,
    open: openModal,
    query,
    mode,
    keywordResults,
    keywordNotice,
    semanticResults,
    semanticStatus,
    semanticNotice,
    searching,
    searchNotice,
    activeIndex: safeActiveIndex,
    flattened,
    setQuery,
    setActiveIndexTo,
    toggleMode,
    handleKeyDown,
    openResult,
    close,
    toggle,
  }), [isOpen, presentation, openModal, query, mode, keywordResults, keywordNotice, semanticResults, semanticStatus,
    semanticNotice, searching, searchNotice, safeActiveIndex, flattened, setQuery, setActiveIndexTo,
    toggleMode, handleKeyDown, openResult, close, toggle])
}

export type MaterialSearchModalController = ReturnType<typeof useMaterialSearchModal>
