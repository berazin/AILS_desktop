export function focusInlineMaterialSearch() {
  const input = Array.from(document.querySelectorAll<HTMLInputElement>("[data-ails-material-search-inline] input"))
    .find((element) => element.getClientRects().length > 0)
  if (!input) return false
  input.focus({ preventScroll: true })
  return true
}
