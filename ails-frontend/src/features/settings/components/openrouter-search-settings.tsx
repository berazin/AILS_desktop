import type { AILSConfig, ModelSelectionPreviewResponse } from "../../../lib/api"
import { useEffect, useState } from "react"
import { getManagedChatbotCatalog, type ManagedChatbotCatalog } from "../../../lib/api/chatbot-catalog.ts"
import { SETTINGS_SELECT_CLASS, SettingsCard, SettingsRow, SettingsSwitch } from "./settings-layout.tsx"

export function OpenRouterSearchSettings({ config, preview, onChange }: {
  config: AILSConfig
  preview: ModelSelectionPreviewResponse | null
  onChange: (value: { enabled: boolean; engine: string }) => void
}) {
  const value = config.openrouter_web_search ?? { enabled: false, engine: "exa" }
  const [catalog, setCatalog] = useState<ManagedChatbotCatalog | null>(null)
  useEffect(() => {
    let alive = true
    void getManagedChatbotCatalog().then(result => { if (alive) setCatalog(result) }).catch(() => { if (alive) setCatalog(null) })
    return () => { alive = false }
  }, [])
  const routes = Object.values(preview?.workflows ?? {})
  const localOnly = routes.length > 0 && routes.every(route => route.mode === "local")
  const supported = routes.filter(route => route.mode === "managed" && catalog?.platform === "openrouter"
    && catalog.models.some(model => (model.id === route.model_id || model.aliases.includes(route.model_id ?? "")) && model.tools === true
      && !model.id.startsWith("perplexity/") && !/:online$|search-preview|search-api/.test(model.id)))
  const unavailable = supported.length === 0
  const engines = ["exa", "firecrawl", "parallel", "perplexity", "auto", "native"]
  return <SettingsCard title="OpenRouter 웹 검색" description="새 직접 호출 AI 작업에 적용합니다. 진행 중 작업은 시작 당시 설정을 사용하므로 중단하려면 해당 작업을 취소하세요. ON은 검색 허용이며 모델이 검색 여부를 결정합니다. 로컬 모델에는 적용되지 않습니다.">
    <SettingsRow label={`웹 검색 ${value.enabled ? "ON" : "OFF"}`}
      description={localOnly ? "현재 모든 단계가 로컬 모델입니다. OpenRouter 검색은 지원하지 않습니다. 저장한 검색 설정은 유지됩니다." : "검색 질의가 외부 검색 공급자로 전송될 수 있습니다. 기본값은 OFF입니다."}
      control={<SettingsSwitch ariaLabel="OpenRouter 웹 검색" checked={value.enabled} disabled={unavailable && !value.enabled}
        onCheckedChange={enabled => onChange({ ...value, enabled })} />} />
    <SettingsRow label="웹 검색 방식" description="Auto는 공급자/워크스페이스 정책에 따라 Native 또는 유료 외부 엔진을 자동 선택합니다. 고정 엔진은 실패 시 다른 엔진으로 재시도하지 않습니다."
      control={<select aria-label="웹 검색 방식" className={SETTINGS_SELECT_CLASS} value={value.engine}
        disabled={unavailable} onChange={event => onChange({ ...value, engine: event.target.value })}>
        {!engines.includes(value.engine) && <option value={value.engine} disabled>지원하지 않는 저장된 방식</option>}
        {engines.map(engine => <option key={engine} value={engine} disabled={engine === "native" || (engine === "firecrawl" && config.chatbot_zdr_enabled === true)}>
          {engine === "native" ? "Native — 유료 대체 차단을 보장할 수 없어 미지원" : engine === "firecrawl" && config.chatbot_zdr_enabled === true ? "Firecrawl — ZDR에서 미지원" : engine === "auto" ? "Auto — 유료 엔진 자동 선택 허용" : engine}
        </option>)}
      </select>} />
    <p className="px-5 py-2 text-xs text-[var(--muted-foreground)]">Native는 공식 계약상 미지원 모델에서 유료 Exa로 대체될 수 있어 개별 선택을 비활성화했습니다. Auto에서는 이 자동 선택을 허용합니다. Native 검색의 실행 여부는 모델이 결정하며 ON만으로 실제 검색을 보장하지 않습니다.</p>
    <p role="status" className="px-5 text-xs text-[var(--muted-foreground)]">{unavailable
      ? "선택한 단계에서 OpenRouter 도구 지원을 확인하지 못했습니다. 로컬·ChatGPT·검색 내장 모델은 미지원이며 목록 확인 실패 시 검색을 새로 켤 수 없습니다."
      : `도구 지원 확인: ${[...new Set(supported.map(route => route.model_id))].join(", ")}. 다른 모델의 단계는 요청 전에 지원 여부를 검사하며 지원 불가 시 검색을 끄도록 안내합니다.`}</p>
    <p className="px-5 py-3 text-xs text-[var(--muted-foreground)]">
      별도 검색 개인키는 사용하지 않습니다. 검색 비용과 검색 결과 처리 토큰 비용이 추가될 수 있습니다. 기존 계정 예산 한도를 그대로 적용합니다.
      도구 지원 모델만 사용하며, 계정·워크스페이스 정책으로 거부되면 오류를 안내합니다. 현재 연결은 글로벌 OpenRouter이며 EU 검색은 미지원, US는 Exa만 지원합니다.
      Firecrawl은 계정/가드레일 ZDR에서도 거부됩니다. 검색 횟수 제한은 Native 공급자마다 다를 수 있습니다.
      {" "}<a href="https://openrouter.ai/docs/guides/features/server-tools/web-search#pricing" target="_blank" rel="noopener noreferrer" className="underline">공식 지원 조건·현재 요금</a>
    </p>
  </SettingsCard>
}
