import { icon } from './icons.js'
const api = window.ailsDesktop.api
const $ = id => document.getElementById(id)
const documents = new Map()
const editableKinds = new Set(['md', 'ipynb', 'docx', 'xlsx', 'csv', 'hwp', 'hwpx', 'html', 'htm'])
const newTab = $('new-tab')
let active, generation = 0, dispose = () => {}, upgrading = false
let preparation, historyIndex = -1
const history = []
for (const node of document.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon))
function status(message = '') { $('status').textContent = message; $('status').hidden = !message }
function prepare() {
  if (!preparation) {
    document.documentElement.dataset.workspacePreparation = 'starting'
    preparation = api.prepare_viewer_workspace().then(() => {
      document.documentElement.dataset.workspacePreparation = 'ready'
    }).catch(error => {
      preparation = undefined
      document.documentElement.dataset.workspacePreparation = 'failed'
      throw error
    })
  }
  return preparation
}
function prepareAfterPaint() {
  // Two animation frames let Chromium present the document before spawning
  // Python/Vite. Do not mount another app, navigate, focus, or change selection.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    void prepare().catch(error => console.warn('AILS background preparation:', error.message))
  }))
}
function closeTab(doc) {
  if (documents.size === 1) { void upgrade('home'); return }
  documents.delete(doc.token)
  if (active === doc) void show([...documents.values()].at(-1))
  else tabs()
}
function tabs() {
  const home = document.createElement('div')
  home.className = 'document-tab'; home.tabIndex = 0; home.setAttribute('role', 'tab'); home.setAttribute('aria-selected', 'false')
  home.append(icon('home'), '홈'); home.onclick = () => { void upgrade('home') }
  home.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); home.click() } }
  $('tabs').replaceChildren(home, ...[...documents.values()].map(doc => {
    const button = document.createElement('div')
    button.className = 'document-tab'; button.tabIndex = 0; button.setAttribute('role', 'tab')
    button.title = doc.path; button.dataset.tabId = doc.path; button.setAttribute('aria-selected', String(doc === active))
    const title = document.createElement('span'); title.className = 'tab-title'; title.textContent = doc.kind === 'pdf' ? doc.name.replace(/\.pdf$/i, '') : doc.name
    const close = document.createElement('button'); close.className = 'tab-close'; close.ariaLabel = `${doc.name} 탭 닫기`; close.append(icon('close'))
    close.onclick = event => { event.stopPropagation(); closeTab(doc) }
    button.append(icon('file'), title, close)
    button.onclick = () => { if (active !== doc) void show(doc) }
    button.onkeydown = event => { if (event.target === button && ['Enter', ' '].includes(event.key)) { event.preventDefault(); button.click() } }
    button.onauxclick = event => { if (event.button === 1) { event.preventDefault(); closeTab(doc) } }
    return button
  }), newTab)
  $('back').disabled = historyIndex <= 0
  $('forward').disabled = historyIndex >= history.length - 1
}
async function show(doc, fromHistory = false) {
  const version = ++generation
  dispose(); dispose = () => {}
  if (active) active.scrollTop = $('content').scrollTop
  if (!fromHistory && history[historyIndex] !== doc.token) { history.splice(historyIndex + 1); history.push(doc.token); historyIndex = history.length - 1 }
  active = doc; tabs(); status()
  document.title = `${doc.name} — AILS`
  delete document.documentElement.dataset.viewerReady
  $('content').replaceChildren()
  const pdf = doc.kind === 'pdf'
  $('edit').hidden = !pdf && !editableKinds.has(doc.kind)
  $('edit').replaceChildren(icon('edit'), pdf ? '주석' : '편집')
  $('edit').title = pdf ? 'PDF 주석 편집' : doc.kind === 'md' ? '문서 편집 (Tab)' : '문서 편집'
  $('content').classList.toggle('pdf-document', pdf)
  for (const id of ['pdf-controls', 'ocr', 'bookmarks', 'search', 'view-settings']) $(id).hidden = !pdf
  $('practice').hidden = !['pdf', 'md'].includes(doc.kind)
  const current = () => version === generation
  try {
    if (pdf) {
      const { openPdf } = await import('./pdf.js')
      if (!current()) return
      dispose = await openPdf(doc, $('content'), current, status)
    } else {
      const { renderDocument } = await import('./formats.js')
      await renderDocument(doc, $('content'), current)
    }
    if (!current()) return
    await new Promise(requestAnimationFrame)
    document.documentElement.dataset.viewerReady = doc.path
    $('content').scrollTop = doc.scrollTop || 0
    prepareAfterPaint()
  } catch (error) {
    if (current()) { status(`파일을 표시하지 못했습니다: ${error.message}`); prepareAfterPaint() }
  }
}
async function upgrade(feature) {
  if (upgrading) return
  upgrading = true; status('AILS 기능을 준비하고 있습니다…')
  try {
    await prepare()
    const snapshot = () => {
      const ordered = [...documents.values()].filter(doc => doc !== active)
      if (active) ordered.push(active)
      return { documents: ordered.map(doc => ({ token: doc.token, page: doc.page || 1, zoom: doc.zoom, feature: doc === active ? feature : undefined })) }
    }
    // Keep reading while the actual document/tool paints behind this view. If
    // the user changes page or tab meanwhile, present that latest state instead.
    while (upgrading) {
      const state = snapshot()
      const result = await api.open_viewer_workspace(state)
      if (JSON.stringify(state) !== JSON.stringify(snapshot())) continue
      document.body.inert = true
      if (!await api.commit_viewer_workspace(result.id)) throw new Error('화면 전환을 완료하지 못했습니다. 다시 시도해 주세요.')
      return
    }
  } catch (error) {
    upgrading = false; document.body.inert = false; status(`기능을 준비하지 못했습니다: ${error.message}`)
  }
}
for (const node of document.querySelectorAll('[data-feature]')) node.onclick = () => { closeMenus(); void upgrade(node.dataset.feature) }
function closeMenus() { $('more-menu').hidden = true; $('pdf-settings').hidden = true; $('more').setAttribute('aria-expanded', 'false') }
$('more').onclick = () => {
  const open = $('more-menu').hidden; closeMenus(); $('more-menu').hidden = !open; $('more').setAttribute('aria-expanded', String(open))
  if (open) $('more-menu').querySelector('button:not([hidden])')?.focus()
}
$('view-settings').onclick = () => { closeMenus(); $('pdf-settings').hidden = false; $('more').setAttribute('aria-expanded', 'true') }
$('close-settings').onclick = closeMenus
document.addEventListener('pointerdown', event => { if (!event.target.closest('.menu-container')) closeMenus() })
document.addEventListener('keydown', event => {
  if (event.isComposing) return
  if (event.key === 'Escape') { closeMenus(); $('content').focus() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && active?.kind === 'pdf') { event.preventDefault(); void upgrade('search') }
  if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    && active?.kind === 'md' && (event.target === document.body || event.target === $('content') || $('content').contains(event.target))
    && !event.target.closest('input,textarea,select,button,a,[contenteditable=true]')) {
    event.preventDefault(); void upgrade('edit')
  }
  if (!$('more-menu').hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = [...$('more-menu').querySelectorAll('button:not([hidden])')]
    const index = items.indexOf(document.activeElement)
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
})
function navigate(delta) {
  while (historyIndex + delta >= 0 && historyIndex + delta < history.length) {
    historyIndex += delta
    const doc = documents.get(history[historyIndex])
    if (doc) { void show(doc, true); return }
  }
  tabs()
}
$('back').onclick = () => navigate(-1)
$('forward').onclick = () => navigate(1)
$('titlebar').ondblclick = event => { if (!event.target.closest('button,[role=tab]')) void api.maximize() }
api.on_viewer_workspace_requested(() => { void upgrade() })
for (const id of ['minimize', 'maximize', 'close']) $(id).onclick = () => api[id]()
document.addEventListener('click', event => {
  const link = event.target.closest('a[href]')
  if (!link) return
  event.preventDefault()
  if (/^(https:|mailto:)/i.test(link.href)) void api.open_external_url(link.href)
})
api.on_external_document(async request => {
  try {
    const item = await api.get_viewer_document(request.path)
    const existing = documents.get(item.token)
    const doc = existing || { ...item, page: 1, zoom: 1 }
    documents.set(doc.token, doc)
    await show(doc)
  } catch (error) { status(error.message) }
  finally { await api.ack_external_document(request.id) }
})
void api.external_documents_ready()
