// The hidden IME textarea belongs to an established editing caret. Reaching it
// through browser Tab navigation would scroll to a stale caret (initially page 1).
export function installCanvasKeyboardFocus(scroll: HTMLElement, page: HTMLElement) {
  const input = page.querySelector<HTMLTextAreaElement>('.ce-inputarea')!
  input.tabIndex = -1
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region')
  scroll.setAttribute('aria-label', 'DOCX 문서 본문 (Enter 키로 편집)')
  const activate = (event: KeyboardEvent) => {
    if (event.target !== scroll || event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey) return
    event.preventDefault()
    input.focus({ preventScroll: true })
  }
  scroll.addEventListener('keydown', activate)
  return () => scroll.removeEventListener('keydown', activate)
}
