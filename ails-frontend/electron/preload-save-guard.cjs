function createCloseSaveSubscription(ipcRenderer) {
  const callbacks = new Set()
  let previousInert = false, locked = false
  const unlock = () => {
    if (locked) document.documentElement.inert = previousInert
    locked = false
  }
  ipcRenderer.on("ails-window:save-cancelled", unlock)
  ipcRenderer.on("ails-window:save-request", (_event, id) => {
    if (!locked) previousInert = document.documentElement.inert
    locked = true
    // End the native composition before disabling focus. Editors can apply the
    // final compositionend value on the next task (Canvas Editor does this).
    document.activeElement?.blur?.()
    // Do not accept another keystroke between the final snapshot and window close.
    document.documentElement.inert = true
    void new Promise(resolve => setTimeout(resolve, 0)).then(() =>
      Promise.allSettled([...callbacks].map(callback => Promise.resolve().then(callback)))
    ).then(results => {
      const failed = results.find(result => result.status === "rejected")
      if (failed) unlock()
      ipcRenderer.send("ails-window:save-result", id, failed ? String(failed.reason).slice(0, 1200) : "")
    })
  })
  return callback => {
    if (typeof callback !== "function") return () => undefined
    callbacks.add(callback)
    ipcRenderer.send("ails-window:save-register", true)
    return () => {
      callbacks.delete(callback)
      if (!callbacks.size) ipcRenderer.send("ails-window:save-register", false)
    }
  }
}
module.exports = { createCloseSaveSubscription }
