const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const readline = require("readline")

class WindowsSpeechBridge {
  constructor({ app, send }) {
    this.app = app
    this.send = send
    this.child = null
    this.pendingStart = null
  }

  executablePath() {
    return path.join(process.resourcesPath, "windows-speech", "AILS.WindowsSpeechHost.exe")
  }

  status() {
    const packagedIdentity = this.app.isPackaged && process.windowsStore
    const executable = this.executablePath()
    return {
      available: process.platform === "win32" && packagedIdentity && fs.existsSync(executable),
      engine: "Windows.Media.SpeechRecognition",
      language: "ko-KR",
      reason: packagedIdentity
        ? fs.existsSync(executable) ? "" : "Windows speech host is missing from this MSIX package."
        : "Windows online speech requires an MSIX package identity.",
    }
  }

  async start(language = "ko-KR") {
    const status = this.status()
    if (!status.available) throw new Error(status.reason)
    if (!this.child) this.spawnHost()
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingStart = null
        reject(new Error("Windows speech recognition did not start within 15 seconds."))
      }, 15_000)
      this.pendingStart = {
        resolve: (event) => {
          clearTimeout(timeout)
          this.pendingStart = null
          resolve({ started: true, engine: status.engine, language, event })
        },
        reject: (error) => {
          clearTimeout(timeout)
          this.pendingStart = null
          reject(error)
        },
      }
      try {
        this.write({ type: "start", language })
      } catch (error) {
        this.pendingStart.reject(error)
      }
    })
  }

  stop() {
    if (!this.child) return { stopped: true }
    this.write({ type: "stop" })
    return { stopped: true }
  }

  dispose() {
    const child = this.child
    this.child = null
    if (!child) return
    try {
      child.stdin.write(`${JSON.stringify({ type: "dispose" })}\n`)
      child.stdin.end()
    } catch {}
    setTimeout(() => {
      if (!child.killed) child.kill()
    }, 1000).unref()
  }

  spawnHost() {
    const child = spawn(this.executablePath(), [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child = child
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const event = JSON.parse(line)
        if (event.type === "started") this.pendingStart?.resolve(event)
        else if (event.type === "error") this.pendingStart?.reject(new Error(String(event.error || "Windows speech failed.")))
        this.send(event)
      } catch {}
    })
    child.stderr.on("data", (chunk) => this.send({ type: "error", error: String(chunk).trim() }))
    child.on("exit", (code) => {
      if (this.child === child) this.child = null
      const error = new Error(`Windows speech host exited with code ${code ?? "unknown"}.`)
      this.pendingStart?.reject(error)
      this.send({ type: "error", error: error.message })
    })
  }

  write(value) {
    if (!this.child?.stdin.writable) throw new Error("Windows speech host is not running.")
    this.child.stdin.write(`${JSON.stringify(value)}\n`)
  }
}

module.exports = { WindowsSpeechBridge }
