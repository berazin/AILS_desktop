import { createStudio } from '@rhwp/editor'
import { officeRequest } from '../../lib/api/office.ts'
import type { OfficeMount } from './types.ts'

export const mountRhwp: OfficeMount = async (container, bytes, name, changed, options) => {
  const url = options.studioUrl ?? (await officeRequest<{ url: string }>('studio', {})).url
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('로컬 한글 편집기만 사용할 수 있습니다.')
  const channel = crypto.randomUUID()
  parsed.searchParams.set('ails-origin', window.location.origin)
  parsed.searchParams.set('ails-channel', channel)
  const observer = new MutationObserver(() => {
    const frame = container.querySelector('iframe')
    frame?.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame?.setAttribute('allow', 'clipboard-read; clipboard-write')
  })
  observer.observe(container, { childList: true })
  let studio: Awaited<ReturnType<typeof createStudio>>
  try { studio = await createStudio(container, { studioUrl: parsed.href, plugins: ['hwpctrl'], chrome: { menu: false }, requestTimeoutMs: 60000 }) } finally { observer.disconnect() }
  try { await studio.loadFile(bytes.slice().buffer, name) } catch (error) { studio.destroy(); throw error }
  let sequence = (await studio.getDocumentState()).changeSeq
  let disposed = false, polling = false
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const receive = (event: MessageEvent) => {
    if (event.origin !== parsed.origin || event.source !== container.querySelector('iframe')?.contentWindow || event.data?.channel !== channel) return
    if (event.data.type === 'dirty') changed()
    if (event.data.type === 'save') container.dispatchEvent(new CustomEvent('ails:office-save', { bubbles: true, detail: { copy: event.data.copy } }))
    if (event.data.type === 'result') {
      const item = pending.get(event.data.request)
      if (item) { clearTimeout(item.timer); pending.delete(event.data.request); if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve() }
    }
  }
  window.addEventListener('message', receive)
  // The SDK event is currently emitted for agent transactions, not all typing.
  const poll = setInterval(async () => {
    if (disposed || polling) return
    polling = true
    try { const state = await studio.getDocumentState(); if (!disposed && state.changeSeq !== sequence) { sequence = state.changeSeq; changed() } } catch { /* A failed state poll must not become an unhandled rejection. */ } finally { polling = false }
  }, 500)
  return {
    synchronize: async () => { const state = await studio.getDocumentState(); if (state.changeSeq !== sequence) { sequence = state.changeSeq; changed() } },
    saved: async path => { await studio.notifySaved(path.split(/[\\/]/).pop()) },
    serialize: async () => /\.hwpx$/i.test(name) ? studio.exportHwpx() : studio.exportHwp(),
    text: async () => String(await studio.hwpctrl.call('GetTextFile', ['TEXT', '']) ?? ''),
    selection: async () => ({ text: String(await studio.hwpctrl.call('GetTextFile', ['TEXT', 'saveblock']) ?? ''), target: JSON.stringify(await studio.getSelectionContext()) }),
    replaceSelection: text => new Promise<void>((resolve, reject) => {
      const request = crypto.randomUUID()
      const timer = setTimeout(() => { pending.delete(request); reject(new Error('한글 편집기 응답 시간이 초과되었습니다.')) }, 10000)
      pending.set(request, { resolve, reject, timer })
      container.querySelector('iframe')?.contentWindow?.postMessage({ channel, type: 'replace', request, text }, parsed.origin)
    }),
    command: async name => { const result = await studio.commands.execute(name === 'find' ? 'edit:find' : `edit:${name}`, {}, { allowDialog: true }); if (!result.ok) throw new Error(result.message ?? result.reason) },
    destroy: () => { disposed = true; clearInterval(poll); window.removeEventListener('message', receive); pending.forEach(item => { clearTimeout(item.timer); item.reject(new Error('문서가 닫혔습니다.')) }); studio.destroy() },
  }
}
