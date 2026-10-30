const { BrowserWindow } = require('electron')

function createStartupWindow() {
  const window = new BrowserWindow({ width: 520, height: 300, resizable: false, title: 'AILS', backgroundColor: '#f7f9fc', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const html = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:16px system-ui;padding:38px;color:#243249;background:#f7f9fc}h1{font-size:28px}p{line-height:1.6}</style><h1>AILS</h1><p>작업공간을 준비하고 있습니다.</p><p>준비가 끝나면 자동으로 열립니다.</p>'
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  return window
}

module.exports = { createStartupWindow }
