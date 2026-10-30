export interface QuestionEditContext extends EventTarget {
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
  updateText(start: number, end: number, text: string): void
  updateSelection(start: number, end: number): void
  updateControlBounds(bounds: DOMRect): void
  updateSelectionBounds(bounds: DOMRect): void
  updateCharacterBounds(start: number, bounds: DOMRect[]): void
}

export type QuestionReader = HTMLElement & { editContext?: QuestionEditContext | null }
export type QuestionContextConstructor = new (options?: { text?: string; selectionStart?: number; selectionEnd?: number }) => QuestionEditContext
export type QuestionCharacterBoundsEvent = Event & { rangeStart: number; rangeEnd: number }
export type QuestionTextFormatEvent = Event & { getTextFormats(): { rangeStart: number; rangeEnd: number }[] }
export type QuestionRect = { left: number; top: number; width: number; height: number }
export type QuestionCompositionLayout = { caret: QuestionRect; underlines: QuestionRect[] } | null

export function questionTextEntry(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-ails-question-entry='true']"))
}

export function questionReaderTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-ails-question-reader='true']"))
}
