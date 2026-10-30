import { t } from "../../../lib/i18n.ts"

export interface UpdateStatus {
  supported: boolean
  currentVersion: string
  state: "unavailable" | "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "preparing" | "preparing-tools" | "verifying" | "ready" | "installing" | "error"
  updateVersion: string
  progressPercent: number
  transferredBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  error: string
}

export interface UpdateBridge {
  get_update_status?: () => Promise<UpdateStatus>
  check_for_updates?: () => Promise<UpdateStatus>
  on_update_status?: (callback: (status: UpdateStatus) => void) => (() => void) | void
}

export function updateIsBusy(status: UpdateStatus) {
  return ["checking", "downloading", "downloaded", "preparing", "preparing-tools", "verifying", "ready", "installing"].includes(status.state)
}

export function updateStatusLabel(status: UpdateStatus) {
  switch (status.state) {
    case "checking": return t("업데이트 확인 중")
    case "up-to-date": return t("최신 버전")
    case "downloading": return t("업데이트 다운로드 중 {p0}%", { p0: Math.round(status.progressPercent) })
    case "downloaded": return t("업데이트 설치 준비 완료")
    case "preparing": return t("새 버전 설치 중")
    case "preparing-tools": return t("업데이트 도구 준비 중")
    case "verifying": return t("새 버전 설치 확인 중")
    case "ready": return t("새 버전 설치 완료")
    case "installing": return t("새 버전으로 다시 시작 중")
    case "error": return t("업데이트 실패")
    case "unavailable": return t("설치 버전에서만 사용 가능")
    default: return t("확인 대기 중")
  }
}

export function updateByteLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}
