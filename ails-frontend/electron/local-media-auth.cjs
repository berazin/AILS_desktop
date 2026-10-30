// Media elements cannot set custom headers. Authenticate their requests in
// Electron without putting the session secret in URLs, caches or referrers.
const sessionRegistrations = new WeakMap()
const mediaPaths = new Set(["/api/files", "/api/material-file/pdf-page"])

function urlOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function trustedFrame(frame, uiOrigin) {
  // Use Chromium's security origin, not the URL: a sandboxed frame may have
  // an opaque origin even when its URL or parent's URL belongs to the app.
  try {
    return Boolean(frame && frame.origin === uiOrigin)
  } catch {
    return false // A detached/destroyed frame must not receive credentials.
  }
}

function installLocalMediaAuthentication(webContents, targetUrl, backendPort, token) {
  const uiOrigin = urlOrigin(targetUrl)
  if (!uiOrigin || !token) throw new Error("Missing local media authentication configuration")
  const requestSession = webContents.session
  let registrations = sessionRegistrations.get(requestSession)
  if (!registrations) {
    registrations = new Map()
    sessionRegistrations.set(requestSession, registrations)
    requestSession.webRequest.onBeforeSendHeaders(
      { urls: ["http://127.0.0.1/*", "http://localhost/*"] },
      (details, callback) => {
        const registration = registrations.get(details.webContentsId)
        const headers = { ...details.requestHeaders }
        let url
        try {
          url = new URL(details.url)
        } catch {
          callback({ requestHeaders: headers })
          return
        }
        try {
          if (registration && !registration.webContents.isDestroyed()
            && details.method === "GET" && mediaPaths.has(url.pathname)
            && registration.mediaOrigins.has(url.origin)
            && !url.username && !url.password
            && urlOrigin(registration.webContents.getURL()) === registration.uiOrigin
            && trustedFrame(details.frame, registration.uiOrigin)) {
            for (const name of Object.keys(headers)) {
              if (name.toLowerCase() === "x-ails-token") delete headers[name]
            }
            headers["X-AILS-Token"] = registration.token
          }
        } catch {
          // A window can disappear while the network event is being handled.
          // Complete the callback without adding credentials in that case.
        }
        callback({ requestHeaders: headers })
      },
    )
  }
  const mediaOrigins = new Set([`http://127.0.0.1:${backendPort}`, `http://localhost:${backendPort}`])
  const uiUrl = new URL(targetUrl)
  // Relative media URLs go through Vite's /api proxy in development.
  // Trust only this window's exact loopback UI origin, not other dev servers.
  if (uiUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(uiUrl.hostname)) {
    mediaOrigins.add(uiOrigin)
  }
  registrations.set(webContents.id, {
    webContents,
    uiOrigin,
    mediaOrigins,
    token,
  })
  webContents.once("destroyed", () => registrations.delete(webContents.id))
}

module.exports = { installLocalMediaAuthentication }
