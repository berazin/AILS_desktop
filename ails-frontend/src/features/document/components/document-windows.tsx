import { t } from "../../../lib/i18n.ts"
import { useCallback, useState, useEffect, useRef, type CSSProperties, type ReactNode, type PointerEvent } from "react"
import { FileText, X } from "lucide-react"

import { cn } from "../../../lib/utils.ts"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { Button } from "../../../shared/ui/button.tsx"

export type DocumentWindowItem = {
  id: string
  title: string
  content: string
  file_path: string
}

type ReportWindowProps = {
  report: DocumentWindowItem
  onClose: () => void
  onOpenLocalMarkdown: (href: string) => void
  onSelectReport: () => void
}

type LinkedMarkdownWindowProps = {
  document: DocumentWindowItem
  onClose: () => void
  onOpenInViewer: () => void
  onOpenLocalMarkdown: (href: string) => void
}

type FloatingChatbotWindowProps = {
  className?: string
  hidden: boolean
  position: { x: number; y: number }
  size: { width: number; height: number }
  storageKey?: string
  transformOrigin: string
  windowKind?: "chatbot" | "debug-trace"
  children: ReactNode
}

export function ReportWindow({
  report,
  onClose,
  onOpenLocalMarkdown,
  onSelectReport,
}: ReportWindowProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
      <section className="flex h-[min(900px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] resize overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{report.title}</h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{report.file_path}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={onSelectReport}>
                <FileText size={14} />
                {t("본문 선택")}</Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X size={18} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            <MarkdownViewer content={report.content} onOpenLocalMarkdown={onOpenLocalMarkdown} />
          </div>
        </div>
      </section>
    </div>
  )
}

export function LinkedMarkdownWindow({
  document,
  onClose,
  onOpenInViewer,
  onOpenLocalMarkdown,
}: LinkedMarkdownWindowProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="flex h-[min(860px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] resize overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{document.title}</h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{document.file_path}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={onOpenInViewer}>
                <FileText size={14} />
                {t("뷰어로 열기")}</Button>
              <Button variant="ghost" size="icon" aria-label={t("연결 문서 닫기")} onClick={onClose}>
                <X size={18} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
            <MarkdownViewer content={document.content} onOpenLocalMarkdown={onOpenLocalMarkdown} />
          </div>
        </div>
      </section>
    </div>
  )
}

