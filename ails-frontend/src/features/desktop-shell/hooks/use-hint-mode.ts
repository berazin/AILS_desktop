import { useState } from "react"

import { t } from "../../../lib/i18n.ts"

export type HintItem = {
  id: string
  element: HTMLElement
  keySequence: string
  rect: { top: number; left: number }
}

type UseHintModeOptions = {
  setNotice: (message: string) => void
}

export function useHintMode({ setNotice }: UseHintModeOptions) {
  const [active, setActive] = useState(false)
  const [hints, setHints] = useState<HintItem[]>([])
  const [input, setInput] = useState("")

  function activate() {
    const clickables = Array.from(
      document.querySelectorAll("button, a, [role='button'], [data-ails-clickable='true']"),
    ) as HTMLElement[]

    const visibleClickables = clickables.filter((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false

      const isVisible =
        rect.top < window.innerHeight
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.right > 0
      if (!isVisible) return false

      const style = window.getComputedStyle(element)
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
    })

    const chars = "asdfgqwertzxcvhjkl"
    const nextHints: HintItem[] = []

    if (visibleClickables.length <= chars.length) {
      visibleClickables.forEach((element, index) => {
        const rect = element.getBoundingClientRect()
        nextHints.push({
          id: `hint-${index}`,
          element,
          keySequence: chars[index],
          rect: {
            top: rect.top + rect.height / 2,
            left: rect.left + rect.width / 2,
          },
        })
      })
    } else {
      let count = 0
      outerLoop: for (let first = 0; first < chars.length; first += 1) {
        for (let second = 0; second < chars.length; second += 1) {
          if (count >= visibleClickables.length) break outerLoop
          const element = visibleClickables[count]
          const rect = element.getBoundingClientRect()
          nextHints.push({
            id: `hint-${count}`,
            element,
            keySequence: chars[first] + chars[second],
            rect: {
              top: rect.top + rect.height / 2,
              left: rect.left + rect.width / 2,
            },
          })
          count += 1
        }
      }
    }

    setHints(nextHints)
    setInput("")
    setActive(true)
    setNotice(t("힌트 모드가 활성화되었습니다. 알파벳을 입력하세요 (ESC로 취소)"))
  }

  function handleKeyDown(event: globalThis.KeyboardEvent) {
    const key = event.key.toLowerCase()

    if (key === "escape") {
      event.preventDefault()
      event.stopPropagation()
      setActive(false)
      setNotice(t("힌트 모드를 종료했습니다."))
      return
    }

    if (key.length === 1 && /[a-z]/.test(key)) {
      event.preventDefault()
      event.stopPropagation()

      const nextInput = input + key
      setInput(nextInput)
      const matched = hints.filter((hint) => hint.keySequence.startsWith(nextInput))

      if (matched.length === 1 && matched[0].keySequence === nextInput) {
        const targetEl = matched[0].element
        targetEl.click()
        setActive(false)
        setNotice(t("선택된 버튼을 클릭했습니다."))
      } else if (matched.length === 0) {
        setActive(false)
        setNotice(t("일치하는 힌트가 없습니다."))
      }
    }
  }

  return { active, activate, handleKeyDown, hints, input }
}

export type HintModeController = ReturnType<typeof useHintMode>
