import { useEffect, useRef, useState, memo, type ReactNode } from "react"
import { Save, Plus, Play, Square, RotateCw, FastForward, ChevronDown } from "lucide-react"
import type { NotebookCellType } from "./notebook-utils.tsx"

interface NotebookToolbarProps {
  activeCellType: NotebookCellType
  hasRunBusy: boolean
  isRestarting?: boolean
  isSaveBusy?: boolean
  onSave: () => void
  onInsertBelow: () => void
  onInsertAbove?: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onRun: () => void
  onInterrupt: () => void
  onRestart: () => void
  onRestartAndRunAll: () => void
  onRunAll: () => void
  onDeleteCell: () => void
  onChangeCellType: (type: NotebookCellType) => void
  canPaste?: boolean
}

const actionClass = "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--muted)] disabled:pointer-events-none disabled:opacity-40"
function Action({ label, title, disabled, onClick, children }: { label: string; title?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={actionClass} aria-label={label} title={title ?? label} disabled={disabled} onClick={onClick}>{children}<span>{label}</span></button>
}

export const NotebookToolbar = memo(function NotebookToolbar(props: NotebookToolbarProps) {
  const [menu, setMenu] = useState("")
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setMenu("") }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu("") }
    document.addEventListener("mousedown", outside)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape) }
  }, [])
  const menus = [
    { label: "편집", items: [
      { label: "선택 셀 복사", action: props.onCopy },
      { label: "선택 셀 잘라내기", action: props.onCut, disabled: props.hasRunBusy },
      { label: "아래에 붙여넣기", action: props.onPaste, disabled: props.hasRunBusy || !props.canPaste },
      { label: "선택 셀 삭제", action: props.onDeleteCell, disabled: props.hasRunBusy },
    ] },
    { label: "커널", items: [
      { label: "커널 재시작 (변수 초기화)", action: props.onRestart, disabled: props.hasRunBusy },
      { label: "재시작 후 전체 실행", action: props.onRestartAndRunAll, disabled: props.hasRunBusy },
    ] },
  ]
  return <div ref={root} className="flex flex-wrap items-center gap-1 p-2 text-[var(--foreground)]" aria-label="노트북 도구 모음">
    <Action label={props.isSaveBusy ? "저장 중…" : "저장"} title="노트북 저장 (Ctrl+S)" onClick={props.onSave} disabled={props.isSaveBusy}><Save size={15} /></Action>
    <span className="mx-1 h-5 border-l border-[var(--border)]" />
    <Action label="위에 셀" onClick={props.onInsertAbove ?? (() => {})} disabled={props.hasRunBusy}><Plus size={15} /></Action>
    <Action label="아래에 셀" onClick={props.onInsertBelow} disabled={props.hasRunBusy}><Plus size={15} /></Action>
    <select aria-label="셀 종류" className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs" value={props.activeCellType} disabled={props.hasRunBusy} onChange={event => props.onChangeCellType(event.target.value as NotebookCellType)}>
      <option value="code">Code</option><option value="markdown">Markdown</option>
    </select>
    <span className="mx-1 h-5 border-l border-[var(--border)]" />
    <Action label="셀 실행" title="선택 코드 셀 실행 (Ctrl+Enter)" onClick={props.onRun} disabled={props.hasRunBusy || props.activeCellType !== "code"}><Play size={15} /></Action>
    <Action label="전체 실행" onClick={props.onRunAll} disabled={props.hasRunBusy}><FastForward size={15} /></Action>
    <Action label="중단" onClick={props.onInterrupt} disabled={!props.hasRunBusy || props.isRestarting}><Square size={13} /></Action>
    <Action label={props.isRestarting ? "재시작 중…" : "재시작"} title="커널 재시작: 메모리의 변수가 초기화됩니다" onClick={props.onRestart} disabled={props.hasRunBusy}><RotateCw size={15} /></Action>
    <div className="ml-auto flex items-center gap-1">
      {menus.map(item => <div key={item.label} className="relative">
        <button type="button" className={actionClass} aria-expanded={menu === item.label} onClick={() => setMenu(menu === item.label ? "" : item.label)}>{item.label}<ChevronDown size={13} /></button>
        {menu === item.label && <div className="absolute right-0 top-full z-50 mt-2 min-w-56 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-lg">
          {item.items.map(action => <button type="button" key={action.label} className={`${actionClass} w-full text-left`} disabled={action.disabled} onClick={() => { setMenu(""); action.action() }}>{action.label}</button>)}
        </div>}
      </div>)}
      <div className="relative"><button type="button" className={actionClass} aria-expanded={menu === "keys"} onClick={() => setMenu(menu === "keys" ? "" : "keys")}>단축키</button>
        {menu === "keys" && <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-6 shadow-lg">
          <p>Ctrl+S · 노트북 저장</p><p>Ctrl+Enter · 현재 셀 실행</p><p>Shift+Enter · 실행하고 다음 셀 선택</p><p>Alt+Enter · 실행 후 아래에 셀 추가</p><p>Tab / Shift+Tab · 들여쓰기 / 내어쓰기</p><p>Esc · 셀 입력 포커스 해제</p>
        </div>}
      </div>
    </div>
  </div>
})
