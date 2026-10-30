import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { useEffect, useId, useState } from "react"
import type { AILSConfig, ModelOptionsPayload } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { useChatComposerModels } from "../hooks/use-chat-composer-models.ts"
import { useChatComposerPopover } from "../hooks/use-chat-composer-popover.ts"
import { chatReasoningLevel } from "../lib/chat-reasoning-levels.ts"
import { ChatReasoningSlider } from "./chat-reasoning-slider.tsx"
import { modelReasoningChoices } from "../lib/chat-model-catalog.ts"
import { ChatModelCatalogPanel } from "./chat-model-catalog-panel.tsx"
import "./chat-composer-controls.css"
import "../../../shared/ui/processbar-scroll.css"

export function ChatComposerControls({ config, options, reasoning, onReasoningChange, onModelChange, busy = false, savingModel = false, reasoningDisabled = false, requireTools = false, modelFirst = false, active = true }: {
  config: AILSConfig; options: ModelOptionsPayload | null; reasoning: string; onReasoningChange: (value: string) => void
  onModelChange: (id: string) => Promise<void>; busy?: boolean; savingModel?: boolean; reasoningDisabled?: boolean; requireTools?: boolean; modelFirst?: boolean; active?: boolean
}) {
  const [view, setView] = useState<"reasoning" | "models">(modelFirst ? "models" : "reasoning")
  const { root, trigger, open, present, close, toggle, onKeyDown, onBlur } = useChatComposerPopover(view), id = useId()
  const catalog = useChatComposerModels(config, options, open && view === "models", active)
  const choices = catalog.managedId !== null ? modelReasoningChoices(catalog.selectedManagedModel) : undefined
  const { label } = chatReasoningLevel(reasoning, choices)
  useEffect(() => {
    if (catalog.managedId !== null && catalog.managedCatalog && choices && !choices.some(([key]) => key === reasoning)) onReasoningChange("default")
  }, [catalog.managedId, catalog.managedCatalog, choices, reasoning, onReasoningChange])
  useEffect(() => {
    if (!open || view !== "models" || catalog.loading) return
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement
      if (!root.current?.contains(active) || (active instanceof HTMLInputElement && active.value)) return
      root.current.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not(:disabled)')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, view, catalog.loading, catalog.chatgptLoading, catalog.selectedId, root])
  return <div className="flex min-w-0 items-center gap-1" data-ails-chat-composer-controls="true">
    <div ref={root} className="relative min-w-0" onBlur={onBlur} onKeyDown={event => {
      onKeyDown(event)
      if (!open || view !== "models") return
      if ((event.target as HTMLElement).closest("input, select, textarea")) return
      if (event.key === "ArrowLeft") { event.preventDefault(); setView("reasoning"); return }
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const choices = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])
      if (!choices.length) return
      const current = choices.indexOf(event.target as HTMLButtonElement)
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
        : current < 0 ? event.key === "ArrowDown" ? 0 : choices.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length
      choices[next]?.focus({ preventScroll: true })
    }}>
      <button ref={trigger} type="button" aria-label={t(modelFirst ? "에이전트 AI 선택" : "추론 수준 선택")} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
        data-ails-chatbot-agent-model-picker={modelFirst ? "true" : undefined}
        title={catalog.selectedName} disabled={busy || savingModel} onClick={() => { if (!open) setView(modelFirst ? "models" : "reasoning"); toggle() }}
        className={`flex max-w-[min(12rem,30vw)] items-center gap-1.5 rounded-full px-3 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] disabled:opacity-40 ${open ? "bg-[var(--muted)]" : ""}`}>
        {savingModel && <Loader2 size={13} className="shrink-0 animate-spin" />}<span className="truncate">{modelFirst ? catalog.selectedName : label}</span><ChevronDown size={13} className="shrink-0" />
      </button>
      {present && <div id={id} role="dialog" aria-label={view === "models" ? t("챗봇 모델") : t("추론 수준")}
        data-chat-composer-popup={view} data-state={open ? "open" : "closed"} inert={!open}
        className={`ails-chat-composer-popup absolute bottom-full right-0 z-50 mb-3 border border-[var(--border)] bg-[var(--panel)] shadow-xl ${view === "reasoning" ? "w-[min(240px,calc(100vw-48px))] rounded-2xl" : "w-[min(420px,calc(100vw-48px))] rounded-3xl"}`}>
        {view === "reasoning" ? <div className="px-3 pb-3 pt-2">
          <button type="button" aria-label={t("챗봇 모델 선택")} aria-haspopup="listbox" title={catalog.selectedName}
            disabled={busy || savingModel} onClick={() => setView("models")}
            className="mb-1 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] disabled:opacity-40">
            <span aria-live="polite" className="min-w-0 truncate">{catalog.selectedName}</span><ChevronRight size={14} className="shrink-0 text-[var(--muted-foreground)]" />
          </button>
          <div data-chat-reasoning-label="true" aria-live="polite" className="mb-2 truncate text-center text-[11px] leading-4 text-[var(--muted-foreground)]">
            {t("추론 수준")} · {label}
          </div>
          <ChatReasoningSlider value={reasoning} onChange={onReasoningChange} choices={choices} disabled={busy || savingModel || reasoningDisabled} />
          {catalog.managedId !== null && (catalog.loading || !catalog.selectedManagedModel?.reasoning.values.length) && <div className="mt-2 text-center text-[11px] text-[var(--muted-foreground)]">{catalog.loading ? t("지원 추론 단계 확인 중") : t("모델 기본값 사용 · 선택 가능한 추론 단계 없음")}</div>}
        </div> : <div className="p-1.5">
          <button type="button" onClick={() => setView("reasoning")} aria-label={t("추론 수준으로 돌아가기")}
            className="mb-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
            <ChevronLeft size={14} />{t("추론 수준")}
          </button>
          <div data-chat-current-model="true" className="mb-2 flex min-w-0 items-center gap-2 px-3 text-xs" aria-live="polite">
            <span className="shrink-0 text-[var(--muted-foreground)]">{t("현재 모델")}</span>
            <span className="min-w-0 truncate font-medium text-[var(--foreground)]" title={catalog.selectedName}>{catalog.selectedName}</span>
          </div>
          <ChatModelCatalogPanel catalog={catalog.managedCatalog} selectedId={catalog.selectedId} disabled={busy || savingModel}
            requireTools={requireTools}
            onSelect={modelId => { close(); onReasoningChange("default"); void onModelChange(modelId) }} error={catalog.error} loading={catalog.loading}
            chatgptLoading={catalog.chatgptLoading} chatgptError={catalog.chatgptError} onReloadChatGPT={catalog.reloadChatGPT}
            otherModels={catalog.models.filter(model => model.id.startsWith("chatgpt:"))} />
        </div>}
      </div>}
    </div>
  </div>
}
