const { GITHUB_UPDATE_CONFIG } = require("./github-update-config.cjs")
const { beginStagedUpdate, cleanupCompletedUpdates } = require("./staged-update.cjs")
const { findFailedUpdate } = require("./failed-update-history.cjs")

const START_DELAY_MS = 10 * 1000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const INSTALL_DELAY_MS = 2000

function nonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function messageBox(dialog, parentWindow, options) {
  return parentWindow
    ? dialog.showMessageBox(parentWindow, options)
    : dialog.showMessageBox(options)
}

function createPrivateUpdater({
  app,
  dialog,
  getMainWindow,
  prepareToQuit,
  channel = null,
  autoUpdater = null,
  onStatusChange = null,
  stageUpdate = beginStagedUpdate,
}) {
  const updater = autoUpdater || require("electron-updater").autoUpdater
  let startTimer = null
  let intervalTimer = null
  let installTimer = null
  let installSession = null
  let installationStarting = false
  let disposed = false
  let checking = false
  let interactiveCheck = false
  let retryFailedInstall = false
  let status = {
    supported: Boolean(app.isPackaged),
    currentVersion: app.getVersion(),
    state: app.isPackaged ? "idle" : "unavailable",
    updateVersion: "",
    progressPercent: 0,
    transferredBytes: 0,
    totalBytes: 0,
    bytesPerSecond: 0,
    error: "",
  }

  function setStatus(patch) {
    status = { ...status, ...patch }
    onStatusChange?.({ ...status })
    const window = getMainWindow()
    if (window && !window.isDestroyed?.()) {
      window.setProgressBar?.(status.state === "downloading"
        ? status.totalBytes > 0 || status.progressPercent > 0 ? status.progressPercent / 100 : 2
        : ["downloaded", "ready"].includes(status.state) ? 1
          : ["preparing", "preparing-tools", "verifying", "installing"].includes(status.state) ? 2 : -1)
    }
  }

  updater.autoDownload = true
  // NSIS must not launch a second installer when the old app finally exits.
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  if (channel) updater.channel = channel
  // electron-updater's channel setter enables downgrades as a side effect.
  // Set this last so commercial/general channels cannot roll back versions.
  updater.allowDowngrade = false

  updater.on("checking-for-update", () => {
    setStatus({ state: "checking", error: "", progressPercent: 0 })
  })

  updater.on("update-not-available", async () => {
    checking = false
    setStatus({ state: "up-to-date", updateVersion: "", progressPercent: 0 })
    if (!interactiveCheck) return
    interactiveCheck = false
    await messageBox(dialog, getMainWindow(), {
      type: "info",
      title: "AILS 업데이트",
      message: "현재 최신 버전을 사용하고 있습니다.",
      detail: `설치된 버전: ${app.getVersion()}`,
      buttons: ["확인"],
      defaultId: 0,
      noLink: true,
    })
  })

  updater.on("update-available", (info) => {
    checking = false
    interactiveCheck = false
    setStatus({ state: "downloading", updateVersion: info?.version || "", progressPercent: 0 })
  })

  updater.on("download-progress", (progress) => {
    setStatus({
      state: "downloading",
      progressPercent: Math.min(100, nonNegativeNumber(progress?.percent)),
      transferredBytes: nonNegativeNumber(progress?.transferred),
      totalBytes: nonNegativeNumber(progress?.total),
      bytesPerSecond: nonNegativeNumber(progress?.bytesPerSecond),
    })
  })

  updater.on("update-downloaded", (info) => {
    if (installationStarting || installSession || installTimer || status.state === "installing" || disposed) return
    checking = false
    setStatus({ state: "downloaded", updateVersion: info?.version || status.updateVersion, progressPercent: 100 })
    installationStarting = true
    void (async () => {
      const failure = retryFailedInstall || typeof app.getPath !== "function"
        ? null : await findFailedUpdate(app, info?.version || status.updateVersion)
      if (failure) throw new Error(`이 버전의 이전 설치가 실패해 자동 재시도를 중지했습니다. 설정에서 업데이트를 다시 확인하면 재시도할 수 있습니다. ${failure.error}`)
      const session = await stageUpdate({
        app, updater, info,
        onStatus: (state) => { if (!disposed) setStatus({ state }) },
        onError: (error) => { if (!disposed) updater.emit("error", error) },
        onReady: () => {
          if (disposed || installTimer) return
          // All extraction, tool installation and verification has finished.
          // Keep the old app usable until this final, brief restart notice.
          installTimer = setTimeout(() => {
            installTimer = null
            void (async () => {
              await installSession.commit()
              setStatus({ state: "installing" })
              prepareToQuit()
              app.quit()
            })().catch(error => updater.emit("error", error))
          }, INSTALL_DELAY_MS)
          installTimer.unref?.()
        },
      })
      installationStarting = false
      if (disposed || status.state === "error") session.dispose()
      else installSession = session
    })().catch(error => {
      installationStarting = false
      if (!disposed) updater.emit("error", error)
    })
  })

  updater.on("error", async (error) => {
    if (installTimer) clearTimeout(installTimer)
    installTimer = null
    installSession?.dispose()
    installSession = null
    checking = false
    setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) })
    const shouldShow = interactiveCheck
    interactiveCheck = false
    console.error("[AILS updater]", error?.message || error)
    if (!shouldShow) return
    await messageBox(dialog, getMainWindow(), {
      type: "error",
      title: "AILS 업데이트 오류",
      message: "업데이트를 확인하거나 다운로드하지 못했습니다.",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["확인"],
      defaultId: 0,
      noLink: true,
    })
  })

  async function checkForUpdates({ interactive = false } = {}) {
    if (!app.isPackaged || checking || ["downloading", "downloaded", "preparing", "preparing-tools", "verifying", "ready", "installing"].includes(status.state)) return null
    checking = true
    interactiveCheck = interactive
    retryFailedInstall = interactive
    setStatus({ state: "checking", error: "", progressPercent: 0, transferredBytes: 0, totalBytes: 0, bytesPerSecond: 0 })
    try {
      updater.setFeedURL({
        provider: "github",
        owner: GITHUB_UPDATE_CONFIG.owner,
        repo: GITHUB_UPDATE_CONFIG.repo,
        private: false,
      })
      return await updater.checkForUpdates()
    } catch (error) {
      checking = false
      interactiveCheck = false
      setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) })
      console.error("[AILS updater]", error?.message || error)
      if (interactive) {
        await messageBox(dialog, getMainWindow(), {
          type: "error",
          title: "AILS 업데이트 오류",
          message: "업데이트를 확인하거나 다운로드하지 못했습니다.",
          detail: String(error?.message || error),
          buttons: ["확인"],
          defaultId: 0,
          noLink: true,
        })
      }
      return null
    }
  }

  function start() {
    void cleanupCompletedUpdates(app).catch(error => console.error("[AILS updater cleanup]", error.message))
    if (!app.isPackaged || startTimer || intervalTimer) return
    startTimer = setTimeout(() => {
      startTimer = null
      void checkForUpdates({ interactive: false })
    }, START_DELAY_MS)
    startTimer.unref?.()
    intervalTimer = setInterval(() => {
      void checkForUpdates({ interactive: false })
    }, CHECK_INTERVAL_MS)
    intervalTimer.unref?.()
  }

  function dispose() {
    disposed = true
    if (startTimer) clearTimeout(startTimer)
    if (intervalTimer) clearInterval(intervalTimer)
    if (installTimer) clearTimeout(installTimer)
    startTimer = null
    intervalTimer = null
    installTimer = null
    installSession?.dispose()
    installSession = null
  }

  async function getStatus() {
    return { ...status }
  }

  return { checkForUpdates, dispose, getStatus, start }
}

module.exports = { CHECK_INTERVAL_MS, INSTALL_DELAY_MS, START_DELAY_MS, createPrivateUpdater }
