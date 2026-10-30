import { t } from "../../../lib/i18n.ts"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BrainCircuit, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import {
  deleteUserMemoryItem,
  getUserMemory,
  saveUserMemoryItem,
  type UserMemoryItem,
  type UserMemoryMastery,
  type UserMemorySnapshot,
} from "../../../lib/api"
import { Badge } from "../../../shared/ui/badge.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

const KIND_LABELS: Record<UserMemoryItem["kind"], string> = {
  learning: "학습",
  profile: "선호",
  goal: "목표",
  episodic: "경험",
}

const KIND_ORDER: UserMemoryItem["kind"][] = ["learning", "profile", "goal", "episodic"]

function formatDateTime(value: string) {
  if (!value) return ""
  try {
    return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })
  } catch {
    return value
  }
}

function MasteryBar({ row }: { row: UserMemoryMastery }) {
  const percent = Math.round(Math.min(1, Math.max(0, row.mastery)) * 100)
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-40 shrink-0 truncate text-[var(--foreground)]" title={`${row.subject} · ${row.concept}`}>
        {row.subject} · {row.concept}
      </span>
      <div aria-label={t("{p0} 이해도 {p1}%", { p0: row.concept, p1: percent })} className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-[var(--muted)]" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={percent < 40 ? "h-full rounded-full bg-red-400" : percent < 70 ? "h-full rounded-full bg-amber-400" : "h-full rounded-full bg-emerald-500"}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums text-[var(--muted-foreground)]">{percent}%</span>
      <span className="w-16 shrink-0 text-right tabular-nums text-[var(--muted-foreground)]">
        {t("오답 ")}{row.mistake_count}
      </span>
    </div>
  )
}