export function FloatingChatbotWindow({
  className,
  hidden,
  position,
  size,
  storageKey = "ails-chatbot",
  transformOrigin,
  windowKind = "chatbot",
  children,
}: FloatingChatbotWindowProps) {
  // 로컬 좌표 및 크기 상태 관리 (localStorage 복원 우선 적용)
  const [localPos, setLocalPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(`${storageKey}-pos`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          return parsed
        }
      }
    } catch {
      return position
    }
    return position
  })

  const [localSize, setLocalSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = localStorage.getItem(`${storageKey}-size`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.width === "number" && typeof parsed.height === "number") {
          return parsed
        }
      }
    } catch {
      return size
    }
    return size
  })

  // 부모로부터 최초 위치/크기나 업데이트가 들어왔을 때 로컬 스토리지에 저장된 값이 없으면 동기화
  useEffect(() => {
    const hasSavedPos = localStorage.getItem(`${storageKey}-pos`)
    const hasSavedSize = localStorage.getItem(`${storageKey}-size`)
    if (!hasSavedPos) setLocalPos(position)
    if (!hasSavedSize) setLocalSize(size)
  }, [position, size, storageKey])

  // 드래그 및 리사이즈 추적용 Ref
  const interactionRef = useRef({
    isDragging: false,
    resizeDirection: "", // n, s, w, e, nw, ne, sw, se 중 하나
    startX: 0,
    startY: 0,
    startPos: { x: 0, y: 0 },
    startSize: { width: 0, height: 0 },
    pointerId: -1,
  })
  const localPosRef = useRef(localPos)
  const localSizeRef = useRef(localSize)
  const storageSaveFrameRef = useRef<number | null>(null)
  const pendingStorageSaveRef = useRef<{ pos?: { x: number; y: number }; size?: { width: number; height: number } }>({})

  useEffect(() => {
    localPosRef.current = localPos
  }, [localPos])

  useEffect(() => {
    localSizeRef.current = localSize
  }, [localSize])

  const flushWindowStorage = useCallback(() => {
    if (storageSaveFrameRef.current !== null) {
      window.cancelAnimationFrame(storageSaveFrameRef.current)
      storageSaveFrameRef.current = null
    }
    const pending = pendingStorageSaveRef.current
    pendingStorageSaveRef.current = {}
    if (pending.pos) {
      localStorage.setItem(`${storageKey}-pos`, JSON.stringify(pending.pos))
    }
    if (pending.size) {
      localStorage.setItem(`${storageKey}-size`, JSON.stringify(pending.size))
    }
  }, [storageKey])

  function scheduleWindowStorage(next: { pos?: { x: number; y: number }; size?: { width: number; height: number } }) {
    pendingStorageSaveRef.current = { ...pendingStorageSaveRef.current, ...next }
    if (storageSaveFrameRef.current !== null) return
    storageSaveFrameRef.current = window.requestAnimationFrame(flushWindowStorage)
  }

  useEffect(() => {
    return () => {
      flushWindowStorage()
    }
  }, [flushWindowStorage])

  // 포인터 다운 핸들러
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // 닫기(X) 등 버튼 클릭이나 텍스트 입력창 클릭 시 드래그 동작 무시
    const target = e.target as HTMLElement
    if (target.closest("button") || target.closest("input") || target.closest("textarea")) {
      return
    }

    const resizeDir = target.getAttribute("data-ails-resize-direction")
    const dragHandle = target.closest("[data-ails-drag-handle='true']")

    if (resizeDir || dragHandle) {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)

      const state = interactionRef.current
      state.pointerId = e.pointerId
      state.startX = e.clientX
      state.startY = e.clientY
      state.startPos = { ...localPos }
      state.startSize = { ...localSize }

      if (resizeDir) {
        state.resizeDirection = resizeDir
      } else if (dragHandle) {
        state.isDragging = true
      }
    }
  }

  // 포인터 이동 핸들러
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const state = interactionRef.current
    if (state.pointerId !== e.pointerId) return

    const deltaX = e.clientX - state.startX
    const deltaY = e.clientY - state.startY

    // 1. 드래그 이동 (AILS 창 밖으로도 유연하게 나갈 수 있게 제한 해제, 최소 잡기 영역 40px 유지)
    if (state.isDragging) {
      const nextX = Math.max(-localSize.width + 40, Math.min(window.innerWidth - 40, state.startPos.x + deltaX))
      const nextY = Math.max(0, Math.min(window.innerHeight - 40, state.startPos.y + deltaY))
      
      const newPos = { x: nextX, y: nextY }
      localPosRef.current = newPos
      setLocalPos(newPos)
      scheduleWindowStorage({ pos: newPos })
    }

    // 2. 8방향 리사이즈 처리
    const dir = state.resizeDirection
    if (dir) {
      const minWidth = 320
      const minHeight = 240
      const maxWidth = window.innerWidth
      const maxHeight = window.innerHeight

      let nextWidth = state.startSize.width
      let nextHeight = state.startSize.height
      let nextX = state.startPos.x
      let nextY = state.startPos.y

      // 가로(W, E) 크기 조절 및 위치 보정
      if (dir.includes("e")) {
        nextWidth = Math.max(minWidth, Math.min(maxWidth, state.startSize.width + deltaX))
      } else if (dir.includes("w")) {
        const rawWidth = state.startSize.width - deltaX
        nextWidth = Math.max(minWidth, Math.min(state.startSize.width + state.startPos.x - 8, rawWidth))
        if (rawWidth >= minWidth) {
          nextX = state.startPos.x + deltaX
        }
      }

      // 세로(N, S) 크기 조절 및 위치 보정
      if (dir.includes("s")) {
        nextHeight = Math.max(minHeight, Math.min(maxHeight, state.startSize.height + deltaY))
      } else if (dir.includes("n")) {
        const rawHeight = state.startSize.height - deltaY
        nextHeight = Math.max(minHeight, Math.min(state.startSize.height + state.startPos.y - 8, rawHeight))
        if (rawHeight >= minHeight) {
          nextY = state.startPos.y + deltaY
        }
      }

      const newSize = { width: nextWidth, height: nextHeight }
      const newPos = { x: nextX, y: nextY }
      
      localSizeRef.current = newSize
      localPosRef.current = newPos
      setLocalSize(newSize)
      setLocalPos(newPos)
      
      scheduleWindowStorage({ size: newSize, pos: newPos })
    }
  }

  // 포인터 업 핸들러
  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const state = interactionRef.current
    if (state.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // 이미 릴리즈
      }
      
      // 드래그 종료 시 최종 위치와 크기를 다시 확인하여 localStorage에 영구 보존
      scheduleWindowStorage({ pos: localPosRef.current, size: localSizeRef.current })
      flushWindowStorage()

      state.isDragging = false
      state.resizeDirection = ""
      state.pointerId = -1
    }
  }

  const style = {
    height: localSize.height,
    left: localPos.x,
    top: localPos.y,
    transformOrigin,
    width: localSize.width,
  } satisfies CSSProperties

  return (
    <div
      data-ails-chatbot-window={windowKind === "chatbot" ? "true" : undefined}
      data-ails-window-kind={windowKind}
      className={cn(
        "fixed z-40 transition-[opacity,transform,visibility] duration-200 ease-out select-none",
        hidden ? "pointer-events-none invisible scale-95 opacity-0" : "visible scale-100 opacity-100",
        className,
      )}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* 바깥쪽 섀도우 및 프레임 래퍼 */}
      <div className="relative h-full w-full bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* 8방향 리사이즈 감지 바 레이아웃 오버레이 */}
        {/* 상 (N) */}
        <div className="absolute top-0 left-2.5 right-2.5 h-1.5 z-50 cursor-ns-resize hover:bg-white/5 transition-colors" data-ails-resize-direction="n" title={t("상단 드래그하여 세로 크기 조절")} />
        {/* 하 (S) */}
        <div className="absolute bottom-0 left-2.5 right-2.5 h-1.5 z-50 cursor-ns-resize hover:bg-white/5 transition-colors" data-ails-resize-direction="s" title={t("하단 드래그하여 세로 크기 조절")} />
        {/* 좌 (W) */}
        <div className="absolute left-0 top-2.5 bottom-2.5 w-1.5 z-50 cursor-ew-resize hover:bg-white/5 transition-colors" data-ails-resize-direction="w" title={t("좌측 드래그하여 가로 크기 조절")} />
        {/* 우 (E) */}
        <div className="absolute right-0 top-2.5 bottom-2.5 w-1.5 z-50 cursor-ew-resize hover:bg-white/5 transition-colors" data-ails-resize-direction="e" title={t("우측 드래그하여 가로 크기 조절")} />
        
        {/* 모서리 리사이저 (대각선 커서 피드백) */}
        {/* 좌상 (NW) */}
        <div className="absolute top-0 left-0 w-2.5 h-2.5 z-[55] cursor-nwse-resize hover:bg-white/10 active:bg-white/20 transition-colors" data-ails-resize-direction="nw" />
        {/* 우상 (NE) */}
        <div className="absolute top-0 right-0 w-2.5 h-2.5 z-[55] cursor-nesw-resize hover:bg-white/10 active:bg-white/20 transition-colors" data-ails-resize-direction="ne" />
        {/* 좌하 (SW) */}
        <div className="absolute bottom-0 left-0 w-2.5 h-2.5 z-[55] cursor-nesw-resize hover:bg-white/10 active:bg-white/20 transition-colors" data-ails-resize-direction="sw" />
        {/* 우하 (SE) */}
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 z-[55] cursor-nwse-resize hover:bg-white/10 active:bg-white/20 transition-colors" data-ails-resize-direction="se" />

        {/* 챗봇 콘텐츠 본체 (텍스트 드래그 복사를 위해 select-text 부여) */}
        <div className="h-full w-full select-text">
          {children}
        </div>
      </div>
    </div>
  )
}

