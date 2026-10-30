import * as monaco from 'monaco-editor'
import '../../shared/lib/monaco-loader.ts'
import iconv from 'iconv-lite'
import { Buffer } from 'buffer'
import { officeRequest } from '../../lib/api/office.ts'
import { htmlPreview } from './html-preview.ts'
import type { OfficeMount } from './types.ts'

export const mountHtml: OfficeMount = async (container, bytes, path, changed, options) => {
  let encoding = 'utf8'
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { encoding = 'cp949' }
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191
  const toolbar = document.createElement('div'); toolbar.className = 'office-format-options'
  const toggle = document.createElement('button'); toggle.textContent = '미리보기 숨기기'; toolbar.append(toggle)
  const notice = document.createElement('span'); notice.textContent = '스크립트와 외부 통신을 차단한 HTML 미리보기'; toolbar.append(notice)
  const split = document.createElement('div'); split.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden'
  const code = document.createElement('div'); code.style.cssText = 'width:50%;min-width:180px;min-height:0'
  const divider = document.createElement('input'); divider.type = 'range'; divider.min = '20'; divider.max = '80'; divider.value = '50'; divider.setAttribute('aria-label', 'HTML 편집기 너비'); toolbar.append(divider)
  const preview = document.createElement('iframe'); preview.title = 'HTML 미리보기'; preview.setAttribute('sandbox', ''); preview.referrerPolicy = 'no-referrer'; preview.style.cssText = 'flex:1;min-width:0;border:0;background:white'
  divider.oninput = () => { code.style.width = divider.value + '%' }
  toggle.onclick = () => { const hidden = preview.hidden = !preview.hidden; code.style.width = hidden ? '100%' : divider.value + '%'; toggle.textContent = hidden ? '미리보기 표시' : '미리보기 숨기기' }
  split.append(code, preview); container.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'; container.append(toolbar, split)
  const editor = monaco.editor.create(code, { value: iconv.decode(Buffer.from(bytes), encoding), language: 'html', theme: options.dark ? 'vs-dark' : 'vs', automaticLayout: true, minimap: { enabled: false }, occurrencesHighlight: 'off' })
  let version = 0, disposed = false, timer: ReturnType<typeof setTimeout> | undefined
  const update = async () => { const current = ++version; const value = await htmlPreview(editor.getValue(), relative => officeRequest('resource', { path, relative })); if (!disposed && current === version) preview.srcdoc = value }
  await update()
  const sub = editor.onDidChangeModelContent(() => { changed(); clearTimeout(timer); timer = setTimeout(() => { void update() }, 250) })
  return {
    // Monaco renders lines after creating its host. Wait for that first render,
    // then observe the bounded code pane rather than its oversized line layer.
    presentationElement: () => code.querySelector('.view-lines .view-line') ? code : null,
    serialize: async () => { const value = editor.getValue(); const encoded = iconv.encode(value, encoding); if (iconv.decode(encoded, encoding) !== value) throw new Error('원본 인코딩으로 표현할 수 없는 문자가 있습니다. UTF-8 변환이 필요합니다.'); return new Uint8Array(bom ? Buffer.concat([Buffer.from([239,187,191]), encoded]) : encoded) },
    text: async () => editor.getValue(),
    selection: async () => ({ text: editor.getModel()?.getValueInRange(editor.getSelection()!) ?? '', target: JSON.stringify(editor.getSelection()) }),
    replaceSelection: async value => { const range = editor.getSelection(); if (!range) throw new Error('영역을 선택하세요.'); editor.pushUndoStop(); editor.executeEdits('ails-ai', [{ range, text: value }]); editor.pushUndoStop() },
    command: name => editor.trigger('ails', name === 'find' ? 'actions.find' : name, null),
    destroy: () => { disposed = true; clearTimeout(timer); sub.dispose(); const model = editor.getModel(); editor.dispose(); model?.dispose(); container.replaceChildren() },
  }
}
