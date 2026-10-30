"use strict"

const { spawn } = require("node:child_process")

/** Save/close guards run before this. Give domain services time to release their
 * own workers, with a process-tree fallback for a blocked native operation. */
function closeBackend(child, { timeoutMs = 6000, platform = process.platform, spawnProcess = spawn } = {}) {
  if (child?.closeBackend) return child.closeBackend()
  if (!child || !child.pid || child.exitCode !== null || child.signalCode) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    let timer
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.removeListener("exit", finish)
      child.removeListener("error", finish)
      resolve()
    }
    const force = () => {
      if (done) return
      clearTimeout(timer)
      if (platform === "win32" && child.pid) {
        const killer = spawnProcess("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true })
        killer.once("exit", finish)
        killer.once("error", () => { child.kill(); finish() })
      } else {
        child.kill("SIGKILL")
      }
    }
    child.once("exit", finish)
    child.once("error", finish)
    timer = setTimeout(force, timeoutMs)
    if (child.stdin && !child.stdin.destroyed) {
      child.stdin.on("error", () => undefined)
      child.stdin.end("shutdown\n")
    } else {
      force()
    }
  })
}

module.exports = { closeBackend }