type ChatAnswerWindowProps = {
  body?: ReactNode
  message: {
    id: string
    role: string
    content: string
    title?: string
  }
  onClose: () => void
}

export function ChatAnswerWindow({ message, onClose, body }: ChatAnswerWindowProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
    } catch {
      const textarea = document.createElement("textarea")
      textarea.value = message.content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand("copy")
      document.body.removeChild(textarea)
    }
  }

  const handleOpenExternal = () => {
    const title = message.title ?? t("챗봇 답변")
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1.5rem;line-height:1.7;color:#1a1a1a;}pre{background:#f5f5f5;padding:1rem;border-radius:6px;overflow-x:auto;}code{font-family:monospace;font-size:.9em;}h1,h2,h3{margin-top:1.5em;}</style></head><body><h1>${title}</h1><pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;">${message.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    window.open(url, "_blank", "noopener")
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section className="flex h-[min(800px,calc(100vh-32px))] w-[min(900px,calc(100vw-32px))] resize overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{message.title ?? t("챗봇 답변")}</h2>
              <p className="truncate text-xs text-[var(--muted-foreground)]">{t("질문에 대한 챗봇의 상세 답변입니다.")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {t("복사")}</Button>
              <Button variant="outline" size="sm" onClick={handleOpenExternal}>
                {t("브라우저로 열기")}</Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X size={18} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7 select-text">
            {body ?? <MarkdownViewer content={message.content} />}
          </div>
        </div>
      </section>
    </div>
  )
}
