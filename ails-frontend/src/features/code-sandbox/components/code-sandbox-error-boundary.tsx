import { Component, type ReactNode } from "react"

import { t } from "../../../lib/i18n.ts"

export class CodeSandboxErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { errorMessage: string }
> {
  state = { errorMessage: "" }

  static getDerivedStateFromError(error: unknown) {
    return { errorMessage: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown) {
    console.error("[CodeSandbox] failed to load", error)
  }

  render() {
    if (!this.state.errorMessage) return this.props.children
    return (
      <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-6">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl">
          <div className="text-base font-semibold">{t("문제풀이를 불러오지 못했습니다")}</div>
          <div className="mt-2 break-words text-sm text-[var(--muted-foreground)]">{this.state.errorMessage}</div>
          <button
            type="button"
            className="mt-4 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--muted)]"
            onClick={this.props.onClose}
          >
            {t("닫기")}</button>
        </div>
      </div>
    )
  }
}
