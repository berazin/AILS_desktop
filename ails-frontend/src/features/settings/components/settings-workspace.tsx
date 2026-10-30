import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  BrainCircuit,
  Bot,
  ChevronRight,
  Download,
  Loader2,
  Palette,
  RotateCcw,
  Scale,
  ScanText,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import { PERSONAL_MODE, LOCAL_AI_SETTINGS_ENABLED } from "../../../edition.ts"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"
import "./settings-workspace.css"

export type SettingsSectionId =
  | "settings-ai"
  | "settings-models"
  | "settings-ai-behavior"
  | "settings-runtime"
  | "settings-account"
  | "settings-memory"
  | "settings-privacy-ai"
  | "settings-pdf-ocr"
  | "settings-appearance"
  | "settings-licenses"
  | "settings-update"

const SETTINGS_SECTION_META: Record<SettingsSectionId, { title: string; description: string }> = {
  "settings-ai": { title: "AI 설정", description: "ChatGPT 연결과 기본 AI, 기능별 공급자를 설정합니다." },
  "settings-models": { title: "AI 모델", description: "작업 흐름을 고르고 각 단계의 실행 위치와 적용 모델을 확인합니다." },
  "settings-ai-behavior": { title: "AI 동작", description: "보이스 입력과 응답, 챗봇의 세부 동작을 설정합니다." },
  "settings-runtime": { title: "작업 환경", description: "백그라운드 문서 작업, 저장 위치와 실행 환경을 설정합니다." },
  "settings-account": { title: "계정", description: "LMS(e-class) 계정 연동을 설정합니다." },
  "settings-memory": { title: "메모리", description: "AILS가 기억하는 학습 정보와 선호를 확인하고 관리합니다." },
  "settings-privacy-ai": { title: "개인정보·AI", description: "개인정보 처리와 AI 사용 동의 상태를 관리합니다." },
  "settings-pdf-ocr": { title: "PDF OCR", description: "PDF 인식 모델과 배치를 점검하고 이 PC에 맞는 조합을 검사합니다." },
  "settings-appearance": { title: "화면", description: "테마와 강조색, 창 동작, PDF·PPT 보기 방식을 설정합니다." },
  "settings-licenses": { title: "라이선스", description: "이 배포판에 포함된 오픈소스 및 제3자 라이선스를 확인합니다." },
  "settings-update": { title: "업데이트", description: "AILS 업데이트를 확인하고 설치합니다." },
}

type SettingsNavItem = [SettingsSectionId, string, LucideIcon]

interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

function settingsNavGroups(): SettingsNavGroup[] {
  const aiGroup: SettingsNavGroup = {
    label: t("AI 기능"),
    items: [
      ...(LOCAL_AI_SETTINGS_ENABLED ? [["settings-ai", t("AI 설정"), BrainCircuit] as SettingsNavItem] : []),
      ["settings-models", t("AI 모델"), Sparkles],
      ["settings-ai-behavior", t("AI 동작"), Bot],
    ],
  }
  return [
    aiGroup,
    {
      label: t("계정 및 개인화"),
      items: [
        ["settings-account", t("계정"), UserRound],
        /* @ails-feature:user_memory:start */
        ["settings-memory", t("메모리"), BrainCircuit],
        /* @ails-feature:user_memory:end */
        ["settings-privacy-ai", t("개인정보·AI"), ShieldCheck],
        ["settings-appearance", t("화면"), Palette],
      ],
    },
    {
      label: t("관리"),
      items: [
        ["settings-runtime", t("작업 환경"), SlidersHorizontal],
        ["settings-pdf-ocr", "PDF OCR", ScanText],
        ["settings-licenses", t("라이선스"), Scale],
        ...(!PERSONAL_MODE ? [["settings-update", t("업데이트"), Download] as SettingsNavItem] : []),
      ],
    },
  ]
}

