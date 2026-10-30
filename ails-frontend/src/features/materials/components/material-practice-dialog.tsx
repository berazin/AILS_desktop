import { ChevronDown, ChevronRight, ClipboardList, Loader2, X } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"

import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { Badge } from "../../../shared/ui/badge.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

export type PracticeFileChoice = {
  path: string
  fileName: string
  title: string
  selected: boolean
  count: number
}

export type PracticeGroupChoice = {
  id: string
  label: string
  open: boolean
  files: PracticeFileChoice[]
}

export type PracticeDialogState = {
  target: { path: string; name: string }
  groups: PracticeGroupChoice[]
  pdfChoices: Array<{ path: string; title: string; selected: boolean }>
  contextSources: { chat: boolean; bookmarks: boolean; memory: boolean }
  result?: {
    count: number
    title: string
    excludedCount: number
    excludedReasons: string[]
    contextUsage: Record<string, Record<string, { status: string; used_count: number; skipped_reasons?: string[] }>>
  }
}

type MaterialPracticeDialogProps = {
  isBusy: (key: string) => boolean
  onCancel: () => void
  onSubmit: () => void | Promise<void>
  setState: Dispatch<SetStateAction<PracticeDialogState | null>>
  state: PracticeDialogState | null
}

export function MaterialPracticeDialog({ isBusy, onCancel, onSubmit, setState, state }: MaterialPracticeDialogProps) {
  if (!state) return null
  const busy = isBusy(`material-practice-${state.target.path}`)
  const sourceLabels = { chat: t("챗봇 대화"), bookmarks: t("PDF 북마크"), memory: t("메모리") }
  const reasonLabels: Record<string, string> = {
    no_pdf_selected: t("선택한 PDF 없음"),
    no_text: t("읽을 수 있는 내용 없음"),
    not_relevant: t("선택한 MD와 관련 없음"),
    account_unverified: t("계정 확인 불가"),
    memory_disabled: t("메모리 기능 꺼짐"),
    read_error: t("자료 읽기 실패"),
    budget_exceeded: t("참고 범위 초과"),
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("연습문제 생성")}</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {state.target.name}{t("에서 사용할 MD 파일과 문제 수를 선택하세요.")}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel} type="button">
            <X size={18} />
          </Button>
        </div>

        {state.result ? (
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-sm">
            <p className="font-semibold">{t("연습문제 {p0}개를 만들었습니다: {p1}", { p0: state.result.count, p1: state.result.title })}</p>
            {state.result.excludedCount > 0 && <p>{t("검증을 통과하지 못한 문제 {p0}개를 제외했습니다.", { p0: state.result.excludedCount })}</p>}
            {state.result.excludedReasons.slice(0, 3).map((reason, index) => <p className="text-[var(--muted-foreground)]" key={`${reason}-${index}`}>{reason}</p>)}
            <p className="font-medium">{t("참고 자료 사용 결과")}</p>
            {Object.entries(state.result.contextUsage).map(([path, usage]) => (
              <div className="rounded-lg border border-[var(--border)] p-2" key={path}>
                <p className="truncate font-medium" title={path}>{path.split(/[\\/]/).pop()}</p>
                {(["chat", "bookmarks", "memory"] as const).map((source) => {
                  const entry = usage[source]
                  if (!entry) return null
                  const reasons = (entry.skipped_reasons ?? []).map((reason) => reasonLabels[reason] ?? reason)
                  return <p className="text-[var(--muted-foreground)]" key={source}>{sourceLabels[source]}: {entry.used_count}{t("건 사용")} · {entry.status}{reasons.length > 0 ? ` (${reasons.join(", ")})` : ""}</p>
                })}
              </div>
            ))}
            <p className="text-[var(--muted-foreground)]">{t("학습 자료 목록에서 ‘풀기’를 눌러 시작하세요.")}</p>
          </div>
        ) : <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {state.groups.map((group, groupIndex) => (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]" key={group.id}>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium transition-colors hover:bg-[var(--muted)]"
                onClick={() =>
                  setState((current) =>
                    current
                      ? {
                          ...current,
                          groups: current.groups.map((nextGroup, nextGroupIndex) =>
                            nextGroupIndex === groupIndex ? { ...nextGroup, open: !nextGroup.open } : nextGroup,
                          ),
                        }
                      : current,
                  )
                }
                type="button"
              >
                {group.open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                <Badge>{group.files.length}</Badge>
              </button>
              {group.open && (
                <div className="space-y-2 border-t border-[var(--border)] p-2">
                  {group.files.map((item, fileIndex) => (
                    <label
                      className={cn(
                        "flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2 transition-colors",
                        item.selected && "border-[var(--brand)] bg-[var(--brand-soft)]",
                      )}
                      key={item.path}
                    >
                      <input
                        checked={item.selected}
                        className="h-4 w-4 accent-[var(--brand)]"
                        onChange={(event) => {
                          const checked = event.target.checked
                          setState((current) =>
                            current
                              ? {
                                  ...current,
                                  groups: current.groups.map((nextGroup, nextGroupIndex) =>
                                    nextGroupIndex === groupIndex
                                      ? {
                                          ...nextGroup,
                                          files: nextGroup.files.map((nextFile, nextFileIndex) =>
                                            nextFileIndex === fileIndex ? { ...nextFile, selected: checked } : nextFile,
                                          ),
                                        }
                                      : nextGroup,
                                  ),
                                }
                              : current,
                          )
                        }}
                        type="checkbox"
                      />
                      <span className="min-w-0 flex-1 truncate" title={item.fileName}>
                        {item.title}
                      </span>
                      <Input
                        className="h-9 w-20 bg-[var(--panel)] text-right"
                        disabled={!item.selected}
                        min={1}
                        max={100}
                        onChange={(event) => {
                          const nextCount = Number(event.target.value)
                          setState((current) =>
                            current
                              ? {
                                  ...current,
                                  groups: current.groups.map((nextGroup, nextGroupIndex) =>
                                    nextGroupIndex === groupIndex
                                      ? {
                                          ...nextGroup,
                                          files: nextGroup.files.map((nextFile, nextFileIndex) =>
                                            nextFileIndex === fileIndex
                                              ? {
                                                  ...nextFile,
                                                  count: Number.isFinite(nextCount) ? nextCount : nextFile.count,
                                                }
                                              : nextFile,
                                          ),
                                        }
                                      : nextGroup,
                                  ),
                                }
                              : current,
                          )
                        }}
                        type="number"
                        value={item.count}
                      />
                      <span className="text-sm text-[var(--muted-foreground)]">{t("문제")}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="mb-2 text-sm font-medium">{t("참고 PDF 선택 (0개 이상)")}</p>
            {state.pdfChoices.length === 0 ? <p className="text-xs text-[var(--muted-foreground)]">{t("선택할 PDF가 없습니다. MD만으로 만들 수 있습니다.")}</p> : (
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {state.pdfChoices.map((pdf, index) => <label className="flex items-center gap-2 text-sm" key={pdf.path}>
                  <input checked={pdf.selected} onChange={(event) => setState((current) => current ? { ...current, pdfChoices: current.pdfChoices.map((entry, entryIndex) => entryIndex === index ? { ...entry, selected: event.target.checked } : entry) } : current)} type="checkbox" />
                  <span className="truncate" title={pdf.path}>{pdf.title}</span>
                </label>)}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="mb-2 text-sm font-medium">{t("출제 비중 참고")}</p>
            {(["chat", "bookmarks", "memory"] as const).map((source) => <label className="flex items-center gap-2 py-1 text-sm" key={source}>
              <input checked={state.contextSources[source]} onChange={(event) => setState((current) => current ? { ...current, contextSources: { ...current.contextSources, [source]: event.target.checked } } : current)} type="checkbox" />
              {sourceLabels[source]}
            </label>)}
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">{t("켜 둔 대화·북마크·메모리 내용은 연습문제 생성 모델로 전달될 수 있습니다. 문제와 정답은 선택한 MD를 근거로 만듭니다.")}</p>
          </div>
        </div>}

        {!state.result && <div className="mt-4 rounded-xl bg-[var(--muted)] p-3 text-sm text-[var(--muted-foreground)]">
          {t("선택한 MD 파일을 각각 병렬 요청으로 처리하고, 파일별 지정 개수만큼 모아 하나의 MD 파일로 저장합니다.")}
        </div>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} type="button">
            {state.result ? t("닫기") : t("취소")}
          </Button>
          {!state.result && <Button disabled={busy} type="submit">
            {busy ? <Loader2 className="animate-spin" size={15} /> : <ClipboardList size={15} />}
            {t("생성")}
          </Button>}
        </div>
      </form>
    </div>
  )
}
