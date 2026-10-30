const { contextBridge, ipcRenderer } = require('electron')
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
// The reader does not need workspace credentials or the workspace's broad API.
contextBridge.exposeInMainWorld('ailsDesktop', { api: {
  minimize: () => invoke('ails-window:minimize'),
  maximize: () => invoke('ails-window:maximize'),
  close: () => invoke('ails-viewer:close'),
  open_external_url: url => invoke('ails-compliance:open-url', url),
  get_viewer_document: path => invoke('ails-viewer:document', path),
  convert_viewer_document: token => invoke('ails-viewer:convert', token),
  prepare_viewer_workspace: () => invoke('ails-viewer:prepare'),
  open_viewer_workspace: payload => invoke('ails-viewer:workspace', payload),
  commit_viewer_workspace: id => invoke('ails-viewer:commit', id),
  on_viewer_workspace_requested: callback => subscribe('ails-viewer:workspace-requested', callback),
  external_documents_ready: () => invoke('ails-viewer:documents-ready'),
  ack_external_document: id => invoke('ails-viewer:documents-ack', id),
  on_external_document: callback => subscribe('ails-documents:open', callback),
} })