function filteredSettingsNavGroups(query: string): SettingsNavGroup[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return settingsNavGroups()
  return settingsNavGroups()
    .map((group) => ({
      label: group.label,
      items: group.items.filter(([, label]) => label.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.items.length > 0)
}

interface SettingsWorkspaceProps {
  active: boolean
  children: (sectionId: SettingsSectionId) => ReactNode
  isBusy: (key: string) => boolean
  onClose: () => void
  onReset: () => void
}

export function SettingsWorkspace({ active, children, isBusy, onClose, onReset }: SettingsWorkspaceProps) {
  const [sectionId, setSectionId] = useState<SettingsSectionId>("settings-models")
  const [navQuery, setNavQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!active) return
    const focusSettingsSearch = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener("keydown", focusSettingsSearch)
    return () => window.removeEventListener("keydown", focusSettingsSearch)
  }, [active])

  if (!active) return null
  const navGroups = filteredSettingsNavGroups(navQuery)

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-8 z-[90] bg-[var(--background)] text-[var(--foreground)]"
      data-ails-settings-surface="true"
    >
      <section className="flex h-full w-full overflow-hidden bg-[var(--background)]">
        <aside className="relative flex w-60 shrink-0 flex-col lg:w-72">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" data-ails-sidebar-texture-layer="true">
            <div className="ails-settings-sidebar-texture h-full w-full" />
          </div>
          <div className="ails-settings-sidebar-content relative z-10 flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-4">
              <Button className="-ml-2 gap-2 text-sm font-medium text-[var(--foreground)]" onClick={onClose} size="sm" variant="ghost">
                <ChevronRight className="rotate-180" size={16} />
                {t("앱으로 돌아가기")}
              </Button>
            </div>
            <div className="px-4 pb-1 pt-3">
              <label
                className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 shadow-sm"
                data-ails-settings-search="true"
              >
                <Search className="shrink-0 text-[var(--muted-foreground)]" size={14} />
                <input
                  aria-label={t("설정 검색")}
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                  onChange={(event) => setNavQuery(event.target.value)}
                  placeholder={t("설정 검색")}
                  ref={searchInputRef}
                  value={navQuery}
                />
                <span className="flex shrink-0 items-center gap-1">
                  <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">Ctrl</kbd>
                  <span className="text-[10px] text-[var(--muted-foreground)]">+</span>
                  <kbd className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">F</kbd>
                </span>
              </label>
            </div>
            <nav aria-label={t("설정 분류")} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {navGroups.length === 0 && (
                <p className="px-3 pt-4 text-xs text-[var(--muted-foreground)]">{t("일치하는 설정이 없습니다.")}</p>
              )}
              {navGroups.map((group) => (
                <div className="space-y-0.5" key={group.label}>
                  <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{group.label}</div>
                  {group.items.map(([target, label, Icon]) => (
                    <Button
                      aria-current={sectionId === target ? "page" : undefined}
                      className="w-full justify-start"
                      key={target}
                      onClick={() => setSectionId(target)}
                      variant={sectionId === target ? "secondary" : "ghost"}
                    >
                      <Icon className="shrink-0" size={16} />
                      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                    </Button>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-8 pb-5 pt-7">
            <div className="min-w-0">
              <h2 className="text-2xl font-bold tracking-tight">{t(SETTINGS_SECTION_META[sectionId].title)}</h2>
              <p className="mt-1.5 text-sm leading-6 text-[var(--muted-foreground)]">
                {t(SETTINGS_SECTION_META[sectionId].description)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                disabled={isBusy("config-defaults")}
                onClick={onReset}
                size="sm"
                variant="ghost"
              >
                {isBusy("config-defaults") ? <Loader2 className="animate-spin" size={15} /> : <RotateCcw size={15} />}
                {t("기본 설정으로 초기화")}
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <div className="mx-auto grid w-full max-w-3xl gap-6">{children(sectionId)}</div>
          </div>
        </div>
      </section>
    </div>
  )
}
