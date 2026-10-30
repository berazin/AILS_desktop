import { RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import type { ChatGPTUsageWindow } from "../../../lib/api/chatgpt.ts"
import { useChatGPTUsage } from "../hooks/use-chatgpt-usage.ts"

function period(minutes: number | null) {
  if (!minutes) return "사용 한도"
  if (minutes === 10080) return "주간"
  if (minutes % 1440 === 0) return `${minutes / 1440}일`
  if (minutes % 60 === 0) return `${minutes / 60}시간`
  return `${minutes}분`
}

function ResetTime({ timestamp, now }: { timestamp: number | null; now: number }) {
  if (!timestamp) return <span>초기화 시각 미제공</span>
  const difference = timestamp * 1000 - now
  const formatted = new Date(timestamp * 1000).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  if (difference <= 0) return <span>초기화 확인 중</span>
  const minutes = Math.ceil(difference / 60_000)
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60
  const relative = days ? `${days}일 ${hours}시간` : hours ? `${hours}시간 ${rest}분` : `${rest}분`
  return <time dateTime={new Date(timestamp * 1000).toISOString()} title={formatted}>{relative} 후 초기화 · {formatted}</time>
}

function WindowGauge({ window: item, now, fresh }: { window: ChatGPTUsageWindow; now: number; fresh: boolean }) {
  const valid = fresh && Number.isFinite(item.remaining_percent) && (!item.resets_at || item.resets_at * 1000 > now)
  const value = Math.round(Math.max(0, Math.min(100, item.remaining_percent)))
  const label = `${item.name === "codex" ? "" : item.name + " · "}${period(item.window_minutes)}`
  return <div className="min-w-0 flex-1 basis-44" data-usage-window={item.id}>
    <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
      <span className="truncate" title={label}>{label}</span>
      <span className="shrink-0 tabular-nums text-[var(--foreground)]">{valid ? `${value}% 남음` : "갱신 필요"}</span>
    </div>
    <div role="progressbar" aria-label={`${label} 남은 사용량`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={valid ? value : undefined} aria-valuetext={valid ? `${value}% 남음` : "사용량 갱신 필요"}
      className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
      {valid && <div className={`h-full rounded-full ${value <= 10 ? "bg-red-500" : value <= 25 ? "bg-amber-500" : "bg-[var(--brand)]"}`} style={{ width: `${value}%` }} />}
    </div>
    <div className="mt-1 break-words text-[10px] leading-4"><ResetTime timestamp={item.resets_at} now={now} /></div>
  </div>
}

export function ChatGPTUsageGauge({ busy = false }: { busy?: boolean }) {
  const { data, loading, error, refresh } = useChatGPTUsage(busy)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  const fresh = Boolean(data?.updated_at && now - data.updated_at * 1000 < 90_000)
  return <div className="w-full min-w-0 text-[var(--muted-foreground)]" data-chatgpt-usage>
    <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
      <span title="Codex에 로그인된 같은 이메일 계정의 한도입니다. 워크스페이스 또는 AILS 앱별 제한은 별도일 수 있습니다.">Codex 계정 한도</span>
      <button type="button" aria-label="ChatGPT 사용량 새로고침" title="사용량 새로고침" disabled={loading}
        onClick={() => void refresh()} className="rounded p-1 hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--brand)] disabled:opacity-50">
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
    {data?.available && data.windows.length > 0
      ? <div className="flex flex-wrap gap-x-4 gap-y-2">{data.windows.map(item => <WindowGauge key={item.id} window={item} now={now} fresh={fresh} />)}</div>
      : <div role="status" className="break-words text-[11px] leading-4">{loading ? "사용량 확인 중…" : data?.message || error || "사용량을 확인할 수 없습니다."}</div>}
  </div>
}
