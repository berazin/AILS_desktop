import { PERSONAL_MODE } from "../../../edition.ts"
import { LOCAL_AI_SETTINGS_ENABLED } from "../../../edition.ts"
import { Check, Search } from "lucide-react"
import { useState } from "react"
import type { ManagedChatbotCatalog } from "../../../lib/api/chatbot-catalog.ts"
import { t } from "../../../lib/i18n.ts"
import { filterChatbotModels, selectedCatalogModel, type CatalogFilters } from "../lib/chat-model-catalog.ts"

const price = (value: number | null) => value === null ? t("미확인") : `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`
const context = (value: number | null) => value === null ? t("미확인") : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : `${Math.round(value / 1024)}K`
const fieldClass = "min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--foreground)]"

export function ChatModelCatalogPanel({ catalog, selectedId, onSelect, disabled, error, loading, requireTools = false,
  otherModels = [], chatgptLoading = false, chatgptError = "", onReloadChatGPT }: {
  catalog: ManagedChatbotCatalog | null; selectedId: string; onSelect: (id: string) => void
  disabled: boolean; error: string; loading: boolean; requireTools?: boolean
  otherModels?: { id: string; name: string; available: boolean }[]
  chatgptLoading?: boolean; chatgptError?: string; onReloadChatGPT?: () => void
}) {
  const [tab, setTab] = useState<"recommended" | "value" | "all" | "chatgpt">(PERSONAL_MODE || LOCAL_AI_SETTINGS_ENABLED && selectedId.startsWith("chatgpt:") ? "chatgpt" : "recommended")
  const [filters, setFilters] = useState<CatalogFilters>({ query: "", developer: "", minContext: 0, maxCost: null,
    tools: false, vision: false, reasoning: false, experimental: false })
  const update = <K extends keyof CatalogFilters>(key: K, value: CatalogFilters[K]) => setFilters(current => ({ ...current, [key]: value }))
  const models = filterChatbotModels(catalog?.models ?? [], tab === "chatgpt" ? "all" : tab, { ...filters, tools: requireTools || filters.tools })
  const accountModels = (LOCAL_AI_SETTINGS_ENABLED ? otherModels : []).filter(model => `${model.name} ${model.id}`.toLocaleLowerCase().includes(filters.query.trim().toLocaleLowerCase()))
  const selected = catalog && selectedCatalogModel(catalog, selectedId)
  const defaultModel = catalog && selectedCatalogModel(catalog, "managed_default")
  return <div data-chat-model-catalog="true">
    <div role="tablist" aria-label={t("모델 분류")} className="mb-2 flex gap-1 rounded-xl bg-[var(--muted)] p-1">
      {([["recommended", "추천"], ["value", "가성비"], ["all", "전체"], ["chatgpt", "ChatGPT"]] as const).filter(([key]) => PERSONAL_MODE ? key === "chatgpt" : LOCAL_AI_SETTINGS_ENABLED || key !== "chatgpt").map(([key, label]) => <button key={key}
        type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
        className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${tab === key ? "bg-[var(--panel)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]"}`}>{t(label)}</button>)}
    </div>
    {tab === "chatgpt" && <div className="mb-2 px-2 text-xs text-[var(--muted-foreground)]">{t("연결한 ChatGPT 계정의 사용량을 사용합니다.")}</div>}
    <label className={`mb-2 flex items-center gap-2 ${fieldClass}`}><Search size={13} className="shrink-0" />
      <input aria-label={t("모델 검색")} placeholder={t("모델 이름 검색")} value={filters.query}
        onChange={event => { update("query", event.target.value); if (event.target.value && tab !== "chatgpt") setTab("all") }} className="min-w-0 flex-1 bg-transparent outline-none" /></label>
    {tab !== "chatgpt" && <details className="mb-2 text-xs text-[var(--muted-foreground)]"><summary className="cursor-pointer px-1 py-1">{t("필터")}</summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select aria-label={t("개발사 필터")} className={fieldClass} value={filters.developer} onChange={event => update("developer", event.target.value)}>
          <option value="">{t("모든 개발사")}</option>{[...new Set(catalog?.models.map(model => model.developer) ?? [])].sort().map(developer => <option key={developer}>{developer}</option>)}
        </select>
        <select aria-label={t("컨텍스트 필터")} className={fieldClass} value={filters.minContext} onChange={event => update("minContext", Number(event.target.value))}>
          <option value={0}>{t("모든 컨텍스트")}</option>{[16, 32, 64, 128, 256].map(size => <option key={size} value={size * 1024}>{size}K+</option>)}
        </select>
        <label className="col-span-2 flex items-center gap-2">{t("예상 요청 비용 상한 ($)")}<input aria-label={t("가격 필터")} type="number" min={0} step="0.001"
          className={`${fieldClass} flex-1`} value={filters.maxCost ?? ""} onChange={event => update("maxCost", event.target.value === "" ? null : Number(event.target.value))} /></label>
        {([["tools", "도구 호출"], ["vision", "이미지 입력"], ["reasoning", "추론 모델"]] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2">
          <input type="checkbox" checked={key === "tools" ? requireTools || filters.tools : filters[key]} disabled={key === "tools" && requireTools}
            onChange={event => update(key, event.target.checked)} />{t(label)}</label>)}
        {tab === "all" && <label className="flex items-center gap-2"><input type="checkbox" checked={filters.experimental} onChange={event => update("experimental", event.target.checked)} />{t("실험적 모델 포함")}</label>}
      </div>
    </details>}
    {tab !== "chatgpt" && catalog && !selectedId.startsWith("chatgpt:") && !selectedId.startsWith("local:") && !selected?.available && <div role="status" className="mb-2 rounded-lg bg-[var(--muted)] px-2 py-2 text-xs text-[var(--foreground)]">
      {t("선택한 모델을 사용할 수 없습니다. 아래 가격을 확인하고 대체 모델을 직접 선택해 주세요.")}
    </div>}
    {tab !== "chatgpt" && catalog?.stale && <div role="status" className="mb-2 px-1 text-xs text-[var(--muted-foreground)]">{t("목록 조회 실패 · 마지막 확인 목록을 표시합니다.")}</div>}
    <div role="listbox" aria-label={t("챗봇 모델")} className="ails-processbar-scroll max-h-[min(360px,45vh)] overflow-y-auto">
      {tab !== "chatgpt" && <><button type="button" role="option" aria-selected={selectedId === "managed_default"} disabled={disabled || !catalog || !defaultModel?.available || (requireTools && defaultModel.tools !== true)}
        onClick={() => onSelect("managed_default")} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs hover:bg-[var(--muted)] disabled:opacity-40">
        <span>{t("기본 모델")}{defaultModel ? ` · ${defaultModel.name}` : ""}</span>{selectedId === "managed_default" && <Check size={14} />}
      </button>
      {models.map(model => <button key={model.id} type="button" role="option" aria-selected={selectedId === model.id || model.aliases.includes(selectedId)}
        disabled={disabled} onClick={() => onSelect(model.id)} title={model.id}
        className="flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:outline-none disabled:opacity-40">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-[var(--foreground)]">{model.name}</span>
          <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{model.developer} · {context(model.context_length)} · {t("입력")} {price(model.input_price)} / {t("출력")} {price(model.output_price)}</span>
          <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--muted-foreground)]">
            <span>{model.tools === true ? t("도구 호출") : model.tools === false ? t("일반 대화") : t("도구 미확인")}</span>
            {model.vision === true && <span>{t("이미지 입력")}</span>}
            {(model.reasoning.values.length > 0 || model.reasoning.mandatory) && <span>{t("추론")}</span>}
            {model.evaluation?.latency_ms !== undefined && model.evaluation.latency_ms < 3000 && <span>{t("빠른 응답")}</span>}
            {tab === "value" && <span>{t("예상 요청")} {price(model.estimated_request_cost)}</span>}
            {model.experimental && <span>{t("실험적")}</span>}
            {model.evaluation?.korean === false || model.evaluation?.learning === false ? <span>{t("학습 검증 미통과")}</span>
              : model.verification_needed.length > 0 && <span>{t("검증 필요")}</span>}
          </span>
          {tab === "recommended" && <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">{model.recommendation_basis === "verified" ? t("학습 기능 검증") : t("메타데이터 기준 · 학습 품질 미검증")}</span>}
        </span>{(selectedId === model.id || model.aliases.includes(selectedId)) && <Check size={16} className="mt-1 shrink-0" />}
      </button>)}
      {!loading && !models.length && <div className="px-3 py-3 text-xs text-[var(--muted-foreground)]">{t("조건에 맞는 모델이 없습니다.")}</div>}</>}
      {(tab === "chatgpt" || tab === "all") && accountModels.length > 0 && <div className={tab === "all" ? "mt-2 border-t border-[var(--border)] pt-2" : ""}><div className="px-3 py-1 text-xs text-[var(--muted-foreground)]">{t("ChatGPT 연결")}</div>
        {accountModels.map(model => <button key={model.id} type="button" role="option" title={model.id} aria-selected={selectedId === model.id} disabled={disabled || !model.available}
          onClick={() => onSelect(model.id)} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--muted)] disabled:opacity-40">
          {model.name}{selectedId === model.id && <Check size={14} />}</button>)}
      </div>}
      {tab === "chatgpt" && !chatgptLoading && !chatgptError && !accountModels.length && <div role="status" className="px-3 py-3 text-xs text-[var(--muted-foreground)]">
        {t(otherModels.length ? "조건에 맞는 모델이 없습니다." : "연결된 ChatGPT 모델이 없습니다. 설정 → AI 설정에서 ChatGPT 연결과 구독 사용 권한을 확인해 주세요.")}
      </div>}
    </div>
    {tab !== "chatgpt" && <div className="mt-2 px-2 text-[10px] text-[var(--muted-foreground)]">{t("가격: $/100만 토큰 · 예상 요청: 입력 2,000 + 출력 1,000토큰")}</div>}
    {tab !== "chatgpt" && loading && <div role="status" className="px-2 py-2 text-xs text-[var(--muted-foreground)]">{t("모델 목록 확인 중")}</div>}
    {tab !== "chatgpt" && error && <div role="status" className="px-2 py-2 text-xs text-[var(--muted-foreground)]">{error}</div>}
    {LOCAL_AI_SETTINGS_ENABLED && (tab === "chatgpt" || tab === "all") && <>
      {chatgptLoading && <div role="status" className="px-2 py-2 text-xs text-[var(--muted-foreground)]">{t("ChatGPT 모델 목록 확인 중")}</div>}
      {chatgptError && <div role="status" className="px-2 py-2 text-xs text-[var(--muted-foreground)]">{chatgptError}</div>}
      {onReloadChatGPT && !chatgptLoading && (chatgptError || !accountModels.length) && <button type="button" disabled={disabled}
        aria-label={t("ChatGPT 모델 목록 다시 불러오기")} onClick={onReloadChatGPT}
        className="mx-2 my-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--muted)] disabled:opacity-40">{t("다시 불러오기")}</button>}
    </>}
  </div>
}
