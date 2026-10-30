import { PERSONAL_MODE } from "../../../edition.ts"
import { useCallback, useEffect, useState } from "react"
import { chatGPTAction, getChatGPTModels, getChatGPTStatus, openChatGPTUsage, type AiProviderSettings, type ChatGPTStatus } from "../../../lib/api/chatgpt.ts"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { SETTINGS_SELECT_CLASS, SettingsCard, SettingsRow } from "./settings-layout.tsx"
import { ChatGPTWelcomeDialog } from "./chatgpt-welcome-dialog.tsx"

const DEFAULTS: AiProviderSettings = { default: "ails", features: {}, chatgpt_model: "" }

export function AiProviderSettingsPanel({ active, value = DEFAULTS, onChange, onConnectionChange }: {
  active: boolean
  value?: AiProviderSettings
  onChange: (value: AiProviderSettings) => void
  onConnectionChange?: (status: ChatGPTStatus) => void
}) {
  const [status, setStatus] = useState<ChatGPTStatus | null>(null)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [statusError, setStatusError] = useState("")
  const refresh = useCallback(async () => {
    const next = await getChatGPTStatus()
    setStatus(next)
    onConnectionChange?.(next)
    setStatusError("")
    if (!next.connected || !next.plan_enabled) setModels([])
    return next
  }, [onConnectionChange])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let inflight = false
    const poll = async () => {
      if (inflight) return
      inflight = true
      try {
        const next = await getChatGPTStatus()
        if (!cancelled) {
          setStatus(next)
          onConnectionChange?.(next)
          setStatusError("")
          if (!next.connected || !next.plan_enabled) setModels([])
        }
      } catch (e) { if (!cancelled) setStatusError(String(e)) }
      finally { inflight = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [active, onConnectionChange])

  const action = async (kind: "connect" | "disconnect" | "cancel" | "welcome", reconsent = false) => {
    setBusy(true)
    setError("")
    try {
      await chatGPTAction(kind, reconsent)
      if (kind !== "welcome") setModels([])
      await refresh()
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }
  const loadModels = async () => {
    setBusy(true)
    setError("")
    try { setModels((await getChatGPTModels()).models) }
    catch (e) { setModels([]); setError(String(e)) }
    finally { setBusy(false) }
  }
  const manageUsage = async () => {
    try {
      await openChatGPTUsage()
    } catch (e) { setError(String(e)) }
  }

  if (!active) return null
  return <section id="settings-ai" className="grid gap-6">
    {status?.welcome_required && <ChatGPTWelcomeDialog busy={busy} onDismiss={() => { if (!busy) void action("welcome") }} />}
    <SettingsCard title={t("ChatGPT 연결")} description={t("연결 후 AI 모델 탭에서 계정이 지원하는 OpenAI 모델을 선택하면 ChatGPT 구독 사용량을 자동으로 사용합니다. 모델 선택은 그대로 유지됩니다.")}>
      {status && !status.available && <p role="status" className="px-5 pt-4 text-sm text-amber-600">{t("이 배포판에서는 ChatGPT 연결을 사용할 수 없습니다. 유료·원격 호스팅 배포는 OpenAI 승인과 배포 설정 확인이 필요합니다.")}</p>}
      <SettingsRow label={t("연결 상태")} control={<span className="text-sm">{
        !status ? t(statusError ? "연결 상태 확인 실패" : "연결 상태 확인 중") : status.pending ? t("브라우저에서 로그인 진행 중") : status.connected
          ? `${status.email} · ${status.plan_enabled ? t("구독 사용 권한 있음") : t("구독 사용 권한 없음")}`
          : t("연결 안 됨")
      }</span>} />
      <div className="flex flex-wrap gap-2 px-5 pb-4">
        <Button disabled={busy || !status?.available || status.pending} onClick={() => void action("connect")} variant="outline">Continue with ChatGPT</Button>
        {status?.pending && <Button disabled={busy} onClick={() => void action("cancel")} variant="ghost">{t("로그인 취소")}</Button>}
        {status?.connected && <>
          {!status.plan_enabled && <Button disabled={busy} onClick={() => void action("connect", true)} variant="outline">{t("구독 사용 권한 허용")}</Button>}
          <Button disabled={busy} onClick={() => void action("disconnect")} variant="ghost">{t("연결 해제")}</Button>
        </>}
        <Button disabled={!status} onClick={() => void manageUsage()} variant="ghost">{t("ChatGPT 사용량·접근 권한 관리")}</Button>
      </div>
      <SettingsRow label={t("ChatGPT 모델")} description={t("계정의 모델 목록을 조회합니다. 실제 요청의 허용 여부는 모델·계정 정책에 따라 확인됩니다.")} control={
        <div className="flex gap-2">
          <select aria-label={t("ChatGPT 모델")} className={SETTINGS_SELECT_CLASS} value={value.chatgpt_model} disabled={!status?.plan_enabled || busy}
            onChange={e => onChange({ ...value, chatgpt_model: e.target.value })}>
            <option value="">{t("자동 선택 · 계정의 첫 번째 사용 가능 모델")}</option>
            {value.chatgpt_model && !models.some(m => m.id === value.chatgpt_model) && <option value={value.chatgpt_model}>{value.chatgpt_model} · {t("현재 목록 확인 필요")}</option>}
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Button disabled={busy || !status?.plan_enabled} onClick={() => void loadModels()} variant="outline">{t("새로고침")}</Button>
        </div>
      } />
      {(error || statusError || status?.error) && <p role="alert" className="px-5 pb-4 text-sm text-red-500">{error || statusError || status?.error}</p>}
    </SettingsCard>
    {!PERSONAL_MODE && <><SettingsCard title={t("기본 AI")} description={t("AI 모델 탭에서 지원 모델을 선택하면 연결 계정의 구독을 우선 사용합니다. ChatGPT 요청 실패나 한도 도달 시 다른 유료 공급자로 자동 전환하지 않습니다. 변경사항은 자동 저장됩니다.")}>
      <SettingsRow label={t("AI 공급자")} control={
        <select aria-label={t("기본 AI 공급자")} className={SETTINGS_SELECT_CLASS} value={value.default}
          onChange={e => onChange({ ...value, default: e.target.value as AiProviderSettings["default"] })}>
          <option value="ails">{t("AI 모델 설정 따르기")}</option>
          <option value="chatgpt">{t("ChatGPT 구독")}</option>
        </select>
      } />
    </SettingsCard>
    <details className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("고급 설정 · 기능별 AI")}</summary>
      <p className="my-3 text-xs text-[var(--muted-foreground)]">{t("로컬 OCR·STT·임베딩·리랭킹 설정은 그대로 유지됩니다. PDF 문제 자동 검수는 AILS 서버를 명시적으로 선택해야 합니다.")}</p>
      <p className="my-3 text-xs text-[var(--muted-foreground)]">{t("ChatGPT 강의 정리는 현재 검증 웹 검색을 지원하지 않습니다. 강의 설정의 웹 검색을 켠 상태에서는 요청을 시작하지 않습니다.")}</p>
      {Object.entries(status?.features ?? {}).map(([id, label]) => <SettingsRow key={id} label={t(label)} control={
        <select aria-label={t(label)} className={SETTINGS_SELECT_CLASS} value={value.features[id] ?? "default"} onChange={e => {
          const features = { ...value.features }
          if (e.target.value === "default") delete features[id]
          else features[id] = e.target.value as "ails" | "chatgpt"
          onChange({ ...value, features })
        }}>
          <option value="default">{t("기본 AI 적용")}</option>
          <option value="ails">{t("AI 모델 설정 따르기")}</option>
          <option value="chatgpt">{t("ChatGPT 구독")}</option>
        </select>
      } />)}
    </details></>}
  </section>
}
