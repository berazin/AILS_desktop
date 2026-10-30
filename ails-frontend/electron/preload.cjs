const { contextBridge, ipcRenderer } = require("electron")
const { createCloseSaveSubscription } = require("./preload-save-guard.cjs")
const onBeforeClose = createCloseSaveSubscription(ipcRenderer)

const invokeWindow = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

// Fetched synchronously once at preload init so api.ts can attach the token
// to its very first requests without an async bootstrap round-trip.
const localApiToken = (() => {
  try {
    return String(ipcRenderer.sendSync("ails-config:get-local-api-token") || "")
  } catch {
    return ""
  }
})()

const backendPort = (() => {
  try {
    return Number(ipcRenderer.sendSync("ails-config:get-backend-port") || 0)
  } catch {
    return 0
  }
})()

contextBridge.exposeInMainWorld("ailsDesktop", {
  api: {
    startupGateway: true,
    has_initial_documents: () => Boolean(ipcRenderer.sendSync("ails-documents:pending")),
    initial_document_extension: () => String(ipcRenderer.sendSync("ails-documents:initial-extension") || ""),
    initial_document_path: () => String(ipcRenderer.sendSync("ails-documents:initial-path") || ""),
    startup_diagnostics_enabled: Boolean(process.env.AILS_STARTUP_DIAGNOSTICS),
    report_document_presented: kind => ipcRenderer.invoke("ails-startup:document-presented", kind),
    localApiToken,
    backendPort,
    minimize: () => invokeWindow("ails-window:minimize"),
    maximize: () => invokeWindow("ails-window:maximize"),
    is_maximized: () => invokeWindow("ails-window:is-maximized"),
    set_fullscreen: (fullscreen) => invokeWindow("ails-window:set-fullscreen", fullscreen === true),
    on_maximize_change: (callback) => {
      if (typeof callback !== "function") return () => undefined
      const listener = (_event, isMaximized) => callback(Boolean(isMaximized))
      ipcRenderer.on("ails-window:maximize-change", listener)
      return () => ipcRenderer.removeListener("ails-window:maximize-change", listener)
    },
    close: () => invokeWindow("ails-window:close"),
    quit: () => invokeWindow("ails-window:quit"),
    on_before_close: onBeforeClose,
    save_office_copy: path => invokeWindow("ails-dialog:save-office-copy", path),
    resize_window: (width, height, fixedPoint = "nw") =>
      invokeWindow("ails-window:resize", width, height, fixedPoint),
    get_update_status: () => invokeWindow("ails-update:status"),
    get_feedback_environment: () => invokeWindow("ails-feedback:environment"),
    check_for_updates: () => invokeWindow("ails-update:check"),
    open_external_url: (url) => invokeWindow("ails-compliance:open-url", url),
    open_auth_login_url: (url) => invokeWindow("ails-auth:open-login-url", url),
    get_windows_speech_status: () => invokeWindow("ails-voice:windows-status"),
    start_windows_speech: (language = "ko-KR") => invokeWindow("ails-voice:windows-start", language),
    stop_windows_speech: () => invokeWindow("ails-voice:windows-stop"),
    pick_python_executable: () => invokeWindow("ails-dialog:open-python"),
    open_file_dialog: (options) => invokeWindow("ails-dialog:open-file", options),
    open_directory_dialog: (options) => invokeWindow("ails-dialog:open-directory", options),
    on_windows_speech_event: (callback) => {
      if (typeof callback !== "function") return () => undefined
      const listener = (_event, value) => callback(value)
      ipcRenderer.on("ails-voice:windows-event", listener)
      return () => ipcRenderer.removeListener("ails-voice:windows-event", listener)
    },
    show_item_in_folder: (targetPath) => invokeWindow("ails-file:show-in-folder", targetPath),
    external_documents_ready: () => invokeWindow("ails-documents:ready"),
    ack_external_document: (id) => invokeWindow("ails-documents:ack", id),
    on_external_document: (callback) => {
      if (typeof callback !== "function") return () => undefined
      const listener = (_event, request) => callback(request)
      ipcRenderer.on("ails-documents:open", listener)
      return () => ipcRenderer.removeListener("ails-documents:open", listener)
    },
    open_path: (targetPath) => invokeWindow("ails-file:open-external", targetPath),
    open_split_window: (targetPath) => invokeWindow("ails-window:open-split-window", targetPath),
    read_workspace_clipboard: () => invokeWindow("ails-workspace:read-clipboard"),
    write_workspace_clipboard: (value, expectedId) => invokeWindow("ails-workspace:write-clipboard", value, expectedId),
    clear_workspace_clipboard: (expectedId) => invokeWindow("ails-workspace:clear-clipboard", expectedId),
    on_workspace_clipboard_change: (callback) => {
      if (typeof callback !== "function") return () => undefined
      const listener = (_event, value) => callback(value)
      ipcRenderer.on("ails-workspace:clipboard-changed", listener)
      return () => ipcRenderer.removeListener("ails-workspace:clipboard-changed", listener)
    },
    register_tab_strip: (bounds, items) => invokeWindow("ails-tabs:strip", bounds, items),
    capture_tab_screen: (rect) => invokeWindow("ails-tabs:capture-screen", rect),
    tab_window_ready: () => invokeWindow("ails-tabs:ready"),
    get_tab_window_state: () => invokeWindow("ails-tabs:window-state"),
    close_last_tab_window: (id) => invokeWindow("ails-tabs:close-last", id),
    begin_tab_drag: (descriptor) => invokeWindow("ails-tabs:begin", descriptor),
    finish_tab_drag: (id, cancelled = false, point) => invokeWindow("ails-tabs:finish", id, cancelled, point),
    reply_tab_window: (requestId, value, error) => ipcRenderer.send("ails-tabs:reply", requestId, value, error),
    on_tab_window_event: (callback) => {
      if (typeof callback !== "function") return () => undefined
      const listener = (_event, value) => callback(value)
      ipcRenderer.on("ails-tabs:event", listener)
      return () => ipcRenderer.removeListener("ails-tabs:event", listener)
    },
    on_update_status: (callback) => {
      if (typeof callback !== "function") return () => undefined
      const listener = (_event, status) => callback(status)
      ipcRenderer.on("ails-update:status-changed", listener)
      return () => ipcRenderer.removeListener("ails-update:status-changed", listener)
    },
  },
})
