const { contextBridge, ipcRenderer } = require("electron")
let latest = { x: 0, y: 0, visible: false }
const listeners = new Set()
ipcRenderer.on("ails-tabs:droplet-motion", (_event, motion) => {
  if (!motion || !Number.isFinite(motion.x) || !Number.isFinite(motion.y)) return
  latest = { x: motion.x, y: motion.y, visible: motion.visible === true }
  for (const listener of listeners) listener(latest)
})
contextBridge.exposeInMainWorld("ailsTabDragVisual", {
  onMotion: callback => {
    if (typeof callback !== "function") return () => {}
    listeners.add(callback); callback(latest)
    return () => listeners.delete(callback)
  },
})
