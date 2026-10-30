import type { Dispatch, SetStateAction } from "react"
import { Clock } from "lucide-react"

import type { AILSConfig, BackgroundWorkStatus } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { SettingsCard, SettingsRow, SettingsSwitch } from "./settings-layout.tsx"
import { Button } from "../../../shared/ui/button.tsx"

function formatBackgroundWorkKindStatus(status: BackgroundWorkStatus | null, kind: "embedding" | "ocr" | "spacing") {
  const counts = status?.counts?.[kind]
  if (!counts || Object.keys(counts).length === 0) return ""
  const parts: string[] = []
  if (kind === "ocr" && status?.current_ocr) {
    const current = status.current_ocr
    parts.push(current.total > 0 ? t("진행 {p0}/{p1}쪽", { p0: current.page, p1: current.total }) : t("진행 중"))
  }
  if (kind === "ocr") {
    const evalPending = (status?.counts?.evaluating?.pending ?? 0) + (status?.counts?.evaluating?.evaluating ?? 0)
    if (evalPending > 0) parts.push(t("판정 대기 {p0}", { p0: evalPending }))
  }
  const pending = (counts.pending ?? 0) + (counts.running ?? 0)
  if (pending > 0) parts.push(t("남은 문서 {p0}", { p0: pending }))
  if ((counts.blocked ?? 0) > 0) parts.push(t("대기(재시도 예정) {p0}", { p0: counts.blocked }))
  if ((counts.failed ?? 0) > 0) parts.push(t("실패 {p0}", { p0: counts.failed }))
  if ((counts.done ?? 0) > 0) parts.push(t("완료 {p0}", { p0: counts.done }))
  return parts.join(" · ")
}

