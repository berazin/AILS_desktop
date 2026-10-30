import { t } from "../../../lib/i18n.ts"
import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  Loader2,
  Mail,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react"

import {
  getAIComplianceStatus,
  openAIDataDirectory,
  setAIConsent,
  type AIComplianceStatus,
} from "../../../lib/api"
import { Button } from "../../../shared/ui/button.tsx"

interface ExternalLinkBridge {
  open_external_url?: (url: string) => Promise<{ opened: boolean; url: string }>
}

function bridge() {
  return (window as Window & { ailsDesktop?: { api?: ExternalLinkBridge } }).ailsDesktop?.api
}

async function openExternalUrl(url: string) {
  if (!url) throw new Error(t("배포 설정에 연결 주소가 없습니다."))
  const api = bridge()
  if (api?.open_external_url) {
    await api.open_external_url(url)
    return
  }
  throw new Error(t("외부 링크 열기는 AILS Electron 앱에서만 사용할 수 있습니다."))
}

function policyLinks(status: AIComplianceStatus) {
  return [
    [t("개인정보처리방침"), status.policy.privacy_policy_url],
    [t("이용약관"), status.policy.terms_of_use_url],
    [t("AI 기능 및 한계"), status.policy.ai_disclosure_url],
    [t("데이터 삭제 방법"), status.policy.data_deletion_url],
  ] as const
}

function notifyChanged(status: AIComplianceStatus) {
  window.dispatchEvent(new CustomEvent("ails:ai-compliance-changed", { detail: status }))
}

