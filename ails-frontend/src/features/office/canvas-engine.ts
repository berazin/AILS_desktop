import Editor, { RowFlex, ElementType, ListType, ListStyle, EditorZone } from '@hufe921/canvas-editor'
import DOMPurify from 'dompurify'
import { importDocx } from './docx-import.ts'
import { installCanvasKeyboardFocus } from './canvas-keyboard-focus.ts'
import plugin from './vendor/canvas-docx-plugin.js'
import type { OfficeMount } from './types.ts'

type DocxCommands = { executeImportDocx(options: { arrayBuffer: ArrayBuffer }): Promise<void>; executeExportDocx(options: { fileName: string }): Promise<Blob> }
export const mountCanvas: OfficeMount = async (container, bytes, name, changed) => {
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'
  const toolbar = document.createElement('div'); toolbar.className = 'office-format-options'
  const page = document.createElement('div'); page.className = 'office-canvas-page'
  const scroll = document.createElement('div'); scroll.className = 'office-canvas-scroll'; scroll.append(page)
  container.append(toolbar, scroll)
  const editor = new Editor(page, { main: [{ value: '' }] }, { width: 794, height: 1123, margins: [72, 72, 72, 72], defaultFont: 'sans-serif' })
  plugin(editor)
  const command = editor.command as typeof editor.command & DocxCommands
  // Upstream importer uses Mammoth HTML. Sanitize before it enters the editor DOM.
  const setHTML = command.executeSetHTML.bind(command)
  command.executeSetHTML = data => setHTML({ ...data, main: DOMPurify.sanitize(data.main ?? '', { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['srcset'] }) })
  try {
    const imported = await importDocx(bytes)
    command.executeSetHTML(imported.html)
    command.executeSetPaperMargin(imported.margins)
  } catch (error) { editor.destroy(); throw error }
  // Seed undo history, then initialize insertion commands without focusing the
  // page-1 IME textarea. Importing HTML alone does not create an undo baseline.
  command.executeForceUpdate({ isSubmitHistory: true })
  command.executeFocus({ range: { startIndex: 0, endIndex: 0 }, isMoveCursorToVisible: false })
  const removeKeyboardFocus = installCanvasKeyboardFocus(scroll, page)
  const button = (label: string, run: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onmousedown = e => e.preventDefault(); b.onclick = run; toolbar.append(b) }
  const font = document.createElement('select'); font.setAttribute('aria-label', '글꼴')
  for (const name of ['sans-serif', 'serif', '맑은 고딕', '바탕']) { const option = document.createElement('option'); option.textContent = name; font.append(option) }
  font.onchange = () => command.executeFont(font.value); toolbar.append(font)
  const size = document.createElement('input'); size.type = 'number'; size.value = '16'; size.min = '8'; size.max = '96'; size.setAttribute('aria-label', '글자 크기'); size.style.width = '60px'
  size.onchange = () => command.executeSize(Math.min(96, Math.max(8, Number(size.value)))); toolbar.append(size)
  button('굵게', () => command.executeBold()); button('기울임', () => command.executeItalic()); button('밑줄', () => command.executeUnderline())
  button('왼쪽', () => command.executeRowFlex(RowFlex.LEFT)); button('가운데', () => command.executeRowFlex(RowFlex.CENTER)); button('오른쪽', () => command.executeRowFlex(RowFlex.RIGHT))
  button('표', () => command.executeInsertTable(3, 3)); button('페이지 나누기', () => command.executePageBreak())
  button('글머리표', () => command.executeList(ListType.UL, ListStyle.DISC)); button('번호 목록', () => command.executeList(ListType.OL, ListStyle.DECIMAL))
  button('머리말', () => command.executeSetZone(EditorZone.HEADER)); button('본문', () => command.executeSetZone(EditorZone.MAIN)); button('꼬리말', () => command.executeSetZone(EditorZone.FOOTER))
  const margin = document.createElement('input'); margin.type = 'number'; margin.value = String(command.getOptions().margins[0]); margin.min = '20'; margin.max = '180'; margin.style.width = '65px'; margin.setAttribute('aria-label', '페이지 여백 (픽셀)')
  margin.onchange = () => { const value = Math.min(180, Math.max(20, Number(margin.value))); command.executeSetPaperMargin([value, value, value, value]); changed() }; toolbar.append('여백', margin)
  const entry = document.createElement('input'); entry.placeholder = '검색어 / LaTeX 수식'; entry.setAttribute('aria-label', '검색어 또는 LaTeX 수식'); toolbar.append(entry)
  button('수식 삽입', () => { if (entry.value) command.executeInsertElementList([{ type: ElementType.LATEX, value: entry.value }]) })
  button('찾기', () => command.executeSearch(entry.value))
  button('이미지', () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = () => { const file = input.files?.[0]; if (!file || file.size > 10 * 1024 * 1024) return
      const reader = new FileReader(); reader.onload = () => command.executeImage({ value: String(reader.result), width: 300, height: 200 }); reader.readAsDataURL(file) }; input.click()
  })
  // Import and undo-baseline renders notify on a later microtask. Compare the
  // document value so those notifications cannot mark an untouched file dirty;
  // actual text and formatting edits still notify, including the first edit.
  let previousValue = JSON.stringify(command.getValue())
  editor.listener.contentChange = () => {
    const value = JSON.stringify(command.getValue())
    if (value === previousValue) return
    previousValue = value
    changed()
  }
  return {
    presentationElement: () => page.querySelector('canvas'),
    serialize: async () => new Uint8Array(await (await command.executeExportDocx({ fileName: name })).arrayBuffer()),
    text: async () => { const text = command.getText(); return [text.header, text.main, text.footer].filter(Boolean).join('\n') },
    selection: async () => ({ text: command.getRangeText() }),
    replaceSelection: async text => { command.executeInsertElementList([{ value: text }]) },
    command: action => { if (action === 'undo') command.executeUndo(); else if (action === 'redo') command.executeRedo(); else { entry.focus(); command.executeSearch(entry.value) } },
    destroy: () => { removeKeyboardFocus(); editor.destroy(); container.replaceChildren() },
  }
}
