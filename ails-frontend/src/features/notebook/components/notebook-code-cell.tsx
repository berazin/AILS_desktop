import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react"
import Prism from "prismjs"
import "prismjs/components/prism-python.js"
import { cn } from "../../../lib/utils.ts"

interface NotebookCodeCellProps {
  initialValue: string
  isRunBusy?: boolean
  isActive?: boolean
  onChange?: (nextValue: string) => void
  onRun?: () => void | Promise<unknown>
  onAdvance?: () => void
  onInsertBelow?: () => void
  onActiveChange?: () => void
}

export const NotebookCodeCell = React.memo(function NotebookCodeCell({
  initialValue,
  isRunBusy,
  isActive,
  onChange,
  onRun,
  onAdvance,
  onInsertBelow,
  onActiveChange,
}: NotebookCodeCellProps) {
  const [code, setCode] = useState(initialValue)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    setCode(initialValue)
  }, [initialValue])

  const highlightedHtml = React.useMemo(() => {
    try {
      return Prism.highlight(code || "", Prism.languages.python, "python")
    } catch {
      return code
    }
  }, [code])

  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (preRef.current) {
      preRef.current.scrollTop = e.currentTarget.scrollTop
      preRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.max(38, textarea.scrollHeight)}px`
  }, [])

  useEffect(() => {
    adjustTextareaHeight()
  }, [code, adjustTextareaHeight])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setCode(next)
    onChange?.(next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const textarea = textareaRef.current
    if (!textarea) return

    const { selectionStart, selectionEnd, value } = textarea

    // 1. Shift + Enter: 셀 실행 후 다음 셀로 이동 (Jupyter 기본)
    if (e.shiftKey && e.key === "Enter") {
      e.preventDefault()
      onRun?.()
      onAdvance?.()
      return
    }

    // 2. Ctrl + Enter / Cmd + Enter: 셀 실행 후 포커스 유지
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault()
      onRun?.()
      return
    }

    // 3. Alt + Enter: 셀 실행 후 아래에 새 셀 삽입
    if (e.altKey && e.key === "Enter") {
      e.preventDefault()
      void Promise.resolve(onRun?.()).then(() => onInsertBelow?.())
      return
    }

    // 4. Escape: 편집 모드 해제 (명령 모드로 전환)
    if (e.key === "Escape") {
      textarea.blur()
      return
    }

    // 5. Tab / Shift + Tab: 들여쓰기 및 내어쓰기
    if (e.key === "Tab") {
      e.preventDefault()

      if (selectionStart !== selectionEnd) {
        // 여러 줄 블록 선택 들여쓰기/내어쓰기
        const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1
        const lineEnd = value.indexOf("\n", selectionEnd)
        const effectiveEnd = lineEnd === -1 ? value.length : lineEnd
        const selectedBlock = value.slice(lineStart, effectiveEnd)
        const lines = selectedBlock.split("\n")

        if (e.shiftKey) {
          // 내어쓰기 (최대 4칸 공백 제거)
          const updatedLines = lines.map((l) => l.replace(/^ {1,4}/, ""))
          const updatedBlock = updatedLines.join("\n")
          const diff = selectedBlock.length - updatedBlock.length
          const nextValue = value.slice(0, lineStart) + updatedBlock + value.slice(effectiveEnd)
          setCode(nextValue)
          onChange?.(nextValue)
          requestAnimationFrame(() => {
            textarea.setSelectionRange(selectionStart, Math.max(selectionStart, selectionEnd - diff))
          })
        } else {
          // 들여쓰기 (각 줄에 4칸 공백 추가)
          const updatedLines = lines.map((l) => `    ${l}`)
          const updatedBlock = updatedLines.join("\n")
          const diff = updatedBlock.length - selectedBlock.length
          const nextValue = value.slice(0, lineStart) + updatedBlock + value.slice(effectiveEnd)
          setCode(nextValue)
          onChange?.(nextValue)
          requestAnimationFrame(() => {
            textarea.setSelectionRange(selectionStart + 4, selectionEnd + diff)
          })
        }
      } else {
        // 단일 커서
        if (e.shiftKey) {
          // Shift+Tab: 커서 앞쪽 최대 4칸 공백 제거
          const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1
          const linePrefix = value.slice(lineStart, selectionStart)
          const match = linePrefix.match(/( {1,4})$/)
          if (match) {
            const cutCount = match[1].length
            const nextValue = value.slice(0, selectionStart - cutCount) + value.slice(selectionStart)
            setCode(nextValue)
            onChange?.(nextValue)
            requestAnimationFrame(() => {
              textarea.setSelectionRange(selectionStart - cutCount, selectionStart - cutCount)
            })
          }
        } else {
          // Tab: 커서 위치에 4칸 공백 삽입
          const nextValue = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`
          setCode(nextValue)
          onChange?.(nextValue)
          requestAnimationFrame(() => {
            textarea.setSelectionRange(selectionStart + 4, selectionStart + 4)
          })
        }
      }
      return
    }

    // 6. Enter: 자동 들여쓰기 (이전 줄 들여쓰기 유지 + 콜론 뒤 4칸 추가)
    if (e.key === "Enter") {
      e.preventDefault()
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1
      const currentLine = value.slice(lineStart, selectionStart)
      const indentMatch = currentLine.match(/^\s*/)
      let indent = indentMatch ? indentMatch[0] : ""

      // 콜론(:)으로 끝나면 추가 들여쓰기 4칸
      if (currentLine.trimEnd().endsWith(":")) {
        indent += "    "
      }

      const insertText = `\n${indent}`
      const nextValue = value.slice(0, selectionStart) + insertText + value.slice(selectionEnd)
      setCode(nextValue)
      onChange?.(nextValue)
      requestAnimationFrame(() => {
        const newPos = selectionStart + insertText.length
        textarea.setSelectionRange(newPos, newPos)
      })
      return
    }

    // 7. Backspace: 4칸 공백 단위 삭제
    if (e.key === "Backspace" && selectionStart === selectionEnd) {
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1
      const linePrefix = value.slice(lineStart, selectionStart)
      if (linePrefix.length > 0 && /^\s+$/.test(linePrefix) && linePrefix.length % 4 === 0) {
        e.preventDefault()
        const nextValue = value.slice(0, selectionStart - 4) + value.slice(selectionStart)
        setCode(nextValue)
        onChange?.(nextValue)
        requestAnimationFrame(() => {
          textarea.setSelectionRange(selectionStart - 4, selectionStart - 4)
        })
      }
    }
  }

  return (
    <div
      className={cn(
        "notebook-code-cell-container relative rounded-[2px] border transition-all",
        "bg-[#f7f7f7] dark:bg-[#1e1e1e]",
        isFocused
          ? "border-[#2196f3] shadow-[0_0_0_1px_#2196f3]"
          : isActive
            ? "border-[#a0c5e8] dark:border-[#2d4f7c]"
            : "border-[#cfcfcf] dark:border-[#383838]",
      )}
      onClick={() => {
        onActiveChange?.()
        textareaRef.current?.focus()
      }}
    >
      {/* Jupyter 스타일 Python Syntax Highlighting 프리뷰 레이어 */}
      <pre
        ref={preRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none m-0 overflow-hidden break-words whitespace-pre-wrap px-3 py-2 font-mono text-[13px] leading-5",
          "jupyter-syntax-layer select-none",
        )}
        style={{
          fontFamily: "Consolas, 'Courier New', Courier, monospace",
          tabSize: 4,
        }}
        dangerouslySetInnerHTML={{
          __html: `${highlightedHtml}${code.endsWith("\n") ? " " : ""}`,
        }}
      />

      {/* 실시간 편집을 위한 투명 오버레이 텍스트에어리어 */}
      <textarea
        ref={textareaRef}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className={cn(
          "absolute inset-0 h-full w-full resize-none overflow-hidden break-words whitespace-pre-wrap border-0 bg-transparent px-3 py-2 font-mono text-[13px] leading-5 outline-none",
          "text-transparent selection:bg-[#b5d5ff] dark:selection:bg-[#264f78]",
          "caret-black dark:caret-white",
        )}
        disabled={isRunBusy}
        onBlur={() => setIsFocused(false)}
        onChange={handleChange}
        onFocus={() => {
          setIsFocused(true)
          onActiveChange?.()
        }}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        spellCheck={false}
        style={{
          fontFamily: "Consolas, 'Courier New', Courier, monospace",
          tabSize: 4,
        }}
        value={code}
      />
    </div>
  )
})