export function AIConsentGate() {
  const [status, setStatus] = useState<AIComplianceStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [processingAccepted, setProcessingAccepted] = useState(false)
  const [transferAccepted, setTransferAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const next = await getAIComplianceStatus()
      setStatus(next)
      if (next.consent.status === "unset" || (
        next.consent.status === "granted" && !next.consent.valid
      )) {
        setOpen(true)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void load()
    const requireConsent = () => setOpen(true)
    const openConsent = () => setOpen(true)
    window.addEventListener("ails:ai-consent-required", requireConsent)
    window.addEventListener("ails:open-ai-consent", openConsent)
    return () => {
      window.removeEventListener("ails:ai-consent-required", requireConsent)
      window.removeEventListener("ails:open-ai-consent", openConsent)
    }
  }, [load])

  async function decide(action: "grant" | "decline") {
    setBusy(true)
    setError("")
    try {
      const next = await setAIConsent(
        action,
        action === "grant"
          ? {
              privacy_and_terms: privacyAccepted,
              external_ai_processing: processingAccepted,
              cross_border_transfer: transferAccepted,
            }
          : undefined,
      )
      setStatus(next)
      notifyChanged(next)
      setOpen(false)
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : String(decisionError))
    } finally {
      setBusy(false)
    }
  }

  if (!open || !status) return null
  const allAccepted = privacyAccepted && processingAccepted && transferAccepted
  const audioProcessingEnabled = status.data_categories.some((category) => category.includes(t("오디오")))

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/60 p-4" data-ails-window="true">
      <section className="flex max-h-[calc(100vh-32px)] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 shrink-0 text-[var(--brand)]" size={21} />
            <div>
              <h2 className="text-base font-semibold">{t("외부 AI 데이터 처리 동의")}</h2>
              <p className="mt-1 text-sm leading-5 text-[var(--muted-foreground)]">
                {t("동의하지 않아도 로컬 문서 보기, 검색, 로컬 OCR과 로컬 실행 기능은 사용할 수 있습니다.")}</p>
            </div>
          </div>
          {status.consent.status !== "unset" && (
            <Button aria-label={t("동의 창 닫기")} onClick={() => setOpen(false)} size="icon" type="button" variant="ghost">
              <X size={17} />
            </Button>
          )}
        </header>

        <div className="min-h-0 space-y-5 overflow-y-auto p-5">
          {!status.policy.configured && (
            <div className="flex gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 shrink-0" size={16} />
              {t("이 개발용 배포본에는 공개 정책 URL과 지원 연락처가 아직 설정되지 않았습니다. 공개 배포 빌드는 이 상태에서 차단됩니다.")}</div>
          )}

          <div className="space-y-2 text-sm leading-6">
            <p><strong>{t("전송될 수 있는 정보:")}</strong> {status.data_categories.join(", ")}</p>
            <p><strong>{t("처리 목적:")}</strong> {audioProcessingEnabled ? t("음성 인식, ") : ""}{t("문서 분석·번역, 질의응답, 힌트·채점, 코드 검토")}</p>
            <p><strong>{t("외부 공급자 및 해외 처리:")}</strong> {t("선택한 모델에 따라 ")}{status.external_providers.map((provider) => provider.name).join(", ")}{t("로 전송되며 국외 서버에서 처리될 수 있습니다.")}</p>
            <p><strong>{t("AI의 한계:")}</strong> {t("답변과 채점은 부정확하거나 편향되거나 부적절할 수 있습니다. 중요한 결과는 원문과 실행 결과로 확인해야 합니다.")}</p>
          </div>

          <div className="border-y border-[var(--border)] py-3">
            <h3 className="text-xs font-semibold">{t("공급자별 전송 항목")}</h3>
            <div className="mt-2 divide-y divide-[var(--border)]">
              {status.external_providers.map((provider) => (
                <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs" key={provider.id}>
                  <div className="min-w-0">
                    <span className="font-semibold">{provider.name}</span>
                    <span className="ml-2 text-[var(--muted-foreground)]">{provider.data.join(", ")}</span>
                  </div>
                  {provider.privacy_url && (
                    <button className="shrink-0 text-[var(--brand)] hover:underline" onClick={() => void openExternalUrl(provider.privacy_url)} type="button">
                      {t("공급자 정책")}</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {policyLinks(status).map(([label, url]) => (
              <Button disabled={!url} key={label} onClick={() => void openExternalUrl(url)} size="sm" type="button" variant="outline">
                <ExternalLink size={14} /> {label}
              </Button>
            ))}
          </div>

          <div className="space-y-3 border-t border-[var(--border)] pt-4">
            <label className="flex items-start gap-3 text-sm leading-5">
              <input checked={privacyAccepted} className="mt-1 h-4 w-4 accent-[var(--brand)]" onChange={(event) => setPrivacyAccepted(event.target.checked)} type="checkbox" />
              {t("개인정보처리방침, 이용약관, AI 기능 및 한계 고지를 확인했습니다.")}</label>
            <label className="flex items-start gap-3 text-sm leading-5">
              <input checked={processingAccepted} className="mt-1 h-4 w-4 accent-[var(--brand)]" onChange={(event) => setProcessingAccepted(event.target.checked)} type="checkbox" />
              {t("선택한 AI 기능 수행에 필요한 데이터를 외부 AI 공급자에게 전송하는 데 동의합니다.")}</label>
            <label className="flex items-start gap-3 text-sm leading-5">
              <input checked={transferAccepted} className="mt-1 h-4 w-4 accent-[var(--brand)]" onChange={(event) => setTransferAccepted(event.target.checked)} type="checkbox" />
              {t("데이터가 공급자의 국외 서버에서 처리될 수 있다는 사실을 확인하고 동의합니다.")}</label>
          </div>

          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-4">
          <Button disabled={busy} onClick={() => void decide("decline")} type="button" variant="ghost">
            {t("외부 AI 없이 계속")}</Button>
          <Button disabled={busy || !allAccepted} onClick={() => void decide("grant")} type="button">
            {busy ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
            {t("동의하고 AI 사용")}</Button>
        </footer>
      </section>
    </div>
  )
}

export function PrivacyAISettingsPanel() {
  const [status, setStatus] = useState<AIComplianceStatus | null>(null)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      setStatus(await getAIComplianceStatus())
      setError("")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void load()
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<AIComplianceStatus>).detail
      if (detail) setStatus(detail)
      else void load()
    }
    window.addEventListener("ails:ai-compliance-changed", changed)
    return () => window.removeEventListener("ails:ai-compliance-changed", changed)
  }, [load])

  async function withdraw() {
    if (!window.confirm(t("동의를 철회하면 진행 중인 외부 AI 작업이 취소되고 이후 외부 AI 기능이 차단됩니다. 계속할까요?"))) return
    setBusy("withdraw")
    try {
      const next = await setAIConsent("withdraw")
      setStatus(next)
      notifyChanged(next)
      setError("")
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : String(withdrawError))
    } finally {
      setBusy("")
    }
  }

  async function openDataDirectory() {
    setBusy("data")
    try {
      await openAIDataDirectory()
      setError("")
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      setBusy("")
    }
  }

  const consentLabel = !status
    ? t("확인 중")
    : status.consent.valid
      ? t("외부 AI 전송 동의됨")
      : status.consent.status === "withdrawn"
        ? t("동의 철회됨")
        : status.consent.status === "declined"
          ? t("외부 AI 사용 안 함")
          : t("동의하지 않음")

  return (
    <section id="settings-privacy-ai" className="scroll-mt-16 rounded-lg border border-[var(--border)] p-4 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {status?.consent.valid ? <ShieldCheck className="mt-0.5 text-emerald-500" size={18} /> : <ShieldOff className="mt-0.5 text-[var(--muted-foreground)]" size={18} />}
          <div>
            <h3 className="text-sm font-semibold">{t("개인정보·AI")}</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{consentLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!status?.consent.valid ? (
            <Button onClick={() => window.dispatchEvent(new CustomEvent("ails:open-ai-consent"))} size="sm" type="button">
              <ShieldCheck size={14} /> {t("동의 내용 확인")}</Button>
          ) : (
            <Button disabled={busy === "withdraw"} onClick={() => void withdraw()} size="sm" type="button" variant="outline">
              {busy === "withdraw" ? <Loader2 className="animate-spin" size={14} /> : <ShieldOff size={14} />}
              {t("동의 철회")}</Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold">{t("문서와 연락처")}</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {status && policyLinks(status).map(([label, url]) => (
              <Button disabled={!url} key={label} onClick={() => void openExternalUrl(url)} size="sm" type="button" variant="outline">
                <ExternalLink size={13} /> {label}
              </Button>
            ))}
            <Button
              disabled={!status?.policy.support_email}
              onClick={() => void openExternalUrl(`mailto:${status?.policy.support_email}`)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Mail size={13} /> {t("지원 문의")}</Button>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold">{t("삭제와 문의")}</h4>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {t("로컬 데이터는 프로그램 종료 후 아래 폴더에서 삭제할 수 있습니다. 외부 공급자에 전송된 데이터는 데이터 삭제 안내를 확인하세요.")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={busy === "data"} onClick={() => void openDataDirectory()} size="sm" type="button" variant="outline">
              {busy === "data" ? <Loader2 className="animate-spin" size={13} /> : <FolderOpen size={13} />}
              {t("로컬 데이터 폴더")}</Button>
          </div>
        </div>
      </div>

      {status && !status.policy.configured && (
        <div className="mt-4 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-600 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 shrink-0" size={14} />
          {t("공개 배포에 필요한 정책 URL 또는 지원 이메일이 누락되었습니다.")}</div>
      )}
      {error && <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
    </section>
  )
}
