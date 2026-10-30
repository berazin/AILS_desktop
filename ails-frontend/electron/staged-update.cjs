const crypto = require("node:crypto")
const fs = require("node:fs/promises")
const path = require("node:path")
const { spawn } = require("node:child_process")

const INSTALL_STATES = { extracting: "preparing", tools: "preparing-tools", verifying: "verifying", ready: "ready" }
const STATUS_LOCK_RETRY_MS = 10000
const STATUS_LOCK_ERRORS = new Set(["EBUSY", "EPERM", "EACCES"])

async function writeJson(file, value) {
  const temporary = `${file}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx" })
  await fs.rename(temporary, file)
}

async function removeAbandonedStage(sessionDir, request) {
  const validated = JSON.parse(await fs.readFile(path.join(sessionDir, "validated.json"), "utf8"))
  if (validated.id !== request.id || validated.nonce !== request.nonce || validated.executablePath !== request.executablePath) return
  const installDir = path.dirname(request.executablePath)
  const stage = `${installDir}.ails-update-${request.id}`
  if ((await fs.realpath(path.dirname(stage))).toLowerCase() !== path.dirname(installDir).toLowerCase()) return
  const stat = await fs.lstat(stage)
  if (!stat.isDirectory() || stat.isSymbolicLink()) return
  await fs.rm(stage, { recursive: true })
}

async function beginStagedUpdate({ app, updater, info, onStatus, onReady, onError, spawnInstaller = spawn, executablePath = process.execPath }) {
  if (info?.ailsStagedInstall !== 1 && !info?.files?.some(file => file.ailsStagedInstall === 1)) {
    throw new Error("이 설치 파일은 앱을 유지하는 업데이트를 지원하지 않습니다. 새 설치 파일이 필요합니다.")
  }
  if (!updater.installerPath) throw new Error("다운로드한 업데이트 설치 파일을 찾을 수 없습니다.")
  const id = crypto.randomBytes(16).toString("hex")
  const nonce = crypto.randomBytes(32).toString("hex")
  const installDir = path.dirname(executablePath)
  const sessionDir = path.join(app.getPath("userData"), "update-sessions", id)
  await fs.mkdir(sessionDir, { recursive: true })
  const request = {
    protocol: 1, id, nonce, installDir, executablePath, parentPid: process.pid, expectedVersion: info.version,
  }
  await writeJson(path.join(sessionDir, "request.json"), request)
  let committed = false
  let stopped = false
  let polling = false
  let lastState = ""
  let statusReadErrorAt = null
  let pollTimer
  function stop() {
    stopped = true
    clearInterval(pollTimer)
  }
  function fail(error) {
    if (stopped) return
    stop()
    onError(error)
  }
  async function poll() {
    if (stopped || polling) return
    polling = true
    try {
      let content
      try {
        content = await fs.readFile(path.join(sessionDir, "status.json"), "utf8")
        statusReadErrorAt = null
      } catch (error) {
        if (error.code === "ENOENT") return
        if (STATUS_LOCK_ERRORS.has(error.code)) {
          statusReadErrorAt ??= Date.now()
          if (Date.now() - statusReadErrorAt < STATUS_LOCK_RETRY_MS) return
        }
        throw error
      }
      const status = JSON.parse(content)
      if (status.id !== id || status.protocol !== 1) throw new Error("업데이트 설치 상태가 일치하지 않습니다.")
      if (status.state === "error") return fail(new Error(status.error || "업데이트 설치가 중단되었습니다."))
      if (status.state !== lastState) {
        lastState = status.state
        if (INSTALL_STATES[status.state]) onStatus(INSTALL_STATES[status.state])
        if (status.state === "ready") onReady()
      }
    } catch (error) {
      fail(error)
    } finally {
      polling = false
    }
  }
  let child
  try {
    child = spawnInstaller(updater.installerPath, [
      "--updated", "/S", "--ails-staged-update", `--ails-update-session=${sessionDir}`, `--ails-update-id=${id}`, `/D=${installDir}`,
    ], {
      cwd: sessionDir, windowsHide: true, detached: true, stdio: "ignore",
      env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules") },
    })
  } catch (error) {
    throw new Error(`업데이트 설치를 시작하지 못했습니다: ${error.message}`)
  }
  child.once("error", fail)
  child.once("exit", (code) => {
    // Read a precise helper error before reporting a generic installer exit.
    void poll().finally(() => {
      if (!stopped && !committed) fail(new Error(code === 24
        ? "모든 사용자용 설치는 앱을 유지하는 자동 업데이트를 지원하지 않습니다. 현재 AILS는 계속 사용할 수 있습니다."
        : `업데이트 설치가 완료되지 않았습니다. 종료 코드: ${code}`))
    }).then(async () => {
      if (!committed) await removeAbandonedStage(sessionDir, request)
    }).catch(error => { if (error.code !== "ENOENT") console.error("[AILS updater cleanup]", error.message) })
  })
  child.unref()
  pollTimer = setInterval(() => { void poll() }, 250)
  pollTimer.unref?.()
  return {
    sessionDir,
    async commit() {
      if (stopped || lastState !== "ready") throw new Error("새 버전 설치가 아직 완료되지 않았습니다.")
      await writeJson(path.join(sessionDir, "commit.json"), { id, nonce })
      committed = true
    },
    dispose() {
      if (!committed) void fs.writeFile(path.join(sessionDir, "cancel"), "cancel").catch(() => {})
      stop()
    },
  }
}

async function cleanupCompletedUpdates(app, executablePath = process.execPath) {
  const root = path.join(app.getPath("userData"), "update-sessions")
  const installDir = path.dirname(executablePath)
  let entries
  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch (error) { if (error.code === "ENOENT") return; throw error }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue
    const sessionDir = path.join(root, entry.name)
    try {
      const request = JSON.parse(await fs.readFile(path.join(sessionDir, "request.json"), "utf8"))
      const status = JSON.parse(await fs.readFile(path.join(sessionDir, "status.json"), "utf8"))
      if (status.state !== "installed" || status.id !== entry.name || request.id !== entry.name
        || request.expectedVersion !== app.getVersion() || request.executablePath.toLowerCase() !== executablePath.toLowerCase()) continue
      // The new app's backend is already healthy when the updater starts.
      // Only remove the exact, same-volume rollback directory owned by this session.
      const backup = `${installDir}.ails-previous-${entry.name}`
      if (path.dirname(backup) !== path.dirname(installDir) || (await fs.realpath(path.dirname(backup))).toLowerCase() !== path.dirname(installDir).toLowerCase()) continue
      const stat = await fs.lstat(backup)
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue
      await fs.rm(backup, { recursive: true })
      await fs.rm(sessionDir, { recursive: true })
    } catch (error) {
      if (error.code !== "ENOENT") console.error("[AILS updater cleanup]", error.message)
    }
  }
}

module.exports = { beginStagedUpdate, cleanupCompletedUpdates }
