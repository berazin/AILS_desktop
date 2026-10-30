import { t } from "../../../lib/i18n.ts"
import { useRef } from "react"
import {
  BookOpen,
  ChevronDown,
  Clock,
  FileText,
  Folder,
  HardDrive,
  Info,
  Layers,
  RotateCw,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { formatRelativeTime, type MaterialItem } from "../hooks/use-materials-listing.ts"
import type { MaterialContextTarget } from "../../../lib/material-navigation.ts"
import { StudyCardCover } from "./study-card-cover.tsx"
import { useProcessbarScrollProximity } from "../hooks/use-processbar-scroll-proximity.ts"
import "./processbar-scroll.css"

type FileInspectorPanelProps = {
  selectedItem: MaterialItem
  inspectorTab: "info" | "pages" | "tools"
  setInspectorTab: (tab: "info" | "pages" | "tools") => void
  setInspectorOpen: (open: boolean) => void
  isFavorite: boolean
  onToggleFavorite: (id: string) => void
  isOpeningRecent?: (path: string) => boolean
  onOpenRecent: (path: string) => void
  onRefresh: () => void
  onBackToAgent: () => void
  onMoveToTrash: (path: string) => void
  documentTags?: Record<string, string[]>
  practiceSet?: { valid: boolean; question_count: number; errors?: string[] } | null
  onGeneratePractice?: (target: MaterialContextTarget) => void
  onSolvePractice?: (path: string) => void
}

/* ─────────────────────────────────────────────────────────────────
   우측 상세 인스펙터 패널: 선택한 자료의 정보/페이지/도구 탭.
   inspectorTab 상태는 부모가 소유하고, 미리보기 공간은 파일 전환·이미지 로드와 무관하게 고정한다.
───────────────────────────────────────────────────────────────── */
export function FileInspectorPanel({
  selectedItem,
  inspectorTab,
  setInspectorTab,
  setInspectorOpen,
  isFavorite,
  onToggleFavorite,
  isOpeningRecent,
  onOpenRecent,
  onRefresh,
  onBackToAgent,
  onMoveToTrash,
  documentTags,
  practiceSet,
  onGeneratePractice,
  onSolvePractice,
}: FileInspectorPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useProcessbarScrollProximity(scrollRef)
  return (
    <aside
      className="flex min-w-0 w-full shrink-0 flex-col overflow-hidden rounded-sm border border-white/80 bg-white/90 shadow-[0_18px_60px_rgba(46,73,116,0.12)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#131622]/95"
      data-ails-home-file-inspector="true"
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-white/35">
          {t("파일 정보")}
        </span>
        <button
          aria-label={t("상세 정보 닫기")}
          className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-white"
          onClick={() => setInspectorOpen(false)}
          type="button"
        >
          <X size={15} />
        </button>

      </div>

      <div ref={scrollRef} className="ails-processbar-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3" style={{ scrollbarGutter: "stable" }}>
        <div className="flex h-64 justify-center rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/80 p-3 dark:border-white/[0.06] dark:from-white/[0.05] dark:to-transparent" data-ails-inspector-preview="true">
          {selectedItem.kind === "folder" ? (
            <div className="flex h-full w-full items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50/60 dark:from-blue-950/20 dark:to-indigo-950/20">
              <Folder className="h-16 w-16 text-blue-500/90 fill-blue-500/20 drop-shadow-sm" />
            </div>
          ) : (
            <StudyCardCover
              key={selectedItem.path}
              card={selectedItem}
              className="h-full w-full shadow-md rounded-xl"
              lastPage={selectedItem.lastPage || 1}
            />
          )}
        </div>

        <div className="mt-4 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-bold tracking-tight text-slate-900 dark:text-white" title={selectedItem.title}>
              {selectedItem.title}
            </h3>
            <p className="mt-1 truncate text-[11px] text-slate-400 dark:text-white/40" title={selectedItem.path}>
              {selectedItem.path.replace(/\\/g, "/")}
            </p>
          </div>
          <button
            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-400 dark:hover:bg-white/[0.06]"
            onClick={() => onToggleFavorite(selectedItem.id)}
            title={t("즐겨찾기")}
            type="button"
          >
            <Star className={isFavorite ? "fill-amber-400 text-amber-400" : "text-slate-400"} size={16} />
          </button>
        </div>

        {selectedItem.kind !== "folder" && <button
          className="mt-4 flex h-11 w-full items-center rounded-xl bg-slate-900 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          disabled={isOpeningRecent?.(selectedItem.path)}
          onClick={() => onOpenRecent(selectedItem.path)}
          type="button"
        >
          <span className="flex flex-1 items-center justify-center gap-2">
            <BookOpen size={15} />
            {t("열기")}
          </span>
          <span className="flex h-full w-11 items-center justify-center border-l border-white/15 dark:border-slate-900/15">
            <ChevronDown size={14} />
          </span>
        </button>}

        {selectedItem.kind === "MD" && <div className="mt-2 flex gap-2">
          <button className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--muted)]" onClick={() => onGeneratePractice?.({ path: selectedItem.path, fileName: selectedItem.path.split(/[\\/]/).pop() || selectedItem.title, title: selectedItem.title, kind: "md" })} type="button">{t("연습문제 만들기")}</button>
          {practiceSet && <button className="flex-1 rounded-lg border border-[var(--brand)] px-3 py-2 text-xs font-semibold text-[var(--brand)] disabled:opacity-40" disabled={!practiceSet.valid} onClick={() => onSolvePractice?.(selectedItem.path)} title={practiceSet.errors?.join("; ")} type="button">{t("풀기")}</button>}
        </div>}
        {selectedItem.kind === "MD" && practiceSet && !practiceSet.valid && <p className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600" role="alert">{t("연습문제 형식 오류")}: {practiceSet.errors?.join("; ")}</p>}

        <div className={`mt-4 grid ${selectedItem.kind === "folder" ? "grid-cols-2" : "grid-cols-3"} rounded-xl bg-slate-100/80 p-1 dark:bg-white/[0.05]`} role="tablist">
          {[
            { id: "info" as const, label: t("정보"), icon: Info },
            { id: "pages" as const, label: t("페이지"), icon: FileText },
            { id: "tools" as const, label: t("도구"), icon: Sparkles },
          ].filter(tab => selectedItem.kind !== "folder" || tab.id !== "pages").map(({ id, label, icon: Icon }) => (
            <button
              aria-selected={inspectorTab === id}
              className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 py-2 text-[11px] font-semibold transition-all ${
                inspectorTab === id
                  ? "bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.1] dark:text-blue-400 dark:ring-white/[0.08]"
                  : "text-slate-500 hover:text-slate-800 dark:text-white/45 dark:hover:text-white/80"
              }`}
              data-ails-inspector-tab={id}
              key={id}
              onClick={() => setInspectorTab(id)}
              role="tab"
              type="button"
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {inspectorTab === "info" && (
          <div className="mt-5 space-y-3.5 text-xs">
            {[
              { label: t("유형"), value: selectedItem.kind === "folder" ? t("폴더") : `${selectedItem.kind} ${t("문서")}`, icon: FileText },
              { label: t("크기"), value: selectedItem.size || "—", icon: HardDrive },
              { label: selectedItem.kind === "folder" ? t("항목 수") : t("페이지"),
                value: selectedItem.kind === "folder" ? String(selectedItem.itemCount ?? "—") : String(selectedItem.totalPages || selectedItem.lastPage || "—"), icon: Layers },
              { label: t("수정됨"), value: selectedItem.timestamp ? selectedItem.date : "—", icon: Clock },
              ...(selectedItem.kind === "folder" ? [] : [{ label: t("최근 학습 시각"), value: formatRelativeTime(selectedItem.lastOpenedAt), icon: BookOpen }]),
            ].map(({ label, value, icon: Icon }) => (
              <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2" key={label}>
                <span className="flex items-center gap-2 whitespace-nowrap text-slate-400 dark:text-white/40"><Icon size={14} /> {label}</span>
                <span className="truncate font-medium text-slate-700 dark:text-white/75" title={value}>{value}</span>
              </div>
            ))}

            {selectedItem.kind !== "folder" && <div className="pt-1">
              <div className="flex items-center gap-2 text-slate-400 dark:text-white/40"><Tag size={14} /> {t("태그")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(documentTags?.[selectedItem.path] ?? []).length > 0 ? (
                  (documentTags?.[selectedItem.path] ?? []).map((tag) => (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-white/55" key={tag}>{tag}</span>
                  ))
                ) : (
                  <span className="rounded-full border border-dashed border-slate-200 px-2.5 py-1 text-[10px] text-slate-400 dark:border-white/[0.1]">{t("태그 없음")}</span>
                )}
              </div>
            </div>}
          </div>
        )}

        {selectedItem.kind !== "folder" && inspectorTab === "pages" && (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-xs dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="flex items-center justify-between text-slate-500 dark:text-white/50">
              <span>{t("현재 위치")}</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-white/80">p.{selectedItem.lastPage || 1}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/[0.08]">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${selectedItem.percent || 3}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-slate-400 dark:text-white/40">
              <span>{t("전체 페이지")}</span>
              <span>{selectedItem.totalPages || "—"}</span>
            </div>
          </div>
        )}

        {inspectorTab === "tools" && (
          <div className="mt-5 space-y-1 text-xs">
            {selectedItem.kind === "PDF" && (
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-white/75 dark:hover:bg-white/[0.06]" onClick={onRefresh} type="button">
                <RotateCw size={14} className="text-slate-400" /> {t("OCR 다시 실행")}
              </button>
            )}
            {selectedItem.kind !== "folder" && <><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-white/75 dark:hover:bg-white/[0.06]" onClick={onBackToAgent} type="button">
              <FileText size={14} className="text-slate-400" /> {t("정리본 열기")}
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-100 dark:text-white/75 dark:hover:bg-white/[0.06]" type="button">
              <Upload size={14} className="text-slate-400" /> {t("보관함")}으로 내보내기
            </button></>}
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20" onClick={() => onMoveToTrash(selectedItem.path)} type="button">
              <Trash2 size={14} /> {t("휴지통")}으로 이동
            </button>
          </div>
        )}
      </div>

      <div className="m-4 mt-0 flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-3 text-[10px] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-white/35">
        <FileText size={14} />
        <span className="min-w-0 flex-1 truncate">{t("읽는 곳에서 바로 사용할 빠른 작업")}</span>
      </div>
    </aside>
  )
}
