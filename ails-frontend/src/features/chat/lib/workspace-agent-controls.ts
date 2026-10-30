import { t } from "../../../lib/i18n.ts"

const WORKSPACE_AGENT_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[role='button']",
  "[contenteditable='true']",
].join(",")

type WorkspaceAgentControl = {
  control_id: string
  label: string
  kind: string
  disabled: boolean
  value?: string
}

function workspaceAgentHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function workspaceAgentDomPath(element: HTMLElement) {
  const parts: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== document.body && parts.length < 8) {
    const parentElement: HTMLElement | null = current.parentElement
    const index = parentElement ? Array.from(parentElement.children).indexOf(current) : 0
    parts.push(`${current.tagName.toLowerCase()}:${index}`)
    current = parentElement
  }
  return parts.reverse().join("/")
}

function workspaceAgentControlLabel(element: HTMLElement) {
  const fieldLabel = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    ? element.labels?.[0]?.textContent
    : ""
  return [
    element.getAttribute("aria-label"),
    fieldLabel,
    element.getAttribute("title"),
    element.getAttribute("placeholder"),
    element.getAttribute("name"),
    element.textContent,
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .find(Boolean)
    ?.slice(0, 160) || element.tagName.toLocaleLowerCase()
}

function workspaceAgentControlKind(element: HTMLElement) {
  if (element instanceof HTMLInputElement) return `input:${element.type || "text"}`
  if (element instanceof HTMLTextAreaElement) return "textarea"
  if (element instanceof HTMLSelectElement) return "select"
  if (element.isContentEditable) return "editable"
  if (element instanceof HTMLAnchorElement) return "link"
  return "button"
}

function workspaceAgentControlDisabled(element: HTMLElement) {
  return (
    (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
    && element.disabled
  ) || element.getAttribute("aria-disabled") === "true"
}

function workspaceAgentControlValue(element: HTMLElement) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return undefined
  const secretHint = [
    element.type,
    element.id,
    element.getAttribute("name"),
    element.getAttribute("autocomplete"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
  ].join(" ").toLocaleLowerCase()
  if (/(password|secret|token|api.?key|비밀번호|암호|키)/i.test(secretHint)) return undefined
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
    return element.checked ? "true" : "false"
  }
  return element.value.slice(0, 500)
}

export function collectWorkspaceAgentControls(query = "") {
  const controls: WorkspaceAgentControl[] = []
  const byId = new Map<string, HTMLElement>()
  const normalizedQuery = query.trim().toLocaleLowerCase()
  for (const element of document.querySelectorAll<HTMLElement>(WORKSPACE_AGENT_CONTROL_SELECTOR)) {
    if (element.closest("[aria-hidden='true'], [inert]")) continue
    const style = window.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) continue
    const label = workspaceAgentControlLabel(element)
    const kind = workspaceAgentControlKind(element)
    if (normalizedQuery && !`${label} ${kind}`.toLocaleLowerCase().includes(normalizedQuery)) continue
    const signature = [
      element.tagName,
      element.id,
      element.getAttribute("name"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      label,
      workspaceAgentDomPath(element),
    ].join("|")
    const baseId = `control-${workspaceAgentHash(signature)}`
    let controlId = baseId
    let duplicate = 2
    while (byId.has(controlId)) {
      controlId = `${baseId}-${duplicate}`
      duplicate += 1
    }
    const value = workspaceAgentControlValue(element)
    controls.push({
      control_id: controlId,
      label,
      kind,
      disabled: workspaceAgentControlDisabled(element),
      ...(value === undefined ? {} : { value }),
    })
    byId.set(controlId, element)
  }
  return { controls, byId }
}

export function setWorkspaceAgentControlValue(element: HTMLElement, value: string) {
  if (workspaceAgentControlDisabled(element)) throw new Error(t("현재 비활성화된 컨트롤입니다."))
  if (element instanceof HTMLInputElement && element.type === "file") {
    throw new Error(t("파일 입력은 activate_workspace_control로 파일 선택 창을 열어 사용자가 선택해야 합니다."))
  }
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
    const checked = ["true", "1", "on", "yes", t("선택")].includes(value.trim().toLocaleLowerCase())
    if (element.checked !== checked) element.click()
    return
  }
  if (element instanceof HTMLSelectElement) {
    const option = Array.from(element.options).find((item) => item.value === value || item.text.trim() === value.trim())
    if (!option) throw new Error(t("선택 컨트롤에서 요청한 값을 찾지 못했습니다."))
    element.value = option.value
    element.dispatchEvent(new Event("change", { bubbles: true }))
    return
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    if (setter) setter.call(element, value)
    else element.value = value
    element.dispatchEvent(new Event("input", { bubbles: true }))
    element.dispatchEvent(new Event("change", { bubbles: true }))
    return
  }
  if (element.isContentEditable) {
    element.textContent = value
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
    return
  }
  throw new Error(t("값을 설정할 수 있는 컨트롤이 아닙니다."))
}
