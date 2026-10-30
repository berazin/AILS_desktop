// Local integration only. No filesystem, API token, or arbitrary commands.
(() => {
  const query = new URLSearchParams(location.search)
  const origin = query.get('ails-origin'), channel = query.get('ails-channel')
  if (!origin || !channel || window.parent === window) return
  const send = (type, extra = {}) => parent.postMessage({ channel, type, ...extra }, origin === 'null' ? '*' : origin)
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopImmediatePropagation(); send('save', { copy: event.shiftKey })
    }
  }, true)
  for (const name of ['beforeinput', 'paste', 'cut']) document.addEventListener(name, () => send('dirty'), true)
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== origin || event.data?.channel !== channel || event.data.type !== 'replace') return
    const text = event.data.text
    if (typeof text !== 'string' || text.length > 100000) return
    const textarea = document.querySelector('textarea')
    if (!textarea) { send('result', { request: event.data.request, error: '편집 영역을 찾을 수 없습니다.' }); return }
    textarea.focus()
    const transfer = new DataTransfer(); transfer.setData('text/plain', text)
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    send('dirty')
    setTimeout(() => send('result', { request: event.data.request }), 50)
  })
})()
