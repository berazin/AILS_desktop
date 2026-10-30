import { Search, X } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import type { MaterialSearchModalController } from "../hooks/use-material-search-modal.ts"
import { SEARCH_MODE_LABELS } from "../search-modal-state.ts"
import { MaterialSearchResults } from "./material-search-results.tsx"

const KEYBOARD_HINT_CLASS = "rounded border border-[var(--border)] bg-[var(--muted)] px-1 py-0.5 text-[10px] font-medium"

export function MaterialSearchModal({ controller }: { controller: MaterialSearchModalController }) {
  const { close, isOpen, presentation, mode, query, setQuery } = controller
  if (!isOpen || presentation === "inline") return null

  return (
    <div
      aria-label={t("자료 검색")}
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/45 p-4 backdrop-blur-sm"
      data-ails-search-modal="true"
      data-ails-window="true"
      onMouseDown={close}
      role="dialog"
    >
      <section
        className="mt-[9vh] flex h-[min(66vh,720px)] w-[min(62vw,880px)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search className="shrink-0 text-[var(--muted-foreground)]" size={16} />
          <input
            autoFocus
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "keyword" ? t("문서 제목·본문 검색 (예: 벡터*검색)") : t("학습 자료 내용을 검색하세요")}
            spellCheck={false}
            value={query}
          />
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-md border border-[var(--brand)] bg-[var(--brand)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--brand)]">
              {t(SEARCH_MODE_LABELS[mode])}
            </span>
            <button aria-label={t("검색창 닫기")} className="rounded p-1 hover:bg-[var(--muted)]" onClick={close} type="button">
              <X size={14} />
            </button>
          </span>
        </header>

        <MaterialSearchResults controller={controller} />

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1">
            <kbd className={KEYBOARD_HINT_CLASS}>↑ ↓</kbd> {t("이동")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className={KEYBOARD_HINT_CLASS}>{t("Enter")}</kbd> {t("열기")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className={KEYBOARD_HINT_CLASS}>{t("Tab")}</kbd> {t("검색 방식 전환")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className={KEYBOARD_HINT_CLASS}>{t("Esc")}</kbd> {t("닫기")}
          </span>
        </footer>
      </section>
    </div>
  )
}