export function MemorySettingsPanel() {
  const [snapshot, setSnapshot] = useState<UserMemorySnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState("")
  const [editDraft, setEditDraft] = useState("")
  const [creating, setCreating] = useState(false)
  const [createKind, setCreateKind] = useState<UserMemoryItem["kind"]>("profile")
  const [createDraft, setCreateDraft] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const next = await getUserMemory()
      setSnapshot(next)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const grouped = useMemo(() => {
    const items = snapshot?.items ?? []
    const map = new Map<UserMemoryItem["kind"], UserMemoryItem[]>()
    for (const kind of KIND_ORDER) {
      map.set(kind, [])
    }
    for (const item of items) {
      map.get(item.kind)?.push(item)
    }
    return map
  }, [snapshot])

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key)
    setError("")
    try {
      await action()
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy("")
    }
  }

  function beginEdit(item: UserMemoryItem) {
    setCreating(false)
    setEditingId(item.id)
    setEditDraft(item.content)
  }

  async function commitEdit(item: UserMemoryItem) {
    const content = editDraft.trim()
    if (!content) return
    await run(`edit-${item.id}`, () => saveUserMemoryItem({ action: "update", id: item.id, content }))
    setEditingId("")
    setEditDraft("")
  }

  async function commitCreate() {
    const content = createDraft.trim()
    if (!content) return
    await run("create", () => saveUserMemoryItem({ action: "create", kind: createKind, content }))
    setCreating(false)
    setCreateDraft("")
  }

  return (
    <div className="grid gap-4" data-ails-memory-panel="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <BrainCircuit className="text-[var(--brand)]" size={16} />
          <span>
            {snapshot?.enabled
              ? t("챗봇·채점에서 장기 보존 가치가 있는 정보만 자동으로 수집하며, 요청마다 관련된 기억만 검색해 사용합니다.")
              : t("사용자 메모리가 꺼져 있습니다. AI는 과거 학습 내용을 참고하지 않습니다.")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || busy !== ""}
            onClick={() => void refresh()}
          >
            {loading || busy === "" ? <RefreshCw size={14} /> : <Loader2 className="animate-spin" size={14} />}
            {t("새로고침")}</Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== ""}
            onClick={() => {
              setEditingId("")
              setCreating((current) => !current)
            }}
          >
            <Plus size={14} />
            {t("기억 추가")}</Button>
        </div>
      </div>
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </div>
      )}
      {creating && (
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            {KIND_ORDER.map((kind) => (
              <Button
                key={kind}
                size="sm"
                type="button"
                variant={createKind === kind ? "default" : "outline"}
                onClick={() => setCreateKind(kind)}
              >
                {t(KIND_LABELS[kind])}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              aria-label={t("새 기억 내용")}
              autoFocus
              onChange={(event) => setCreateDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitCreate()
              }}
              placeholder={t("예: 코드 예제로 설명하면 이해가 잘 됩니다")}
              value={createDraft}
            />
            <Button disabled={busy !== "" || !createDraft.trim()} onClick={() => void commitCreate()} size="sm">
              {busy === "create" ? <Loader2 className="animate-spin" size={14} /> : null}
              {t("저장")}</Button>
          </div>
        </div>
      )}
      <div className="grid gap-3">
        {KIND_ORDER.map((kind) => {
          const items = grouped.get(kind) ?? []
          if (items.length === 0) return null
          return (
            <section key={kind} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
              <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-4">
                <h4 className="text-sm font-semibold text-[var(--foreground)]">{t(KIND_LABELS[kind])}</h4>
                <Badge>{items.length}{t("개")}</Badge>
              </div>
              <div className="grid">
                {items.map((item) => (
                  <div className="border-t border-[var(--border)] px-5 py-3" data-memory-item-id={item.id} key={item.id}>
                    {editingId === item.id ? (
                      <div className="flex gap-2">
                        <Input
                          aria-label={t("기억 내용 수정")}
                          autoFocus
                          onChange={(event) => setEditDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitEdit(item)
                          }}
                          value={editDraft}
                        />
                        <Button disabled={busy !== ""} onClick={() => void commitEdit(item)} size="sm">
                          {busy === `edit-${item.id}` ? <Loader2 className="animate-spin" size={14} /> : null}
                          {t("저장")}</Button>
                        <Button onClick={() => setEditingId("")} size="sm" variant="ghost">
                          {t("취소")}</Button>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm leading-5 text-[var(--foreground)]">
                            {item.content}
                            {item.status === "compressed" && (
                              <span className="ml-2 align-middle text-[10px] text-[var(--muted-foreground)]">{t("요약됨")}</span>
                            )}
                          </p>
                          <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                            {item.subject || t("주제 없음")} {t("· 중요도 ")}{Math.round(item.importance * 100)}% · {formatDateTime(item.updated_at)}
                            {item.source === "summary" ? t(" · 자동 요약") : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            aria-label={t("기억 수정")}
                            disabled={busy !== ""}
                            onClick={() => beginEdit(item)}
                            size="icon"
                            variant="ghost"
                          >
                            {busy === `edit-${item.id}` ? <Loader2 className="animate-spin" size={14} /> : <Pencil size={14} />}
                          </Button>
                          <Button
                            aria-label={t("기억 삭제")}
                            disabled={busy !== ""}
                            onClick={() => void run(`delete-${item.id}`, () => deleteUserMemoryItem(item.id))}
                            size="icon"
                            variant="ghost"
                          >
                            {busy === `delete-${item.id}` ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
        {snapshot && snapshot.items.length === 0 && (
          <p className="px-1 text-sm text-[var(--muted-foreground)]">
            {t("아직 저장된 기억이 없습니다. 학습 대화와 문제 채점이 쌓이면 자동으로 정리됩니다.")}</p>
        )}
      </div>
      {snapshot && snapshot.mastery.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="px-5 pb-1 pt-4">
            <h4 className="text-sm font-semibold text-[var(--foreground)]">{t("학습 수준")}</h4>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              {t("문제 채점 결과를 반영해 천천히 갱신됩니다. 낮을수록 다시 볼 개념입니다.")}</p>
          </div>
          <div className="grid gap-2 border-t border-[var(--border)] px-5 py-4">
            {snapshot.mastery.slice(0, 12).map((row) => (
              <MasteryBar key={`${row.subject}:${row.concept}`} row={row} />
            ))}
          </div>
        </section>
      )}
      {snapshot?.storage && (
        <p className="px-1 text-[10px] leading-4 text-[var(--muted-foreground)]">
          {t("저장 위치: ")}{snapshot.storage.backend}
          {snapshot.storage.path ? ` (${snapshot.storage.path})` : ""} {t("· 임베딩: ")}{snapshot.storage.embedding_backend}
          {snapshot.storage.degraded ? t(" (오프라인 폴백)") : ""}
        </p>
      )}
    </div>
  )
}