export function BackgroundWorkSettingsCard({
  config,
  onOpenQueue,
  setConfig,
  setNotice,
  status,
}: {
  config: AILSConfig
  onOpenQueue: () => void
  setConfig: Dispatch<SetStateAction<AILSConfig>>
  setNotice: (message: string) => void
  status: BackgroundWorkStatus | null
}) {
  const embeddingStatus = formatBackgroundWorkKindStatus(status, "embedding")
  const ocrStatus = formatBackgroundWorkKindStatus(status, "ocr")
  const statusSegments: string[] = []
  if (embeddingStatus) statusSegments.push(t("임베딩 — {p0}", { p0: embeddingStatus }))
  if (ocrStatus) statusSegments.push(`OCR — ${ocrStatus}`)
  const spacingStatus = formatBackgroundWorkKindStatus(status, "spacing")
  if (spacingStatus) statusSegments.push(t("문법정제 — {p0}", { p0: spacingStatus }))

  return (
    <SettingsCard
      description={t("학습자료를 새로고침할 때 아직 준비되지 않은 문서를 백그라운드로 자동 처리합니다.")}
      title={t("백그라운드 문서 준비")}
    >
      <SettingsRow
        control={(
          <SettingsSwitch
            ariaLabel={t("모든 문서 백그라운드 임베딩")}
            checked={Boolean(config.background_document_embedding)}
            onCheckedChange={(enabled) => {
              setConfig((current) => ({ ...current, background_document_embedding: enabled }))
              setNotice(
                enabled
                  ? t("학습자료 새로고침 때 임베딩이 끝나지 않은 문서를 백그라운드로 준비합니다.")
                  : t("백그라운드 문서 임베딩을 끕니다."),
              )
            }}
          />
        )}
        description={t("AI Assist 검색에 쓰는 문서 임베딩을 백그라운드로 만듭니다. 진행 상황은 문서 단위로 저장되어 프로그램을 다시 시작하면 이어서 진행합니다.")}
        label={t("모든 문서 백그라운드 임베딩")}
      />
      <SettingsRow
        control={(
          <SettingsSwitch
            ariaLabel={t("모든 문서 백그라운드 OCR")}
            checked={Boolean(config.background_document_ocr)}
            onCheckedChange={(enabled) => {
              setConfig((current) => ({ ...current, background_document_ocr: enabled }))
              setNotice(
                enabled
                  ? t("학습자료 새로고침 때 텍스트가 없는 PDF를 백그라운드 OCR로 준비합니다.")
                  : t("백그라운드 문서 OCR을 끕니다."),
              )
            }}
          />
        )}
        description={t("텍스트 레이어가 없는 PDF를 백그라운드로 OCR합니다. 이미 텍스트가 있는 PDF는 건너뛰고, 사용자가 직접 시작한 OCR과 겹치지 않게 순서대로 실행됩니다.")}
        label={t("모든 문서 백그라운드 OCR")}
      />
      <div className="border-t border-[var(--border)] bg-[var(--card)]/40 px-5 pb-3 pt-0">
        <label className="flex cursor-pointer select-none items-center gap-2 pt-2.5 text-xs text-[var(--foreground)]">
          <input
            type="checkbox"
            checked={Boolean(config.background_document_ocr_non_ails)}
            onChange={(event) => {
              const enabled = event.target.checked
              setConfig((current) => ({ ...current, background_document_ocr_non_ails: enabled }))
              setNotice(
                enabled
                  ? t("AILS 메타데이터가 없는 PDF를 텍스트 유무와 관계없이 강제 재OCR합니다.")
                  : t("AILS 메타데이터 없는 PDF 강제 재OCR을 끕니다."),
              )
            }}
            className="rounded border-[var(--border)] text-[var(--brand)] focus:ring-[var(--brand)]"
            data-testid="background-ocr-non-ails-checkbox"
          />
          <span>{t("AILS 메타데이터가 없는 PDF 강제 재OCR (기존 텍스트 무시)")}</span>
        </label>
        <p className="mt-1 pl-5 text-[11px] text-[var(--muted-foreground)]">
          {t("AILS 메타데이터(/AILSFullOCR)가 없는 문서는 이미 텍스트가 있어도 AILS 고품질 OCR 파이프라인으로 다시 처리합니다.")}
        </p>
      </div>
      <SettingsRow
        control={(
          <SettingsSwitch
            ariaLabel={t("백그라운드 문법정제")}
            checked={Boolean(config.background_document_spacing)}
            onCheckedChange={(enabled) => {
              setConfig((current) => ({ ...current, background_document_spacing: enabled }))
              setNotice(enabled ? t("최신 버전이 아닌 PDF를 백그라운드에서 문법정제합니다.") : t("기존 PDF의 자동 문법정제를 끕니다. 새 OCR의 마지막 문법정제 단계는 유지됩니다."))
            }}
          />
        )}
        description={t("학습자료 새로고침 때 PDF 메타데이터의 문법정제 버전을 확인합니다. 버전이 없거나 최신이 아니면 재OCR 없이 처리하고, 최신인 PDF는 건너뜁니다. 새 OCR에는 마지막 단계로 항상 적용됩니다.")}
        label={t("백그라운드 문법정제")}
      />
      <div className="border-t border-[var(--border)] px-5 pb-3 pt-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={Boolean(config.background_document_spacing_non_ails)}
            onChange={(event) => {
              const enabled = event.target.checked
              setConfig((current) => ({ ...current, background_document_spacing_non_ails: enabled }))
              setNotice(enabled ? t("AILS OCR 메타데이터가 없는 PDF도 문법정제 대상에 포함합니다.") : t("AILS OCR 메타데이터가 없는 PDF는 문법정제 대상에서 제외합니다."))
            }}
            data-testid="background-grammar-refinement-non-ails-checkbox"
          />
          <span>{t("AILS OCR 메타데이터가 없는 PDF에도 문법정제 적용")}</span>
        </label>
        <p className="mt-1 pl-5 text-[11px] text-[var(--muted-foreground)]">
          {t("기존 텍스트 레이어를 사용합니다. 최신 문법정제 버전인 PDF, 텍스트가 없는 스캔 PDF, OCR 제외 문서는 건너뜁니다.")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 px-5 pb-4 text-xs text-[var(--muted-foreground)]">
        <p className="min-w-0 flex-1 truncate" data-testid="background-work-status">
          {statusSegments.length > 0
            ? statusSegments.join(" / ")
            : t("아직 백그라운드 문서 작업이 없습니다.")}
        </p>
        <Button
          className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
          data-testid="btn-background-work-queue"
          onClick={onOpenQueue}
          size="sm"
          type="button"
          variant="outline"
        >
          <Clock size={13} />
          {t("대기 목록 보기")}
        </Button>
      </div>
    </SettingsCard>
  )
}
