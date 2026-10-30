/** 데스크톱 셸(홈 대시보드)과 여러 기능이 함께 쓰는 중립 워크스페이스 타입. */
export type DashboardRecentFile = {
  path: string
  title: string
  kind: string
  lastOpenedAt?: string
  pageCount?: number
}

/** 활성 워크스페이스 표면. App 조립과 여러 기능이 함께 쓰는 중립 조립 타입. */
export type WorkspaceSurface = "home" | "dashboard" | "document" | "settings" | "code"

export type WorkspaceTab = { id: string; title: string; kind: string }
